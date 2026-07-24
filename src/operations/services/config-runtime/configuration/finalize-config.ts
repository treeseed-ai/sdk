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
import { collectConfigSeedValues, collectEnvironmentContext, workspaceBootstrapDeployConfig } from '../support/resolve-entry-value-from-buckets.ts';
import { checkProviderConnections, discoverGitHubEnvironmentSyncTargets, formatProviderConnectionFailures } from '../hosting/check-railway-connection.ts';
import { filterValidationForBootstrapSystems } from './list-relevant-config-entries.ts';
import { formatConfigValidationFailure, summarizePersistentReadiness, summarizeReconciledPersistentReadiness } from '../support/summarize-persistent-readiness.ts';
import { syncManagedServiceSettingsFromDeployConfig } from './machine-config-relative-path.ts';
import { applyEnvironmentToProcess } from './resolve-launch-environment.ts';
import { syncGitHubEnvironment } from './create-git-hub-config-sync-units.ts';

export async function finalizeConfig({
	tenantRoot,
	scopes = [...ENVIRONMENT_SCOPES],
	sync = 'all',
	env = process.env,
	checkConnections = true,
	initializePersistent = true,
	systems,
	skipUnavailable,
	bootstrapExecution = 'parallel',
	onProgress,
}: {
	tenantRoot: string;
	scopes?: ConfigScope[];
	sync?: 'none' | 'github' | 'cloudflare' | 'railway' | 'all';
	env?: NodeJS.ProcessEnv;
	checkConnections?: boolean;
	initializePersistent?: boolean;
	systems?: BootstrapSystem[] | BootstrapSystem;
	skipUnavailable?: boolean;
	bootstrapExecution?: 'parallel' | 'sequential';
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}) {
	const registry = collectEnvironmentContext(tenantRoot);
	const summary = {
		scopes,
		synced: {} as Record<string, unknown>,
		reconciled: [] as Array<{ scope: ConfigScope; target: string; units: number; actions: Array<{ unitId: string; unitType: string; provider: string; action: string; verified: boolean; missing: string[]; drifted: string[] }> }>,
		deployed: [] as Array<{ scope: ConfigScope; branchBootstrap?: Record<string, unknown> | null; result: Record<string, unknown> }>,
		resourceInventoryByScope: {} as Record<ConfigScope, Record<string, unknown>>,
		connectionChecks: [] as ReturnType<typeof checkProviderConnections>[],
		validationByScope: {} as Record<ConfigScope, ReturnType<typeof validateEnvironmentValues>>,
		bootstrapSystemsByScope: {} as Record<ConfigScope, ReturnType<typeof resolveBootstrapSelection>>,
		githubRepository: null as Record<string, unknown> | null,
		readinessByScope: {} as Record<ConfigScope, {
			phase: string;
			configured: boolean;
			provisioned: boolean;
			deployable: boolean;
			blockers: string[];
			warnings: string[];
			checks: Record<string, unknown>;
		}>,
		bootstrapExecution,
	};
	const progress = (message: string, stream: 'stdout' | 'stderr' = 'stdout') => {
		if (typeof onProgress === 'function') {
			onProgress(message, stream);
		}
	};

	progress(`Validating configuration for ${scopes.join(', ')}...`);
	const rawScopeSeedValues = Object.fromEntries(
		scopes.map((scope) => [scope, collectConfigSeedValues(tenantRoot, scope, env)]),
	) as Record<ConfigScope, Record<string, string>>;
	const scopeSeedValues = Object.fromEntries(
		scopes.map((scope) => {
			const suggestedValues = getEnvironmentSuggestedValues({
				scope,
				purpose: 'config',
				deployConfig: registry.context.deployConfig,
				tenantConfig: registry.context.tenantConfig,
				plugins: registry.context.plugins,
				values: rawScopeSeedValues[scope],
			});
			return [scope, {
				...suggestedValues,
				...rawScopeSeedValues[scope],
			}];
		}),
	) as Record<ConfigScope, Record<string, string>>;

	for (const scope of scopes) {
		const selection = resolveBootstrapSelection({
			deployConfig: workspaceBootstrapDeployConfig(tenantRoot, registry.context.deployConfig),
			env: scopeSeedValues[scope],
			systems: scope === 'local' ? ['github'] : systems,
			skipUnavailable: scope === 'local' ? true : skipUnavailable,
		});
		summary.bootstrapSystemsByScope[scope] = selection;
		const strictUnavailable = selection.unavailable.filter((status) =>
			!selection.skipped.some((skipped) => skipped.system === status.system && skipped.reason === status.reason),
		);
		if (initializePersistent && strictUnavailable.length > 0) {
			throw new Error(`Treeseed bootstrap cannot run the selected systems for ${scope}:\n- ${strictUnavailable.map((status) => `${status.system}: ${status.reason}`).join('\n- ')}`);
		}
		for (const skipped of selection.skipped) {
			progress(`[${scope}][${skipped.system}][skip] ${skipped.reason}`);
		}
	}

	for (const scope of scopes) {
		const seedValues = scopeSeedValues[scope];
		const suggestedValues = getEnvironmentSuggestedValues({
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
			values: seedValues,
		});
		const validation = validateEnvironmentValues({
			values: {
				...suggestedValues,
				...seedValues,
			},
			scope,
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
		});
		summary.validationByScope[scope] = initializePersistent
			? filterValidationForBootstrapSystems(validation, summary.bootstrapSystemsByScope[scope].runnable)
			: validation;

		if (checkConnections) {
			progress(`Checking provider connectivity for ${scope}...`);
			summary.connectionChecks.push(await checkProviderConnections({ tenantRoot, scope, env: seedValues }));
		}
	}

	for (const scope of scopes) {
		if (scope !== 'local') {
			const target = createPersistentDeployTarget(scope);
			const deployState = loadDeployState(tenantRoot, registry.context.deployConfig, { target });
			const inventory = buildProvisioningSummary(registry.context.deployConfig, deployState, target);
			const railwayWorkspace = resolveRailwayWorkspace(scopeSeedValues[scope]);
			summary.resourceInventoryByScope[scope] = inventory;
			progress(
				`Resolved ${scope} resources: deployment=${inventory.identity?.deploymentKey}, pages=${inventory.resources?.pagesProject}, web-domain=${inventory.resources?.webDomain ?? '(none)'}, api-domain=${inventory.resources?.apiDomain ?? '(none)'}, r2=${inventory.resources?.contentBucket}, queue=${inventory.resources?.queue}, d1=${inventory.resources?.database}, railway=${inventory.resources?.railwayProject}, workspace=${railwayWorkspace}.`,
			);
		}
		summary.readinessByScope[scope] = await summarizePersistentReadiness(
			tenantRoot,
			scope,
			summary.validationByScope[scope],
			summary.connectionChecks.find((report) => report.scope === scope)?.checks ?? [],
			scopeSeedValues[scope],
			{
				includeReconcileStatus: initializePersistent
					&& summary.bootstrapSystemsByScope[scope].runnable.some((system) => system !== 'github'),
				systems: summary.bootstrapSystemsByScope[scope].runnable.filter((system) => system !== 'github'),
			},
		);
	}

	const invalidScopes = scopes.filter((scope) => summary.validationByScope[scope]?.ok !== true);
	if (invalidScopes.length > 0) {
		throw new Error(formatConfigValidationFailure(summary.validationByScope, scopes));
	}
	const failingConnectionReports = summary.connectionChecks.filter((report) => report.ok !== true);
	if (failingConnectionReports.length > 0) {
		throw new Error(formatProviderConnectionFailures(failingConnectionReports));
	}

	progress('Syncing managed service settings from treeseed.site.yaml...');
	syncManagedServiceSettingsFromDeployConfig(tenantRoot);

	const githubSelected = scopes.some((scope) => scope !== 'local' && summary.bootstrapSystemsByScope[scope].runnable.includes('github'));
	let githubRepository = maybeResolveGitHubRepositorySlug(tenantRoot);
	if (githubSelected && initializePersistent) {
		const localSeedValues = collectConfigSeedValues(tenantRoot, 'local', env);
		const localSuggestedValues = getEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig: registry.context.deployConfig,
			tenantConfig: registry.context.tenantConfig,
			plugins: registry.context.plugins,
			values: localSeedValues,
		});
		const repositoryBootstrap = await ensureGitHubBootstrapRepository(tenantRoot, {
			values: {
				...localSuggestedValues,
				...localSeedValues,
			},
			defaultName: registry.context.deployConfig.slug,
			onProgress: (line) => progress(line),
		});
		summary.githubRepository = repositoryBootstrap as Record<string, unknown>;
		githubRepository = repositoryBootstrap.repository;
	}

	if (initializePersistent) {
		for (const scope of scopes) {
			if (scope === 'local') {
				continue;
			}
			const selection = summary.bootstrapSystemsByScope[scope];
			const reconcileSystems = selection.runnable.filter((system) => system !== 'github');
			if (reconcileSystems.length > 0) {
				progress(`[${scope}][bootstrap][plan] Deriving desired units for ${reconcileSystems.join(', ')}...`);
				const initialized = await reconcileTarget({
					tenantRoot,
					target: createPersistentDeployTarget(scope),
					env: scopeSeedValues[scope],
					systems: reconcileSystems,
					write: (line) => progress(`[${scope}][reconcile] ${line}`),
				});
				summary.reconciled.push({
					scope,
					target: scope,
					units: initialized.units.length,
					actions: initialized.results.map((result) => ({
						unitId: result.unit.unitId,
						unitType: result.unit.unitType,
						provider: result.unit.provider,
						action: result.action,
						verified: result.verification?.verified === true,
						missing: result.verification?.missing ?? [],
						drifted: result.verification?.drifted ?? [],
					})),
				});
			}
			if (scope === 'staging' && selection.runnable.includes('github')) {
				progress(`[${scope}][github][branch] Ensuring ${STAGING_BRANCH} exists on origin from ${PRODUCTION_BRANCH}...`);
				if (!githubRepository) {
					throw new Error('Unable to determine the GitHub repository from the origin remote for staging branch bootstrap.');
				}
				const branchBootstrap = await ensureGitHubBranchFromBase(githubRepository, STAGING_BRANCH, {
					baseBranch: PRODUCTION_BRANCH,
					client: createGitHubApiClient({
						env: scopeSeedValues[scope],
					}),
				});
				summary.deployed.push({
					scope,
					branchBootstrap,
					result: {},
				});
			}
			const deploySystems = selection.runnable.filter((system) => system === 'data' || system === 'web' || system === 'api' || system === 'agents');
			if (deploySystems.length > 0) {
				progress(`[${scope}][bootstrap][deploy] Deploying ${deploySystems.join(', ')}...`);
				applyEnvironmentToProcess({ tenantRoot, scope, override: true });
				process.env.TREESEED_RAILWAY_WORKSPACE = process.env.TREESEED_RAILWAY_WORKSPACE
					|| scopeSeedValues[scope].TREESEED_RAILWAY_WORKSPACE
					|| resolveRailwayWorkspace(scopeSeedValues[scope]);
				const { deployProjectPlatform } = await import('../../projects/projects-core/project-platform.ts');
				const deployResult = await deployProjectPlatform({
					tenantRoot,
					scope,
					skipProvision: true,
					bootstrapSystems: deploySystems,
					bootstrapExecution,
					env: scopeSeedValues[scope],
					write: (line, stream) => progress(line, stream),
				});
				const deployEntry = summary.deployed.find((entry) => entry.scope === scope);
				if (deployEntry) {
					deployEntry.result = deployResult as Record<string, unknown>;
				} else {
					summary.deployed.push({
						scope,
						branchBootstrap: null,
						result: deployResult as Record<string, unknown>,
					});
				}
				progress(`[${scope}][bootstrap][verify] Re-verifying after deployment...`);
				const finalized = await reconcileTarget({
					tenantRoot,
					target: createPersistentDeployTarget(scope),
					env: scopeSeedValues[scope],
					systems: reconcileSystems,
					write: (line) => progress(`[${scope}][verify] ${line}`),
				});
				const index = summary.reconciled.findIndex((entry) => entry.scope === scope);
				const nextSummary = {
					scope,
					target: scope,
					units: finalized.units.length,
					actions: finalized.results.map((result) => ({
						unitId: result.unit.unitId,
						unitType: result.unit.unitType,
						provider: result.unit.provider,
						action: result.action,
						verified: result.verification?.verified === true,
						missing: result.verification?.missing ?? [],
						drifted: result.verification?.drifted ?? [],
					})),
				};
				if (index >= 0) {
					summary.reconciled[index] = nextSummary;
				} else {
					summary.reconciled.push(nextSummary);
				}
			}
		}
	}

	if (sync === 'github' || sync === 'all') {
		const githubScopes = scopes.filter((scope) => scope !== 'local' && summary.bootstrapSystemsByScope[scope].runnable.includes('github'));
		const githubTargets = discoverGitHubEnvironmentSyncTargets(tenantRoot, githubRepository);
		if (githubTargets.length === 0 && githubScopes.length > 0) {
			throw new Error('Unable to determine the GitHub repository from the origin remote.');
		}
		const syncScope = async (scope: ConfigScope, target: { repository: string; managedHostMode: 'auto' | 'direct' | 'managed' }) => {
			progress(`[${scope}][github][sync] Syncing GitHub environment for ${target.repository}...`);
			return await syncGitHubEnvironment({
				tenantRoot,
				scope,
				repository: target.repository,
				managedHostMode: target.managedHostMode,
				execution: bootstrapExecution,
				onProgress: progress,
			});
		};
		const githubResults: Array<Awaited<ReturnType<typeof syncGitHubEnvironment>>> = [];
		if (bootstrapExecution === 'sequential') {
			for (const target of githubTargets) {
				for (const scope of githubScopes) {
					githubResults.push(await syncScope(scope, target));
				}
			}
		} else {
			githubResults.push(...await Promise.all(githubTargets.flatMap((target) =>
				githubScopes.map((scope) => syncScope(scope, target)),
			)));
		}
		summary.synced.github = {
			scopes: githubResults,
			repository: githubResults[0]?.repository ?? githubRepository ?? maybeResolveGitHubRepositorySlug(tenantRoot),
			repositories: githubResults.map((entry) => entry.repository).filter((repository, index, all) => all.indexOf(repository) === index),
			secrets: githubResults.flatMap((entry) => entry.secrets),
			variables: githubResults.flatMap((entry) => entry.variables),
		};
	}
	for (const scope of scopes) {
		const reconciled = summary.reconciled.find((entry) => entry.scope === scope) ?? null;
		summary.readinessByScope[scope] = initializePersistent && reconciled
			? summarizeReconciledPersistentReadiness(
				scope,
				summary.validationByScope[scope],
				summary.connectionChecks.find((report) => report.scope === scope)?.checks ?? [],
				reconciled,
			)
			: await summarizePersistentReadiness(
				tenantRoot,
				scope,
				summary.validationByScope[scope],
				summary.connectionChecks.find((report) => report.scope === scope)?.checks ?? [],
				scopeSeedValues[scope],
				{
					includeReconcileStatus: initializePersistent
						&& summary.bootstrapSystemsByScope[scope].runnable.some((system) => system !== 'github'),
					systems: summary.bootstrapSystemsByScope[scope].runnable.filter((system) => system !== 'github'),
				},
			);
	}

	return summary;
}
