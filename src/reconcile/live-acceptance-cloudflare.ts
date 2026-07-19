import type { TreeseedCanonicalDrift, TreeseedCanonicalGraphNode } from './platform.ts';
import type {
	RunTreeseedLiveReconcileTestsOptions,
	TreeseedLiveReconcileEnvironment,
	TreeseedLiveReconcileMode,
	TreeseedLiveReconcileScenarioResult,
} from './live-acceptance.ts';
import {
	cloudflareId,
	cloudflareListItems,
	cloudflareName,
	cloudflareRawRequest,
	cloudflareRequest,
	cloudflareRequestPayload,
	resolveCloudflareZoneId,
	withCloudflareTransientRetry,
} from './live-acceptance-cloudflare-client.ts';
import { resolveLiveTestDomain } from './live-acceptance-provider-config.ts';
import {
	PROVIDER_CAPABILITIES,
	blocking,
	emitProgress,
	node,
	providerNode,
	providerPrefixRoot,
	scenario,
	waitForLiveObservation,
} from './live-acceptance-runtime.ts';
import { configuredLiveAcceptanceValue as configuredValue, type LiveAcceptanceEnv } from './live-acceptance-values.ts';

type LiveEnv = LiveAcceptanceEnv;
type LiveProgress = RunTreeseedLiveReconcileTestsOptions['onProgress'];

async function cloudflareAcceptanceMissingConfig(cwd: string, env: LiveEnv, fetchImpl: typeof fetch) {
	const missing: string[] = [];
	if (!configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN'])) missing.push('TREESEED_CLOUDFLARE_API_TOKEN');
	if (!configuredValue(env, ['TREESEED_CLOUDFLARE_ACCOUNT_ID'])) missing.push('TREESEED_CLOUDFLARE_ACCOUNT_ID');
	const domain = resolveLiveTestDomain(cwd, env);
	if (!domain) {
		missing.push('TREESEED_LIVE_TEST_DOMAIN or treeseed.site.yaml siteUrl');
	} else if (configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN']) && !await resolveCloudflareZoneId(domain, env, fetchImpl)) {
		missing.push('TREESEED_LIVE_TEST_CLOUDFLARE_ZONE_ID or visible Cloudflare zone for live-test domain');
	}
	return missing;
}

export async function runCloudflareCleanup(cwd: string, environment: TreeseedLiveReconcileEnvironment, prefix: string, mode: TreeseedLiveReconcileMode, env: LiveEnv, fetchImpl: typeof fetch) {
	const accountId = configuredValue(env, ['TREESEED_CLOUDFLARE_ACCOUNT_ID']);
	const domain = resolveLiveTestDomain(cwd, env);
	const zoneId = domain ? await resolveCloudflareZoneId(domain, env, fetchImpl) : configuredValue(env, ['TREESEED_LIVE_TEST_CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_ZONE_ID']);
	const destroyed: TreeseedCanonicalGraphNode[] = [];
	const cleanupDrift: TreeseedCanonicalDrift[] = [];
	const prefixRoot = mode === 'cleanup' ? providerPrefixRoot(environment, 'cloudflare') : prefix;
	const attempt = async (type: string, id: string, fn: () => Promise<unknown>) => {
		try {
			await fn();
			destroyed.push(node('cloudflare', environment, type, id, { deleted: true }));
		} catch (error) {
			cleanupDrift.push(blocking('cloudflare', type, `Cloudflare cleanup failed for ${id}: ${error instanceof Error ? error.message : String(error)}`));
		}
	};
	const list = async (type: string, path: string, keys: string[] = []) => {
		try {
			return cloudflareListItems(await cloudflareRequest(path, env, fetchImpl), keys);
		} catch (error) {
			cleanupDrift.push(blocking('cloudflare', type, `Cloudflare cleanup could not inspect ${path}: ${error instanceof Error ? error.message : String(error)}`));
			return [];
		}
	};
	const listPaginated = async (type: string, path: string, keys: string[] = [], perPage = 10) => {
		const items: unknown[] = [];
		let totalPages = 1;
		for (let page = 1; page <= totalPages; page += 1) {
			const separator = path.includes('?') ? '&' : '?';
			const pagePath = `${path}${separator}page=${page}&per_page=${perPage}`;
			try {
				const payload = await cloudflareRequestPayload(pagePath, env, fetchImpl);
				items.push(...cloudflareListItems(payload.result, keys));
				const reportedTotalPages = payload.result_info?.total_pages;
				if (typeof reportedTotalPages === 'number' && Number.isFinite(reportedTotalPages) && reportedTotalPages > totalPages) {
					totalPages = Math.min(Math.ceil(reportedTotalPages), 100);
				}
			} catch (error) {
				cleanupDrift.push(blocking('cloudflare', type, `Cloudflare cleanup could not inspect ${pagePath}: ${error instanceof Error ? error.message : String(error)}`));
				break;
			}
		}
		return items;
	};
	if (!configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN']) || !accountId) {
		cleanupDrift.push(blocking('cloudflare', 'account', 'Cloudflare cleanup requires TREESEED_CLOUDFLARE_API_TOKEN and TREESEED_CLOUDFLARE_ACCOUNT_ID.'));
	}
	if (accountId && configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN'])) {
		if (mode === 'acceptance') {
			await attempt('worker', prefix, () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}`, env, fetchImpl, { method: 'DELETE' }).catch((error) => {
				const message = error instanceof Error ? error.message : String(error);
				if (/404|not found/iu.test(message)) return null;
				throw error;
			}));
		}
		for (const worker of await list('worker', `/accounts/${accountId}/workers/services?per_page=100`)) {
			const name = cloudflareName(worker);
			if (name.startsWith(prefixRoot)) await attempt('worker', name, () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${name}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const project of await listPaginated('pages', `/accounts/${accountId}/pages/projects`)) {
			const name = cloudflareName(project);
			if (name.startsWith(prefixRoot)) await attempt('pages', name, () => cloudflareRequest(`/accounts/${accountId}/pages/projects/${name}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const bucket of await list('r2', `/accounts/${accountId}/r2/buckets?per_page=100`, ['buckets'])) {
			const name = cloudflareName(bucket);
			if (name.startsWith(prefixRoot)) await attempt('r2', name, () => cloudflareRequest(`/accounts/${accountId}/r2/buckets/${name}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const namespace of await list('kv', `/accounts/${accountId}/storage/kv/namespaces?per_page=100`)) {
			const name = cloudflareName(namespace);
			const id = cloudflareId(namespace);
			if (name.startsWith(prefixRoot) && id) await attempt('kv', id, () => cloudflareRequest(`/accounts/${accountId}/storage/kv/namespaces/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const database of await list('d1', `/accounts/${accountId}/d1/database?per_page=100`)) {
			const name = cloudflareName(database);
			const id = cloudflareId(database);
			if (name.startsWith(prefixRoot) && id) await attempt('d1', id, () => cloudflareRequest(`/accounts/${accountId}/d1/database/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const queue of await list('queue', `/accounts/${accountId}/queues?per_page=100`, ['queues'])) {
			const name = cloudflareName(queue);
			const id = cloudflareId(queue);
			if (name.startsWith(prefixRoot) && id) await attempt('queue', id, () => cloudflareRequest(`/accounts/${accountId}/queues/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
		for (const widget of await list('turnstile', `/accounts/${accountId}/challenges/widgets?per_page=100`)) {
			const name = cloudflareName(widget);
			const id = cloudflareId(widget);
			if (name.startsWith(prefixRoot) && id) await attempt('turnstile', id, () => cloudflareRequest(`/accounts/${accountId}/challenges/widgets/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
	}
	if (zoneId && configuredValue(env, ['TREESEED_CLOUDFLARE_API_TOKEN'])) {
		for (const record of await list('dns', `/zones/${zoneId}/dns_records?per_page=100`)) {
			const name = cloudflareName(record);
			const id = cloudflareId(record);
			if (name.startsWith(prefixRoot) && id) await attempt('dns', id, () => cloudflareRequest(`/zones/${zoneId}/dns_records/${id}`, env, fetchImpl, { method: 'DELETE' }));
		}
	}
	const results = PROVIDER_CAPABILITIES.cloudflare.map((capability) => scenario({
		provider: 'cloudflare',
		mode,
		prefix,
		capability,
		ok: cleanupDrift.length === 0,
		phase: 'cleanup',
		action: destroyed.some((resource) => resource.type === capability) ? 'delete' : 'noop',
		reason: cleanupDrift.length === 0
			? `Cloudflare cleanup removed ${destroyed.filter((resource) => resource.type === capability).length} ${capability} resource(s).`
			: 'Cloudflare cleanup left blocking drift.',
		destroyedResources: destroyed.filter((resource) => resource.type === capability),
	}));
	return { results, cleanupDrift };
}

export async function runCloudflareAcceptance(cwd: string, environment: TreeseedLiveReconcileEnvironment, runId: string, prefix: string, env: LiveEnv, fetchImpl: typeof fetch, onProgress?: LiveProgress) {
	const mode: TreeseedLiveReconcileMode = 'acceptance';
	const missing = await cloudflareAcceptanceMissingConfig(cwd, env, fetchImpl);
	if (missing.length > 0) {
		return {
			results: PROVIDER_CAPABILITIES.cloudflare.map((capability) => scenario({ provider: 'cloudflare', mode, prefix, capability, ok: false, phase: 'blocked', action: 'blocked', reason: `Missing Cloudflare acceptance configuration: ${missing.join(', ')}.` })),
			cleanupDrift: [],
		};
	}
	emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, phase: 'cleanup', message: `cloudflare: removing old live-test resources for ${prefix}` });
	await runCloudflareCleanup(cwd, environment, prefix, mode, env, fetchImpl);
	const accountId = configuredValue(env, ['TREESEED_CLOUDFLARE_ACCOUNT_ID']);
	const domain = resolveLiveTestDomain(cwd, env);
	const zoneId = await resolveCloudflareZoneId(domain, env, fetchImpl);
	const results: TreeseedLiveReconcileScenarioResult[] = [];
	const created: TreeseedCanonicalGraphNode[] = [];
	const attempt = async (
		capability: string,
		type: string,
		create: () => Promise<unknown>,
		verify: (createdResult: unknown) => Promise<unknown>,
	) => {
		const started = new Date();
		const startedMs = performance.now();
		emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'create', message: `cloudflare:${capability}: create/update started` });
		try {
			const result = await create();
			emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'verify', message: `cloudflare:${capability}: waiting for live observation` });
			const observed = await verify(result);
			const completed = new Date();
			const createdNode = providerNode('cloudflare', environment, type, `${prefix}:${type}`, { result, observed });
			created.push(createdNode);
			const durationMs = Math.max(1, Math.ceil(performance.now() - startedMs));
			results.push(scenario({
				provider: 'cloudflare',
				mode,
				prefix,
				capability,
				ok: true,
				phase: capability === 'cache-rules' ? 'verify' : 'create',
				action: capability === 'cache-rules' ? 'noop' : 'create',
				reason: capability === 'cache-rules'
					? 'Cloudflare acceptance observed cache-rules API access.'
					: `Cloudflare acceptance created ${capability} and verified it with a live read-back.`,
				locators: { accountId, zoneId },
				createdResources: capability === 'cache-rules' ? [] : [createdNode],
				startedAt: started.toISOString(),
				completedAt: completed.toISOString(),
				durationMs,
			}));
			emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'complete', elapsedMs: durationMs, message: `cloudflare:${capability}: ok in ${durationMs}ms` });
		} catch (error) {
			const completed = new Date();
			const durationMs = Math.max(1, Math.ceil(performance.now() - startedMs));
			const reason = error instanceof Error ? error.message : String(error);
			const providerLimited = capability === 'cache-rules' && /403|forbidden|authentication/iu.test(reason);
			results.push(scenario({
				provider: 'cloudflare',
				mode,
				prefix,
				capability,
				ok: false,
				phase: 'blocked',
				action: 'blocked',
				reason: providerLimited
					? `${reason}. Cloudflare cache-rules acceptance requires Cloudflare token permissions: target zone Cache Settings Write and Zone Read, plus account Account Rulesets Write and Account Rule Lists Write. Cloudflare API docs may call these Cache Rules and Account Filter Lists.`
					: reason,
				locators: { accountId, zoneId },
				startedAt: started.toISOString(),
				completedAt: completed.toISOString(),
				durationMs,
			}));
			emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, capability, phase: 'blocked', elapsedMs: durationMs, message: `cloudflare:${capability}: blocked after ${durationMs}ms - ${providerLimited ? 'missing cache-rules permissions' : reason}` });
		}
	};
	await attempt('worker', 'worker', () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}`, env, fetchImpl, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/javascript' },
		body: 'addEventListener("fetch", event => event.respondWith(new Response("treeseed-live-test-worker")));',
	}), () => waitForLiveObservation(
		`Cloudflare worker ${prefix}`,
		() => cloudflareRawRequest(`/accounts/${accountId}/workers/scripts/${prefix}`, env, fetchImpl),
		(value) => typeof value === 'string' && value.includes('treeseed-live-test-worker'),
	));
	await attempt('pages', 'pages', () => withCloudflareTransientRetry(() => cloudflareRequest(`/accounts/${accountId}/pages/projects`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ name: prefix, production_branch: 'main' }),
	})), () => waitForLiveObservation(
		`Cloudflare Pages project ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/pages/projects/${prefix}`, env, fetchImpl),
		(value) => Boolean(value && typeof value === 'object'),
	));
	await attempt('kv', 'kv', () => cloudflareRequest(`/accounts/${accountId}/storage/kv/namespaces`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ title: prefix }),
	}), () => waitForLiveObservation(
		`Cloudflare KV namespace ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/storage/kv/namespaces?per_page=100`, env, fetchImpl),
		(value) => Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix),
	));
	await attempt('r2', 'r2', () => cloudflareRequest(`/accounts/${accountId}/r2/buckets/${prefix}`, env, fetchImpl, { method: 'PUT' }), () => waitForLiveObservation(
		`Cloudflare R2 bucket ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/r2/buckets/${prefix}`, env, fetchImpl),
		(value) => Boolean(value && typeof value === 'object'),
	));
	await attempt('d1', 'd1', () => cloudflareRequest(`/accounts/${accountId}/d1/database`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ name: prefix }),
	}), (createdResult) => {
		const id = cloudflareId(createdResult);
		return waitForLiveObservation(
			`Cloudflare D1 database ${prefix}`,
			() => id
				? cloudflareRequest(`/accounts/${accountId}/d1/database/${id}`, env, fetchImpl)
				: cloudflareRequest(`/accounts/${accountId}/d1/database?per_page=100`, env, fetchImpl),
			(value) => Boolean(value && typeof value === 'object') || (Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix)),
		);
	});
	await attempt('queue', 'queue', () => cloudflareRequest(`/accounts/${accountId}/queues`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ queue_name: prefix }),
	}), () => waitForLiveObservation(
		`Cloudflare Queue ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/queues?per_page=100`, env, fetchImpl),
		(value) => Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix),
	));
	await attempt('turnstile', 'turnstile', () => cloudflareRequest(`/accounts/${accountId}/challenges/widgets`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ name: prefix, domains: [`${prefix}.${domain}`], mode: 'managed' }),
	}), () => waitForLiveObservation(
		`Cloudflare Turnstile widget ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/challenges/widgets?per_page=100`, env, fetchImpl),
		(value) => Array.isArray(value) && value.some((entry) => cloudflareName(entry) === prefix),
	));
	await attempt('dns', 'dns', () => cloudflareRequest(`/zones/${zoneId}/dns_records`, env, fetchImpl, {
		method: 'POST',
		body: JSON.stringify({ type: 'TXT', name: `${prefix}.${domain}`, content: 'treeseed-live-test', ttl: 60 }),
	}), (createdResult) => {
		const id = cloudflareId(createdResult);
		return waitForLiveObservation(
			`Cloudflare DNS record ${prefix}.${domain}`,
			() => id
				? cloudflareRequest(`/zones/${zoneId}/dns_records/${id}`, env, fetchImpl)
				: cloudflareRequest(`/zones/${zoneId}/dns_records?name=${encodeURIComponent(`${prefix}.${domain}`)}`, env, fetchImpl),
			(value) => Boolean(value && typeof value === 'object') || (Array.isArray(value) && value.some((entry) => cloudflareName(entry) === `${prefix}.${domain}`)),
		);
	});
	await attempt('secrets', 'secrets', () => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}/secrets`, env, fetchImpl, {
		method: 'PUT',
		body: JSON.stringify({ name: 'TREESEED_LIVE_TEST_SECRET', text: 'redacted-test-value', type: 'secret_text' }),
	}), () => waitForLiveObservation(
		`Cloudflare Worker secret for ${prefix}`,
		() => cloudflareRequest(`/accounts/${accountId}/workers/scripts/${prefix}/settings`, env, fetchImpl),
		(value) => Boolean(value && typeof value === 'object'),
	));
	await attempt('cache-rules', 'cache-rules', () => cloudflareRequest(`/zones/${zoneId}/rulesets`, env, fetchImpl, {
		method: 'GET',
	}), (createdResult) => Promise.resolve(createdResult));
	emitProgress(onProgress, { provider: 'cloudflare', mode, environment, runId, resourcePrefix: prefix, phase: 'destroy', message: `cloudflare: cleaning created resources for ${prefix}` });
	const cleanup = await runCloudflareCleanup(cwd, environment, prefix, mode, env, fetchImpl);
	return { results, cleanupDrift: cleanup.cleanupDrift };
}

