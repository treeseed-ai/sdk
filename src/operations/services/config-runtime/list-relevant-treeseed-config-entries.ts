import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteTreeseedConfig, RemoteTreeseedHost } from '../../../remote.ts';
import {
	getTreeseedEnvironmentSuggestedValues,
	isTreeseedEnvironmentEntryRelevant,
	isTreeseedEnvironmentEntryRequired,
	resolveTreeseedEnvironmentRegistry,
	TREESEED_ENVIRONMENT_SCOPES,
	type TreeseedEnvironmentPurpose,
	type TreeseedEnvironmentValidation,
	validateTreeseedEnvironmentValues,
} from '../../../platform/environment.ts';
import { loadTreeseedManifest } from '../../../platform/tenant-config.ts';
import {
	buildProvisioningSummary,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	provisionCloudflareResources,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
} from '../deploy.ts';
import {
	collectTreeseedReconcileStatus,
	reconcileTreeseedTarget,
	resolveTreeseedBootstrapSelection,
	type TreeseedBootstrapSystem,
	type TreeseedDesiredUnit,
	type TreeseedRunnableBootstrapSystem,
} from '../../../reconcile/index.ts';
import {
	ensureGitHubBootstrapRepository,
	maybeResolveGitHubRepositorySlug,
} from '../github-automation.ts';
import {
	buildRailwayCommandEnv,
	configuredRailwayServices,
	validateRailwayDeployPrerequisites,
} from '../railway-deploy.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../railway-api.ts';
import { discoverTreeseedApplications } from '../../../hosting/apps.ts';
import {
	createGitHubApiClient,
	ensureGitHubBranchFromBase,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
} from '../github-api.ts';
import { resolveGitHubCredentialForRepository } from '../github-credentials.ts';
import { loadCliDeployConfig, packageDistScriptRoot, packageScriptPath, resolveWranglerBin, withProcessCwd } from '../runtime-tools.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../git-workflow.ts';
import {
	createTreeseedManagedToolEnv,
	resolveTreeseedToolBinary,
	resolveTreeseedToolCommand,
} from '../../../managed-dependencies.ts';
import { TREESEED_GITHUB_TOKEN_ENV, resolveTreeseedGitHubToken, withTreeseedServiceCredentialEnv } from '../../../service-credentials.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../managed-host-security.ts';
import {
	assertTreeseedKeyAgentResponse,
	getTreeseedKeyAgentPaths,
	inspectTreeseedKeyAgentDiagnostics,
	readWrappedMachineKeyFile,
	replaceWrappedMachineKey,
	rotateWrappedMachineKeyPassphrase,
	TREESEED_KEY_AGENT_IDLE_TIMEOUT_MS,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	TreeseedKeyAgentError,
	unwrapMachineKey,
	type TreeseedKeyAgentStatus,
} from '../key-agent.ts';
import { TreeseedCollectedConfigContext, TreeseedConfigEntrySnapshot, TreeseedConfigScope, TreeseedConfigValueUpdate } from './ensure-treeseed-secret-session-for-config.ts';
import { configGroupRank, createConfigReadiness } from './summarize-persistent-readiness.ts';
import { ensureTreeseedGitignoreEntries, ensureTreeseedRailwayIgnoreEntries, migrateLegacyScopedSharedEntries } from './resolve-treeseed-template-catalog-endpoint.ts';
import { collectTreeseedConfigSeedValues, collectTreeseedEnvironmentContext, setTreeseedMachineEnvironmentValue } from './resolve-entry-value-from-buckets.ts';
import { getTreeseedMachineConfigPaths } from './load-tenant-deploy-config.ts';
import { loadMachineKey } from './create-default-treeseed-machine-config.ts';
import { loadTreeseedMachineConfig } from './rotate-treeseed-machine-key-passphrase.ts';
import { applyTreeseedEnvironmentToProcess } from './resolve-treeseed-launch-environment.ts';

export function listRelevantTreeseedConfigEntries(registry, scope: TreeseedConfigScope) {
	return registry.entries
		.filter((entry) =>
			entry.visibility !== 'system'
			&& entry.scopes.includes(scope)
			&& (
				!entry.isRelevant
				|| entry.isRelevant(registry.context, scope, 'config')
				|| Boolean(entry.onboardingFeature)
			),
		)
		.sort((left, right) => {
			const leftRequired = isTreeseedEnvironmentEntryRequired(left, registry.context, scope, 'config');
			const rightRequired = isTreeseedEnvironmentEntryRequired(right, registry.context, scope, 'config');
			if (leftRequired !== rightRequired) {
				return leftRequired ? -1 : 1;
			}
			if (left.purposes.length !== right.purposes.length) {
				return right.purposes.length - left.purposes.length;
			}
			if (configGroupRank(left.group) !== configGroupRank(right.group)) {
				return configGroupRank(left.group) - configGroupRank(right.group);
			}
			return left.label.localeCompare(right.label);
		});
}

export function buildConfigEntrySnapshot(scope: TreeseedConfigScope, entry, currentValue: string, suggestedValue: string) {
	const currentValueValid = (() => {
		if (!currentValue || !entry.validation) {
			return currentValue.length > 0;
		}
		switch (entry.validation.kind) {
			case 'string':
			case 'nonempty':
				return currentValue.trim().length > 0
					&& (
						typeof entry.validation.minLength !== 'number'
						|| currentValue.trim().length >= entry.validation.minLength
					);
			case 'boolean':
				return /^(true|false|1|0)$/i.test(currentValue);
			case 'number':
				return Number.isFinite(Number(currentValue));
			case 'url':
				try {
					new URL(currentValue);
					return true;
				} catch {
					return false;
				}
			case 'email':
				return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentValue);
			case 'enum':
				return entry.validation.values.includes(currentValue);
			default:
				return true;
		}
	})();
	const allowGeneratedSecretDefault = ['TREESEED_PLATFORM_RUNNER_SECRET', 'TREESEED_WEB_SERVICE_SECRET', 'TREESEED_API_WEB_SERVICE_SECRET', 'TREESEED_CREDENTIAL_SESSION_SECRET'].includes(entry.id);
	const allowSuggestedDefault = allowGeneratedSecretDefault || !(entry.sensitivity === 'secret' && entry.requirement !== 'optional');
	const effectiveValue = currentValueValid
		? (currentValue || (allowSuggestedDefault ? suggestedValue : '') || '')
		: ((allowSuggestedDefault ? suggestedValue : '') || currentValue || '');
	return {
		id: entry.id,
		label: entry.label,
		group: entry.group,
		cluster: entry.cluster ?? `${entry.group}:${entry.id}`,
		startupProfile: entry.startupProfile ?? 'advanced',
		requirement: entry.requirement,
		description: entry.description,
		howToGet: entry.howToGet,
		sensitivity: entry.sensitivity,
		targets: [...entry.targets],
		purposes: [...entry.purposes],
		storage: entry.storage ?? 'scoped',
		validation: entry.validation,
		sourceRequirement: entry.sourceRequirement,
		sourceHostType: entry.sourceHostType ?? null,
		sourceProvider: entry.sourceProvider ?? null,
		scope,
		sharedScopes: entry.storage === 'shared' ? [...entry.scopes] : [scope],
		required: false,
		currentValue,
		suggestedValue,
		effectiveValue,
	} satisfies TreeseedConfigEntrySnapshot;
}

export function collectTreeseedConfigContext({
	tenantRoot,
	scopes = [...TREESEED_ENVIRONMENT_SCOPES],
	env = process.env,
}: {
	tenantRoot: string;
	scopes?: TreeseedConfigScope[];
	env?: NodeJS.ProcessEnv;
}): TreeseedCollectedConfigContext {
	ensureTreeseedGitignoreEntries(tenantRoot);
	ensureTreeseedRailwayIgnoreEntries(tenantRoot);
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	const valuesByScope = Object.fromEntries(
		scopes.map((scope) => [scope, collectTreeseedConfigSeedValues(tenantRoot, scope, env)]),
	) as TreeseedCollectedConfigContext['valuesByScope'];
	const suggestedValuesByScope = Object.fromEntries(
		scopes.map((scope) => [scope, getTreeseedEnvironmentSuggestedValues({
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
			values: valuesByScope[scope],
		})]),
	) as TreeseedCollectedConfigContext['suggestedValuesByScope'];
	const validationByScope = Object.fromEntries(
		scopes.map((scope) => [scope, validateTreeseedEnvironmentValues({
			values: {
				...suggestedValuesByScope[scope],
				...valuesByScope[scope],
			},
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		})]),
	) as TreeseedCollectedConfigContext['validationByScope'];
	const configReadinessByScope = Object.fromEntries(
		scopes.map((scope) => [scope, createConfigReadiness(valuesByScope[scope], validationByScope[scope])]),
	) as TreeseedCollectedConfigContext['configReadinessByScope'];
	const entriesByScope = Object.fromEntries(
		scopes.map((scope) => [scope, listRelevantTreeseedConfigEntries(registry, scope).map((entry) => ({
			...buildConfigEntrySnapshot(
				scope,
				entry,
				valuesByScope[scope][entry.id] ?? '',
				suggestedValuesByScope[scope][entry.id] ?? '',
			),
			required: isTreeseedEnvironmentEntryRequired(entry, registry.context, scope, 'config'),
		}))]),
	) as TreeseedCollectedConfigContext['entriesByScope'];

	return {
		tenantRoot,
		scopes,
		project: {
			name: registry.context.deployConfig.name,
			slug: registry.context.deployConfig.slug,
			siteUrl: registry.context.deployConfig.siteUrl,
		},
		configPath,
		keyPath,
		entriesByScope,
		valuesByScope,
		suggestedValuesByScope,
		configReadinessByScope,
		validationByScope,
		sharedStorageMigrations: [],
		registry,
	};
}

export function applyTreeseedConfigValues({
	tenantRoot,
	updates,
	applyLocalEnvironment = true,
}: {
	tenantRoot: string;
	updates: TreeseedConfigValueUpdate[];
	applyLocalEnvironment?: boolean;
}) {
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const key = loadMachineKey(tenantRoot);
	const machineConfig = loadTreeseedMachineConfig(tenantRoot);
	const sharedStorageMigrations = migrateLegacyScopedSharedEntries(tenantRoot, machineConfig, registry.entries, key);
	const entryById = new Map(registry.entries.map((entry) => [entry.id, entry]));
	const applied: Array<{ scope: TreeseedConfigScope | 'shared'; id: string; reused: boolean; cleared: boolean }> = [];

	for (const update of updates) {
		const entry = entryById.get(update.entryId);
		if (!entry) {
			throw new Error(`Unknown Treeseed config entry "${update.entryId}".`);
		}
		if (!entry.scopes.includes(update.scope)) {
			throw new Error(`Treeseed config entry "${update.entryId}" does not apply to ${update.scope}.`);
		}

		setTreeseedMachineEnvironmentValue(tenantRoot, update.scope, entry, update.value);
		applied.push({
			scope: entry.storage === 'shared' ? 'shared' : update.scope,
			id: entry.id,
			reused: update.reused === true,
			cleared: update.value.length === 0,
		});
	}

	if (applyLocalEnvironment) {
		applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
	}

	return {
		updated: applied,
		sharedStorageMigrations,
	};
}

export function configProblemBootstrapSystems(problem) {
	switch (problem?.id) {
		case 'TREESEED_GITHUB_TOKEN':
			return ['github'];
		case 'TREESEED_CLOUDFLARE_API_TOKEN':
		case 'TREESEED_CLOUDFLARE_ACCOUNT_ID':
		case 'CLOUDFLARE_ZONE_ID':
			return ['data', 'web'];
		case 'TREESEED_RAILWAY_API_TOKEN':
		case 'TREESEED_RAILWAY_WORKSPACE':
			return ['api', 'agents'];
		default:
			return null;
	}
}

export function filterValidationForBootstrapSystems(validation, runnableSystems: TreeseedRunnableBootstrapSystem[]) {
	const runnable = new Set(runnableSystems);
	const keepProblem = (problem) => {
		const systems = configProblemBootstrapSystems(problem);
		return !systems || systems.some((system) => runnable.has(system));
	};
	const missing = validation.missing.filter(keepProblem);
	const invalid = validation.invalid.filter(keepProblem);
	return {
		...validation,
		ok: missing.length === 0 && invalid.length === 0,
		missing,
		invalid,
	};
}
