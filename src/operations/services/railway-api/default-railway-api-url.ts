import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../../service-credentials.ts';


export const DEFAULT_RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

export const DEFAULT_RAILWAY_WORKSPACE = 'knowledge-coop';

export let railwayReadActive = false;

export const railwayReadWaiters: Array<() => void> = [];

export let railwayReadCooldownUntil = 0;

export async function acquireRailwayReadSlot() {
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

export function extendRailwayReadCooldown(delayMs: number) {
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

export type RailwayTemplateSummary = {
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

export type RailwayEnvironmentPatchClient = Pick<IacClient, 'stageEnvironmentChanges' | 'commitStagedPatch'>;

export function createRailwayEnvironmentPatchClient({
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

export function configuredEnvValue(env: NodeJS.ProcessEnv | Record<string, string | undefined> | undefined, name: string) {
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

export function normalizeRailwayErrorMessage(payload: unknown, fallbackStatus?: number) {
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

export function isRetryableRailwayStatus(status: number) {
	return status === 408 || status === 429 || status >= 500;
}

export function parseRetryAfterMs(value: string | null) {
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

export function markRailwayTransientError(error: Error, options: { retryAfterMs?: number | null; rateLimited?: boolean } = {}) {
	const tagged = error as Error & { treeseedTransient?: boolean; treeseedRetryAfterMs?: number; treeseedRateLimited?: boolean };
	tagged.treeseedTransient = true;
	if (options.rateLimited) tagged.treeseedRateLimited = true;
	if (typeof options.retryAfterMs === 'number' && Number.isFinite(options.retryAfterMs) && options.retryAfterMs >= 0) {
		tagged.treeseedRetryAfterMs = options.retryAfterMs;
	}
	return tagged;
}

export function isTransientRailwayRequestError(error: unknown) {
	if (error && typeof error === 'object' && (error as { treeseedTransient?: boolean }).treeseedTransient === true) {
		return true;
	}
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|rate limit|too many requests|429/iu.test(message);
}

export function railwayConnectionLabel(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function normalizeConnectionNodes<T>(connection: unknown, mapper: (node: Record<string, unknown>) => T | null) {
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
