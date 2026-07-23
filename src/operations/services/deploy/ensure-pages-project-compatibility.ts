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
import { cloudflareApiRequest } from './cloudflare-api-request.ts';
import { buildCloudflarePagesFunctionBindings, mergeCloudflarePagesDeploymentConfig } from './run-wrangler.ts';
import { DEFAULT_COMPATIBILITY_DATE, DEFAULT_COMPATIBILITY_FLAGS, resolveConfiguredSurfaceDomain, resolveTreeseedResourceIdentity } from './default-compatibility-date.ts';
import { deployTargetLabel, targetWorkerName, targetWorkersDevUrl } from './configured-surface-hosts.ts';
import { resolveConfiguredCloudflareAccountId, resolveConfiguredContentPublicBaseUrl } from './assert-cloudflare-cache-purge-succeeded.ts';

export function ensurePagesProjectCompatibility(accountId, projectName, env, currentProject = null, options = {}) {
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

export function isPlaceholderResourceId(value) {
	if (!value || typeof value !== 'string') {
		return true;
	}

	return (
		value.startsWith('local-')
		|| value.startsWith('plan-')
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

export function safeUrl(value) {
	try {
		return new URL(value);
	} catch {
		return null;
	}
}

export function normalizePathPrefix(pathname) {
	const normalized = String(pathname ?? '').replace(/\/+$/u, '');
	if (!normalized || normalized === '/') {
		return '';
	}
	return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function resolvePublicWebCacheTarget(deployConfig) {
	const parsed = safeUrl(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl);
	if (!parsed) {
		return null;
	}
	return {
		host: parsed.hostname,
		pathPrefix: normalizePathPrefix(parsed.pathname),
	};
}

export function resolvePublicContentCacheTarget(deployConfig) {
	const parsed = safeUrl(resolveConfiguredContentPublicBaseUrl(deployConfig));
	if (!parsed) {
		return null;
	}
	return {
		host: parsed.hostname,
		pathPrefix: normalizePathPrefix(parsed.pathname),
	};
}

export function shouldManageCloudflareWebCacheRules(deployConfig, target) {
	if (target.kind !== 'persistent' || target.scope !== 'prod') {
		return false;
	}
	if ((deployConfig.surfaces?.web?.provider ?? deployConfig.providers?.deploy) !== 'cloudflare') {
		return false;
	}
	const webTarget = resolvePublicWebCacheTarget(deployConfig);
	return Boolean(webTarget?.host && !webTarget.host.endsWith('.workers.dev') && !webTarget.host.endsWith('.pages.dev'));
}
