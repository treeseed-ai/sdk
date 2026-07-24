import { configuredLiveAcceptanceValue as configuredValue, type LiveAcceptanceEnv } from '../support/acceptance/live-acceptance-values.ts';

type LiveEnv = LiveAcceptanceEnv;

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function resolveCloudflareZoneId(domain: string, env: LiveEnv, fetchImpl: typeof fetch) {
	const configured = configuredValue(env, ['TREESEED_LIVE_TEST_CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_ZONE_ID']);
	if (configured) return configured;
	const zones = await cloudflareRequest('/zones?per_page=100', env, fetchImpl).catch(() => []) as unknown[];
	if (!Array.isArray(zones)) return '';
	const candidates = zones
		.map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : null)
		.filter(Boolean) as Array<Record<string, unknown>>;
	const matched = candidates.find((entry) =>
		typeof entry.name === 'string'
		&& (domain === entry.name || domain.endsWith(`.${entry.name}`)));
	return typeof matched?.id === 'string' ? matched.id : '';
}


interface CloudflareApiPayload {
	success?: boolean;
	errors?: Array<{ message?: string }>;
	result?: unknown;
	result_info?: { page?: number; per_page?: number; count?: number; total_count?: number; total_pages?: number };
}

export async function cloudflareRequestPayload(path: string, env: LiveEnv, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const token = configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN']);
	if (!token) throw new Error('Missing TREESEED_CLOUDFLARE_API_TOKEN.');
	const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: {
			Accept: 'application/json',
			...(init.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${token}`,
			...(init.headers ?? {}),
		},
	});
	const payload = await response.json().catch(() => ({})) as CloudflareApiPayload;
	if (!response.ok || payload.success === false) {
		const errors = Array.isArray(payload.errors)
			? payload.errors.map((entry) => entry.message).filter(Boolean).join('; ')
			: '';
		throw new Error(`${response.status} ${response.statusText}${errors ? `: ${errors}` : ''}`);
	}
	return payload;
}

export async function cloudflareRequest(path: string, env: LiveEnv, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const payload = await cloudflareRequestPayload(path, env, fetchImpl, init);
	return payload.result;
}

function isTransientCloudflareError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return /\b(500|502|503|504|520|521|522|523|524)\b|internal server error|unknown error occurred|temporar(?:y|ily)|timeout|rate limit/iu.test(message);
}

export async function withCloudflareTransientRetry<T>(operation: () => Promise<T>, options: { attempts?: number; delayMs?: number } = {}) {
	const attempts = Math.max(1, options.attempts ?? 4);
	const delayMs = Math.max(0, options.delayMs ?? 1500);
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;
			if (!isTransientCloudflareError(error) || attempt >= attempts) break;
			await sleep(delayMs * attempt);
		}
	}
	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function cloudflareRawRequest(path: string, env: LiveEnv, fetchImpl: typeof fetch, init: RequestInit = {}) {
	const token = configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN']);
	if (!token) throw new Error('Missing TREESEED_CLOUDFLARE_API_TOKEN.');
	const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
		...init,
		headers: {
			Accept: '*/*',
			Authorization: `Bearer ${token}`,
			...(init.headers ?? {}),
		},
	});
	const body = await response.text().catch(() => '');
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}${body ? `: ${body.slice(0, 300)}` : ''}`);
	}
	return body;
}

export function cloudflareName(value: unknown) {
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['name', 'title', 'queue_name']) {
			const candidate = record[key];
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
	}
	return '';
}

export function cloudflareId(value: unknown) {
	if (value && typeof value === 'object') {
		const record = value as Record<string, unknown>;
		for (const key of ['id', 'uuid', 'queue_id']) {
			const candidate = record[key];
			if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
		}
	}
	return '';
}

export function cloudflareListItems(value: unknown, keys: string[] = []) {
	if (Array.isArray(value)) return value;
	if (!value || typeof value !== 'object') return [];
	const record = value as Record<string, unknown>;
	for (const key of [...keys, 'items', 'buckets', 'databases', 'queues', 'widgets', 'namespaces']) {
		const candidate = record[key];
		if (Array.isArray(candidate)) return candidate;
	}
	return [];
}
