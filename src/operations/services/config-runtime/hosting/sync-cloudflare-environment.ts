import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteConfig, RemoteHost } from '../../../../entrypoints/clients/remote.ts';
import {
	getEnvironmentSuggestedValues,
	isEnvironmentEntryRelevant,
	isEnvironmentEntryRequired,
	resolveEnvironmentRegistry,
	ENVIRONMENT_SCOPES,
	type EnvironmentPurpose,
	type EnvironmentValidation,
	validateEnvironmentValues,
} from '../../../../platform/configuration/environment.ts';
import { loadManifest } from '../../../../platform/configuration/tenant-config.ts';
import {
	buildProvisioningSummary,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	provisionCloudflareResources,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
} from '../../hosting/deployment/deploy.ts';
import {
	collectReconcileStatus,
	reconcileTarget,
	resolveBootstrapSelection,
	type BootstrapSystem,
	type DesiredUnit,
	type RunnableBootstrapSystem,
} from '../../../../reconcile/index.ts';
import {
	ensureGitHubBootstrapRepository,
	maybeResolveGitHubRepositorySlug,
} from '../../repositories/github-automation.ts';
import {
	buildRailwayCommandEnv,
	configuredRailwayServices,
	validateRailwayDeployPrerequisites,
} from '../../hosting/railway/railway-deploy.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../../hosting/railway/railway-api.ts';
import { discoverApplications } from '../../../../hosting/apps.ts';
import {
	createGitHubApiClient,
	ensureGitHubBranchFromBase,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
} from '../../repositories/github-api.ts';
import { resolveGitHubCredentialForRepository } from '../../configuration/github-credentials.ts';
import { loadCliDeployConfig, packageDistScriptRoot, packageScriptPath, resolveWranglerBin, withProcessCwd } from '../../agents/runtime-tools.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../../operations/git-workflow.ts';
import {
	createManagedToolEnv,
	resolveToolBinary,
	resolveToolCommand,
} from '../../../../entrypoints/runtime/managed-dependencies.ts';
import { GITHUB_TOKEN_ENV, resolveGitHubToken, withServiceCredentialEnv } from '../../../../configuration/service-credentials.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../../hosting/audit/managed-host-security.ts';
import {
	assertKeyAgentResponse,
	getKeyAgentPaths,
	inspectKeyAgentDiagnostics,
	readWrappedMachineKeyFile,
	replaceWrappedMachineKey,
	rotateWrappedMachineKeyPassphrase,
	KEY_AGENT_IDLE_TIMEOUT_MS,
	MACHINE_KEY_PASSPHRASE_ENV,
	KeyAgentError,
	unwrapMachineKey,
	type KeyAgentStatus,
} from '../../configuration/key-agent.ts';
import { ConfigScope } from '../accounts/ensure-secret-session-for-config.ts';
import { collectEnvironmentContext, configuredMarketDatabaseService, nonEmptyEnvironmentValues, resolveMachineEnvironmentValues } from '../support/resolve-entry-value-from-buckets.ts';
import { syncManagedServiceSettingsFromDeployConfig } from '../configuration/machine-config-relative-path.ts';

export function syncCloudflareEnvironment({
	tenantRoot,
	scope = 'prod',
	planOnly = false,
	valuesOverlay = {},
	entryIds,
	onProgress,
}: {
	tenantRoot: string;
	scope?: ConfigScope;
	planOnly?: boolean;
	valuesOverlay?: Record<string, string | undefined>;
	entryIds?: string[];
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const values = {
		...resolveMachineEnvironmentValues(tenantRoot, scope),
		...nonEmptyEnvironmentValues(valuesOverlay),
	};
	const target = createPersistentDeployTarget(scope);
	const progress = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => onProgress?.(message, stream);
	for (const [key, value] of Object.entries(values)) {
		if (typeof value === 'string' && value.length > 0) {
			process.env[key] = value;
		}
	}

	progress(`[${scope}][cloudflare][config] Generating Wrangler config...`);
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	const registry = collectEnvironmentContext(tenantRoot);
	const entryFilter = Array.isArray(entryIds) && entryIds.length > 0 ? new Set(entryIds) : null;
	const cloudflareSecrets = Object.fromEntries(registry.entries
		.filter((entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes('cloudflare-secret')
			&& (!entryFilter || entryFilter.has(entry.id)))
		.map((entry) => [entry.id, values[entry.id]])
		.filter(([, value]) => typeof value === 'string' && value.length > 0));
	progress(`[${scope}][cloudflare][sync] Syncing Cloudflare secrets...`);
	const syncedSecrets = syncCloudflareSecrets(tenantRoot, {
		planOnly,
		target,
		extraSecrets: cloudflareSecrets,
		entryIds,
	});
	const cloudflareVars = registry.entries
		.filter((entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes('cloudflare-var')
			&& (!entryFilter || entryFilter.has(entry.id)))
		.map((entry) => entry.id)
		.filter((key) => typeof values[key] === 'string' && values[key].length > 0);
	progress(`[${scope}][cloudflare][sync] Complete: ${syncedSecrets.length} secrets, ${cloudflareVars.length} vars.`);

	return {
		scope,
		target,
		wranglerPath,
		entryIds: entryFilter ? [...entryFilter] : undefined,
		secrets: syncedSecrets,
		varsManagedByWranglerConfig: cloudflareVars,
	};
}

export function environmentEntryTargetsService(entry, serviceKey) {
	const targets = Array.isArray(entry.serviceTargets)
		? entry.serviceTargets.map((value) => String(value).trim()).filter(Boolean)
		: [];
	return targets.length === 0 || targets.includes(serviceKey);
}

export function railwayEnvironmentEntryIdsForService(registry, values, scope, target, serviceKey, entryFilter = null) {
	return registry.entries
		.filter((entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes(target)
			&& (!entryFilter || entryFilter.has(entry.id))
			&& environmentEntryTargetsService(entry, serviceKey))
		.map((entry) => entry.id)
		.filter((key) => typeof values[key] === 'string' && values[key].length > 0);
}

export async function syncRailwayEnvironment({
	tenantRoot,
	scope = 'prod',
	planOnly = false,
	valuesOverlay = {},
	entryIds,
	onProgress,
}: {
	tenantRoot: string;
	scope?: ConfigScope;
	planOnly?: boolean;
	valuesOverlay?: Record<string, string | undefined>;
	entryIds?: string[];
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const config = syncManagedServiceSettingsFromDeployConfig(tenantRoot);
	const values = {
		...resolveMachineEnvironmentValues(tenantRoot, scope),
		...nonEmptyEnvironmentValues(valuesOverlay),
	};
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const Database = configuredMarketDatabaseService(tenantRoot, deployConfig);
	const DatabaseService = Database?.service;
	const DatabaseServiceName = Database?.serviceName ?? '';
	const DatabaseUrl = typeof values.TREESEED_DATABASE_URL === 'string' && values.TREESEED_DATABASE_URL.length > 0
		? values.TREESEED_DATABASE_URL
		: DatabaseService?.enabled !== false && DatabaseService?.provider === 'railway'
			? `\${{${DatabaseServiceName}.DATABASE_URL}}`
			: '';
	const registry = collectEnvironmentContext(tenantRoot);
	const entryFilter = Array.isArray(entryIds) && entryIds.length > 0 ? new Set(entryIds) : null;
	const progress = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => onProgress?.(message, stream);
	const serviceValuesByName = new Map();
	const services = configuredRailwayServices(tenantRoot, scope)
		.map((service) => {
			const fallbackServiceName = service.key === 'api'
				? config.settings.services.railway.apiServiceName
				: service.serviceName;
			const environmentName = normalizeRailwayEnvironmentName(service.railwayEnvironment ?? scope);
			const serviceValues = {
				...values,
				...(service.key === 'operationsRunner' ? {
					TREESEED_PLATFORM_RUNNER_ID: service.runnerId ?? service.serviceName,
					TREESEED_PLATFORM_RUNNER_DATA_DIR: service.volumeMountPath ?? values.TREESEED_PLATFORM_RUNNER_DATA_DIR,
					TREESEED_PLATFORM_RUNNER_ENVIRONMENT: scope === 'prod' ? 'production' : scope,
				} : {}),
				...(DatabaseUrl && ['api', 'operationsRunner'].includes(service.key)
					? { TREESEED_DATABASE_URL: DatabaseUrl }
					: {}),
			};
			const serviceName = service.serviceName ?? fallbackServiceName;
			serviceValuesByName.set(serviceName || service.serviceId || service.instanceKey || service.key, serviceValues);
			return {
				service: service.key,
				instanceKey: service.instanceKey ?? service.key,
				projectName: service.projectName ?? config.settings.services.railway.projectName,
				serviceName,
				serviceId: service.serviceId ?? '',
				rootDir: service.rootDir,
				baseUrl: service.publicBaseUrl ?? '(unset)',
				environmentName,
				secrets: railwayEnvironmentEntryIdsForService(registry, serviceValues, scope, 'railway-secret', service.key, entryFilter),
				variables: railwayEnvironmentEntryIdsForService(registry, serviceValues, scope, 'railway-var', service.key, entryFilter),
				planOnly,
			};
		})
		.filter(Boolean);

	for (const service of services) {
		const serviceValues = serviceValuesByName.get(service.serviceName || service.serviceId || service.instanceKey || service.service) ?? values;
		progress(`[${scope}][railway][${service.service}] Syncing ${service.secrets.length} secrets and ${service.variables.length} variables...`);
		if (!planOnly) {
			const railwayEnv = { ...process.env, ...values };
			const project = (await ensureRailwayProject({
				projectId: '',
				projectName: service.projectName,
				env: railwayEnv,
			})).project;
			const environment = (await ensureRailwayEnvironment({
				projectId: project.id,
				environmentName: service.environmentName,
				env: railwayEnv,
			})).environment;
			const railwayService = (await ensureRailwayService({
				projectId: project.id,
				serviceId: service.serviceId,
				serviceName: service.serviceName,
				env: railwayEnv,
			})).service;
			const variableValues = Object.fromEntries(
				[...service.secrets, ...service.variables]
					.map((key) => [key, serviceValues[key]])
					.filter(([, value]) => typeof value === 'string' && value.length > 0),
			);
			if (Object.keys(variableValues).length > 0) {
				await upsertRailwayVariables({
					projectId: project.id,
					environmentId: environment.id,
					serviceId: railwayService.id,
					variables: variableValues,
					env: railwayEnv,
				});
			}
		}
		progress(`[${scope}][railway][${service.service}] Complete.`);
	}

	return {
		scope,
		entryIds: entryFilter ? [...entryFilter] : undefined,
		services,
	};
}

export async function initializePersistentEnvironment({ tenantRoot, scope = 'prod', planOnly = false } = {}) {
	const normalizedScope = scope === 'prod' ? 'prod' : scope;
	const target = createPersistentDeployTarget(normalizedScope);
	const summary = await reconcileTarget({
		tenantRoot,
		target,
		env: process.env,
	});

	return {
		scope: normalizedScope,
		target,
		summary,
		secrets: summary.results
			.filter((result) => result.unit.provider === 'cloudflare')
			.flatMap((result) => Object.keys(result.resourceLocators ?? {})),
	};
}
