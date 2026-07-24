import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getMachineConfigPaths, inspectKeyAgentStatus, loadMachineConfig, collectEnvironmentContext } from "../operations/services/configuration/config-runtime.ts";
import { resolveGitHubToken } from "../configuration/service-credentials.ts";
import { resolveWebCachePolicy } from "../platform/hosting/deploy-config.ts";
import { createBranchPreviewDeployTarget, createPersistentDeployTarget, loadDeployState } from "../operations/services/hosting/deployment/deploy.ts";
import { loadPlatformConfig } from "../platform/configuration/config.ts";
import { collectCliPreflight } from "../operations/services/treedx/workspaces/workspace-preflight.ts";
import { collectPublicPackageReleaseLineState, currentBranch, gitStatusPorcelain } from "../operations/services/treedx/workspaces/workspace-save.ts";
import { hasCompletePackageCheckout, isWorkspaceRoot, run } from "../operations/services/treedx/workspaces/workspace-tools.ts";
import { packageAdapterPlanSummary } from "../operations/services/reconciliation/package-adapters.ts";
import { inspectWorkspaceDependencyMode } from "../operations/services/treedx/workspaces/workspace-dependency-mode.ts";
import { inspectDetachedHeadRepair, PRODUCTION_BRANCH, STAGING_BRANCH } from "../operations/services/operations/git-workflow.ts";
import { classifyWorkflowRunJournals, inspectWorkflowLock } from "../workflow/runs.ts";
import { resolveWorkflowPaths, workflowEnvironmentForBranchRole } from "../workflow/policy.ts";
import { WorkflowProviderStatus, WorkflowState, WorkflowStatusOptions, emptyEnvironmentStatus, emptyPersistentEnvironments, emptyProviderStatus, runGit } from './branch-role.ts';
import { collectStatusConfigScope, hasStatusConfigValue, isCloudflareProviderProblem, knownRemoteTrackingBranchExists, providerStatusForScope, readinessForEnvironment, safeHeadCommit, safeResolveRemoteSession } from './readiness-for-environment.ts';
import { capObsoleteWorkflowRuns, capWorkflowRunHistory, resolveLocalStatusUrl, safeReleaseHistory } from './safe-release-history.ts';
import { recommendNextSteps } from './recommend-next-steps.ts';

export function resolveWorkflowState(cwd: string, options: WorkflowStatusOptions = {}): WorkflowState {
	const resolved = resolveWorkflowPaths(cwd);
	const effectiveCwd = resolved.cwd;
	const workspaceRoot = isWorkspaceRoot(effectiveCwd);
	const ConfigPath = resolve(effectiveCwd, 'treeseed.site.yaml');
	const tenantRoot = existsSync(ConfigPath);
	const root = resolved.repoRoot;
	const branchName = resolved.branchName;
	const branchRole = resolved.branchRole;
	const dirtyWorktree = root ? gitStatusPorcelain(root).length > 0 : false;
	const completePackageCheckout = hasCompletePackageCheckout(effectiveCwd);
	const workspaceDependencyMode = inspectWorkspaceDependencyMode(effectiveCwd);
	const packageAdapters = workspaceRoot ? packageAdapterPlanSummary(effectiveCwd) : [];
	const packageSyncRepos = workspaceRoot
		? packageAdapters
			.map((pkg) => {
				const packageDir = resolve(effectiveCwd, pkg.path);
				const repoBranch = currentBranch(packageDir) || null;
				const dirty = gitStatusPorcelain(packageDir).length > 0;
				const expectedBranch = branchName;
				const detachedRepair = repoBranch
					? null
					: inspectDetachedHeadRepair(packageDir, [expectedBranch, STAGING_BRANCH, PRODUCTION_BRANCH].filter((branch): branch is string => Boolean(branch)));
				let localBranch = false;
				if (expectedBranch) {
					if (repoBranch === expectedBranch) {
						localBranch = true;
					} else {
						try {
							runGit(['show-ref', '--verify', '--quiet', `refs/heads/${expectedBranch}`], { cwd: packageDir, capture: true });
							localBranch = true;
						} catch {
							localBranch = false;
						}
					}
				}
				const remoteBranch = Boolean(expectedBranch) ? knownRemoteTrackingBranchExists(packageDir, expectedBranch) : false;
				return {
					name: pkg.id,
					path: pkg.path,
					branchName: repoBranch,
					dirty,
					aligned: expectedBranch ? repoBranch === expectedBranch : true,
					localBranch,
					remoteBranch,
					detached: repoBranch == null,
					detachedRepair: detachedRepair
						? {
							repairable: detachedRepair.repairable,
							targetBranch: detachedRepair.targetBranch,
							headSha: detachedRepair.headSha,
							targetSha: detachedRepair.targetSha,
							dirty: detachedRepair.dirty,
							blocker: detachedRepair.blocker,
						}
						: null,
				};
			})
		: [];
	const packageSyncBlockers: string[] = [];
	const packageSyncWarnings: string[] = [];
	const packageReleaseLine = completePackageCheckout ? collectPublicPackageReleaseLineState(effectiveCwd) : null;
	if (packageReleaseLine?.drifted) {
		packageSyncWarnings.push(`Public package release lines are drifted: ${packageReleaseLine.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}.`);
	}
	for (const repo of packageSyncRepos) {
		if (repo.dirty) {
			packageSyncBlockers.push(`${repo.name} has uncommitted changes.`);
		}
		const detachedRepair = repo.detachedRepair;
		if (repo.detached && detachedRepair?.repairable === true) {
			const targetBranch = typeof detachedRepair.targetBranch === 'string' ? detachedRepair.targetBranch : branchName;
			const dirtyNote = detachedRepair.dirty === true ? ' with local changes preserved' : '';
			packageSyncWarnings.push(`${repo.name} is detached at ${targetBranch ?? 'an expected branch'} HEAD${dirtyNote}; workflow commands can reattach it automatically.`);
			continue;
		}
		if (repo.detached && detachedRepair?.repairable !== true) {
			packageSyncBlockers.push(`${repo.name} is detached at a commit that does not match ${branchName ?? STAGING_BRANCH}/${PRODUCTION_BRANCH}; review manually.`);
			continue;
		}
		if (branchName && !repo.localBranch && !repo.remoteBranch) {
			packageSyncBlockers.push(`${repo.name} is missing branch ${branchName}.`);
			continue;
		}
		if (branchName && !repo.aligned) {
			packageSyncBlockers.push(`${repo.name} is on ${repo.branchName ?? '(detached)'} instead of ${branchName}.`);
		}
	}
	const preflight = collectCliPreflight({ cwd: effectiveCwd, requireAuth: false });
	const { configPath, keyPath } = getMachineConfigPaths(effectiveCwd);
	const machineConfig = existsSync(configPath) ? loadMachineConfig(effectiveCwd) : null;
	const keyStatus = inspectKeyAgentStatus(effectiveCwd);
	const marketSettings = machineConfig?.settings?.market && typeof machineConfig.settings.market === 'object'
		? machineConfig.settings.market as Record<string, unknown>
		: null;
	const runnerHostId = typeof marketSettings?.runnerHostId === 'string' && marketSettings.runnerHostId.trim()
		? marketSettings.runnerHostId.trim()
		: (typeof marketSettings?.projectId === 'string' && marketSettings.projectId.trim()
			? `operations-runner:${marketSettings.projectId.trim()}`
			: null);
	const runnerSession = runnerHostId ? safeResolveRemoteSession(effectiveCwd, runnerHostId) : null;
	const workflowLock = inspectWorkflowLock(effectiveCwd, { scope: 'worktree' });
	const workflowRunHeads: Record<string, string | null> = {};
	if (root) {
		workflowRunHeads['@treeseed/market'] = safeHeadCommit(root);
	}
	for (const pkg of packageAdapters) {
		workflowRunHeads[pkg.id] = safeHeadCommit(resolve(effectiveCwd, pkg.path));
	}
	const classifiedRuns = classifyWorkflowRunJournals(effectiveCwd, {
		currentBranch: branchName,
		currentHeads: workflowRunHeads,
	});
	const interruptedRuns = classifiedRuns
		.filter((entry) => entry.classification.state === 'resumable')
		.map(({ journal }) => ({
		runId: journal.runId,
		command: journal.command,
		updatedAt: journal.updatedAt,
		nextStep: journal.steps.find((step) => step.status === 'pending')?.description ?? null,
	}));
	const staleRuns = classifiedRuns
		.filter((entry) => entry.classification.state === 'stale')
		.map(({ journal, classification }) => ({
			runId: journal.runId,
			command: journal.command,
			updatedAt: journal.updatedAt,
			nextStep: journal.steps.find((step) => step.status === 'pending')?.description ?? null,
			reasons: classification.reasons,
		}));
	const staleHistory = capWorkflowRunHistory(staleRuns, { history: options.history });
	const obsoleteRuns = classifiedRuns
		.filter((entry) => entry.classification.state === 'obsolete')
		.map(({ journal, classification }) => ({
			runId: journal.runId,
			command: journal.command,
			updatedAt: journal.updatedAt,
			reasons: classification.reasons,
		}));
	const obsoleteHistory = capObsoleteWorkflowRuns(obsoleteRuns, { history: options.history });
	const workflowBlockers: string[] = [];
	if (workflowLock.active && workflowLock.lock) {
		workflowBlockers.push(`Workflow lock active for ${workflowLock.lock.command} (${workflowLock.lock.runId}).`);
	}
	if (workflowLock.stale && workflowLock.lock) {
		workflowBlockers.push(`Workflow lock is stale: ${workflowLock.staleReason}.`);
	}
	if (interruptedRuns.length > 0) {
		workflowBlockers.push(`Interrupted workflow runs detected: ${interruptedRuns.map((run) => run.runId).join(', ')}.`);
	}
	const releaseHistory = safeReleaseHistory(root);
	const releaseReady = branchRole === 'staging'
		&& !dirtyWorktree
		&& (releaseHistory.unreleasedStagingCommits ?? 0) > 0;
	const state: WorkflowState = {
		cwd: effectiveCwd,
		workspaceRoot,
		tenantRoot,
		deployConfigPresent: tenantRoot,
		repoRoot: root,
		branchName,
		branchRole,
		environment: workflowEnvironmentForBranchRole(branchRole),
		dirtyWorktree,
		workflowControl: {
			lock: {
				active: workflowLock.active,
				stale: workflowLock.stale,
				runId: workflowLock.lock?.runId ?? null,
				command: workflowLock.lock?.command ?? null,
				updatedAt: workflowLock.lock?.updatedAt ?? null,
				staleReason: workflowLock.staleReason,
			},
			interruptedRuns,
			staleRuns: staleHistory.runs,
			staleRunsTotal: staleHistory.total,
			staleRunsOmitted: staleHistory.omitted,
			obsoleteRuns: obsoleteHistory.obsoleteRuns,
			historyMode: obsoleteHistory.historyMode,
			obsoleteRunsTotal: obsoleteHistory.obsoleteRunsTotal,
			obsoleteRunsOmitted: obsoleteHistory.obsoleteRunsOmitted,
			blockers: workflowBlockers,
		},
		packageSync: {
			mode: completePackageCheckout || packageSyncRepos.length > 0 ? 'recursive-workspace' : 'root-only',
			completeCheckout: completePackageCheckout,
			dependencyMode: workspaceDependencyMode.mode,
			workspaceLinks: workspaceDependencyMode,
			expectedBranch: branchName,
			aligned: packageSyncRepos.every((repo) => repo.aligned),
			dirty: packageSyncRepos.some((repo) => repo.dirty),
			repos: packageSyncRepos,
			blockers: packageSyncBlockers,
			warnings: packageSyncWarnings,
			releaseLine: packageReleaseLine,
			packages: packageAdapters,
		},
		preview: {
			enabled: false,
			url: null,
			lastDeploymentTimestamp: null,
		},
		webCache: {
			webHost: null,
			contentHost: null,
			sourcePagePolicy: null,
			contentPagePolicy: null,
			r2ObjectPolicy: null,
			cloudflareRulesManaged: false,
			lastDeployPurgeAt: null,
			lastDeployPurgeCount: null,
			lastContentPurgeAt: null,
			lastContentPurgeCount: null,
		},
		persistentEnvironments: emptyPersistentEnvironments(),
		environmentStatus: emptyEnvironmentStatus(),
		providerStatus: emptyProviderStatus(),
		auth: {
			gh: preflight.checks.auth.gh?.authenticated === true,
			wrangler: preflight.checks.auth.wrangler?.authenticated === true,
			railway: preflight.checks.auth.railway?.authenticated === true,
			copilot: preflight.checks.auth.copilot?.configured === true,
			remoteApi: Boolean(safeResolveRemoteSession(cwd)),
		},
		marketConnection: {
			configured: Boolean(marketSettings?.baseUrl && marketSettings?.projectId),
			baseUrl: typeof marketSettings?.baseUrl === 'string' ? marketSettings.baseUrl : null,
			hostId: typeof marketSettings?.hostId === 'string' ? marketSettings.hostId : null,
			teamId: typeof marketSettings?.teamId === 'string' ? marketSettings.teamId : null,
			teamSlug: typeof marketSettings?.teamSlug === 'string' ? marketSettings.teamSlug : null,
			projectId: typeof marketSettings?.projectId === 'string' ? marketSettings.projectId : null,
			projectSlug: typeof marketSettings?.projectSlug === 'string' ? marketSettings.projectSlug : null,
			connectionMode: typeof marketSettings?.connectionMode === 'string' ? marketSettings.connectionMode : null,
			projectApiBaseUrl: typeof marketSettings?.projectApiBaseUrl === 'string' ? marketSettings.projectApiBaseUrl : null,
			hubMode: null,
			runtimeMode: null,
			runtimeRegistration: null,
			runtimeAttached: false,
			runtimeReady: true,
			runnerHostId,
			runnerReady: Boolean(
				marketSettings?.runnerReady === true
				|| (typeof runnerSession?.accessToken === 'string' && runnerSession.accessToken.length > 0)
			),
			runnerRegisteredAt: typeof marketSettings?.runnerRegisteredAt === 'string' ? marketSettings.runnerRegisteredAt : null,
			runnerLastSeenAt: typeof marketSettings?.runnerLastSeenAt === 'string' ? marketSettings.runnerLastSeenAt : null,
			launchPhase: typeof marketSettings?.launchPhase === 'string' ? marketSettings.launchPhase : null,
			lastSuccessfulPhase: typeof marketSettings?.lastSuccessfulPhase === 'string' ? marketSettings.lastSuccessfulPhase : null,
			githubRepository: typeof marketSettings?.githubRepository === 'string' ? marketSettings.githubRepository : null,
			workflowBootstrapReady: marketSettings?.workflowBootstrapReady === true,
			currentWorkstreamId: branchRole === 'feature' ? branchName : null,
			verificationPosture: typeof marketSettings?.launchPhase === 'string' && marketSettings.launchPhase === 'failed'
				? 'blocked'
				: 'pending',
			approvalBlockers: Array.isArray(marketSettings?.approvalBlockers) ? marketSettings.approvalBlockers.map(String) : [],
		},
			managedServices: {
				api: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
				workdayManager: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
				workerRunner: { enabled: false, initialized: false, lastDeploymentTimestamp: null, lastDeployedUrl: null, provider: null },
			},
		files: {
			Config: tenantRoot,
			machineConfig: existsSync(configPath),
			machineKey: existsSync(keyPath),
		},
		secrets: {
			keyAgentRunning: keyStatus.running,
			keyAgentUnlocked: keyStatus.unlocked,
			wrappedKeyPresent: keyStatus.wrappedKeyPresent,
			migrationRequired: keyStatus.migrationRequired,
			idleTimeoutMs: keyStatus.idleTimeoutMs,
			idleRemainingMs: keyStatus.idleRemainingMs,
			startupPassphraseConfigured: Boolean(process.env.TREESEED_KEY_PASSPHRASE?.trim()),
		},
		releaseReady,
		releaseHistory,
		readiness: {
			local: { ready: false, blockers: [], warnings: [] },
			staging: { ready: false, blockers: [], warnings: [] },
			prod: { ready: false, blockers: [], warnings: [] },
		},
		rollbackCandidates: [],
		recommendations: [],
	};

	if (tenantRoot) {
		try {
			const deployConfig = loadPlatformConfig({ tenantRoot: effectiveCwd, environment: workflowEnvironmentForBranchRole(branchRole), env: options.env ?? process.env }).deployConfig;
			const environmentContext = collectEnvironmentContext(effectiveCwd);
			const statusConfigByScope = Object.fromEntries(
				(['local', 'staging', 'prod'] as const).map((scope) => [
					scope,
					collectStatusConfigScope(effectiveCwd, scope, environmentContext, options.env),
				]),
			) as Record<'local' | 'staging' | 'prod', ReturnType<typeof collectStatusConfigScope>>;
			state.providerStatus = Object.fromEntries(
				(['local', 'staging', 'prod'] as const).map((scope) => [
					scope,
					providerStatusForScope(effectiveCwd, scope, statusConfigByScope[scope], options),
				]),
			) as WorkflowProviderStatus;
			const sharedConfigValues = statusConfigByScope.prod.resolvedValues;
			const runtimeMode = deployConfig.runtime?.mode ?? 'none';
			const runtimeRegistration = deployConfig.runtime?.registration ?? 'none';
			const webCachePolicy = resolveWebCachePolicy(deployConfig);
			const registrationRequired = runtimeRegistration === 'required';
			const registrationEnabled = runtimeRegistration === 'required' || runtimeRegistration === 'optional';
			const runtimeSessionReady = Boolean(
				marketSettings?.runnerReady === true
				|| (typeof runnerSession?.accessToken === 'string' && runnerSession.accessToken.length > 0),
			);
			state.auth.gh = state.auth.gh || Boolean(resolveGitHubToken(statusConfigByScope.local.values))
				|| Boolean(resolveGitHubToken(statusConfigByScope.staging.values))
				|| Boolean(resolveGitHubToken(statusConfigByScope.prod.values));
			state.auth.wrangler = state.auth.wrangler || hasStatusConfigValue(statusConfigByScope, 'TREESEED_CLOUDFLARE_API_TOKEN');
			state.auth.railway = state.auth.railway || hasStatusConfigValue(statusConfigByScope, 'TREESEED_RAILWAY_API_TOKEN');
			state.auth.copilot = state.auth.copilot || state.auth.gh;
			state.marketConnection.baseUrl = state.marketConnection.baseUrl
				?? sharedConfigValues.TREESEED_API_BASE_URL
				?? deployConfig.runtime?.marketBaseUrl
				?? deployConfig.hosting?.marketBaseUrl
				?? null;
			state.marketConnection.teamId = state.marketConnection.teamId
				?? sharedConfigValues.TREESEED_HOSTING_TEAM_ID
				?? deployConfig.runtime?.teamId
				?? deployConfig.hosting?.teamId
				?? null;
			state.marketConnection.projectId = state.marketConnection.projectId
				?? sharedConfigValues.TREESEED_PROJECT_ID
				?? deployConfig.runtime?.projectId
				?? deployConfig.hosting?.projectId
				?? null;
			state.marketConnection.hubMode = deployConfig.hub?.mode ?? null;
			state.marketConnection.runtimeMode = runtimeMode;
			state.marketConnection.runtimeRegistration = runtimeRegistration;
			state.marketConnection.runtimeAttached = runtimeMode !== 'none' && (!registrationEnabled || state.marketConnection.configured);
			state.marketConnection.runtimeReady = runtimeMode === 'none' || !registrationEnabled || runtimeSessionReady;
			state.marketConnection.runnerReady = runtimeSessionReady;
			state.webCache.webHost = deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl ?? null;
			state.webCache.contentHost = sharedConfigValues.TREESEED_CONTENT_PUBLIC_BASE_URL ?? deployConfig.cloudflare.r2?.publicBaseUrl ?? null;
			state.webCache.sourcePagePolicy = `browser=${webCachePolicy.sourcePages.browserTtlSeconds}s edge=${webCachePolicy.sourcePages.edgeTtlSeconds}s swr=${webCachePolicy.sourcePages.staleWhileRevalidateSeconds}s sie=${webCachePolicy.sourcePages.staleIfErrorSeconds}s`;
			state.webCache.contentPagePolicy = `browser=${webCachePolicy.contentPages.browserTtlSeconds}s edge=${webCachePolicy.contentPages.edgeTtlSeconds}s swr=${webCachePolicy.contentPages.staleWhileRevalidateSeconds}s sie=${webCachePolicy.contentPages.staleIfErrorSeconds}s`;
			state.webCache.r2ObjectPolicy = `browser=${webCachePolicy.r2PublishedObjects.browserTtlSeconds}s edge=${webCachePolicy.r2PublishedObjects.edgeTtlSeconds}s swr=${webCachePolicy.r2PublishedObjects.staleWhileRevalidateSeconds}s sie=${webCachePolicy.r2PublishedObjects.staleIfErrorSeconds}s`;
			state.marketConnection.configured = registrationRequired
				? Boolean(state.marketConnection.baseUrl && state.marketConnection.projectId)
				: state.marketConnection.configured;
			const localStatusUrl = resolveLocalStatusUrl(deployConfig);
			for (const scope of ['local', 'staging', 'prod'] as const) {
				const deployState = loadDeployState(effectiveCwd, deployConfig, { target: createPersistentDeployTarget(scope) });
				const validation = statusConfigByScope[scope].validation;
				const rawValidationProblems = [...validation.missing, ...validation.invalid];
				const statusValidationProblems = scope === 'local'
					? rawValidationProblems.filter((problem) => !isCloudflareProviderProblem(problem))
					: rawValidationProblems;
				const validationProblems = statusValidationProblems.map((problem) => problem.message);
				const statusValidationOk = statusValidationProblems.length === 0;
				const persistentBlockers = Array.isArray(deployState.readiness?.blockers)
					? deployState.readiness.blockers.map(String)
					: [];
				const persistentWarnings = Array.isArray(deployState.readiness?.warnings)
					? deployState.readiness.warnings.map(String)
					: [];
				const configured = scope === 'local'
					? statusValidationOk
					: deployState.readiness?.configured === true && statusValidationOk;
				const provisioned = scope === 'local'
					? true
					: configured && deployState.readiness?.provisioned === true;
				const deployable = scope === 'local'
					? statusValidationOk
					: configured && deployState.readiness?.deployable === true;
				const initialized = deployState.readiness?.initialized === true || scope === 'local';
				state.persistentEnvironments[scope] = {
					initialized,
					phase: statusValidationOk
						? (scope === 'local'
							? 'code_ready'
							: provisioned
								? 'provisioned'
								: configured
									? 'config_complete'
									: initialized
										? 'config_complete'
										: 'pending')
						: 'config_incomplete',
					configured,
					provisioned,
					deployable,
					blockers: [
						...validationProblems,
						...persistentBlockers,
					],
					warnings: persistentWarnings,
					lastValidatedAt: deployState.readiness?.lastValidatedAt ?? deployState.readiness?.initializedAt ?? null,
					lastDeploymentTimestamp: scope === 'local' ? null : (deployState.lastDeploymentTimestamp ?? null),
					lastDeployedUrl: scope === 'local' ? localStatusUrl : (deployState.lastDeployedUrl ?? null),
				};
				if (scope !== 'local') {
					const history = Array.isArray((deployState as { deploymentHistory?: unknown[] }).deploymentHistory)
						? ((deployState as { deploymentHistory?: Array<Record<string, unknown>> }).deploymentHistory ?? [])
						: [];
					const latestHistory = history.at(-1) ?? null;
					state.rollbackCandidates.push({
						scope,
						commit: typeof latestHistory?.commit === 'string' ? latestHistory.commit : (deployState.lastDeployedCommit ?? null),
						timestamp: typeof latestHistory?.timestamp === 'string' ? latestHistory.timestamp : (deployState.lastDeploymentTimestamp ?? null),
						url: typeof latestHistory?.url === 'string' ? latestHistory.url : (deployState.lastDeployedUrl ?? null),
					});
				}
				if (scope === 'prod') {
					state.webCache.cloudflareRulesManaged = deployState.webCache?.rulesManaged === true;
					state.webCache.lastDeployPurgeAt = deployState.webCache?.deployPurge?.lastPurgedAt ?? null;
					state.webCache.lastDeployPurgeCount = deployState.webCache?.deployPurge?.purgeCount ?? null;
					state.webCache.lastContentPurgeAt = deployState.webCache?.contentPurge?.lastPurgedAt ?? null;
					state.webCache.lastContentPurgeCount = deployState.webCache?.contentPurge?.purgeCount ?? null;
				}
						for (const serviceKey of ['api', 'workdayManager', 'workerRunner']) {
							const service = deployState.services?.[serviceKey];
							if (!service) continue;
							state.managedServices[serviceKey] = {
						enabled: service.enabled === true,
						initialized: service.initialized === true,
						lastDeploymentTimestamp: service.lastDeploymentTimestamp ?? null,
						lastDeployedUrl: service.lastDeployedUrl ?? service.publicBaseUrl ?? null,
						provider: service.provider ?? null,
					};
				}
			}

			if (branchRole === 'feature' && branchName) {
				const previewState = loadDeployState(effectiveCwd, deployConfig, { target: createBranchPreviewDeployTarget(branchName) });
				state.preview = {
					enabled: previewState.previewEnabled === true || previewState.readiness?.initialized === true,
					url: previewState.lastDeployedUrl ?? null,
					lastDeploymentTimestamp: previewState.lastDeploymentTimestamp ?? null,
				};
			}
		} catch {
			// Leave deployment state unresolved when the tenant config cannot be loaded yet.
		}
	}

	state.readiness.local = readinessForEnvironment(state, 'local');
	state.readiness.staging = readinessForEnvironment(state, 'staging');
	state.readiness.prod = readinessForEnvironment(state, 'prod');
	for (const scope of ['local', 'staging', 'prod'] as const) {
		const persistent = state.persistentEnvironments[scope];
		const readiness = state.readiness[scope];
		state.environmentStatus[scope] = {
			phase: persistent.phase,
			ready: readiness.ready,
			configured: persistent.configured,
			initialized: persistent.initialized,
			provisioned: persistent.provisioned,
			deployable: persistent.deployable,
			lastValidatedAt: persistent.lastValidatedAt,
			lastDeploymentTimestamp: persistent.lastDeploymentTimestamp,
			lastDeployedUrl: persistent.lastDeployedUrl,
			blockers: readiness.blockers,
			warnings: readiness.warnings,
		};
	}
	state.marketConnection.verificationPosture = state.readiness.local.ready
		? 'ready'
		: state.files.machineConfig
			? 'blocked'
			: 'pending';
	const registrationRequired = state.marketConnection.runtimeRegistration === 'required';
	state.marketConnection.approvalBlockers = [
		...(registrationRequired && !state.marketConnection.configured ? ['TreeSeed runtime attachment is not configured.'] : []),
		...(registrationRequired && !state.marketConnection.runtimeReady ? ['TreeSeed runtime credential is missing or not ready.'] : []),
	];
	state.recommendations = recommendNextSteps(state);
	return state;
}
