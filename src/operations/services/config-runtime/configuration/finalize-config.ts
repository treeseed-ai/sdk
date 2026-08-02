import {
ENVIRONMENT_SCOPES,
getEnvironmentSuggestedValues,
validateEnvironmentValues
} from '../../../../platform/configuration/environment.ts';
import {
reconcileTarget,
resolveBootstrapSelection,
type BootstrapSystem
} from '../../../../reconcile/index.ts';
import {
buildProvisioningSummary,
createPersistentDeployTarget,
loadDeployState
} from '../../hosting/deployment/deploy.ts';
import {
resolveRailwayWorkspace
} from '../../hosting/railway/railway-api.ts';
import { PRODUCTION_BRANCH,STAGING_BRANCH } from '../../operations/git-workflow.ts';
import {
createGitHubApiClient,
ensureGitHubBranchFromBase
} from '../../repositories/github-api.ts';
import { maybeResolveGitHubRepositorySlug } from '../../repositories/github-automation.ts';
import { ConfigScope } from '../accounts/ensure-secret-session-for-config.ts';
import { checkProviderConnections,discoverGitHubEnvironmentSyncTargets,formatProviderConnectionFailures } from '../hosting/check-railway-connection.ts';
import { collectConfigSeedValues,collectEnvironmentContext,workspaceBootstrapDeployConfig } from '../support/resolve-entry-value-from-buckets.ts';
import { formatConfigValidationFailure,summarizePersistentReadiness,summarizeReconciledPersistentReadiness } from '../support/summarize-persistent-readiness.ts';
import { syncGitHubEnvironment } from './create-git-hub-config-sync-units.ts';
import { filterValidationForBootstrapSystems } from './list-relevant-config-entries.ts';
import { syncManagedServiceSettingsFromDeployConfig } from './machine-config-relative-path.ts';
import { applyEnvironmentToProcess } from './resolve-launch-environment.ts';

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

	const githubRepository = maybeResolveGitHubRepositorySlug(tenantRoot);

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
