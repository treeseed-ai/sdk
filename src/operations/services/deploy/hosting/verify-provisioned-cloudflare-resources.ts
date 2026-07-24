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
import { deployTargetLabel, normalizeTarget, scopeFromTarget, targetKey, targetWorkersDevUrl } from './configured-surface-hosts.ts';
import { MANAGED_SERVICE_KEYS, TRESEED_ENVELOPE_SCHEMA_GENERATION, TRESEED_MIGRATION_WAVE_ID, TRESEED_SUPPORTED_PAYLOAD_RANGE, envOrNull, loadTenantDeployConfig, resolveConfiguredSurfaceBaseUrl, sleepSync, stableHash } from '../support/default-compatibility-date.ts';
import { ensureGeneratedWranglerConfig, loadDeployState, writeDeployState } from './load-deploy-state.ts';
import { hasProvisionedCloudflareResources, purgeSourcePageCaches, resolveConfiguredCloudflareAccountId } from './assert-cloudflare-cache-purge-succeeded.ts';
import { buildCloudflarePagesFunctionBindings, listD1Databases, listKvNamespaces, listPagesProjects, listQueues, listR2Buckets, runWrangler } from '../support/run-wrangler.ts';
import { cloudflareApiRequest } from './cloudflare-api-request.ts';
import { shouldManageCloudflareWebCacheRules } from '../projects/projects-core/ensure-pages-project-compatibility.ts';
import { reconcileCloudflareWebCacheRules } from './build-managed-cloudflare-cache-rules.ts';

export function verifyProvisionedCloudflareResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};
	const planOnly = options.planOnly ?? false;
	const kvNamespaces = planOnly ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = planOnly ? [] : listD1Databases(tenantRoot, env);
	const queues = planOnly ? [] : listQueues(tenantRoot, env);
	const buckets = planOnly ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = planOnly ? [] : listPagesProjects(tenantRoot, env);
	const livePages = pagesProjects.find((entry) => entry?.name === state.pages?.projectName);
	const pagesProject = planOnly || !env.CLOUDFLARE_ACCOUNT_ID || !state.pages?.projectName
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

	const ok = planOnly ? true : Object.values(checks).every(Boolean);
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
	if (!planOnly) {
		try {
			reconcileCloudflareWebCacheRules(tenantRoot, deployConfig, state, target, { planOnly: false });
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
	if (options.planOnly) {
		return { databaseName: state.d1Databases.SITE_DATA_DB.databaseName, planOnly: true };
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
			return { databaseName: state.d1Databases.SITE_DATA_DB.databaseName, planOnly: false };
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
