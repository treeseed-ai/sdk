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
import { cloudflareApiRequest, joinCloudflareAndExpression, listCloudflareZoneRulesets, resolveCloudflareZoneIdForHost } from './cloudflare-api-request.ts';
import { resolvePublicContentCacheTarget, resolvePublicWebCacheTarget, safeUrl, shouldManageCloudflareWebCacheRules } from '../projects/projects-core/ensure-pages-project-compatibility.ts';

export function buildManagedCloudflareCacheRules(deployConfig, cacheTarget, kind) {
	if (!cacheTarget?.host) {
		return [];
	}
	const policy = resolveWebCachePolicy(deployConfig);
	const cachePolicy = kind === 'web' ? policy.contentPages : policy.r2PublishedObjects;
	const hostExpression = `(http.host eq "${cacheTarget.host}")`;
	const pathExpression = cacheTarget.pathPrefix
		? `(starts_with(http.request.uri.path, "${cacheTarget.pathPrefix}/") or (http.request.uri.path eq "${cacheTarget.pathPrefix}"))`
		: null;

	if (kind === 'content') {
		return [
			{
				description: 'treeseed-managed: cache public r2 objects',
				expression: joinCloudflareAndExpression([
					hostExpression,
					pathExpression,
					'(http.request.method in {"GET" "HEAD"})',
				]),
				action: 'set_cache_settings',
				action_parameters: {
					cache: true,
					edge_ttl: {
						mode: 'override_origin',
						default: cachePolicy.edgeTtlSeconds,
					},
					browser_ttl: {
						mode: 'override_origin',
						default: cachePolicy.browserTtlSeconds,
					},
				},
				enabled: true,
			},
		];
	}

	const sourcePaths = policy.sourcePages.paths.map((path) => path === '/' ? '/' : path.replace(/\/+$/u, ''));
	const sourcePathExpression = sourcePaths.length > 0
		? `(${sourcePaths.map((path) => `(http.request.uri.path eq "${path}")`).join(' or ')})`
		: null;
	const notSourcePathExpression = sourcePaths.length > 0
		? `not ${sourcePathExpression}`
		: null;

	const rules = [
		{
			description: 'treeseed-managed: bypass preview and dynamic routes',
			expression: joinCloudflareAndExpression([
				hostExpression,
				'((starts_with(http.request.uri.path, "/api/")) or (http.request.uri.path eq "/api") or (starts_with(http.request.uri.path, "/auth")) or (starts_with(http.request.uri.path, "/admin")) or (starts_with(http.request.uri.path, "/app")) or (starts_with(http.request.uri.path, "/internal")) or (http.request.uri.query contains "preview=") or (http.cookie contains "treeseed-content-preview="))',
			]),
			action: 'set_cache_settings',
			action_parameters: {
				cache: false,
			},
			enabled: true,
		}
	];

	if (sourcePathExpression) {
		rules.push({
			description: 'treeseed-managed: bypass source html routes',
			expression: joinCloudflareAndExpression([
				hostExpression,
				pathExpression,
				sourcePathExpression,
				'(http.request.method in {"GET" "HEAD"})',
			]),
			action: 'set_cache_settings',
			action_parameters: {
				cache: false,
			},
			enabled: true,
		});
	}

	rules.push(
		{
			description: 'treeseed-managed: cache content html routes',
			expression: joinCloudflareAndExpression([
				hostExpression,
				pathExpression,
				notSourcePathExpression,
				'(http.request.method in {"GET" "HEAD"})',
				'(http.request.uri.path.extension eq "")',
				'not (starts_with(http.request.uri.path, "/api/"))',
				'not (http.request.uri.path eq "/api")',
				'not (starts_with(http.request.uri.path, "/auth"))',
				'not (starts_with(http.request.uri.path, "/admin"))',
				'not (starts_with(http.request.uri.path, "/app"))',
				'not (starts_with(http.request.uri.path, "/internal"))',
				'not (http.request.uri.query contains "preview=")',
				'not (http.cookie contains "treeseed-content-preview=")',
			]),
			action: 'set_cache_settings',
			action_parameters: {
				cache: true,
				edge_ttl: {
					mode: 'override_origin',
					default: cachePolicy.edgeTtlSeconds,
				},
				browser_ttl: {
					mode: 'override_origin',
					default: cachePolicy.browserTtlSeconds,
				},
			},
			enabled: true,
		},
	);

	return rules;
}

export function reconcileCloudflareCacheRulesForTarget(role, deployConfig, state, cacheTarget, env, { planOnly = false } = {}) {
	const roleKey = role === 'web' ? 'Web' : 'Content';
	if (!cacheTarget?.host) {
		return { managed: false, skipped: true, reason: 'missing_host' };
	}

	const zoneId = resolveCloudflareZoneIdForHost(deployConfig, cacheTarget.host, env);
	if (!zoneId) {
		return { managed: false, skipped: true, reason: 'zone_unresolved' };
	}

	const desiredRules = buildManagedCloudflareCacheRules(deployConfig, cacheTarget, role);
	state.webCache[role === 'web' ? 'webHost' : 'contentHost'] = cacheTarget.host;
	state.webCache[role === 'web' ? 'webZoneId' : 'contentZoneId'] = zoneId;
	if (planOnly) {
		return { managed: true, planOnly: true, zoneId, host: cacheTarget.host, rules: desiredRules };
	}

	const rulesets = listCloudflareZoneRulesets(zoneId, env);
	const existing = rulesets.find((ruleset) => ruleset?.phase === 'http_request_cache_settings') ?? null;
	const prefix = `treeseed-managed:${roleKey.toLowerCase()}:`;
	const unmanagedRules = Array.isArray(existing?.rules)
		? existing.rules.filter((rule) => typeof rule?.description !== 'string' || !rule.description.startsWith(prefix))
		: [];
	const rules = [
		...unmanagedRules,
		...desiredRules.map((rule) => ({ ...rule, description: `${prefix} ${rule.description}` })),
	];
	const payload = existing
		? cloudflareApiRequest(`/zones/${zoneId}/rulesets/${existing.id}`, {
			method: 'PUT',
			body: { rules },
			env,
		})
		: cloudflareApiRequest(`/zones/${zoneId}/rulesets`, {
			method: 'POST',
			body: {
				name: `Treeseed Managed ${roleKey} Cache Rules`,
				kind: 'zone',
				phase: 'http_request_cache_settings',
				rules,
			},
			env,
		});
	const rulesetId = payload?.result?.id ?? existing?.id ?? null;
	state.webCache[role === 'web' ? 'webRulesetId' : 'contentRulesetId'] = rulesetId;
	return { managed: true, zoneId, host: cacheTarget.host, rulesetId };
}

export function reconcileCloudflareWebCacheRules(tenantRoot, deployConfig, state, target, { planOnly = false, env: providedEnv } = {}) {
	if (!shouldManageCloudflareWebCacheRules(deployConfig, target)) {
		const webTarget = resolvePublicWebCacheTarget(deployConfig);
		const contentTarget = resolvePublicContentCacheTarget(deployConfig);
		state.webCache.webHost = webTarget?.host ?? null;
		state.webCache.contentHost = contentTarget?.host ?? null;
		state.webCache.rulesManaged = false;
		state.webCache.lastError = null;
		return { managed: false, skipped: true, reason: 'unsupported_target_or_host' };
	}

	const env = {
		CLOUDFLARE_API_TOKEN: providedEnv?.CLOUDFLARE_API_TOKEN ?? process.env.TREESEED_CLOUDFLARE_API_TOKEN ?? '',
	};
	if (!env.CLOUDFLARE_API_TOKEN) {
		state.webCache.webHost = resolvePublicWebCacheTarget(deployConfig)?.host ?? null;
		state.webCache.contentHost = resolvePublicContentCacheTarget(deployConfig)?.host ?? null;
		state.webCache.rulesManaged = false;
		state.webCache.lastError = 'CLOUDFLARE_API_TOKEN is required to manage Cloudflare Cache Rules.';
		return { managed: false, skipped: true, reason: 'missing_api_token' };
	}

	const webTarget = resolvePublicWebCacheTarget(deployConfig);
	const contentTarget = resolvePublicContentCacheTarget(deployConfig);
	try {
		const results = [];
		if (webTarget?.host) {
			results.push(reconcileCloudflareCacheRulesForTarget('web', deployConfig, state, webTarget, env, { planOnly }));
		}
		if (contentTarget?.host) {
			results.push(reconcileCloudflareCacheRulesForTarget('content', deployConfig, state, contentTarget, env, { planOnly }));
		}
		state.webCache.rulesManaged = true;
		state.webCache.lastSyncedAt = new Date().toISOString();
		state.webCache.lastError = null;
		return { managed: true, results };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (/Authentication error|permission/i.test(message)) {
			state.webCache.rulesManaged = false;
			state.webCache.lastError = message;
			return { managed: false, skipped: true, reason: 'auth_error', error: message };
		}
		throw error;
	}
}

export function purgeCloudflareCacheByUrls(urls, deployConfig, { env } = {}) {
	const uniqueUrls = [...new Set((urls ?? []).filter(Boolean))];
	if (uniqueUrls.length === 0) {
		return [];
	}

	const grouped = new Map();
	for (const urlValue of uniqueUrls) {
		const parsed = safeUrl(urlValue);
		if (!parsed) {
			continue;
		}
		const zoneId = resolveCloudflareZoneIdForHost(deployConfig, parsed.hostname, env);
		if (!zoneId) {
			continue;
		}
		const current = grouped.get(zoneId) ?? [];
		current.push(parsed.toString());
		grouped.set(zoneId, current);
	}

	return [...grouped.entries()].map(([zoneId, files]) => {
		const payload = cloudflareApiRequest(`/zones/${zoneId}/purge_cache`, {
			method: 'POST',
			body: { files: [...new Set(files)] },
			env,
		});
		const errors = Array.isArray(payload?.errors)
			? payload.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).filter(Boolean)
			: [];
		return {
			zoneId,
			count: [...new Set(files)].length,
			success: payload?.success === true,
			errors,
		};
	});
}

export function purgeCloudflareCacheEverythingByHosts(hosts, deployConfig, { env } = {}) {
	const zoneIds = [...new Set((hosts ?? [])
		.map((host) => typeof host === 'string' ? host.trim() : '')
		.filter(Boolean)
		.map((host) => resolveCloudflareZoneIdForHost(deployConfig, host, env))
		.filter(Boolean))];

	return zoneIds.map((zoneId) => {
		const payload = cloudflareApiRequest(`/zones/${zoneId}/purge_cache`, {
			method: 'POST',
			body: { purge_everything: true },
			env,
		});
		const errors = Array.isArray(payload?.errors)
			? payload.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).filter(Boolean)
			: [];
		return {
			zoneId,
			count: 'everything',
			success: payload?.success === true,
			errors,
		};
	});
}
