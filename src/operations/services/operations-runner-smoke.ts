import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTreeseedDeployConfigFromPath } from '../../platform/deploy-config.ts';
import { resolveTreeseedMachineEnvironmentValues } from './config-runtime.ts';

export interface TreeseedOperationsRunnerSmokeReport {
	environment: 'staging' | 'prod';
	ok: boolean;
	baseUrl: string;
	operationId?: string;
	finalStatus?: string;
	runnerId?: string | null;
	timings: Array<{ phase: string; durationMs: number }>;
	events: Array<{ kind: string; createdAt: string }>;
	issues: string[];
	remediation?: string;
}

export interface TreeseedOperationsRunnerSmokeOptions {
	tenantRoot: string;
	environment: 'staging' | 'prod';
	baseUrl?: string | null;
	serviceId?: string | null;
	serviceSecret?: string | null;
	timeoutMs?: number;
	pollMs?: number;
	fetchImpl?: typeof fetch;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizedBaseUrl(value: string) {
	return value.trim().replace(/\/+$/u, '');
}

function value(name: string, values: Record<string, string | undefined>, env: NodeJS.ProcessEnv | Record<string, string | undefined>) {
	const candidate = env[name] ?? values[name];
	return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

function manifestApiBaseUrl(tenantRoot: string, environment: 'staging' | 'prod') {
	const candidates = [
		resolve(tenantRoot, 'treeseed.site.yaml'),
		resolve(tenantRoot, '..', '..', 'treeseed.site.yaml'),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const config = loadTreeseedDeployConfigFromPath(candidate);
			const connectionUrl = config.connections?.api?.environments?.[environment]?.baseUrl;
			const serviceUrl = config.services?.api?.environments?.[environment]?.baseUrl;
			const baseUrl = connectionUrl ?? serviceUrl;
			if (typeof baseUrl === 'string' && baseUrl.trim()) {
				return baseUrl.trim();
			}
		} catch {
			// Ignore malformed or unrelated manifests; machine config remains the fallback.
		}
	}
	return null;
}

async function timed<T>(timings: TreeseedOperationsRunnerSmokeReport['timings'], phase: string, action: () => Promise<T>) {
	const started = Date.now();
	try {
		return await action();
	} finally {
		timings.push({ phase, durationMs: Date.now() - started });
	}
}

async function requestJson(fetchImpl: typeof fetch, url: string, options: RequestInit = {}) {
	const response = await fetchImpl(url, {
		...options,
		headers: {
			accept: 'application/json',
			...(options.body ? { 'content-type': 'application/json' } : {}),
			...(options.headers ?? {}),
		},
	});
	const text = await response.text();
	const payload = text ? JSON.parse(text) : {};
	if (!response.ok) {
		const message = typeof payload?.error === 'string'
			? payload.error
			: typeof payload?.error?.message === 'string'
				? payload.error.message
				: typeof payload?.message === 'string'
					? payload.message
					: `HTTP ${response.status}`;
		throw new Error(`${options.method ?? 'GET'} ${url} failed: ${message}`);
	}
	return payload;
}

function operationFrom(payload: any) {
	return payload?.operation ?? payload?.payload?.operation ?? null;
}

function eventsFrom(payload: any) {
	const events = Array.isArray(payload?.events) ? payload.events : Array.isArray(payload?.payload?.events) ? payload.payload.events : [];
	return events.map((event: any) => ({
		kind: String(event?.kind ?? 'unknown'),
		createdAt: String(event?.createdAt ?? event?.created_at ?? ''),
	}));
}

function isSuccessfulOperationStatus(status: unknown) {
	return ['completed', 'succeeded'].includes(String(status ?? '').toLowerCase());
}

function failure(baseUrl: string, environment: 'staging' | 'prod', issues: string[], timings: TreeseedOperationsRunnerSmokeReport['timings'], extra: Partial<TreeseedOperationsRunnerSmokeReport> = {}): TreeseedOperationsRunnerSmokeReport {
	return {
		environment,
		ok: false,
		baseUrl,
		timings,
		events: [],
		issues,
		remediation: 'Verify the API service, Treeseed database, and operationsRunner Railway service, then run `npx trsd hosting verify --service operationsRunner --live --json`.',
		...extra,
	};
}

export async function runTreeseedOperationsRunnerSmoke(options: TreeseedOperationsRunnerSmokeOptions): Promise<TreeseedOperationsRunnerSmokeReport> {
	const env = options.env ?? process.env;
	let values: Record<string, string | undefined> = {};
	try {
		values = resolveTreeseedMachineEnvironmentValues(options.tenantRoot, options.environment);
	} catch {
		values = {};
	}
	const baseUrl = normalizedBaseUrl(
		options.baseUrl
		?? manifestApiBaseUrl(options.tenantRoot, options.environment)
		?? value('TREESEED_API_BASE_URL', values, env)
		?? value('TREESEED_CENTRAL_MARKET_API_BASE_URL', values, env)
		?? (options.environment === 'prod' ? 'https://api.treeseed.ai' : 'https://api-treeseed-market-staging-ca844c56.treeseed.ai'),
	);
	const serviceId = options.serviceId ?? value('TREESEED_ACCEPTANCE_SERVICE_ID', values, env) ?? value('TREESEED_API_WEB_SERVICE_ID', values, env) ?? value('TREESEED_WEB_SERVICE_ID', values, env) ?? 'web';
	const serviceSecret = options.serviceSecret ?? value('TREESEED_ACCEPTANCE_SERVICE_SECRET', values, env) ?? value('TREESEED_API_WEB_SERVICE_SECRET', values, env) ?? value('TREESEED_WEB_SERVICE_SECRET', values, env);
	const timings: TreeseedOperationsRunnerSmokeReport['timings'] = [];
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = Math.max(1000, Math.floor(options.timeoutMs ?? (options.environment === 'prod' ? 120000 : 90000)));
	const pollMs = Math.max(1000, Math.floor(options.pollMs ?? 3000));
	if (!serviceSecret) {
		return failure(baseUrl, options.environment, ['Missing API service credential for runner smoke.'], timings);
	}
	const headers = {
		'x-treeseed-service-id': serviceId,
		'x-treeseed-service-secret': serviceSecret,
	};
	try {
		await timed(timings, 'healthz', () => requestJson(fetchImpl, `${baseUrl}/healthz`));
		await timed(timings, 'healthz-deep', () => requestJson(fetchImpl, `${baseUrl}/healthz/deep`));
		const idempotencyKey = `smoke:${options.environment}:${Date.now()}`;
		const created = await timed(timings, 'operation-create', () => requestJson(fetchImpl, `${baseUrl}/v1/platform/operations`, {
			method: 'POST',
			headers,
			body: JSON.stringify({
				namespace: 'market',
				operation: 'diagnostic',
				target: 'market_operations_runner',
				idempotencyKey,
				input: {
					source: 'trsd.operations.smoke',
					environment: options.environment,
				},
			}),
		}));
		const operation = operationFrom(created);
		const operationId = typeof operation?.id === 'string' ? operation.id : null;
		if (!operationId) {
			return failure(baseUrl, options.environment, ['API did not return a diagnostic operation id.'], timings);
		}
		const deadline = Date.now() + timeoutMs;
		let current = operation;
		while (Date.now() < deadline) {
			current = operationFrom(await timed(timings, 'operation-poll', () => requestJson(fetchImpl, `${baseUrl}/v1/platform/operations/${encodeURIComponent(operationId)}`, { headers }))) ?? current;
			if (isSuccessfulOperationStatus(current?.status)) {
				const eventPayload = await timed(timings, 'operation-events', () => requestJson(fetchImpl, `${baseUrl}/v1/platform/operations/${encodeURIComponent(operationId)}/events`, { headers }));
				const events = eventsFrom(eventPayload);
				const sawRunnerEvent = events.some((event) => /checkpoint|complete|runner|market\.noop/iu.test(event.kind));
				if (!sawRunnerEvent) {
					return failure(baseUrl, options.environment, ['Diagnostic operation completed but no runner checkpoint/completion event was recorded.'], timings, {
						operationId,
						finalStatus: String(current?.status ?? 'completed'),
						runnerId: current?.assignedRunnerId ?? null,
						events,
					});
				}
				return {
					environment: options.environment,
					ok: true,
					baseUrl,
					operationId,
					finalStatus: String(current?.status ?? 'completed'),
					runnerId: current?.assignedRunnerId ?? null,
					timings,
					events,
					issues: [],
				};
			}
			if (['failed', 'cancelled', 'timed_out'].includes(String(current?.status ?? ''))) {
				return failure(baseUrl, options.environment, [`Diagnostic operation ended with status ${current.status}.`], timings, {
					operationId,
					finalStatus: current.status,
					runnerId: current?.assignedRunnerId ?? null,
				});
			}
			await sleep(pollMs);
		}
		return failure(baseUrl, options.environment, [`Diagnostic operation was not completed within ${timeoutMs}ms.`], timings, {
			operationId,
			finalStatus: current?.status ?? 'unknown',
			runnerId: current?.assignedRunnerId ?? null,
		});
	} catch (error) {
		return failure(baseUrl, options.environment, [error instanceof Error ? error.message : String(error)], timings);
	}
}
