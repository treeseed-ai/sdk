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
import { GENERATED_ROOT, PERSISTENT_SCOPES, STATE_ROOT, WORKTREE_METADATA_RELATIVE_PATH, envOrNull, primaryHost, resolveConfiguredSurfaceDomain, resolveTreeseedResourceIdentity, sanitizeSegment } from './default-compatibility-date.ts';
import { resolveConfiguredCentralMarketBaseUrl, resolveConfiguredContentBucketName, resolveConfiguredContentPublicBaseUrl, resolveConfiguredMarketBaseUrl } from './assert-cloudflare-cache-purge-succeeded.ts';

export function configuredSurfaceHosts(deployConfig, target, surface) {
	const hosts = [
		resolveConfiguredSurfaceDomain(deployConfig, target, surface),
		surface === 'web' && target.kind === 'persistent' && target.scope === 'prod'
			? primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl)
			: null,
	].filter(Boolean);
	return [...new Set(hosts)];
}

export function sharedDeploymentName(identity, role = '') {
	const roleSegment = role === 'workdayManager'
		? 'workday-manager'
		: role === 'workerRunner'
			? 'worker-runner-01'
			: role;
	return role ? `${identity.deploymentKey}-${sanitizeSegment(roleSegment)}` : identity.deploymentKey;
}

export function environmentScopedIdentityName(identity, role, target) {
	const environmentSegment = target.kind === 'persistent' ? target.scope : sanitizeSegment(target.branchName);
	return `${identity.deploymentKey}-${sanitizeSegment(role)}-${environmentSegment}`;
}

export function normalizePersistentScope(scope = 'prod') {
	if (!PERSISTENT_SCOPES.has(scope)) {
		throw new Error(`Unsupported Treeseed environment "${scope}". Expected one of local, staging, prod.`);
	}
	return scope;
}

export function createPersistentDeployTarget(scope = 'prod') {
	return {
		kind: 'persistent',
		scope: normalizePersistentScope(scope),
	};
}

export function createBranchPreviewDeployTarget(branchName) {
	const normalized = String(branchName ?? '').trim();
	if (!normalized) {
		throw new Error('Branch preview target requires a branch name.');
	}

	return {
		kind: 'branch',
		branchName: normalized,
	};
}

export function normalizeTarget(scopeOrTarget = 'prod') {
	if (!scopeOrTarget || typeof scopeOrTarget === 'string') {
		return createPersistentDeployTarget(scopeOrTarget ?? 'prod');
	}

	if (scopeOrTarget.kind === 'persistent') {
		return createPersistentDeployTarget(scopeOrTarget.scope);
	}

	if (scopeOrTarget.kind === 'branch') {
		return createBranchPreviewDeployTarget(scopeOrTarget.branchName);
	}

	throw new Error('Unsupported Treeseed deployment target.');
}

export function scopeFromTarget(target) {
	return target.kind === 'persistent'
		? target.scope
		: 'staging';
}

export function targetDirectoryParts(target) {
	if (target.kind === 'persistent') {
		return ['environments', target.scope];
	}

	return ['branches', sanitizeSegment(target.branchName)];
}

export function targetKey(target) {
	return target.kind === 'persistent'
		? target.scope
		: `branch:${target.branchName}`;
}

export function resolveManagedWorktreeStateRoot(tenantRoot) {
	const metadataPath = resolve(tenantRoot, WORKTREE_METADATA_RELATIVE_PATH);
	if (!existsSync(metadataPath)) return tenantRoot;
	try {
		const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) ?? {};
		const primaryRoot = metadata.kind === 'treeseed.workflow.worktree' && typeof metadata.primaryRoot === 'string'
			? metadata.primaryRoot
			: null;
		return primaryRoot && existsSync(resolve(primaryRoot, STATE_ROOT))
			? primaryRoot
			: tenantRoot;
	} catch {
		return tenantRoot;
	}
}

export function resolveTargetPaths(tenantRoot, scopeOrTarget = 'prod') {
	const target = normalizeTarget(scopeOrTarget);
	const pathParts = targetDirectoryParts(target);
	const stateRoot = resolveManagedWorktreeStateRoot(tenantRoot);
	const generatedRoot = resolve(tenantRoot, GENERATED_ROOT, ...pathParts);
	const statePath = resolve(stateRoot, STATE_ROOT, ...pathParts, 'deploy.json');

	return {
		target,
		generatedRoot,
		wranglerPath: resolve(generatedRoot, 'wrangler.toml'),
		workerEntryPath: resolve(tenantRoot, 'dist/_worker.js/index.js'),
		statePath,
	};
}

export function deployTargetLabel(scopeOrTarget = 'prod') {
	const target = normalizeTarget(scopeOrTarget);
	return target.kind === 'persistent' ? target.scope : `branch:${target.branchName}`;
}

export function targetWorkerName(deployConfig, target) {
	const identity = resolveTreeseedResourceIdentity(deployConfig, target);
	const configuredBaseName = deployConfig.cloudflare.workerName?.trim();
	const baseName = configuredBaseName && configuredBaseName === deployConfig.slug
		? identity.deploymentKey
		: (configuredBaseName || `${identity.deploymentKey}-edge`);
	if (target.kind === 'persistent') {
		return `${sanitizeSegment(baseName)}-${target.scope}`;
	}
	return `${sanitizeSegment(baseName)}-${sanitizeSegment(target.branchName)}`;
}

export function targetWorkersDevUrl(workerName) {
	return `https://${workerName}.workers.dev`;
}

export function relativeFromGeneratedRoot(targetPath, generatedRoot) {
	return relative(generatedRoot, targetPath).replaceAll('\\', '/');
}

export function resolveContentServingMode(deployConfig, options = {}) {
	const override = envOrNull('TREESEED_CONTENT_SERVING_MODE');
	if (override) {
		return override;
	}
	const target = options.target ? normalizeTarget(options.target) : null;
	if (target?.kind === 'persistent' && target.scope !== 'local') {
		return 'published_runtime';
	}
	return deployConfig.providers?.content?.serving ?? 'local_collections';
}

export function buildPublicVars(deployConfig, options = {}) {
	const target = options.target ? normalizeTarget(options.target) : createPersistentDeployTarget('prod');
	const identity = resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget('prod'));
	const contentRuntimeProvider = deployConfig.providers?.content?.runtime ?? 'team_scoped_r2_overlay';
	const contentPublishProvider = deployConfig.providers?.content?.publish ?? contentRuntimeProvider;
	const contentServingMode = resolveContentServingMode(deployConfig, options);
	const contentDefaultTeamId = identity.teamId;
	const contentManifestKeyTemplate = deployConfig.cloudflare.r2?.manifestKeyTemplate ?? 'teams/{teamId}/published/common.json';
	const contentPreviewRootTemplate = deployConfig.cloudflare.r2?.previewRootTemplate ?? 'teams/{teamId}/previews';
	const contentManifestKey = contentManifestKeyTemplate.replaceAll('{teamId}', contentDefaultTeamId);
	const managedRuntime = deployConfig.runtime?.mode === 'treeseed_managed';
	const workerRailway = deployConfig.services?.worker?.railway ?? {};
	const webCachePolicy = resolveTreeseedWebCachePolicy(deployConfig);
	const projectDomain = target.kind === 'persistent'
		? resolveConfiguredSurfaceDomain(deployConfig, target, 'web')
		: primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl);
	return {
		TREESEED_HOSTING_KIND: deployConfig.hosting?.kind ?? 'self_hosted_project',
		TREESEED_HOSTING_REGISTRATION: deployConfig.hosting?.registration ?? 'none',
		TREESEED_HUB_MODE: deployConfig.hub?.mode ?? 'treeseed_hosted',
		TREESEED_RUNTIME_MODE: deployConfig.runtime?.mode ?? 'none',
		TREESEED_RUNTIME_REGISTRATION: deployConfig.runtime?.registration ?? 'none',
		TREESEED_CENTRAL_MARKET_API_BASE_URL: resolveConfiguredCentralMarketBaseUrl(deployConfig, target),
		TREESEED_MARKET_API_BASE_URL: resolveConfiguredMarketBaseUrl(deployConfig, target),
		TREESEED_API_BASE_URL: resolveConfiguredMarketBaseUrl(deployConfig, target),
		TREESEED_CATALOG_MARKET_API_BASE_URLS: resolveConfiguredMarketBaseUrl(deployConfig, target) ?? envOrNull('TREESEED_CATALOG_MARKET_API_BASE_URLS'),
		TREESEED_HOSTING_TEAM_ID: contentDefaultTeamId,
		TREESEED_PROJECT_DOMAINS: projectDomain ?? '',
		TREESEED_PROJECT_ID: identity.projectId,
		TREESEED_AGENT_EXECUTION_PROVIDER: deployConfig.providers?.agents?.execution ?? 'codex',
		TREESEED_AGENT_REPOSITORY_PROVIDER: deployConfig.providers?.agents?.repository ?? 'git',
		TREESEED_AGENT_VERIFICATION_PROVIDER: deployConfig.providers?.agents?.verification ?? 'local',
		TREESEED_CONTENT_RUNTIME_PROVIDER: contentRuntimeProvider,
		TREESEED_CONTENT_PUBLISH_PROVIDER: contentPublishProvider,
		TREESEED_CONTENT_SERVING_MODE: contentServingMode,
		TREESEED_CONTENT_DEFAULT_TEAM_ID: contentDefaultTeamId,
		TREESEED_CONTENT_MANIFEST_KEY: contentManifestKey,
		TREESEED_CONTENT_MANIFEST_KEY_TEMPLATE: contentManifestKeyTemplate,
		TREESEED_CONTENT_PREVIEW_ROOT_TEMPLATE: contentPreviewRootTemplate,
		TREESEED_EDITORIAL_PREVIEW_ROOT: contentPreviewRootTemplate.replaceAll('{teamId}', contentDefaultTeamId),
		TREESEED_EDITORIAL_PREVIEW_TTL_HOURS: String(deployConfig.cloudflare.r2?.previewTtlHours ?? 168),
		TREESEED_CONTENT_BUCKET_NAME: resolveConfiguredContentBucketName(deployConfig),
		TREESEED_CONTENT_PUBLIC_BASE_URL: resolveConfiguredContentPublicBaseUrl(deployConfig),
		TREESEED_WORKDAY_TIMEZONE: envOrNull('TREESEED_WORKDAY_TIMEZONE') ?? '',
		TREESEED_WORKDAY_WINDOWS_JSON: envOrNull('TREESEED_WORKDAY_WINDOWS_JSON') ?? '',
		TREESEED_WORKDAY_TASK_CREDIT_BUDGET: envOrNull('TREESEED_WORKDAY_TASK_CREDIT_BUDGET') ?? '',
		TREESEED_MANAGER_MAX_QUEUED_TASKS: envOrNull('TREESEED_MANAGER_MAX_QUEUED_TASKS') ?? '',
		TREESEED_MANAGER_MAX_QUEUED_CREDITS: envOrNull('TREESEED_MANAGER_MAX_QUEUED_CREDITS') ?? '',
		TREESEED_MANAGER_PRIORITY_MODELS: envOrNull('TREESEED_MANAGER_PRIORITY_MODELS') ?? '',
		TREESEED_TASK_CREDIT_WEIGHTS_JSON: envOrNull('TREESEED_TASK_CREDIT_WEIGHTS_JSON') ?? '',
		TREESEED_RAILWAY_PROJECT_ID: envOrNull('TREESEED_RAILWAY_PROJECT_ID') ?? workerRailway.projectId ?? '',
		TREESEED_RAILWAY_ENVIRONMENT_ID: envOrNull('TREESEED_RAILWAY_ENVIRONMENT_ID') ?? '',
		TREESEED_PUBLIC_TURNSTILE_SITE_KEY: envOrNull('TREESEED_PUBLIC_TURNSTILE_SITE_KEY') ?? '',
		TREESEED_AUTH_EMAIL_FROM: envOrNull('TREESEED_AUTH_EMAIL_FROM') ?? '',
		TREESEED_AUTH_EMAIL_REPLY_TO: envOrNull('TREESEED_AUTH_EMAIL_REPLY_TO') ?? '',
		TREESEED_SMTP_HOST: envOrNull('TREESEED_SMTP_HOST') ?? '',
		TREESEED_SMTP_PORT: envOrNull('TREESEED_SMTP_PORT') ?? '',
		TREESEED_SMTP_USERNAME: envOrNull('TREESEED_SMTP_USERNAME') ?? '',
		TREESEED_SMTP_FROM: envOrNull('TREESEED_SMTP_FROM') ?? '',
		TREESEED_SMTP_REPLY_TO: envOrNull('TREESEED_SMTP_REPLY_TO') ?? '',
		TREESEED_SMTP_SECURE: envOrNull('TREESEED_SMTP_SECURE') ?? '',
		TREESEED_WEB_CACHE_SOURCE_BROWSER_TTL_SECONDS: String(webCachePolicy.sourcePages.browserTtlSeconds),
		TREESEED_WEB_CACHE_SOURCE_EDGE_TTL_SECONDS: String(webCachePolicy.sourcePages.edgeTtlSeconds),
		TREESEED_WEB_CACHE_SOURCE_STALE_WHILE_REVALIDATE_SECONDS: String(webCachePolicy.sourcePages.staleWhileRevalidateSeconds),
		TREESEED_WEB_CACHE_SOURCE_STALE_IF_ERROR_SECONDS: String(webCachePolicy.sourcePages.staleIfErrorSeconds),
		TREESEED_WEB_CACHE_CONTENT_BROWSER_TTL_SECONDS: String(webCachePolicy.contentPages.browserTtlSeconds),
		TREESEED_WEB_CACHE_CONTENT_EDGE_TTL_SECONDS: String(webCachePolicy.contentPages.edgeTtlSeconds),
		TREESEED_WEB_CACHE_CONTENT_STALE_WHILE_REVALIDATE_SECONDS: String(webCachePolicy.contentPages.staleWhileRevalidateSeconds),
		TREESEED_WEB_CACHE_CONTENT_STALE_IF_ERROR_SECONDS: String(webCachePolicy.contentPages.staleIfErrorSeconds),
		TREESEED_WEB_CACHE_R2_BROWSER_TTL_SECONDS: String(webCachePolicy.r2PublishedObjects.browserTtlSeconds),
		TREESEED_WEB_CACHE_R2_EDGE_TTL_SECONDS: String(webCachePolicy.r2PublishedObjects.edgeTtlSeconds),
		TREESEED_WEB_CACHE_R2_STALE_WHILE_REVALIDATE_SECONDS: String(webCachePolicy.r2PublishedObjects.staleWhileRevalidateSeconds),
		TREESEED_WEB_CACHE_R2_STALE_IF_ERROR_SECONDS: String(webCachePolicy.r2PublishedObjects.staleIfErrorSeconds),
	};
}

export function envValue(env, key) {
	const value = env?.[key] ?? process.env[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}
