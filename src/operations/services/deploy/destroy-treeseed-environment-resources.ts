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
import { normalizeTarget, resolveTargetPaths, targetWorkerName } from './configured-surface-hosts.ts';
import { GENERATED_ROOT, STATE_ROOT, loadTenantDeployConfig, primaryHost } from './default-compatibility-date.ts';
import { loadDeployState } from './load-deploy-state.ts';
import { buildDestroySummary, resolveConfiguredCloudflareAccountId } from './assert-cloudflare-cache-purge-succeeded.ts';
import { listD1Databases, listKvNamespaces, listPagesProjects, listQueues, listR2Buckets, listTurnstileWidgets } from './run-wrangler.ts';
import { deleteKvNamespace, deleteTurnstileWidget, deleteWorker, resolveExistingD1ByName, resolveExistingKvIdByName, resolveExistingTurnstileWidget, resourceOperation } from './collect-missing-deploy-inputs.ts';
import { deleteD1DatabaseForDestroy, deleteR2Bucket } from './delete-cloudflare-api-resource.ts';
import { deleteDnsRecordsForName, deletePagesCustomDomains, deletePagesDeployments, deletePagesProject } from './pages-domain-name.ts';
import { deleteTreeseedCacheRules, destroyRailwayResources } from './delete-treeseed-cache-rules.ts';
import { destroyLocalRuntimeResources, sweepTreeSeedCloudflareResources } from './docker-list.ts';
import { cloudflareDestroyVerification, localDockerDestroyVerification, sweepTreeSeedRailwayResources } from './cloudflare-destroy-verification.ts';

export async function destroyTreeseedEnvironmentResources(tenantRoot, options = {}) {
	const target = normalizeTarget(options.scope ?? options.target ?? 'prod');
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const state = loadDeployState(tenantRoot, deployConfig, { target });
	state.workerName = targetWorkerName(deployConfig, target);

	const env = {
		CLOUDFLARE_ACCOUNT_ID: resolveConfiguredCloudflareAccountId(deployConfig),
	};

	const planOnly = options.planOnly ?? false;
	const deleteData = options.deleteData === true;
	const force = options.force ?? false;
	const sweepTreeseed = options.sweepTreeseed === true;
	const destroysSharedWebSurface = target.kind === 'persistent' && target.scope === 'prod' && deleteData;
	const kvNamespaces = planOnly ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = planOnly ? [] : listD1Databases(tenantRoot, env);
	const queues = planOnly ? [] : listQueues(tenantRoot, env);
	const buckets = planOnly ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = planOnly ? [] : listPagesProjects(tenantRoot, env);
	const turnstileWidgets = planOnly ? [] : listTurnstileWidgets(tenantRoot, env);

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

	const workerResult = deleteWorker(tenantRoot, state.workerName, { env, planOnly, force });
	const turnstileWidget = deleteTurnstileWidget(state.turnstileWidgets?.formGuard?.sitekey, {
		env,
		planOnly,
		name: state.turnstileWidgets?.formGuard?.name,
	});
	const formGuard = deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.id, { env, planOnly });
	const formGuardPreview =
		state.kvNamespaces.FORM_GUARD_KV.previewId
		&& state.kvNamespaces.FORM_GUARD_KV.previewId !== state.kvNamespaces.FORM_GUARD_KV.id
			? deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.previewId, { env, planOnly, preview: true })
			: null;
	const session = state.kvNamespaces.SESSION?.id
		? deleteKvNamespace(tenantRoot, state.kvNamespaces.SESSION.id, { env, planOnly })
		: null;
	const sessionPreview =
		state.kvNamespaces.SESSION?.previewId
		&& state.kvNamespaces.SESSION.previewId !== state.kvNamespaces.SESSION.id
			? deleteKvNamespace(tenantRoot, state.kvNamespaces.SESSION.previewId, { env, planOnly, preview: true })
			: null;
	const knownKvIds = new Set([
		state.kvNamespaces.FORM_GUARD_KV.id,
		state.kvNamespaces.FORM_GUARD_KV.previewId,
		state.kvNamespaces.SESSION?.id,
		state.kvNamespaces.SESSION?.previewId,
	].filter(Boolean));
	const legacyKvPrefix = state.identity?.deploymentKey ?? state.pages?.projectName ?? '';
	const legacyKvNamespaces = planOnly ? [] : kvNamespaces
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
			const result = deleteKvNamespace(tenantRoot, namespace.id, { env, planOnly: false });
			return resourceOperation('cloudflare', 'kv-namespace', namespace.title, result.status, { ...result, legacy: true });
		});
	const database = deleteD1DatabaseForDestroy(tenantRoot, state.d1Databases.SITE_DATA_DB.databaseName, { env, planOnly, deleteData });
	const r2Bucket = bucket || planOnly ? deleteR2Bucket(tenantRoot, state.content?.bucketName, { env, planOnly, deleteData }) : resourceOperation('cloudflare', 'r2-bucket', state.content?.bucketName, 'missing');
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
		.flatMap((name) => deleteDnsRecordsForName(deployConfig, name, { env, planOnly }));
	const cacheRules = deleteTreeseedCacheRules(deployConfig, state, { env, planOnly });
	const pageCustomDomains = pagesProject || planOnly
		? deletePagesCustomDomains(tenantRoot, state.pages?.projectName, pageDnsNames, { env, planOnly, knownOnly: !destroysSharedWebSurface })
		: [resourceOperation('cloudflare', 'pages-custom-domain', state.pages?.projectName, 'missing')];
	const pageDeployments = pagesProject || planOnly
		? deletePagesDeployments(tenantRoot, state.pages?.projectName, {
			env,
			planOnly,
			environment: destroysSharedWebSurface ? 'all' : 'preview',
		})
		: resourceOperation('cloudflare', 'pages-deployments', state.pages?.projectName, 'missing');
	const pages = destroysSharedWebSurface && (pagesProject || planOnly)
		? deletePagesProject(state.pages?.projectName, { env, planOnly })
		: resourceOperation('cloudflare', 'pages-project', state.pages?.projectName, 'skipped', {
			reason: target.scope === 'prod' ? 'delete_data_required' : 'shared_web_surface',
		});
	const local = target.kind === 'persistent' && target.scope === 'local'
		? destroyLocalRuntimeResources(tenantRoot, { planOnly, deleteData })
		: { operations: [] };
	const railway = await destroyRailwayResources(tenantRoot, deployConfig, target, { planOnly, deleteData, env: process.env });
	const sweep = sweepTreeseed
		? {
			cloudflare: sweepTreeSeedCloudflareResources(tenantRoot, deployConfig, state, { env, planOnly, deleteData }),
			railway: await sweepTreeSeedRailwayResources(deployConfig, state, { env: process.env, planOnly }),
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
	const verification = planOnly
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
	const planOnly = options.planOnly ?? false;
	const deleteData = options.deleteData === true;
	const force = options.force ?? false;
	const kvNamespaces = planOnly ? [] : listKvNamespaces(tenantRoot, env);
	const d1Databases = planOnly ? [] : listD1Databases(tenantRoot, env);
	const queues = listQueues(tenantRoot, env);
	const buckets = planOnly ? [] : listR2Buckets(tenantRoot, env);
	const pagesProjects = planOnly ? [] : listPagesProjects(tenantRoot, env);
	const turnstileWidgets = planOnly ? [] : listTurnstileWidgets(tenantRoot, env);

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
	const worker = deleteWorker(tenantRoot, state.workerName, { env, planOnly, force });
	const turnstileWidget = deleteTurnstileWidget(state.turnstileWidgets?.formGuard?.sitekey, {
		env,
		planOnly,
		name: state.turnstileWidgets?.formGuard?.name,
	});
	const formGuard = deleteKvNamespace(tenantRoot, state.kvNamespaces.FORM_GUARD_KV.id, { env, planOnly });
	const database = deleteD1DatabaseForDestroy(tenantRoot, state.d1Databases.SITE_DATA_DB.databaseName, { env, planOnly, deleteData });
	const r2Bucket = bucket || planOnly
		? deleteR2Bucket(tenantRoot, state.content?.bucketName, { env, planOnly, deleteData })
		: resourceOperation('cloudflare', 'r2-bucket', state.content?.bucketName, 'missing');
	const pages = pagesProject || planOnly
		? deletePagesProject(state.pages?.projectName, { env, planOnly })
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
