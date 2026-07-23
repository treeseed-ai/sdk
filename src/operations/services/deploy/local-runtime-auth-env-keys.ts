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
import { configuredSurfaceHosts, envValue, environmentScopedIdentityName, scopeFromTarget, sharedDeploymentName, targetWorkerName, targetWorkersDevUrl } from './configured-surface-hosts.ts';
import { MANAGED_SERVICE_KEYS, TRESEED_ENVELOPE_SCHEMA_GENERATION, TRESEED_MIGRATION_WAVE_ID, TRESEED_SUPPORTED_PAYLOAD_RANGE, envOrNull, resolveConfiguredSurfaceBaseUrl, resolveTreeseedResourceIdentity, sanitizeSegment } from './default-compatibility-date.ts';
import { resolveConfiguredContentBucketBinding, resolveConfiguredContentBucketName, resolveConfiguredContentPublicBaseUrl, resolveConfiguredMarketBaseUrl, resolveConfiguredPagesProjectName } from './assert-cloudflare-cache-purge-succeeded.ts';

export const LOCAL_RUNTIME_AUTH_ENV_KEYS = [
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

export function localAuthRuntimeVars(env) {
	return Object.fromEntries(
		LOCAL_RUNTIME_AUTH_ENV_KEYS
			.map((key) => [key, envValue(env, key)])
			.filter(([, value]) => value != null),
	);
}

export function buildLocalRuntimeVars(deployConfig, state, target, env) {
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

export function defaultStateFromConfig(deployConfig, target) {
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
				id: `plan-${suffix}-form-guard`,
				previewId: `plan-${suffix}-form-guard-preview`,
			},
		},
		d1Databases: {
			SITE_DATA_DB: {
				databaseName: environmentScopedIdentityName(identity, 'site-data', target),
				binding: 'SITE_DATA_DB',
				databaseId: `plan-${suffix}-site-data`,
				previewDatabaseId: `plan-${suffix}-site-data-preview`,
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
						serviceName: serviceConfig?.environments?.[scope]?.serviceName ?? serviceConfig?.railway?.serviceName ?? sharedDeploymentName(identity, serviceKey),
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
