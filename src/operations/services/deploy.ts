import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveTreeseedWebCachePolicy } from '../../platform/deploy-config.ts';
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
} from './railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from './runtime-tools.ts';
import { sdkD1MigrationsRoot } from './runtime-paths.ts';

const DEFAULT_COMPATIBILITY_DATE = '2026-04-05';
const DEFAULT_COMPATIBILITY_FLAGS = ['nodejs_compat'];
const DEFAULT_TREESEED_MARKET_BASE_URL = 'https://api.treeseed.dev';
const GENERATED_ROOT = '.treeseed/generated';
const STATE_ROOT = '.treeseed/state';
const WORKTREE_METADATA_RELATIVE_PATH = '.treeseed/worktree.json';
const PERSISTENT_SCOPES = new Set(['local', 'staging', 'prod']);
const MANAGED_SERVICE_KEYS = ['api'];
const TRESEED_ENVELOPE_SCHEMA_GENERATION = 'runtime-envelopes-v1';
const TRESEED_MIGRATION_WAVE_ID = '0005_runtime_envelopes';
const TRESEED_SUPPORTED_PAYLOAD_RANGE = { min: 1, max: 1 };

function sleepSync(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function ensureParent(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

function stableHash(value) {
	return createHash('sha256').update(value).digest('hex');
}

function compactDeploymentKey(input) {
	const rawKey = sanitizeResourceKey(input.rawKey ?? '');
	if (rawKey && rawKey.length <= 40) return rawKey;
	const base = sanitizeSegment(input.slug ?? input.projectSegment ?? 'project').slice(0, 27) || 'project';
	const hash = stableHash(`${input.teamId ?? ''}:${input.projectId ?? ''}:${input.slug ?? ''}`).slice(0, 8);
	return `${base}-${hash}`;
}

function readJson(filePath, fallback) {
	if (!existsSync(filePath)) {
		return fallback;
	}

	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}

function writeJson(filePath, value) {
	ensureParent(filePath);
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function renderTomlString(value) {
	return JSON.stringify(String(value));
}

function envOrNull(key) {
	const value = process.env[key];
	return typeof value === 'string' && value.length ? value : null;
}

function loadTenantDeployConfig(tenantRoot) {
	return loadCliDeployConfig(tenantRoot);
}

function sanitizeSegment(value) {
	return String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 36) || 'default';
}

function sanitizeResourceKey(value) {
	return String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '');
}

function requireConfiguredIdentityValue(value, label) {
	const normalized = typeof value === 'string' && value.trim() ? value.trim() : '';
	if (!normalized) {
		throw new Error(`Configure ${label} before reconciling multi-tenant resources.`);
	}
	return normalized;
}

export function resolveTreeseedResourceIdentity(deployConfig, target) {
	const teamId = requireConfiguredIdentityValue(
		envOrNull('TREESEED_HOSTING_TEAM_ID')
			?? deployConfig.runtime?.teamId
			?? deployConfig.hosting?.teamId,
		'hosting.teamId or runtime.teamId in treeseed.site.yaml',
	);
	const projectId = requireConfiguredIdentityValue(
		envOrNull('TREESEED_PROJECT_ID')
			?? deployConfig.runtime?.projectId
			?? deployConfig.hosting?.projectId,
		'hosting.projectId or runtime.projectId in treeseed.site.yaml',
	);
	const teamSegment = sanitizeSegment(teamId);
	const projectSegment = sanitizeSegment(projectId);
	const deploymentKey = compactDeploymentKey({
		rawKey: `${teamSegment}-${projectSegment}`,
		teamId,
		projectId,
		projectSegment,
		slug: deployConfig.slug,
	});
	const environment = target.kind === 'persistent' ? target.scope : target.branchName;
	const environmentSegment = target.kind === 'persistent' ? target.scope : sanitizeSegment(target.branchName);
	return {
		teamId,
		projectId,
		slug: deployConfig.slug,
		environment,
		deploymentKey,
		environmentKey: `${deploymentKey}-${environmentSegment}`,
	};
}

function primaryHost(value) {
	return safeUrl(value)?.hostname ?? null;
}

function domainZoneFromConfiguredWebDomain(domain) {
	if (typeof domain !== 'string' || !domain.trim()) {
		return null;
	}
	return domain.trim().replace(/^api\./u, '');
}

function resolveSurfaceDomainZone(deployConfig) {
	return domainZoneFromConfiguredWebDomain(
		deployConfig.surfaces?.web?.environments?.prod?.domain
		?? primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl),
	);
}

function deriveStagingDomainHash(identity, surface) {
	return stableHash(`${identity.teamId}:${identity.projectId}:${identity.slug}:${surface}:staging`).slice(0, 8);
}

export function deriveTreeseedStagingSurfaceDomain(deployConfig, identity, surface) {
	const zone = resolveSurfaceDomainZone(deployConfig);
	if (!zone) {
		return null;
	}
	const hash = deriveStagingDomainHash(identity, surface);
	return surface === 'web'
		? `${identity.deploymentKey}-staging-${hash}.${zone}`
		: `api-${identity.deploymentKey}-staging-${hash}.${zone}`;
}

function deriveApiDomainFromWebDomain(domain) {
	if (!domain) {
		return null;
	}
	return domain.startsWith('api.') ? domain : `api.${domain}`;
}

function configuredApiConnectionDomain(deployConfig, scope) {
	const apiConnection = deployConfig.connections?.api?.environments?.[scope];
	const domain = apiConnection?.domain?.trim();
	if (domain) {
		return domain;
	}
	const connectionBaseUrl = primaryHost(apiConnection?.baseUrl);
	if (connectionBaseUrl) {
		return connectionBaseUrl;
	}
	const serviceDomain = deployConfig.services?.api?.environments?.[scope]?.domain?.trim();
	if (serviceDomain) {
		return serviceDomain;
	}
	return primaryHost(
		deployConfig.services?.api?.environments?.[scope]?.baseUrl
		?? deployConfig.services?.api?.publicBaseUrl,
	);
}

export function resolveConfiguredSurfaceDomain(deployConfig, target, surface) {
	if (target.kind !== 'persistent') {
		return null;
	}
	const scope = target.scope;
	const configured = deployConfig.surfaces?.[surface]?.environments?.[scope]?.domain?.trim();
	if (configured) {
		return configured;
	}
	if (surface === 'api') {
		const apiConnectionDomain = configuredApiConnectionDomain(deployConfig, scope);
		if (apiConnectionDomain) {
			return apiConnectionDomain;
		}
	}
	if (scope === 'staging') {
		return deriveTreeseedStagingSurfaceDomain(
			deployConfig,
			resolveTreeseedResourceIdentity(deployConfig, target),
			surface,
		);
	}
	if (scope !== 'prod') {
		return null;
	}
	if (surface === 'web') {
		return primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl);
	}
	return deriveApiDomainFromWebDomain(resolveConfiguredSurfaceDomain(deployConfig, target, 'web'));
}

export function resolveConfiguredSurfaceBaseUrl(deployConfig, target, surface) {
	if (surface === 'api') {
		const scope = scopeFromTarget(target);
		const apiConnection = deployConfig.connections?.api?.environments?.[scope];
		const connectionBaseUrl = apiConnection?.baseUrl
			?? (apiConnection?.domain ? `https://${apiConnection.domain}` : null);
		if (connectionBaseUrl) {
			return connectionBaseUrl;
		}
	}
	const configuredDomain = resolveConfiguredSurfaceDomain(deployConfig, target, surface);
	if (configuredDomain) {
		return `https://${configuredDomain}`;
	}
	if (surface === 'web') {
		return deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl ?? null;
	}
	if (surface === 'api') {
		const scope = scopeFromTarget(target);
		return deployConfig.services?.api?.environments?.[scope]?.baseUrl
			?? deployConfig.services?.api?.publicBaseUrl
			?? null;
	}
	return null;
}

function configuredSurfaceHosts(deployConfig, target, surface) {
	const hosts = [
		resolveConfiguredSurfaceDomain(deployConfig, target, surface),
		surface === 'web' && target.kind === 'persistent' && target.scope === 'prod'
			? primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl)
			: null,
	].filter(Boolean);
	return [...new Set(hosts)];
}

function sharedDeploymentName(identity, role = '') {
	const roleSegment = role === 'workdayManager'
		? 'workday-manager'
		: role === 'workerRunner'
			? 'worker-runner-01'
			: role;
	return role ? `${identity.deploymentKey}-${sanitizeSegment(roleSegment)}` : identity.deploymentKey;
}

function environmentScopedIdentityName(identity, role, target) {
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

function normalizeTarget(scopeOrTarget = 'prod') {
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

function targetDirectoryParts(target) {
	if (target.kind === 'persistent') {
		return ['environments', target.scope];
	}

	return ['branches', sanitizeSegment(target.branchName)];
}

function targetKey(target) {
	return target.kind === 'persistent'
		? target.scope
		: `branch:${target.branchName}`;
}

function resolveManagedWorktreeStateRoot(tenantRoot) {
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

function resolveTargetPaths(tenantRoot, scopeOrTarget = 'prod') {
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

function targetWorkerName(deployConfig, target) {
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

function targetWorkersDevUrl(workerName) {
	return `https://${workerName}.workers.dev`;
}

function relativeFromGeneratedRoot(targetPath, generatedRoot) {
	return relative(generatedRoot, targetPath).replaceAll('\\', '/');
}

function resolveContentServingMode(deployConfig, options = {}) {
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
		TREESEED_WORKER_POOL_SCALER: envOrNull('TREESEED_WORKER_POOL_SCALER') ?? (managedRuntime ? 'railway' : ''),
		TREESEED_WORKDAY_TIMEZONE: envOrNull('TREESEED_WORKDAY_TIMEZONE') ?? '',
		TREESEED_WORKDAY_WINDOWS_JSON: envOrNull('TREESEED_WORKDAY_WINDOWS_JSON') ?? '',
		TREESEED_WORKDAY_TASK_CREDIT_BUDGET: envOrNull('TREESEED_WORKDAY_TASK_CREDIT_BUDGET') ?? '',
		TREESEED_MANAGER_MAX_QUEUED_TASKS: envOrNull('TREESEED_MANAGER_MAX_QUEUED_TASKS') ?? '',
		TREESEED_MANAGER_MAX_QUEUED_CREDITS: envOrNull('TREESEED_MANAGER_MAX_QUEUED_CREDITS') ?? '',
		TREESEED_MANAGER_PRIORITY_MODELS: envOrNull('TREESEED_MANAGER_PRIORITY_MODELS') ?? '',
		TREESEED_TASK_CREDIT_WEIGHTS_JSON: envOrNull('TREESEED_TASK_CREDIT_WEIGHTS_JSON') ?? '',
		TREESEED_AGENT_POOL_MIN_WORKERS: envOrNull('TREESEED_AGENT_POOL_MIN_WORKERS') ?? '',
		TREESEED_AGENT_POOL_MAX_WORKERS: envOrNull('TREESEED_AGENT_POOL_MAX_WORKERS') ?? '',
		TREESEED_AGENT_POOL_TARGET_QUEUE_DEPTH: envOrNull('TREESEED_AGENT_POOL_TARGET_QUEUE_DEPTH') ?? '',
		TREESEED_AGENT_POOL_COOLDOWN_SECONDS: envOrNull('TREESEED_AGENT_POOL_COOLDOWN_SECONDS') ?? '',
		TREESEED_RAILWAY_PROJECT_ID: envOrNull('TREESEED_RAILWAY_PROJECT_ID') ?? workerRailway.projectId ?? '',
		TREESEED_RAILWAY_ENVIRONMENT_ID: envOrNull('TREESEED_RAILWAY_ENVIRONMENT_ID') ?? '',
		TREESEED_RAILWAY_WORKER_SERVICE_ID: envOrNull('TREESEED_RAILWAY_WORKER_SERVICE_ID') ?? workerRailway.serviceId ?? '',
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

function envValue(env, key) {
	const value = env?.[key] ?? process.env[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

const LOCAL_RUNTIME_AUTH_ENV_KEYS = [
	'TREESEED_BETTER_AUTH_URL',
	'TREESEED_SITE_URL',
	'TREESEED_AUTH_MODE',
	'TREESEED_AUTH_INTERNAL_SIGNUP',
	'TREESEED_AUTH_EMAIL_LINKING',
	'TREESEED_AUTH_ALLOW_MEMORY_DB',
	'TREESEED_AUTH_EMAIL_FROM',
	'TREESEED_WEB_SESSION_TTL',
	'TREESEED_API_BOOTSTRAP_ADMIN_ALLOWLIST',
	'TREESEED_API_AUTH_SECRET',
	'TREESEED_API_ISSUER',
	'TREESEED_API_ACCESS_TOKEN_TTL',
	'TREESEED_API_REFRESH_TOKEN_TTL',
	'TREESEED_API_DEVICE_CODE_TTL',
	'TREESEED_API_DEVICE_ACCESS_TOKEN_TTL',
	'TREESEED_API_DEVICE_POLL_INTERVAL',
	'TREESEED_API_WEB_SERVICE_ID',
	'TREESEED_API_WEB_SERVICE_SECRET',
	'TREESEED_API_WEB_EXCHANGE_TTL',
	'TREESEED_PLATFORM_RUNNER_SECRET',
	'TREESEED_AUTH_GITHUB_CLIENT_ID',
	'TREESEED_AUTH_GITHUB_CLIENT_SECRET',
	'TREESEED_AUTH_GOOGLE_CLIENT_ID',
	'TREESEED_AUTH_GOOGLE_CLIENT_SECRET',
	'TREESEED_AUTH_MICROSOFT_CLIENT_ID',
	'TREESEED_AUTH_MICROSOFT_CLIENT_SECRET',
	'TREESEED_AUTH_APPLE_CLIENT_ID',
	'TREESEED_AUTH_APPLE_CLIENT_SECRET',
];

function localAuthRuntimeVars(env) {
	return Object.fromEntries(
		LOCAL_RUNTIME_AUTH_ENV_KEYS
			.map((key) => [key, envValue(env, key)])
			.filter(([, value]) => value != null),
	);
}

function buildLocalRuntimeVars(deployConfig, state, target, env) {
	if (target.kind !== 'persistent' || target.scope !== 'local') {
		return {};
	}

	const localDevAuthTtlSeconds = String(365 * 24 * 60 * 60);
	return {
		...localAuthRuntimeVars(env),
		TREESEED_LOCAL_DEV_MODE: envValue(env, 'TREESEED_LOCAL_DEV_MODE') ?? 'cloudflare',
		TREESEED_API_ACCESS_TOKEN_TTL: envValue(env, 'TREESEED_API_ACCESS_TOKEN_TTL') ?? localDevAuthTtlSeconds,
		TREESEED_API_REFRESH_TOKEN_TTL: envValue(env, 'TREESEED_API_REFRESH_TOKEN_TTL') ?? localDevAuthTtlSeconds,
		TREESEED_FORM_TOKEN_SECRET:
			envValue(env, 'TREESEED_FORM_TOKEN_SECRET')
			?? state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET
			?? 'treeseed-local-form-token-secret',
		TREESEED_BETTER_AUTH_SECRET:
			envValue(env, 'TREESEED_BETTER_AUTH_SECRET')
			?? state.generatedSecrets?.TREESEED_BETTER_AUTH_SECRET
			?? state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET
			?? 'treeseed-local-better-auth-secret-minimum-32-characters',
		TREESEED_EDITORIAL_PREVIEW_SECRET:
			envValue(env, 'TREESEED_EDITORIAL_PREVIEW_SECRET')
			?? state.generatedSecrets?.TREESEED_EDITORIAL_PREVIEW_SECRET
			?? 'treeseed-local-editorial-preview-secret',
		TREESEED_FORMS_LOCAL_BYPASS_CLOUDFLARE_GUARDS: envValue(env, 'TREESEED_FORMS_LOCAL_BYPASS_CLOUDFLARE_GUARDS') ?? '',
		TREESEED_MAILPIT_SMTP_HOST: '127.0.0.1',
		TREESEED_MAILPIT_SMTP_PORT: '1025',
		TREESEED_SMTP_HOST: '127.0.0.1',
		TREESEED_SMTP_PORT: '1025',
		TREESEED_SMTP_USERNAME: '',
		TREESEED_SMTP_PASSWORD: '',
	};
}

export function buildSecretMap(deployConfig, state) {
	const generatedSecret = state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET ?? randomBytes(24).toString('hex');
	const previewSecret = state.generatedSecrets?.TREESEED_EDITORIAL_PREVIEW_SECRET ?? randomBytes(24).toString('hex');
	return {
		TREESEED_FORM_TOKEN_SECRET: envOrNull('TREESEED_FORM_TOKEN_SECRET') ?? generatedSecret,
		TREESEED_EDITORIAL_PREVIEW_SECRET: envOrNull('TREESEED_EDITORIAL_PREVIEW_SECRET') ?? previewSecret,
		TREESEED_TURNSTILE_SECRET_KEY: state.turnstileWidgets?.formGuard?.secret ?? envOrNull('TREESEED_TURNSTILE_SECRET_KEY'),
		TREESEED_SMTP_PASSWORD: envOrNull('TREESEED_SMTP_PASSWORD'),
	};
}

function defaultStateFromConfig(deployConfig, target) {
	const identity = resolveTreeseedResourceIdentity(deployConfig, target);
	const workerName = targetWorkerName(deployConfig, target);
	const suffix = target.kind === 'persistent' ? target.scope : sanitizeSegment(target.branchName);
	const contentManifestKeyTemplate = deployConfig.cloudflare.r2?.manifestKeyTemplate ?? 'teams/{teamId}/published/common.json';
	const contentPreviewRootTemplate = deployConfig.cloudflare.r2?.previewRootTemplate ?? 'teams/{teamId}/previews';
	const contentDefaultTeamId = identity.teamId;
	const contentManifestKey = contentManifestKeyTemplate.replaceAll('{teamId}', contentDefaultTeamId);
	const turnstileName = environmentScopedIdentityName(identity, 'turnstile', target);
	const turnstileDomains = configuredSurfaceHosts(deployConfig, target, 'web');

	return {
		version: 2,
		target,
		identity,
		previewEnabled: target.kind === 'branch',
		workerName,
		kvNamespaces: {
			FORM_GUARD_KV: {
				name: environmentScopedIdentityName(identity, 'form-guard', target),
				binding: 'FORM_GUARD_KV',
				id: `dryrun-${suffix}-form-guard`,
				previewId: `dryrun-${suffix}-form-guard-preview`,
			},
		},
		d1Databases: {
			SITE_DATA_DB: {
				databaseName: environmentScopedIdentityName(identity, 'site-data', target),
				binding: 'SITE_DATA_DB',
				databaseId: `dryrun-${suffix}-site-data`,
				previewDatabaseId: `dryrun-${suffix}-site-data-preview`,
			},
		},
		queues: {},
		pages: {
			projectName: resolveConfiguredPagesProjectName(deployConfig),
			productionBranch: deployConfig.cloudflare.pages?.productionBranch ?? 'main',
			stagingBranch: deployConfig.cloudflare.pages?.stagingBranch ?? 'staging',
			buildOutputDir: deployConfig.cloudflare.pages?.buildOutputDir ?? 'dist',
			url: resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'web'),
		},
		turnstileWidgets: {
			formGuard: {
				name: turnstileName,
				sitekey: null,
				secret: null,
				mode: 'managed',
				domains: turnstileDomains,
				managed: true,
				lastSyncedAt: null,
			},
		},
		content: {
			runtimeProvider: deployConfig.providers?.content?.runtime ?? 'team_scoped_r2_overlay',
			publishProvider: deployConfig.providers?.content?.publish ?? deployConfig.providers?.content?.runtime ?? 'team_scoped_r2_overlay',
			defaultTeamId: contentDefaultTeamId,
			r2Binding: resolveConfiguredContentBucketBinding(deployConfig),
			bucketName: resolveConfiguredContentBucketName(deployConfig),
			publicBaseUrl: resolveConfiguredContentPublicBaseUrl(deployConfig) || null,
			manifestKeyTemplate: contentManifestKeyTemplate,
			previewRootTemplate: contentPreviewRootTemplate,
			previewTtlHours: deployConfig.cloudflare.r2?.previewTtlHours ?? 168,
			manifestKey: contentManifestKey,
			lastPublishedManifestRevision: null,
			lastPublishedManifestSha256: null,
		},
		hosting: {
			kind: deployConfig.hosting?.kind ?? 'self_hosted_project',
			registration: deployConfig.hosting?.registration ?? 'none',
			marketBaseUrl: resolveConfiguredMarketBaseUrl(deployConfig) || null,
			teamId: identity.teamId,
			projectId: identity.projectId,
		},
		hub: {
			mode: deployConfig.hub?.mode ?? 'treeseed_hosted',
		},
		runtime: {
			mode: deployConfig.runtime?.mode ?? 'none',
			registration: deployConfig.runtime?.registration ?? 'none',
			marketBaseUrl: resolveConfiguredMarketBaseUrl(deployConfig) || null,
			teamId: identity.teamId,
			projectId: identity.projectId,
		},
		webCache: {
			webHost: null,
			contentHost: null,
			webZoneId: null,
			contentZoneId: null,
			webRulesetId: null,
			contentRulesetId: null,
			rulesManaged: false,
			lastSyncedAt: null,
			lastVerifiedAt: null,
			lastError: null,
			deployPurge: {
				lastPurgedAt: null,
				purgeCount: 0,
				lastError: null,
			},
			contentPurge: {
				lastPurgedAt: null,
				purgeCount: 0,
				lastError: null,
			},
		},
		generatedSecrets: {},
		readiness: {
			phase: 'pending',
			configured: false,
			provisioned: false,
			deployable: false,
			initialized: false,
			initializedAt: null,
			lastValidatedAt: null,
			lastConfigFingerprint: null,
			blockers: [],
			warnings: [],
			lastValidationSummary: null,
		},
		lastDeployedUrl: target.kind === 'branch' ? targetWorkersDevUrl(workerName) : resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'web'),
		lastManifestFingerprint: null,
		lastDeploymentTimestamp: null,
		lastDeployedCommit: null,
		services: Object.fromEntries(
			MANAGED_SERVICE_KEYS.map((serviceKey) => {
				const serviceConfig = deployConfig.services?.[serviceKey];
				const scope = scopeFromTarget(target);
				const baseUrl = serviceKey === 'api'
					? (resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'api')
						?? serviceConfig?.environments?.[scope]?.baseUrl
						?? serviceConfig?.publicBaseUrl
						?? null)
					: (serviceConfig?.environments?.[scope]?.baseUrl ?? serviceConfig?.publicBaseUrl ?? null);
				return [
					serviceKey,
					{
						enabled: serviceConfig?.enabled !== false && Boolean(serviceConfig),
						provider: serviceConfig?.provider ?? (serviceConfig ? 'railway' : 'none'),
						projectId: serviceConfig?.railway?.projectId ?? null,
						projectName: serviceConfig?.railway?.projectName ?? sharedDeploymentName(identity),
						serviceId: serviceConfig?.railway?.serviceId ?? null,
						serviceName: serviceConfig?.railway?.serviceName ?? sharedDeploymentName(identity, serviceKey),
						workerName: serviceConfig?.cloudflare?.workerName ?? null,
						rootDir: serviceConfig?.railway?.rootDir ?? serviceConfig?.rootDir ?? null,
						environment: normalizeRailwayEnvironmentName(serviceConfig?.environments?.[scope]?.railwayEnvironment ?? scope),
						schedule: serviceConfig?.railway?.schedule ?? null,
						publicBaseUrl: baseUrl,
						initialized: false,
						lastDeploymentTimestamp: null,
						lastDeployedUrl: baseUrl,
						lastDeploymentCommand: null,
						lastScheduleSyncAt: null,
					},
				];
			}),
		),
		railwaySchedules: {},
		runtimeCompatibility: {
			envelopeSchemaGeneration: TRESEED_ENVELOPE_SCHEMA_GENERATION,
			migrationWaveId: TRESEED_MIGRATION_WAVE_ID,
			supportedPayloadVersionRange: TRESEED_SUPPORTED_PAYLOAD_RANGE,
		},
		deploymentHistory: [],
	};
}

export function loadDeployState(tenantRoot, deployConfig, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const defaults = defaultStateFromConfig(deployConfig, target);
	const { statePath } = resolveTargetPaths(tenantRoot, target);
	const persisted = readJson(statePath, {});
	const persistedSiteDataDb = persisted.d1Databases?.SITE_DATA_DB ?? persisted.d1Databases?.SUBSCRIBERS_DB ?? {};
	const merged = {
		...defaults,
		...persisted,
		target,
		identity: {
			...(defaults.identity ?? {}),
			...(persisted.identity ?? {}),
			teamId: defaults.identity?.teamId,
			projectId: defaults.identity?.projectId,
			slug: defaults.identity?.slug,
			environment: defaults.identity?.environment,
			deploymentKey: defaults.identity?.deploymentKey,
			environmentKey: defaults.identity?.environmentKey,
		},
		previewEnabled: persisted.previewEnabled ?? defaults.previewEnabled,
		workerName: defaults.workerName,
		kvNamespaces: {
			...defaults.kvNamespaces,
			FORM_GUARD_KV: {
				...defaults.kvNamespaces.FORM_GUARD_KV,
				...(persisted.kvNamespaces?.FORM_GUARD_KV ?? {}),
				name: defaults.kvNamespaces.FORM_GUARD_KV.name,
				binding: defaults.kvNamespaces.FORM_GUARD_KV.binding,
			},
			...(persisted.kvNamespaces?.SESSION ? { SESSION: persisted.kvNamespaces.SESSION } : {}),
		},
		d1Databases: {
			...defaults.d1Databases,
			...(persisted.d1Databases ?? {}),
			SITE_DATA_DB: {
				...defaults.d1Databases.SITE_DATA_DB,
				...persistedSiteDataDb,
				databaseName: defaults.d1Databases.SITE_DATA_DB.databaseName,
				binding: defaults.d1Databases.SITE_DATA_DB.binding,
			},
		},
		queues: {},
		generatedSecrets: {
			...(defaults.generatedSecrets ?? {}),
			...(persisted.generatedSecrets ?? {}),
		},
		turnstileWidgets: {
			...(defaults.turnstileWidgets ?? {}),
			...(persisted.turnstileWidgets ?? {}),
			formGuard: {
				...(defaults.turnstileWidgets?.formGuard ?? {}),
				...(persisted.turnstileWidgets?.formGuard ?? {}),
				name: defaults.turnstileWidgets?.formGuard?.name ?? persisted.turnstileWidgets?.formGuard?.name ?? null,
				mode: 'managed',
				managed: true,
				domains: [
					...new Set([
						...(Array.isArray(defaults.turnstileWidgets?.formGuard?.domains) ? defaults.turnstileWidgets.formGuard.domains : []),
						...(Array.isArray(persisted.turnstileWidgets?.formGuard?.domains) ? persisted.turnstileWidgets.formGuard.domains : []),
					].filter(Boolean)),
				],
			},
		},
		content: {
			...(defaults.content ?? {}),
			...(persisted.content ?? {}),
			runtimeProvider: defaults.content?.runtimeProvider ?? persisted.content?.runtimeProvider ?? 'team_scoped_r2_overlay',
			publishProvider: defaults.content?.publishProvider ?? persisted.content?.publishProvider ?? 'team_scoped_r2_overlay',
			defaultTeamId: defaults.content?.defaultTeamId ?? persisted.content?.defaultTeamId ?? defaults.identity?.teamId,
			r2Binding: defaults.content?.r2Binding ?? persisted.content?.r2Binding ?? null,
			bucketName: defaults.content?.bucketName ?? persisted.content?.bucketName ?? null,
			publicBaseUrl: defaults.content?.publicBaseUrl ?? persisted.content?.publicBaseUrl ?? null,
			manifestKeyTemplate: defaults.content?.manifestKeyTemplate ?? persisted.content?.manifestKeyTemplate ?? 'teams/{teamId}/published/common.json',
			previewRootTemplate: defaults.content?.previewRootTemplate ?? persisted.content?.previewRootTemplate ?? 'teams/{teamId}/previews',
			previewTtlHours: defaults.content?.previewTtlHours ?? persisted.content?.previewTtlHours ?? 168,
			manifestKey: defaults.content?.manifestKey ?? persisted.content?.manifestKey ?? `teams/${defaults.identity?.teamId}/published/common.json`,
			lastPublishedManifestRevision: persisted.content?.lastPublishedManifestRevision ?? defaults.content?.lastPublishedManifestRevision ?? null,
			lastPublishedManifestSha256: persisted.content?.lastPublishedManifestSha256 ?? defaults.content?.lastPublishedManifestSha256 ?? null,
		},
		hosting: {
			...(defaults.hosting ?? {}),
			...(persisted.hosting ?? {}),
			kind: defaults.hosting?.kind ?? persisted.hosting?.kind ?? 'self_hosted_project',
			registration: defaults.hosting?.registration ?? persisted.hosting?.registration ?? 'none',
			marketBaseUrl: defaults.hosting?.marketBaseUrl ?? persisted.hosting?.marketBaseUrl ?? null,
			teamId: defaults.hosting?.teamId ?? persisted.hosting?.teamId ?? defaults.identity?.teamId,
			projectId: defaults.hosting?.projectId ?? persisted.hosting?.projectId ?? defaults.identity?.projectId,
		},
		hub: {
			...(defaults.hub ?? {}),
			...(persisted.hub ?? {}),
			mode: defaults.hub?.mode ?? persisted.hub?.mode ?? 'treeseed_hosted',
		},
		runtime: {
			...(defaults.runtime ?? {}),
			...(persisted.runtime ?? {}),
			mode: defaults.runtime?.mode ?? persisted.runtime?.mode ?? 'none',
			registration: defaults.runtime?.registration ?? persisted.runtime?.registration ?? 'none',
			marketBaseUrl: defaults.runtime?.marketBaseUrl ?? persisted.runtime?.marketBaseUrl ?? null,
			teamId: defaults.runtime?.teamId ?? persisted.runtime?.teamId ?? defaults.identity?.teamId,
			projectId: defaults.runtime?.projectId ?? persisted.runtime?.projectId ?? defaults.identity?.projectId,
		},
		webCache: {
			...(defaults.webCache ?? {}),
			...(persisted.webCache ?? {}),
			webHost: persisted.webCache?.webHost ?? persisted.webCache?.publicHost ?? defaults.webCache?.webHost ?? null,
			contentHost: persisted.webCache?.contentHost ?? defaults.webCache?.contentHost ?? null,
			webZoneId: persisted.webCache?.webZoneId ?? persisted.webCache?.zoneId ?? defaults.webCache?.webZoneId ?? null,
			contentZoneId: persisted.webCache?.contentZoneId ?? defaults.webCache?.contentZoneId ?? null,
			webRulesetId: persisted.webCache?.webRulesetId ?? persisted.webCache?.rulesetId ?? defaults.webCache?.webRulesetId ?? null,
			contentRulesetId: persisted.webCache?.contentRulesetId ?? defaults.webCache?.contentRulesetId ?? null,
			rulesManaged: persisted.webCache?.rulesManaged ?? defaults.webCache?.rulesManaged ?? false,
			lastSyncedAt: persisted.webCache?.lastSyncedAt ?? defaults.webCache?.lastSyncedAt ?? null,
			lastVerifiedAt: persisted.webCache?.lastVerifiedAt ?? defaults.webCache?.lastVerifiedAt ?? null,
			lastError: persisted.webCache?.lastError ?? defaults.webCache?.lastError ?? null,
			deployPurge: {
				...(defaults.webCache?.deployPurge ?? {}),
				...(persisted.webCache?.deployPurge ?? {}),
				lastPurgedAt: persisted.webCache?.deployPurge?.lastPurgedAt ?? defaults.webCache?.deployPurge?.lastPurgedAt ?? null,
				purgeCount: persisted.webCache?.deployPurge?.purgeCount ?? defaults.webCache?.deployPurge?.purgeCount ?? 0,
				lastError: persisted.webCache?.deployPurge?.lastError ?? defaults.webCache?.deployPurge?.lastError ?? null,
			},
			contentPurge: {
				...(defaults.webCache?.contentPurge ?? {}),
				...(persisted.webCache?.contentPurge ?? {}),
				lastPurgedAt: persisted.webCache?.contentPurge?.lastPurgedAt ?? defaults.webCache?.contentPurge?.lastPurgedAt ?? null,
				purgeCount: persisted.webCache?.contentPurge?.purgeCount ?? defaults.webCache?.contentPurge?.purgeCount ?? 0,
				lastError: persisted.webCache?.contentPurge?.lastError ?? defaults.webCache?.contentPurge?.lastError ?? null,
			},
		},
		pages: {
			...(defaults.pages ?? {}),
			...(persisted.pages ?? {}),
			projectName: defaults.pages?.projectName ?? persisted.pages?.projectName ?? null,
			productionBranch: defaults.pages?.productionBranch ?? persisted.pages?.productionBranch ?? 'main',
			stagingBranch: defaults.pages?.stagingBranch ?? persisted.pages?.stagingBranch ?? 'staging',
			buildOutputDir: defaults.pages?.buildOutputDir ?? persisted.pages?.buildOutputDir ?? 'dist',
			url: defaults.pages?.url ?? persisted.pages?.url ?? null,
		},
		readiness: {
			...defaults.readiness,
			...(persisted.readiness ?? {}),
		},
		services: Object.fromEntries(
			MANAGED_SERVICE_KEYS.map((serviceKey) => {
				const defaultService = defaults.services?.[serviceKey] ?? {};
				const persistedService = persisted.services?.[serviceKey] ?? {};
				const effectiveDeploymentTimestamp = persistedService.lastDeploymentTimestamp ?? defaultService.lastDeploymentTimestamp ?? null;
				return [
					serviceKey,
					{
						...defaultService,
						...persistedService,
						enabled: defaultService.enabled,
						initialized: persistedService.initialized === true && Boolean(effectiveDeploymentTimestamp),
						provider: defaultService.provider,
						projectId: defaultService.projectId ?? persistedService.projectId ?? null,
						projectName: defaultService.projectName ?? persistedService.projectName ?? null,
						serviceId: defaultService.serviceId ?? persistedService.serviceId ?? null,
						serviceName: defaultService.serviceName ?? persistedService.serviceName ?? null,
						workerName: defaultService.workerName ?? persistedService.workerName ?? null,
						rootDir: defaultService.rootDir ?? persistedService.rootDir ?? null,
						environment: defaultService.environment ?? persistedService.environment ?? null,
						schedule: defaultService.schedule ?? persistedService.schedule ?? null,
						publicBaseUrl: defaultService.publicBaseUrl ?? persistedService.publicBaseUrl ?? null,
						lastDeploymentTimestamp: effectiveDeploymentTimestamp,
						lastDeployedUrl: defaultService.publicBaseUrl ?? persistedService.lastDeployedUrl ?? null,
						lastScheduleSyncAt: persistedService.lastScheduleSyncAt ?? defaultService.lastScheduleSyncAt ?? null,
					},
				];
			}),
		),
		railwaySchedules: {
			...(persisted.railwaySchedules ?? {}),
		},
	};

	if (target.kind === 'persistent') {
		merged.lastDeployedUrl = resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'web') ?? merged.lastDeployedUrl ?? null;
	}

	if (target.kind === 'branch' && !merged.lastDeployedUrl) {
		merged.lastDeployedUrl = targetWorkersDevUrl(merged.workerName);
	}

	return merged;
}

export function writeDeployState(tenantRoot, state, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? state.target ?? 'prod');
	const { statePath } = resolveTargetPaths(tenantRoot, target);
	writeJson(statePath, {
		...state,
		target,
	});
}

export function resolveGeneratedWranglerPath(tenantRoot, options = {}) {
	return resolveTargetPaths(tenantRoot, options.scope ?? options.target ?? 'prod').wranglerPath;
}

export function buildWranglerConfigContents(tenantRoot, deployConfig, state, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? state.target ?? 'prod');
	const { generatedRoot } = resolveTargetPaths(tenantRoot, target);
	const workerName = state.workerName ?? targetWorkerName(deployConfig, target);
	const mainPath = relativeFromGeneratedRoot(resolve(tenantRoot, 'dist/_worker.js/index.js'), generatedRoot);
	const assetsDirectory = relativeFromGeneratedRoot(resolve(tenantRoot, 'dist'), generatedRoot);
	const migrationsDir = relativeFromGeneratedRoot(sdkD1MigrationsRoot, generatedRoot);
	const vars = {
		...buildPublicVars(deployConfig, { target }),
		...buildLocalRuntimeVars(deployConfig, state, target, options.env),
	};
	const r2Config = deployConfig.cloudflare.r2;
	const r2Binding = resolveConfiguredContentBucketBinding(deployConfig);
	const r2BucketName = resolveConfiguredContentBucketName(deployConfig);

	return [
		`name = ${renderTomlString(workerName)}`,
		`compatibility_date = ${renderTomlString(DEFAULT_COMPATIBILITY_DATE)}`,
		`compatibility_flags = [${DEFAULT_COMPATIBILITY_FLAGS.map((flag) => renderTomlString(flag)).join(', ')}]`,
		`main = ${renderTomlString(mainPath)}`,
		'workers_dev = true',
		'preview_urls = true',
		'',
		'[assets]',
		`directory = ${renderTomlString(assetsDirectory)}`,
		'',
		'[vars]',
		...Object.entries(vars).map(([key, value]) => `${key} = ${renderTomlString(value)}`),
		'',
		'[[kv_namespaces]]',
		'binding = "FORM_GUARD_KV"',
		`id = ${renderTomlString(state.kvNamespaces.FORM_GUARD_KV.id)}`,
		`preview_id = ${renderTomlString(state.kvNamespaces.FORM_GUARD_KV.previewId ?? state.kvNamespaces.FORM_GUARD_KV.id)}`,
		'',
		'[[d1_databases]]',
		'binding = "SITE_DATA_DB"',
		`database_name = ${renderTomlString(state.d1Databases.SITE_DATA_DB.databaseName)}`,
		`database_id = ${renderTomlString(state.d1Databases.SITE_DATA_DB.databaseId)}`,
		`preview_database_id = ${renderTomlString(state.d1Databases.SITE_DATA_DB.previewDatabaseId ?? state.d1Databases.SITE_DATA_DB.databaseId)}`,
		`migrations_dir = ${renderTomlString(migrationsDir)}`,
		'',
		...(r2Config
			? [
				'[[r2_buckets]]',
				`binding = ${renderTomlString(r2Binding)}`,
				`bucket_name = ${renderTomlString(r2BucketName)}`,
				'',
			]
			: []),
	].join('\n');
}

export function ensureGeneratedWranglerConfig(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const { wranglerPath } = resolveTargetPaths(tenantRoot, target);
	const manifestFingerprint = stableHash(JSON.stringify({ deployConfig, targetKey: targetKey(target) }));
	const contents = buildWranglerConfigContents(tenantRoot, deployConfig, state, { target, env: options.env });
	ensureParent(wranglerPath);
	writeFileSync(wranglerPath, contents, 'utf8');
	state.lastManifestFingerprint = manifestFingerprint;
	state.readiness.lastConfigFingerprint = manifestFingerprint;
	if (!state.generatedSecrets) {
		state.generatedSecrets = {};
	}
	const secretMap = buildSecretMap(deployConfig, state);
	state.generatedSecrets.TREESEED_FORM_TOKEN_SECRET = secretMap.TREESEED_FORM_TOKEN_SECRET;
	state.generatedSecrets.TREESEED_EDITORIAL_PREVIEW_SECRET = secretMap.TREESEED_EDITORIAL_PREVIEW_SECRET;
	writeDeployState(tenantRoot, state, { target });
	return { wranglerPath, deployConfig, state, manifestFingerprint, target };
}

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

function parseWranglerJsonOutput(result, label) {
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

function ensurePagesProjectCompatibility(accountId, projectName, env, currentProject = null, options = {}) {
	if (!accountId || !projectName) {
		return;
	}

	const projectPath = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;
	const latestProject = cloudflareApiRequest(projectPath, { env, allowFailure: true })?.result ?? currentProject;
	const currentConfigs = latestProject?.deployment_configs ?? {};
	const target = options.target;
	const targetConfigKey = target?.kind === 'persistent' && target.scope === 'prod' ? 'production' : 'preview';
	const bindings = options.state ? buildCloudflarePagesFunctionBindings(options.state) : {};
	const mergeCompatibility = (config = {}) => ({
		...config,
		compatibility_date: config.compatibility_date ?? DEFAULT_COMPATIBILITY_DATE,
		compatibility_flags: [...new Set([...(config.compatibility_flags ?? []), ...DEFAULT_COMPATIBILITY_FLAGS])],
	});
	const mergeTarget = (key, config = {}) => {
		const compatible = mergeCompatibility(config);
		return key === targetConfigKey && Object.keys(bindings).length
			? mergeCloudflarePagesDeploymentConfig(compatible, bindings)
			: compatible;
	};

	cloudflareApiRequest(
		projectPath,
		{
			method: 'PATCH',
			env,
			body: {
				deployment_configs: {
					...currentConfigs,
					preview: mergeTarget('preview', currentConfigs.preview),
					production: mergeTarget('production', currentConfigs.production),
				},
			},
		},
	);
}

function isPlaceholderResourceId(value) {
	if (!value || typeof value !== 'string') {
		return true;
	}

	return (
		value.startsWith('local-')
		|| value.startsWith('dryrun-')
		|| value.endsWith('-id')
		|| value.endsWith('-preview-id')
	);
}

export function buildProvisioningSummary(deployConfig, state, target) {
	const webCachePolicy = resolveTreeseedWebCachePolicy(deployConfig);
	const identity = state.identity ?? resolveTreeseedResourceIdentity(deployConfig, target);
	const configuredWebDomain = resolveConfiguredSurfaceDomain(deployConfig, target, 'web');
	const configuredApiDomain = resolveConfiguredSurfaceDomain(deployConfig, target, 'api');
	return {
		target: deployTargetLabel(target),
		identity,
		workerName: state.workerName ?? targetWorkerName(deployConfig, target),
		siteUrl: target.kind === 'branch' ? targetWorkersDevUrl(state.workerName) : deployConfig.siteUrl,
		accountId: resolveConfiguredCloudflareAccountId(deployConfig),
		pages: state.pages ?? null,
		turnstileWidget: state.turnstileWidgets?.formGuard ?? null,
		formGuardKv: state.kvNamespaces.FORM_GUARD_KV,
		sessionKv: state.kvNamespaces.SESSION ?? null,
		siteDataDb: state.d1Databases.SITE_DATA_DB,
		content: state.content ?? null,
		resources: {
			pagesProject: state.pages?.projectName ?? null,
			contentBucket: state.content?.bucketName ?? null,
			database: state.d1Databases?.SITE_DATA_DB?.databaseName ?? null,
			turnstileWidget: state.turnstileWidgets?.formGuard?.name ?? null,
			formGuardKv: state.kvNamespaces?.FORM_GUARD_KV?.name ?? null,
			railwayProject: state.services?.worker?.projectName ?? state.services?.api?.projectName ?? null,
			webDomain: configuredWebDomain,
			apiDomain: configuredApiDomain,
			railwayServices: Object.fromEntries(
				Object.entries(state.services ?? {})
					.filter(([, service]) => service?.enabled === true)
					.map(([serviceKey, service]) => [serviceKey, service?.serviceName ?? null]),
			),
		},
		webCache: {
			webHost: state.webCache?.webHost ?? null,
			contentHost: state.webCache?.contentHost ?? null,
			rulesManaged: state.webCache?.rulesManaged === true,
			lastSyncedAt: state.webCache?.lastSyncedAt ?? null,
			lastError: state.webCache?.lastError ?? null,
			policy: webCachePolicy,
			deployPurge: state.webCache?.deployPurge ?? null,
			contentPurge: state.webCache?.contentPurge ?? null,
		},
	};
}

function safeUrl(value) {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

function normalizePathPrefix(pathname) {
	const normalized = String(pathname ?? '').replace(/\/+$/u, '');
	if (!normalized || normalized === '/') {
		return '';
	}
	return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function resolvePublicWebCacheTarget(deployConfig) {
	const parsed = safeUrl(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl);
	if (!parsed) {
		return null;
	}
	return {
		host: parsed.hostname,
		pathPrefix: normalizePathPrefix(parsed.pathname),
	};
}

function resolvePublicContentCacheTarget(deployConfig) {
	const parsed = safeUrl(resolveConfiguredContentPublicBaseUrl(deployConfig));
	if (!parsed) {
		return null;
	}
	return {
		host: parsed.hostname,
		pathPrefix: normalizePathPrefix(parsed.pathname),
	};
}

function shouldManageCloudflareWebCacheRules(deployConfig, target) {
	if (target.kind !== 'persistent' || target.scope !== 'prod') {
		return false;
	}
	if ((deployConfig.surfaces?.web?.provider ?? deployConfig.providers?.deploy) !== 'cloudflare') {
		return false;
	}
	const webTarget = resolvePublicWebCacheTarget(deployConfig);
	return Boolean(webTarget?.host && !webTarget.host.endsWith('.workers.dev') && !webTarget.host.endsWith('.pages.dev'));
}

export function cloudflareApiRequest(path, { method = 'GET', body, env, allowFailure = false } = {}) {
	const token = env?.TREESEED_CLOUDFLARE_API_TOKEN ?? env?.CLOUDFLARE_API_TOKEN ?? process.env.TREESEED_CLOUDFLARE_API_TOKEN ?? '';
	if (!token) {
		if (allowFailure) {
			return null;
		}
		throw new Error(`Cloudflare API token is required: ${method} ${path}`);
	}

	const requestScript = `import { readFileSync } from 'node:fs';
import { request } from 'node:https';
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
function errorMessage(error) {
  const parts = [];
  if (error && typeof error.message === 'string') parts.push(error.message);
  const cause = error?.cause;
  if (cause && typeof cause.message === 'string') parts.push(cause.message);
  if (cause && typeof cause.code === 'string') parts.push(cause.code);
  if (Array.isArray(cause?.errors)) {
    for (const entry of cause.errors) {
      if (entry && typeof entry.message === 'string') parts.push(entry.message);
      if (entry && typeof entry.code === 'string') parts.push(entry.code);
    }
  }
  return [...new Set(parts.filter(Boolean))].join('; ') || String(error);
}
try {
  const body = input.body ? JSON.stringify(input.body) : undefined;
  const response = await new Promise((resolve, reject) => {
    const req = request(input.url, {
      method: input.method,
      headers: {
        authorization: 'Bearer ' + input.token,
        'content-type': 'application/json',
      },
      timeout: input.timeoutMs ?? 12000,
    }, (res) => {
      const chunks = [];
      res.setEncoding('utf8');
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        ok: typeof res.statusCode === 'number' && res.statusCode >= 200 && res.statusCode < 300,
        text: chunks.join(''),
      }));
    });
    req.on('timeout', () => {
      req.destroy(new Error('Cloudflare API request timed out'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
  const rawBody = response.text;
  let payload;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = { success: false, errors: [{ message: rawBody || 'empty response' }] };
  }
  process.stdout.write(JSON.stringify({ ok: response.ok, payload }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    ok: false,
    transient: true,
    payload: { success: false, errors: [{ message: errorMessage(error) }] },
  }));
}`;
	const requestInput = JSON.stringify({
		url: `https://api.cloudflare.com/client/v4${path}`,
		method,
		body,
		timeoutMs: 12_000,
		token,
	});
	const isTransient = (text) => /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|rate limit|too many requests|throttl|please wait/iu.test(text || '');
	const retryDelay = (text, currentAttempt) => {
		const base = /rate limit|too many requests|throttl|please wait/iu.test(text || '') ? 2500 : 500;
		return base * (currentAttempt + 1);
	};
	const formatPayloadErrors = (payload) => Array.isArray(payload?.errors)
		? payload.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).join('; ')
		: '';
	const summarizeChildError = (text) => {
		const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
		return lines.find((line) => /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|typeerror|error/iu.test(line))
			?? lines[0]
			?? '';
	};
	let attempt = 0;
	for (;;) {
		const response = spawnSync(
			process.execPath,
			[
				'--input-type=module',
				'-e',
				requestScript,
			],
			{
				stdio: ['pipe', 'pipe', 'pipe'],
				encoding: 'utf8',
				env: { ...process.env, ...(env ?? {}) },
				input: requestInput,
				timeout: 15000,
			},
		);
		if (response.error?.code === 'ETIMEDOUT') {
			if (attempt < 7) {
				attempt += 1;
				sleepSync(retryDelay('timed out', attempt));
				continue;
			}
			if (!allowFailure) {
				throw new Error(`Cloudflare API request timed out after ${attempt + 1} attempts: ${method} ${path}`);
			}
			return null;
		}
		const stderr = response.stderr?.trim() || '';
		if (response.status !== 0) {
			if (attempt < 7 && isTransient(stderr)) {
				attempt += 1;
				sleepSync(retryDelay(stderr, attempt));
				continue;
			}
			if (!allowFailure) {
				const detail = summarizeChildError(stderr);
				throw new Error(detail
					? `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}: ${detail}`
					: `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}`);
			}
		}

		let parsed;
		try {
			parsed = JSON.parse(response.stdout?.trim() || '{"ok":false,"payload":{"success":false,"errors":[{"message":"empty response"}]}}');
		} catch {
			parsed = {
				ok: false,
				payload: {
					success: false,
					errors: [{ message: response.stdout?.trim() || stderr || 'empty response' }],
				},
			};
		}
		const details = formatPayloadErrors(parsed.payload);
		if (!parsed.ok && isTransient(details) && attempt < 7) {
			attempt += 1;
			sleepSync(retryDelay(details, attempt));
			continue;
		}
		if (!parsed.ok && !allowFailure) {
			throw new Error(details
				? `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}: ${details}`
				: `Cloudflare API request failed after ${attempt + 1} attempts: ${method} ${path}`);
		}
		return parsed.payload;
	}
}

export function resolveCloudflareZoneIdForHost(deployConfig, host, env) {
	if (deployConfig.cloudflare.zoneId) {
		return deployConfig.cloudflare.zoneId;
	}

	const result = cloudflareApiRequest(`/zones?name=${encodeURIComponent(host)}`, { env, allowFailure: true });
	const exact = Array.isArray(result?.result) ? result.result.find((zone) => zone?.name === host) : null;
	if (exact?.id) {
		return exact.id;
	}

	const fallback = cloudflareApiRequest('/zones', { env, allowFailure: true });
	const zones = Array.isArray(fallback?.result) ? fallback.result : [];
	const matched = zones
		.filter((zone) => typeof zone?.name === 'string' && (host === zone.name || host.endsWith(`.${zone.name}`)))
		.sort((left, right) => String(right.name).length - String(left.name).length)[0];
	return matched?.id ?? null;
}

function listCloudflareZoneRulesets(zoneId, env) {
	const result = cloudflareApiRequest(`/zones/${zoneId}/rulesets`, { env, allowFailure: true });
	return Array.isArray(result?.result) ? result.result : [];
}

function joinCloudflareAndExpression(clauses) {
	const parts = clauses
		.map((clause) => typeof clause === 'string' ? clause.trim() : '')
		.filter((clause) => clause.length > 0)
		.map((clause) => clause.startsWith('(') && clause.endsWith(')') ? clause : `(${clause})`);
	if (parts.length === 0) {
		throw new Error('Cannot build a Cloudflare expression without predicates.');
	}
	return `(${parts.join(' and ')})`;
}

export function buildTreeseedManagedCloudflareCacheRules(deployConfig, cacheTarget, kind) {
	if (!cacheTarget?.host) {
		return [];
	}
	const policy = resolveTreeseedWebCachePolicy(deployConfig);
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
			description: 'treeseed-managed: cache source html routes',
			expression: joinCloudflareAndExpression([
				hostExpression,
				pathExpression,
				sourcePathExpression,
				'(http.request.method in {"GET" "HEAD"})',
			]),
			action: 'set_cache_settings',
			action_parameters: {
				cache: true,
				edge_ttl: {
					mode: 'override_origin',
					default: policy.sourcePages.edgeTtlSeconds,
				},
				browser_ttl: {
					mode: 'override_origin',
					default: policy.sourcePages.browserTtlSeconds,
				},
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

function reconcileCloudflareCacheRulesForTarget(role, deployConfig, state, cacheTarget, env, { dryRun = false } = {}) {
	const roleKey = role === 'web' ? 'Web' : 'Content';
	if (!cacheTarget?.host) {
		return { managed: false, skipped: true, reason: 'missing_host' };
	}

	const zoneId = resolveCloudflareZoneIdForHost(deployConfig, cacheTarget.host, env);
	if (!zoneId) {
		return { managed: false, skipped: true, reason: 'zone_unresolved' };
	}

	const desiredRules = buildTreeseedManagedCloudflareCacheRules(deployConfig, cacheTarget, role);
	state.webCache[role === 'web' ? 'webHost' : 'contentHost'] = cacheTarget.host;
	state.webCache[role === 'web' ? 'webZoneId' : 'contentZoneId'] = zoneId;
	if (dryRun) {
		return { managed: true, dryRun: true, zoneId, host: cacheTarget.host, rules: desiredRules };
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

export function reconcileCloudflareWebCacheRules(tenantRoot, deployConfig, state, target, { dryRun = false, env: providedEnv } = {}) {
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
			results.push(reconcileCloudflareCacheRulesForTarget('web', deployConfig, state, webTarget, env, { dryRun }));
		}
		if (contentTarget?.host) {
			results.push(reconcileCloudflareCacheRulesForTarget('content', deployConfig, state, contentTarget, env, { dryRun }));
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

function purgeCloudflareCacheByUrls(urls, deployConfig, { env } = {}) {
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
		return {
			zoneId,
			count: [...new Set(files)].length,
			success: payload?.success === true,
		};
	});
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

function absoluteUrlForPath(baseUrl, path) {
	const parsed = safeUrl(baseUrl);
	if (!parsed) {
		return null;
	}
	const normalizedPath = String(path ?? '').startsWith('/') ? String(path) : `/${String(path ?? '')}`;
	return new URL(normalizedPath, parsed).toString();
}

function resolveSourcePagePurgeUrls(deployConfig) {
	const webBaseUrl = deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl;
	const paths = resolveTreeseedWebCachePolicy(deployConfig).sourcePages.paths;
	return paths.map((path) => absoluteUrlForPath(webBaseUrl, path)).filter(Boolean);
}

function recordCachePurgeResult(targetState, results, error = null) {
	if (error) {
		targetState.lastError = error instanceof Error ? error.message : String(error);
		return;
	}
	targetState.lastPurgedAt = new Date().toISOString();
	targetState.purgeCount = Array.isArray(results) ? results.reduce((sum, result) => sum + (result?.count ?? 0), 0) : 0;
	targetState.lastError = null;
}

function resolveCloudflareCachePurgeEnv(options = {}) {
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
	if ((options.dryRun ?? false) || urls.length === 0 || !env) {
		recordCachePurgeResult(state.webCache.deployPurge, urls.map((url) => ({ count: url ? 1 : 0 })));
		writeDeployState(tenantRoot, state, { target });
		return {
			skipped: true,
			reason: options.dryRun ? 'dry_run' : urls.length === 0 ? 'no_urls' : 'missing_cloudflare_token',
			urls,
			results: [],
		};
	}

	try {
		const results = purgeCloudflareCacheByUrls(urls, deployConfig, {
			env,
		});
		recordCachePurgeResult(state.webCache.deployPurge, results);
		writeDeployState(tenantRoot, state, { target });
		return { urls, results };
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
	if ((options.dryRun ?? false) || !urls?.length || !env) {
		recordCachePurgeResult(state.webCache.contentPurge, (urls ?? []).map((url) => ({ count: url ? 1 : 0 })));
		writeDeployState(tenantRoot, state, { target });
		return {
			skipped: true,
			reason: options.dryRun ? 'dry_run' : !urls?.length ? 'no_urls' : 'missing_cloudflare_token',
			urls: urls ?? [],
			results: [],
		};
	}

	try {
		const results = purgeCloudflareCacheByUrls(urls, deployConfig, {
			env,
		});
		recordCachePurgeResult(state.webCache.contentPurge, results);
		writeDeployState(tenantRoot, state, { target });
		return { urls, results };
	} catch (error) {
		recordCachePurgeResult(state.webCache.contentPurge, [], error);
		writeDeployState(tenantRoot, state, { target });
		throw error;
	}
}

function buildDestroySummary(deployConfig, state, target) {
	return buildProvisioningSummary(deployConfig, state, target);
}

function isPlaceholderAccountId(value) {
	return !value || value === 'replace-with-cloudflare-account-id';
}

export function resolveConfiguredCloudflareAccountId(deployConfig) {
	return envOrNull('CLOUDFLARE_ACCOUNT_ID') ?? deployConfig.cloudflare.accountId;
}

function normalizeConfiguredBaseUrl(value) {
	const raw = typeof value === 'string' ? value.trim() : '';
	if (!raw) {
		return null;
	}
	return raw.replace(/\/+$/u, '');
}

function domainBaseUrl(domain) {
	const raw = typeof domain === 'string' ? domain.trim() : '';
	if (!raw) {
		return null;
	}
	if (/^https?:\/\//iu.test(raw)) {
		return normalizeConfiguredBaseUrl(raw);
	}
	return `https://${raw.replace(/^\/+|\/+$/gu, '')}`;
}

function targetEnvironmentKey(target) {
	if (target?.kind === 'persistent') {
		return target.scope;
	}
	return 'staging';
}

function resolveConfiguredApiConnectionBaseUrl(deployConfig, target) {
	const scope = targetEnvironmentKey(target);
	if (scope === 'local') {
		return normalizeConfiguredBaseUrl(deployConfig.connections?.api?.localBaseUrl)
			?? normalizeConfiguredBaseUrl(deployConfig.connections?.api?.environments?.local?.baseUrl)
			?? domainBaseUrl(deployConfig.connections?.api?.environments?.local?.domain);
	}
	return normalizeConfiguredBaseUrl(deployConfig.connections?.api?.environments?.[scope]?.baseUrl)
		?? domainBaseUrl(deployConfig.connections?.api?.environments?.[scope]?.domain);
}

function resolveConfiguredMarketBaseUrl(deployConfig, target) {
	return resolveConfiguredApiConnectionBaseUrl(deployConfig, target)
		?? envOrNull('TREESEED_API_BASE_URL')
		?? deployConfig.runtime?.marketBaseUrl
		?? deployConfig.hosting?.marketBaseUrl
		?? envOrNull('TREESEED_CENTRAL_MARKET_API_BASE_URL')
		?? DEFAULT_TREESEED_MARKET_BASE_URL;
}

function resolveConfiguredCentralMarketBaseUrl(deployConfig, target) {
	return resolveConfiguredApiConnectionBaseUrl(deployConfig, target)
		?? envOrNull('TREESEED_CENTRAL_MARKET_API_BASE_URL')
		?? DEFAULT_TREESEED_MARKET_BASE_URL;
}

function resolveConfiguredPagesProjectName(deployConfig) {
	return sharedDeploymentName(resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget('prod')));
}

function resolveConfiguredContentBucketBinding(deployConfig) {
	return envOrNull('TREESEED_CONTENT_BUCKET_BINDING')
		?? deployConfig.cloudflare.r2?.binding
		?? 'TREESEED_CONTENT_BUCKET';
}

function resolveConfiguredContentBucketName(deployConfig) {
	return sharedDeploymentName(resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget('prod')), 'content');
}

function resolveConfiguredContentPublicBaseUrl(deployConfig) {
	return envOrNull('TREESEED_CONTENT_PUBLIC_BASE_URL')
		?? deployConfig.cloudflare.r2?.publicBaseUrl
		?? '';
}

function missingTurnstileRequirements() {
	return [];
}

function missingContentRuntimeRequirements(deployConfig) {
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

export function collectMissingDeployInputs(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const missing = [];

	if (isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		missing.push({
			key: 'CLOUDFLARE_ACCOUNT_ID',
			label: 'Cloudflare account ID',
			message: 'Cloudflare account ID is missing. Set CLOUDFLARE_ACCOUNT_ID with treeseed config or provide it now.',
		});
	}

	if (deployConfig.providers?.content?.runtime === 'team_scoped_r2_overlay' && !envOrNull('TREESEED_EDITORIAL_PREVIEW_SECRET')) {
		missing.push({
			key: 'TREESEED_EDITORIAL_PREVIEW_SECRET',
			label: 'Editorial preview signing secret',
			message: 'Editorial preview signing secret is missing for deploy.',
		});
	}

	return missing;
}

export async function promptForMissingDeployInputs(tenantRoot) {
	const missing = collectMissingDeployInputs(tenantRoot);
	if (!missing.length || !process.stdin.isTTY || !process.stdout.isTTY) {
		return { prompted: false, provided: [] };
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const provided = [];

	try {
		console.log('Treeseed deploy needs a few missing values before it can continue.');
		console.log('These values will be used for this deploy process only. Persist them in your env files or CI secrets afterward.');

		for (const item of missing) {
			console.log(`- ${item.message}`);
			const answer = (await rl.question(`${item.label}: `)).trim();
			if (!answer) {
				continue;
			}
			process.env[item.key] = answer;
			provided.push(item.key);
		}
	} finally {
		rl.close();
	}

	return { prompted: true, provided };
}

export function validateDeployPrerequisites(tenantRoot, { requireRemote = true } = {}) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const issues = [];

	if (isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		issues.push(
			'Set CLOUDFLARE_ACCOUNT_ID with treeseed config or export it before deploying.',
		);
	}

	if (requireRemote) {
		issues.push(...missingTurnstileRequirements());
		issues.push(...missingContentRuntimeRequirements(deployConfig));

		const result = runWrangler(['whoami'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
		});
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		if (/You are not authenticated/i.test(output) || /wrangler login/i.test(output)) {
			issues.push('Authenticate Wrangler first with `wrangler login`.');
		}
	}

	if (issues.length > 0) {
		throw new Error(`Treeseed deploy prerequisites are not satisfied:\n- ${issues.join('\n- ')}`);
	}

	return deployConfig;
}

export function validateDestroyPrerequisites(tenantRoot, { requireRemote = true } = {}) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const issues = [];

	if (requireRemote && isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		issues.push(
			'Set CLOUDFLARE_ACCOUNT_ID with treeseed config or export it before destroying infrastructure.',
		);
	}

	if (requireRemote) {
		const result = runWrangler(['whoami'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
		});
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		if (/You are not authenticated/i.test(output) || /wrangler login/i.test(output)) {
			issues.push('Authenticate Wrangler first with `wrangler login`.');
		}
	}

	if (issues.length > 0) {
		throw new Error(`Treeseed destroy prerequisites are not satisfied:\n- ${issues.join('\n- ')}`);
	}

	return deployConfig;
}

function resolveExistingKvIdByName(kvNamespaces, expectedName, fallbackId) {
	if (fallbackId && !isPlaceholderResourceId(fallbackId)) {
		return fallbackId;
	}

	return kvNamespaces.find((entry) => entry?.title === expectedName)?.id ?? null;
}

function resolveExistingTurnstileWidget(widgets, current) {
	if (!current?.name && !current?.sitekey) {
		return current;
	}
	const existing = widgets.find((entry) =>
		(current.sitekey && entry?.sitekey === current.sitekey)
		|| (current.name && entry?.name === current.name),
	);
	if (!existing?.sitekey) {
		return current;
	}
	return {
		...current,
		sitekey: existing.sitekey,
		secret: existing.secret ?? current.secret ?? null,
		domains: Array.isArray(existing.domains) ? existing.domains : current.domains ?? [],
		mode: existing.mode ?? current.mode ?? 'managed',
	};
}

function resolveExistingD1ByName(d1Databases, expectedName, current) {
	if (current?.databaseId && !isPlaceholderResourceId(current.databaseId)) {
		return current;
	}

	const existing = d1Databases.find((entry) => entry?.name === expectedName);
	if (!existing?.uuid) {
		return current;
	}

	return {
		...current,
		databaseId: existing.uuid,
		previewDatabaseId: existing.previewDatabaseUuid ?? existing.uuid,
	};
}

function looksLikeMissingResource(output) {
	return /not found|does not exist|could(?: not|n't) find|couldnt find|already deleted|deleted widget|access a deleted/i.test(output);
}

function deleteKvNamespace(tenantRoot, namespaceId, { env, dryRun, preview = false }) {
	if (!namespaceId || isPlaceholderResourceId(namespaceId)) {
		return { status: 'missing', id: namespaceId };
	}

	if (dryRun) {
		return { status: 'planned', id: namespaceId, preview };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, dryRun: false, name: namespaceId, type: 'kv-namespace' });
	return { status: deleted.status, id: namespaceId, preview };
}

function deleteTurnstileWidget(sitekey, { env, dryRun, name = null }) {
	if (!sitekey || isPlaceholderResourceId(sitekey)) {
		return { status: 'missing', sitekey, name };
	}

	if (dryRun) {
		return { status: 'planned', sitekey, name };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/challenges/widgets/${encodeURIComponent(sitekey)}`
		: null;
	let deleted;
	try {
		deleted = deleteCloudflareApiResource(path, { env, dryRun: false, name: name ?? sitekey, type: 'turnstile-widget' });
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Cloudflare Turnstile widget deletion failed. Ensure the API token has Turnstile Sites Write permission: ${detail}`);
	}
	return { status: deleted.status, sitekey, name };
}

function deleteD1Database(tenantRoot, databaseName, { env, dryRun }) {
	if (!databaseName) {
		return { status: 'missing', name: databaseName };
	}

	if (dryRun) {
		return { status: 'planned', name: databaseName };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const database = accountId
		? listD1Databases(tenantRoot, env).find((entry) => entry?.name === databaseName)
		: null;
	const databaseId = database?.uuid ?? database?.id ?? null;
	const path = accountId && databaseId
		? `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, dryRun: false, name: databaseName, type: 'd1-database' });
	return { status: deleted.status, name: databaseName, id: databaseId };
}

function deleteWorker(tenantRoot, workerName, { env, dryRun, force = false }) {
	if (!workerName) {
		return { status: 'missing', name: workerName };
	}

	if (dryRun) {
		return { status: 'planned', name: workerName };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/workers/services/${encodeURIComponent(workerName)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, dryRun: false, name: workerName, type: 'worker' });
	return { status: deleted.status, name: workerName };
}

function resourceOperation(provider, type, name, status, extra = {}) {
	return {
		provider,
		type,
		name: name ?? null,
		status,
		...extra,
	};
}

function deleteCloudflareApiResource(path, { env, dryRun, name, type }) {
	if (!path) {
		return resourceOperation('cloudflare', type, name, 'missing');
	}
	if (dryRun) {
		return resourceOperation('cloudflare', type, name, 'planned', { path });
	}
	const result = cloudflareApiRequest(path, { method: 'DELETE', env, allowFailure: true });
	if (result?.success === false && !looksLikeMissingResource(formatCloudflareErrors(result))) {
		throw new Error(formatCloudflareErrors(result) || `Failed to delete Cloudflare ${type} ${name}.`);
	}
	return resourceOperation('cloudflare', type, name, result?.success === false ? 'missing' : 'deleted', { path });
}

function formatCloudflareErrors(payload) {
	return Array.isArray(payload?.errors)
		? payload.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).filter(Boolean).join('; ')
		: '';
}

function deleteQueueByName(tenantRoot, queue, { env, dryRun }) {
	const name = queueName(queue) ?? queue?.name ?? null;
	let id = queueId(queue);
	if (!name) {
		return resourceOperation('cloudflare', 'queue', name, 'missing');
	}
	if (dryRun) {
		return resourceOperation('cloudflare', 'queue', name, 'planned', { id });
	}
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!id && accountId) {
		const live = listQueues(tenantRoot, env).find((entry) => queueName(entry) === name);
		id = queueId(live);
	}
	const path = id
		? `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(id)}`
		: null;
	if (path) {
		const deleted = deleteCloudflareApiResource(path, { env, dryRun: false, name, type: 'queue' });
		if (deleted.status === 'deleted' || deleted.status === 'missing') {
			return { ...deleted, id };
		}
	}
	if (accountId) {
		return resourceOperation('cloudflare', 'queue', name, 'missing', { id });
	}
	throw new Error(`Failed to delete queue ${name}: CLOUDFLARE_ACCOUNT_ID is not configured.`);
}

function deleteR2Bucket(tenantRoot, bucketName, { env, dryRun, deleteData }) {
	if (!bucketName) {
		return resourceOperation('cloudflare', 'r2-bucket', bucketName, 'missing');
	}
	if (!deleteData) {
		return resourceOperation('cloudflare', 'r2-bucket', bucketName, 'skipped', { reason: 'data_preserved' });
	}
	if (dryRun) {
		return resourceOperation('cloudflare', 'r2-bucket', bucketName, 'planned');
	}
	const drained = drainR2Bucket(bucketName, { env });
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, dryRun: false, name: bucketName, type: 'r2-bucket' });
	return resourceOperation('cloudflare', 'r2-bucket', bucketName, deleted.status, drained);
}

function r2ObjectKey(entry) {
	return typeof entry?.key === 'string' ? entry.key
		: typeof entry?.name === 'string' ? entry.name
			: '';
}

function listR2Objects(bucketName, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId || !bucketName) {
		return [];
	}
	const objects = [];
	let cursor = '';
	for (let page = 0; page < 20; page += 1) {
		const payload = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/objects?per_page=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
			{ env, allowFailure: true },
		);
		if (payload?.success === false) {
			break;
		}
		const pageObjects = Array.isArray(payload?.result)
			? payload.result
			: Array.isArray(payload?.result?.objects)
				? payload.result.objects
				: [];
		objects.push(...pageObjects);
		const nextCursor = typeof payload?.result_info?.cursor === 'string' ? payload.result_info.cursor
			: typeof payload?.result?.cursor === 'string' ? payload.result.cursor
				: '';
		if (!nextCursor || nextCursor === cursor || pageObjects.length === 0) {
			break;
		}
		cursor = nextCursor;
		if (objects.length >= 200) {
			break;
		}
	}
	return objects;
}

function drainR2Bucket(bucketName, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId || !bucketName) {
		return { objectsDeleted: 0, objectsMissing: 0, objectsDeferred: 0 };
	}
	let objectsDeleted = 0;
	let objectsMissing = 0;
	let objectsDeferred = 0;
	for (let batch = 0; batch < 100; batch += 1) {
		const objects = listR2Objects(bucketName, { env });
		if (objects.length === 0) {
			break;
		}
		const keys = objects.map((object) => r2ObjectKey(object)).filter(Boolean);
		const deleted = deleteR2ObjectsBatch(bucketName, keys, { env });
		objectsDeleted += deleted.objectsDeleted;
		objectsMissing += deleted.objectsMissing;
		objectsDeferred += deleted.objectsDeferred;
		const batchDeleted = deleted.objectsDeleted + deleted.objectsMissing;
		if (batchDeleted === 0) {
			if (deleted.objectsDeferred > 0) {
				sleepSync(3000);
				continue;
			}
			break;
		}
		if (deleted.objectsDeferred > 0) {
			sleepSync(1500);
		}
	}
	return { objectsDeleted, objectsMissing, objectsDeferred };
}

function deleteR2ObjectsBatch(bucketName, keys, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const token = env?.CLOUDFLARE_API_TOKEN ?? process.env.TREESEED_CLOUDFLARE_API_TOKEN ?? '';
	const uniqueKeys = [...new Set((keys ?? []).filter(Boolean))];
	if (!accountId || !bucketName || uniqueKeys.length === 0) {
		return { objectsDeleted: 0, objectsMissing: 0, objectsDeferred: 0 };
	}
	const script = `
const input = JSON.parse(await new Promise((resolve) => {
	let body = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => { body += chunk; });
	process.stdin.on('end', () => resolve(body || '{}'));
}));
let index = 0;
let deleted = 0;
let missing = 0;
let deferred = 0;
const failed = [];
async function removeKey(key) {
	function encodeObjectKey(value) {
		return String(value).split('/').map((part) => encodeURIComponent(part)).join('/');
	}
	const url = 'https://api.cloudflare.com/client/v4/accounts/'
		+ encodeURIComponent(input.accountId)
		+ '/r2/buckets/'
		+ encodeURIComponent(input.bucketName)
		+ '/objects/'
		+ encodeObjectKey(key);
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 15000);
		try {
			const response = await fetch(url, {
				method: 'DELETE',
				headers: { authorization: 'Bearer ' + input.token },
				signal: controller.signal,
			});
			const text = await response.text();
			let payload = {};
			try { payload = text ? JSON.parse(text) : {}; } catch { payload = { errors: [{ message: text }] }; }
			if (response.ok && payload.success !== false) {
				deleted += 1;
				return;
			}
			const message = Array.isArray(payload.errors) ? payload.errors.map((entry) => entry?.message || JSON.stringify(entry)).join('; ') : text;
			if (/not found|does not exist|deleted|missing/i.test(message || '')) {
				missing += 1;
				return;
			}
			if (response.status === 429 || /rate limit|too many requests/i.test(message || '')) {
				await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
				continue;
			}
			failed.push({ key, message: message || \`delete failed with status \${response.status}\` });
			return;
		} catch (error) {
			if (attempt < 5 && /aborted|timed out|fetch failed|econnreset/i.test(error instanceof Error ? error.message : String(error))) {
				await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
				continue;
			}
			failed.push({ key, message: error instanceof Error ? error.message : String(error) });
			return;
		} finally {
			clearTimeout(timeout);
		}
	}
	deferred += 1;
}
async function worker() {
	for (;;) {
		const current = index;
		index += 1;
		if (current >= input.keys.length) return;
		await removeKey(input.keys[current]);
	}
}
await Promise.all(Array.from({ length: Math.min(input.concurrency || 4, input.keys.length) }, () => worker()));
process.stdout.write(JSON.stringify({ deleted, missing, deferred, failed }));
`.trim();
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		stdio: ['pipe', 'pipe', 'pipe'],
		encoding: 'utf8',
		env: { ...process.env, ...(env ?? {}) },
		input: JSON.stringify({
			accountId,
			bucketName,
			keys: uniqueKeys,
			token,
			concurrency: 4,
			timeoutMs: 12000,
		}),
		timeout: 120000,
	});
	if (result.status !== 0 || result.error) {
		throw new Error(result.stderr?.trim() || result.error?.message || `Failed to delete R2 object batch for ${bucketName}.`);
	}
	let parsed;
	try {
		parsed = JSON.parse(result.stdout || '{}');
	} catch {
		throw new Error(`R2 object batch delete returned invalid JSON for ${bucketName}.`);
	}
	if (Array.isArray(parsed.failed) && parsed.failed.length > 0) {
		const first = parsed.failed[0];
		throw new Error(`Failed to delete ${parsed.failed.length} R2 objects from ${bucketName}: ${first?.message ?? first?.key ?? 'unknown error'}`);
	}
	return {
		objectsDeleted: Number(parsed.deleted) || 0,
		objectsMissing: Number(parsed.missing) || 0,
		objectsDeferred: Number(parsed.deferred) || 0,
	};
}

function deleteD1DatabaseForDestroy(tenantRoot, databaseName, { env, dryRun, deleteData }) {
	if (!deleteData) {
		return resourceOperation('cloudflare', 'd1-database', databaseName, 'skipped', { reason: 'data_preserved' });
	}
	const result = deleteD1Database(tenantRoot, databaseName, { env, dryRun });
	return resourceOperation('cloudflare', 'd1-database', databaseName, result.status, result);
}

function pagesDomainName(domain) {
	return typeof domain?.name === 'string' ? domain.name
		: typeof domain?.domain === 'string' ? domain.domain
			: typeof domain?.hostname === 'string' ? domain.hostname
				: '';
}

function listPagesCustomDomains(projectName, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!projectName || !accountId) {
		return [];
	}
	const domains = [];
	let page = 1;
	let totalPages = 1;
	while (page <= totalPages && page <= 50) {
		const payload = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains?per_page=100&page=${page}`,
			{ env, allowFailure: true },
		);
		if (payload?.success === false) {
			break;
		}
		if (Array.isArray(payload?.result)) {
			domains.push(...payload.result);
		}
		const reportedTotal = Number(payload?.result_info?.total_pages);
		totalPages = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : page;
		page += 1;
	}
	return domains;
}

function listPagesCustomDomainsWithWrangler(tenantRoot, projectName, { env }) {
	const result = runWrangler(['pages', 'project', 'list', '--json'], {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
	});
	if (result.status !== 0) {
		return [];
	}
	try {
		const projects = JSON.parse(result.stdout || '[]');
		const project = (Array.isArray(projects) ? projects : [])
			.find((entry) => entry?.name === projectName || entry?.projectName === projectName || entry?.['Project Name'] === projectName);
		const domains = typeof project?.['Project Domains'] === 'string'
			? project['Project Domains']
			: typeof project?.domains === 'string'
				? project.domains
				: '';
		return domains.split(',').map((entry) => entry.trim()).filter((entry) => entry && !entry.endsWith('.pages.dev'));
	} catch {
		return [];
	}
}

function deletePagesCustomDomains(tenantRoot, projectName, knownNames, { env, dryRun, knownOnly = false }) {
	if (!projectName) {
		return [resourceOperation('cloudflare', 'pages-custom-domain', projectName, 'missing')];
	}
	const desiredNames = [...new Set((knownNames ?? []).filter(Boolean))];
	if (dryRun) {
		return desiredNames.length > 0
			? desiredNames.map((name) => resourceOperation('cloudflare', 'pages-custom-domain', name, 'planned', { projectName, knownOnly }))
			: [resourceOperation('cloudflare', 'pages-custom-domain', projectName, knownOnly ? 'skipped' : 'planned', { reason: knownOnly ? 'no_target_scoped_domain' : 'project_delete_prerequisite' })];
	}
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return desiredNames.length > 0
			? desiredNames.map((name) => resourceOperation('cloudflare', 'pages-custom-domain', name, 'blocked', { projectName, reason: 'missing_cloudflare_account_id' }))
			: [resourceOperation('cloudflare', 'pages-custom-domain', projectName, 'blocked', { reason: 'missing_cloudflare_account_id' })];
	}
	const listedNames = knownOnly ? [] : listPagesCustomDomains(projectName, { env }).map(pagesDomainName).filter(Boolean);
	const wranglerNames = knownOnly ? [] : listPagesCustomDomainsWithWrangler(tenantRoot, projectName, { env });
	const domainNames = [...new Set([...desiredNames, ...listedNames, ...wranglerNames])];
	if (domainNames.length === 0) {
		return [resourceOperation('cloudflare', 'pages-custom-domain', projectName, 'missing', { projectName })];
	}
	return domainNames.map((name) => deleteCloudflareApiResource(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(name)}`,
		{ env, dryRun: false, name, type: 'pages-custom-domain' },
	));
}

function normalizePagesDeploymentId(deployment) {
	return typeof deployment?.id === 'string' ? deployment.id
		: typeof deployment?.Id === 'string' ? deployment.Id
			: '';
}

function normalizePagesDeployments(value) {
	return (Array.isArray(value) ? value : Array.isArray(value?.result) ? value.result : [])
		.filter((entry) => normalizePagesDeploymentId(entry));
}

function pagesDeploymentEnvironments(environment = 'all') {
	return environment === 'preview' ? ['preview']
		: environment === 'production' ? ['production']
			: ['preview', 'production'];
}

function listPagesDeploymentsWithApi(projectName, { env, environment = 'all' }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!projectName || !accountId) {
		return [];
	}
	const deployments = [];
	for (const pagesEnvironment of pagesDeploymentEnvironments(environment)) {
		let page = 1;
		let totalPages = 1;
		while (page <= totalPages && page <= 50) {
			const payload = cloudflareApiRequest(
				`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments?per_page=100&page=${page}&env=${pagesEnvironment}`,
				{ env, allowFailure: true },
			);
			if (payload?.success === false) {
				break;
			}
			deployments.push(...normalizePagesDeployments(payload));
			const reportedTotal = Number(payload?.result_info?.total_pages);
			totalPages = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : page;
			page += 1;
		}
	}
	return deployments;
}

function listPagesDeployments(tenantRoot, projectName, { env, environment = 'all' }) {
	const deployments = [];
	for (const pagesEnvironment of pagesDeploymentEnvironments(environment)) {
		const result = runWrangler(['pages', 'deployment', 'list', '--project-name', projectName, '--environment', pagesEnvironment, '--json'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
			env,
		});
		if (result.status !== 0) {
			continue;
		}
		try {
			deployments.push(...normalizePagesDeployments(JSON.parse(result.stdout || '[]')));
		} catch {
			// Fall back to the API list below.
		}
	}
	if (deployments.length > 0) {
		const byId = new Map(deployments.map((deployment) => [normalizePagesDeploymentId(deployment), deployment]));
		return [...byId.values()];
	}
	return listPagesDeploymentsWithApi(projectName, { env, environment });
}

function deletePagesDeployments(tenantRoot, projectName, { env, dryRun, environment = 'all' }) {
	if (!projectName) {
		return resourceOperation('cloudflare', 'pages-deployments', projectName, 'missing');
	}
	if (dryRun) {
		return resourceOperation('cloudflare', 'pages-deployments', projectName, 'planned', { reason: 'project_delete_prerequisite', environment });
	}
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return resourceOperation('cloudflare', 'pages-deployments', projectName, 'blocked', { reason: 'missing_cloudflare_account_id' });
	}
	let deleted = 0;
	let skipped = 0;
	let total = 0;
	for (let batch = 0; batch < 100; batch += 1) {
		const deployments = listPagesDeployments(tenantRoot, projectName, { env, environment });
		if (deployments.length === 0) {
			return resourceOperation('cloudflare', 'pages-deployments', projectName, deleted > 0 ? 'deleted' : 'missing', {
				deleted,
				skipped,
				total,
			});
		}
		total += deployments.length;
		let batchDeleted = 0;
		let batchSkipped = 0;
		for (const deployment of deployments) {
			const deploymentId = normalizePagesDeploymentId(deployment);
			if (!deploymentId) {
				continue;
			}
			const result = cloudflareApiRequest(
				`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}`,
				{ method: 'DELETE', env, allowFailure: true },
			);
			if (result?.success === false) {
				const message = formatCloudflareErrors(result);
				if (/active production deployment|production deployment|deployment is aliased|aliased deployment/iu.test(message)) {
					skipped += 1;
					batchSkipped += 1;
					continue;
				}
				if (looksLikeMissingResource(message)) {
					continue;
				}
				throw new Error(message || `Failed to delete Pages deployment ${deploymentId}.`);
			}
			deleted += 1;
			batchDeleted += 1;
		}
		if (batchDeleted === 0 && batchSkipped >= deployments.length) {
			break;
		}
	}
	return resourceOperation('cloudflare', 'pages-deployments', projectName, deleted > 0 ? 'deleted' : 'skipped', {
		deleted,
		skipped,
		total,
	});
}

function deletePagesProject(projectName, { env, dryRun }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!projectName || !accountId) {
		return resourceOperation('cloudflare', 'pages-project', projectName, 'missing');
	}
	return deleteCloudflareApiResource(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
		{ env, dryRun, name: projectName, type: 'pages-project' },
	);
}

function listDnsRecordsForName(zoneId, name, env) {
	if (!zoneId || !name) {
		return [];
	}
	const result = cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}&per_page=100`, { env, allowFailure: true });
	return Array.isArray(result?.result) ? result.result : [];
}

function deleteDnsRecordsForName(deployConfig, name, { env, dryRun }) {
	if (!name) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'missing')];
	}
	if (dryRun) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'planned')];
	}
	const zoneId = resolveCloudflareZoneIdForHost(deployConfig, name, env);
	if (!zoneId) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'blocked', { reason: 'zone_unresolved' })];
	}
	const records = listDnsRecordsForName(zoneId, name, env);
	if (records.length === 0) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'missing', { zoneId })];
	}
	return records.map((record) => {
		const recordName = record?.name ?? name;
		return deleteCloudflareApiResource(
			`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`,
			{ env, dryRun: false, name: recordName, type: 'dns-record' },
		);
	});
}

function deleteTreeseedCacheRules(deployConfig, state, { env, dryRun }) {
	const targets = [
		{ role: 'web', zoneId: state.webCache?.webZoneId, host: state.webCache?.webHost },
		{ role: 'content', zoneId: state.webCache?.contentZoneId, host: state.webCache?.contentHost },
	].filter((entry) => entry.host || entry.zoneId);
	if (targets.length === 0) {
		return [resourceOperation('cloudflare', 'cache-rules', null, 'missing')];
	}
	return targets.map((target) => {
		const zoneId = target.zoneId ?? resolveCloudflareZoneIdForHost(deployConfig, target.host, env);
		if (!zoneId) {
			return resourceOperation('cloudflare', 'cache-rules', target.host, 'blocked', { reason: 'zone_unresolved' });
		}
		if (dryRun) {
			return resourceOperation('cloudflare', 'cache-rules', target.host, 'planned', { zoneId });
		}
		const rulesets = listCloudflareZoneRulesets(zoneId, env);
		const ruleset = rulesets.find((entry) => entry?.phase === 'http_request_cache_settings') ?? null;
		const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
		const kept = rules.filter((rule) => typeof rule?.description !== 'string' || !rule.description.startsWith('treeseed-managed:'));
		if (!ruleset || kept.length === rules.length) {
			return resourceOperation('cloudflare', 'cache-rules', target.host, 'missing', { zoneId });
		}
		cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(ruleset.id)}`, {
			method: 'PUT',
			body: { rules: kept },
			env,
		});
		return resourceOperation('cloudflare', 'cache-rules', target.host, 'deleted', { zoneId, rulesetId: ruleset.id, removed: rules.length - kept.length });
	});
}

function configuredRailwayDestroyTargets(tenantRoot, deployConfig, scope) {
	const normalizedScope = scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
	if (normalizedScope === 'local' || deployConfig.runtime?.mode !== 'treeseed_managed') {
		return [];
	}
	let identity;
	try {
		identity = resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget(normalizedScope));
	} catch {
		identity = { deploymentKey: deployConfig.slug ?? deployConfig.name ?? 'treeseed' };
	}
	const services = [];
	for (const serviceKey of ['api', 'operationsRunner']) {
		const service = deployConfig.services?.[serviceKey];
		if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
			continue;
		}
		const baseServiceName = service.railway?.serviceName ?? `${identity.deploymentKey}-${serviceKey === 'operationsRunner' ? 'operations-runner' : serviceKey}`;
		const runnerPool = serviceKey === 'operationsRunner' && service.railway?.runnerPool && typeof service.railway.runnerPool === 'object'
			? service.railway.runnerPool
			: null;
		const count = serviceKey === 'operationsRunner'
			? Math.max(1, Number.parseInt(String(runnerPool?.bootstrapCount ?? 1), 10) || 1)
			: 1;
		for (let index = 1; index <= count; index += 1) {
			const serviceName = serviceKey === 'operationsRunner'
				? `${String(baseServiceName).replace(/-\d+$/u, '').replace(/-\d{2}$/u, '')}-${String(index).padStart(2, '0')}`
				: baseServiceName;
			services.push({
				key: serviceKey,
				projectName: service.railway?.projectName ?? identity.deploymentKey,
				serviceName,
				railwayEnvironment: normalizeRailwayEnvironmentName(service.environments?.[normalizedScope]?.railwayEnvironment ?? normalizedScope),
				domain: service.environments?.[normalizedScope]?.domain ?? null,
				volumeMountPath: serviceKey === 'operationsRunner' ? (service.railway?.volumeMountPath ?? runnerPool?.volumeMountPath ?? '/data') : null,
			});
		}
	}
	const treeseedDatabase = deployConfig.services?.treeseedDatabase;
	if (treeseedDatabase?.enabled !== false && treeseedDatabase?.provider === 'railway' && treeseedDatabase?.railway?.resourceType === 'postgres') {
		const baseName = typeof treeseedDatabase.railway?.serviceName === 'string' && treeseedDatabase.railway.serviceName.trim()
			? treeseedDatabase.railway.serviceName.trim()
			: `${deployConfig.slug ?? 'treeseed-market'}-postgres`;
		services.push({
			key: 'treeseedDatabase',
			projectName: deployConfig.services?.api?.railway?.projectName ?? identity.deploymentKey,
			serviceName: `${baseName.replace(/-(staging|prod|production)$/u, '')}-${normalizedScope === 'prod' ? 'prod' : normalizedScope}`,
			railwayEnvironment: normalizeRailwayEnvironmentName(normalizedScope),
			domain: null,
			volumeMountPath: null,
			dataStore: true,
		});
	}
	return services;
}

async function destroyRailwayResources(tenantRoot, deployConfig, target, { dryRun = false, deleteData = false, env = process.env } = {}) {
	const scope = target.kind === 'persistent' ? target.scope : target.branchName;
	const services = configuredRailwayDestroyTargets(tenantRoot, deployConfig, scope);
	if (services.length === 0) {
		return { operations: [resourceOperation('railway', 'environment', scope, 'skipped', { reason: 'not_applicable' })] };
	}
	const operations = [];
	if (!resolveRailwayApiToken(env)) {
		return {
			operations: services.map((service) => resourceOperation('railway', 'service', service.serviceName, 'blocked', { reason: 'missing_railway_api_token' })),
		};
	}
	const workspace = await resolveRailwayWorkspaceContext({ env, workspace: resolveRailwayWorkspace(env) });
	const projects = await listRailwayProjects({ env, workspaceId: workspace.id });
	const projectNames = [...new Set(services.map((service) => service.projectName).filter(Boolean))];
	for (const projectName of projectNames) {
		const project = projects.find((entry) => !entry.deletedAt && (entry.name === projectName || entry.id === projectName)) ?? null;
		if (!project) {
			operations.push(resourceOperation('railway', 'project', projectName, 'missing'));
			continue;
		}
		const serviceTargets = services.filter((service) => service.projectName === projectName);
		const environmentName = normalizeRailwayEnvironmentName(scope);
		const environment = project.environments.find((entry) => entry.name === environmentName || entry.id === environmentName) ?? null;
		if (!environment) {
			operations.push(resourceOperation('railway', 'environment', environmentName, 'missing', { projectId: project.id }));
		}
		for (const service of serviceTargets) {
			const railwayService = project.services.find((entry) => entry.name === service.serviceName || entry.id === service.serviceName) ?? null;
			const shouldDeleteData = service.dataStore ? deleteData : true;
			operations.push(resourceOperation('railway', service.dataStore ? 'postgres-service' : 'service', service.serviceName, railwayService ? (dryRun ? 'planned' : 'planned') : 'missing', {
				projectId: project.id,
				serviceId: railwayService?.id ?? null,
				...(service.dataStore && !shouldDeleteData ? { status: 'skipped', reason: 'data_preserved' } : {}),
			}));
			if (!railwayService || !environment) {
				continue;
			}
			if (shouldDeleteData) {
				const variables = await listRailwayVariables({
					projectId: project.id,
					environmentId: environment.id,
					serviceId: railwayService.id,
					env,
				});
				for (const variableName of Object.keys(variables).sort()) {
					operations.push(resourceOperation('railway', 'variable', `${service.serviceName}:${variableName}`, dryRun ? 'planned' : 'deleted', {
						projectId: project.id,
						serviceId: railwayService.id,
						environmentId: environment.id,
						reason: scope === 'prod' && deleteData ? 'project_delete' : 'environment_delete',
					}));
				}
			}
			const instance = await getRailwayServiceInstance({ serviceId: railwayService.id, environmentId: environment.id, env });
			if (instance.cronSchedule) {
				operations.push(resourceOperation('railway', 'schedule', `${service.serviceName}:${instance.cronSchedule}`, dryRun ? 'planned' : 'deleted', {
					projectId: project.id,
					serviceId: railwayService.id,
					environmentId: environment.id,
					reason: scope === 'prod' && deleteData ? 'project_delete' : 'environment_delete',
				}));
			}
			if (!service.dataStore && service.domain) {
				const domains = await listRailwayCustomDomains({ projectId: project.id, environmentId: environment.id, serviceId: railwayService.id, env });
				for (const domain of domains.filter((entry) => entry.domain === service.domain)) {
					if (dryRun) {
						operations.push(resourceOperation('railway', 'custom-domain', domain.domain, 'planned', { id: domain.id }));
					} else {
						const result = await deleteRailwayCustomDomain({ domainId: domain.id, env });
						operations.push(resourceOperation('railway', 'custom-domain', domain.domain, result.status, { id: domain.id }));
					}
				}
			}
		}
		if (deleteData) {
			const volumes = await listRailwayVolumes({ projectId: project.id, env });
			for (const volume of volumes) {
				const matchingInstance = volume.instances.find((instance) => instance.environmentId === environment?.id);
				if (!matchingInstance) {
					continue;
				}
				if (dryRun) {
					operations.push(resourceOperation('railway', 'volume', volume.name, 'planned', { id: volume.id, projectId: project.id }));
				} else {
					const result = await deleteRailwayVolume({ volumeId: volume.id, env });
					operations.push(resourceOperation('railway', 'volume', volume.name, result.status, { id: volume.id, projectId: project.id }));
				}
			}
		}
		const shouldDeleteProject = shouldDeleteRailwayProjectAfterEnvironmentDestroy(project, scope, deleteData, environment?.id ?? null);
		if ((scope === 'prod' && deleteData) || shouldDeleteProject) {
			if (dryRun) {
				operations.push(resourceOperation('railway', 'project', project.name, 'planned', {
					id: project.id,
					reason: scope === 'prod' ? 'prod_delete_data_cleanup' : 'no_managed_persistent_environments',
				}));
			} else {
				throw new Error('Railway project deletion is reconciler-owned. Use trsd reconcile destroy or live acceptance cleanup for project-scoped deletion.');
			}
		} else if (environment) {
			if (dryRun) {
				operations.push(resourceOperation('railway', 'environment', environment.name, 'planned', { id: environment.id, projectId: project.id }));
			} else {
				const result = await deleteRailwayEnvironment({ environmentId: environment.id, env });
				operations.push(resourceOperation('railway', 'environment', environment.name, result.status, { id: environment.id, projectId: project.id }));
			}
		}
	}
	return { operations };
}

export function shouldDeleteRailwayProjectAfterEnvironmentDestroy(project, scope, deleteData, deletedEnvironmentId = null) {
	if (!deleteData || scope === 'prod') {
		return false;
	}
	const managedPersistentNames = new Set(['staging', 'production', 'prod']);
	const targetEnvironmentName = normalizeRailwayEnvironmentName(scope);
	const remainingManagedEnvironments = (project?.environments ?? [])
		.filter((environment) => environment?.id !== deletedEnvironmentId)
		.filter((environment) => environment?.name !== targetEnvironmentName)
		.filter((environment) => managedPersistentNames.has(environment?.name));
	return remainingManagedEnvironments.length === 0;
}

function killPidFromFile(filePath, { dryRun }) {
	const pid = Number.parseInt(readFileSync(filePath, 'utf8').trim(), 10);
	if (!Number.isFinite(pid) || pid <= 0) {
		return resourceOperation('local', 'dev-process', filePath, 'missing');
	}
	if (dryRun) {
		return resourceOperation('local', 'dev-process', String(pid), 'planned', { pidFile: filePath });
	}
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// Already stopped or not owned by this session.
		}
	}
	try {
		unlinkSync(filePath);
	} catch {
		// Best effort cleanup.
	}
	return resourceOperation('local', 'dev-process', String(pid), 'deleted', { pidFile: filePath });
}

const LOCAL_DOCKER_RESOURCE_PATTERN = /(?:^|[-_.])(?:treeseed|treedx|treedb)(?:[-_.]|$)|(?:treeseed|treedx|treedb)/iu;
let destroyDockerRunnerForTests = null;

export function setDestroyDockerRunnerForTests(runner) {
	destroyDockerRunnerForTests = runner;
}

function runDestroyDocker(args) {
	if (destroyDockerRunnerForTests) {
		return destroyDockerRunnerForTests(args);
	}
	return spawnSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
}

function dockerAvailable() {
	const result = runDestroyDocker(['info']);
	return result.status === 0;
}

function dockerList(formatArgs) {
	const result = runDestroyDocker(formatArgs);
	if (result.status !== 0) {
		return [];
	}
	return result.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function matchingDockerEntries(lines, parser) {
	return lines
		.map(parser)
		.filter((entry) => entry && LOCAL_DOCKER_RESOURCE_PATTERN.test(`${entry.name} ${entry.image ?? ''}`));
}

function removeDockerResource(kind, id, name) {
	const args = kind === 'container'
		? ['rm', '-f', id]
		: kind === 'volume'
			? ['volume', 'rm', '-f', id]
			: ['network', 'rm', id];
	const result = runDestroyDocker(args);
	if (result.status === 0) {
		return resourceOperation('local', `docker-${kind}`, name, 'deleted', { id });
	}
	return resourceOperation('local', `docker-${kind}`, name, 'blocked', {
		id,
		reason: result.stderr?.trim() || result.stdout?.trim() || 'docker_remove_failed',
	});
}

export function dockerLocalRuntimeResourceOperations({ dryRun = false } = {}) {
	if (!dockerAvailable()) {
		return [resourceOperation('local', 'docker-cleanup', 'docker', 'skipped', { reason: 'docker_unavailable' })];
	}
	const containers = matchingDockerEntries(
		dockerList(['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}']),
		(line) => {
			const [id, name, image] = line.split('\t');
			return id && name ? { id, name, image } : null;
		},
	);
	const volumes = matchingDockerEntries(
		dockerList(['volume', 'ls', '--format', '{{.Name}}']),
		(line) => ({ id: line, name: line }),
	);
	const networks = matchingDockerEntries(
		dockerList(['network', 'ls', '--format', '{{.ID}}\t{{.Name}}']),
		(line) => {
			const [id, name] = line.split('\t');
			return id && name ? { id, name } : null;
		},
	).filter((entry) => !['bridge', 'host', 'none'].includes(entry.name));

	if (dryRun) {
		return [
			...containers.map((entry) => resourceOperation('local', 'docker-container', entry.name, 'planned', { id: entry.id })),
			...volumes.map((entry) => resourceOperation('local', 'docker-volume', entry.name, 'planned', { id: entry.id })),
			...networks.map((entry) => resourceOperation('local', 'docker-network', entry.name, 'planned', { id: entry.id })),
			...(containers.length || volumes.length || networks.length
				? []
				: [resourceOperation('local', 'docker-cleanup', 'docker', 'missing', { reason: 'no_matching_resources' })]),
		];
	}

	const operations = [];
	for (const entry of containers) {
		operations.push(removeDockerResource('container', entry.id, entry.name));
	}
	for (const entry of volumes) {
		operations.push(removeDockerResource('volume', entry.id, entry.name));
	}
	for (const entry of networks) {
		operations.push(removeDockerResource('network', entry.id, entry.name));
	}
	if (!operations.length) {
		operations.push(resourceOperation('local', 'docker-cleanup', 'docker', 'missing', { reason: 'no_matching_resources' }));
	}
	return operations;
}

function destroyLocalRuntimeResources(tenantRoot, { dryRun = false, deleteData = false } = {}) {
	const operations = [];
	const pidDir = resolve(tenantRoot, '.treeseed/dev-pids');
	if (existsSync(pidDir)) {
		for (const entry of readdirSync(pidDir)) {
			if (entry.endsWith('.pid')) {
				operations.push(killPidFromFile(resolve(pidDir, entry), { dryRun }));
			}
		}
	} else {
		operations.push(resourceOperation('local', 'dev-pids', pidDir, 'missing'));
	}
	if (deleteData) {
		for (const relativePath of [
			'.treeseed/generated/environments/local',
			'.treeseed/generated/dev',
			'.treeseed/operations-runner',
			'.treeseed/local-capacity-provider/data',
		]) {
			const absolutePath = resolve(tenantRoot, relativePath);
			if (!existsSync(absolutePath)) {
				operations.push(resourceOperation('local', 'data-path', relativePath, 'missing'));
				continue;
			}
			if (dryRun) {
				operations.push(resourceOperation('local', 'data-path', relativePath, 'planned'));
				continue;
			}
			rmSync(absolutePath, { recursive: true, force: true });
			operations.push(resourceOperation('local', 'data-path', relativePath, 'deleted'));
		}
		operations.push(...dockerLocalRuntimeResourceOperations({ dryRun }));
	} else {
		operations.push(resourceOperation('local', 'data-path', '.treeseed/generated/environments/local', 'skipped', { reason: 'data_preserved' }));
	}
	return { operations };
}

function treeSeedSweepTokens(deployConfig, state) {
	const configuredHosts = [
		deployConfig.siteUrl,
		deployConfig.surfaces?.web?.publicBaseUrl,
		deployConfig.surfaces?.web?.environments?.staging?.domain,
		deployConfig.surfaces?.web?.environments?.prod?.domain,
		deployConfig.surfaces?.api?.environments?.staging?.domain,
		deployConfig.surfaces?.api?.environments?.prod?.domain,
		deployConfig.services?.api?.environments?.staging?.domain,
		deployConfig.services?.api?.environments?.prod?.domain,
	].map((value) => primaryHost(value) ?? value);
	return [...new Set([
		'treeseed',
		deployConfig.slug,
		deployConfig.name,
		state.identity?.deploymentKey,
		state.identity?.environmentKey,
		state.pages?.projectName,
		state.workerName,
		state.content?.bucketName,
		state.kvNamespaces?.FORM_GUARD_KV?.name,
		state.kvNamespaces?.SESSION?.name,
		state.d1Databases?.SITE_DATA_DB?.databaseName,
		...configuredHosts,
	].map((value) => String(value ?? '').trim().toLowerCase()).filter((value) => value.length >= 4))];
}

function isProtectedAiIntegrationResource(value) {
	return /(?:^|[-_.])(?:ai-gateway|workers-ai|ai-integration|openai|anthropic)(?:[-_.]|$)/iu.test(String(value ?? ''));
}

function matchesTreeSeedSweep(value, tokens) {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized || isProtectedAiIntegrationResource(normalized)) {
		return false;
	}
	return tokens.some((token) => normalized === token || normalized.includes(token));
}

function cloudflareNameCandidates(entry) {
	return [
		entry?.name,
		entry?.title,
		entry?.id,
		entry?.queue_name,
		entry?.script,
		entry?.domain,
		entry?.hostname,
		entry?.content,
		entry?.comment,
		...(Array.isArray(entry?.domains) ? entry.domains : []),
		...(Array.isArray(entry?.tags) ? entry.tags : []),
	].filter(Boolean);
}

function cloudflareEntryMatchesTreeSeed(entry, tokens) {
	return cloudflareNameCandidates(entry).some((candidate) => matchesTreeSeedSweep(candidate, tokens));
}

function deleteDnsRecord(zoneId, record, { env, dryRun }) {
	const name = record?.name ?? record?.content ?? record?.id ?? null;
	if (!zoneId || !record?.id) {
		return resourceOperation('cloudflare', 'dns-record', name, 'missing', { zoneId });
	}
	if (dryRun) {
		return resourceOperation('cloudflare', 'dns-record', name, 'planned', {
			zoneId,
			id: record.id,
			content: record.content ?? null,
			recordType: record.type ?? null,
		});
	}
	return deleteCloudflareApiResource(
		`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`,
		{ env, dryRun: false, name, type: 'dns-record' },
	);
}

function sweepTreeSeedCloudflareResources(tenantRoot, deployConfig, state, { env, dryRun, deleteData }) {
	const tokens = treeSeedSweepTokens(deployConfig, state);
	const operations = [];
	const pagesProjects = listPagesProjects(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens));
	for (const project of pagesProjects) {
		const projectName = project?.name ?? project?.id ?? null;
		operations.push(...deletePagesCustomDomains(tenantRoot, projectName, [], { env, dryRun, knownOnly: false }));
		operations.push(deletePagesDeployments(tenantRoot, projectName, { env, dryRun, environment: 'all' }));
		operations.push(deletePagesProject(projectName, { env, dryRun }));
	}

	for (const worker of listWorkers(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const name = worker?.id ?? worker?.name ?? worker?.script ?? null;
		const deleted = deleteWorker(tenantRoot, name, { env, dryRun, force: true });
		operations.push(resourceOperation('cloudflare', 'worker', name, deleted.status, { ...deleted, sweep: true }));
	}

	for (const namespace of listKvNamespaces(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const deleted = deleteKvNamespace(tenantRoot, namespace.id, { env, dryRun });
		operations.push(resourceOperation('cloudflare', 'kv-namespace', namespace.title ?? namespace.id, deleted.status, { ...deleted, sweep: true }));
	}

	for (const queue of listQueues(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		operations.push({ ...deleteQueueByName(tenantRoot, queue, { env, dryRun }), sweep: true });
	}

	for (const database of listD1Databases(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const name = database?.name ?? database?.uuid ?? database?.id ?? null;
		const deleted = deleteData ? deleteD1Database(tenantRoot, name, { env, dryRun }) : null;
		operations.push(resourceOperation('cloudflare', 'd1-database', name, deleteData ? deleted?.status : 'skipped', {
			...(deleteData ? deleted : { reason: 'data_preserved' }),
			sweep: true,
		}));
	}

	for (const bucket of listR2Buckets(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		operations.push({ ...deleteR2Bucket(tenantRoot, bucket.name, { env, dryRun, deleteData }), sweep: true });
	}

	for (const widget of listTurnstileWidgets(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const deleted = deleteTurnstileWidget(widget.sitekey, { env, dryRun, name: widget.name });
		operations.push(resourceOperation('cloudflare', 'turnstile-widget', widget.name ?? widget.sitekey, deleted.status, { ...deleted, sweep: true }));
	}

	for (const zone of listDnsZones(env)) {
		const zoneId = zone?.id ?? null;
		for (const record of listDnsRecords(zoneId, env)) {
			if (record?.type === 'SOA' || record?.type === 'NS') {
				continue;
			}
			if (!cloudflareEntryMatchesTreeSeed(record, tokens)) {
				continue;
			}
			operations.push({ ...deleteDnsRecord(zoneId, record, { env, dryRun }), zoneName: zone?.name ?? null, sweep: true });
		}
	}

	return operations.length > 0
		? operations
		: [resourceOperation('cloudflare', 'treeseed-sweep', 'cloudflare', 'missing', { reason: 'no_matching_resources' })];
}

function countMatchingCloudflareEntries(entries, tokens) {
	return entries.filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens)).length;
}

export function cloudflareDestroyVerification(tenantRoot, deployConfig, state, env) {
	const tokens = treeSeedSweepTokens(deployConfig, state);
	const zoneIds = new Set([
		deployConfig.cloudflare?.zoneId,
		state.webCache?.webZoneId,
		state.webCache?.contentZoneId,
	]);
	for (const zone of listDnsZones(env)) {
		if (zone?.id) {
			zoneIds.add(zone.id);
		}
	}
	const dnsRecords = [];
	for (const zoneId of [...zoneIds].filter(Boolean)) {
		dnsRecords.push(...listDnsRecords(zoneId, env));
	}
	const remaining = {
		pages: countMatchingCloudflareEntries(listPagesProjects(tenantRoot, env), tokens),
		workers: countMatchingCloudflareEntries(listWorkers(tenantRoot, env), tokens),
		kvNamespaces: countMatchingCloudflareEntries(listKvNamespaces(tenantRoot, env), tokens),
		queues: countMatchingCloudflareEntries(listQueues(tenantRoot, env), tokens),
		d1Databases: countMatchingCloudflareEntries(listD1Databases(tenantRoot, env), tokens),
		r2Buckets: countMatchingCloudflareEntries(listR2Buckets(tenantRoot, env), tokens),
		turnstileWidgets: countMatchingCloudflareEntries(listTurnstileWidgets(tenantRoot, env), tokens),
		dnsRecords: countMatchingCloudflareEntries(
			dnsRecords.filter((record) => record?.type !== 'SOA' && record?.type !== 'NS'),
			tokens,
		),
	};
	const totalRemaining = Object.values(remaining).reduce((sum, value) => sum + value, 0);
	return {
		provider: 'cloudflare',
		method: 'cloudflare-api',
		status: totalRemaining === 0 ? 'clean' : 'remaining',
		remaining,
		totalRemaining,
	};
}

function localDockerDestroyVerification() {
	if (!dockerAvailable()) {
		return {
			provider: 'local-docker',
			method: 'docker-cli',
			status: 'skipped',
			reason: 'docker_unavailable',
			remaining: {
				containers: 0,
				volumes: 0,
				networks: 0,
			},
			totalRemaining: 0,
		};
	}
	const containers = matchingDockerEntries(
		dockerList(['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}']),
		(line) => {
			const [id, name, image] = line.split('\t');
			return id && name ? { id, name, image } : null;
		},
	).length;
	const volumes = matchingDockerEntries(
		dockerList(['volume', 'ls', '--format', '{{.Name}}']),
		(line) => ({ id: line, name: line }),
	).length;
	const networks = matchingDockerEntries(
		dockerList(['network', 'ls', '--format', '{{.ID}}\t{{.Name}}']),
		(line) => {
			const [id, name] = line.split('\t');
			return id && name ? { id, name } : null;
		},
	).filter((entry) => !['bridge', 'host', 'none'].includes(entry.name)).length;
	const remaining = { containers, volumes, networks };
	const totalRemaining = containers + volumes + networks;
	return {
		provider: 'local-docker',
		method: 'docker-cli',
		status: totalRemaining === 0 ? 'clean' : 'remaining',
		remaining,
		totalRemaining,
	};
}

async function sweepTreeSeedRailwayResources(deployConfig, state, { env, dryRun }) {
	if (!resolveRailwayApiToken(env)) {
		return [resourceOperation('railway', 'treeseed-sweep', 'railway', 'blocked', { reason: 'missing_railway_api_token' })];
	}
	const tokens = treeSeedSweepTokens(deployConfig, state);
	const workspace = await resolveRailwayWorkspaceContext({ env, workspace: resolveRailwayWorkspace(env) });
	const projects = await listRailwayProjects({ env, workspaceId: workspace.id });
	const operations = [];
	for (const project of projects) {
		if (project.deletedAt || !matchesTreeSeedSweep(project.name, tokens)) {
			continue;
		}
		if (dryRun) {
			operations.push(resourceOperation('railway', 'project', project.name, 'planned', {
				id: project.id,
				workspaceId: workspace.id,
				sweep: true,
			}));
		} else {
			throw new Error('Railway project sweep deletion is reconciler-owned. Use trsd reconcile test-live --mode cleanup for isolated cleanup.');
		}
	}
	return operations.length > 0
		? operations
		: [resourceOperation('railway', 'treeseed-sweep', 'railway', 'missing', { reason: 'no_matching_projects' })];
}

export async function destroyTreeseedEnvironmentResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.workerName = targetWorkerName(deployConfig, target);

	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};

	const dryRun = options.dryRun ?? false;
	const deleteData = options.deleteData === true;
	const force = options.force ?? false;
	const sweepTreeseed = options.sweepTreeseed === true;
	const destroysSharedWebSurface = target.kind === 'persistent' && target.scope === 'prod' && deleteData;
	const kvNamespaces = dryRun ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(tenantRoot, env);
	const queues = dryRun ? [] : listQueues(tenantRoot, env);
	const buckets = dryRun ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = dryRun ? [] : listPagesProjects(tenantRoot, env);
	const turnstileWidgets = dryRun ? [] : listTurnstileWidgets(tenantRoot, env);

	state.kvNamespaces.FORM_GUARD_KV.id = resolveExistingKvIdByName(
		kvNamespaces,
		state.kvNamespaces.FORM_GUARD_KV.name,
		state.kvNamespaces.FORM_GUARD_KV.id,
	);
	if (state.kvNamespaces.SESSION?.name) {
		state.kvNamespaces.SESSION.id = resolveExistingKvIdByName(
			kvNamespaces,
			state.kvNamespaces.SESSION.name,
			state.kvNamespaces.SESSION.id,
		);
	}
	state.d1Databases.SITE_DATA_DB = resolveExistingD1ByName(
		d1Databases,
		state.d1Databases.SITE_DATA_DB.databaseName,
		state.d1Databases.SITE_DATA_DB,
	);
	state.turnstileWidgets.formGuard = resolveExistingTurnstileWidget(turnstileWidgets, state.turnstileWidgets?.formGuard);

	const pagesProject = pagesProjects.find((entry) => entry?.name === state.pages?.projectName);
	const bucket = buckets.find((entry) => entry?.name === state.content?.bucketName);

	const workerResult = deleteWorker(tenantRoot, state.workerName, { env, dryRun, force });
	const turnstileWidget = deleteTurnstileWidget(state.turnstileWidgets?.formGuard?.sitekey, {
		env,
		dryRun,
		name: state.turnstileWidgets?.formGuard?.name,
	});
	const formGuard = deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.id, { env, dryRun });
	const formGuardPreview =
		state.kvNamespaces.FORM_GUARD_KV.previewId
		&& state.kvNamespaces.FORM_GUARD_KV.previewId !== state.kvNamespaces.FORM_GUARD_KV.id
			? deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.previewId, { env, dryRun, preview: true })
			: null;
	const session = state.kvNamespaces.SESSION?.id
		? deleteKvNamespace(tenantRoot, state.kvNamespaces.SESSION.id, { env, dryRun })
		: null;
	const sessionPreview =
		state.kvNamespaces.SESSION?.previewId
		&& state.kvNamespaces.SESSION.previewId !== state.kvNamespaces.SESSION.id
			? deleteKvNamespace(tenantRoot, state.kvNamespaces.SESSION.previewId, { env, dryRun, preview: true })
			: null;
	const knownKvIds = new Set([
		state.kvNamespaces.FORM_GUARD_KV.id,
		state.kvNamespaces.FORM_GUARD_KV.previewId,
		state.kvNamespaces.SESSION?.id,
		state.kvNamespaces.SESSION?.previewId,
	].filter(Boolean));
	const legacyKvPrefix = state.identity?.deploymentKey ?? state.pages?.projectName ?? '';
	const legacyKvNamespaces = dryRun ? [] : kvNamespaces
		.filter((namespace) => {
			const title = typeof namespace?.title === 'string' ? namespace.title : '';
			const id = typeof namespace?.id === 'string' ? namespace.id : '';
			return title
				&& id
				&& !knownKvIds.has(id)
				&& legacyKvPrefix
				&& title.includes(legacyKvPrefix)
				&& title.includes(target.scope);
		})
		.map((namespace) => {
			const result = deleteKvNamespace(tenantRoot, namespace.id, { env, dryRun: false });
			return resourceOperation('cloudflare', 'kv-namespace', namespace.title, result.status, { ...result, legacy: true });
		});
	const database = deleteD1DatabaseForDestroy(tenantRoot, state.d1Databases.SITE_DATA_DB.databaseName, { env, dryRun, deleteData });
	const r2Bucket = bucket || dryRun ? deleteR2Bucket(tenantRoot, state.content?.bucketName, { env, dryRun, deleteData }) : resourceOperation('cloudflare', 'r2-bucket', state.content?.bucketName, 'missing');
	const pageDnsNames = [
		state.pages?.customDomain,
		deployConfig.surfaces?.web?.environments?.[target.scope]?.domain,
		target.scope === 'prod' ? primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl) : null,
	].filter(Boolean);
	const apiDnsNames = [
		deployConfig.services?.api?.environments?.[target.scope]?.domain,
		deployConfig.surfaces?.api?.environments?.[target.scope]?.domain,
	].filter(Boolean);
	const dnsRecords = [...new Set([...pageDnsNames, ...apiDnsNames])]
		.flatMap((name) => deleteDnsRecordsForName(deployConfig, name, { env, dryRun }));
	const cacheRules = deleteTreeseedCacheRules(deployConfig, state, { env, dryRun });
	const pageCustomDomains = pagesProject || dryRun
		? deletePagesCustomDomains(tenantRoot, state.pages?.projectName, pageDnsNames, { env, dryRun, knownOnly: !destroysSharedWebSurface })
		: [resourceOperation('cloudflare', 'pages-custom-domain', state.pages?.projectName, 'missing')];
	const pageDeployments = pagesProject || dryRun
		? deletePagesDeployments(tenantRoot, state.pages?.projectName, {
			env,
			dryRun,
			environment: destroysSharedWebSurface ? 'all' : 'preview',
		})
		: resourceOperation('cloudflare', 'pages-deployments', state.pages?.projectName, 'missing');
	const pages = destroysSharedWebSurface && (pagesProject || dryRun)
		? deletePagesProject(state.pages?.projectName, { env, dryRun })
		: resourceOperation('cloudflare', 'pages-project', state.pages?.projectName, 'skipped', {
			reason: target.scope === 'prod' ? 'delete_data_required' : 'shared_web_surface',
		});
	const local = target.kind === 'persistent' && target.scope === 'local'
		? destroyLocalRuntimeResources(tenantRoot, { dryRun, deleteData })
		: { operations: [] };
	const railway = await destroyRailwayResources(tenantRoot, deployConfig, target, { dryRun, deleteData, env: process.env });
	const sweep = sweepTreeseed
		? {
			cloudflare: sweepTreeSeedCloudflareResources(tenantRoot, deployConfig, state, { env, dryRun, deleteData }),
			railway: await sweepTreeSeedRailwayResources(deployConfig, state, { env: process.env, dryRun }),
		}
		: { cloudflare: [], railway: [] };

	const operations = {
		cloudflare: [
			resourceOperation('cloudflare', 'worker', state.workerName, workerResult.status, workerResult),
			resourceOperation('cloudflare', 'turnstile-widget', state.turnstileWidgets?.formGuard?.name, turnstileWidget.status, turnstileWidget),
			resourceOperation('cloudflare', 'kv-namespace', state.kvNamespaces.FORM_GUARD_KV.name, formGuard.status, formGuard),
			...(formGuardPreview ? [resourceOperation('cloudflare', 'kv-namespace-preview', state.kvNamespaces.FORM_GUARD_KV.name, formGuardPreview.status, formGuardPreview)] : []),
			...(session ? [resourceOperation('cloudflare', 'kv-namespace', state.kvNamespaces.SESSION.name, session.status, session)] : []),
			...(sessionPreview ? [resourceOperation('cloudflare', 'kv-namespace-preview', state.kvNamespaces.SESSION.name, sessionPreview.status, sessionPreview)] : []),
			...legacyKvNamespaces,
			database,
			r2Bucket,
			...pageCustomDomains,
			pageDeployments,
			pages,
			...dnsRecords,
			...cacheRules,
			...sweep.cloudflare,
		],
		railway: [
			...railway.operations,
			...sweep.railway,
		],
		local: local.operations,
	};
	const verification = dryRun
		? null
		: {
			cloudflare: cloudflareDestroyVerification(tenantRoot, deployConfig, state, env),
			...(target.kind === 'persistent' && target.scope === 'local'
				? { localDocker: localDockerDestroyVerification() }
				: {}),
		};

	return {
		target,
		deleteData,
		sweepTreeseed,
		summary: buildDestroySummary(deployConfig, state, target),
		operations,
		verification,
	};
}

export function destroyCloudflareResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.workerName = targetWorkerName(deployConfig, target);
	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};
	const dryRun = options.dryRun ?? false;
	const deleteData = options.deleteData === true;
	const force = options.force ?? false;
	const kvNamespaces = dryRun ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(tenantRoot, env);
	const queues = listQueues(tenantRoot, env);
	const buckets = dryRun ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = dryRun ? [] : listPagesProjects(tenantRoot, env);
	const turnstileWidgets = dryRun ? [] : listTurnstileWidgets(tenantRoot, env);

	state.kvNamespaces.FORM_GUARD_KV.id = resolveExistingKvIdByName(
		kvNamespaces,
		state.kvNamespaces.FORM_GUARD_KV.name,
		state.kvNamespaces.FORM_GUARD_KV.id,
	);
	state.d1Databases.SITE_DATA_DB = resolveExistingD1ByName(
		d1Databases,
		state.d1Databases.SITE_DATA_DB.databaseName,
		state.d1Databases.SITE_DATA_DB,
	);
	state.turnstileWidgets.formGuard = resolveExistingTurnstileWidget(turnstileWidgets, state.turnstileWidgets?.formGuard);
	const bucket = buckets.find((entry) => entry?.name === state.content?.bucketName);
	const pagesProject = pagesProjects.find((entry) => entry?.name === state.pages?.projectName);
	const worker = deleteWorker(tenantRoot, state.workerName, { env, dryRun, force });
	const turnstileWidget = deleteTurnstileWidget(state.turnstileWidgets?.formGuard?.sitekey, {
		env,
		dryRun,
		name: state.turnstileWidgets?.formGuard?.name,
	});
	const formGuard = deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.id, { env, dryRun });
	const database = deleteD1DatabaseForDestroy(tenantRoot, state.d1Databases.SITE_DATA_DB.databaseName, { env, dryRun, deleteData });
	const r2Bucket = bucket || dryRun
		? deleteR2Bucket(tenantRoot, state.content?.bucketName, { env, dryRun, deleteData })
		: resourceOperation('cloudflare', 'r2-bucket', state.content?.bucketName, 'missing');
	const pages = pagesProject || dryRun
		? deletePagesProject(state.pages?.projectName, { env, dryRun })
		: resourceOperation('cloudflare', 'pages-project', state.pages?.projectName, 'missing');
	const operations = {
		worker,
		turnstileWidget,
		formGuard,
		database,
		r2Bucket,
		pages,
	};
	return {
		target,
		deleteData,
		summary: buildDestroySummary(deployConfig, state, target),
		operations,
	};
}

export function cleanupDestroyedState(tenantRoot, options = {}) {
	const target = options.scope || options.target ? normalizeTarget(options.scope ?? options.target) : null;
	if (target) {
		const { statePath, generatedRoot } = resolveTargetPaths(tenantRoot, target);
		rmSync(statePath, { force: true });
		rmSync(generatedRoot, { recursive: true, force: true });
		if (options.removeBuildArtifacts) {
			rmSync(resolve(tenantRoot, 'dist'), { recursive: true, force: true });
		}
		return;
	}

	rmSync(resolve(tenantRoot, STATE_ROOT), { recursive: true, force: true });
	rmSync(resolve(tenantRoot, GENERATED_ROOT), { recursive: true, force: true });
	if (options.removeBuildArtifacts) {
		rmSync(resolve(tenantRoot, 'dist'), { recursive: true, force: true });
	}
}

export function provisionCloudflareResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.workerName = targetWorkerName(deployConfig, target);

	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};
	const dryRun = options.dryRun ?? false;
	const kvNamespaces = dryRun ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(tenantRoot, env);
	const queues = dryRun ? [] : listQueues(tenantRoot, env);
	const buckets = dryRun ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = dryRun ? [] : listPagesProjects(tenantRoot, env);

	const ensureKv = (binding) => {
		const current = state.kvNamespaces[binding];
		if (current?.id && !isPlaceholderResourceId(current.id)) {
			state.kvNamespaces[binding].previewId = current.previewId ?? current.id;
			return;
		}

		const existing = kvNamespaces.find((entry) => entry?.title === current.name);
		if (existing?.id) {
			state.kvNamespaces[binding].id = existing.id;
			state.kvNamespaces[binding].previewId = existing.id;
			return;
		}

		if (dryRun) {
			state.kvNamespaces[binding].id = `dryrun-${current.name}`;
			state.kvNamespaces[binding].previewId = `dryrun-${current.name}-preview`;
			return;
		}

		runWrangler(['kv', 'namespace', 'create', current.name], { cwd: tenantRoot, capture: true, env });
		const refreshed = listKvNamespaces(tenantRoot, env);
		const created = refreshed.find((entry) => entry?.title === current.name);
		if (!created?.id) {
			throw new Error(`Unable to resolve created KV namespace id for ${current.name}.`);
		}
		state.kvNamespaces[binding].id = created.id;
		state.kvNamespaces[binding].previewId = created.id;
	};

	const ensureD1 = () => {
		const current = state.d1Databases.SITE_DATA_DB;
		if (current?.databaseId && !isPlaceholderResourceId(current.databaseId)) {
			return;
		}

		const existing = d1Databases.find((entry) => entry?.name === current.databaseName);
		if (existing?.uuid) {
			current.databaseId = existing.uuid;
			current.previewDatabaseId = existing.previewDatabaseUuid ?? existing.uuid;
			return;
		}

		if (dryRun) {
			current.databaseId = `dryrun-${current.databaseName}`;
			current.previewDatabaseId = `dryrun-${current.databaseName}-preview`;
			return;
		}

		runWrangler(['d1', 'create', current.databaseName], {
			cwd: tenantRoot,
			capture: true,
			env,
		});
		const refreshed = listD1Databases(tenantRoot, env);
		const created = refreshed.find((entry) => entry?.name === current.databaseName);
		if (!created?.uuid) {
			throw new Error(`Unable to resolve created D1 database id for ${current.databaseName}.`);
		}
		current.databaseId = created.uuid;
		current.previewDatabaseId = created.previewDatabaseUuid ?? created.uuid;
	};

	const ensureR2Bucket = () => {
		const bucketName = state.content?.bucketName;
		if (!bucketName) {
			return;
		}
		let refreshedBuckets = buckets;
		const exists = refreshedBuckets.find((entry) => entry?.name === bucketName);
		if (exists) {
			return;
		}
		if (dryRun) {
			return;
		}
		try {
			runWrangler(['r2', 'bucket', 'create', bucketName], {
				cwd: tenantRoot,
				capture: true,
				env,
			});
		} catch (error) {
			if (!isWranglerAlreadyExistsError(error, [/bucket you tried to create already exists, and you own it/i, /\[code:\s*10004\]/i])) {
				throw error;
			}
		}
		refreshedBuckets = listR2Buckets(tenantRoot, env);
		if (!refreshedBuckets.find((entry) => entry?.name === bucketName)) {
			throw new Error(`Unable to resolve Cloudflare R2 bucket ${bucketName} after reconciliation.`);
		}
	};

	const ensurePagesProject = () => {
		const current = state.pages;
		if (!current?.projectName) {
			return;
		}
		const exists = pagesProjects.find((entry) => entry?.name === current.projectName);
		if (exists) {
			current.url = exists.subdomain ? `https://${exists.subdomain}` : current.url ?? `https://${current.projectName}.pages.dev`;
			ensurePagesProjectCompatibility(env.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '', current.projectName, env, exists, { state, target });
			return;
		}
		if (dryRun) {
			current.url = `https://${current.projectName}.pages.dev`;
			return;
		}
		runWrangler([
			'pages',
			'project',
			'create',
			current.projectName,
			'--production-branch',
			target.kind === 'persistent' && target.scope === 'prod'
				? (current.productionBranch ?? 'main')
				: (current.stagingBranch ?? 'staging'),
		], {
			cwd: tenantRoot,
			capture: true,
			env,
		});
		ensurePagesProjectCompatibility(env.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '', current.projectName, env, null, { state, target });
		current.url = `https://${current.projectName}.pages.dev`;
	};

	ensureKv('FORM_GUARD_KV');
	ensureD1();
	ensureR2Bucket();
	ensurePagesProject();
	reconcileCloudflareWebCacheRules(tenantRoot, deployConfig, state, target, { dryRun });

	state.readiness.configured = true;
	state.readiness.provisioned = hasProvisionedCloudflareResources(state);
	state.readiness.deployable = state.readiness.provisioned === true;
	state.readiness.phase = state.readiness.provisioned === true ? 'provisioned' : 'config_complete';
	state.readiness.initialized = true;
	state.readiness.initializedAt = new Date().toISOString();
	state.readiness.lastValidatedAt = state.readiness.initializedAt;
	state.readiness.blockers = [];
	state.readiness.warnings = [];
	state.readiness.lastValidationSummary = {
		cloudflare: state.readiness.provisioned === true ? 'ready' : 'incomplete',
		railway: 'configured',
	};
	writeDeployState(tenantRoot, state, { target });
	return buildProvisioningSummary(deployConfig, state, target);
}

export function syncCloudflareSecrets(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};
	const entryFilter = Array.isArray(options.entryIds) && options.entryIds.length > 0 ? new Set(options.entryIds) : null;
	const extraSecrets = options.extraSecrets && typeof options.extraSecrets === 'object'
		? Object.fromEntries(Object.entries(options.extraSecrets)
			.filter(([key, value]) =>
				(!entryFilter || entryFilter.has(key))
				&& typeof value === 'string'
				&& value.length > 0))
		: {};
	const secrets = {
		...buildSecretMap(deployConfig, state),
		...extraSecrets,
	};
	const synced = [];
	const dryRun = options.dryRun ?? false;

	for (const [key, value] of Object.entries(secrets)) {
		if (!value) {
			continue;
		}

		synced.push(key);
		if (dryRun) {
			continue;
		}

		const command = state.pages?.projectName && target.kind === 'persistent'
			? [resolveWranglerBin(), 'pages', 'secret', 'put', key, '--project-name', state.pages.projectName]
			: [resolveWranglerBin(), 'secret', 'put', key, '--config', resolveGeneratedWranglerPath(tenantRoot, { target })];

		const result = spawnSync(process.execPath, command, {
			cwd: tenantRoot,
			input: `${value}\n`,
			stdio: ['pipe', 'inherit', 'inherit'],
			env: { ...process.env, ...env },
			encoding: 'utf8',
		});

		if (result.status !== 0) {
			throw new Error(`Failed to sync secret ${key}.`);
		}
	}

	state.generatedSecrets = {
		...(state.generatedSecrets ?? {}),
		TREESEED_FORM_TOKEN_SECRET: secrets.TREESEED_FORM_TOKEN_SECRET ?? state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET,
		TREESEED_EDITORIAL_PREVIEW_SECRET: secrets.TREESEED_EDITORIAL_PREVIEW_SECRET ?? state.generatedSecrets?.TREESEED_EDITORIAL_PREVIEW_SECRET,
	};
	writeDeployState(tenantRoot, state, { target });
	return synced;
}

export function verifyProvisionedCloudflareResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};
	const dryRun = options.dryRun ?? false;
	const kvNamespaces = dryRun ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(tenantRoot, env);
	const queues = dryRun ? [] : listQueues(tenantRoot, env);
	const buckets = dryRun ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = dryRun ? [] : listPagesProjects(tenantRoot, env);
	const livePages = pagesProjects.find((entry) => entry?.name === state.pages?.projectName);
	const pagesProject = dryRun || !env.CLOUDFLARE_ACCOUNT_ID || !state.pages?.projectName
		? livePages
		: cloudflareApiRequest(
			`/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/pages/projects/${encodeURIComponent(state.pages.projectName)}`,
			{ env, allowFailure: true },
		)?.result ?? livePages;
	const pagesConfigKey = target.kind === 'persistent' && target.scope === 'prod' ? 'production' : 'preview';
	const pagesConfig = pagesProject?.deployment_configs?.[pagesConfigKey] ?? {};
	const pagesBindings = buildCloudflarePagesFunctionBindings(state);
	const pageBindingConfigured = (configKey, binding, expected) => pagesConfig?.[configKey]?.[binding]
		&& Object.entries(expected).every(([key, value]) => pagesConfig[configKey][binding]?.[key] === value);

	const checks = {
		pages: Boolean(state.pages?.projectName && (livePages || pagesProject?.name === state.pages.projectName)),
		formGuardKv: Boolean(state.kvNamespaces?.FORM_GUARD_KV?.name && kvNamespaces.find((entry) => entry?.title === state.kvNamespaces.FORM_GUARD_KV.name)),
		d1: Boolean(state.d1Databases?.SITE_DATA_DB?.databaseName && d1Databases.find((entry) => entry?.name === state.d1Databases.SITE_DATA_DB.databaseName)),
		r2: Boolean(state.content?.bucketName && buckets.find((entry) => entry?.name === state.content.bucketName)),
		pagesFormGuardKvBinding: !pagesBindings.kv_namespaces?.FORM_GUARD_KV || pageBindingConfigured('kv_namespaces', 'FORM_GUARD_KV', pagesBindings.kv_namespaces.FORM_GUARD_KV),
		pagesD1Binding: !pagesBindings.d1_databases?.SITE_DATA_DB || pageBindingConfigured('d1_databases', 'SITE_DATA_DB', pagesBindings.d1_databases.SITE_DATA_DB),
		pagesR2Binding: !state.content?.r2Binding || !pagesBindings.r2_buckets?.[state.content.r2Binding] || pageBindingConfigured('r2_buckets', state.content.r2Binding, pagesBindings.r2_buckets[state.content.r2Binding]),
		webCache: !shouldManageCloudflareWebCacheRules(deployConfig, target) || state.webCache?.rulesManaged === true,
	};

	const ok = dryRun ? true : Object.values(checks).every(Boolean);
	state.readiness.configured = true;
	state.readiness.provisioned = ok;
	state.readiness.deployable = ok;
	state.readiness.phase = ok ? 'provisioned' : 'config_complete';
	state.readiness.lastValidatedAt = new Date().toISOString();
	state.readiness.blockers = [];
	state.readiness.warnings = [];
	state.readiness.lastValidationSummary = checks;

	if (state.pages) {
		const configuredWebUrl = resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'web');
		if (configuredWebUrl) {
			state.pages.url = configuredWebUrl;
		} else if (livePages?.subdomain) {
			state.pages.url = target.kind === 'persistent' && target.scope === 'staging'
				? `https://${state.pages.stagingBranch ?? 'staging'}.${livePages.subdomain}`
				: `https://${livePages.subdomain}`;
		}
	}
	if (!dryRun) {
		try {
			reconcileCloudflareWebCacheRules(tenantRoot, deployConfig, state, target, { dryRun: false });
		} catch (error) {
			state.webCache.rulesManaged = false;
			state.webCache.lastError = error instanceof Error ? error.message : String(error);
		}
	}
	state.webCache.lastVerifiedAt = new Date().toISOString();

	writeDeployState(tenantRoot, state, { target });
	return {
		ok,
		target: deployTargetLabel(target),
		checks,
		state,
	};
}

export function runRemoteD1Migrations(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const { wranglerPath, deployConfig, state } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	if (options.dryRun) {
		return { databaseName: state.d1Databases.SITE_DATA_DB.databaseName, dryRun: true };
	}

	const args = ['d1', 'migrations', 'apply', state.d1Databases.SITE_DATA_DB.databaseName, '--remote', '--config', wranglerPath];
	const env = { CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig) };
	const isTransient = (output) => /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|internal error/i.test(output || '');
	let lastOutput = '';
	for (let attempt = 1; attempt <= 3; attempt += 1) {
		const result = runWrangler(args, {
			cwd: tenantRoot,
			env,
			capture: true,
			allowFailure: true,
		});
		if (result.status === 0) {
			return { databaseName: state.d1Databases.SITE_DATA_DB.databaseName, dryRun: false };
		}
		lastOutput = [result.stderr?.trim(), result.stdout?.trim()].filter(Boolean).join('\n');
		if (!isTransient(lastOutput) || attempt === 3) {
			throw new Error(lastOutput || `Wrangler command failed: ${args.join(' ')}`);
		}
		sleepSync(2000 * attempt);
	}

	throw new Error(lastOutput || `Wrangler command failed: ${args.join(' ')}`);
}

export function markDeploymentInitialized(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const timestamp = new Date().toISOString();
	state.readiness.initialized = true;
	state.readiness.configured = true;
	state.readiness.provisioned = hasProvisionedCloudflareResources(state);
	state.readiness.deployable = state.readiness.provisioned === true;
	state.readiness.phase = state.readiness.provisioned === true ? 'provisioned' : 'config_complete';
	state.readiness.initializedAt = state.readiness.initializedAt ?? timestamp;
	state.readiness.lastValidatedAt = timestamp;
	state.readiness.lastConfigFingerprint = state.lastManifestFingerprint ?? state.readiness.lastConfigFingerprint;
	state.readiness.blockers = [];
	state.readiness.warnings = [];
	writeDeployState(tenantRoot, state, { target });
	return state;
}

export function markManagedServicesInitialized(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const timestamp = new Date().toISOString();
	for (const serviceKey of MANAGED_SERVICE_KEYS) {
		if (!state.services?.[serviceKey]?.enabled) {
			continue;
		}
		state.services[serviceKey].initialized = true;
		state.services[serviceKey].lastDeploymentTimestamp = state.services[serviceKey].lastDeploymentTimestamp ?? timestamp;
		state.services[serviceKey].lastDeployedUrl = state.services[serviceKey].lastDeployedUrl ?? state.services[serviceKey].publicBaseUrl ?? null;
	}
	writeDeployState(tenantRoot, state, { target });
	return state;
}

export function recordHostedDeploymentState(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const timestamp = typeof options.timestamp === 'string' && options.timestamp.trim()
		? options.timestamp.trim()
		: new Date().toISOString();
	const deployedUrl = typeof options.url === 'string' && options.url.trim()
		? options.url.trim()
		: (state.lastDeployedUrl ?? resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'web'));
	const commit = typeof options.commit === 'string' && options.commit.trim()
		? options.commit.trim()
		: null;

	state.lastDeployedUrl = deployedUrl;
	state.lastDeploymentTimestamp = timestamp;
	state.lastDeployedCommit = commit;
	state.readiness = {
		...(state.readiness ?? {}),
		initialized: true,
		configured: true,
		provisioned: true,
		deployable: true,
		phase: 'provisioned',
		initializedAt: state.readiness?.initializedAt ?? timestamp,
		lastValidatedAt: timestamp,
		blockers: [],
		warnings: state.readiness?.warnings ?? [],
	};
	const nextHistoryEntry = {
		commit,
		timestamp,
		url: deployedUrl,
		target: deployTargetLabel(target),
		source: options.source ?? 'hosted-github-workflow',
		workflow: options.workflow ?? null,
		runId: options.runId ?? null,
	};
	const history = Array.isArray(state.deploymentHistory) ? state.deploymentHistory : [];
	state.deploymentHistory = [...history, nextHistoryEntry].slice(-20);
	writeDeployState(tenantRoot, state, { target });
	return state;
}

export function assertDeploymentInitialized(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	if (state.readiness?.initialized) {
		return state;
	}

	throw new Error(
		`Treeseed environment ${deployTargetLabel(target)} has not been initialized. Run \`treeseed config --environment ${scopeFromTarget(target)}\` first.`,
	);
}

export function finalizeDeploymentState(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.lastManifestFingerprint = stableHash(JSON.stringify({ deployConfig, targetKey: targetKey(target) }));
	state.lastDeployedUrl = target.kind === 'branch'
		? targetWorkersDevUrl(state.workerName)
		: resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'web');
	state.lastDeploymentTimestamp = new Date().toISOString();
	state.lastDeployedCommit = envOrNull('GITHUB_SHA') ?? envOrNull('TREESEED_DEPLOY_COMMIT') ?? null;
	state.runtimeCompatibility = {
		envelopeSchemaGeneration: TRESEED_ENVELOPE_SCHEMA_GENERATION,
		migrationWaveId: TRESEED_MIGRATION_WAVE_ID,
		supportedPayloadVersionRange: TRESEED_SUPPORTED_PAYLOAD_RANGE,
	};
	const nextHistoryEntry = {
		commit: state.lastDeployedCommit,
		timestamp: state.lastDeploymentTimestamp,
		url: state.lastDeployedUrl,
		target: deployTargetLabel(target),
		appVersion: envOrNull('npm_package_version') ?? envOrNull('TREESEED_APP_VERSION') ?? null,
		envelopeSchemaGeneration: TRESEED_ENVELOPE_SCHEMA_GENERATION,
		migrationWaveId: TRESEED_MIGRATION_WAVE_ID,
		supportedPayloadVersionRange: TRESEED_SUPPORTED_PAYLOAD_RANGE,
	};
	const history = Array.isArray(state.deploymentHistory) ? state.deploymentHistory : [];
	state.deploymentHistory = [...history, nextHistoryEntry].slice(-20);
	state.readiness.initialized = true;
	state.readiness.configured = true;
	state.readiness.provisioned = hasProvisionedCloudflareResources(state);
	state.readiness.deployable = state.readiness.provisioned === true;
	state.readiness.phase = state.readiness.provisioned === true ? 'provisioned' : 'config_complete';
	state.readiness.lastValidatedAt = state.lastDeploymentTimestamp;
	state.readiness.blockers = [];
	state.readiness.warnings = [];
	for (const result of options.serviceResults ?? []) {
		if (!result?.service || !state.services?.[result.service]) {
			continue;
		}
		state.services[result.service].initialized = true;
		state.services[result.service].lastDeploymentTimestamp = state.lastDeploymentTimestamp;
		state.services[result.service].lastDeployedUrl = result.publicBaseUrl ?? state.services[result.service].publicBaseUrl ?? state.services[result.service].lastDeployedUrl ?? null;
		state.services[result.service].lastDeploymentCommand = result.command ?? null;
	}
	writeDeployState(tenantRoot, state, { target });
	if (target.kind === 'persistent') {
		try {
			const purgeResult = purgeSourcePageCaches(tenantRoot, { target, env: options.env });
			if (target.scope === 'prod' && purgeResult?.skipped) {
				throw new Error(`Production source-page cache purge was skipped: ${purgeResult.reason ?? 'unknown'}.`);
			}
		} catch (error) {
			// The purge helper persists its own error state.
			if (target.scope === 'prod') {
				throw error;
			}
		}
		return loadDeployState(tenantRoot, deployConfig, { target });
	}
	return state;
}

export function printDeploySummary(summary) {
	console.log('Treeseed deployment summary');
	console.log(`  Target: ${summary.target}`);
	console.log(`  Worker: ${summary.workerName}`);
	console.log(`  Site URL: ${summary.siteUrl}`);
	console.log(`  Account ID: ${summary.accountId}`);
	console.log(`  D1: ${summary.siteDataDb.databaseName} (${summary.siteDataDb.databaseId})`);
	console.log(`  KV FORM_GUARD_KV: ${summary.formGuardKv.id}`);
}

export function printDestroySummary(result) {
	const { summary, operations } = result;
	const cloudflare = Array.isArray(operations?.cloudflare) ? operations.cloudflare : null;
	const legacy = cloudflare
		? {
			worker: cloudflare.find((entry) => entry.type === 'worker'),
			database: cloudflare.find((entry) => entry.type === 'd1-database'),
			formGuard: cloudflare.find((entry) => entry.type === 'kv-namespace'),
			formGuardPreview: cloudflare.find((entry) => entry.type === 'kv-namespace-preview'),
			session: cloudflare.find((entry) => entry.type === 'kv-namespace' && entry.name === summary.sessionKv?.name),
			sessionPreview: cloudflare.find((entry) => entry.type === 'kv-namespace-preview' && entry.name === summary.sessionKv?.name),
		}
		: operations;
	console.log('Treeseed destroy summary');
	console.log(`  Target: ${summary.target}`);
	console.log(`  Worker: ${summary.workerName} -> ${legacy.worker?.status ?? 'unknown'}`);
	console.log(`  Site URL: ${summary.siteUrl}`);
	console.log(`  Account ID: ${summary.accountId}`);
	console.log(`  D1: ${summary.siteDataDb.databaseName} -> ${legacy.database?.status ?? 'unknown'}`);
	console.log(`  KV FORM_GUARD_KV: ${summary.formGuardKv.name} -> ${legacy.formGuard?.status ?? 'unknown'}`);
	if (legacy.formGuardPreview) {
		console.log(`  KV FORM_GUARD_KV preview -> ${legacy.formGuardPreview.status}`);
	}
	if (summary.sessionKv && legacy.session) {
		console.log(`  KV SESSION (deprecated): ${summary.sessionKv.name} -> ${legacy.session.status}`);
	}
	if (legacy.sessionPreview) {
		console.log(`  KV SESSION preview -> ${legacy.sessionPreview.status}`);
	}
	if (cloudflare) {
		for (const entry of [
			...cloudflare.filter((item) => !['worker', 'd1-database', 'kv-namespace', 'kv-namespace-preview'].includes(item.type)),
			...(Array.isArray(operations?.railway) ? operations.railway : []),
			...(Array.isArray(operations?.local) ? operations.local : []),
		]) {
			console.log(`  ${entry.provider} ${entry.type} ${entry.name ?? '(none)'} -> ${entry.status}`);
		}
	}
}
