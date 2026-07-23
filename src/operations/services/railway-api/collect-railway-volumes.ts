import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../../service-credentials.ts';
import { RailwayVolumeSummary, RailwayWorkspaceSummary, acquireRailwayReadSlot, extendRailwayReadCooldown, isRetryableRailwayStatus, isTransientRailwayRequestError, markRailwayTransientError, normalizeRailwayErrorMessage, parseRetryAfterMs, railwayConnectionLabel, resolveRailwayApiToken, resolveRailwayApiUrl, resolveRailwayWorkspace } from './default-railway-api-url.ts';
import { mergeRailwayVolumeInstances, normalizeRailwayVolume, normalizeWorkspace } from './normalize-workspace.ts';

export function collectRailwayVolumes(value: unknown, seen = new Set<object>()): RailwayVolumeSummary[] {
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

export function railwayApiTimeoutMs(env: NodeJS.ProcessEnv | Record<string, string | undefined>, explicitTimeoutMs?: number) {
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
