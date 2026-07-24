import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveWebCachePolicy } from '../../../../platform/hosting/deploy-config.ts';
import {
	deleteRailwayCustomDomain,
	deleteRailwayEnvironment,
	deleteRailwayVolume,
	getRailwayServiceInstance,
	listRailwayCustomDomains,
	listRailwayProjects,
	listRailwayVariables,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	resolveRailwayApiToken,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
} from '../../hosting/railway/railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from '../../agents/runtime-tools.ts';
import { sdkD1MigrationsRoot } from '../../runtime/runtime-paths.ts';
import { cloudflareApiRequest } from '../hosting/cloudflare-api-request.ts';
import { isPlaceholderResourceId } from '../projects/projects-core/ensure-pages-project-compatibility.ts';

export function runWrangler(args, { cwd, allowFailure = false, json = false, capture = false, env = {}, input } = {}) {
	const result = spawnSync(process.execPath, [resolveWranglerBin(), ...args], {
		stdio: json || capture || input !== undefined ? ['pipe', 'pipe', 'pipe'] : 'inherit',
		cwd,
		env: { ...process.env, ...env },
		encoding: 'utf8',
		input,
	});

	if (result.status !== 0 && !allowFailure) {
		const stderr = result.stderr?.trim();
		const stdout = result.stdout?.trim();
		const output = [stderr, stdout].filter(Boolean).join('\n');
		if (/Authentication error/i.test(output) || /\[code:\s*10000\]/i.test(output)) {
			throw new Error([
				output || `Wrangler command failed: ${args.join(' ')}`,
				'',
				'Treeseed Cloudflare authentication failed. Check that CLOUDFLARE_API_TOKEN is an account-level token scoped to the target account and domain.',
				'Required Cloudflare permissions: account Pages Write, Workers Scripts Write, Workers KV Storage Write, Workers R2 Storage Write, D1 Write, Queues Write, Turnstile Sites Write, Account Rulesets Write, and Account Rule Lists Write; target zone Zone Read, DNS Write, Cache Settings Write, and SSL and Certificates Write.',
			].join('\n'));
		}
		throw new Error(output || `Wrangler command failed: ${args.join(' ')}`);
	}

	return result;
}

export function parseWranglerJsonOutput(result, label) {
	const source = `${result.stdout ?? ''}`.trim();
	if (!source) {
		throw new Error(`Expected JSON output from ${label}.`);
	}
	return JSON.parse(source);
}

export function isWranglerAlreadyExistsError(error, matchers: RegExp[]) {
	const message = error instanceof Error ? error.message : String(error);
	return matchers.some((matcher) => matcher.test(message));
}

export function listKvNamespaces(tenantRoot, env) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces?per_page=1000&order=title&direction=asc`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function listD1Databases(tenantRoot, env) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/d1/database`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function listQueues(tenantRoot, env) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/queues`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function listR2Buckets(tenantRoot, env) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/r2/buckets`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result?.buckets) ? payload.result.buckets : [];
}

export function listPagesProjects(tenantRoot, env) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/pages/projects`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function listTurnstileWidgets(tenantRoot, env) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/challenges/widgets?per_page=100`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function listWorkers(tenantRoot, env) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/workers/services?per_page=100`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function listDnsZones(env) {
	const payload = cloudflareApiRequest('/zones?per_page=100', {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function listDnsRecords(zoneId, env) {
	if (!zoneId) {
		return [];
	}
	const records = [];
	let page = 1;
	let totalPages = 1;
	while (page <= totalPages && page <= 50) {
		const payload = cloudflareApiRequest(
			`/zones/${encodeURIComponent(zoneId)}/dns_records?per_page=100&page=${page}`,
			{ env, allowFailure: true },
		);
		if (payload?.success === false) {
			break;
		}
		if (Array.isArray(payload?.result)) {
			records.push(...payload.result);
		}
		const reportedTotal = Number(payload?.result_info?.total_pages);
		totalPages = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : page;
		page += 1;
	}
	return records;
}

export function getTurnstileWidget(env, sitekey) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId || !sitekey) {
		return null;
	}
	const payload = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/challenges/widgets/${encodeURIComponent(sitekey)}`,
		{ env, allowFailure: true },
	);
	return payload?.result ?? null;
}

export function createTurnstileWidget(env, input) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		throw new Error('Configure CLOUDFLARE_ACCOUNT_ID before creating Turnstile widgets.');
	}
	try {
		return cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/challenges/widgets`, {
			method: 'POST',
			env,
			body: {
				name: input.name,
				domains: input.domains ?? [],
				mode: input.mode ?? 'managed',
			},
		})?.result ?? null;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Cloudflare Turnstile widget creation failed. Ensure the API token has Turnstile Sites Write permission: ${detail}`);
	}
}

export function updateTurnstileWidget(env, sitekey, input) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId || !sitekey) {
		throw new Error('Configure CLOUDFLARE_ACCOUNT_ID and sitekey before updating Turnstile widgets.');
	}
	try {
		return cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/challenges/widgets/${encodeURIComponent(sitekey)}`, {
			method: 'PUT',
			env,
			body: {
				name: input.name,
				domains: input.domains ?? [],
				mode: input.mode ?? 'managed',
			},
		})?.result ?? null;
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Cloudflare Turnstile widget update failed. Ensure the API token has Turnstile Sites Write permission: ${detail}`);
	}
}

export function buildCloudflarePagesFunctionBindings(state) {
	const kvNamespaces = Object.fromEntries(
		Object.entries(state.kvNamespaces ?? {})
			.map(([key, namespace]) => {
				const binding = namespace?.binding ?? key;
				const namespaceId = namespace?.id;
				return binding && namespaceId && !isPlaceholderResourceId(namespaceId)
					? [binding, { namespace_id: namespaceId }]
					: null;
			})
			.filter(Boolean),
	);
	const database = state.d1Databases?.SITE_DATA_DB;
	const d1Databases = database?.binding && database?.databaseId && !isPlaceholderResourceId(database.databaseId)
		? { [database.binding]: { id: database.databaseId } }
		: {};
	const contentBinding = state.content?.r2Binding;
	const contentBucketName = state.content?.bucketName;
	const r2Buckets = contentBinding && contentBucketName
		? { [contentBinding]: { name: contentBucketName } }
		: {};
	return {
		...(Object.keys(kvNamespaces).length ? { kv_namespaces: kvNamespaces } : {}),
		...(Object.keys(d1Databases).length ? { d1_databases: d1Databases } : {}),
		...(Object.keys(r2Buckets).length ? { r2_buckets: r2Buckets } : {}),
	};
}

export function mergeCloudflarePagesDeploymentConfig(config = {}, bindings = {}) {
	return Object.entries(bindings).reduce((merged, [key, value]) => ({
		...merged,
		[key]: {
			...(merged[key] ?? {}),
			...value,
		},
	}), { ...config });
}
