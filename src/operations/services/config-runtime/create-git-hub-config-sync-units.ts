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
import { TreeseedConfigScope } from './ensure-treeseed-secret-session-for-config.ts';
import { githubConfigSyncUnitId, runBounded, withGitHubEnvironmentCredentialContext } from './check-railway-connection.ts';
import { collectTreeseedEnvironmentContext, nonEmptyEnvironmentValues, resolveTreeseedMachineEnvironmentValues } from './resolve-entry-value-from-buckets.ts';

export function createGitHubConfigSyncUnits({
	scope,
	repository,
	environment,
	items,
}: {
	scope: TreeseedConfigScope;
	repository: string;
	environment: string;
	items: Array<{ kind: 'secret' | 'variable'; name: string }>;
}) {
	const identity = {
		teamId: 'config',
		projectId: 'config',
		slug: 'config',
		environment: scope,
		deploymentKey: `config:${scope}`,
		environmentKey: scope,
	};
	const repositoryId = githubConfigSyncUnitId(repository);
	const environmentId = githubConfigSyncUnitId(environment);
	const environmentUnitId = `github-environment:config:${scope}:${repositoryId}:${environmentId}`;
	const target = { kind: 'persistent', scope } as const;
	const environmentUnit: TreeseedDesiredUnit = {
		unitId: environmentUnitId,
		unitType: 'github-environment',
		provider: 'github',
		identity,
		target,
		logicalName: `${repository} ${environment}`,
		dependencies: [],
		spec: {
			repository,
			environment,
		},
		secrets: {},
		metadata: {
			source: { type: 'config-sync' },
			resourceKind: 'github-environment',
		},
	};
	const bindingUnits = items.flatMap((item): TreeseedDesiredUnit[] => {
		if (item.kind === 'secret') {
			return [{
				unitId: `github-secret-binding:config:${scope}:${repositoryId}:${environmentId}:${githubConfigSyncUnitId(item.name)}`,
				unitType: 'github-secret-binding',
				provider: 'github',
				identity,
				target,
				logicalName: `${repository} ${environment} ${item.name}`,
				dependencies: [environmentUnitId],
				spec: {
					repository,
					environment,
					secretName: item.name,
					envName: item.name,
				},
				secrets: {},
				metadata: {
					source: { type: 'config-sync' },
					resourceKind: 'github-secret-binding',
				},
			}];
		}
		if (item.kind === 'variable') {
			return [{
				unitId: `github-variable-binding:config:${scope}:${repositoryId}:${environmentId}:${githubConfigSyncUnitId(item.name)}`,
				unitType: 'github-variable-binding',
				provider: 'github',
				identity,
				target,
				logicalName: `${repository} ${environment} ${item.name}`,
				dependencies: [environmentUnitId],
				spec: {
					repository,
					environment,
					variableName: item.name,
					envName: item.name,
				},
				secrets: {},
				metadata: {
					source: { type: 'config-sync' },
					resourceKind: 'github-variable-binding',
				},
			}];
		}
		return [];
	});
	return bindingUnits.length > 0 ? [environmentUnit, ...bindingUnits] : [];
}

export async function syncTreeseedGitHubEnvironment({
	tenantRoot,
	scope = 'prod',
	planOnly = false,
	repository: repositoryInput,
	valuesOverlay = {},
	entryIds,
	managedHostMode = 'auto',
	execution = 'parallel',
	concurrency = 4,
	onProgress,
}: {
	tenantRoot: string;
	scope?: TreeseedConfigScope;
	planOnly?: boolean;
	repository?: string | null;
	valuesOverlay?: Record<string, string | undefined>;
	entryIds?: string[];
	managedHostMode?: 'auto' | 'direct' | 'managed';
	execution?: 'parallel' | 'sequential';
	concurrency?: number;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const repository = repositoryInput ?? maybeResolveGitHubRepositorySlug(tenantRoot);
	if (!repository) {
		throw new Error('Unable to determine the GitHub repository from the origin remote.');
	}

	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	const values = {
		...resolveTreeseedMachineEnvironmentValues(tenantRoot, scope),
		...nonEmptyEnvironmentValues(valuesOverlay),
	};
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const managedBoundary = managedHostMode === 'managed'
		|| (managedHostMode === 'auto' && usesManagedHostOperationRequests(deployConfig));
	const allowed = managedBoundary
		? filterManagedHostGitHubEnvironment({
			secrets: registry.entries.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('github-secret')).map((entry) => entry.id),
			variables: registry.entries.filter((entry) => entry.scopes.includes(scope) && entry.targets.includes('github-variable')).map((entry) => entry.id),
		})
		: null;
	const allowedSecrets = allowed ? new Set(allowed.secrets) : null;
	const allowedVariables = allowed ? new Set(allowed.variables) : null;
	const entryFilter = Array.isArray(entryIds) && entryIds.length > 0 ? new Set(entryIds) : null;
	const relevant = registry.entries.filter((entry) => {
		if (!entry.scopes.includes(scope)) return false;
		if (entryFilter && !entryFilter.has(entry.id)) return false;
		if (!managedBoundary) return true;
		if (entry.sensitivity === 'secret') {
			return Boolean(entry.targets.includes('github-secret') && allowedSecrets?.has(entry.id));
		}
		return Boolean(entry.targets.includes('github-variable') && allowedVariables?.has(entry.id));
	});
	const credential = resolveGitHubCredentialForRepository(repository, { values, env: process.env });
	const environment = scope === 'prod' ? 'production' : scope;
	const progress = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => onProgress?.(message, stream);
	progress(`[${scope}][github][sync] Loading existing GitHub secrets and variables...`);
	const [secretNames, variableNames] = [new Set<string>(), new Set<string>()];
	const synced = {
		secrets: [] as Array<{ name: string; existed: boolean }>,
		variables: [] as Array<{ name: string; existed: boolean }>,
	};
	const items: Array<{ kind: 'secret' | 'variable'; name: string; value: string; existed: boolean }> = [];

	for (const entry of relevant) {
		const value = values[entry.id];
		if (!value) {
			continue;
		}

		if (entry.sensitivity === 'secret') {
			items.push({ kind: 'secret', name: entry.id, value, existed: secretNames.has(entry.id) });
		} else {
			items.push({ kind: 'variable', name: entry.id, value, existed: variableNames.has(entry.id) });
		}
	}
	let completed = 0;
	const total = items.length;
	if (!planOnly) {
		const units = createGitHubConfigSyncUnits({ scope, repository, environment, items });
		if (units.length === 0) {
			progress(`[${scope}][github][sync] Complete: 0 secrets, 0 variables, 0 total.`);
			return {
				repository,
				scope,
				environment,
				secrets: synced.secrets,
				variables: synced.variables,
			};
		}
		try {
			const result = await reconcileTreeseedTarget({
				tenantRoot,
				target: createPersistentDeployTarget(scope),
				env: {
					...process.env,
					...values,
					...valuesOverlay,
				},
				units,
				write: (line) => progress(`[${scope}][github][reconcile] ${line}`),
			});
			const plansById = new Map(result.plans.map((entry) => [entry.unit.unitId, entry]));
			for (const unit of units) {
				if (unit.unitType !== 'github-secret-binding' && unit.unitType !== 'github-variable-binding') continue;
				const planEntry = plansById.get(unit.unitId);
				const name = String(unit.spec.secretName ?? unit.spec.variableName ?? unit.spec.envName ?? '');
				if (!name) continue;
				const existed = Boolean(planEntry?.observed.exists);
				if (unit.unitType === 'github-secret-binding') {
					synced.secrets.push({ name, existed });
				} else {
					synced.variables.push({ name, existed });
				}
				completed += 1;
				progress(`[${scope}][github][${unit.unitType === 'github-secret-binding' ? 'secret' : 'variable'}] reconciled ${name} (${completed}/${total})`);
			}
		} catch (error) {
			throw withGitHubEnvironmentCredentialContext(error, repository, credential);
		}
		progress(`[${scope}][github][sync] Complete: ${synced.secrets.length} secrets, ${synced.variables.length} variables, ${total} total.`);
		return {
			repository,
			scope,
			environment,
			secrets: synced.secrets,
			variables: synced.variables,
		};
	}
	progress(`[${scope}][github][sync] Syncing GitHub environment ${environment}: 0/${total} items...`);
	const limit = execution === 'sequential' ? 1 : concurrency;
	await runBounded(items, limit, async (item) => {
		completed += 1;
		const action = item.existed ? 'would update' : 'would create';
		progress(`[${scope}][github][${item.kind}] ${action} ${item.name} (${completed}/${total})`);
		if (item.kind === 'secret') {
			synced.secrets.push({ name: item.name, existed: item.existed });
		} else {
			synced.variables.push({ name: item.name, existed: item.existed });
		}
	});
	progress(`[${scope}][github][sync] Complete: ${synced.secrets.length} secrets, ${synced.variables.length} variables, ${total} total.`);

	return {
		repository,
		scope,
		environment,
		credential: {
			repository: credential.repository,
			envName: credential.envName,
			configured: credential.configured,
			source: credential.source,
			fallbackUsed: credential.fallbackUsed,
		},
		entryIds: entryFilter ? [...entryFilter] : undefined,
		...synced,
	};
}
