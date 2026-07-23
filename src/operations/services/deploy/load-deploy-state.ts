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
import { buildPublicVars, normalizeTarget, relativeFromGeneratedRoot, resolveTargetPaths, targetKey, targetWorkerName, targetWorkersDevUrl } from './configured-surface-hosts.ts';
import { buildLocalRuntimeVars, buildSecretMap, defaultStateFromConfig } from './local-runtime-auth-env-keys.ts';
import { DEFAULT_COMPATIBILITY_DATE, DEFAULT_COMPATIBILITY_FLAGS, MANAGED_SERVICE_KEYS, ensureParent, loadTenantDeployConfig, readJson, renderTomlString, resolveConfiguredSurfaceBaseUrl, stableHash, writeJson } from './default-compatibility-date.ts';
import { resolveConfiguredContentBucketBinding, resolveConfiguredContentBucketName } from './assert-cloudflare-cache-purge-succeeded.ts';

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
