import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveTreeseedWebCachePolicy } from '../../platform/deploy-config.ts';
import { normalizeRailwayEnvironmentName } from './railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from './runtime-tools.ts';

const DEFAULT_COMPATIBILITY_DATE = '2026-04-05';
const DEFAULT_COMPATIBILITY_FLAGS = ['nodejs_compat'];
const GENERATED_ROOT = '.treeseed/generated';
const STATE_ROOT = '.treeseed/state';
const WORKTREE_METADATA_RELATIVE_PATH = '.treeseed/worktree.json';
const PERSISTENT_SCOPES = new Set(['local', 'staging', 'prod']);
const MANAGED_SERVICE_KEYS = ['api', 'manager', 'worker', 'workdayStart', 'workdayReport'];
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
	const deploymentKey = `${teamSegment}-${projectSegment}`;
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

export function resolveConfiguredSurfaceDomain(deployConfig, target, surface) {
	if (target.kind !== 'persistent') {
		return null;
	}
	const scope = target.scope;
	const configured = deployConfig.surfaces?.[surface]?.environments?.[scope]?.domain?.trim();
	if (configured) {
		return configured;
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

function sharedDeploymentName(identity, role = '') {
	return role ? `${identity.deploymentKey}-${sanitizeSegment(role)}` : identity.deploymentKey;
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

export function buildPublicVars(deployConfig) {
	const identity = resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget('prod'));
	const contentRuntimeProvider = deployConfig.providers?.content?.runtime ?? 'team_scoped_r2_overlay';
	const contentPublishProvider = deployConfig.providers?.content?.publish ?? contentRuntimeProvider;
	const contentServingMode = envOrNull('TREESEED_CONTENT_SERVING_MODE')
		?? deployConfig.providers?.content?.serving
		?? 'local_collections';
	const contentDefaultTeamId = identity.teamId;
	const contentManifestKeyTemplate = deployConfig.cloudflare.r2?.manifestKeyTemplate ?? 'teams/{teamId}/published/common.json';
	const contentPreviewRootTemplate = deployConfig.cloudflare.r2?.previewRootTemplate ?? 'teams/{teamId}/previews';
	const contentManifestKey = contentManifestKeyTemplate.replaceAll('{teamId}', contentDefaultTeamId);
	const managedRuntime = deployConfig.runtime?.mode === 'treeseed_managed';
	const workerRailway = deployConfig.services?.worker?.railway ?? {};
	const webCachePolicy = resolveTreeseedWebCachePolicy(deployConfig);
	return {
		TREESEED_HOSTING_KIND: deployConfig.hosting?.kind ?? 'self_hosted_project',
		TREESEED_HOSTING_REGISTRATION: deployConfig.hosting?.registration ?? 'none',
		TREESEED_HUB_MODE: deployConfig.hub?.mode ?? 'treeseed_hosted',
		TREESEED_RUNTIME_MODE: deployConfig.runtime?.mode ?? 'none',
		TREESEED_RUNTIME_REGISTRATION: deployConfig.runtime?.registration ?? 'none',
		TREESEED_MARKET_API_BASE_URL: resolveConfiguredMarketBaseUrl(deployConfig),
		TREESEED_HOSTING_TEAM_ID: contentDefaultTeamId,
		TREESEED_PROJECT_ID: identity.projectId,
		TREESEED_AGENT_EXECUTION_PROVIDER: deployConfig.providers?.agents?.execution ?? 'stub',
		TREESEED_AGENT_REPOSITORY_PROVIDER: deployConfig.providers?.agents?.repository ?? 'stub',
		TREESEED_AGENT_VERIFICATION_PROVIDER: deployConfig.providers?.agents?.verification ?? 'stub',
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
	'BETTER_AUTH_URL',
	'TREESEED_SITE_URL',
	'TREESEED_AUTH_MODE',
	'TREESEED_AUTH_INTERNAL_SIGNUP',
	'TREESEED_AUTH_EMAIL_LINKING',
	'TREESEED_AUTH_ALLOW_MEMORY_DB',
	'TREESEED_AUTH_LOCAL_USE_MAILPIT',
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
	'TREESEED_API_WEB_EXCHANGE_TTL',
	'TREESEED_GITHUB_CLIENT_ID',
	'TREESEED_GITHUB_CLIENT_SECRET',
	'TREESEED_GOOGLE_CLIENT_ID',
	'TREESEED_GOOGLE_CLIENT_SECRET',
	'TREESEED_MICROSOFT_CLIENT_ID',
	'TREESEED_MICROSOFT_CLIENT_SECRET',
	'TREESEED_APPLE_CLIENT_ID',
	'TREESEED_APPLE_CLIENT_SECRET',
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

	return {
		...localAuthRuntimeVars(env),
		TREESEED_LOCAL_DEV_MODE: envValue(env, 'TREESEED_LOCAL_DEV_MODE') ?? 'cloudflare',
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
		TREESEED_FORMS_LOCAL_USE_MAILPIT: envValue(env, 'TREESEED_FORMS_LOCAL_USE_MAILPIT') ?? 'false',
		TREESEED_MAILPIT_SMTP_HOST: envValue(env, 'TREESEED_MAILPIT_SMTP_HOST') ?? '127.0.0.1',
		TREESEED_MAILPIT_SMTP_PORT: envValue(env, 'TREESEED_MAILPIT_SMTP_PORT') ?? '1025',
	};
}

export function buildSecretMap(deployConfig, state) {
	const generatedSecret = state.generatedSecrets?.TREESEED_FORM_TOKEN_SECRET ?? randomBytes(24).toString('hex');
	const previewSecret = state.generatedSecrets?.TREESEED_EDITORIAL_PREVIEW_SECRET ?? randomBytes(24).toString('hex');
	return {
		TREESEED_FORM_TOKEN_SECRET: envOrNull('TREESEED_FORM_TOKEN_SECRET') ?? generatedSecret,
		TREESEED_EDITORIAL_PREVIEW_SECRET: envOrNull('TREESEED_EDITORIAL_PREVIEW_SECRET') ?? previewSecret,
		TREESEED_TURNSTILE_SECRET_KEY: envOrNull('TREESEED_TURNSTILE_SECRET_KEY'),
		TREESEED_SMTP_PASSWORD: deployConfig.smtp?.enabled ? envOrNull('TREESEED_SMTP_PASSWORD') : null,
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
		queues: {
			agentWork: {
				name: environmentScopedIdentityName(identity, deployConfig.cloudflare.queueName ?? 'agent-work', target),
				dlqName: environmentScopedIdentityName(identity, deployConfig.cloudflare.dlqName ?? 'agent-work-dlq', target),
				binding: deployConfig.cloudflare.queueBinding ?? 'AGENT_WORK_QUEUE',
				queueId: null,
				dlqId: null,
			},
		},
		pages: {
			projectName: resolveConfiguredPagesProjectName(deployConfig),
			productionBranch: deployConfig.cloudflare.pages?.productionBranch ?? 'main',
			stagingBranch: deployConfig.cloudflare.pages?.stagingBranch ?? 'staging',
			buildOutputDir: deployConfig.cloudflare.pages?.buildOutputDir ?? 'dist',
			url: resolveConfiguredSurfaceBaseUrl(deployConfig, target, 'web'),
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
		queues: {
			...(defaults.queues ?? {}),
			...(persisted.queues ?? {}),
			agentWork: {
				...(defaults.queues?.agentWork ?? {}),
				...(persisted.queues?.agentWork ?? {}),
				name: defaults.queues?.agentWork?.name ?? persisted.queues?.agentWork?.name ?? 'agent-work',
				dlqName: defaults.queues?.agentWork?.dlqName ?? persisted.queues?.agentWork?.dlqName ?? 'agent-work-dlq',
				binding: defaults.queues?.agentWork?.binding ?? persisted.queues?.agentWork?.binding ?? 'AGENT_WORK_QUEUE',
				queueId: persisted.queues?.agentWork?.queueId ?? defaults.queues?.agentWork?.queueId ?? null,
				dlqId: persisted.queues?.agentWork?.dlqId ?? defaults.queues?.agentWork?.dlqId ?? null,
			},
		},
		generatedSecrets: {
			...(defaults.generatedSecrets ?? {}),
			...(persisted.generatedSecrets ?? {}),
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
	const migrationsDir = relativeFromGeneratedRoot(resolve(tenantRoot, 'migrations'), generatedRoot);
	const vars = {
		...buildPublicVars(deployConfig),
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
				'Required Cloudflare permissions: Account Cloudflare Pages edit, Account Workers Scripts edit, Account Workers KV Storage edit, Account D1 edit, Account Queues edit, Zone DNS edit.',
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
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
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
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
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
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
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
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
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
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return [];
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/pages/projects`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

function ensurePagesProjectCompatibility(accountId, projectName, env, currentProject = null) {
	if (!accountId || !projectName) {
		return;
	}

	const projectPath = `/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`;
	const latestProject = cloudflareApiRequest(projectPath, { env, allowFailure: true })?.result ?? currentProject;
	const currentConfigs = latestProject?.deployment_configs ?? {};
	const mergeCompatibility = (config = {}) => ({
		...config,
		compatibility_date: config.compatibility_date ?? DEFAULT_COMPATIBILITY_DATE,
		compatibility_flags: [...new Set([...(config.compatibility_flags ?? []), ...DEFAULT_COMPATIBILITY_FLAGS])],
	});

	cloudflareApiRequest(
		projectPath,
		{
			method: 'PATCH',
			env,
			body: {
				deployment_configs: {
					...currentConfigs,
					preview: mergeCompatibility(currentConfigs.preview),
					production: mergeCompatibility(currentConfigs.production),
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
		formGuardKv: state.kvNamespaces.FORM_GUARD_KV,
		sessionKv: state.kvNamespaces.SESSION ?? null,
		siteDataDb: state.d1Databases.SITE_DATA_DB,
		queue: state.queues?.agentWork ?? null,
		content: state.content ?? null,
		resources: {
			pagesProject: state.pages?.projectName ?? null,
			contentBucket: state.content?.bucketName ?? null,
			queue: state.queues?.agentWork?.name ?? null,
			dlq: state.queues?.agentWork?.dlqName ?? null,
			database: state.d1Databases?.SITE_DATA_DB?.databaseName ?? null,
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
	const requestScript = `import { readFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const response = await fetch(input.url, {
  method: input.method,
  headers: {
    authorization: 'Bearer ' + input.token,
    'content-type': 'application/json',
  },
  body: input.body ? JSON.stringify(input.body) : undefined,
});
const rawBody = await response.text();
let payload;
try {
  payload = rawBody ? JSON.parse(rawBody) : {};
} catch {
  payload = { success: false, errors: [{ message: rawBody || 'empty response' }] };
}
process.stdout.write(JSON.stringify({ ok: response.ok, payload }));`;
	const requestInput = JSON.stringify({
		url: `https://api.cloudflare.com/client/v4${path}`,
		method,
		body,
		token: env?.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? '',
	});
	const isTransient = (text) => /fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted/iu.test(text || '');
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
			if (attempt < 2) {
				attempt += 1;
				continue;
			}
			if (!allowFailure) {
				throw new Error(`Cloudflare API request timed out: ${method} ${path}`);
			}
			return null;
		}
		const stderr = response.stderr?.trim() || '';
		if (response.status !== 0) {
			if (attempt < 2 && isTransient(stderr)) {
				attempt += 1;
				continue;
			}
			if (!allowFailure) {
				throw new Error(stderr || `Cloudflare API request failed: ${method} ${path}`);
			}
		}

		const parsed = JSON.parse(response.stdout?.trim() || '{"ok":false,"payload":{"success":false,"errors":[{"message":"empty response"}]}}');
		if (!parsed.ok && !allowFailure) {
			const details = Array.isArray(parsed.payload?.errors)
				? parsed.payload.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).join('; ')
				: 'unknown error';
			throw new Error(details || `Cloudflare API request failed: ${method} ${path}`);
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

function buildTreeseedManagedCloudflareCacheRules(deployConfig, cacheTarget, kind) {
	if (!cacheTarget?.host) {
		return [];
	}
	const policy = resolveTreeseedWebCachePolicy(deployConfig);
	const cachePolicy = kind === 'web' ? policy.contentPages : policy.r2PublishedObjects;
	const hostExpression = `(http.host eq "${cacheTarget.host}")`;
	const pathExpression = cacheTarget.pathPrefix
		? `(starts_with(http.request.uri.path, "${cacheTarget.pathPrefix}/") or (http.request.uri.path eq "${cacheTarget.pathPrefix}"))`
		: 'true';

	if (kind === 'content') {
		return [
			{
				description: 'treeseed-managed: cache public r2 objects',
				expression: `((${hostExpression}) and (${pathExpression}) and (http.request.method in {"GET" "HEAD"}))`,
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
		: 'false';
	const notSourcePathExpression = sourcePaths.length > 0
		? `not ${sourcePathExpression}`
		: 'true';

	return [
		{
			description: 'treeseed-managed: bypass preview and dynamic routes',
			expression: `((${hostExpression}) and ((starts_with(http.request.uri.path, "/api/")) or (http.request.uri.path eq "/api") or (starts_with(http.request.uri.path, "/auth")) or (starts_with(http.request.uri.path, "/admin")) or (starts_with(http.request.uri.path, "/app")) or (starts_with(http.request.uri.path, "/internal")) or (http.request.uri.query contains "preview=") or (http.cookie contains "treeseed-content-preview=")))`,
			action: 'set_cache_settings',
			action_parameters: {
				cache: false,
			},
			enabled: true,
		},
		{
			description: 'treeseed-managed: cache source html routes',
			expression: `((${hostExpression}) and (${pathExpression}) and (${sourcePathExpression}) and (http.request.method in {"GET" "HEAD"}))`,
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
		},
		{
			description: 'treeseed-managed: cache content html routes',
			expression: `((${hostExpression}) and (${pathExpression}) and (${notSourcePathExpression}) and (http.request.method in {"GET" "HEAD"}) and (http.request.uri.path.extension eq "") and not (starts_with(http.request.uri.path, "/api/")) and not (http.request.uri.path eq "/api") and not (starts_with(http.request.uri.path, "/auth")) and not (starts_with(http.request.uri.path, "/admin")) and not (starts_with(http.request.uri.path, "/app")) and not (starts_with(http.request.uri.path, "/internal")) and not (http.request.uri.query contains "preview=") and not (http.cookie contains "treeseed-content-preview="))`,
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
		CLOUDFLARE_API_TOKEN: providedEnv?.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN ?? '',
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
		&& state?.queues?.agentWork?.name
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

export function purgeSourcePageCaches(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const urls = resolveSourcePagePurgeUrls(deployConfig);
	if ((options.dryRun ?? false) || urls.length === 0 || !process.env.CLOUDFLARE_API_TOKEN) {
		recordCachePurgeResult(state.webCache.deployPurge, urls.map((url) => ({ count: url ? 1 : 0 })));
		writeDeployState(tenantRoot, state, { target });
		return { skipped: options.dryRun ?? false, urls, results: [] };
	}

	try {
		const results = purgeCloudflareCacheByUrls(urls, deployConfig, {
			env: { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN },
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
	if ((options.dryRun ?? false) || !urls?.length || !process.env.CLOUDFLARE_API_TOKEN) {
		recordCachePurgeResult(state.webCache.contentPurge, (urls ?? []).map((url) => ({ count: url ? 1 : 0 })));
		writeDeployState(tenantRoot, state, { target });
		return { skipped: options.dryRun ?? false, urls: urls ?? [], results: [] };
	}

	try {
		const results = purgeCloudflareCacheByUrls(urls, deployConfig, {
			env: { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN },
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

function resolveConfiguredMarketBaseUrl(deployConfig) {
	return envOrNull('TREESEED_MARKET_API_BASE_URL')
		?? deployConfig.runtime?.marketBaseUrl
		?? deployConfig.hosting?.marketBaseUrl
		?? '';
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
	const issues = [];
	if (!envOrNull('TREESEED_PUBLIC_TURNSTILE_SITE_KEY')) {
		issues.push('Set TREESEED_PUBLIC_TURNSTILE_SITE_KEY before deploying.');
	}
	if (!envOrNull('TREESEED_TURNSTILE_SECRET_KEY')) {
		issues.push('Set TREESEED_TURNSTILE_SECRET_KEY before deploying.');
	}
	return issues;
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

	if (!envOrNull('TREESEED_PUBLIC_TURNSTILE_SITE_KEY')) {
		missing.push({
			key: 'TREESEED_PUBLIC_TURNSTILE_SITE_KEY',
			label: 'Turnstile public site key',
			message: 'Turnstile public site key is missing for deploy.',
		});
	}

	if (!envOrNull('TREESEED_TURNSTILE_SECRET_KEY')) {
		missing.push({
			key: 'TREESEED_TURNSTILE_SECRET_KEY',
			label: 'Turnstile secret key',
			message: 'Turnstile secret key is missing for deploy.',
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
	return /not found|does not exist|could not find|unknown/i.test(output);
}

function deleteKvNamespace(tenantRoot, namespaceId, { env, dryRun, preview = false }) {
	if (!namespaceId || isPlaceholderResourceId(namespaceId)) {
		return { status: 'missing', id: namespaceId };
	}

	if (dryRun) {
		return { status: 'planned', id: namespaceId, preview };
	}

	const args = ['kv', 'namespace', 'delete', '--namespace-id', namespaceId, '--skip-confirmation'];
	if (preview) {
		args.push('--preview');
	}
	const result = runWrangler(args, {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	if (result.status !== 0 && !looksLikeMissingResource(output)) {
		throw new Error(output.trim() || `Failed to delete KV namespace ${namespaceId}.`);
	}

	return { status: result.status === 0 ? 'deleted' : 'missing', id: namespaceId, preview };
}

function deleteD1Database(tenantRoot, databaseName, { env, dryRun }) {
	if (!databaseName) {
		return { status: 'missing', name: databaseName };
	}

	if (dryRun) {
		return { status: 'planned', name: databaseName };
	}

	const result = runWrangler(['d1', 'delete', databaseName, '--skip-confirmation'], {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	if (result.status !== 0 && !looksLikeMissingResource(output)) {
		throw new Error(output.trim() || `Failed to delete D1 database ${databaseName}.`);
	}

	return { status: result.status === 0 ? 'deleted' : 'missing', name: databaseName };
}

function deleteWorker(tenantRoot, workerName, { env, dryRun, force = false }) {
	if (!workerName) {
		return { status: 'missing', name: workerName };
	}

	if (dryRun) {
		return { status: 'planned', name: workerName };
	}

	const args = ['delete', workerName];
	if (force) {
		args.push('--force');
	}

	const result = runWrangler(args, {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
		input: 'y\n',
	});
	const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
	if (result.status !== 0 && !looksLikeMissingResource(output)) {
		throw new Error(output.trim() || `Failed to delete Worker ${workerName}.`);
	}

	return { status: result.status === 0 ? 'deleted' : 'missing', name: workerName };
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
	const force = options.force ?? false;
	const kvNamespaces = dryRun ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = dryRun ? [] : listD1Databases(tenantRoot, env);

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

	const worker = deleteWorker(tenantRoot, state.workerName, { env, dryRun, force });
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
	const database = deleteD1Database(tenantRoot, state.d1Databases.SITE_DATA_DB.databaseName, { env, dryRun });

	return {
		target,
		summary: buildDestroySummary(deployConfig, state, target),
		operations: {
			worker,
			formGuard,
			formGuardPreview,
			session,
			sessionPreview,
			database,
		},
	};
}

export function cleanupDestroyedState(tenantRoot, options = {}) {
	const target = options.scope || options.target ? normalizeTarget(options.scope ?? options.target) : null;
	if (target) {
		const { statePath, generatedRoot } = resolveTargetPaths(tenantRoot, target);
		rmSync(statePath, { force: true });
		rmSync(generatedRoot, { recursive: true, force: true });
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

	const ensureQueue = () => {
		const current = state.queues?.agentWork;
		if (!current?.name) {
			return;
		}
		let refreshedQueues = queues;
		const exists = refreshedQueues.find((entry) => queueName(entry) === current.name);
		if (exists) {
			current.queueId = queueId(exists);
			const currentDlq = current.dlqName ? refreshedQueues.find((entry) => queueName(entry) === current.dlqName) : null;
			current.dlqId = queueId(currentDlq);
			return;
		}
		if (dryRun) {
			current.queueId = `dryrun-${current.name}`;
			current.dlqId = current.dlqName ? `dryrun-${current.dlqName}` : null;
			return;
		}
		try {
			runWrangler(['queues', 'create', current.name], {
				cwd: tenantRoot,
				capture: true,
				env,
			});
		} catch (error) {
			if (!isWranglerAlreadyExistsError(error, [/Queue name .* is already taken/i, /\[code:\s*11009\]/i])) {
				throw error;
			}
		}
		refreshedQueues = listQueues(tenantRoot, env);
		if (current.dlqName && !refreshedQueues.find((entry) => queueName(entry) === current.dlqName)) {
			try {
				runWrangler(['queues', 'create', current.dlqName], {
					cwd: tenantRoot,
					capture: true,
					env,
				});
			} catch (error) {
				if (!isWranglerAlreadyExistsError(error, [/Queue name .* is already taken/i, /\[code:\s*11009\]/i])) {
					throw error;
				}
			}
		}
		refreshedQueues = listQueues(tenantRoot, env);
		const created = refreshedQueues.find((entry) => queueName(entry) === current.name);
		if (!created) {
			throw new Error(`Unable to resolve Cloudflare queue ${current.name} after reconciliation.`);
		}
		current.queueId = queueId(created);
		const createdDlq = current.dlqName ? refreshedQueues.find((entry) => queueName(entry) === current.dlqName) : null;
		if (current.dlqName && !createdDlq) {
			throw new Error(`Unable to resolve Cloudflare dead-letter queue ${current.dlqName} after reconciliation.`);
		}
		current.dlqId = queueId(createdDlq);
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
			ensurePagesProjectCompatibility(env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '', current.projectName, env, exists);
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
		ensurePagesProjectCompatibility(env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID ?? '', current.projectName, env);
		current.url = `https://${current.projectName}.pages.dev`;
	};

	ensureKv('FORM_GUARD_KV');
	ensureD1();
	ensureQueue();
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
	const secrets = buildSecretMap(deployConfig, state);
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

	const checks = {
		pages: Boolean(state.pages?.projectName && pagesProjects.find((entry) => entry?.name === state.pages.projectName)),
		formGuardKv: Boolean(state.kvNamespaces?.FORM_GUARD_KV?.name && kvNamespaces.find((entry) => entry?.title === state.kvNamespaces.FORM_GUARD_KV.name)),
		d1: Boolean(state.d1Databases?.SITE_DATA_DB?.databaseName && d1Databases.find((entry) => entry?.name === state.d1Databases.SITE_DATA_DB.databaseName)),
		queue: Boolean(state.queues?.agentWork?.name && queues.find((entry) => queueName(entry) === state.queues.agentWork.name)),
		dlq: !state.queues?.agentWork?.dlqName || Boolean(queues.find((entry) => queueName(entry) === state.queues.agentWork.dlqName)),
		r2: Boolean(state.content?.bucketName && buckets.find((entry) => entry?.name === state.content.bucketName)),
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

	const liveQueue = queues.find((entry) => queueName(entry) === state.queues?.agentWork?.name);
	if (state.queues?.agentWork) {
		state.queues.agentWork.queueId = queueId(liveQueue) ?? state.queues.agentWork.queueId ?? null;
		const liveDlq = queues.find((entry) => queueName(entry) === state.queues.agentWork.dlqName);
		state.queues.agentWork.dlqId = queueId(liveDlq) ?? state.queues.agentWork.dlqId ?? null;
	}
	const livePages = pagesProjects.find((entry) => entry?.name === state.pages?.projectName);
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
			purgeSourcePageCaches(tenantRoot, { target });
		} catch {
			// The purge helper persists its own error state.
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
	console.log('Treeseed destroy summary');
	console.log(`  Target: ${summary.target}`);
	console.log(`  Worker: ${summary.workerName} -> ${operations.worker.status}`);
	console.log(`  Site URL: ${summary.siteUrl}`);
	console.log(`  Account ID: ${summary.accountId}`);
	console.log(`  D1: ${summary.siteDataDb.databaseName} -> ${operations.database.status}`);
	console.log(`  KV FORM_GUARD_KV: ${summary.formGuardKv.name} -> ${operations.formGuard.status}`);
	if (operations.formGuardPreview) {
		console.log(`  KV FORM_GUARD_KV preview -> ${operations.formGuardPreview.status}`);
	}
	if (summary.sessionKv && operations.session) {
		console.log(`  KV SESSION (deprecated): ${summary.sessionKv.name} -> ${operations.session.status}`);
	}
	if (operations.sessionPreview) {
		console.log(`  KV SESSION preview -> ${operations.sessionPreview.status}`);
	}
}
