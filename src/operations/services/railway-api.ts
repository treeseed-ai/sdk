import { request as httpsRequest } from 'node:https';

const DEFAULT_RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';
const DEFAULT_RAILWAY_WORKSPACE = 'knowledge-coop';

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
	sizeGb: number | null;
	usedGb: number | null;
};

export type RailwayVolumeSummary = {
	id: string;
	name: string;
	projectId: string | null;
	instances: RailwayVolumeInstanceSummary[];
};

function configuredEnvValue(env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined, name: string) {
	const value = env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function isUsableRailwayToken(value: string | undefined | null) {
	return typeof value === 'string' && value.trim().length >= 8;
}

export function resolveRailwayApiToken(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
	const token = configuredEnvValue(env, 'RAILWAY_API_TOKEN');
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

function markRailwayTransientError(error: Error, options: { retryAfterMs?: number | null } = {}) {
	const tagged = error as Error & { treeseedTransient?: boolean; treeseedRetryAfterMs?: number };
	tagged.treeseedTransient = true;
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
	return {
		id,
		name,
		workspaceId: railwayConnectionLabel(node.workspaceId) || null,
		deletedAt: railwayConnectionLabel(node.deletedAt) || null,
		environments: normalizeConnectionNodes(node.environments, normalizeEnvironment),
		services: normalizeConnectionNodes(node.services, normalizeService),
	};
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
		sizeGb,
		usedGb,
	};
}

function isActiveRailwayVolumeInstance(instance: RailwayVolumeInstanceSummary) {
	const state = String(instance.state ?? 'READY').toUpperCase();
	return state !== 'DELETING' && state !== 'DELETED';
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

function normalizeRailwayVolume(node: Record<string, unknown>): RailwayVolumeSummary | null {
	const id = railwayConnectionLabel(node.id);
	if (!id) {
		return null;
	}
	return {
		id,
		name: railwayConnectionLabel(node.name),
		projectId: railwayConnectionLabel(node.projectId) || null,
		instances: [
			...normalizeVolumeInstances(node.instances),
			...normalizeVolumeInstances(node.volumeInstances),
			...normalizeVolumeInstances(node.volume_instances),
		],
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
				instances: [...existing.instances, ...volume.instances],
			}
			: volume);
	}
	return [...byId.values()];
}

export async function railwayGraphqlRequest<TData = unknown>({
	query,
	variables,
	env = process.env,
	apiToken,
	apiUrl,
	fetchImpl = fetch,
	timeoutMs = 30_000,
	retries = 8,
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
	const token = apiToken || resolveRailwayApiToken(env);
	if (!token) {
		throw new Error('Configure RAILWAY_API_TOKEN before invoking Railway APIs.');
	}
	let attempt = 0;
	for (;;) {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | null = null;
		try {
			const response = fetchImpl === fetch
				? await railwayGraphqlHttpsRequest(apiUrl || resolveRailwayApiUrl(env), token, { query, variables }, timeoutMs)
				: await Promise.race([
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
							reject(markRailwayTransientError(new Error(`Railway API request timed out after ${timeoutMs}ms.`)));
						}, timeoutMs);
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
					throw markRailwayTransientError(error, { retryAfterMs });
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
			const backoffMs = retryAfterMs ?? Math.min(500 * (2 ** (attempt - 1)), 4000);
			await new Promise((resolve) => setTimeout(resolve, backoffMs));
		} finally {
			if (timer) {
				clearTimeout(timer);
			}
		}
	}
}

async function railwayGraphqlHttpsRequest(
	url: string,
	token: string,
	body: unknown,
	timeoutMs: number,
): Promise<{ ok: boolean; status: number; payload: unknown; retryAfter: string | null }> {
	const rawBody = JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = httpsRequest(url, {
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				'content-type': 'application/json',
				'content-length': Buffer.byteLength(rawBody),
			},
			timeout: timeoutMs,
		}, (res) => {
			const chunks: string[] = [];
			res.setEncoding('utf8');
			res.on('data', (chunk) => chunks.push(chunk));
			res.on('end', () => {
				const text = chunks.join('');
				let payload: unknown = {};
				try {
					payload = text ? JSON.parse(text) : {};
				} catch {
					payload = {};
				}
				const status = res.statusCode ?? 0;
				const retryAfterHeader = res.headers['retry-after'];
				resolve({
					ok: status >= 200 && status < 300,
					status,
					payload,
					retryAfter: Array.isArray(retryAfterHeader) ? retryAfterHeader[0] ?? null : retryAfterHeader ?? null,
				});
			});
		});
		req.on('timeout', () => {
			req.destroy(markRailwayTransientError(new Error(`Railway API request timed out after ${timeoutMs}ms.`)));
		});
		req.on('error', reject);
		req.write(rawBody);
		req.end();
	});
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
	const created = await railwayGraphqlRequest<{
		projectCreate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayProjectCreate($input: ProjectCreateInput!) {
	projectCreate(input: $input) {
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
		variables: {
			input: {
				name: desiredProjectName,
				workspaceId: workspaceContext.id,
				defaultEnvironmentName,
			},
		},
		env,
		fetchImpl,
	});
	const project = created.data?.projectCreate ? normalizeProject(created.data.projectCreate) : null;
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
	const created = await railwayGraphqlRequest<{
		environmentCreate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayEnvironmentCreate($input: EnvironmentCreateInput!) {
	environmentCreate(input: $input) {
		id
		name
	}
}
`.trim(),
		variables: {
			input: {
				projectId,
				name: environmentName,
				skipInitialDeploys: true,
			},
		},
		env,
		fetchImpl,
	});
	const environment = created.data?.environmentCreate ? normalizeEnvironment(created.data.environmentCreate) : null;
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

export async function ensureRailwayService({
	projectId,
	serviceName,
	serviceId,
	environmentId,
	imageRef,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	serviceName?: string | null;
	serviceId?: string | null;
	environmentId?: string | null;
	imageRef?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const services = await listRailwayServices({ projectId, env, fetchImpl });
	const desiredServiceName = railwayConnectionLabel(serviceName);
	const desiredServiceId = railwayConnectionLabel(serviceId);
	const existing = services.find((service) =>
		(desiredServiceId && service.id === desiredServiceId)
		|| (desiredServiceName && service.name === desiredServiceName),
	) ?? null;
	if (existing) {
		const desiredImageRef = railwayConnectionLabel(imageRef);
		if (desiredImageRef) {
			try {
				await updateRailwayServiceImageSource({
					serviceId: existing.id,
					imageRef: desiredImageRef,
					env,
					fetchImpl,
				});
			} catch (error) {
				if (!looksLikeRailwayImageSourceUpdateUnsupported(error)) {
					throw error;
				}
				await deleteRailwayService({ serviceId: existing.id, env, fetchImpl });
				await waitForRailwayServiceMissing({ projectId, serviceId: existing.id, env, fetchImpl });
				const replacement = await createRailwayImageService({
					projectId,
					environmentId,
					serviceName: desiredServiceName || existing.name,
					imageRef: desiredImageRef,
					env,
					fetchImpl,
				});
				return { service: replacement, created: true, replaced: true };
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
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	serviceName: string;
	environmentId?: string | null;
	imageRef?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const created = await railwayGraphqlRequest<{
		serviceCreate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayServiceCreate($input: ServiceCreateInput!) {
	serviceCreate(input: $input) {
		id
		name
	}
}
`.trim(),
			variables: {
				input: {
					projectId,
					name: serviceName,
				...(railwayConnectionLabel(environmentId) ? { environmentId: railwayConnectionLabel(environmentId) } : {}),
				...(railwayConnectionLabel(imageRef)
					? {
						source: {
							image: railwayConnectionLabel(imageRef),
						},
					}
					: {}),
			},
		},
		env,
		fetchImpl,
	});
	const service = created.data?.serviceCreate ? normalizeService(created.data.serviceCreate) : null;
	if (!service) {
		throw new Error(`Railway service create did not return a usable service for ${serviceName}.`);
	}
	return service;
}

async function waitForRailwayServiceMissing({
	projectId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
	attempts = 20,
	delayMs = 1500,
}: {
	projectId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	attempts?: number;
	delayMs?: number;
}) {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const services = await listRailwayServices({ projectId, env, fetchImpl }).catch(() => []);
		if (!services.some((service) => service.id === serviceId)) {
			return true;
		}
		await new Promise((resolve) => setTimeout(resolve, delayMs));
	}
	throw new Error(`Railway service ${serviceId} was not deleted before image source replacement.`);
}

function looksLikeRailwayImageSourceUpdateUnsupported(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /Problem processing request|source|image|ServiceUpdateInput/iu.test(message);
}

export async function updateRailwayServiceImageSource({
	serviceId,
	imageRef,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	imageRef: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const desiredImage = railwayConnectionLabel(imageRef);
	if (!serviceId || !desiredImage) {
		throw new Error('Railway service image source update requires a service id and image reference.');
	}
	const payload = await railwayGraphqlRequest<{
		serviceUpdate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayServiceImageSourceUpdate($id: String!, $input: ServiceUpdateInput!) {
	serviceUpdate(id: $id, input: $input) {
		id
		name
	}
}
`.trim(),
		variables: {
			id: serviceId,
			input: {
				source: {
					image: desiredImage,
				},
			},
		},
		env,
		fetchImpl,
	});
	const service = payload.data?.serviceUpdate ? normalizeService(payload.data.serviceUpdate) : null;
	if (!service) {
		throw new Error(`Railway service image source update did not return a usable service for ${serviceId}.`);
	}
	return service;
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
	const query = `
mutation TreeseedRailwayServiceDomainCreate($input: ServiceDomainCreateInput!) {
	serviceDomainCreate(input: $input) {
		id
		domain
		serviceId
		environmentId
		targetPort
	}
}
`.trim();
	const inputWithProject = {
		projectId,
		environmentId,
		serviceId,
		...(Number.isFinite(Number(targetPort)) ? { targetPort: Number(targetPort) } : {}),
	};
	const createPayload = async (input: Record<string, unknown>) => railwayGraphqlRequest<{
		serviceDomainCreate?: Record<string, unknown> | null;
	}>({
		query,
		variables: {
			input: {
				...input,
			},
		},
		env,
		fetchImpl,
	});
	let payload;
	try {
		payload = await createPayload(inputWithProject);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (!/Problem processing request|projectId|not defined by type/iu.test(message)) {
			throw error;
		}
		payload = await createPayload({
			environmentId,
			serviceId,
			...(Number.isFinite(Number(targetPort)) ? { targetPort: Number(targetPort) } : {}),
		});
	}
	const domain = normalizeRailwayDomain(payload.data?.serviceDomainCreate);
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
		serviceInstanceDeployV2?: string | Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayServiceInstanceDeploy($serviceId: String!, $environmentId: String!) {
	serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
}
`.trim(),
		variables: { serviceId, environmentId },
		env,
		fetchImpl,
	});
	const value = payload.data?.serviceInstanceDeployV2;
	if (typeof value === 'string' && value.trim()) {
		return { deploymentId: value.trim() };
	}
	if (value && typeof value === 'object') {
		return { deploymentId: railwayConnectionLabel((value as Record<string, unknown>).id) || null };
	}
	return { deploymentId: null };
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
	const payload = await railwayGraphqlRequest<{
		serviceUpdate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayServiceUpdate($id: String!, $input: ServiceUpdateInput!) {
	serviceUpdate(id: $id, input: $input) {
		id
		name
	}
}
`.trim(),
		variables: {
			id: serviceId,
			input: { name: desiredName },
		},
		env,
		fetchImpl,
	});
	const service = payload.data?.serviceUpdate ? normalizeService(payload.data.serviceUpdate) : null;
	if (!service) {
		throw new Error(`Railway service rename did not return a usable service for ${desiredName}.`);
	}
	return service;
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
		await deleteRailwayService({ serviceId: existing.id, env, fetchImpl });
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
	const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
	const payload = await railwayGraphqlRequest<{
		templateDeployV2?: { projectId?: string | null; workflowId?: string | null } | null;
	}>({
		query: `
mutation TreeseedRailwayTemplateDeploy($input: TemplateDeployV2Input!) {
	templateDeployV2(input: $input) {
		projectId
		workflowId
	}
}
`.trim(),
		variables: {
			input: {
				templateId,
				serializedConfig,
				projectId,
				environmentId,
				workspaceId: workspace.id,
			},
		},
		env,
		fetchImpl,
		timeoutMs: 20_000,
		retries: 1,
	});
	if (!payload.data?.templateDeployV2?.projectId) {
		throw new Error('Railway Postgres template deployment did not return a project id.');
	}
	return payload.data.templateDeployV2;
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
	startCommand,
	cronSchedule,
	rootDirectory,
	healthcheckPath,
	healthcheckTimeoutSeconds,
	healthcheckIntervalSeconds,
	restartPolicy,
	runtimeMode,
	deploymentRegion,
	env = process.env,
	fetchImpl = fetch,
	settleAttempts = 60,
	settleDelayMs = 5_000,
}: {
	serviceId: string;
	environmentId: string;
	buildCommand?: string | null;
	startCommand?: string | null;
	cronSchedule?: string | null;
	rootDirectory?: string | null;
	healthcheckPath?: string | null;
	healthcheckTimeoutSeconds?: number | null;
	healthcheckIntervalSeconds?: number | null;
	restartPolicy?: string | null;
	runtimeMode?: string | null;
	deploymentRegion?: string | null;
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
		(desired.buildCommand !== null && desired.buildCommand !== current.buildCommand)
		|| (desired.startCommand !== null && desired.startCommand !== current.startCommand)
		|| (desired.cronSchedule !== null && desired.cronSchedule !== current.cronSchedule)
		|| (desired.rootDirectory !== null && desired.rootDirectory !== current.rootDirectory)
		|| (desired.healthcheckPath !== null && desired.healthcheckPath !== current.healthcheckPath)
		|| (desired.healthcheckTimeoutSeconds !== null && desired.healthcheckTimeoutSeconds !== current.healthcheckTimeoutSeconds)
		|| (desired.runtimeMode !== null && desired.runtimeMode !== current.runtimeMode)
		|| desired.deploymentRegion !== null
	);
	if (!drifted) {
		return { instance: current, updated: false };
	}
	const mutationQuery = needsRuntimeConfig
		? `
mutation TreeseedRailwayServiceInstanceUpdate($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
	serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}
`.trim()
		: `
mutation TreeseedRailwayServiceInstanceUpdateLegacy($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
	serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: $input)
}
`.trim();
	try {
		await railwayGraphqlRequest<{
			serviceInstanceUpdate?: boolean | null;
		}>({
			query: mutationQuery,
			variables: {
				serviceId,
				environmentId,
				input: {
					...(desired.buildCommand !== null ? { buildCommand: desired.buildCommand } : {}),
					...(desired.startCommand !== null ? { startCommand: desired.startCommand } : {}),
					...(desired.cronSchedule !== null ? { cronSchedule: desired.cronSchedule } : {}),
					...(desired.rootDirectory !== null ? { rootDirectory: desired.rootDirectory } : {}),
					...(desired.healthcheckPath !== null ? { healthcheckPath: desired.healthcheckPath } : {}),
					...(desired.healthcheckTimeoutSeconds !== null ? { healthcheckTimeout: desired.healthcheckTimeoutSeconds } : {}),
					...(desired.sleepApplication !== null ? { sleepApplication: desired.sleepApplication } : {}),
					...(desired.deploymentRegion !== null ? {
						multiRegionConfig: {
							[desired.deploymentRegion]: { numReplicas: 1 },
						},
					} : {}),
				},
			},
			env,
			fetchImpl,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (needsRuntimeConfig && /Field .* is not defined by type .*ServiceInstanceUpdateInput|Unknown argument|Cannot query field/iu.test(message)) {
			throw new Error('Railway service instance runtime settings are unsupported by the current Railway API schema.');
		}
		throw error;
	}
	let instance = current;
	for (let attempt = 0; attempt <= settleAttempts; attempt += 1) {
		instance = await getRailwayServiceInstance({
			serviceId,
			environmentId,
			env,
			fetchImpl,
		});
		if (!serviceInstanceDrifted(instance, desired) || attempt >= settleAttempts) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
	}
	return {
		instance: {
			id: instance.id || current.id,
			buildCommand: instance.buildCommand,
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
		startCommand: string | null;
		cronSchedule: string | null;
		rootDirectory: string | null;
		healthcheckPath: string | null;
		healthcheckTimeoutSeconds: number | null;
		runtimeMode: string | null;
	},
) {
	return (
		(desired.buildCommand !== null && desired.buildCommand !== current.buildCommand)
		|| (desired.startCommand !== null && desired.startCommand !== current.startCommand)
		|| (desired.cronSchedule !== null && desired.cronSchedule !== current.cronSchedule)
		|| (desired.rootDirectory !== null && desired.rootDirectory !== current.rootDirectory)
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
	const query = `
mutation TreeseedRailwayVariableCollectionUpsert($input: VariableCollectionUpsertInput!) {
	variableCollectionUpsert(input: $input)
}
`.trim();
	const input = {
		projectId,
		environmentId,
		serviceId: serviceId || null,
		variables,
		replace: false,
		skipDeploys: true,
	};
	try {
		await railwayGraphqlRequest({
			query,
			variables: { input },
			env,
			fetchImpl,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (!/Problem processing request/iu.test(message) || Object.keys(variables).length <= 1) {
			throw error;
		}
		for (const [key, value] of Object.entries(variables)) {
			await railwayGraphqlRequest({
				query,
				variables: {
					input: {
						projectId,
						environmentId,
						serviceId: serviceId || null,
						variables: { [key]: value },
						replace: false,
						skipDeploys: true,
					},
				},
				env,
				fetchImpl,
			});
		}
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

async function createRailwayVolume({
	projectId,
	environmentId,
	serviceId,
	name,
	mountPath,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	name: string;
	mountPath: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const mutation = configuredEnvValue(env, 'TREESEED_RAILWAY_VOLUME_CREATE_MUTATION') || `
mutation TreeseedRailwayVolumeCreate($input: VolumeCreateInput!) {
	volumeCreate(input: $input) {
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
				}
			}
		}
	}
}
`.trim();
	const payload = await railwayGraphqlRequest({
		query: mutation,
		variables: {
			input: {
				projectId,
				environmentId,
				serviceId,
				mountPath,
			},
		},
		env,
		fetchImpl,
	});
	const volume = collectRailwayVolumes(payload.data)[0] ?? null;
	if (!volume) {
		throw new Error(`Railway volume create did not return a usable volume for ${name}.`);
	}
	if (name && volume.name !== name) {
		try {
			const renamed = await updateRailwayVolumeName({
				volumeId: volume.id,
				name,
				env,
				fetchImpl,
			});
			return {
				...volume,
				name: renamed.name || name,
			};
		} catch {
			return {
				...volume,
				name: volume.name || name,
			};
		}
	}
	return volume;
}

async function updateRailwayVolumeName({
	volumeId,
	name,
	env = process.env,
	fetchImpl = fetch,
}: {
	volumeId: string;
	name: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const mutation = configuredEnvValue(env, 'TREESEED_RAILWAY_VOLUME_UPDATE_MUTATION') || `
mutation TreeseedRailwayVolumeUpdate($volumeId: String!, $input: VolumeUpdateInput!) {
	volumeUpdate(volumeId: $volumeId, input: $input) {
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
				}
			}
		}
	}
}
`.trim();
	const payload = await railwayGraphqlRequest({
		query: mutation,
		variables: {
			volumeId,
			input: { name },
		},
		env,
		fetchImpl,
	});
	return collectRailwayVolumes(payload.data)[0] ?? null;
}

async function updateRailwayVolumeInstanceMountPath({
	volumeId,
	serviceId,
	mountPath,
	env = process.env,
	fetchImpl = fetch,
}: {
	volumeId: string;
	serviceId?: string | null;
	mountPath: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const mutation = configuredEnvValue(env, 'TREESEED_RAILWAY_VOLUME_INSTANCE_UPDATE_MUTATION') || `
mutation TreeseedRailwayVolumeInstanceUpdate($volumeId: String!, $input: VolumeInstanceUpdateInput!) {
	volumeInstanceUpdate(volumeId: $volumeId, input: $input)
}
`.trim();
	await railwayGraphqlRequest({
		query: mutation,
		variables: {
			volumeId,
			input: {
				...(serviceId ? { serviceId } : {}),
				mountPath,
			},
		},
		env,
		fetchImpl,
	});
}

export async function ensureRailwayServiceVolume({
	projectId,
	environmentId,
	serviceId,
	name,
	mountPath,
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
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	settleAttempts?: number;
	settleDelayMs?: number;
}) {
	if (!mountPath.startsWith('/')) {
		throw new Error(`Railway volume mount path must be absolute: ${mountPath}`);
	}
	const volumes = await listRailwayVolumes({ projectId, env, fetchImpl });
	const activeVolumes = volumes
		.map((candidate) => ({
			...candidate,
			instances: candidate.instances.filter(isActiveRailwayVolumeInstance),
		}))
		.filter((candidate) => candidate.instances.length > 0);
	const exactVolume = activeVolumes.find((candidate) =>
		candidate.name === name
		&& candidate.instances.some((instance) =>
			instance.serviceId === serviceId
			&& instance.environmentId === environmentId
			&& instance.mountPath === mountPath,
		),
	) ?? null;
	if (exactVolume) {
		return {
			volume: exactVolume,
			instance: exactVolume.instances.find((instance) =>
				instance.serviceId === serviceId
				&& instance.environmentId === environmentId
				&& instance.mountPath === mountPath,
			) ?? null,
			created: false,
			updated: false,
		};
	}
	let volume = findRailwayVolumeForService(volumes, serviceId, environmentId)
		?? findRailwayVolumeForService(volumes, serviceId)
		?? activeVolumes.find((candidate) =>
		candidate.name === name
		&& candidate.instances.some((instance) => instance.environmentId === environmentId),
	) ?? null;
	let created = false;
	let updated = false;
	const createReplacementVolume = async () => {
		let replacement: Awaited<ReturnType<typeof createRailwayVolume>>;
		try {
			replacement = await createRailwayVolume({
				projectId,
				environmentId,
				serviceId,
				name,
				mountPath,
				env,
				fetchImpl,
			});
		} catch (error) {
			if (!looksLikeRailwayVolumeCreateRace(error)) {
				throw error;
			}
			for (let attempt = 0; attempt < 8; attempt += 1) {
				await new Promise((resolve) => setTimeout(resolve, 1500));
				const refreshed = await listRailwayVolumes({ projectId, env, fetchImpl });
				const existing = findRailwayVolumeForService(refreshed, serviceId, environmentId)
					?? findRailwayVolumeForService(refreshed, serviceId)
					?? findSoleActiveRailwayVolumeForEnvironment(refreshed, environmentId);
				if (existing) {
					return existing;
				}
			}
			throw error;
		}
		created = true;
		return replacement;
	};
	if (!volume) {
		volume = await createReplacementVolume();
	}
	const desiredNameInUse = volumes.some((candidate) => candidate.id !== volume?.id && candidate.name === name);
	if (volume.name && volume.name !== name && !desiredNameInUse) {
		try {
			volume = await updateRailwayVolumeName({ volumeId: volume.id, name, env, fetchImpl }) ?? { ...volume, name };
		} catch (error) {
			if (!looksLikeRailwayMissingResource(error)) {
				throw error;
			}
			volume = await createReplacementVolume();
		}
		updated = true;
	}
	let instance = volume.instances.find((entry) => entry.serviceId === serviceId && entry.environmentId === environmentId) ?? null;
	if (!instance && volume.instances.some((entry) => entry.environmentId === environmentId)) {
		try {
			await updateRailwayVolumeInstanceMountPath({ volumeId: volume.id, serviceId, mountPath, env, fetchImpl });
			volume = await listRailwayVolumes({ projectId, env, fetchImpl })
				.then((refreshed) => refreshed.find((candidate) => candidate.id === volume?.id) ?? volume);
		} catch (error) {
			if (looksLikeRailwayVolumeCreateRace(error)) {
					volume = await listRailwayVolumes({ projectId, env, fetchImpl })
						.then((refreshed) =>
							findRailwayVolumeForService(refreshed, serviceId, environmentId)
						?? volume,
					);
			} else if (!looksLikeRailwayMissingResource(error)) {
				throw error;
			} else {
				volume = await createReplacementVolume();
			}
		}
		instance = volume.instances.find((entry) => entry.serviceId === serviceId && entry.environmentId === environmentId) ?? null;
		updated = true;
	}
	if (!instance) {
		try {
			await updateRailwayVolumeInstanceMountPath({ volumeId: volume.id, serviceId, mountPath, env, fetchImpl });
			volume = await listRailwayVolumes({ projectId, env, fetchImpl })
				.then((refreshed) => refreshed.find((candidate) => candidate.id === volume?.id) ?? volume);
		} catch (error) {
			if (looksLikeRailwayVolumeCreateRace(error)) {
					volume = await listRailwayVolumes({ projectId, env, fetchImpl })
						.then((refreshed) =>
							findRailwayVolumeForService(refreshed, serviceId, environmentId)
						?? volume,
					);
			} else if (!looksLikeRailwayMissingResource(error)) {
				throw error;
			} else {
				volume = await createReplacementVolume();
			}
		}
		instance = volume.instances.find((entry) => entry.serviceId === serviceId && entry.environmentId === environmentId) ?? null;
		updated = true;
	}
	if (instance && instance.mountPath !== mountPath) {
		try {
			await updateRailwayVolumeInstanceMountPath({ volumeId: volume.id, mountPath, env, fetchImpl });
			volume = {
				...volume,
				instances: volume.instances.map((entry) => entry.id === instance.id ? { ...entry, mountPath } : entry),
			};
		} catch (error) {
			if (!looksLikeRailwayMissingResource(error)) {
				throw error;
			}
			volume = await createReplacementVolume();
			instance = volume.instances.find((entry) => entry.serviceId === serviceId && entry.environmentId === environmentId) ?? null;
		}
		updated = true;
	}
	const settled = await waitForRailwayVolumeMount({
		projectId,
		volume,
		serviceId,
		environmentId,
		mountPath,
		env,
		fetchImpl,
		settleAttempts,
		settleDelayMs,
	});
	if (settled) {
		volume = settled.volume;
		instance = settled.instance;
	}
	if (!instance || instance.serviceId !== serviceId || instance.environmentId !== environmentId || instance.mountPath !== mountPath) {
		throw new Error(`Railway API volume reconciliation did not observe ${name} mounted on service ${serviceId} at ${mountPath}.`);
	}
	return { volume, instance, created, updated };
}

async function waitForRailwayVolumeMount({
	projectId,
	volume,
	serviceId,
	environmentId,
	mountPath,
	env,
	fetchImpl,
	settleAttempts,
	settleDelayMs,
}: {
	projectId: string;
	volume: RailwayVolumeSummary;
	serviceId: string;
	environmentId: string;
	mountPath: string;
	env: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl: typeof fetch;
	settleAttempts: number;
	settleDelayMs: number;
}) {
	const mountedInstance = (candidate: RailwayVolumeSummary) =>
		candidate.instances.find((entry) =>
			entry.serviceId === serviceId
			&& entry.environmentId === environmentId
			&& entry.mountPath === mountPath
			&& isActiveRailwayVolumeInstance(entry),
		) ?? null;
	let instance = mountedInstance(volume);
	if (instance) {
		return { volume, instance };
	}
	for (let attempt = 0; attempt < settleAttempts; attempt += 1) {
		await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
		const refreshed = await listRailwayVolumes({ projectId, env, fetchImpl });
		const refreshedVolume = refreshed.find((candidate) => candidate.id === volume.id)
			?? findRailwayVolumeForService(refreshed, serviceId, environmentId)
			?? null;
		if (!refreshedVolume) {
			continue;
		}
		instance = mountedInstance(refreshedVolume);
		if (instance) {
			return { volume: refreshedVolume, instance };
		}
	}
	return null;
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

function looksLikeRailwayVolumeCreateRace(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /already has a volume attached|would have \d+ volumes attached|can only have one volume|volume named .* already exists|already exists in this project|not authorized/iu.test(message);
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
	const payload = await railwayGraphqlRequest<{
		customDomainCreate?: Record<string, unknown> | null;
	}>({
		query: `
mutation TreeseedRailwayCustomDomainCreate($input: CustomDomainCreateInput!) {
	customDomainCreate(input: $input) {
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
`.trim(),
		variables: {
			input: {
				projectId,
				environmentId,
				serviceId,
				domain: normalizedDomain,
			},
		},
		env,
		fetchImpl,
	});
	const created = payload.data?.customDomainCreate
		? normalizeRailwayCustomDomain(payload.data.customDomainCreate)
		: null;
	if (!created) {
		throw new Error(`Railway custom domain create did not return a usable domain for ${normalizedDomain}.`);
	}
	return { domain: created, created: true };
}

function looksLikeRailwayMissingResource(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /not found|does not exist|could not find|unknown|invalid .*id/iu.test(message);
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
		throw error;
	}
}

export async function deleteRailwayCustomDomain({
	domainId,
	env = process.env,
	fetchImpl = fetch,
}: {
	domainId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(domainId)) {
		return { status: 'missing', id: domainId };
	}
	const mutation = configuredEnvValue(env, 'TREESEED_RAILWAY_CUSTOM_DOMAIN_DELETE_MUTATION') || `
mutation TreeseedRailwayCustomDomainDelete($id: String!) {
	customDomainDelete(id: $id)
}
`.trim();
	return railwayDeleteMutation({
		query: mutation,
		variables: { id: domainId },
		env,
		fetchImpl,
		missingResult: { status: 'missing', id: domainId },
	});
}

export async function deleteRailwayService({
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(serviceId)) {
		return { status: 'missing', id: serviceId };
	}
	const mutation = configuredEnvValue(env, 'TREESEED_RAILWAY_SERVICE_DELETE_MUTATION') || `
mutation TreeseedRailwayServiceDelete($id: String!) {
	serviceDelete(id: $id)
}
`.trim();
	return railwayDeleteMutation({
		query: mutation,
		variables: { id: serviceId },
		env,
		fetchImpl,
		missingResult: { status: 'missing', id: serviceId },
	});
}

export async function deleteRailwayVolume({
	volumeId,
	env = process.env,
	fetchImpl = fetch,
}: {
	volumeId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(volumeId)) {
		return { status: 'missing', id: volumeId };
	}
	const configuredMutation = configuredEnvValue(env, 'TREESEED_RAILWAY_VOLUME_DELETE_MUTATION');
	if (configuredMutation) {
		return railwayDeleteMutation({
			query: configuredMutation,
			variables: { volumeId, id: volumeId },
			env,
			fetchImpl,
			missingResult: { status: 'missing', id: volumeId },
		});
	}
	const primaryMutation = `
mutation TreeseedRailwayVolumeDelete($volumeId: String!) {
	volumeDelete(volumeId: $volumeId)
}
`.trim();
	const fallbackMutation = `
mutation TreeseedRailwayVolumeDeleteById($id: String!) {
	volumeDelete(volumeId: $id)
}
`.trim();
	const primary = await railwayDeleteMutation({
		query: primaryMutation,
		variables: { volumeId },
		env,
		fetchImpl,
		missingResult: { status: 'missing', id: volumeId },
	}).catch((error) => {
		if (looksLikeRailwayVolumeDeleteShapeUnsupported(error)) {
			return null;
		}
		throw error;
	});
	const fallback = await railwayDeleteMutation({
		query: fallbackMutation,
		variables: { id: volumeId },
		env,
		fetchImpl,
		missingResult: { status: 'missing', id: volumeId },
	}).catch((error) => {
		if (looksLikeRailwayVolumeDeleteShapeUnsupported(error) && primary) {
			return primary;
		}
		throw error;
	});
	return fallback ?? primary ?? { status: 'deleted' };
}

function looksLikeRailwayVolumeDeleteShapeUnsupported(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /Unknown argument|Cannot query field|Unknown field|Field .* is not defined|volumeDelete.*argument|Problem processing request/iu.test(message);
}

export async function deleteRailwayEnvironment({
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	if (!railwayConnectionLabel(environmentId)) {
		return { status: 'missing', id: environmentId };
	}
	const mutation = configuredEnvValue(env, 'TREESEED_RAILWAY_ENVIRONMENT_DELETE_MUTATION') || `
mutation TreeseedRailwayEnvironmentDelete($id: String!) {
	environmentDelete(id: $id)
}
`.trim();
	return railwayDeleteMutation({
		query: mutation,
		variables: { id: environmentId },
		env,
		fetchImpl,
		missingResult: { status: 'missing', id: environmentId },
	});
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
	const mutation = configuredEnvValue(env, 'TREESEED_RAILWAY_PROJECT_DELETE_MUTATION') || `
mutation TreeseedRailwayProjectDelete($id: String!) {
	projectDelete(id: $id)
}
`.trim();
	return railwayDeleteMutation({
		query: mutation,
		variables: { id: projectId },
		env,
		fetchImpl,
		missingResult: { status: 'missing', id: projectId },
	});
}
