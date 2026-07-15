import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from './railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../service-credentials.ts';

const DEFAULT_RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';
const DEFAULT_RAILWAY_WORKSPACE = 'knowledge-coop';

let railwayReadActive = false;
const railwayReadWaiters: Array<() => void> = [];
let railwayReadCooldownUntil = 0;

async function acquireRailwayReadSlot() {
	if (railwayReadActive) await new Promise<void>((resolve) => railwayReadWaiters.push(resolve));
	railwayReadActive = true;
	const cooldownMs = Math.max(0, railwayReadCooldownUntil - Date.now());
	if (cooldownMs > 0) await new Promise((resolve) => setTimeout(resolve, cooldownMs));
	return () => {
		const next = railwayReadWaiters.shift();
		if (next) next();
		else railwayReadActive = false;
	};
}

function extendRailwayReadCooldown(delayMs: number) {
	railwayReadCooldownUntil = Math.max(railwayReadCooldownUntil, Date.now() + Math.max(0, delayMs));
}

export function normalizeRailwayEnvironmentName(value: string | null | undefined) {
	const normalized = typeof value === 'string' ? value.trim() : '';
	if (!normalized) {
		return '';
	}
	return normalized === 'prod' ? 'production' : normalized;
}

export type RailwayWorkspaceSummary = {
	id: string;
	name: string;
};

export type RailwayEnvironmentSummary = {
	id: string;
	name: string;
};

export type RailwayServiceSummary = {
	id: string;
	name: string;
};

export type RailwayProjectSummary = {
	id: string;
	name: string;
	workspaceId: string | null;
	deletedAt: string | null;
	environments: RailwayEnvironmentSummary[];
	services: RailwayServiceSummary[];
};

type RailwayTemplateSummary = {
	id: string;
	code: string | null;
	name: string | null;
	serializedConfig: Record<string, unknown>;
};

export type RailwayServiceInstanceSummary = {
	id: string | null;
	buildCommand: string | null;
	dockerfilePath: string | null;
	railwayConfigFile: string | null;
	startCommand: string | null;
	cronSchedule: string | null;
	rootDirectory: string | null;
	healthcheckPath: string | null;
	healthcheckTimeoutSeconds: number | null;
	healthcheckIntervalSeconds: number | null;
	restartPolicy: string | null;
	runtimeMode: string | null;
	sleepApplication: boolean | null;
	runtimeConfigSupported: boolean;
};

export type RailwayCustomDomainDnsRecord = {
	fqdn: string;
	hostlabel: string;
	recordType: string;
	requiredValue: string;
	currentValue: string;
	status: string;
	zone: string;
	purpose: string;
};

export type RailwayCustomDomainSummary = {
	id: string;
	domain: string;
	environmentId: string;
	serviceId: string;
	targetPort: number | null;
	verified: boolean;
	certificateStatus: string | null;
	verificationDnsHost: string | null;
	verificationToken: string | null;
	dnsRecords: RailwayCustomDomainDnsRecord[];
};

export type RailwayServiceDomainSummary = {
	id: string;
	domain: string;
	kind: 'service' | 'custom';
	environmentId: string;
	serviceId: string;
	targetPort: number | null;
};

export type RailwayVolumeInstanceSummary = {
	id: string;
	serviceId: string | null;
	environmentId: string | null;
	mountPath: string | null;
	state: string | null;
	isPendingDeletion: boolean;
	deletedAt: string | null;
	sizeGb: number | null;
	usedGb: number | null;
};

export type RailwayVolumeSummary = {
	id: string;
	name: string;
	projectId: string | null;
	instances: RailwayVolumeInstanceSummary[];
};

type RailwayEnvironmentPatchClient = Pick<IacClient, 'stageEnvironmentChanges' | 'commitStagedPatch'>;

function createRailwayEnvironmentPatchClient({
	env,
	fetchImpl,
}: {
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl: typeof fetch;
}): RailwayEnvironmentPatchClient {
	const token = resolveRailwayApiToken(env);
	if (!token) {
		throw new Error('Railway API token is required for environment reconciliation.');
	}
	return new IacClient({
		token,
		endpoint: resolveRailwayApiUrl(env),
		fetch: fetchImpl,
	});
}

function configuredEnvValue(env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined, name: string) {
	const value = env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function isUsableRailwayToken(value: string | undefined | null) {
	return typeof value === 'string' && value.trim().length >= 8;
}

export function resolveRailwayApiToken(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	const token = resolveTreeseedRailwayApiToken(env);
	return isUsableRailwayToken(token) ? token : '';
}

export function resolveRailwayApiUrl(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return configuredEnvValue(env, 'TREESEED_RAILWAY_API_URL') || DEFAULT_RAILWAY_API_URL;
}

export function resolveRailwayWorkspace(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	return configuredEnvValue(env, 'TREESEED_RAILWAY_WORKSPACE') || DEFAULT_RAILWAY_WORKSPACE;
}

function normalizeRailwayErrorMessage(payload: unknown, fallbackStatus?: number) {
	if (payload && typeof payload === 'object' && Array.isArray((payload as { errors?: unknown[] }).errors) && (payload as { errors: unknown[] }).errors.length > 0) {
		const first = (payload as { errors: unknown[] }).errors[0];
		if (first && typeof first === 'object' && typeof (first as { message?: unknown }).message === 'string') {
			return (first as { message: string }).message;
		}
	}
	return typeof fallbackStatus === 'number'
		? `Railway API request failed with ${fallbackStatus}.`
		: 'Railway API request failed.';
}

function isRetryableRailwayStatus(status: number) {
	return status === 408 || status === 429 || status >= 500;
}

function parseRetryAfterMs(value: string | null) {
	if (!value) {
		return null;
	}
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.round(seconds * 1000);
	}
	const absoluteTime = Date.parse(value);
	if (Number.isFinite(absoluteTime)) {
		return Math.max(0, absoluteTime - Date.now());
	}
	return null;
}

function markRailwayTransientError(error: Error, options: { retryAfterMs?: number | null; rateLimited?: boolean } = {}) {
	const tagged = error as Error & { treeseedTransient?: boolean; treeseedRetryAfterMs?: number; treeseedRateLimited?: boolean };
	tagged.treeseedTransient = true;
	if (options.rateLimited) tagged.treeseedRateLimited = true;
	if (typeof options.retryAfterMs === 'number' && Number.isFinite(options.retryAfterMs) && options.retryAfterMs >= 0) {
		tagged.treeseedRetryAfterMs = options.retryAfterMs;
	}
	return tagged;
}

function isTransientRailwayRequestError(error: unknown) {
	if (error && typeof error === 'object' && (error as { treeseedTransient?: boolean }).treeseedTransient === true) {
		return true;
	}
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|rate limit|too many requests|429/iu.test(message);
}

function railwayConnectionLabel(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeConnectionNodes<T>(connection: unknown, mapper: (node: Record<string, unknown>) => T | null) {
	if (!connection || typeof connection !== 'object' || !Array.isArray((connection as { edges?: unknown[] }).edges)) {
		return [];
	}
	return (connection as { edges: unknown[] }).edges
		.map((edge) => {
			if (!edge || typeof edge !== 'object') {
				return null;
			}
			const node = (edge as { node?: unknown }).node;
			return node && typeof node === 'object' ? mapper(node as Record<string, unknown>) : null;
		})
		.filter(Boolean) as T[];
}

function normalizeWorkspace(node: Record<string, unknown>): RailwayWorkspaceSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

function normalizeEnvironment(node: Record<string, unknown>): RailwayEnvironmentSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

function normalizeService(node: Record<string, unknown>): RailwayServiceSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

function normalizeProject(node: Record<string, unknown>): RailwayProjectSummary | null {
	const id = railwayConnectionLabel(node.id);
	const name = railwayConnectionLabel(node.name);
	if (!id || !name) {
		return null;
	}
	const services = new Map<string, RailwayServiceSummary>();
	for (const service of normalizeConnectionNodes(node.services, normalizeService)) {
		services.set(service.id, service);
	}
	for (const environment of normalizeConnectionNodes(node.environments, (entry) => entry as Record<string, unknown>)) {
		for (const instance of normalizeConnectionNodes(environment.serviceInstances, (entry) => entry as Record<string, unknown>)) {
			const serviceId = railwayConnectionLabel(instance.serviceId);
			const serviceName = railwayConnectionLabel(instance.serviceName);
			if (serviceId && serviceName) {
				services.set(serviceId, { id: serviceId, name: serviceName });
			}
		}
	}
	return {
		id,
		name,
		workspaceId: railwayConnectionLabel(node.workspaceId) || null,
		deletedAt: railwayConnectionLabel(node.deletedAt) || null,
		environments: normalizeConnectionNodes(node.environments, normalizeEnvironment),
		services: [...services.values()],
	};
}

function normalizeServiceInstanceService(node: Record<string, unknown>): RailwayServiceSummary | null {
	const id = railwayConnectionLabel(node.serviceId);
	const name = railwayConnectionLabel(node.serviceName);
	if (!id || !name) {
		return null;
	}
	return { id, name };
}

function normalizeVariableMap(value: unknown): Record<string, string | null> {
	if (!value) {
		return {};
	}
	if (typeof value === 'string') {
		try {
			return normalizeVariableMap(JSON.parse(value));
		} catch {
			return {};
		}
	}
	if (typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
			if (typeof entryValue === 'string') {
				return [key, entryValue];
			}
			if (entryValue && typeof entryValue === 'object' && typeof (entryValue as { value?: unknown }).value === 'string') {
				return [key, (entryValue as { value: string }).value];
			}
			return [key, null];
		}),
	);
}

function normalizeRailwayNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function normalizeRailwayCustomDomainDnsRecord(node: Record<string, unknown>): RailwayCustomDomainDnsRecord | null {
	const fqdn = railwayConnectionLabel(node.fqdn);
	if (!fqdn) {
		return null;
	}
	return {
		fqdn,
		hostlabel: railwayConnectionLabel(node.hostlabel),
		recordType: railwayConnectionLabel(node.recordType),
		requiredValue: railwayConnectionLabel(node.requiredValue),
		currentValue: railwayConnectionLabel(node.currentValue),
		status: railwayConnectionLabel(node.status),
		zone: railwayConnectionLabel(node.zone),
		purpose: railwayConnectionLabel(node.purpose),
	};
}

function normalizeRailwayCustomDomain(node: Record<string, unknown>): RailwayCustomDomainSummary | null {
	const id = railwayConnectionLabel(node.id);
	const domain = railwayConnectionLabel(node.domain);
	if (!id || !domain) {
		return null;
	}
	const status = node.status && typeof node.status === 'object' ? node.status as Record<string, unknown> : {};
	const dnsRecords = Array.isArray(status.dnsRecords)
		? status.dnsRecords
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayCustomDomainDnsRecord(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayCustomDomainDnsRecord[]
		: [];
	return {
		id,
		domain,
		environmentId: railwayConnectionLabel(node.environmentId),
		serviceId: railwayConnectionLabel(node.serviceId),
		targetPort: typeof node.targetPort === 'number' && Number.isFinite(node.targetPort) ? node.targetPort : null,
		verified: status.verified === true,
		certificateStatus: railwayConnectionLabel(status.certificateStatus) || null,
		verificationDnsHost: railwayConnectionLabel(status.verificationDnsHost) || null,
		verificationToken: railwayConnectionLabel(status.verificationToken) || null,
		dnsRecords,
	};
}

function normalizeRailwayDomain(node: unknown, kind: 'service' | 'custom' = 'service'): RailwayServiceDomainSummary | null {
	if (!node || typeof node !== 'object') {
		return null;
	}
	const record = node as Record<string, unknown>;
	const id = railwayConnectionLabel(record.id) || railwayConnectionLabel(record.domain);
	const domain = railwayConnectionLabel(record.domain);
	if (!id || !domain) {
		return null;
	}
	return {
		id,
		domain,
		kind,
		environmentId: railwayConnectionLabel(record.environmentId),
		serviceId: railwayConnectionLabel(record.serviceId),
		targetPort: normalizeRailwayNumber(record.targetPort),
	};
}

function normalizeRailwayDomainList(value: unknown, kind: 'service' | 'custom') {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.map((entry) => normalizeRailwayDomain(entry, kind)).filter(Boolean) as RailwayServiceDomainSummary[];
}

function normalizeRailwayVolumeInstance(node: Record<string, unknown>): RailwayVolumeInstanceSummary | null {
	const id = railwayConnectionLabel(node.id);
	if (!id) {
		return null;
	}
	const sizeGb = normalizeRailwayNumber(node.sizeGb ?? node.sizeGB ?? node.size_gb ?? node.capacityGb ?? node.capacityGB);
	const usedGb = normalizeRailwayNumber(node.usedGb ?? node.usedGB ?? node.used_gb ?? node.currentUsageGb ?? node.currentUsageGB);
	return {
		id,
		serviceId: railwayConnectionLabel(node.serviceId) || railwayConnectionLabel((node.service as { id?: unknown } | null)?.id) || null,
		environmentId: railwayConnectionLabel(node.environmentId) || railwayConnectionLabel((node.environment as { id?: unknown } | null)?.id) || null,
		mountPath: railwayConnectionLabel(node.mountPath) || railwayConnectionLabel(node.mount_path) || null,
		state: railwayConnectionLabel(node.state) || null,
		isPendingDeletion: node.isPendingDeletion === true || node.pendingDeletion === true,
		deletedAt: railwayConnectionLabel(node.deletedAt) || null,
		sizeGb,
		usedGb,
	};
}

function isActiveRailwayVolumeInstance(instance: RailwayVolumeInstanceSummary) {
	const state = String(instance.state ?? 'READY').toUpperCase();
	return !instance.isPendingDeletion
		&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
		&& state !== 'DELETING'
		&& state !== 'DELETED';
}

function normalizeVolumeInstances(value: unknown): RailwayVolumeInstanceSummary[] {
	const direct = Array.isArray(value) ? value : null;
	if (direct) {
		return direct
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayVolumeInstance(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayVolumeInstanceSummary[];
	}
	return normalizeConnectionNodes(value, normalizeRailwayVolumeInstance);
}

function mergeRailwayVolumeInstances(instances: RailwayVolumeInstanceSummary[]) {
	const byId = new Map<string, RailwayVolumeInstanceSummary>();
	for (const instance of instances) {
		const existing = byId.get(instance.id);
		byId.set(instance.id, existing ? {
			...existing,
			serviceId: existing.serviceId || instance.serviceId,
			environmentId: existing.environmentId || instance.environmentId,
			mountPath: existing.mountPath || instance.mountPath,
			state: [existing.state, instance.state].find((state) => /^(?:DELETED|DELETING)$/u.test(String(state ?? '').toUpperCase()))
				?? existing.state
				?? instance.state,
			isPendingDeletion: existing.isPendingDeletion || instance.isPendingDeletion,
			deletedAt: existing.deletedAt || instance.deletedAt,
			sizeGb: existing.sizeGb ?? instance.sizeGb,
			usedGb: existing.usedGb ?? instance.usedGb,
		} : instance);
	}
	return [...byId.values()];
}

function normalizeRailwayVolume(node: Record<string, unknown>): RailwayVolumeSummary | null {
	const id = railwayConnectionLabel(node.id);
	if (!id) {
		return null;
	}
	return {
		id,
		name: railwayConnectionLabel(node.name),
		projectId: railwayConnectionLabel(node.projectId) || null,
		instances: mergeRailwayVolumeInstances([
			...normalizeVolumeInstances(node.instances),
			...normalizeVolumeInstances(node.volumeInstances),
			...normalizeVolumeInstances(node.volume_instances),
		]),
	};
}

function collectRailwayVolumes(value: unknown, seen = new Set<object>()): RailwayVolumeSummary[] {
	const volumes: RailwayVolumeSummary[] = [];
	const visit = (entry: unknown) => {
		if (!entry || typeof entry !== 'object') {
			return;
		}
		if (seen.has(entry)) {
			return;
		}
		seen.add(entry);
		if (Array.isArray(entry)) {
			for (const item of entry) {
				visit(item);
			}
			return;
		}
		const record = entry as Record<string, unknown>;
		const volume = normalizeRailwayVolume(record);
		if (volume && (
			record.volumeInstances !== undefined
			|| record.instances !== undefined
			|| record.projectId !== undefined
			|| record.name !== undefined
		)) {
			volumes.push(volume);
		}
		for (const child of Object.values(record)) {
			visit(child);
		}
	};
	visit(value);
	const byId = new Map<string, RailwayVolumeSummary>();
	for (const volume of volumes) {
		const existing = byId.get(volume.id);
		byId.set(volume.id, existing
			? {
				...existing,
				name: existing.name || volume.name,
				projectId: existing.projectId || volume.projectId,
				instances: mergeRailwayVolumeInstances([...existing.instances, ...volume.instances]),
			}
			: volume);
	}
	return [...byId.values()];
}

function railwayApiTimeoutMs(env: NodeJS.ProcessEnv | Record<string, string | undefined>, explicitTimeoutMs?: number) {
	if (typeof explicitTimeoutMs === 'number' && Number.isFinite(explicitTimeoutMs) && explicitTimeoutMs > 0) {
		return explicitTimeoutMs;
	}
	const configured = Number.parseInt(String(env.TREESEED_RAILWAY_API_TIMEOUT_MS ?? '').trim(), 10);
	return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 15_000) : 15_000;
}

export function assertRailwayGraphqlReadOnly(document: string) {
	const operation = document
		.replace(/^\uFEFF/u, '')
		.replace(/#[^\r\n]*/gu, '')
		.trimStart();
	if (!operation.startsWith('query ') && !operation.startsWith('query\n') && !operation.startsWith('{')) {
		throw new Error('Direct Railway GraphQL is read-only. Use the official Railway SDK/IaC client, or the managed Railway CLI when the public SDK lacks the operation.');
	}
}

export async function railwayGraphqlRequest<TData = unknown>({
	query,
	variables,
	env = process.env,
	apiToken,
	apiUrl,
	fetchImpl = fetch,
	timeoutMs,
	retries = 3,
}: {
	query: string;
	variables?: Record<string, unknown>;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	apiToken?: string;
	apiUrl?: string;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	retries?: number;
}): Promise<{ data: TData }> {
	assertRailwayGraphqlReadOnly(query);
	const token = apiToken || resolveRailwayApiToken(env);
	if (!token) {
		throw new Error('Configure TREESEED_RAILWAY_API_TOKEN before invoking Railway APIs.');
	}
	const requestTimeoutMs = railwayApiTimeoutMs(env, timeoutMs);
	if (env.TREESEED_RECONCILE_TRACE === '1') {
		process.stderr.write(`[trsd][railway][api:request] timeoutMs=${requestTimeoutMs} retries=${retries}\n`);
	}
	let attempt = 0;
	for (;;) {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | null = null;
		let releaseReadSlot: (() => void) | null = null;
		try {
			releaseReadSlot = await acquireRailwayReadSlot();
			const response = await Promise.race([
					fetchImpl(apiUrl || resolveRailwayApiUrl(env), {
						method: 'POST',
						headers: {
							authorization: `Bearer ${token}`,
							'content-type': 'application/json',
						},
						body: JSON.stringify({ query, variables }),
						signal: controller.signal,
					}).then(async (fetchResponse) => ({
						ok: fetchResponse.ok,
						status: fetchResponse.status,
						payload: await fetchResponse.json().catch(() => ({})),
						retryAfter: fetchResponse.headers.get('retry-after'),
					})),
					new Promise<{
						ok: boolean;
						status: number;
						payload: unknown;
						retryAfter: string | null;
					}>((_, reject) => {
						timer = setTimeout(() => {
							controller.abort();
							reject(markRailwayTransientError(new Error(`Railway API request timed out after ${requestTimeoutMs}ms.`)));
						}, requestTimeoutMs);
					}),
				]);
			const payload = response.payload;
			if (!response.ok || (Array.isArray((payload as { errors?: unknown[] }).errors) && (payload as { errors: unknown[] }).errors.length > 0)) {
				const message = normalizeRailwayErrorMessage(payload, response.status);
				const hasGraphqlErrors = Array.isArray((payload as { errors?: unknown[] }).errors) && (payload as { errors: unknown[] }).errors.length > 0;
				const retryAfterMs = parseRetryAfterMs(response.retryAfter);
				const shouldRetry = isRetryableRailwayStatus(response.status) || /rate limit|too many requests/iu.test(message);
				const error = new Error(message);
				if (shouldRetry || (hasGraphqlErrors && /rate limit|too many requests/iu.test(message))) {
					const rateLimited = response.status === 429 || /rate limit|too many requests/iu.test(message);
					if (rateLimited) extendRailwayReadCooldown(retryAfterMs ?? 15_000);
					throw markRailwayTransientError(error, { retryAfterMs, rateLimited });
				}
				throw error;
			}
			return payload as { data: TData };
		} catch (error) {
			if (attempt >= retries || !isTransientRailwayRequestError(error)) {
				throw error;
			}
			attempt += 1;
			const retryAfterMs = error && typeof error === 'object' && typeof (error as { treeseedRetryAfterMs?: unknown }).treeseedRetryAfterMs === 'number'
				? Math.max(0, Number((error as { treeseedRetryAfterMs: number }).treeseedRetryAfterMs))
				: null;
			const rateLimited = error && typeof error === 'object' && (error as { treeseedRateLimited?: boolean }).treeseedRateLimited === true;
			const backoffMs = retryAfterMs !== null
				? Math.min(retryAfterMs, 180_000)
				: rateLimited
					? [15_000, 45_000, 90_000][attempt - 1] ?? 90_000
					: Math.min(500 * (2 ** (attempt - 1)), 4_000);
			if (rateLimited) process.stderr.write(`[trsd][railway][api:rate-limit] attempt=${attempt + 1} waitMs=${backoffMs}\n`);
			let remainingMs = backoffMs;
			while (remainingMs > 0) {
				const sliceMs = Math.min(15_000, remainingMs);
				await new Promise((resolve) => setTimeout(resolve, sliceMs));
				remainingMs -= sliceMs;
				if (rateLimited && remainingMs > 0) {
					process.stderr.write(`[trsd][railway][api:rate-limit] cooldownRemainingMs=${remainingMs}\n`);
				}
			}
		} finally {
			releaseReadSlot?.();
			if (timer) {
				clearTimeout(timer);
			}
		}
	}
}

export async function getRailwayAuthProfile({
	env = process.env,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		me?: {
			id?: string;
			name?: string;
			email?: string;
			workspaces?: Array<{ id?: string; name?: string }> | null;
		} | null;
	}>({
		query: `
query TreeseedRailwayAuthProfile {
	me {
		id
		name
		email
		workspaces {
			id
			name
		}
	}
}
`.trim(),
		env,
		fetchImpl,
	});
	const me = payload.data?.me;
	return {
		id: railwayConnectionLabel(me?.id) || null,
		name: railwayConnectionLabel(me?.name) || null,
		email: railwayConnectionLabel(me?.email) || null,
		workspaces: Array.isArray(me?.workspaces)
			? me.workspaces
				.map((workspace) => workspace && typeof workspace === 'object' ? normalizeWorkspace(workspace as Record<string, unknown>) : null)
				.filter(Boolean) as RailwayWorkspaceSummary[]
			: [],
	};
}

export async function resolveRailwayWorkspaceContext({
	env = process.env,
	workspace,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspace?: string;
	fetchImpl?: typeof fetch;
}) {
	const desired = (workspace || resolveRailwayWorkspace(env)).trim();
	const profile = await getRailwayAuthProfile({ env, fetchImpl });
	const match = profile.workspaces.find((candidate) => candidate.id === desired || candidate.name === desired) ?? null;
	if (!match) {
		const available = profile.workspaces.map((candidate) => candidate.name).join(', ') || '(none)';
		throw new Error(`Railway workspace ${desired} is not visible to the current token. Available workspaces: ${available}.`);
	}
	return match;
}

export async function listRailwayProjects({
	env = process.env,
	workspaceId,
	fetchImpl = fetch,
}: {
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspaceId: string;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		projects?: { edges?: Array<{ node?: Record<string, unknown> | null } | null> } | null;
	}>({
		query: `
query TreeseedRailwayProjects($workspaceId: String!, $first: Int!) {
	projects(workspaceId: $workspaceId, first: $first) {
		edges {
			node {
				id
				name
				workspaceId
				deletedAt
				environments(first: 50) {
					edges {
						node {
							id
							name
						}
					}
				}
				services(first: 50) {
					edges {
						node {
							id
							name
						}
					}
				}
			}
		}
	}
}
`.trim(),
		variables: { workspaceId, first: 100 },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.projects, normalizeProject);
}

export async function getRailwayProject({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProject($projectId: String!) {
	project(id: $projectId) {
		id
		name
		workspaceId
		deletedAt
		environments(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
		services(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return payload.data?.project ? normalizeProject(payload.data.project) : null;
}

export async function ensureRailwayProject({
	projectName,
	projectId,
	defaultEnvironmentName = 'staging',
	env = process.env,
	workspace,
	fetchImpl = fetch,
}: {
	projectName?: string | null;
	projectId?: string | null;
	defaultEnvironmentName?: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	workspace?: string;
	fetchImpl?: typeof fetch;
}) {
	const workspaceContext = await resolveRailwayWorkspaceContext({ env, workspace, fetchImpl });
	const projects = await listRailwayProjects({ env, workspaceId: workspaceContext.id, fetchImpl });
	const desiredProjectName = railwayConnectionLabel(projectName);
	const desiredProjectId = railwayConnectionLabel(projectId);
	const existing = projects.find((project) =>
		!project.deletedAt && (
			(desiredProjectId && project.id === desiredProjectId)
			|| (desiredProjectName && project.name === desiredProjectName)
		),
	) ?? null;
	if (existing) {
		return { workspace: workspaceContext, project: existing, created: false };
	}
	if (!desiredProjectName) {
		throw new Error('Railway project creation requires a project name.');
	}
	void defaultEnvironmentName;
	const tempRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-railway-init-'));
	try {
		await runRailwayCliJson({ args: ['init', '--name', desiredProjectName, '--workspace', workspaceContext.id, '--json'], env, cwd: tempRoot });
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	const project = (await listRailwayProjects({ env, workspaceId: workspaceContext.id, fetchImpl }))
		.find((entry) => entry.name === desiredProjectName && !entry.deletedAt) ?? null;
	if (!project) {
		throw new Error(`Railway project create did not return a usable project for ${desiredProjectName}.`);
	}
	return { workspace: workspaceContext, project, created: true };
}

export async function ensureRailwayEnvironment({
	projectId,
	environmentName,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentName: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const environments = await listRailwayEnvironments({ projectId, env, fetchImpl });
	const existing = environments.find((environment) => environment.name === environmentName || environment.id === environmentName) ?? null;
	if (existing) {
		return { environment: existing, created: false };
	}
	const tempRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-railway-environment-'));
	try {
		await runRailwayCliJson({ args: ['link', projectId, '--json'], env, cwd: tempRoot });
		await runRailwayCliJson({ args: ['environment', 'new', environmentName, '--json'], env, cwd: tempRoot });
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	const environment = (await listRailwayEnvironments({ projectId, env, fetchImpl }))
		.find((entry) => entry.name === environmentName) ?? null;
	if (!environment) {
		throw new Error(`Railway environment create did not return a usable environment for ${environmentName}.`);
	}
	return { environment, created: true };
}

export async function listRailwayEnvironments({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProjectEnvironments($projectId: String!) {
	project(id: $projectId) {
		id
		environments(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.project ? (payload.data.project as Record<string, unknown>).environments : null, normalizeEnvironment);
}

export async function listRailwayEnvironmentServices({
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		environment?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayEnvironmentServices($environmentId: String!) {
	environment(id: $environmentId) {
		id
		name
		serviceInstances(first: 100) {
			edges {
				node {
					id
					serviceId
					serviceName
					environmentId
				}
			}
		}
	}
}
`.trim(),
		variables: { environmentId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(
		payload.data?.environment ? (payload.data.environment as Record<string, unknown>).serviceInstances : null,
		normalizeServiceInstanceService,
	);
}

export async function ensureRailwayService({
	projectId,
	serviceName,
	serviceId,
	environmentId,
	imageRef,
	sourceRepo,
	sourceBranch,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	serviceName?: string | null;
	serviceId?: string | null;
	environmentId?: string | null;
	imageRef?: string | null;
	sourceRepo?: string | null;
	sourceBranch?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const services = await listRailwayServices({ projectId, env, fetchImpl });
	const desiredServiceName = railwayConnectionLabel(serviceName);
	const desiredServiceId = railwayConnectionLabel(serviceId);
	let existing = services.find((service) =>
		(desiredServiceId && service.id === desiredServiceId)
		|| (desiredServiceName && service.name === desiredServiceName),
	) ?? null;
	if (!existing && environmentId) {
		const environmentServices = await listRailwayEnvironmentServices({ environmentId, env, fetchImpl }).catch(() => []);
		existing = environmentServices.find((service) =>
			(desiredServiceId && service.id === desiredServiceId)
			|| (desiredServiceName && service.name === desiredServiceName),
		) ?? null;
	}
	if (existing) {
		const desiredImageRef = railwayConnectionLabel(imageRef);
		const desiredSourceRepo = railwayConnectionLabel(sourceRepo);
		if (desiredSourceRepo) {
			try {
				await updateRailwayServiceGitSource({
					projectId,
					serviceId: existing.id,
					environmentId,
					sourceRepo: desiredSourceRepo,
					sourceBranch,
					env,
					fetchImpl,
				});
			} catch (error) {
				if (!looksLikeRailwayImageSourceUpdateUnsupported(error)) {
					throw error;
				}
				throw new Error(
					`Railway Git source update for existing service ${existing.name} (${existing.id}) is unsupported; `
					+ 'refusing to delete and recreate an existing service. Repair the service in place or use a provider-supported source update.',
				);
			}
			return { service: existing, created: false };
		}
		if (desiredImageRef) {
			try {
				await updateRailwayServiceImageSource({
					projectId,
					serviceId: existing.id,
					environmentId,
					imageRef: desiredImageRef,
					env,
					fetchImpl,
				});
			} catch (error) {
				if (!looksLikeRailwayImageSourceUpdateUnsupported(error)) {
					throw error;
				}
				throw new Error(
					`Railway image source update for existing service ${existing.name} (${existing.id}) is unsupported; `
					+ 'refusing to delete and recreate an existing service. Repair the service in place or use a provider-supported image source update.',
				);
			}
		}
		return { service: existing, created: false };
	}
	if (!desiredServiceName) {
		throw new Error('Railway service creation requires a service name.');
	}
	const service = await createRailwayImageService({
		projectId,
		environmentId,
		serviceName: desiredServiceName,
		imageRef,
		sourceRepo,
		sourceBranch,
		env,
		fetchImpl,
	});
	return { service, created: true };
}

async function createRailwayImageService({
	projectId,
	serviceName,
	environmentId,
	imageRef,
	sourceRepo,
	sourceBranch,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	serviceName: string;
	environmentId?: string | null;
	imageRef?: string | null;
	sourceRepo?: string | null;
	sourceBranch?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredSourceRepo = railwayConnectionLabel(sourceRepo);
	const desiredImageRef = railwayConnectionLabel(imageRef);
	const targetEnvironmentId = railwayConnectionLabel(environmentId);
	if (!targetEnvironmentId) throw new Error(`Railway service creation requires an environment id for ${serviceName}.`);
	const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
	await client.stageEnvironmentChanges({
		environmentId: targetEnvironmentId,
		merge: true,
		patch: {
			services: {
				[serviceName]: {
					isCreated: true,
					source: desiredSourceRepo
						? { repo: desiredSourceRepo, branch: railwayConnectionLabel(sourceBranch) || null, image: null }
						: desiredImageRef ? { image: desiredImageRef, repo: null, branch: null } : null,
				},
			},
		},
	});
	await client.commitStagedPatch({
		environmentId: targetEnvironmentId,
		message: `Treeseed create service ${serviceName}`,
		skipDeploys: true,
	});
	const service = (await listRailwayServices({ projectId, env, fetchImpl })).find((entry) => entry.name === serviceName) ?? null;
	if (!service) {
		throw new Error(`Railway service create did not return a usable service for ${serviceName}.`);
	}
	return service;
}

function looksLikeRailwayImageSourceUpdateUnsupported(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /Problem processing request|source|image|ServiceUpdateInput/iu.test(message);
}

export async function updateRailwayServiceImageSource({
	projectId,
	serviceId,
	environmentId,
	imageRef,
	env = process.env,
}: {
	projectId?: string | null;
	serviceId: string;
	environmentId?: string | null;
	imageRef: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredImage = railwayConnectionLabel(imageRef);
	if (!serviceId || !desiredImage) {
		throw new Error('Railway service image source update requires a service id and image reference.');
	}
	const targetEnvironmentId = railwayConnectionLabel(environmentId);
	if (!targetEnvironmentId) throw new Error(`Railway service image source update requires an environment id for ${serviceId}.`);
	await connectRailwayServiceSourceWithCli({
		projectId,
		environmentId: targetEnvironmentId,
		serviceId,
		image: desiredImage,
		env,
	});
	return { id: serviceId, name: serviceId };
}

export async function updateRailwayServiceGitSource({
	projectId,
	serviceId,
	environmentId,
	sourceRepo,
	sourceBranch,
	env = process.env,
}: {
	projectId?: string | null;
	serviceId: string;
	environmentId?: string | null;
	sourceRepo: string;
	sourceBranch?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredRepo = railwayConnectionLabel(sourceRepo);
	if (!serviceId || !desiredRepo) {
		throw new Error('Railway service Git source update requires a service id and repository slug.');
	}
	const targetEnvironmentId = railwayConnectionLabel(environmentId);
	if (!targetEnvironmentId) throw new Error(`Railway service Git source update requires an environment id for ${serviceId}.`);
	await connectRailwayServiceSourceWithCli({
		projectId,
		environmentId: targetEnvironmentId,
		serviceId,
		repo: desiredRepo,
		branch: railwayConnectionLabel(sourceBranch) || null,
		env,
	});
	return { id: serviceId, name: serviceId };
}

export async function ensureRailwayGeneratedServiceDomain({
	projectId,
	environmentId,
	serviceId,
	targetPort,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	targetPort?: number | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const domains = await listRailwayServiceDomains({ projectId, environmentId, serviceId, env, fetchImpl });
	const existing = domains.find((domain) => domain.kind === 'service') ?? domains.find((domain) => domain.domain.endsWith('.railway.app')) ?? null;
	if (existing) {
		return { domain: existing, created: false };
	}
	await runRailwayCliJson({
		args: [
			'domain', '--project', projectId, '--environment', environmentId, '--service', serviceId,
			...(Number.isFinite(Number(targetPort)) ? ['--port', String(Number(targetPort))] : []), '--json',
		],
		env,
	});
	const domain = (await listRailwayServiceDomains({ projectId, environmentId, serviceId, env, fetchImpl }))
		.find((entry) => entry.kind === 'service' || entry.domain.endsWith('.railway.app')) ?? null;
	if (!domain) {
		throw new Error('Railway service domain create did not return a usable domain.');
	}
	return { domain, created: true };
}

export async function listRailwayServiceDomains({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		domains?: unknown;
	}>({
		query: `
query TreeseedRailwayServiceDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
	domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
		serviceDomains {
			id
			domain
			serviceId
			environmentId
			targetPort
		}
		customDomains {
			id
			domain
			serviceId
			environmentId
			targetPort
		}
	}
}
`.trim(),
		variables: { projectId, environmentId, serviceId },
		env,
		fetchImpl,
	});
	const domains = payload.data?.domains && typeof payload.data.domains === 'object'
		? payload.data.domains as Record<string, unknown>
		: {};
	return [
		...normalizeRailwayDomainList(domains.serviceDomains, 'service'),
		...normalizeRailwayDomainList(domains.customDomains, 'custom'),
	];
}

export async function deployRailwayServiceInstance({
	projectId,
	serviceId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	serviceId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	void fetchImpl;
	const targetProjectId = railwayConnectionLabel(projectId) || configuredEnvValue(env, 'TREESEED_RAILWAY_PROJECT_ID');
	if (!targetProjectId) throw new Error(`Railway CLI redeploy requires a project id for service ${serviceId}.`);
	const result = await runRailwayCliJson<Record<string, unknown>>({
		args: ['service', 'redeploy', '--project', targetProjectId, '--environment', environmentId, '--service', serviceId, '--from-source', '--yes', '--json'],
		env,
	});
	return { deploymentId: railwayConnectionLabel(result.deploymentId ?? result.id) || null };
}

export async function updateRailwayServiceName({
	serviceId,
	name,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	name: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredName = railwayConnectionLabel(name);
	if (!serviceId || !desiredName) {
		throw new Error('Railway service rename requires a service id and name.');
	}
	void env; void fetchImpl;
	throw new Error(`Railway service rename ${serviceId} -> ${desiredName} is not exposed by the official SDK or CLI; direct GraphQL mutation is prohibited.`);
}

export async function ensureRailwayPostgresService({
	projectId,
	environmentId,
	serviceName,
	env = process.env,
	fetchImpl = fetch,
	maxAttempts = 40,
}: {
	projectId: string;
	environmentId: string;
	serviceName: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	maxAttempts?: number;
}) {
	const desiredServiceName = railwayConnectionLabel(serviceName);
	if (!desiredServiceName) {
		throw new Error('Railway Postgres service creation requires a service name.');
	}
	const services = await listRailwayServices({ projectId, env, fetchImpl });
	const existing = services.find((service) => service.name === desiredServiceName || service.id === desiredServiceName) ?? null;
	if (existing) {
		const proof = await inspectRailwayPostgresService({ projectId, environmentId, serviceId: existing.id, env, fetchImpl });
		if (proof.ok) {
			return { service: existing, created: false, proof };
		}
		throw new Error(
			`Railway Postgres service ${existing.name} (${existing.id}) failed proof; `
			+ 'refusing to delete and recreate an existing service. Repair the existing database service in place and rerun reconciliation.',
		);
	}
	const template = await getRailwayTemplateByCode({ code: 'postgres', env, fetchImpl });
	await deployRailwayTemplate({
		templateId: template.id,
		serializedConfig: template.serializedConfig,
		projectId,
		environmentId,
		env,
		fetchImpl,
	});
	const settled = await waitForRailwayPostgresTemplateService({
		projectId,
		environmentId,
		desiredServiceName,
		env,
		fetchImpl,
		maxAttempts,
	});
	return { service: settled.service, created: true, proof: settled.proof };
}

async function getRailwayTemplateByCode({
	code,
	env = process.env,
	fetchImpl = fetch,
}: {
	code: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}): Promise<RailwayTemplateSummary> {
	const payload = await railwayGraphqlRequest<{
		template?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayTemplate($code: String!) {
	template(code: $code) {
		id
		code
		name
		serializedConfig
	}
}
`.trim(),
		variables: { code },
		env,
		fetchImpl,
		timeoutMs: 15_000,
		retries: 1,
	});
	const template = payload.data?.template;
	const id = railwayConnectionLabel(template?.id);
	if (!id || !template || typeof template !== 'object') {
		throw new Error(`Railway Postgres template "${code}" was not found through the Railway API.`);
	}
	return {
		id,
		code: railwayConnectionLabel(template.code) || null,
		name: railwayConnectionLabel(template.name) || null,
		serializedConfig: normalizeTemplateSerializedConfig(template.serializedConfig),
	};
}

function normalizeTemplateSerializedConfig(value: unknown): Record<string, unknown> {
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
		} catch {
			return {};
		}
	}
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function deployRailwayTemplate({
	templateId,
	serializedConfig,
	projectId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	templateId: string;
	serializedConfig: Record<string, unknown>;
	projectId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	void serializedConfig; void env; void fetchImpl;
	throw new Error(`Railway template deployment ${templateId} into ${projectId}/${environmentId} is not exposed non-interactively by the official SDK or CLI; direct GraphQL mutation is prohibited.`);
}

async function waitForRailwayPostgresTemplateService({
	projectId,
	environmentId,
	desiredServiceName,
	env = process.env,
	fetchImpl = fetch,
	maxAttempts = 40,
}: {
	projectId: string;
	environmentId: string;
	desiredServiceName: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	maxAttempts?: number;
}) {
	let lastProof: Awaited<ReturnType<typeof inspectRailwayPostgresService>> | null = null;
	for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
		const services = await listRailwayServices({ projectId, env, fetchImpl });
		for (const service of services) {
			const proof = await inspectRailwayPostgresService({
				projectId,
				environmentId,
				serviceId: service.id,
				env,
				fetchImpl,
			});
			if (proof.ok) {
				const renamed = service.name === desiredServiceName
					? service
					: await updateRailwayServiceName({ serviceId: service.id, name: desiredServiceName, env, fetchImpl });
				return { service: renamed, proof };
			}
			lastProof = proof;
		}
		await new Promise((resolve) => setTimeout(resolve, 3000));
	}
	throw new Error(`Railway Postgres template deployment did not produce a managed PostgreSQL service named ${desiredServiceName}. Last proof: ${lastProof?.message ?? 'no candidate service observed'}`);
}

async function inspectRailwayPostgresService({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const variables = await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}));
	const hasConnectionVars = typeof variables.DATABASE_URL === 'string'
		&& typeof variables.PGHOST === 'string'
		&& typeof variables.PGUSER === 'string'
		&& typeof variables.PGPASSWORD === 'string'
		&& typeof variables.PGDATABASE === 'string';
	const volumes = await listRailwayVolumes({ projectId, env, fetchImpl }).catch(() => []);
	const volume = volumes.find((candidate) => candidate.instances.some((instance) =>
		instance.serviceId === serviceId
		&& instance.environmentId === environmentId
		&& instance.mountPath === '/var/lib/postgresql/data',
	)) ?? null;
	const deployment = await inspectRailwayServiceDeploymentHealth({ serviceId, environmentId, env, fetchImpl }).catch((error) => ({
		ok: false,
		status: null,
		message: error instanceof Error ? error.message : String(error ?? 'Unable to inspect PostgreSQL deployment health.'),
	}));
	return {
		ok: hasConnectionVars && Boolean(volume) && deployment.ok,
		variableKeys: Object.keys(variables).sort(),
		volumeId: volume?.id ?? null,
		deploymentStatus: deployment.status,
		message: hasConnectionVars
			? volume
				? deployment.ok
					? 'Railway managed PostgreSQL markers are present and the deployment is healthy.'
					: `Railway managed PostgreSQL markers are present, but deployment health is not ready. ${deployment.message}`
				: 'PostgreSQL connection variables exist, but the managed data volume is missing.'
			: 'PostgreSQL connection variables are missing.',
	};
}

export async function inspectRailwayServiceDeploymentHealth({
	serviceId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		serviceInstance?: {
			latestDeployment?: {
				status?: string | null;
				deploymentStopped?: boolean | null;
				meta?: {
					branch?: string | null;
					repo?: string | null;
					image?: string | null;
					rootDirectory?: string | null;
					commitHash?: string | null;
				} | null;
				instances?: Array<{ status?: string | null }> | null;
			} | null;
		} | null;
	}>({
		query: `
query TreeseedRailwayServiceDeploymentHealth($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		latestDeployment {
			status
			deploymentStopped
			meta
			instances {
				status
			}
		}
	}
}
`.trim(),
		variables: { serviceId, environmentId },
		env,
		fetchImpl,
	});
	const deployment = payload.data?.serviceInstance?.latestDeployment;
	const status = railwayConnectionLabel(deployment?.status)?.toUpperCase() ?? null;
	const instanceStatuses = Array.isArray(deployment?.instances)
		? deployment.instances.map((instance) => railwayConnectionLabel(instance?.status)?.toUpperCase()).filter(Boolean)
		: [];
	const stopped = deployment?.deploymentStopped === true;
	const ok = status === 'SUCCESS' && !stopped && (instanceStatuses.length === 0 || instanceStatuses.some((candidate) => candidate === 'RUNNING'));
	return {
		ok,
		status,
		deploymentStopped: stopped,
		instanceStatuses,
		branch: railwayConnectionLabel(deployment?.meta?.branch) || null,
		repo: railwayConnectionLabel(deployment?.meta?.repo) || null,
		rootDirectory: railwayConnectionLabel(deployment?.meta?.rootDirectory) || null,
		commitHash: railwayConnectionLabel(deployment?.meta?.commitHash) || null,
		image: railwayConnectionLabel(deployment?.meta?.image) || null,
		requiredMountPath: railwayConnectionLabel(deployment?.meta?.serviceManifest?.deploy?.requiredMountPath) || null,
		volumeMounts: Array.isArray(deployment?.meta?.volumeMounts)
			? deployment.meta.volumeMounts.map((entry: unknown) => railwayConnectionLabel(entry)).filter(Boolean)
			: [],
		message: ok
			? 'Deployment is healthy.'
			: `Latest deployment status is ${status ?? 'unknown'}${stopped ? ' and stopped' : ''}${instanceStatuses.length ? `; instances=${instanceStatuses.join(',')}` : ''}.`,
	};
}

export async function listRailwayServices({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProjectServices($projectId: String!) {
	project(id: $projectId) {
		id
		services(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.project ? (payload.data.project as Record<string, unknown>).services : null, normalizeService);
}

export async function getRailwayServiceInstance({
	serviceId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const legacySummary = {
		id: null,
		buildCommand: null,
		dockerfilePath: null,
		railwayConfigFile: null,
		startCommand: null,
		cronSchedule: null,
		rootDirectory: null,
		healthcheckPath: null,
		healthcheckTimeoutSeconds: null,
		healthcheckIntervalSeconds: null,
		restartPolicy: null,
		runtimeMode: null,
		sleepApplication: null,
		runtimeConfigSupported: false,
	} satisfies RailwayServiceInstanceSummary;
	try {
		const payload = await railwayGraphqlRequest<{
			serviceInstance?: Record<string, unknown> | null;
		}>({
			query: `
query TreeseedRailwayServiceInstance($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		id
		buildCommand
		dockerfilePath
		railwayConfigFile
		startCommand
		cronSchedule
		rootDirectory
		healthcheckPath
		healthcheckTimeout
		sleepApplication
	}
}
`.trim(),
			variables: { serviceId, environmentId },
			env,
			fetchImpl,
		});
		const instance = payload.data?.serviceInstance;
		return {
			id: railwayConnectionLabel(instance?.id) || null,
			buildCommand: railwayConnectionLabel(instance?.buildCommand) || null,
			dockerfilePath: railwayConnectionLabel(instance?.dockerfilePath) || null,
			railwayConfigFile: railwayConnectionLabel(instance?.railwayConfigFile) || null,
			startCommand: railwayConnectionLabel(instance?.startCommand) || null,
			cronSchedule: railwayConnectionLabel(instance?.cronSchedule) || null,
			rootDirectory: railwayConnectionLabel(instance?.rootDirectory) || null,
			healthcheckPath: railwayConnectionLabel(instance?.healthcheckPath) || null,
			healthcheckTimeoutSeconds: normalizeRailwayNumber(instance?.healthcheckTimeout),
			healthcheckIntervalSeconds: null,
			restartPolicy: null,
			runtimeMode: instance?.sleepApplication === true ? 'serverless' : 'replicated',
			sleepApplication: typeof instance?.sleepApplication === 'boolean' ? instance.sleepApplication : null,
			runtimeConfigSupported: true,
		} satisfies RailwayServiceInstanceSummary;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (/Cannot query field .*healthcheckPath|Cannot query field .*healthcheckTimeout|Cannot query field .*sleepApplication/iu.test(message)) {
			const payload = await railwayGraphqlRequest<{
				serviceInstance?: Record<string, unknown> | null;
			}>({
				query: `
query TreeseedRailwayServiceInstanceLegacy($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		id
		buildCommand
		dockerfilePath
		railwayConfigFile
		startCommand
		cronSchedule
		rootDirectory
	}
}
`.trim(),
				variables: { serviceId, environmentId },
				env,
				fetchImpl,
			});
			const instance = payload.data?.serviceInstance;
			return {
				...legacySummary,
				id: railwayConnectionLabel(instance?.id) || null,
				buildCommand: railwayConnectionLabel(instance?.buildCommand) || null,
				dockerfilePath: railwayConnectionLabel(instance?.dockerfilePath) || null,
				railwayConfigFile: railwayConnectionLabel(instance?.railwayConfigFile) || null,
				startCommand: railwayConnectionLabel(instance?.startCommand) || null,
				cronSchedule: railwayConnectionLabel(instance?.cronSchedule) || null,
				rootDirectory: railwayConnectionLabel(instance?.rootDirectory) || null,
			} satisfies RailwayServiceInstanceSummary;
		}
		if (!/ServiceInstance not found/iu.test(message)) {
			throw error;
		}
		return legacySummary;
	}
}

export async function ensureRailwayServiceInstanceConfiguration({
	serviceId,
	environmentId,
	buildCommand,
	dockerfilePath,
	railwayConfigFile,
	startCommand,
	cronSchedule,
	rootDirectory,
	healthcheckPath,
	healthcheckTimeoutSeconds,
	healthcheckIntervalSeconds,
	restartPolicy,
	runtimeMode,
	deploymentRegion,
	clearSourceConfiguration = false,
	env = process.env,
	fetchImpl = fetch,
	settleAttempts = 60,
	settleDelayMs = 5_000,
}: {
	serviceId: string;
	environmentId: string;
	buildCommand?: string | null;
	dockerfilePath?: string | null;
	railwayConfigFile?: string | null;
	startCommand?: string | null;
	cronSchedule?: string | null;
	rootDirectory?: string | null;
	healthcheckPath?: string | null;
	healthcheckTimeoutSeconds?: number | null;
	healthcheckIntervalSeconds?: number | null;
	restartPolicy?: string | null;
	runtimeMode?: string | null;
	deploymentRegion?: string | null;
	clearSourceConfiguration?: boolean;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	settleAttempts?: number;
	settleDelayMs?: number;
}) {
	let current = await getRailwayServiceInstance({ serviceId, environmentId, env, fetchImpl });
	if (!current.id) {
		for (let attempt = 0; attempt < settleAttempts && !current.id; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
			current = await getRailwayServiceInstance({ serviceId, environmentId, env, fetchImpl });
		}
	}
	if (!current.id) {
		return { instance: current, updated: false };
	}
	const desiredRuntimeMode = railwayConnectionLabel(runtimeMode) === 'service'
		? 'replicated'
		: railwayConnectionLabel(runtimeMode) || null;
	const desiredDeploymentRegion = railwayConnectionLabel(deploymentRegion) || null;
	const desired = {
		buildCommand: railwayConnectionLabel(buildCommand) || null,
		dockerfilePath: railwayConnectionLabel(dockerfilePath) || null,
		railwayConfigFile: railwayConnectionLabel(railwayConfigFile) || null,
		startCommand: railwayConnectionLabel(startCommand) || null,
		cronSchedule: railwayConnectionLabel(cronSchedule) || null,
		rootDirectory: railwayConnectionLabel(rootDirectory) || null,
		healthcheckPath: railwayConnectionLabel(healthcheckPath) || null,
		healthcheckTimeoutSeconds: normalizeRailwayNumber(healthcheckTimeoutSeconds),
		healthcheckIntervalSeconds: normalizeRailwayNumber(healthcheckIntervalSeconds),
		restartPolicy: railwayConnectionLabel(restartPolicy) || null,
		runtimeMode: desiredRuntimeMode,
		deploymentRegion: desiredDeploymentRegion,
		sleepApplication: desiredRuntimeMode === 'serverless'
			? true
			: desiredRuntimeMode === 'replicated'
				? false
				: null,
	};
	const needsRuntimeConfig = desired.healthcheckPath !== null
		|| desired.healthcheckTimeoutSeconds !== null
		|| desired.runtimeMode !== null
		|| desired.deploymentRegion !== null;
	if (needsRuntimeConfig && current.runtimeConfigSupported !== true) {
		throw new Error('Railway service instance runtime settings are unsupported by the current Railway API schema.');
	}
	if (desired.healthcheckIntervalSeconds !== null) {
		throw new Error('Railway service instance healthcheck intervals are unsupported by the current Railway API schema.');
	}
	if (desired.restartPolicy !== null) {
		throw new Error('Railway service instance restart policies are unsupported by the current Railway API schema.');
	}
	const drifted = (
		((desired.buildCommand !== null || clearSourceConfiguration) && desired.buildCommand !== current.buildCommand)
		|| ((desired.dockerfilePath !== null || clearSourceConfiguration) && desired.dockerfilePath !== current.dockerfilePath)
		|| ((desired.railwayConfigFile !== null || clearSourceConfiguration) && desired.railwayConfigFile !== current.railwayConfigFile)
		|| ((desired.startCommand !== null || clearSourceConfiguration) && desired.startCommand !== current.startCommand)
		|| (desired.cronSchedule !== null && desired.cronSchedule !== current.cronSchedule)
		|| ((desired.rootDirectory !== null || clearSourceConfiguration) && desired.rootDirectory !== current.rootDirectory)
		|| (desired.healthcheckPath !== null && desired.healthcheckPath !== current.healthcheckPath)
		|| (desired.healthcheckTimeoutSeconds !== null && desired.healthcheckTimeoutSeconds !== current.healthcheckTimeoutSeconds)
		|| (desired.runtimeMode !== null && desired.runtimeMode !== current.runtimeMode)
		|| desired.deploymentRegion !== null
	);
	if (!drifted) {
		return { instance: current, updated: false };
	}
	const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
	await client.stageEnvironmentChanges({
		environmentId,
		merge: true,
		patch: {
			services: {
				[serviceId]: {
					build: {
						...(desired.buildCommand !== null || clearSourceConfiguration ? { buildCommand: desired.buildCommand } : {}),
						...(desired.dockerfilePath !== null || clearSourceConfiguration ? { dockerfilePath: desired.dockerfilePath } : {}),
					},
					...(desired.railwayConfigFile !== null || clearSourceConfiguration ? { configFile: desired.railwayConfigFile } : {}),
					...(desired.rootDirectory !== null || clearSourceConfiguration ? { source: { rootDirectory: desired.rootDirectory } } : {}),
					deploy: {
						...(desired.startCommand !== null || clearSourceConfiguration ? { startCommand: desired.startCommand } : {}),
						...(desired.cronSchedule !== null ? { cronSchedule: desired.cronSchedule } : {}),
						...(desired.healthcheckPath !== null ? { healthcheckPath: desired.healthcheckPath } : {}),
						...(desired.healthcheckTimeoutSeconds !== null ? { healthcheckTimeout: desired.healthcheckTimeoutSeconds } : {}),
						...(desired.sleepApplication !== null ? { sleepApplication: desired.sleepApplication } : {}),
						...(desired.runtimeMode !== null ? { runtime: desired.runtimeMode } : {}),
						...(desired.deploymentRegion !== null ? {
							region: desired.deploymentRegion,
							multiRegionConfig: { [desired.deploymentRegion]: { numReplicas: 1 } },
						} : {}),
					},
				},
			},
		},
	});
	await client.commitStagedPatch({
		environmentId,
		message: `Treeseed reconcile service configuration ${serviceId}`,
		skipDeploys: true,
	});
	let instance = current;
	for (let attempt = 0; attempt <= settleAttempts; attempt += 1) {
		instance = await getRailwayServiceInstance({
			serviceId,
			environmentId,
			env,
			fetchImpl,
		});
		if (!serviceInstanceDrifted(instance, desired, clearSourceConfiguration) || attempt >= settleAttempts) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
	}
	return {
		instance: {
			id: instance.id || current.id,
			buildCommand: instance.buildCommand,
			dockerfilePath: instance.dockerfilePath,
			railwayConfigFile: instance.railwayConfigFile,
			startCommand: instance.startCommand,
			cronSchedule: instance.cronSchedule,
			rootDirectory: instance.rootDirectory,
			healthcheckPath: instance.healthcheckPath,
			healthcheckTimeoutSeconds: instance.healthcheckTimeoutSeconds,
			healthcheckIntervalSeconds: instance.healthcheckIntervalSeconds,
			restartPolicy: instance.restartPolicy,
			runtimeMode: instance.runtimeMode,
			sleepApplication: instance.sleepApplication,
			runtimeConfigSupported: instance.runtimeConfigSupported,
		} satisfies RailwayServiceInstanceSummary,
		updated: true,
	};
}

function serviceInstanceDrifted(
	current: RailwayServiceInstanceSummary,
	desired: {
		buildCommand: string | null;
		dockerfilePath?: string | null;
		railwayConfigFile?: string | null;
		startCommand: string | null;
		cronSchedule: string | null;
		rootDirectory: string | null;
		healthcheckPath: string | null;
		healthcheckTimeoutSeconds: number | null;
		runtimeMode: string | null;
	},
	clearSourceConfiguration = false,
) {
	return (
		((desired.buildCommand !== null || clearSourceConfiguration) && desired.buildCommand !== current.buildCommand)
		|| (((desired.dockerfilePath !== null && desired.dockerfilePath !== undefined) || clearSourceConfiguration) && (desired.dockerfilePath ?? null) !== current.dockerfilePath)
		|| (((desired.railwayConfigFile !== null && desired.railwayConfigFile !== undefined) || clearSourceConfiguration) && (desired.railwayConfigFile ?? null) !== current.railwayConfigFile)
		|| ((desired.startCommand !== null || clearSourceConfiguration) && desired.startCommand !== current.startCommand)
		|| (desired.cronSchedule !== null && desired.cronSchedule !== current.cronSchedule)
		|| ((desired.rootDirectory !== null || clearSourceConfiguration) && desired.rootDirectory !== current.rootDirectory)
		|| (desired.healthcheckPath !== null && desired.healthcheckPath !== current.healthcheckPath)
		|| (desired.healthcheckTimeoutSeconds !== null && desired.healthcheckTimeoutSeconds !== current.healthcheckTimeoutSeconds)
		|| (desired.runtimeMode !== null && desired.runtimeMode !== current.runtimeMode)
	);
}

export async function listRailwayVariables({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		variables?: unknown;
	}>({
		query: `
query TreeseedRailwayVariables($projectId: String!, $environmentId: String!, $serviceId: String) {
	variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, unrendered: true)
}
`.trim(),
		variables: {
			projectId,
			environmentId,
			serviceId: serviceId || null,
		},
		env,
		fetchImpl,
	});
	return normalizeVariableMap(payload.data?.variables);
}

export async function upsertRailwayVariables({
	projectId,
	environmentId,
	serviceId,
	variables,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId?: string | null;
	variables: Record<string, string>;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (Object.keys(variables).length === 0) {
		return;
	}
	const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
	const applyVariablePatch = async (keys: string[]) => {
		const variablePatch = Object.fromEntries(keys.map((key) => [key, { value: variables[key] }]));
		await client.stageEnvironmentChanges({
			environmentId,
			merge: true,
			patch: serviceId
				? { services: { [serviceId]: { variables: variablePatch } } }
				: { sharedVariables: variablePatch },
		});
		await client.commitStagedPatch({
			environmentId,
			message: `Treeseed update ${keys.length} Railway variable${keys.length === 1 ? '' : 's'}`,
			skipDeploys: true,
		});
	};
	await applyVariablePatch(Object.keys(variables));
	const expectedKeys = Object.keys(variables);
	const mismatchedKeys = (observed: Record<string, string | null | undefined>) =>
		expectedKeys.filter((key) => observed[key] !== variables[key]);
	const observed = await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}));
	const missingOrMismatched = mismatchedKeys(observed);
	if (missingOrMismatched.length > 0) await applyVariablePatch(missingOrMismatched);
	let retried = missingOrMismatched.length > 0
		? await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}))
		: observed;
	let stillMismatched = mismatchedKeys(retried);
	for (let attempt = 0; stillMismatched.length > 0 && attempt < 12; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, 2_500));
		retried = await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}));
		stillMismatched = mismatchedKeys(retried);
		if (stillMismatched.length > 0 && attempt === 5) {
			await applyVariablePatch(stillMismatched);
		}
	}
	if (stillMismatched.length > 0) {
		throw new Error(`Railway variable upsert did not persist expected values: ${stillMismatched.join(', ')}.`);
	}
}

export async function listRailwayVolumes({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const query = configuredEnvValue(env, 'TREESEED_RAILWAY_VOLUME_LIST_QUERY') || `
query TreeseedRailwayVolumeList($projectId: String!) {
	project(id: $projectId) {
		id
		volumes {
			edges {
				node {
					id
					name
					projectId
					volumeInstances {
						edges {
							node {
								id
								serviceId
								environmentId
								mountPath
								state
								isPendingDeletion
								deletedAt
							}
						}
					}
				}
			}
		}
	}
}
`.trim();
	const payload = await railwayGraphqlRequest({
		query,
		variables: { projectId },
		env,
		fetchImpl,
	});
	return collectRailwayVolumes(payload.data);
}

export async function ensureRailwayServiceVolume({
	projectId,
	environmentId,
	serviceId,
	name,
	mountPath,
	adoptVolumeId,
	env = process.env,
	fetchImpl = fetch,
	settleAttempts = 24,
	settleDelayMs = 5_000,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	name: string;
	mountPath: string;
	adoptVolumeId?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	settleAttempts?: number;
	settleDelayMs?: number;
}) {
	if (!mountPath.startsWith('/')) {
		throw new Error(`Railway volume mount path must be absolute: ${mountPath}`);
	}
	{
		const observed = await listRailwayVolumes({ projectId, env, fetchImpl });
		const exact = observed.find((candidate) =>
			candidate.name === name
			&& candidate.instances.some((instance) =>
				instance.serviceId === serviceId
				&& instance.environmentId === environmentId
				&& instance.mountPath === mountPath
				&& isActiveRailwayVolumeInstance(instance),
			),
		) ?? null;
		if (exact) {
			return {
				volume: exact,
				instance: exact.instances.find((instance) => instance.serviceId === serviceId && instance.environmentId === environmentId) ?? null,
				created: false,
				updated: false,
			};
		}
		const requestedAdoption = railwayConnectionLabel(adoptVolumeId);
		const adoptable = requestedAdoption
			? observed.find((candidate) => candidate.id === requestedAdoption) ?? null
			: observed.find((candidate) => candidate.name === name)
				?? findRailwayVolumeForService(observed, serviceId, environmentId)
				?? null;
		if (requestedAdoption && !adoptable) {
			throw new Error(`Railway volume ${requestedAdoption} cannot be adopted because it was not found; refusing to create an empty replacement volume.`);
		}
		const volumeKey = adoptable?.id ?? name;
		const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
		await client.stageEnvironmentChanges({
			environmentId,
			merge: true,
			patch: {
				volumes: { [volumeKey]: adoptable ? { isDeleted: false } : { isCreated: true } },
				services: { [serviceId]: { volumeMounts: { [volumeKey]: { mountPath } } } },
			},
		});
		await client.commitStagedPatch({
			environmentId,
			message: `Treeseed reconcile volume ${name}`,
			skipDeploys: true,
		});
		for (let attempt = 0; attempt <= settleAttempts; attempt += 1) {
			if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
			const refreshed = await listRailwayVolumes({ projectId, env, fetchImpl });
			const volume = refreshed.find((candidate) => candidate.id === adoptable?.id || candidate.name === name) ?? null;
			const instance = volume?.instances.find((entry) =>
				entry.serviceId === serviceId
				&& entry.environmentId === environmentId
				&& entry.mountPath === mountPath
				&& isActiveRailwayVolumeInstance(entry),
			) ?? null;
			if (volume && instance) return { volume, instance, created: !adoptable, updated: Boolean(adoptable) };
		}
		throw new Error(`Railway SDK volume reconciliation did not observe ${name} mounted on service ${serviceId} at ${mountPath}.`);
	}
}

function findRailwayVolumeForService(volumes: RailwayVolumeSummary[], serviceId: string, environmentId?: string) {
	return volumes.find((candidate) =>
		candidate.instances.some((instance) =>
			instance.serviceId === serviceId
			&& (!environmentId || instance.environmentId === environmentId)
			&& isActiveRailwayVolumeInstance(instance)
		),
	) ?? null;
}

export async function listRailwayCustomDomains({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		domains?: {
			customDomains?: Array<Record<string, unknown> | null> | null;
		} | null;
	}>({
		query: `
query TreeseedRailwayCustomDomains($projectId: String!, $environmentId: String!, $serviceId: String!) {
	domains(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId) {
		customDomains {
			id
			domain
			environmentId
			serviceId
			targetPort
			status {
				verified
				certificateStatus
				verificationDnsHost
				verificationToken
				dnsRecords {
					fqdn
					hostlabel
					recordType
					requiredValue
					currentValue
					status
					zone
					purpose
				}
			}
		}
	}
}
`.trim(),
		variables: {
			projectId,
			environmentId,
			serviceId,
		},
		env,
		fetchImpl,
	});
	return Array.isArray(payload.data?.domains?.customDomains)
		? payload.data.domains.customDomains
			.map((entry) => entry && typeof entry === 'object' ? normalizeRailwayCustomDomain(entry as Record<string, unknown>) : null)
			.filter(Boolean) as RailwayCustomDomainSummary[]
		: [];
}

export async function ensureRailwayCustomDomain({
	projectId,
	environmentId,
	serviceId,
	domain,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	domain: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const normalizedDomain = railwayConnectionLabel(domain);
	if (!normalizedDomain) {
		throw new Error('Railway custom domain creation requires a domain.');
	}
	const existing = await listRailwayCustomDomains({ projectId, environmentId, serviceId, env, fetchImpl });
	const matched = existing.find((entry) => entry.domain === normalizedDomain) ?? null;
	if (matched) {
		return { domain: matched, created: false };
	}
	await runRailwayCliJson({
		args: ['domain', normalizedDomain, '--project', projectId, '--environment', environmentId, '--service', serviceId, '--json'],
		env,
	});
	const created = (await listRailwayCustomDomains({ projectId, environmentId, serviceId, env, fetchImpl }))
		.find((entry) => entry.domain === normalizedDomain) ?? null;
	if (!created) {
		throw new Error(`Railway custom domain create did not return a usable domain for ${normalizedDomain}.`);
	}
	return { domain: created, created: true };
}

function looksLikeRailwayMissingResource(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /not found|does not exist|could not find|unknown|invalid .*id/iu.test(message);
}

function looksLikeRailwayOperationInProgress(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /operation is already in progress/iu.test(message);
}

async function railwayDeleteMutation({
	query,
	variables,
	env,
	fetchImpl,
	missingResult,
}: {
	query: string;
	variables: Record<string, unknown>;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	missingResult: Record<string, unknown>;
}) {
	let lastError: unknown = null;
	for (let attempt = 0; attempt < 6; attempt += 1) {
		try {
			const payload = await railwayGraphqlRequest<Record<string, unknown>>({
				query,
				variables,
				env,
				fetchImpl,
			});
			const mutationResult = Object.values(payload.data ?? {})[0];
			if (mutationResult === false || mutationResult == null) {
				throw new Error('Railway delete mutation returned no successful deletion result.');
			}
			return { status: 'deleted' };
		} catch (error) {
			if (looksLikeRailwayMissingResource(error)) {
				return missingResult;
			}
			if (!looksLikeRailwayOperationInProgress(error) || attempt >= 5) {
				throw error;
			}
			lastError = error;
			await new Promise((resolve) => setTimeout(resolve, 2500 * (attempt + 1)));
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'Railway delete mutation did not complete.'));
}

export async function deleteRailwayCustomDomain({
	projectId,
	environmentId,
	serviceId,
	domainId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId?: string | null;
	serviceId?: string | null;
	domainId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(domainId)) {
		return { status: 'missing', id: domainId };
	}
	void fetchImpl;
	if (!projectId || !environmentId || !serviceId) throw new Error(`Railway CLI domain deletion requires project, environment, and service ids for ${domainId}.`);
	await runRailwayCliJson({ args: ['domain', 'delete', domainId, '--project', projectId, '--environment', environmentId, '--service', serviceId, '--yes', '--json'], env });
	return { status: 'deleted' };
}

export async function deleteRailwayService({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId?: string | null;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(serviceId)) {
		return { status: 'missing', id: serviceId };
	}
	void fetchImpl;
	if (!projectId || !environmentId) throw new Error(`Railway CLI service deletion requires project and environment ids for ${serviceId}.`);
	await runRailwayCliJson({ args: ['service', 'delete', '--project', projectId, '--environment', environmentId, '--service', serviceId, '--yes', '--json'], env });
	return { status: 'deleted' };
}

export async function deleteRailwayVolume({
	projectId,
	environmentId,
	volumeId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId?: string | null;
	volumeId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(volumeId)) {
		return { status: 'missing', id: volumeId };
	}
	void fetchImpl;
	if (!projectId || !environmentId) throw new Error(`Railway CLI volume deletion requires project and environment ids for ${volumeId}.`);
	await runRailwayCliJson({ args: ['volume', '--project', projectId, '--environment', environmentId, 'delete', '--volume', volumeId, '--yes', '--json'], env });
	return { status: 'deleted' };
}

function looksLikeRailwayVolumeDeleteShapeUnsupported(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /Unknown argument|Cannot query field|Unknown field|Field .* is not defined|volumeDelete.*argument|Problem processing request/iu.test(message);
}

export async function deleteRailwayEnvironment({
	projectId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId?: string | null;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(environmentId)) {
		return { status: 'missing', id: environmentId };
	}
	void fetchImpl;
	if (!projectId) throw new Error(`Railway CLI environment deletion requires a project id for ${environmentId}.`);
	const tempRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-railway-environment-delete-'));
	try {
		await runRailwayCliJson({ args: ['link', projectId, '--json'], env, cwd: tempRoot });
		await runRailwayCliJson({ args: ['environment', 'delete', environmentId, '--yes', '--json'], env, cwd: tempRoot });
	} finally {
		rmSync(tempRoot, { recursive: true, force: true });
	}
	return { status: 'deleted' };
}

export async function deleteRailwayProject({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(projectId)) {
		return { status: 'missing', id: projectId };
	}
	void fetchImpl;
	await runRailwayCliJson({ args: ['project', 'delete', '--project', projectId, '--yes', '--json'], env });
	return { status: 'deleted' };
}
