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
import { loadMachineConfig, writeMachineConfig } from './rotate-machine-key-passphrase.ts';
import { encryptValue, loadMachineKey } from '../configuration/create-default-machine-config.ts';
import { decryptMachineEnvironmentBucket } from '../commerce/catalog/resolve-template-catalog-endpoint.ts';
import { loadOptionalTenantManifest, loadTenantDeployConfig } from '../hosting/load-tenant-deploy-config.ts';
import { PROVIDER_CONTROL_ENV_KEYS, filterEnvironmentValuesByRegistry, warnDeprecatedLocalEnvFiles } from '../configuration/machine-config-relative-path.ts';

export function resolveEntryValueFromBuckets(entry, entryId, scope, bucketValuesByScope) {
	if (!entry) {
		return bucketValuesByScope[scope]?.[entryId] ?? bucketValuesByScope.shared?.[entryId] ?? '';
	}
	if (entry?.storage === 'shared') {
		const sharedValue = bucketValuesByScope.shared?.[entryId];
		if (typeof sharedValue === 'string' && sharedValue.length > 0) {
			return sharedValue;
		}

		const searchScopes = [scope, ...ENVIRONMENT_SCOPES.filter((candidate) => candidate !== scope)];
		for (const candidateScope of searchScopes) {
			const candidateValue = bucketValuesByScope[candidateScope]?.[entryId];
			if (typeof candidateValue === 'string' && candidateValue.length > 0) {
				return candidateValue;
			}
		}
		return '';
	}

	return bucketValuesByScope[scope]?.[entryId] ?? '';
}

export const LEGACY_ENV_KEY_ALIASES = {
	TREESEED_RAILWAY_API_TOKEN: ['RAILWAY_API_TOKEN'],
	TREESEED_CLOUDFLARE_API_TOKEN: ['CLOUDFLARE_API_TOKEN'],
	TREESEED_DOCKERHUB_TOKEN: ['DOCKERHUB_TOKEN'],
	TREESEED_DOCKERHUB_USERNAME: ['DOCKERHUB_USERNAME'],
	TREESEED_GITHUB_TOKEN: ['GH_TOKEN', 'GITHUB_TOKEN', 'TREESEED_HOSTED_HUBS_GITHUB_TOKEN'],
} as const;

export function resolveLegacyEntryValueFromBuckets(entryId, scope, bucketValuesByScope) {
	const aliases = LEGACY_ENV_KEY_ALIASES[entryId] ?? [];
	for (const alias of aliases) {
		const resolved = resolveEntryValueFromBuckets(null, alias, scope, bucketValuesByScope);
		if (typeof resolved === 'string' && resolved.length > 0) {
			return resolved;
		}
	}
	return '';
}

export function resolveMachineEnvironmentValues(tenantRoot, scope, additionalKeys = []) {
	const config = loadMachineConfig(tenantRoot);
	const registry = collectEnvironmentContext(tenantRoot);
	let key = null;
	try {
		key = loadMachineKey(tenantRoot);
	} catch {
		key = null;
	}
	const bucketValuesByScope = {
		shared: decryptMachineEnvironmentBucket(tenantRoot, config, key, config.shared),
		...Object.fromEntries(
			ENVIRONMENT_SCOPES.map((candidateScope) => [
				candidateScope,
				decryptMachineEnvironmentBucket(tenantRoot, config, key, config.environments?.[candidateScope]),
			]),
		),
	};
	const entryById = new Map(registry.entries.map((entry) => [entry.id, entry]));
	const values = {};
	const knownKeys = new Set([
		...registry.entries.map((entry) => entry.id),
		...additionalKeys,
	]);

	for (const entryId of knownKeys) {
		const resolved = resolveEntryValueFromBuckets(entryById.get(entryId), entryId, scope, bucketValuesByScope)
			|| resolveLegacyEntryValueFromBuckets(entryId, scope, bucketValuesByScope);
		if (typeof resolved === 'string' && resolved.length > 0) {
			values[entryId] = resolved;
		}
	}

	return values;
}

export function setMachineEnvironmentValue(tenantRoot, scope, entry, value) {
	const key = loadMachineKey(tenantRoot);
	const config = loadMachineConfig(tenantRoot);
	const target = entry.storage === 'shared' ? config.shared : config.environments[scope];

	if (entry.storage === 'shared') {
		for (const candidateScope of ENVIRONMENT_SCOPES) {
			delete config.environments[candidateScope].values[entry.id];
			delete config.environments[candidateScope].secrets[entry.id];
		}
	}

	if (entry.sensitivity === 'secret') {
		delete target.values[entry.id];
		if (value) {
			target.secrets[entry.id] = encryptValue(value, key);
		} else {
			delete target.secrets[entry.id];
		}
	} else {
		delete target.secrets[entry.id];
		if (value) {
			target.values[entry.id] = value;
		} else {
			delete target.values[entry.id];
		}
	}

	writeMachineConfig(tenantRoot, config);
	return config;
}

export function collectEnvironmentContext(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const tenantConfig = loadOptionalTenantManifest(tenantRoot);
	return resolveEnvironmentRegistry({
		deployConfig,
		tenantConfig,
	});
}

export function collectConfigSeedValues(tenantRoot, scope, env = process.env, valuesOverlay = {}) {
	warnDeprecatedLocalEnvFiles(tenantRoot);
	const registry = collectEnvironmentContext(tenantRoot);
	let machineValues = {};
	let localMachineValues = {};
	try {
		machineValues = resolveMachineEnvironmentValues(tenantRoot, scope);
		if (scope !== 'local') {
			localMachineValues = resolveMachineEnvironmentValues(tenantRoot, 'local');
		}
	} catch (error) {
		if (!(error instanceof KeyAgentError)) {
			throw error;
		}
	}
	const providerCredentialFallbacks = Object.fromEntries(
		PROVIDER_CONTROL_ENV_KEYS
			.map((key) => [key, localMachineValues[key]])
			.filter(([, value]) => typeof value === 'string' && value.length > 0),
	);
	const values = {
		...providerCredentialFallbacks,
		...machineValues,
		...nonEmptyEnvironmentValues(env),
		...nonEmptyEnvironmentValues(valuesOverlay),
	};
	const providerControlValues = Object.fromEntries(
		PROVIDER_CONTROL_ENV_KEYS
			.map((key) => [key, values[key]])
			.filter(([, value]) => typeof value === 'string' && value.length > 0),
	);
	return {
		...providerControlValues,
		...filterEnvironmentValuesByRegistry(values, registry, scope),
	};
}

export function workspaceBootstrapDeployConfig(tenantRoot, deployConfig) {
	const appConfigs = discoverApplications(tenantRoot)
		.map((application) => application.config)
		.filter((config) => config && config !== deployConfig);
	if (appConfigs.length === 0) {
		return deployConfig;
	}
	const merged = {
		...deployConfig,
		runtime: { ...(deployConfig.runtime ?? {}) },
		surfaces: { ...(deployConfig.surfaces ?? {}) },
		services: { ...(deployConfig.services ?? {}) },
	};
	for (const config of appConfigs) {
		if (config.runtime?.mode && merged.runtime?.mode !== 'treeseed_managed') {
			merged.runtime = { ...merged.runtime, ...config.runtime };
		}
		merged.surfaces = { ...merged.surfaces, ...(config.surfaces ?? {}) };
		merged.services = { ...merged.services, ...(config.services ?? {}) };
	}
	return merged;
}

export function configuredMarketDatabaseService(tenantRoot, deployConfig) {
	if (deployConfig.services?.treeseedDatabase) {
		return DatabaseDescriptor(deployConfig.services.treeseedDatabase, deployConfig.slug);
	}
	for (const application of discoverApplications(tenantRoot)) {
		const service = application.config.services?.treeseedDatabase;
		if (service) {
			return DatabaseDescriptor(service, application.config.slug);
		}
	}
	return null;
}

export function DatabaseDescriptor(service, slug) {
	return {
		service,
		serviceName: typeof service.railway?.serviceName === 'string' && service.railway.serviceName.trim()
			? service.railway.serviceName.trim()
			: `${slug ?? 'treeseed-api'}-postgres`,
	};
}

export function nonEmptyEnvironmentValues(env = process.env) {
	return Object.fromEntries(
		Object.entries(env)
			.filter(([, value]) => typeof value === 'string' && value.length > 0),
	);
}

export function collectConfigSeedValueSources(tenantRoot, scope, env = process.env) {
	warnDeprecatedLocalEnvFiles(tenantRoot);
	const registry = collectEnvironmentContext(tenantRoot);
	const registeredKeys = new Set(registry.entries
		.filter((entry) => isEnvironmentEntryRelevant(entry, registry.context, scope, 'config'))
		.map((entry) => entry.id));
	const values = {};
	const sources = {};
	const merge = (source, entries) => {
		for (const [key, value] of Object.entries(entries)) {
			if (!registeredKeys.has(key)) {
				continue;
			}
			if (typeof value !== 'string' || value.length === 0) {
				continue;
			}
			values[key] = value;
			sources[key] = source;
		}
	};
	try {
		merge('machine-config', resolveMachineEnvironmentValues(tenantRoot, scope));
	} catch (error) {
		if (!(error instanceof KeyAgentError)) {
			throw error;
		}
	}
	const processValues = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value ?? undefined]));
	merge('process.env', processValues);

	return { values, sources };
}
