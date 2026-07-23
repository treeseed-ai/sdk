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
import { normalizeTarget, targetWorkerName } from './configured-surface-hosts.ts';
import { loadTenantDeployConfig } from './default-compatibility-date.ts';
import { loadDeployState, resolveGeneratedWranglerPath, writeDeployState } from './load-deploy-state.ts';
import { hasProvisionedCloudflareResources, resolveConfiguredCloudflareAccountId } from './assert-cloudflare-cache-purge-succeeded.ts';
import { isWranglerAlreadyExistsError, listD1Databases, listKvNamespaces, listPagesProjects, listQueues, listR2Buckets, runWrangler } from './run-wrangler.ts';
import { buildProvisioningSummary, ensurePagesProjectCompatibility, isPlaceholderResourceId } from './ensure-pages-project-compatibility.ts';
import { reconcileCloudflareWebCacheRules } from './build-treeseed-managed-cloudflare-cache-rules.ts';
import { buildSecretMap } from './local-runtime-auth-env-keys.ts';

export function provisionCloudflareResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.workerName = targetWorkerName(deployConfig, target);

	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};
	const planOnly = options.planOnly ?? false;
	const kvNamespaces = planOnly ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = planOnly ? [] : listD1Databases(tenantRoot, env);
	const queues = planOnly ? [] : listQueues(tenantRoot, env);
	const buckets = planOnly ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = planOnly ? [] : listPagesProjects(tenantRoot, env);

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

		if (planOnly) {
			state.kvNamespaces[binding].id = `plan-${current.name}`;
			state.kvNamespaces[binding].previewId = `plan-${current.name}-preview`;
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

		if (planOnly) {
			current.databaseId = `plan-${current.databaseName}`;
			current.previewDatabaseId = `plan-${current.databaseName}-preview`;
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
		if (planOnly) {
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
		if (planOnly) {
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
	reconcileCloudflareWebCacheRules(tenantRoot, deployConfig, state, target, { planOnly });

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
	const planOnly = options.planOnly ?? false;

	for (const [key, value] of Object.entries(secrets)) {
		if (!value) {
			continue;
		}

		synced.push(key);
		if (planOnly) {
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
