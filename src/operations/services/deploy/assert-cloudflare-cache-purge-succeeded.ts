import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveTreeseedWebCachePolicy } from '../../../platform/deploy-config.ts';
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
} from '../railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from '../runtime-tools.ts';
import { sdkD1MigrationsRoot } from '../runtime-paths.ts';
import { buildProvisioningSummary, safeUrl } from './ensure-pages-project-compatibility.ts';
import { createPersistentDeployTarget, normalizeTarget, sharedDeploymentName } from './configured-surface-hosts.ts';
import { DEFAULT_TREESEED_MARKET_BASE_URL, envOrNull, loadTenantDeployConfig, resolveTreeseedResourceIdentity } from './default-compatibility-date.ts';
import { loadDeployState, writeDeployState } from './load-deploy-state.ts';
import { purgeCloudflareCacheByUrls, purgeCloudflareCacheEverythingByHosts } from './build-treeseed-managed-cloudflare-cache-rules.ts';

export function assertCloudflareCachePurgeSucceeded(results) {
	const failures = (results ?? []).filter((result) => result?.success !== true);
	if (failures.length === 0) return;
	const detail = failures
		.map((result) => {
			const errors = Array.isArray(result?.errors) && result.errors.length > 0
				? `: ${result.errors.join('; ')}`
				: '';
			return `${result?.zoneId ?? 'unknown-zone'} (${result?.count ?? 0} urls)${errors}`;
		})
		.join(', ');
	throw new Error(`Cloudflare cache purge did not succeed for ${detail}.`);
}

export function queueName(entry) {
	return entry?.queue_name ?? entry?.queueName ?? entry?.name ?? null;
}

export function queueId(entry) {
	return entry?.queue_id ?? entry?.queueId ?? entry?.id ?? entry?.uuid ?? null;
}

export function hasProvisionedCloudflareResources(state) {
	return Boolean(
		state?.pages?.projectName
		&& state?.pages?.url
		&& state?.d1Databases?.SITE_DATA_DB?.databaseId
		&& state?.kvNamespaces?.FORM_GUARD_KV?.id
		&& state?.content?.bucketName,
	);
}

export function absoluteUrlForPath(baseUrl, path) {
	const parsed = safeUrl(baseUrl);
	if (!parsed) {
		return null;
	}
	const normalizedPath = String(path ?? '').startsWith('/') ? String(path) : `/${String(path ?? '')}`;
	return new URL(normalizedPath, parsed).toString();
}

export function resolveSourcePagePurgeUrls(deployConfig) {
	const webBaseUrl = deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl;
	const paths = resolveTreeseedWebCachePolicy(deployConfig).sourcePages.paths;
	return paths.map((path) => absoluteUrlForPath(webBaseUrl, path)).filter(Boolean);
}

export function recordCachePurgeResult(targetState, results, error = null) {
	if (error) {
		targetState.lastError = error instanceof Error ? error.message : String(error);
		return;
	}
	targetState.lastPurgedAt = new Date().toISOString();
	targetState.purgeCount = Array.isArray(results)
		? results.reduce((sum, result) => sum + (typeof result?.count === 'number' ? result.count : 0), 0)
		: 0;
	targetState.lastError = null;
}

export function resolveCloudflareCachePurgeEnv(options = {}) {
	const env = options.env ?? {};
	const token = env.TREESEED_CLOUDFLARE_API_TOKEN
		?? env.CLOUDFLARE_API_TOKEN
		?? process.env.TREESEED_CLOUDFLARE_API_TOKEN
		?? process.env.CLOUDFLARE_API_TOKEN;
	return token
		? { ...env, TREESEED_CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_API_TOKEN: token }
		: null;
}

export function purgeSourcePageCaches(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const urls = resolveSourcePagePurgeUrls(deployConfig);
	const env = resolveCloudflareCachePurgeEnv(options);
	if ((options.planOnly ?? false) || urls.length === 0 || !env) {
		recordCachePurgeResult(state.webCache.deployPurge, urls.map((url) => ({ count: url ? 1 : 0 })));
		writeDeployState(tenantRoot, state, { target });
		return {
			skipped: true,
			reason: options.planOnly ? 'plan' : urls.length === 0 ? 'no_urls' : 'missing_cloudflare_token',
			urls,
			results: [],
		};
	}

	try {
		const results = purgeCloudflareCacheByUrls(urls, deployConfig, {
			env,
		});
		const hosts = [...new Set(urls
			.map((url) => safeUrl(url)?.hostname)
			.filter(Boolean))];
		const allResults = target.scope === 'prod'
			? purgeCloudflareCacheEverythingByHosts(hosts, deployConfig, { env })
			: [];
		assertCloudflareCachePurgeSucceeded([...results, ...allResults]);
		recordCachePurgeResult(state.webCache.deployPurge, [...results, ...allResults]);
		writeDeployState(tenantRoot, state, { target });
		return { urls, results: [...results, ...allResults] };
	} catch (error) {
		recordCachePurgeResult(state.webCache.deployPurge, [], error);
		writeDeployState(tenantRoot, state, { target });
		throw error;
	}
}

export function purgePublishedContentCaches(tenantRoot, urls, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const env = resolveCloudflareCachePurgeEnv(options);
	if ((options.planOnly ?? false) || !urls?.length || !env) {
		recordCachePurgeResult(state.webCache.contentPurge, (urls ?? []).map((url) => ({ count: url ? 1 : 0 })));
		writeDeployState(tenantRoot, state, { target });
		return {
			skipped: true,
			reason: options.planOnly ? 'plan' : !urls?.length ? 'no_urls' : 'missing_cloudflare_token',
			urls: urls ?? [],
			results: [],
		};
	}

	try {
		const results = purgeCloudflareCacheByUrls(urls, deployConfig, {
			env,
		});
		assertCloudflareCachePurgeSucceeded(results);
		recordCachePurgeResult(state.webCache.contentPurge, results);
		writeDeployState(tenantRoot, state, { target });
		return { urls, results };
	} catch (error) {
		recordCachePurgeResult(state.webCache.contentPurge, [], error);
		writeDeployState(tenantRoot, state, { target });
		throw error;
	}
}

export function buildDestroySummary(deployConfig, state, target) {
	return buildProvisioningSummary(deployConfig, state, target);
}

export function isPlaceholderAccountId(value) {
	return !value || value === 'replace-with-cloudflare-account-id';
}

export function resolveConfiguredCloudflareAccountId(deployConfig) {
	return envOrNull('CLOUDFLARE_ACCOUNT_ID') ?? deployConfig.cloudflare.accountId;
}

export function normalizeConfiguredBaseUrl(value) {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw) {
		return null;
	}
	return raw.replace(/\/+$/u, '');
}

export function domainBaseUrl(domain) {
	const raw = typeof domain === 'string' ? domain.trim() : '';
	if (!raw) {
		return null;
	}
	if (/^https?:\/\//iu.test(raw)) {
		return normalizeConfiguredBaseUrl(raw);
	}
	return `https://${raw.replace(/^\/+|\/+$/gu, '')}`;
}

export function targetEnvironmentKey(target) {
	if (target?.kind === 'persistent') {
		return target.scope;
	}
	return 'staging';
}

export function resolveConfiguredApiConnectionBaseUrl(deployConfig, target) {
	const scope = targetEnvironmentKey(target);
	if (scope === 'local') {
		return normalizeConfiguredBaseUrl(deployConfig.connections?.api?.localBaseUrl)
			?? normalizeConfiguredBaseUrl(deployConfig.connections?.api?.environments?.local?.baseUrl)
			?? domainBaseUrl(deployConfig.connections?.api?.environments?.local?.domain);
	}
	return normalizeConfiguredBaseUrl(deployConfig.connections?.api?.environments?.[scope]?.baseUrl)
		?? domainBaseUrl(deployConfig.connections?.api?.environments?.[scope]?.domain);
}

export function resolveConfiguredMarketBaseUrl(deployConfig, target) {
	return resolveConfiguredApiConnectionBaseUrl(deployConfig, target)
		?? envOrNull('TREESEED_API_BASE_URL')
		?? deployConfig.runtime?.marketBaseUrl
		?? deployConfig.hosting?.marketBaseUrl
		?? envOrNull('TREESEED_CENTRAL_MARKET_API_BASE_URL')
		?? DEFAULT_TREESEED_MARKET_BASE_URL;
}

export function resolveConfiguredCentralMarketBaseUrl(deployConfig, target) {
	return resolveConfiguredApiConnectionBaseUrl(deployConfig, target)
		?? envOrNull('TREESEED_CENTRAL_MARKET_API_BASE_URL')
		?? DEFAULT_TREESEED_MARKET_BASE_URL;
}

export function resolveConfiguredPagesProjectName(deployConfig) {
	return sharedDeploymentName(resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget('prod')));
}

export function resolveConfiguredContentBucketBinding(deployConfig) {
	return envOrNull('TREESEED_CONTENT_BUCKET_BINDING')
		?? deployConfig.cloudflare.r2?.binding
		?? 'TREESEED_CONTENT_BUCKET';
}

export function resolveConfiguredContentBucketName(deployConfig) {
	return sharedDeploymentName(resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget('prod')), 'content');
}

export function resolveConfiguredContentPublicBaseUrl(deployConfig) {
	return envOrNull('TREESEED_CONTENT_PUBLIC_BASE_URL')
		?? deployConfig.cloudflare.r2?.publicBaseUrl
		?? '';
}

export function missingTurnstileRequirements() {
	return [];
}

export function missingContentRuntimeRequirements(deployConfig) {
	const issues = [];
	if (deployConfig.providers?.content?.runtime === 'team_scoped_r2_overlay') {
		if (!resolveConfiguredContentBucketName(deployConfig)) {
			issues.push('Set TREESEED_CONTENT_BUCKET_NAME before deploying team-scoped hosted content.');
		}
		if (!envOrNull('TREESEED_EDITORIAL_PREVIEW_SECRET')) {
			issues.push('Set TREESEED_EDITORIAL_PREVIEW_SECRET before deploying team-scoped hosted content.');
		}
	}
	return issues;
}
