import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
	compileTreeseedDesiredResourceGraph,
	compileTreeseedDesiredUnitsFromGraph,
} from '../platform/desired-state.ts';
import {
	collectTreeseedReconcileStatus,
	planTreeseedReconciliation,
	reconcileTreeseedTarget,
	type TreeseedDesiredUnit,
	type TreeseedReconcileSelector,
	type TreeseedReconcileTarget,
} from '../reconcile/index.ts';
import {
	applyTreeseedEnvironmentToProcess,
	applyTreeseedConfigValues,
	applyTreeseedSafeRepairs,
	assertTreeseedCommandEnvironment,
	checkTreeseedProviderConnections,
	collectTreeseedConfigContext,
	collectTreeseedConfigSeedValues,
	collectTreeseedPrintEnvReport,
	createDefaultTreeseedMachineConfig,
	ensureTreeseedSecretSessionForConfig,
	ensureTreeseedActVerificationTooling,
	ensureTreeseedGitignoreEntries,
	inspectTreeseedPassphraseEnvDiagnostic,
	finalizeTreeseedConfig,
	getTreeseedMachineConfigPaths,
	inspectTreeseedKeyAgentStatus,
	loadTreeseedMachineConfig,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedMachineEnvironmentValues,
	resolveTreeseedRemoteSession,
	rotateTreeseedMachineKey,
	setTreeseedRemoteSession,
	writeTreeseedMachineConfig,
} from '../operations/services/config-runtime.ts';
import { createTreeseedManagedToolEnv, formatTreeseedDependencyFailureDetails, installTreeseedDependencies, resolveTreeseedToolBinary } from '../managed-dependencies.ts';
import { ControlPlaneClient } from '../control-plane-client.ts';
import { exportTreeseedCodebase } from '../operations/services/export-runtime.ts';
import {
	assertDeploymentInitialized,
	buildProvisioningSummary,
	cleanupDestroyedState,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	destroyCloudflareResources,
	destroyTreeseedEnvironmentResources,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
	purgeSourcePageCaches,
	recordHostedDeploymentState,
	resolveConfiguredSurfaceDomain,
	runRemoteD1Migrations,
	validateDeployPrerequisites,
	validateDestroyPrerequisites,
} from '../operations/services/deploy.ts';
import {
	assertCleanWorktree,
	assertCleanWorktrees,
	assertFeatureBranch,
	branchExists,
	checkoutBranch,
	checkoutDetachedOriginBranch,
	checkoutNewTaskBranchWithChanges,
	checkoutTaskBranchFromStaging,
	createDeprecatedTaskTag,
	deleteLocalBranch,
	deleteRemoteBranch,
	deleteRemoteBranchIfMerged,
	inspectMergedRemoteTaskBranches,
	ensureLocalBranchTracking,
	gitWorkflowRoot,
	headCommit,
	listTaskBranches,
	mergeBranchDownIntoFeature,
	mergeBranchIntoTarget,
	prepareReleaseBranches,
	PRODUCTION_BRANCH,
	promoteCommitToBranchWithExpectedHead,
	pushBranch,
	reattachDetachedHeadIfSafe,
	remoteHeadCommit,
	remoteBranchExists,
	STAGING_BRANCH,
	syncBranchWithOrigin,
} from '../operations/services/git-workflow.ts';
import { resolveGitHubRepositorySlug } from '../operations/services/github-automation.ts';
import { resolveGitHubCredentialForRepository } from '../operations/services/github-credentials.ts';
import {
	formatGitHubActionsGateFailure,
	inspectGitHubActionsVerification,
	isRetryableGitHubActionsSetupFailure,
	rerunGitHubActionsFailedJobs,
	skippedGitHubActionsGate,
	waitForGitHubActionsGate,
	type GitHubActionsVerificationTarget,
	type GitHubActionsWorkflowGate,
	type GitHubActionsVerificationReport,
} from '../operations/services/github-actions-verification.ts';
import { cleanProofLedger } from '../operations/services/release-proof-ledger.ts';
import type { TreeseedProofDriver } from '../operations/services/release-proof.ts';
import { buildTreeseedProofPlan, hostedWorkflowForPackage, summarizeTreeseedProofLedger } from '../operations/services/release-proof-planner.ts';
import { runTreeseedProof } from '../operations/services/release-proof-runner.ts';
import { createTreeseedWorkflowTimer, slowestTreeseedWorkflowPhases, type TreeseedWorkflowTiming } from '../operations/services/workflow-timing.ts';
import {
	collectReleaseHistoryCommits,
	renderAdministrativeCommitMessage,
	upsertReleaseChangelog,
	type ReleaseHistoryCommit,
	type ReleaseHistorySummary,
} from '../operations/services/release-history.ts';
import { packageScriptPath, resolveWranglerBin } from '../operations/services/runtime-tools.ts';
import { loadTreeseedPlatformConfig } from '../platform/config.ts';
import { runTenantDeployPreflight, runWorkspaceReleasePreflight, runWorkspaceSavePreflight } from '../operations/services/save-deploy-preflight.ts';
import { collectCliPreflight } from '../operations/services/workspace-preflight.ts';
import {
	collectMergeConflictReport,
	collectPublicPackageReleaseLineState,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	highestStableGitTagOnLine,
	incrementVersion,
	originRemoteUrl,
	planWorkspaceReleaseBump,
	repoRoot,
} from '../operations/services/workspace-save.ts';
import {
	planRepositorySave,
	refreshAndValidateRootWorkspaceLockfileForSave,
	repositorySaveErrorDetails,
	runRepositorySaveOrchestrator,
	type RepositorySaveReport,
	type SaveCommitMessageMode,
	type SaveDevVersionStrategy,
	type SaveVerifyMode,
	type ReleaseBumpLevel,
} from '../operations/services/repository-save-orchestrator.ts';
import { discoverTreeseedPackageAdapters } from '../operations/services/package-adapters.ts';
import {
	assertNoInternalDevReferences,
	collectInternalDevReferenceIssues,
	rewriteProjectInternalDependenciesToStableVersions,
} from '../operations/services/package-reference-policy.ts';
import {
	ensureLocalWorkspaceLinks,
	inspectWorkspaceDependencyMode,
	unlinkLocalWorkspaceLinks,
	type WorkspaceLinksMode,
} from '../operations/services/workspace-dependency-mode.ts';
import {
	hasCompleteTreeseedPackageCheckout,
	changedWorkspacePackages,
	publishableWorkspacePackages,
	run,
	sortWorkspacePackages,
	workspacePackages,
	workspaceRoot,
} from '../operations/services/workspace-tools.ts';
import { classifyTreeseedGitMode, runTreeseedGit, runTreeseedGitOk, runTreeseedGitText } from '../operations/services/git-runner.ts';
import { runTreeseedHostingAudit, type TreeseedHostingAuditEnvironment } from '../operations/services/hosting-audit.ts';
import { collectTreeseedHostedServiceChecks } from '../operations/services/hosted-service-checks.ts';
import { collectTreeseedDeploymentReadiness } from '../operations/services/deployment-readiness.ts';
import { collectTreeseedLiveHostedServiceChecks } from '../operations/services/live-hosted-service-checks.ts';
import {
	configuredRailwayServices,
	waitForRailwayManagedDeploymentsSettled,
} from '../operations/services/railway-deploy.ts';
import { discoverTreeseedApplications } from '../hosting/apps.ts';
import { compileTreeseedHostingGraph } from '../hosting/graph.ts';
import { resolveTreeseedWorkflowState, type TreeseedWorkflowStatusOptions } from '../workflow-state.ts';
import { createTreeseedReconcileRegistry, deriveTreeseedDesiredUnits, destroyTreeseedTargetUnits, filterTreeseedDesiredUnitsByBootstrapSystems, resolveTreeseedBootstrapSelection, type TreeseedReconcileResult } from '../reconcile/index.ts';
import {
	acquireWorkflowLock,
	archiveWorkflowRun,
	cacheWorkflowGateResult,
	classifyWorkflowRunJournal,
	classifyWorkflowRunJournals,
	createWorkflowRunJournal,
	generateWorkflowRunId,
	getCachedSuccessfulWorkflowGate,
	inspectWorkflowLock,
	listInterruptedWorkflowRuns,
	listWorkflowRunJournals,
	readWorkflowRunJournal,
	refreshWorkflowLock,
	releaseWorkflowLock,
	updateWorkflowRunJournal,
	type TreeseedWorkflowRunCommand,
	type TreeseedWorkflowRunJournal,
	type TreeseedWorkflowRunStep,
} from './runs.ts';
import {
	checkedOutWorkspacePackageRepos,
	resolveTreeseedWorkflowSession,
	type TreeseedWorkflowMode,
	type TreeseedWorkflowSession,
} from './session.ts';
import { checkedOutManagedWorkflowRepos, type TreeseedManagedRepository } from '../operations/services/managed-repositories.ts';
import { runTreeseedLocalCleanup } from '../operations/services/local-cleanup.ts';
import { runTreeseedGuarantees } from '../guarantees/index.ts';
import {
	classifyTreeseedBranchRole,
	resolveTreeseedWorkflowPaths,
} from './policy.ts';
import {
	effectiveWorkflowWorktreeMode,
	ensureManagedWorkflowWorktree,
	isManagedWorkflowWorktree,
	managedWorkflowWorktreeMetadata,
	plannedManagedWorkflowWorktreePath,
	removeManagedWorkflowWorktree,
} from './worktrees.ts';
import type {
	TreeseedCloseInput,
	TreeseedCiInput,
	TreeseedConfigInput,
	TreeseedDestroyInput,
	TreeseedExportInput,
	TreeseedReleaseCandidateInput,
	TreeseedReleaseInput,
	TreeseedRecoverInput,
	TreeseedResumeInput,
	TreeseedSaveInput,
	TreeseedStageInput,
	TreeseedSwitchInput,
	TreeseedTaskBranchMetadata,
	TreeseedTasksInput,
	TreeseedUpdateInput,
	TreeseedWorkflowContext,
	TreeseedWorkflowCiMode,
	TreeseedWorkflowDevInput,
	TreeseedWorkflowExecutionMode,
	TreeseedWorkflowFact,
	TreeseedWorkflowNextStep,
	TreeseedWorkflowOperationId,
	TreeseedWorkflowRecovery,
	TreeseedWorkflowResult,
	TreeseedWorkflowWorktreeMode,
	TreeseedReleaseCandidateMode,
	TreeseedProofInput,
} from '../workflow.ts';

type WorkflowWrite = NonNullable<TreeseedWorkflowContext['write']>;
type WorkflowStatePayload = ReturnType<typeof resolveTreeseedWorkflowState>;
type ReleaseCandidateMode = TreeseedReleaseCandidateMode;

export type TreeseedWorkflowErrorCode =
	| 'validation_failed'
	| 'merge_conflict'
	| 'missing_runtime_auth'
	| 'deployment_timeout'
	| 'confirmation_required'
	| 'unsupported_transport'
	| 'unsupported_state'
	| 'workflow_locked'
	| 'resume_unavailable'
	| 'workflow_contract_missing'
	| 'github_workflow_failed'
	| 'github_auth_unavailable'
	| 'release_gate_failed'
	| 'hosted_reconcile_failed'
	| 'hosted_live_verification_failed';

export class TreeseedWorkflowError extends Error {
	code: TreeseedWorkflowErrorCode;
	operation: TreeseedWorkflowOperationId;
	details?: Record<string, unknown>;
	exitCode?: number;

	constructor(
		operation: TreeseedWorkflowOperationId,
		code: TreeseedWorkflowErrorCode,
		message: string,
		options: { details?: Record<string, unknown>; exitCode?: number } = {},
	) {
		super(message);
		this.name = 'TreeseedWorkflowError';
		this.operation = operation;
		this.code = code;
		this.details = options.details;
		this.exitCode = options.exitCode;
	}
}

export type WorkflowOperationHelpers = {
	context: TreeseedWorkflowContext;
	cwd(): string;
	write: WorkflowWrite;
	runStatus(): Promise<TreeseedWorkflowResult<ReturnType<typeof resolveTreeseedWorkflowState>>>;
	runTasks(): Promise<TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[] }>>;
};

function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

function runGit(args: string[], options: { cwd: string; capture?: boolean; timeoutMs?: number; maxBuffer?: number }) {
	return runTreeseedGitText(args, {
		cwd: options.cwd,
		mode: classifyTreeseedGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

function shouldManageWorkspaceLinks(mode: WorkspaceLinksMode | undefined, env: NodeJS.ProcessEnv | undefined = process.env) {
	if (mode === 'off') return false;
	const envMode = String(env?.TREESEED_WORKSPACE_LINKS ?? 'auto').trim().toLowerCase();
	return envMode !== 'off' && envMode !== 'false' && envMode !== '0';
}

function ensureWorkflowWorkspaceLinks(root: string, helpers: WorkflowOperationHelpers, mode: WorkspaceLinksMode | undefined = 'auto') {
	if (!shouldManageWorkspaceLinks(mode, helpers.context.env)) {
		return inspectWorkspaceDependencyMode(root, { mode: 'off', env: helpers.context.env });
	}
	const report = ensureLocalWorkspaceLinks(root, { mode, env: helpers.context.env });
	if (report.created.length > 0) {
		helpers.write(`[workspace][link] Linked ${report.created.length} local workspace package paths.`);
	}
	ensureWorkflowWorkspacePackageArtifacts(root, helpers);
	ensureWorkflowCommandBins(root, helpers);
	return report;
}

function readPackageScript(root: string, packageDir: string, scriptName: string) {
	try {
		const packageJson = JSON.parse(readFileSync(resolve(root, packageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
		const scripts = packageJson.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
			? packageJson.scripts as Record<string, unknown>
			: null;
		const script = scripts?.[scriptName];
		return typeof script === 'string' && script.trim() ? script : null;
	} catch {
		return null;
	}
}

function ensureWorkflowWorkspacePackageArtifacts(root: string, helpers: WorkflowOperationHelpers) {
	const packages = [
		{ name: '@treeseed/sdk', dir: 'packages/sdk', artifacts: ['dist/index.js', 'dist/workflow-support.js', 'dist/plugin-default.js', 'dist/platform/env.yaml'] },
		{ name: '@treeseed/ui', dir: 'packages/ui', artifacts: ['dist/index.js'] },
		{ name: '@treeseed/agent', dir: 'packages/agent', artifacts: ['dist/api/index.js', 'dist/services/manager.js', 'dist/provider/runner.js'] },
		{ name: '@treeseed/core', dir: 'packages/core', artifacts: ['dist/plugin-default.js'] },
		{ name: '@treeseed/admin', dir: 'packages/admin', artifacts: ['dist/plugin.js'] },
		{ name: '@treeseed/cli', dir: 'packages/cli', artifacts: ['dist/cli/main.js'] },
	];
	for (const entry of packages) {
		const packageDir = resolve(root, entry.dir);
		if (!existsSync(resolve(packageDir, 'package.json'))) continue;
		if (!readPackageScript(root, entry.dir, 'build:dist')) continue;
		const missing = entry.artifacts.filter((artifact) => !existsSync(resolve(packageDir, artifact)));
		if (missing.length === 0) continue;
		helpers.write(`[workspace][build] Building ${entry.name} artifacts for local workspace links.`);
		run('npm', ['--prefix', packageDir, 'run', 'build:dist'], { cwd: root });
	}
}

function ensureWorkflowCommandBins(root: string, helpers: WorkflowOperationHelpers) {
	const cliBin = resolve(root, 'node_modules/@treeseed/cli/dist/cli/main.js');
	if (!existsSync(cliBin)) return;
	const binDir = resolve(root, 'node_modules/.bin');
	mkdirSync(binDir, { recursive: true });
	for (const name of ['trsd', 'treeseed']) {
		const linkPath = resolve(binDir, name);
		const target = relative(dirname(linkPath), cliBin) || cliBin;
		try {
			const stat = lstatSync(linkPath);
			if (stat.isSymbolicLink()) {
				const currentTarget = readlinkSync(linkPath);
				if (currentTarget === target || resolve(dirname(linkPath), currentTarget) === cliBin) {
					continue;
				}
				rmSync(linkPath, { force: true });
			} else {
				continue;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		symlinkSync(target, linkPath);
		helpers.write(`[workspace][link] Linked ${name} command shim.`);
	}
}

function unresolvedMergePaths(repoDir: string) {
	return runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function resolveRootReleaseSubmoduleConflicts(root: string, selectedPackageNames: Set<string>) {
	const gitRoot = repoRoot(root);
	const packages = checkedOutWorkspacePackageRepos(root)
		.filter((pkg) => selectedPackageNames.has(pkg.name))
		.map((pkg) => ({
			...pkg,
			repoPath: relative(gitRoot, pkg.dir),
		}));
	const packagePaths = new Set(packages.map((pkg) => pkg.repoPath));
	const unresolved = unresolvedMergePaths(gitRoot);
	if (unresolved.length === 0 || unresolved.some((filePath) => !packagePaths.has(filePath))) {
		return {
			resolved: false,
			allUnresolvedPathsWerePackagePointers: unresolved.length > 0 && unresolved.every((filePath) => packagePaths.has(filePath)),
			unresolvedPaths: unresolved,
			entries: [],
		};
	}
	const entries: Array<Record<string, unknown>> = [];
	for (const pkg of packages) {
		syncBranchWithOrigin(pkg.dir, PRODUCTION_BRANCH);
		runGit(['add', pkg.repoPath], { cwd: gitRoot });
		entries.push({
			packageName: pkg.name,
			path: pkg.repoPath,
			targetBranch: PRODUCTION_BRANCH,
			resolvedCommit: headCommit(pkg.dir),
		});
	}
	return {
		resolved: true,
		allUnresolvedPathsWerePackagePointers: true,
		unresolvedPaths: unresolved,
		entries,
	};
}

function unlinkWorkflowWorkspaceLinks(root: string, helpers: WorkflowOperationHelpers, mode: WorkspaceLinksMode | undefined = 'auto') {
	if (!shouldManageWorkspaceLinks(mode, helpers.context.env)) {
		return inspectWorkspaceDependencyMode(root, { mode: 'off', env: helpers.context.env });
	}
	const report = unlinkLocalWorkspaceLinks(root, { mode, env: helpers.context.env, preserveOperatorLinks: true });
	if (report.removed.length > 0) {
		helpers.write(`[workspace][unlink] Removed ${report.removed.length} local workspace package links for deployment install.`);
	}
	if (report.preserved.length > 0) {
		helpers.write(`[workspace][unlink] Preserved ${report.preserved.length} operator workspace links so local trsd tooling remains available.`);
	}
	return report;
}

function normalizeCiMode(mode: TreeseedWorkflowCiMode | undefined, operation: 'save' | 'release') {
	if (mode === 'hosted' || mode === 'off') return mode;
	return operation === 'save' ? 'off' : 'hosted';
}

export function normalizeSaveLane(lane: TreeseedSaveInput['lane'] | undefined) {
	const value = lane ?? process.env.TREESEED_SAVE_LANE;
	return value === 'promotion' ? 'promotion' : 'fast';
}

function normalizeSceneArtifactsMode(value: unknown): 'full' | 'screenshots' {
	return value === 'screenshots' ? 'screenshots' : 'full';
}

function maybeRunLocalWorkflowCleanup(
	helpers: WorkflowOperationHelpers,
	root: string,
	operation: 'save' | 'stage' | 'release',
	input: { skipCleanup?: boolean; sceneArtifacts?: 'full' | 'screenshots'; plan?: boolean },
) {
	if (operation !== 'release') return null;
	if (normalizeExecutionMode(input) === 'plan' || input.skipCleanup === true) return null;
	helpers.write('Treeseed release cleanup: pruning disposable local build state while preserving package caches and release evidence.', 'stderr');
	return runTreeseedLocalCleanup({ root, mode: 'standard', docker: false, npmCache: false });
}

export function normalizeSaveCiMode(mode: TreeseedWorkflowCiMode | undefined, branch: string | null | undefined, lane: 'fast' | 'promotion' = 'fast') {
	if (mode === 'hosted' || mode === 'off') return mode;
	if (lane === 'promotion') return branch === STAGING_BRANCH || branch === PRODUCTION_BRANCH ? 'hosted' : 'off';
	return 'off';
}

function normalizeSaveVerifyMode(mode: TreeseedSaveInput['verifyMode'] | undefined): SaveVerifyMode {
	switch (mode) {
		case 'skip':
		case 'fast':
		case undefined:
			return 'skip';
		case 'local':
		case 'local-only':
			return 'local-only';
		case 'hosted':
			return 'skip';
		case 'both':
		case 'action-first':
			return 'action-first';
		default:
			return 'skip';
	}
}

export function normalizeReleaseCandidateMode(
	mode: TreeseedSaveInput['releaseCandidate'] | undefined,
	operation: Extract<TreeseedWorkflowOperationId, 'save' | 'stage' | 'release'>,
	lane: 'fast' | 'promotion' = 'fast',
): ReleaseCandidateMode {
	const value = mode ?? process.env.TREESEED_RELEASE_CANDIDATE_MODE;
	if (value === 'hybrid' || value === 'strict' || value === 'skip') {
		return value;
	}
	return operation === 'save' ? 'skip' : 'strict';
}

export function shouldUseHostedSaveCi(input: TreeseedSaveInput, branch: string | null | undefined, lane: 'fast' | 'promotion' = normalizeSaveLane(input.lane)) {
	void input;
	void branch;
	void lane;
	return false;
}

function worktreePayload(root: string, requestedMode?: TreeseedWorkflowWorktreeMode) {
	const metadata = managedWorkflowWorktreeMetadata(root);
	return {
		worktreeMode: requestedMode ?? 'auto',
		managedWorktree: metadata,
		worktreePath: metadata?.worktreePath ?? null,
		primaryRoot: metadata?.primaryRoot ?? null,
	};
}

function helpersForCwd(helpers: WorkflowOperationHelpers, cwd: string): WorkflowOperationHelpers {
	return {
		...helpers,
		context: {
			...helpers.context,
			cwd,
		},
		cwd: () => cwd,
	};
}

function shouldDispatchSwitchToManagedWorktree(root: string, input: TreeseedSwitchInput, env: NodeJS.ProcessEnv | undefined) {
	return !isManagedWorkflowWorktree(root)
		&& effectiveWorkflowWorktreeMode(input.worktreeMode, env) === 'on';
}

function assertHostedGitHubWorkflowCredentialsReady(
	operation: TreeseedWorkflowOperationId,
	root: string,
	gates: GitHubActionsWorkflowGate[],
) {
	const missing: Array<{ name: string; repository: string; envName: string }> = [];
	for (const gate of gates) {
		const repository = gate.repository ?? resolveGitHubRepositorySlug(gate.repoPath);
		const scope = gate.branch === PRODUCTION_BRANCH ? 'prod' : 'staging';
		const values = resolveTreeseedMachineEnvironmentValues(root, scope);
		const credential = resolveGitHubCredentialForRepository(repository, { values, env: process.env });
		if (!credential.token) {
			missing.push({ name: gate.name, repository: credential.repository, envName: credential.envName });
		}
	}
	if (missing.length === 0) return;
	workflowError(
		operation,
		'github_auth_unavailable',
		[
			'Treeseed hosted GitHub workflow gates require Treeseed-prefixed GitHub credentials.',
			...missing.map((gate) => `- ${gate.name}: configure ${gate.envName} for ${gate.repository}, or TREESEED_GITHUB_TOKEN as a fallback.`),
		].join('\n'),
		{ details: { missing } },
	);
}

async function waitForWorkflowGates(
	operation: TreeseedWorkflowOperationId,
	gates: GitHubActionsWorkflowGate[],
	ciMode: TreeseedWorkflowCiMode,
	options: { root?: string; runId?: string; onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void } = {},
) {
	if (ciMode === 'off' || process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return gates.map((gate) => skippedGitHubActionsGate(gate, 'disabled'));
	}
	if (gates.length === 0) {
		return [];
	}
	if (operation === 'save' && gates.every((gate) => !gate.repository && githubRepositoryForRepo(gate.repoPath) == null)) {
		return gates.map((gate) => skippedGitHubActionsGate(gate, 'non-github-repository'));
	}
	assertHostedGitHubWorkflowCredentialsReady(operation, options.root ?? gates[0]!.repoPath, gates);
	const results: Array<Record<string, unknown>> = [];
	for (const gate of gates) {
		const gateWithTimeout = {
			...gate,
			timeoutSeconds: gate.timeoutSeconds ?? HOSTED_WORKFLOW_GATE_TIMEOUT_SECONDS,
		};
		if (options.root && options.runId) {
			const cached = getCachedSuccessfulWorkflowGate(options.root, options.runId, {
				repository: gateWithTimeout.repository ?? null,
				workflow: gateWithTimeout.workflow,
				headSha: gateWithTimeout.headSha,
				branch: gateWithTimeout.branch,
			});
			if (cached) {
				results.push({
					...cached.result,
					name: gateWithTimeout.name,
					cached: true,
				});
				continue;
			}
		}
		const gateEnv = githubWorkflowGateEnv(options.root, gateWithTimeout);
		let result = await waitForGitHubActionsGate(gateWithTimeout, {
			operation,
			env: gateEnv,
			onProgress: options.onProgress,
		});
		if (result.status === 'completed' && result.conclusion !== 'success' && isRetryableGitHubActionsSetupFailure(result)) {
			const retry = await rerunGitHubActionsFailedJobs(result, gateEnv);
			options.onProgress?.(`[${operation}][gate][${gateWithTimeout.name}] Retrying GitHub-hosted setup failure once for run ${retry.runId}.`);
			result = await waitForGitHubActionsGate(gateWithTimeout, {
				operation,
				env: gateEnv,
				onProgress: options.onProgress,
			});
		}
		const normalized = {
			name: gateWithTimeout.name,
			...result,
			workflow: String(result.workflow ?? gateWithTimeout.workflow),
			branch: String(result.branch ?? gateWithTimeout.branch),
			headSha: String(result.headSha ?? gateWithTimeout.headSha),
			timeoutSeconds: gateWithTimeout.timeoutSeconds,
			cached: false,
		};
		if (normalized.status === 'completed' && normalized.conclusion !== 'success') {
			workflowError(operation, 'github_workflow_failed', formatGitHubActionsGateFailure(gateWithTimeout, normalized), {
				details: { gate: gateWithTimeout, workflow: normalized },
			});
		}
		if (options.root && options.runId && normalized.status === 'completed' && normalized.conclusion === 'success') {
			cacheWorkflowGateResult(options.root, options.runId, normalized);
		}
		results.push(normalized);
	}
	return results;
}

function githubWorkflowGateEnv(root: string | undefined, gate: GitHubActionsWorkflowGate) {
	if (!root) return process.env;
	try {
		const repository = gate.repository ?? resolveGitHubRepositorySlug(gate.repoPath);
		const scope = gate.branch === PRODUCTION_BRANCH ? 'prod' : 'staging';
		const values = resolveTreeseedMachineEnvironmentValues(root, scope);
		const credential = resolveGitHubCredentialForRepository(repository, { values, env: process.env });
		if (!credential.token) return process.env;
		return {
			...process.env,
			TREESEED_GITHUB_TOKEN: credential.token,
			GH_TOKEN: credential.token,
			GITHUB_TOKEN: credential.token,
		};
	} catch {
		return process.env;
	}
}

const HOSTED_DEPLOY_GATE_TIMEOUT_SECONDS = 45 * 60;
const HOSTED_WORKFLOW_GATE_TIMEOUT_SECONDS = 45 * 60;

function hostedDeployGate(gate: GitHubActionsWorkflowGate): GitHubActionsWorkflowGate {
	return {
		...gate,
		timeoutSeconds: gate.timeoutSeconds ?? HOSTED_DEPLOY_GATE_TIMEOUT_SECONDS,
	};
}

function saveHostedEnvironmentForBranch(branch: string | null | undefined) {
	if (branch === STAGING_BRANCH) return 'staging' as const;
	if (branch === PRODUCTION_BRANCH) return 'prod' as const;
	return null;
}

function selectorFromWorkflowHostingGraph(graph: ReturnType<typeof compileTreeseedHostingGraph>): TreeseedReconcileSelector {
	const includesApi = graph.units.some((unit) => unit.id === 'api' || unit.config.serviceName === 'treeseed-api');
	const scope = graph.environment;
	const target = createPersistentDeployTarget(scope);
	const webDomain = resolveConfiguredSurfaceDomain(graph.deployConfig, target, 'web');
	const apiDomain = resolveConfiguredSurfaceDomain(graph.deployConfig, target, 'api');
	const domainServiceIds = [
		webDomain,
		webDomain ? `web:${webDomain}` : null,
		apiDomain,
		apiDomain ? `api:${apiDomain}` : null,
	];
	return {
		host: [...new Set([
			...graph.units.map((unit) => unit.host.id),
			...(includesApi ? ['cloudflare-dns'] : []),
		].filter((hostId) => hostId !== 'smtp' && hostId !== 'local-process' && hostId !== 'local-docker'))],
		serviceId: [...new Set(graph.units.flatMap((unit) => [
			unit.id,
			typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null,
		]).concat(domainServiceIds).filter((value): value is string => Boolean(value)))],
		serviceType: [...new Set(graph.units.flatMap((unit) => {
			if (unit.id === 'api') return ['api-runtime', 'railway-service:api', 'custom-domain:api', 'dns-record'];
			if (unit.id === 'operationsRunner') return ['operations-runner-runtime', 'railway-service:operations-runner'];
			if (unit.placement === 'runner-capacity') return ['api-runtime', 'operations-runner-runtime', 'railway-service:api', 'railway-service:operations-runner'];
			if (unit.host.id === 'cloudflare') return ['web-ui', 'edge-worker', 'content-store', 'database', 'kv-form-guard', 'turnstile-widget', 'pages-project', 'custom-domain:web', 'dns-record'];
			return [];
		}))],
	};
}

async function reconcileSaveHostedEnvironment(
	root: string,
	environment: 'staging' | 'prod',
	helpers: WorkflowOperationHelpers,
	workflowRunId: string,
	operation: Extract<TreeseedWorkflowOperationId, 'save' | 'release'> = 'save',
	envOverlay: Record<string, string | undefined> = {},
	options: { liveAppId?: string } = {},
) {
	const target = createPersistentDeployTarget(environment);
	const env = {
		...helpers.context.env,
		...collectTreeseedConfigSeedValues(root, environment, helpers.context.env),
		...envOverlay,
	};
	const graph = compileTreeseedHostingGraph({ tenantRoot: root, environment, env });
	const selector = selectorFromWorkflowHostingGraph(graph);
	if (process.env.TREESEED_WORKFLOW_HOSTED_RECONCILE_MODE === 'skip') {
		return {
			status: 'skipped' as const,
			reason: 'disabled',
			environment,
			selectedApps: [...new Set(graph.units.map((unit) => unit.application?.id).filter((value): value is string => Boolean(value)))],
			selectedResources: graph.units.map((unit) => ({
				id: unit.id,
				host: unit.host.id,
				serviceType: unit.serviceType.id,
				placement: unit.placement,
				serviceName: typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null,
			})),
		};
	}
	const reconcileSession = new Map<string, unknown>([['workflowRunId', workflowRunId]]);
	helpers.write(`[${operation}][workflow] Reconciling ${environment} hosted deployments for ${graph.units.length} selected resources.`);
	const reconcile = await reconcileTreeseedTarget({
		tenantRoot: root,
		target,
		env,
		selector,
		planOnly: false,
		write: (line) => helpers.write(`[${operation}][reconcile] ${line}`, 'stderr'),
		session: reconcileSession,
	});
	const status = await collectTreeseedReconcileStatus({
		tenantRoot: root,
		target,
		env,
		selector,
		session: reconcileSession,
	});
	if (!status.ready) {
		workflowError(operation, 'hosted_reconcile_failed', `Hosted reconciliation for ${environment} did not verify:\n${status.blockers.join('\n')}`, {
			details: { environment, selector, status, reconcile },
		});
	}
	const selectedRailwayServiceNames = new Set(graph.units
		.filter((unit) => unit.host.id === 'railway')
		.map((unit) => typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null)
		.filter((value): value is string => Boolean(value)));
	const selectedRailwayServices = configuredRailwayServices(root, environment, env)
		.filter((service) => selectedRailwayServiceNames.has(service.serviceName));
	if (selectedRailwayServices.length > 0) {
		const deployments = await waitForRailwayManagedDeploymentsSettled(root, environment, {
			services: selectedRailwayServices,
			env,
			timeoutMs: operation === 'release' ? 900_000 : 600_000,
			onProgress: (line, stream) => helpers.write(`[${operation}][railway] ${line}`, stream),
		});
		if (!deployments.ok) {
			const deploymentFailures = deployments.checks
				.filter((check) => check.ok !== true && check.skipped !== true)
				.map((check) => `${check.serviceName ?? check.service}: ${check.message ?? check.status ?? 'deployment did not settle'}`);
			workflowError(operation, 'hosted_deployment_failed', `Hosted Railway deployments for ${environment} did not settle:\n${deploymentFailures.join('\n')}`, {
				details: { environment, selector, deployments, reconcile },
			});
		}
	}
	const live = await collectTreeseedLiveHostedServiceChecks({
		tenantRoot: root,
		target: environment,
		appId: options.liveAppId,
		strict: true,
		requireLiveRailway: true,
		requireLiveHttp: true,
		env,
	});
	const liveFailures = [
		...live.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
		...live.liveObservation.issues,
	];
	if (liveFailures.length > 0) {
		workflowError(operation, 'hosted_live_verification_failed', `Hosted live verification for ${environment} failed:\n${liveFailures.join('\n')}`, {
			details: { environment, selector, live, reconcile },
		});
	}
	return {
		status: 'reconciled' as const,
		environment,
		selectedApps: [...new Set(graph.units.map((unit) => unit.application?.id).filter((value): value is string => Boolean(value)))],
		selectedResources: graph.units.map((unit) => ({
			id: unit.id,
			host: unit.host.id,
			serviceType: unit.serviceType.id,
			placement: unit.placement,
			serviceName: typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null,
		})),
		reconcile,
		postApplyStatus: status,
		liveVerification: live,
	};
}

async function runReleaseWebLiveVerification(
	root: string,
	environment: 'prod',
	helpers: TreeseedWorkflowHelpers,
	operation: TreeseedWorkflowRunCommand,
) {
	if (process.env.TREESEED_WORKFLOW_RELEASE_GATES_MODE === 'skip') {
		return { status: 'skipped' as const, environment, reason: 'release gates disabled' };
	}
	const env = {
		...helpers.context.env,
		...collectTreeseedConfigSeedValues(root, environment, helpers.context.env),
	};
	let purge;
	try {
		purge = purgeSourcePageCaches(root, { target: environment, env });
	} catch (error) {
		workflowError(operation, 'hosted_live_verification_failed', `Production web cache purge failed before root live verification:\n${error instanceof Error ? error.message : String(error)}`, {
			details: { environment },
		});
	}
	if (purge?.skipped) {
		workflowError(operation, 'hosted_live_verification_failed', `Production web cache purge was skipped before root live verification: ${purge.reason ?? 'unknown reason'}`, {
			details: { environment, purge },
		});
	}
	helpers.write(`[${operation}][cloudflare] purged production source page cache for ${purge?.urls?.length ?? 0} urls before web live verification.`, 'stderr');
	const live = await collectTreeseedLiveHostedServiceChecks({
		tenantRoot: root,
		target: environment,
		appId: 'web',
		serviceKeys: ['web'],
		strict: true,
		requireLiveRailway: false,
		requireLiveHttp: true,
		env,
	});
	const liveFailures = [
		...live.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
		...live.liveObservation.issues,
	];
	if (liveFailures.length > 0) {
		workflowError(operation, 'hosted_live_verification_failed', `Production web live verification failed after root deployment:\n${liveFailures.join('\n')}`, {
			details: { environment, live },
		});
	}
	return live;
}

function productionReleaseImageRefEnv(selectedVersions: Map<string, string>) {
	const refs: Record<string, string> = {};
	const apiVersion = selectedVersions.get('@treeseed/api');
	if (apiVersion) {
		refs.TREESEED_API_IMAGE_REF = `treeseed/api:${apiVersion}`;
		refs.TREESEED_OPERATIONS_RUNNER_IMAGE_REF = `treeseed/op-runner:${apiVersion}`;
	}
	const agentVersion = selectedVersions.get('@treeseed/agent');
	if (agentVersion) {
		refs.TREESEED_AGENT_MANAGER_IMAGE_REF = `treeseed/agent-manager:${agentVersion}`;
		refs.TREESEED_AGENT_RUNNER_IMAGE_REF = `treeseed/agent-runner:${agentVersion}`;
	}
	const treedxVersion = selectedVersions.get('treedx') ?? selectedVersions.get('@treeseed/treedx');
	if (treedxVersion) {
		refs.TREESEED_PUBLIC_TREEDX_IMAGE_REF = `treeseed/treedx:${treedxVersion}`;
	}
	return refs;
}

function productionReleaseImageRefVersions(root: string, selectedVersions: Map<string, string>) {
	const versions = new Map(selectedVersions);
	for (const adapter of discoverTreeseedPackageAdapters(root)) {
		const prodSource = stringRecord(adapter.metadata.deploymentSource)?.prod;
		const imageBackedPackage = ['@treeseed/api', '@treeseed/agent', 'treedx', '@treeseed/treedx'].includes(adapter.id);
		if (prodSource !== 'image' && !imageBackedPackage) continue;
		if (versions.has(adapter.id) || !adapter.version) continue;
		const line = stableVersionLine(adapter.version);
		const stableVersion = (line ? highestStableGitTagOnLine(adapter.dir, line) : null) ?? adapter.version;
		versions.set(adapter.id, stableVersion);
	}
	for (const [packageName, relativePath] of [['@treeseed/api', 'packages/api'], ['@treeseed/agent', 'packages/agent']] as const) {
		if (versions.has(packageName)) continue;
		const packageRoot = resolve(root, relativePath);
		const packageJsonPath = resolve(packageRoot, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const version = stringRecord(JSON.parse(readFileSync(packageJsonPath, 'utf8'))).version;
		if (typeof version !== 'string') continue;
		const line = stableVersionLine(version);
		versions.set(packageName, (line ? highestStableGitTagOnLine(packageRoot, line) : null) ?? version);
	}
	return versions;
}

function stableVersionLine(version: string) {
	const match = version.match(/^(\d+\.\d+)\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
	return match?.[1] ?? null;
}

async function runReleaseProductionGuarantees(
	root: string,
	helpers: WorkflowOperationHelpers,
	operation: Extract<TreeseedWorkflowOperationId, 'release'>,
	sceneArtifacts?: 'full' | 'screenshots',
) {
	const environment = 'prod';
	if (process.env.TREESEED_WORKFLOW_RELEASE_GATES_MODE === 'skip') {
		return { ok: true, status: 'skipped' as const, environment, reason: 'release gates disabled' };
	}
	const env = {
		...helpers.context.env,
		...collectTreeseedConfigSeedValues(root, environment, helpers.context.env),
	};
	env.TREESEED_ACCEPTANCE_SERVICE_ID ??= env.TREESEED_API_WEB_SERVICE_ID ?? env.TREESEED_WEB_SERVICE_ID;
	env.TREESEED_ACCEPTANCE_SERVICE_SECRET ??= env.TREESEED_API_WEB_SERVICE_SECRET ?? env.TREESEED_WEB_SERVICE_SECRET;
	if (!env.TREESEED_ACCEPTANCE_SERVICE_ID || !env.TREESEED_ACCEPTANCE_SERVICE_SECRET) {
		workflowError(operation, 'release_gate_failed', 'Final production release guarantees cannot run because production acceptance service credentials are missing.', {
			details: {
				environment,
				missing: [
					!env.TREESEED_ACCEPTANCE_SERVICE_ID ? 'TREESEED_ACCEPTANCE_SERVICE_ID' : null,
					!env.TREESEED_ACCEPTANCE_SERVICE_SECRET ? 'TREESEED_ACCEPTANCE_SERVICE_SECRET' : null,
				].filter((value): value is string => Boolean(value)),
			},
		});
	}
	helpers.write(`[${operation}][workflow] Running final production release guarantees against the fully deployed production environment.`);
	return await withContextEnv(env, async () => {
		const report = await runTreeseedGuarantees({
			workspaceRoot: root,
			filter: { gate: 'smoke', status: 'active' },
			environment,
			evidenceTarget: 'release',
			sceneArtifacts,
		});
		if (!report.ok) {
			const diagnostics = report.diagnostics
				.filter((entry) => entry.severity === 'error')
				.slice(0, 20)
				.map((entry) => `${entry.code}: ${entry.message}${entry.sourcePath ? ` (${entry.sourcePath})` : ''}`);
			const failedGuarantees = report.results
				.filter((entry) => entry.status === 'failed' || entry.status === 'blocked')
				.slice(0, 20)
				.map((entry) => `${entry.id}: ${entry.status}`);
			workflowError(operation, 'release_gate_failed', [
				'Final production release guarantees failed after production deployment.',
				...failedGuarantees,
				...diagnostics,
				failedGuarantees.length === 0 && diagnostics.length === 0 ? `See ${report.outputRoot}` : null,
			].filter((line): line is string => Boolean(line)).join('\n'), {
				details: { environment, outputRoot: report.outputRoot, counts: report.counts, diagnostics: report.diagnostics },
			});
		}
		return {
			ok: report.ok,
			environment: report.environment,
			runId: report.runId,
			outputRoot: report.outputRoot,
			counts: report.counts,
		};
	});
}

function recordHostedDeploymentStatesFromRootGates(
	root: string,
	rootRelease: Record<string, unknown> | null | undefined,
	workflowGates: unknown,
) {
	const gates = Array.isArray(workflowGates)
		? workflowGates.map((gate) => stringRecord(gate)).filter((gate): gate is Record<string, unknown> => Boolean(gate))
		: [];
	const releaseRecord = stringRecord(rootRelease) ?? {};
	const reports: Array<Record<string, unknown>> = [];
	const releaseTag = typeof releaseRecord.rootVersion === 'string' ? releaseRecord.rootVersion : null;
	for (const target of [
		{ scope: 'staging' as const, branch: STAGING_BRANCH, commit: releaseRecord.stagingCommit },
		{ scope: 'prod' as const, branch: releaseTag ?? PRODUCTION_BRANCH, commit: releaseRecord.releasedCommit },
	]) {
		const gate = gates.find((candidate) =>
			candidate.workflow === 'deploy.yml'
			&& candidate.branch === target.branch
			&& candidate.status === 'completed'
			&& candidate.conclusion === 'success');
		const timestamp = typeof gate?.updatedAt === 'string' && gate.updatedAt.trim() ? gate.updatedAt : null;
		if (!gate || !timestamp) {
			continue;
		}
		const state = recordHostedDeploymentState(root, {
			scope: target.scope,
			commit: typeof target.commit === 'string' ? target.commit : null,
			timestamp,
			workflow: gate.workflow,
			runId: gate.runId ?? null,
		});
		reports.push({
			scope: target.scope,
			branch: target.branch,
			commit: typeof target.commit === 'string' ? target.commit : null,
			timestamp: state.lastDeploymentTimestamp ?? timestamp,
			url: state.lastDeployedUrl ?? null,
			workflow: gate.workflow,
			runId: gate.runId ?? null,
		});
	}
	return reports;
}

function ensureTreeseedCommandReadiness(root: string) {
	if (process.env.TREESEED_COMMAND_READINESS_MODE === 'skip') {
		return {
			status: 'skipped',
			reason: 'disabled',
			checks: [],
			missing: [],
		};
	}
	const checks = [
		{ id: 'sdk', path: resolve(root, 'node_modules/@treeseed/sdk/package.json') },
		{ id: 'sdk-workflow-support', path: resolve(root, 'node_modules/@treeseed/sdk/dist/workflow-support.js') },
		{ id: 'core', path: resolve(root, 'node_modules/@treeseed/core/package.json') },
		{ id: 'agent-api', path: resolve(root, 'node_modules/@treeseed/agent/dist/api/index.js') },
		{ id: 'cli', path: resolve(root, 'node_modules/@treeseed/cli/package.json') },
		{ id: 'cli-entrypoint', path: resolve(root, 'node_modules/@treeseed/cli/dist/cli/main.js') },
		{ id: 'trsd-bin', path: resolve(root, 'node_modules/.bin/trsd') },
	];
	const missing = checks.filter((check) => !existsSync(check.path));
	const report = {
		status: missing.length === 0 ? 'passed' : 'failed',
		checks: checks.map((check) => ({ ...check, exists: existsSync(check.path) })),
		missing,
	};
	if (missing.length > 0) {
		workflowError('save', 'validation_failed', `Treeseed save restored workspace links, but command readiness failed.\n${missing.map((check) => `${check.id}: ${check.path}`).join('\n')}`, {
			details: report,
		});
	}
	return report;
}

function ensureTreeseedLocalStateExcluded(root: string) {
	const gitDir = runTreeseedGit(['rev-parse', '--git-dir'], { cwd: root, mode: 'read', allowFailure: true }).stdout.trim();
	if (!gitDir) return;
	const excludePath = resolve(root, gitDir, 'info', 'exclude');
	const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
	const requiredEntries = ['/.treeseed/config/', '/.treeseed/workflow/', '/.treeseed/state/', '/.treeseed/workspace-links.json'];
	const missing = requiredEntries.filter((entry) => !current.split(/\r?\n/u).includes(entry));
	if (missing.length === 0) return;
	mkdirSync(dirname(excludePath), { recursive: true });
	writeFileSync(
		excludePath,
		`${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${missing.join('\n')}\n`,
		'utf8',
	);
}

function workflowError(
	operation: TreeseedWorkflowOperationId,
	code: TreeseedWorkflowErrorCode,
	message: string,
	options: { details?: Record<string, unknown>; exitCode?: number } = {},
): never {
	throw new TreeseedWorkflowError(operation, code, message, options);
}

function ageDays(lastCommitDate: string) {
	const timestamp = Date.parse(lastCommitDate);
	if (!Number.isFinite(timestamp)) return null;
	return Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
}

async function withContextEnv<T>(env: NodeJS.ProcessEnv | undefined, action: () => T | Promise<T>): Promise<T> {
	if (!env) {
		return await action();
	}

	const previous = new Map<string, string | undefined>();
	for (const [key, value] of Object.entries(env)) {
		previous.set(key, process.env[key]);
		if (value === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = value;
		}
	}

	try {
		return await action();
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) {
				delete process.env[key];
			} else {
				process.env[key] = value;
			}
		}
	}
}

function runNodeScript(scriptName: string, context: TreeseedWorkflowContext, cwd: string, label: string) {
	const result = spawnSync(process.execPath, [packageScriptPath(scriptName)], {
		cwd,
		env: { ...process.env, ...(context.env ?? {}) },
		stdio: 'inherit',
	});
	if (result.status !== 0) {
		throw new Error(`${label} failed.`);
	}
	return result;
}

function renderWorkflowStep(step: TreeseedWorkflowNextStep): TreeseedWorkflowNextStep {
	return step;
}

function normalizeConfigScopes(input: TreeseedConfigInput) {
	const requested = Array.isArray(input.target)
		? input.target
		: Array.isArray(input.environment)
			? input.environment
			: typeof input.target === 'string'
				? [input.target]
				: typeof input.environment === 'string'
					? [input.environment]
					: ['all'];

	if (requested.includes('all')) {
		return ['local', 'staging', 'prod'] as Array<'local' | 'staging' | 'prod'>;
	}

	return ['local', 'staging', 'prod'].filter((scope) => requested.includes(scope as never)) as Array<'local' | 'staging' | 'prod'>;
}

function resolveWorkflowStateSnapshot(cwd: string) {
	return resolveTreeseedWorkflowState(cwd);
}

function resolveProjectRootOrThrow(operation: TreeseedWorkflowOperationId, cwd: string) {
	const resolved = resolveTreeseedWorkflowPaths(cwd);
	if (!resolved.tenantRoot) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires a Treeseed project. Run the command from inside a tenant or initialize one first.`);
	}
	return resolved.cwd;
}

function resolveRepoState(repoDir: string) {
	const branchName = currentBranch(repoDir) || null;
	return {
		repoDir,
		branchName,
		branchRole: classifyTreeseedBranchRole(branchName, repoDir),
		dirtyWorktree: gitStatusPorcelain(repoDir).length > 0,
	};
}

type WorkflowRepoReport = {
	name: string;
	path: string;
	branch: string | null;
	dirty: boolean;
	created: boolean;
	resumed: boolean;
	merged: boolean;
	verified: boolean;
	committed: boolean;
	pushed: boolean;
	deletedLocal: boolean;
	deletedRemote: boolean;
	tagName: string | null;
	commitSha: string | null;
	skippedReason: string | null;
	publishWait: Record<string, unknown> | null;
	workflowGates: Array<Record<string, unknown>>;
	backMerge: Record<string, unknown> | null;
	changelog?: Record<string, unknown> | null;
	adminCommitSummary?: Record<string, unknown> | null;
};

function createRepoReport(name: string, path: string, branch: string | null, dirty: boolean): WorkflowRepoReport {
	return {
		name,
		path,
		branch,
		dirty,
		created: false,
		resumed: false,
		merged: false,
		verified: false,
		committed: false,
		pushed: false,
		deletedLocal: false,
		deletedRemote: false,
		tagName: null,
		commitSha: branch ? headCommit(path) : null,
		skippedReason: null,
		publishWait: null,
		workflowGates: [],
		backMerge: null,
	};
}

function createWorkspaceRootRepoReport(root: string) {
	const gitRoot = repoRoot(root);
	return createRepoReport('@treeseed/market', gitRoot, currentBranch(gitRoot) || null, hasMeaningfulChanges(gitRoot));
}

function createWorkspacePackageReports(root: string) {
	return checkedOutWorkspacePackageRepos(root).map((pkg) =>
		createRepoReport(pkg.name, pkg.dir, currentBranch(pkg.dir) || null, hasMeaningfulChanges(pkg.dir)));
}

function createManagedWorkflowRepoReports(root: string) {
	return checkedOutManagedWorkflowRepos(root).map((repo) =>
		createRepoReport(repo.name, repo.dir, currentBranch(repo.dir) || null, hasMeaningfulChanges(repo.dir)));
}

function findReportByName(reports: WorkflowRepoReport[], name: string) {
	return reports.find((report) => report.name === name) ?? null;
}

function findReportByPath(reports: WorkflowRepoReport[], path: string) {
	return reports.find((report) => report.path === path) ?? null;
}

function assertWorkspaceClean(root: string) {
	const repoDirs = [repoRoot(root), ...checkedOutManagedWorkflowRepos(root).map((repo) => repo.dir)];
	assertCleanWorktrees(repoDirs);
	return repoDirs;
}

function buildWorkflowResult<TPayload>(
	operation: TreeseedWorkflowOperationId,
	cwd: string,
	payload: TPayload,
	options: {
		nextSteps?: TreeseedWorkflowNextStep[];
		executionMode?: TreeseedWorkflowExecutionMode;
		runId?: string | null;
		summary?: string;
		facts?: TreeseedWorkflowFact[];
		recovery?: TreeseedWorkflowRecovery | null;
		errors?: Array<{ code: string; message: string; details?: Record<string, unknown> | null }>;
		includeFinalState?: boolean;
		timing?: TreeseedWorkflowTiming;
	} = {},
): TreeseedWorkflowResult<TPayload & { finalState?: WorkflowStatePayload; timing?: TreeseedWorkflowTiming }> {
	const timing = options.timing ?? createTreeseedWorkflowTimer().finish();
	const resolvedPayload = (options.includeFinalState ?? true)
		? {
			...(payload as Record<string, unknown>),
			timing,
			finalState: resolveWorkflowStateSnapshot(cwd),
		}
		: {
			...(payload as Record<string, unknown>),
			timing,
		};
	return {
		schemaVersion: 1,
		kind: 'treeseed.workflow.result',
		command: operation,
		executionMode: options.executionMode ?? 'execute',
		runId: options.runId ?? null,
		ok: true,
		operation,
		summary: options.summary,
		facts: options.facts,
		payload: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload; timing?: TreeseedWorkflowTiming },
		result: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload; timing?: TreeseedWorkflowTiming },
		nextSteps: options.nextSteps,
		recovery: options.recovery ?? null,
		errors: options.errors ?? [],
	};
}

type WorkflowApplicationSelection = {
	selected: string[];
	skipped: Array<{ appId: string; reason: string }>;
	reasons: Array<{ appId: string; reason: string }>;
	source: 'changed-paths' | 'package-selection' | 'default';
};

function parseGitStatusChangedPaths(status: string) {
	return status
		.split('\n')
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => {
			const value = line.slice(3).trim();
			return value.includes(' -> ') ? value.split(' -> ').at(-1)!.trim() : value;
		})
		.filter(Boolean);
}

function availableWorkflowAppIds(root: string) {
	try {
		const ids = discoverTreeseedApplications(root).map((app) => app.id);
		return ids.length > 0 ? ids : ['web'];
	} catch {
		return ['web'];
	}
}

function selectWorkflowApplications(root: string, input: {
	packageSelection?: { selected?: string[]; changed?: string[]; dependents?: string[] };
	changedPaths?: string[];
} = {}): WorkflowApplicationSelection {
	const available = availableWorkflowAppIds(root);
	const availableSet = new Set(available);
	const selected = new Set<string>();
	const reasons: Array<{ appId: string; reason: string }> = [];
	const add = (appId: string, reason: string) => {
		if (!availableSet.has(appId)) return;
		selected.add(appId);
		reasons.push({ appId, reason });
	};
	const packages = [
		...(input.packageSelection?.selected ?? []),
		...(input.packageSelection?.changed ?? []),
		...(input.packageSelection?.dependents ?? []),
	];
	const appByPackage = new Map(discoverTreeseedApplications(root)
		.filter((app) => app.relativeRoot.startsWith('packages/'))
		.map((app) => [`@treeseed/${app.relativeRoot.slice('packages/'.length).split('/')[0]}`, app.id]));
	for (const packageName of packages) {
		if (packageName === '@treeseed/api' || packageName === '@treeseed/treedx' || packageName === '@treeseed/agent') {
			add('api', `${packageName} changed`);
		} else if (packageName === '@treeseed/core' || packageName === '@treeseed/ui' || packageName === '@treeseed/admin') {
			add('web', `${packageName} changed`);
		} else if (packageName === '@treeseed/sdk' || packageName === '@treeseed/cli') {
			add('web', `${packageName} is shared`);
			add('api', `${packageName} is shared`);
		}
		const packageAppId = appByPackage.get(packageName);
		if (packageAppId) add(packageAppId, `${packageName} owns ${packageAppId}`);
	}

	const changedPaths = input.changedPaths ?? parseGitStatusChangedPaths(gitStatusPorcelain(root));
	const appByPackagePath = new Map(discoverTreeseedApplications(root)
		.filter((app) => app.relativeRoot.startsWith('packages/'))
		.map((app) => [app.relativeRoot, app.id]));
	for (const file of changedPaths) {
		if (file.startsWith('packages/api/') || file === 'packages/api') {
			add('api', `${file} is API-owned`);
		} else if (file.startsWith('packages/treedx/') || file === 'packages/treedx') {
			add('api', `${file} is TreeDX implementation`);
		} else if (file.startsWith('packages/core/') || file.startsWith('packages/ui/') || file.startsWith('packages/admin/') || file.startsWith('src/') || file.startsWith('content/') || file.startsWith('public/') || file === 'treeseed.site.yaml') {
			add('web', `${file} is web-owned`);
		} else if (file.startsWith('packages/sdk/') || file.startsWith('packages/cli/') || file === 'package.json' || file === 'package-lock.json' || file.startsWith('.github/')) {
			add('web', `${file} is shared workflow/config`);
			add('api', `${file} is shared workflow/config`);
		}
		for (const [packageRoot, appId] of appByPackagePath) {
			if (file === packageRoot || file.startsWith(`${packageRoot}/`)) {
				add(appId, `${file} is ${appId}-owned`);
			}
		}
	}

	const source: WorkflowApplicationSelection['source'] = packages.length > 0
		? 'package-selection'
		: changedPaths.length > 0
			? 'changed-paths'
			: 'default';
	const finalSelected = selected.size > 0
		? available.filter((appId) => selected.has(appId))
		: available;
	return {
		selected: finalSelected,
		skipped: available
			.filter((appId) => !finalSelected.includes(appId))
			.map((appId) => ({ appId, reason: 'No changed files or selected packages target this application.' })),
		reasons,
		source,
	};
}

function singleSelectedWorkflowAppId(selection: WorkflowApplicationSelection) {
	return selection.selected.length === 1 ? selection.selected[0] : undefined;
}

async function workflowHostedVerificationGateRequired(
	operation: TreeseedWorkflowOperationId,
	root: string,
	helpers: WorkflowOperationHelpers,
	environment: TreeseedHostingAuditEnvironment,
	options: { enabled: boolean; strict?: boolean; live?: boolean; appId?: string } = { enabled: true },
) {
	if (!options.enabled) return null;
	const target = environment === 'prod' ? 'prod' : environment === 'local' ? 'local' : 'staging';
	const readiness = collectTreeseedDeploymentReadiness({
		tenantRoot: root,
		environment: target,
		appId: options.appId,
	});
	if (options.strict && !readiness.ok) {
		const failures = readiness.checks
			.filter((check) => check.status === 'failed')
			.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`);
		workflowError(operation, 'validation_failed', `Deployment readiness failed for ${target}:\n${failures.join('\n')}`, {
			details: { readiness },
		});
	}
	workflowError(operation, 'validation_failed', `Hosted live verification for ${target} is reconciler-owned. Use stage/release release-gate:hosted-reconcile and release-gate:live-verify resources, or run trsd reconcile verify with a hosted selector.`, {
		details: {
			readiness,
			live: options.live === true,
			appId: options.appId ?? null,
		},
	});
}

function normalizeExecutionMode(input: { plan?: boolean } | undefined): TreeseedWorkflowExecutionMode {
	return input?.plan === true ? 'plan' : 'execute';
}

function submodulePointerForRef(repoDir: string, ref: string, relativeDir: string) {
	try {
		const output = runGit(['ls-tree', ref, relativeDir], { cwd: repoDir, capture: true }).trim();
		if (!output) {
			return null;
		}
		const match = output.match(/^[0-9]{6}\s+commit\s+([0-9a-f]{40})\t/u);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

function ensureLocalReadinessOrThrow(operation: TreeseedWorkflowOperationId, tenantRoot: string) {
	const state = resolveWorkflowStateSnapshot(tenantRoot);
	if (!state.readiness.local.ready) {
		workflowError(
			operation,
			'validation_failed',
			[
				`Treeseed ${operation} requires the local environment to be configured.`,
				...state.readiness.local.blockers,
				'Run `treeseed config --environment local` first.',
			].join('\n'),
			{ details: { readiness: state.readiness.local } },
		);
	}
	return state;
}

function planRootPackageVersion(root: string, level: string) {
	const packageJsonPath = resolve(root, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
	return incrementVersion(String(packageJson.version ?? '0.0.0'), level);
}

function setRootPackageJsonVersion(root: string, version: string) {
	const packageJsonPath = resolve(root, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
	packageJson.version = version;
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	return String(packageJson.version);
}

function writeJsonFile(path: string, value: Record<string, unknown>) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function updatePackageLockRootVersion(root: string, version: string) {
	const packageLockPath = resolve(root, 'package-lock.json');
	if (!existsSync(packageLockPath)) return { status: 'skipped', reason: 'no package-lock.json' };
	const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8')) as Record<string, unknown>;
	let changed = false;
	if (packageLock.version !== version) {
		packageLock.version = version;
		changed = true;
	}
	const packages = packageLock.packages;
	if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
		const rootPackage = (packages as Record<string, unknown>)[''];
		if (rootPackage && typeof rootPackage === 'object' && !Array.isArray(rootPackage)) {
			if ((rootPackage as Record<string, unknown>).version !== version) {
				(rootPackage as Record<string, unknown>).version = version;
				changed = true;
			}
		}
	}
	if (changed) {
		writeJsonFile(packageLockPath, packageLock);
	}
	return { status: changed ? 'updated' : 'unchanged', path: 'package-lock.json' };
}

function applyStableWorkspaceVersionChanges(root: string, versions: Map<string, string>) {
	for (const target of [{ name: '@treeseed/market', dir: root }, ...workspacePackages(root).map((pkg) => ({ name: pkg.name, dir: pkg.dir }))]) {
		const packageJsonPath = resolve(target.dir, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
		let changed = false;
		const plannedVersion = versions.get(target.name);
		if (plannedVersion && packageJson.version !== plannedVersion) {
			packageJson.version = plannedVersion;
			changed = true;
		}
		for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
			const values = packageJson[field];
			if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
			for (const [dependencyName, version] of versions.entries()) {
				if (!(dependencyName in values)) continue;
				const dependencySpec = version;
				if (String((values as Record<string, unknown>)[dependencyName]) === dependencySpec) continue;
				(values as Record<string, unknown>)[dependencyName] = dependencySpec;
				changed = true;
			}
		}
		if (changed) {
			writeJsonFile(packageJsonPath, packageJson);
		}
	}
	rewriteProjectInternalDependenciesToStableVersions(root, versions);
}

function gitObjectCommit(repoDir: string, ref: string) {
	try {
		return runGit(['rev-list', '-n', '1', ref], { cwd: repoDir, capture: true }).trim() || null;
	} catch {
		return null;
	}
}

function remoteTagCommit(repoDir: string, tagName: string) {
	const output = runGit(['ls-remote', 'origin', `refs/tags/${tagName}`, `refs/tags/${tagName}^{}`], { cwd: repoDir, capture: true }).trim();
	if (!output) return null;
	const peeled = output.split('\n').find((line) => line.endsWith(`refs/tags/${tagName}^{}`));
	const direct = output.split('\n').find((line) => line.endsWith(`refs/tags/${tagName}`));
	return (peeled ?? direct)?.split(/\s+/u)[0] ?? null;
}

function releaseTagExists(repoDir: string, tagName: string) {
	if (gitObjectCommit(repoDir, tagName)) return true;
	try {
		return remoteTagCommit(repoDir, tagName) !== null;
	} catch {
		return false;
	}
}

function ensureReleaseTag(repoDir: string, tagName: string, commitSha: string, message?: string) {
	const localCommit = gitObjectCommit(repoDir, tagName);
	if (localCommit && localCommit !== commitSha) {
		throw new Error(`Release tag ${tagName} already exists locally at ${localCommit}, expected ${commitSha}.`);
	}
	if (!localCommit) {
		runGit(['tag', '-a', tagName, commitSha, '-m', message ?? `release: ${tagName}`], { cwd: repoDir });
	}
	const remoteCommit = remoteTagCommit(repoDir, tagName);
	if (remoteCommit && remoteCommit !== commitSha) {
		throw new Error(`Release tag ${tagName} already exists on origin at ${remoteCommit}, expected ${commitSha}.`);
	}
	if (!remoteCommit) {
		runGit(['push', 'origin', tagName], { cwd: repoDir });
	}
	return {
		tagName,
		local: localCommit ? 'existing' : 'created',
		remote: remoteCommit ? 'existing' : 'pushed',
	};
}

function promoteCommitToProductionBranch(repoDir: string, commitSha: string) {
	const expectedBefore = remoteBranchExists(repoDir, PRODUCTION_BRANCH) ? remoteHeadCommit(repoDir, PRODUCTION_BRANCH) : null;
	const lease = expectedBefore
		? `--force-with-lease=refs/heads/${PRODUCTION_BRANCH}:${expectedBefore}`
		: '--force-with-lease';
	runGit(['push', lease, 'origin', `${commitSha}:refs/heads/${PRODUCTION_BRANCH}`], { cwd: repoDir });
	const observed = remoteHeadCommit(repoDir, PRODUCTION_BRANCH);
	if (observed !== commitSha) {
		throw new Error(`Production promotion verification failed; expected ${commitSha}, observed ${observed}.`);
	}
	return {
		targetBranch: PRODUCTION_BRANCH,
		expectedBefore,
		commitSha,
		pushed: true,
		verified: true,
	};
}

function commitAllIfChanged(repoDir: string, message: string) {
	runGit(['add', '-A'], { cwd: repoDir });
	if (!hasMeaningfulChanges(repoDir)) {
		return { committed: false, commitSha: headCommit(repoDir) };
	}
	runGit(['commit', '-m', message], { cwd: repoDir });
	return { committed: true, commitSha: headCommit(repoDir) };
}

function releaseHistoryCommits(repoDir: string, sourceRef = `origin/${PRODUCTION_BRANCH}`, targetRef = 'HEAD') {
	try {
		return collectReleaseHistoryCommits(repoDir, sourceRef, targetRef);
	} catch {
		return [] as ReleaseHistoryCommit[];
	}
}

function versionLines(versions: Map<string, string> | null | undefined) {
	return [...(versions ?? new Map()).entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, version]) => `${name}: ${version}`);
}

function updateReleaseChangelog(repoDir: string, input: {
	version: string;
	sourceRef?: string;
	targetRef?: string;
	commits?: ReleaseHistoryCommit[];
	extraDependencyBullets?: string[];
}) {
	const sourceRef = input.sourceRef ?? `origin/${PRODUCTION_BRANCH}`;
	const targetRef = input.targetRef ?? 'HEAD';
	const commits = input.commits ?? releaseHistoryCommits(repoDir, sourceRef, targetRef);
	return upsertReleaseChangelog(repoDir, {
		version: input.version,
		sourceRef,
		targetRef,
		commits,
		extraBullets: input.extraDependencyBullets?.length
			? { Dependencies: input.extraDependencyBullets }
			: undefined,
	});
}

function releaseAdminMessage(input: {
	subject: string;
	version?: string | null;
	tagName?: string | null;
	sourceRef?: string;
	targetRef?: string;
	commits?: ReleaseHistoryCommit[];
	changelog?: ReleaseHistorySummary | null;
	extraLines?: string[];
}) {
	return renderAdministrativeCommitMessage({
		subject: input.subject,
		version: input.version,
		tagName: input.tagName,
		sourceRef: input.sourceRef ?? STAGING_BRANCH,
		targetRef: input.targetRef ?? PRODUCTION_BRANCH,
		commits: input.commits ?? [],
		changelog: input.changelog ?? null,
		extraLines: input.extraLines,
	});
}

function completedJournalStepData(root: string, runId: string, stepId: string) {
	const journal = readWorkflowRunJournal(root, runId);
	return stringRecord(journal?.steps.find((step) => step.id === stepId && step.status === 'completed')?.data);
}

function shouldResumeReleaseAtRootGates(root: string, runId: string) {
	const journal = readWorkflowRunJournal(root, runId);
	if (!journal || journal.command !== 'release') return false;
	const rootStep = journal.steps.find((step) => step.id === 'release-root');
	const gateStep = journal.steps.find((step) => step.id === 'release-root-gates');
	return rootStep?.status === 'completed' && gateStep?.status !== 'completed';
}

function createNextSteps(steps: TreeseedWorkflowNextStep[]) {
	return steps.map(renderWorkflowStep);
}

function createStatusResult(cwd: string, options: TreeseedWorkflowStatusOptions = {}): TreeseedWorkflowResult<ReturnType<typeof resolveTreeseedWorkflowState>> {
	const state = resolveTreeseedWorkflowState(cwd, options);
	return buildWorkflowResult('status', cwd, state, {
		nextSteps: createNextSteps(state.recommendations),
		includeFinalState: false,
	});
}

function normalizeCiScope(value: TreeseedCiInput['scope']): 'workspace' | 'root' | 'packages' {
	return value === 'root' || value === 'packages' ? value : 'workspace';
}

function normalizeCiLogLines(value: TreeseedCiInput['logLines']) {
	const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : 120;
	return Number.isFinite(parsed) ? Math.max(20, Math.min(1000, Math.floor(parsed))) : 120;
}

function normalizeCiWorkflows(input: TreeseedCiInput) {
	const raw = input.workflows ?? input.workflow ?? [];
	return (Array.isArray(raw) ? raw : [raw])
		.map((workflow) => String(workflow ?? '').trim())
		.filter(Boolean);
}

function defaultCiWorkflows(kind: 'root' | 'package', branch: string | null) {
	if (kind === 'package') {
		return ['verify.yml'];
	}
	if (branch === STAGING_BRANCH || branch === PRODUCTION_BRANCH) {
		return ['deploy.yml'];
	}
	return ['verify.yml'];
}

function packageCiWorkflowsForRepo(repoDir: string) {
	const adapters = discoverTreeseedPackageAdapters(workspaceRoot(repoDir));
	const adapter = adapters.find((candidate) => resolve(candidate.dir) === resolve(repoDir));
	return adapter ? [hostedWorkflowForPackage(adapter)] : null;
}

function githubRepositoryForRepo(repoDir: string) {
	try {
		return resolveGitHubRepositorySlug(repoDir);
	} catch {
		return null;
	}
}

function ciTargetForRepo(
	repo: { name: string; path: string; branchName: string | null },
	kind: 'root' | 'package',
	input: TreeseedCiInput,
	workflowOverrides: string[],
): GitHubActionsVerificationTarget {
	const branch = typeof input.branch === 'string' && input.branch.trim() ? input.branch.trim() : repo.branchName;
	const workflows = workflowOverrides.length > 0
		? workflowOverrides
		: kind === 'package'
			? packageCiWorkflowsForRepo(repo.path) ?? defaultCiWorkflows(kind, branch)
			: defaultCiWorkflows(kind, branch);
	return {
		name: repo.name,
		repoPath: repo.path,
		repository: githubRepositoryForRepo(repo.path),
		branch,
		headSha: branch ? headCommit(repo.path) : null,
		workflows,
		kind,
	};
}

function ciTargetsForSession(session: TreeseedWorkflowSession, input: TreeseedCiInput) {
	const scope = normalizeCiScope(input.scope);
	const workflows = normalizeCiWorkflows(input);
	const targets: GitHubActionsVerificationTarget[] = [];
	if (scope === 'workspace' || scope === 'root') {
		targets.push(ciTargetForRepo(session.rootRepo, 'root', input, workflows));
	}
	if (scope === 'workspace' || scope === 'packages') {
		targets.push(...session.packageRepos.map((repo) => ciTargetForRepo(repo, 'package', input, workflows)));
	}
	return { scope, targets };
}

async function createCiResult(cwd: string, input: TreeseedCiInput): Promise<TreeseedWorkflowResult<TreeseedCiResult>> {
	const session = resolveTreeseedWorkflowSession(cwd);
	const { scope, targets } = ciTargetsForSession(session, input);
	const strict = input.strict === true;
	const includeLogs = input.logs === true || input.includeLogs === true;
	const report = await inspectGitHubActionsVerification(targets, {
		includeLogs,
		logLines: normalizeCiLogLines(input.logLines),
	});
	const hasFailures = report.failures.length > 0;
	const hasPending = report.summary.pending > 0;
	const exitCode = hasFailures || (strict && hasPending) ? 1 : 0;
	const payload: TreeseedCiResult = {
		...report,
		mode: session.mode,
		branch: typeof input.branch === 'string' && input.branch.trim() ? input.branch.trim() : session.branchName,
		scope,
		strict,
		hasFailures,
		hasPending,
		exitCode,
	};
	return buildWorkflowResult('ci', cwd, payload, {
		includeFinalState: false,
		summary: hasFailures
			? 'Treeseed CI found remote GitHub Actions failures.'
			: strict && hasPending
				? 'Treeseed CI found pending remote GitHub Actions runs.'
				: 'Treeseed CI status is clear.',
	});
}

function createTasksResult(cwd: string): TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[]; workstreams: Array<{
	id: string;
	title: string;
	linkedDirectRefs: Array<{ model: 'objective' | 'question' | 'note'; id: string }>;
	branch: string;
	local: boolean;
	remote: boolean;
	current: boolean;
	previewUrl: string | null;
	lastSaveAt: string | null;
	verificationResult: 'ready' | 'needs_attention' | 'unknown';
	stagingCandidate: boolean;
	archived: boolean;
}> }> {
	const tenantRoot = cwd;
	const repoDir = gitWorkflowRoot(tenantRoot);
	const deployConfig = loadTreeseedPlatformConfig({ tenantRoot, environment: 'staging', env: process.env }).deployConfig;
	const dirty = gitStatusPorcelain(repoDir).length > 0;
	const tasks = listTaskBranches(repoDir).map((branch) => {
		const previewState = loadDeployState(tenantRoot, deployConfig, {
			target: createBranchPreviewDeployTarget(branch.name),
		});
		const packages = checkedOutWorkspacePackageRepos(tenantRoot).map((pkg) => {
			const packageBranches = listTaskBranches(pkg.dir);
			const match = packageBranches.find((candidate) => candidate.name === branch.name) ?? null;
			const pointer = submodulePointerForRef(repoDir, branch.name, pkg.relativeDir);
			return {
				name: pkg.name,
				path: pkg.relativeDir,
				local: match?.local === true,
				remote: match?.remote === true,
				current: match?.current === true,
				head: match?.head ?? null,
				pointer,
				aligned: pointer != null && match?.head != null ? pointer === match.head : match != null,
			};
		});
		return {
			...branch,
			ageDays: ageDays(branch.lastCommitDate),
			dirtyCurrent: branch.current && dirty,
			preview: {
				enabled: previewState.previewEnabled === true || previewState.readiness?.initialized === true,
				url: previewState.lastDeployedUrl ?? null,
				lastDeploymentTimestamp: previewState.lastDeploymentTimestamp ?? null,
			},
			packages,
		};
	});
	const workstreams = tasks.map((task) => ({
		id: task.name,
		title: task.name.replace(/^task\//u, '').replace(/[-_]+/gu, ' '),
		linkedDirectRefs: [],
		branch: task.name,
		local: task.local,
		remote: task.remote,
		current: task.current,
		previewUrl: task.preview.url,
		lastSaveAt: task.lastCommitDate ?? null,
		verificationResult: task.dirtyCurrent ? 'needs_attention' : task.head ? 'ready' : 'unknown',
		stagingCandidate: task.name === STAGING_BRANCH,
		archived: false,
	}));
	return buildWorkflowResult('tasks', cwd, { tasks, workstreams }, { includeFinalState: false });
}

function normalizeOptionalString(value: unknown) {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

async function connectTreeseedMarketProject(
	helpers: WorkflowOperationHelpers,
	tenantRoot: string,
	input: TreeseedConfigInput,
	context: {
		scopes: ReturnType<typeof normalizeConfigScopes>;
		sync: TreeseedConfigInput['sync'];
		repairs: unknown[];
		preflight: ReturnType<typeof collectCliPreflight>;
		toolHealth: ReturnType<typeof ensureTreeseedActVerificationTooling>;
	},
) {
	const machineConfig = loadTreeseedMachineConfig(tenantRoot) as Record<string, any>;
	const marketSettings = machineConfig.settings?.market && typeof machineConfig.settings.market === 'object'
		? machineConfig.settings.market as Record<string, unknown>
		: {};
	const remoteSettings = machineConfig.settings?.remote && typeof machineConfig.settings.remote === 'object'
		? machineConfig.settings.remote as Record<string, any>
		: { activeHostId: 'official', executionMode: 'prefer-local', hosts: [] };

	const baseUrl = normalizeOptionalString(input.marketBaseUrl)
		?? normalizeOptionalString(marketSettings.baseUrl)
		?? normalizeOptionalString(remoteSettings.hosts?.find?.((entry: Record<string, unknown>) => entry?.official === true)?.baseUrl)
		?? normalizeOptionalString(remoteSettings.hosts?.find?.((entry: Record<string, unknown>) => entry?.id === remoteSettings.activeHostId)?.baseUrl);
	if (!baseUrl) {
		workflowError(
			'config',
			'validation_failed',
			'Treeseed config --connect-market requires a market base URL. Pass --market-base-url or configure an authenticated remote host first.',
		);
	}

	const hostId = normalizeOptionalString(marketSettings.hostId) ?? 'treeseed-market';
	const activeRemoteSession = resolveTreeseedRemoteSession(tenantRoot, hostId)
		?? resolveTreeseedRemoteSession(tenantRoot, remoteSettings.activeHostId)
		?? resolveTreeseedRemoteSession(tenantRoot, 'official');
	const accessToken = normalizeOptionalString(input.marketAccessToken) ?? normalizeOptionalString(activeRemoteSession?.accessToken);
	if (!accessToken) {
		workflowError(
			'config',
			'validation_failed',
			'Treeseed config --connect-market requires a market access token. Authenticate to the TreeSeed control-plane first or pass --market-access-token.',
		);
	}

	const projectId = normalizeOptionalString(input.marketProjectId) ?? normalizeOptionalString(marketSettings.projectId);
	if (!projectId) {
		workflowError(
			'config',
			'validation_failed',
			'Treeseed config --connect-market requires --market-project-id or an existing settings.market.projectId value.',
		);
	}

	const teamId = normalizeOptionalString(input.marketTeamId) ?? normalizeOptionalString(marketSettings.teamId);
	const projectSlug = normalizeOptionalString(input.marketProjectSlug)
		?? normalizeOptionalString(marketSettings.projectSlug)
		?? normalizeOptionalString(machineConfig.project?.slug)
		?? projectId;
	const teamSlug = normalizeOptionalString(input.marketTeamSlug) ?? normalizeOptionalString(marketSettings.teamSlug);
	const projectApiBaseUrl = normalizeOptionalString(input.marketProjectApiBaseUrl) ?? normalizeOptionalString(marketSettings.projectApiBaseUrl);

	const client = new ControlPlaneClient({
		baseUrl,
		accessToken,
	});

	const connectionResult = await client.upsertProjectConnection(projectId, {
		mode: 'hybrid',
		projectApiBaseUrl,
		executionOwner: 'project_runner',
		metadata: {
			pairingSource: 'treeseed_config_connect_market',
			tenantRoot,
			tenantSlug: normalizeOptionalString(machineConfig.project?.slug),
			repoSlug: normalizeOptionalString(machineConfig.project?.slug),
			teamId,
			teamSlug,
			projectSlug,
			connectedAt: new Date().toISOString(),
		},
		rotateRunnerToken: input.rotateRunnerToken === true,
	});

	const hosts = Array.isArray(remoteSettings.hosts) ? [...remoteSettings.hosts] : [];
	const updatedHost = {
		id: hostId,
		label: 'TreeSeed',
		baseUrl,
		official: false,
	};
	const existingHostIndex = hosts.findIndex((entry) =>
		String(entry?.id ?? '') === hostId || String(entry?.baseUrl ?? '').replace(/\/+$/u, '') === baseUrl.replace(/\/+$/u, ''),
	);
	if (existingHostIndex >= 0) {
		hosts.splice(existingHostIndex, 1, {
			...hosts[existingHostIndex],
			...updatedHost,
		});
	} else {
		hosts.unshift(updatedHost);
	}

	if (normalizeOptionalString(input.marketAccessToken)) {
		setTreeseedRemoteSession(tenantRoot, {
			hostId,
			accessToken,
			refreshToken: activeRemoteSession?.refreshToken ?? '',
			expiresAt: activeRemoteSession?.expiresAt ?? '',
			principal: activeRemoteSession?.principal ?? null,
		});
	}

	const runnerHostId = `operations-runner:${projectId}`;
	if (connectionResult.runnerToken) {
		setTreeseedRemoteSession(tenantRoot, {
			hostId: runnerHostId,
			accessToken: connectionResult.runnerToken,
			refreshToken: '',
			expiresAt: '',
			principal: {
				id: `runner:${projectId}`,
				displayName: 'TreeSeed Project Runner',
				scopes: [],
				roles: ['project_runner'],
				permissions: [],
				metadata: { projectId },
			},
		});
	}

	machineConfig.settings.remote = {
		...remoteSettings,
		activeHostId: hostId,
		hosts,
	};
	machineConfig.settings.market = {
		baseUrl,
		hostId,
		teamId,
		teamSlug,
		projectId,
		projectSlug,
		projectApiBaseUrl: connectionResult.connection?.projectApiBaseUrl ?? projectApiBaseUrl ?? null,
		connectionMode: connectionResult.connection?.mode ?? 'hybrid',
		executionOwner: connectionResult.connection?.executionOwner ?? 'project_runner',
		runnerHostId,
		runnerReady: Boolean(connectionResult.runnerToken || resolveTreeseedRemoteSession(tenantRoot, runnerHostId)?.accessToken),
		runnerRegisteredAt: connectionResult.connection?.runnerRegisteredAt ?? null,
		runnerLastSeenAt: connectionResult.connection?.runnerLastSeenAt ?? null,
		launchPhase: null,
		lastSuccessfulPhase: null,
		githubRepository: null,
		workflowBootstrapReady: false,
		approvalBlockers: [],
		connectedAt: new Date().toISOString(),
	};
	writeTreeseedMachineConfig(tenantRoot, machineConfig);

	const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
	return buildWorkflowResult(
		'config',
		tenantRoot,
		{
			mode: 'connect-market',
			scopes: context.scopes,
			sync: context.sync,
			configPath,
			keyPath,
			repairs: context.repairs,
			preflight: context.preflight,
			toolHealth: context.toolHealth,
			market: machineConfig.settings.market,
			connection: connectionResult.connection,
			runnerTokenIssued: Boolean(connectionResult.runnerToken),
		},
		{
			summary: 'TreeSeed project pairing completed.',
			nextSteps: createNextSteps([
				{ operation: 'status', reason: 'Confirm the new market connection, runner health, and current workstream posture.' },
				{ operation: 'tasks', reason: 'Inspect the branch-backed workstreams that will now sync into the TreeSeed UI.' },
			]),
		},
	);
}

function maybePrint(write: WorkflowWrite, line: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!line) return;
	write(line, stream);
}

function ensureMessage(operation: TreeseedWorkflowOperationId, message: string | undefined, label: string) {
	const value = String(message ?? '').trim();
	if (!value) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires ${label}.`);
	}
	return value;
}

function toError(operation: TreeseedWorkflowOperationId, error: unknown): never {
	if (error instanceof TreeseedWorkflowError) {
		throw error;
	}
	if (error instanceof Error) {
		throw new TreeseedWorkflowError(operation, 'unsupported_state', error.message, {
			details: { name: error.name },
			exitCode: (error as { exitCode?: number }).exitCode,
		});
	}
	throw new TreeseedWorkflowError(operation, 'unsupported_state', String(error));
}

type ActiveWorkflowRun = {
	runId: string;
	session: TreeseedWorkflowSession;
	journal: TreeseedWorkflowRunJournal;
	resumed: boolean;
};

function workflowSessionSnapshot(session: TreeseedWorkflowSession): TreeseedWorkflowRunJournal['session'] {
	return {
		root: session.root,
		mode: session.mode,
		branchName: session.branchName,
		repos: [session.rootRepo, ...session.packageRepos].map((repo) => ({
			name: repo.name,
			path: repo.path,
			branchName: repo.branchName,
		})),
	};
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextPendingJournalStep(journal: TreeseedWorkflowRunJournal) {
	return journal.steps.find((step) => step.status === 'pending') ?? null;
}

function findAutoResumableSaveRun(root: string, branch: string | null) {
	if (!branch) return null;
	if (branch === STAGING_BRANCH
		&& (hasMeaningfulChanges(repoRoot(root)) || checkedOutWorkspacePackageRepos(root).some((repo) => hasMeaningfulChanges(repo.dir)))) {
		return null;
	}
	const currentHeads = Object.fromEntries([
		['@treeseed/market', runGit(['rev-parse', 'HEAD'], { cwd: repoRoot(root), capture: true }).trim()],
		...checkedOutWorkspacePackageRepos(root).map((repo) => [
			repo.name,
			runGit(['rev-parse', 'HEAD'], { cwd: repo.dir, capture: true }).trim(),
		] as const),
	]);
	return listInterruptedWorkflowRuns(root).find((journal) => {
		if (journal.command !== 'save' || !journal.resumable || journal.session.branchName !== branch) {
			return false;
		}
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch,
			currentHeads,
		});
		if (classification.state === 'resumable') {
			return true;
		}
		if (classification.state === 'stale') {
			archiveWorkflowRun(root, journal.runId, {
				...classification,
				reasons: ['save auto-resume skipped stale failed save', ...classification.reasons],
			});
		}
		return false;
	}) ?? null;
}

function workflowFileExists(repoPath: string, workflow: string) {
	return existsSync(resolve(repoPath, '.github', 'workflows', workflow));
}

type TreeseedDiscoveredPackageAdapter = ReturnType<typeof discoverTreeseedPackageAdapters>[number];

function hostedWorkflowsForSavedRepository(root: string, repo: RepositorySaveReport, adapter?: TreeseedDiscoveredPackageAdapter) {
	const workflows: string[] = [];
	const addWorkflow = (workflow: string | null | undefined) => {
		if (!workflow) return;
		const normalized = workflow.trim().replace(/^\.github\/workflows\//u, '');
		if (normalized && !workflows.includes(normalized)) {
			workflows.push(normalized);
		}
	};
	if (repo.branch === STAGING_BRANCH && existsSync(resolve(repo.path, 'treeseed.site.yaml')) && workflowFileExists(repo.path, 'deploy.yml')) {
		addWorkflow('deploy.yml');
	} else {
		const fallbackAdapter = adapter ?? new Map(discoverTreeseedPackageAdapters(root).map((entry) => [resolve(entry.dir), entry])).get(resolve(repo.path));
		const adapterWorkflow = packageHostedVerifyWorkflow(fallbackAdapter);
		addWorkflow(adapterWorkflow);
	}
	if (workflows.length === 0 && workflowFileExists(repo.path, 'verify.yml')) addWorkflow('verify.yml');
	return workflows;
}

function gatesForSavedRepositoryReports(root: string, reports: RepositorySaveReport[]) {
	const adapterByPath = new Map(discoverTreeseedPackageAdapters(root).map((adapter) => [resolve(adapter.dir), adapter]));
	return reports
		.filter((repo) => repo.pushed && repo.commitSha && repo.branch && (repo.committed || repo.tagName))
		.flatMap((repo) => {
			const adapter = adapterByPath.get(resolve(repo.path));
			return hostedWorkflowsForSavedRepository(root, repo, adapter).map((workflow) => {
				const gate = {
					name: repo.name,
					repoPath: repo.path,
					workflow,
					branch: String(repo.branch),
					headSha: String(repo.commitSha),
					...(packageHostedVerifyTimeoutSeconds(adapter) ? { timeoutSeconds: packageHostedVerifyTimeoutSeconds(adapter) } : {}),
				};
				return /^deploy(?:[-.]|$)/u.test(workflow) ? hostedDeployGate(gate) : gate;
			});
		});
}

function packageHostedVerifyWorkflow(adapter: TreeseedDiscoveredPackageAdapter | undefined) {
	const workflow = adapter?.metadata?.hostedVerifyWorkflow;
	return typeof workflow === 'string' && workflow.trim()
		? workflow.trim().replace(/^\.github\/workflows\//u, '')
		: null;
}

function packageHostedVerifyTimeoutSeconds(adapter: TreeseedDiscoveredPackageAdapter | undefined) {
	const timeoutSeconds = adapter?.metadata?.hostedVerifyTimeoutSeconds;
	return typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds) && timeoutSeconds > 0
		? Math.floor(timeoutSeconds)
		: null;
}

function gateForSavedRootReport(report: RepositorySaveReport, branch: string | null, scope: string) {
	if (!branch || scope === 'local' || !report.pushed || !report.commitSha) {
		return [];
	}
	if (branch === STAGING_BRANCH) {
		return [hostedDeployGate({
			name: report.name,
			repoPath: report.path,
			workflow: 'deploy.yml',
			branch,
			headSha: report.commitSha,
		})];
	}
	return [{
		name: report.name,
		repoPath: report.path,
		workflow: 'verify.yml',
		branch,
		headSha: report.commitSha,
	}];
}

function findAutoResumableTaskRun(root: string, command: 'stage' | 'close', branch: string | null) {
	if (!branch) return null;
	return listInterruptedWorkflowRuns(root).find((journal) =>
		journal.command === command
		&& journal.resumable
		&& journal.session.branchName === branch) ?? null;
}

function rejectImplicitWorkflowResume(
	operation: 'save' | 'stage' | 'close',
	journal: TreeseedWorkflowRunJournal | null,
) {
	if (!journal) return;
	workflowError(operation, 'resume_unavailable',
		`Treeseed ${operation} found interrupted run ${journal.runId} for this branch and will not auto-resume recorded inputs. `
		+ `Run \`trsd resume ${journal.runId}\` to continue it, or \`trsd recover --obsolete ${journal.runId} --reason "superseded by a fresh ${operation}"\` before starting a new ${operation}.`, {
			details: {
				recovery: {
					resumable: true,
					runId: journal.runId,
					resumeCommand: `trsd resume ${journal.runId}`,
					obsoleteCommand: `trsd recover --obsolete ${journal.runId} --reason "superseded by a fresh ${operation}"`,
				},
			},
		});
}

function stringRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function releasePlanHead(plan: Record<string, unknown>, repoName: string) {
	if (repoName === '@treeseed/market') {
		const rootRepo = stringRecord(plan.rootRepo);
		return typeof rootRepo?.commitSha === 'string' ? rootRepo.commitSha : null;
	}
	const repos = Array.isArray(plan.repos) ? plan.repos : [];
	for (const repo of repos) {
		const record = stringRecord(repo);
		if (record?.name === repoName) {
			return typeof record.commitSha === 'string' ? record.commitSha : null;
		}
	}
	return null;
}

function releasePlanMatchesCurrentHeads(plan: Record<string, unknown>, rootRepo: WorkflowRepoReport, packageReports: WorkflowRepoReport[]) {
	if (releasePlanHead(plan, rootRepo.name) !== rootRepo.commitSha) {
		return false;
	}
	const packageSelection = stringRecord(plan.packageSelection);
	const selected = Array.isArray(packageSelection?.selected)
		? packageSelection.selected.filter((name): name is string => typeof name === 'string')
		: packageReports.map((report) => report.name);
	for (const name of selected) {
		const current = packageReports.find((report) => report.name === name);
		if (!current || releasePlanHead(plan, name) !== current.commitSha) {
			return false;
		}
	}
	return true;
}

function releaseRunHasCompletedMutation(journal: TreeseedWorkflowRunJournal) {
	return journal.steps.some((step) =>
		step.status === 'completed'
		&& step.id !== 'release-plan'
		&& step.id !== 'workspace-unlink');
}

type ReleaseCleanupRepoSnapshot = {
	name: string;
	path: string;
	branch: string | null;
	files: string[];
};

type ReleaseCleanupSnapshot = {
	repos: ReleaseCleanupRepoSnapshot[];
};

function generatedReleaseMetadataFiles(repoDir: string) {
	return ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']
		.filter((filePath) => {
			if (existsSync(resolve(repoDir, filePath))) return true;
			try {
				runGit(['ls-files', '--error-unmatch', filePath], { cwd: repoDir, capture: true });
				return true;
			} catch {
				return false;
			}
		});
}

function collectReleaseCleanupSnapshot(root: string, selectedPackageNames: Set<string>): ReleaseCleanupSnapshot {
	return {
		repos: [
			{
				name: '@treeseed/market',
				path: repoRoot(root),
				branch: currentBranch(repoRoot(root)) || null,
				files: generatedReleaseMetadataFiles(repoRoot(root)),
			},
			...checkedOutWorkspacePackageRepos(root)
				.filter((pkg) => selectedPackageNames.has(pkg.name))
				.map((pkg) => ({
					name: pkg.name,
					path: pkg.dir,
					branch: currentBranch(pkg.dir) || null,
					files: generatedReleaseMetadataFiles(pkg.dir),
				})),
		],
	};
}

function restoreReleaseGeneratedMetadata(repo: ReleaseCleanupRepoSnapshot) {
	const restored: string[] = [];
	const skipped: string[] = [];
	for (const filePath of repo.files) {
		const status = runGit(['status', '--porcelain', '--', filePath], { cwd: repo.path, capture: true });
		if (!status.trim()) {
			skipped.push(filePath);
			continue;
		}
		runGit(['restore', '--staged', '--worktree', '--', filePath], { cwd: repo.path, capture: true });
		restored.push(filePath);
	}
	return { restored, skipped };
}

function cleanupFailedReleaseLocalState(
	root: string,
	helpers: WorkflowOperationHelpers,
	snapshot: ReleaseCleanupSnapshot | null,
	workspaceLinksMode: WorkspaceLinksMode | undefined,
) {
	const report: {
		restored: Array<Record<string, unknown>>;
		skipped: Array<Record<string, unknown>>;
		manualReview: Array<Record<string, unknown>>;
	} = { restored: [], skipped: [], manualReview: [] };
	try {
		ensureWorkflowWorkspaceLinks(root, helpers, workspaceLinksMode ?? 'auto');
	} catch (error) {
		report.manualReview.push({
			scope: 'workspace-links',
			reason: error instanceof Error ? error.message : String(error),
		});
	}
	if (!snapshot) {
		report.skipped.push({ scope: 'release-metadata', reason: 'cleanup snapshot was not recorded before failure' });
		return report;
	}
	for (const repo of snapshot.repos) {
		try {
			const restored = restoreReleaseGeneratedMetadata(repo);
			if (repo.branch && currentBranch(repo.path) !== repo.branch) {
				checkoutBranch(repo.path, repo.branch);
			}
			if (restored.restored.length > 0) {
				report.restored.push({ repo: repo.name, path: repo.path, files: restored.restored });
			}
			if (restored.skipped.length > 0) {
				report.skipped.push({ repo: repo.name, path: repo.path, files: restored.skipped, reason: 'unchanged' });
			}
		} catch (error) {
			report.manualReview.push({
				repo: repo.name,
				path: repo.path,
				branch: repo.branch,
				files: repo.files,
				reason: error instanceof Error ? error.message : String(error),
				nextCommand: repo.branch ? `git -C ${repo.path} restore --staged --worktree -- ${repo.files.join(' ')} && git -C ${repo.path} checkout ${repo.branch}` : null,
			});
		}
	}
	return report;
}

function prepareFreshReleaseRun(
	root: string,
	branch: string | null,
	rootRepo: WorkflowRepoReport,
	packageReports: WorkflowRepoReport[],
) {
	if (branch !== STAGING_BRANCH) return { archived: [], blockers: [] };
	const currentHeads = Object.fromEntries([
		[rootRepo.name, rootRepo.commitSha ?? null],
		...packageReports.map((report) => [report.name, report.commitSha ?? null] as const),
	]);
	const archived: Array<{ runId: string; reasons: string[] }> = [];
	const blockers: string[] = [];
	for (const journal of listInterruptedWorkflowRuns(root, { recentLimit: 50 }).filter((entry) => entry.command === 'release')) {
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch,
			currentHeads,
		});
		if (classification.state === 'stale') {
			archiveWorkflowRun(root, journal.runId, {
				...classification,
				reasons: ['fresh release superseded stale failed release', ...classification.reasons],
			});
			archived.push({ runId: journal.runId, reasons: classification.reasons });
			continue;
		}
		if (classification.state === 'resumable' && releaseRunHasCompletedMutation(journal)) {
			blockers.push(`${journal.runId}: completed release mutations and is still safe to resume. Mark it obsolete with \`npx trsd recover --obsolete ${journal.runId} --reason "superseded by fresh release"\` before using --fresh.`);
		}
	}
	if (blockers.length > 0) {
		workflowError('release', 'validation_failed', [
			'Treeseed release --fresh will not bypass a resumable partial release that already completed release mutations.',
			...blockers,
		].join('\n'), {
			details: { archived, blockers },
		});
	}
	return { archived, blockers };
}

function findAutoResumableReleaseRun(
	root: string,
	branch: string | null,
	rootRepo: WorkflowRepoReport,
	packageReports: WorkflowRepoReport[],
	options: { archiveStale?: boolean } = {},
) {
	if (branch !== STAGING_BRANCH) return null;
	const currentHeads = Object.fromEntries([
		[rootRepo.name, rootRepo.commitSha ?? null],
		...packageReports.map((report) => [report.name, report.commitSha ?? null] as const),
	]);
	return listInterruptedWorkflowRuns(root, { recentLimit: 50 }).find((journal) => {
		if (journal.command !== 'release' || !journal.resumable || journal.session.branchName !== STAGING_BRANCH) {
			return false;
		}
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch,
			currentHeads,
		});
		if (classification.state !== 'resumable') {
			if (options.archiveStale && classification.state === 'stale') {
				archiveWorkflowRun(root, journal.runId, {
					...classification,
					reasons: ['release auto-resume skipped stale failed release', ...classification.reasons],
				});
			}
			return false;
		}
		const releasePlan = stringRecord(journal.steps.find((step) => step.id === 'release-plan')?.data);
		const nextStep = nextPendingJournalStep(journal);
		if (releaseRunHasCompletedMutation(journal)) {
			if (nextStep?.id === 'release-root' && releasePlanHead(releasePlan ?? {}, rootRepo.name) !== rootRepo.commitSha) {
				return false;
			}
			return true;
		}
		return releasePlan ? releasePlanMatchesCurrentHeads(releasePlan, rootRepo, packageReports) : true;
	}) ?? null;
}

async function executeJournalStep<T extends Record<string, unknown> | null>(
	root: string,
	runId: string,
	stepId: string,
	action: () => Promise<T> | T,
	options: { rerunCompleted?: boolean } = {},
) {
	const current = readWorkflowRunJournal(root, runId);
	const step = current?.steps.find((entry) => entry.id === stepId) ?? null;
	if (!current || !step) {
		throw new Error(`Unknown workflow step "${stepId}" for run ${runId}.`);
	}
	if (step.status === 'completed' && !options.rerunCompleted) {
		return (step.data ?? null) as T;
	}
	const data = await Promise.resolve(action());
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		steps: journal.steps.map((entry) =>
			entry.id === stepId
				? {
					...entry,
					status: 'completed',
					completedAt: new Date().toISOString(),
					data: data ?? null,
				}
				: entry),
	}));
	refreshWorkflowLock(root, runId);
	return data;
}

function skipJournalStep(root: string, runId: string, stepId: string, data: Record<string, unknown> | null = null) {
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		steps: journal.steps.map((entry) =>
			entry.id === stepId
				? {
					...entry,
					status: 'skipped',
					completedAt: new Date().toISOString(),
					data,
				}
				: entry),
	}));
	refreshWorkflowLock(root, runId);
}

function acquireWorkflowRun(
	operation: TreeseedWorkflowRunCommand,
	session: TreeseedWorkflowSession,
	input: Record<string, unknown>,
	steps: Omit<TreeseedWorkflowRunStep, 'status' | 'completedAt' | 'data'>[],
	context: TreeseedWorkflowContext,
) {
	const resumeRunId = context.workflow?.resumeRunId;
	if (resumeRunId) {
		const existing = readWorkflowRunJournal(session.root, resumeRunId);
		if (!existing || existing.command !== operation) {
			workflowError(operation, 'resume_unavailable', `Treeseed ${operation} cannot resume run ${resumeRunId}.`, {
				details: { runId: resumeRunId, command: operation },
			});
		}
		const lockResult = acquireWorkflowLock(session.root, operation, resumeRunId);
		if (!lockResult.acquired) {
			workflowError(operation, 'workflow_locked', `Treeseed ${operation} is blocked by active run ${lockResult.lock.runId}.`, {
				details: {
					lock: lockResult.lock,
					recovery: {
						resumable: true,
						runId: lockResult.lock.runId,
						command: lockResult.lock.command,
						recoverCommand: 'treeseed recover',
						resumeCommand: `treeseed resume ${lockResult.lock.runId}`,
					},
				},
			});
		}
		return {
			runId: resumeRunId,
			session,
			journal: existing,
			resumed: true,
		} satisfies ActiveWorkflowRun;
	}

	const runId = generateWorkflowRunId(operation);
	const lockResult = acquireWorkflowLock(session.root, operation, runId);
	if (!lockResult.acquired) {
		workflowError(operation, 'workflow_locked', `Treeseed ${operation} is blocked by active run ${lockResult.lock.runId}.`, {
			details: {
				lock: lockResult.lock,
				recovery: {
					resumable: true,
					runId: lockResult.lock.runId,
					command: lockResult.lock.command,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${lockResult.lock.runId}`,
				},
			},
		});
	}
	const journal = createWorkflowRunJournal(session.root, {
		runId,
		command: operation,
		input,
		session: workflowSessionSnapshot(session),
		steps,
	});
	return {
		runId,
		session,
		journal,
		resumed: false,
	} satisfies ActiveWorkflowRun;
}

function completeWorkflowRun(root: string, runId: string, result: Record<string, unknown>) {
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		status: 'completed',
		result,
		failure: null,
	}));
	releaseWorkflowLock(root, runId);
}

function failWorkflowRun(
	root: string,
	runId: string,
	error: unknown,
	recovery?: TreeseedWorkflowRecovery | null,
) {
	const message = error instanceof Error ? error.message : String(error);
	const code = error instanceof TreeseedWorkflowError ? error.code : 'unsupported_state';
	const details = error instanceof TreeseedWorkflowError
		? {
			...(error.details ?? {}),
			recovery: recovery ?? error.details?.recovery ?? null,
		}
		: recovery
			? { recovery }
			: null;
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		status: 'failed',
		failure: {
			code,
			message,
			details,
			at: new Date().toISOString(),
		},
	}));
	releaseWorkflowLock(root, runId);
}

function validatePackageReleaseWorkflows(root: string, packageNames: string[]) {
	const missing = checkedOutWorkspacePackageRepos(root)
		.filter((pkg) => packageNames.includes(pkg.name))
		.map((pkg) => ({ pkg, workflow: releaseWorkflowForPackage(root, pkg.name) }))
		.filter((entry) => !existsSync(resolve(entry.pkg.dir, '.github/workflows', entry.workflow)))
		.map((entry) => `${entry.pkg.name} (${entry.workflow})`);
	if (missing.length > 0) {
		workflowError('release', 'workflow_contract_missing', `Treeseed release requires package release workflows in: ${missing.join(', ')}.`, {
			details: {
				missing,
			},
		});
	}
}

function releaseWorkflowForPackage(root: string, packageName: string) {
	const adapter = discoverTreeseedPackageAdapters(root).find((entry) => entry.id === packageName || entry.name === packageName);
	const configured = typeof adapter?.metadata?.dockerImageReleaseWorkflow === 'string'
		? adapter.metadata.dockerImageReleaseWorkflow
		: null;
	return configured && configured.trim()
		? configured.trim().replace(/^\.github\/workflows\//u, '')
		: 'publish.yml';
}

function productionDeployWorkflowForPackage(root: string, packageName: string) {
	const adapter = discoverTreeseedPackageAdapters(root).find((entry) => entry.id === packageName || entry.name === packageName);
	if (adapter?.capabilities.deploy !== true) {
		return null;
	}
	const repoPath = adapter?.dir;
	if (!repoPath || !existsSync(resolve(repoPath, 'treeseed.site.yaml'))) {
		return null;
	}
	if (!workflowFileExists(repoPath, 'deploy.yml')) {
		return null;
	}
	return 'deploy.yml';
}

function tagCommitSha(repoDir: string, tagName: string) {
	try {
		return runGit(['rev-list', '-n', '1', tagName], { cwd: repoDir, capture: true }).trim();
	} catch {
		return '';
	}
}

function productionPackageDeployGates(root: string, versions: Map<string, string>): GitHubActionsWorkflowGate[] {
	return discoverTreeseedPackageAdapters(root).flatMap((adapter) => {
		const name = adapter.id;
		const version = versions.get(name);
		const path = adapter.dir;
		const workflow = productionDeployWorkflowForPackage(root, name);
		if (!name || !version || !path || !workflow) {
			return [];
		}
		const headSha = tagCommitSha(path, version);
		if (!headSha) {
			workflowError('release', 'github_workflow_failed', `${name} ${workflow} cannot be checked because release tag ${version} is missing locally.`, {
				details: { packageName: name, workflow, version, repoPath: path },
			});
		}
		return [hostedDeployGate({
			name,
			repoPath: path,
			workflow,
			branch: version,
			headSha,
		})];
	});
}

function prepareAdapterReleaseMetadata(root: string, pkg: { name: string; dir: string }, version: string) {
	const adapter = discoverTreeseedPackageAdapters(root).find((entry) => entry.id === pkg.name || entry.name === pkg.name);
	if (adapter?.kind === 'beam-elixir-rust' && existsSync(resolve(pkg.dir, 'scripts', 'bump-release-version.ts'))) {
		const tsx = resolve(root, 'node_modules/.bin/tsx');
		if (!existsSync(tsx)) {
			throw new Error(`TreeSeed release requires the workspace tsx executable at ${tsx}. Run trsd install and restore workspace dependencies before retrying.`);
		}
		run(tsx, ['scripts/bump-release-version.ts', version], { cwd: pkg.dir });
		return { status: 'updated', adapter: adapter.id, command: `${tsx} scripts/bump-release-version.ts` };
	}
	if (existsSync(resolve(pkg.dir, 'package.json'))) {
		return {
			status: 'npm-install',
			adapter: adapter?.id ?? pkg.name,
			...runReleaseNpmInstall(pkg.dir, { workspaceRoot: root }),
		};
	}
	return { status: 'skipped', adapter: adapter?.id ?? pkg.name, reason: 'no package metadata updater' };
}

function validateStagingWorkflowContracts(root: string) {
	if (process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return;
	}
	const missing: string[] = [];
	for (const fileName of ['verify.yml', 'deploy.yml']) {
		if (!existsSync(resolve(root, '.github', 'workflows', fileName))) {
			missing.push(fileName);
		}
	}
	if (missing.length > 0) {
		workflowError('stage', 'workflow_contract_missing', `Treeseed stage requires standardized root workflows: ${missing.join(', ')}.`, {
			details: { missing },
		});
	}
}

function shouldSkipReleaseInstall() {
	return process.env.TREESEED_SAVE_NPM_INSTALL_MODE === 'skip';
}

function npmCommandForWorkflowSpawn(args: string[]) {
	if (process.platform === 'win32') {
		return { command: 'npm', args };
	}
	return {
		command: 'bash',
		args: [
			'-lc',
			'ulimit -n 65535 2>/dev/null || ulimit -n 32768 2>/dev/null || ulimit -n 16384 2>/dev/null || true; exec npm "$@"',
			'npm-fd-guard',
			...args,
		],
	};
}

function runReleaseNpmInstall(repoDir: string, options: { workspaceRoot?: string } = {}) {
	if (shouldSkipReleaseInstall()) {
		return { status: 'skipped', reason: 'disabled' };
	}
	const args = repoDir === options.workspaceRoot
		? ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']
		: ['install', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund'];
	const spawnCommand = npmCommandForWorkflowSpawn(args);
	let lastDetail = '';
	for (let attempt = 1; attempt <= 10; attempt += 1) {
		const result = spawnSync(spawnCommand.command, spawnCommand.args, {
			cwd: repoDir,
			env: {
				...process.env,
				npm_config_audit: 'false',
				npm_config_fetch_retries: '4',
				npm_config_fund: 'false',
				npm_config_foreground_scripts: 'true',
				npm_config_loglevel: 'warn',
				npm_config_maxsockets: '4',
				npm_config_prefer_online: 'true',
				npm_config_progress: 'false',
			},
			stdio: 'pipe',
			encoding: 'utf8',
		});
		if (result.status === 0) {
			return { status: 'completed', reason: null, attempts: attempt };
		}
		lastDetail = [
			result.error?.message,
			result.stderr?.trim(),
			result.stdout?.trim(),
		].filter(Boolean).join('\n');
		if (!/No matching version found|notarget|ETARGET|E404/u.test(lastDetail) || attempt === 10) break;
		spawnSync('sleep', ['30'], { stdio: 'ignore' });
	}
	throw new Error(lastDetail || `npm ${args.join(' ')} failed`);
}

function pathIsWithin(parent: string, candidate: string) {
	const path = relative(parent, candidate);
	return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function assertNoInternalDevReferencesForRepo(root: string, repoDir: string, packageNames: Set<string>) {
	const issues = collectInternalDevReferenceIssues(root, packageNames)
		.filter((issue) => {
			if (!pathIsWithin(repoDir, issue.filePath)) return false;
			if (repoDir !== root) return true;
			return !relative(root, issue.filePath).includes('/');
		});
	if (issues.length === 0) return;
	const rendered = issues
		.map((issue) => `${issue.filePath}${issue.field ? ` ${issue.field}.${issue.dependencyName}` : ''}: ${issue.reason} ${issue.spec}`)
		.join('\n');
	throw new Error(`Stable release still contains internal Git/dev dependency references.\n${rendered}`);
}

function backMergeProductionIntoStaging(repoDir: string, repoName: string, message?: string) {
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	if (!remoteBranchExists(repoDir, PRODUCTION_BRANCH)) {
		throw new Error(`Remote branch "origin/${PRODUCTION_BRANCH}" does not exist.`);
	}
	checkoutBranch(repoDir, STAGING_BRANCH);
	try {
		runGit(['merge-base', '--is-ancestor', `origin/${PRODUCTION_BRANCH}`, 'HEAD'], { cwd: repoDir, capture: true });
		return {
			status: 'up-to-date',
			merged: false,
			repoName,
			sourceBranch: PRODUCTION_BRANCH,
			targetBranch: STAGING_BRANCH,
			commitSha: headCommit(repoDir),
		};
	} catch {
		// A non-zero merge-base result means staging does not yet contain main.
	}
	try {
		runGit(['merge', '--no-ff', `origin/${PRODUCTION_BRANCH}`, '-m', message ?? `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`], { cwd: repoDir });
	} catch (error) {
		const report = collectMergeConflictReport(repoDir);
		throw new TreeseedWorkflowError('release', 'merge_conflict', formatMergeConflictReport(report, repoDir, STAGING_BRANCH), {
			details: { repoName, branch: STAGING_BRANCH, sourceBranch: PRODUCTION_BRANCH, report, originalError: error instanceof Error ? error.message : String(error) },
			exitCode: 12,
		});
	}
	pushBranch(repoDir, STAGING_BRANCH);
	return {
		status: 'merged',
		merged: true,
		repoName,
		sourceBranch: PRODUCTION_BRANCH,
		targetBranch: STAGING_BRANCH,
		commitSha: headCommit(repoDir),
	};
}

function releaseHelperRepoToProduction(repo: TreeseedManagedRepository) {
	syncBranchWithOrigin(repo.dir, STAGING_BRANCH);
	if (!remoteBranchExists(repo.dir, STAGING_BRANCH)) {
		throw new Error(`${repo.name} has no origin/${STAGING_BRANCH} branch to release.`);
	}
	const stagingHead = remoteHeadCommit(repo.dir, STAGING_BRANCH);
	const promotion = promoteCommitToProductionBranch(repo.dir, stagingHead);
	const backMerge = backMergeProductionIntoStaging(repo.dir, repo.name, releaseAdminMessage({
		subject: `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`,
		version: null,
		sourceRef: PRODUCTION_BRANCH,
		targetRef: STAGING_BRANCH,
	}));
	return {
		name: repo.name,
		kind: repo.kind,
		path: repo.relativeDir,
		stagingHead,
		promotion,
		backMerge,
	};
}

function backMergeRootProductionIntoStaging(root: string, syncPackageStagingHeads: boolean, options: {
	version?: string | null;
	changelog?: ReleaseHistorySummary | null;
	selectedVersions?: Map<string, string>;
} = {}) {
	const gitRoot = repoRoot(root);
	const commits = releaseHistoryCommits(gitRoot, STAGING_BRANCH, `origin/${PRODUCTION_BRANCH}`);
	const backMerge = backMergeProductionIntoStaging(gitRoot, '@treeseed/market', releaseAdminMessage({
		subject: `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`,
		version: options.version,
		sourceRef: PRODUCTION_BRANCH,
		targetRef: STAGING_BRANCH,
		commits,
		changelog: options.changelog ?? null,
		extraLines: versionLines(options.selectedVersions).map((line) => `Released package ${line}`),
	}));
	if (!syncPackageStagingHeads) {
		return backMerge;
	}
	syncAllCheckedOutPackageRepos(root, STAGING_BRANCH);
	const pointerCommits = releaseHistoryCommits(gitRoot, `origin/${STAGING_BRANCH}`, 'HEAD');
	const pointerSync = commitAllIfChanged(gitRoot, releaseAdminMessage({
		subject: 'release: sync package staging heads',
		version: options.version,
		sourceRef: 'package staging heads',
		targetRef: STAGING_BRANCH,
		commits: pointerCommits,
		changelog: options.changelog ?? null,
		extraLines: versionLines(options.selectedVersions).map((line) => `Staging package ${line}`),
	}));
	if (pointerSync.committed) {
		pushBranch(gitRoot, STAGING_BRANCH);
	}
	return {
		...backMerge,
		packageStagingPointersSynced: pointerSync.committed,
		packageStagingPointerCommit: pointerSync.commitSha,
	};
}

function releasePlanVersionMap(plannedVersions: Record<string, unknown>) {
	return new Map(
		Object.entries(plannedVersions)
			.filter(([name]) => name !== '@treeseed/market')
			.map(([name, version]) => [name, String(version)] as const),
	);
}

function releasePlanStableDependencyVersionMap(plannedRelease: { stableDependencyVersions?: unknown }) {
	const stableDependencyVersions = plannedRelease.stableDependencyVersions && typeof plannedRelease.stableDependencyVersions === 'object' && !Array.isArray(plannedRelease.stableDependencyVersions)
		? plannedRelease.stableDependencyVersions as Record<string, unknown>
		: {};
	return new Map(Object.entries(stableDependencyVersions).map(([name, version]) => [name, String(version)] as const));
}

function collectReleaseHelperRepoBlockers(root: string) {
	const blockers: string[] = [];
	for (const repo of checkedOutReleaseHelperRepos(root)) {
		const branch = currentBranch(repo.dir) || null;
		if (hasMeaningfulChanges(repo.dir)) {
			blockers.push(`${repo.name} has uncommitted changes.`);
		}
		if (branch !== STAGING_BRANCH) {
			blockers.push(`${repo.name} is on ${branch ?? '(detached)'} instead of ${STAGING_BRANCH}.`);
		}
		try {
			originRemoteUrl(repo.dir);
		} catch {
			blockers.push(`${repo.name} has no readable origin remote.`);
		}
		if (!remoteBranchExists(repo.dir, STAGING_BRANCH)) {
			blockers.push(`${repo.name} has no origin/${STAGING_BRANCH} branch.`);
		}
	}
	return blockers;
}

function releasePlanPackageSelection(value: unknown): { changed: string[]; dependents: string[]; selected: string[] } {
	const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return {
		changed: Array.isArray(record.changed) ? record.changed.map(String) : [],
		dependents: Array.isArray(record.dependents) ? record.dependents.map(String) : [],
		selected: Array.isArray(record.selected) ? record.selected.map(String) : [],
	};
}

const RELEASE_PACKAGE_DEPENDENCIES: Record<string, string[]> = {
	'@treeseed/api': ['treedx'],
};

export function orderReleasePackageNames(packageNames: string[]) {
	const selected = new Set(packageNames);
	const ordered: string[] = [];
	const visiting = new Set<string>();
	const visited = new Set<string>();

	const visit = (name: string) => {
		if (visited.has(name)) return;
		if (visiting.has(name)) {
			throw new Error(`Cycle detected in release package dependency order at ${name}.`);
		}
		visiting.add(name);
		for (const dependency of RELEASE_PACKAGE_DEPENDENCIES[name] ?? []) {
			if (selected.has(dependency)) visit(dependency);
		}
		visiting.delete(name);
		visited.add(name);
		ordered.push(name);
	};

	for (const name of packageNames) visit(name);
	return ordered;
}

function stableDependencyVersionsForReleaseLine(root: string, options: {
	targetLine?: unknown;
	group?: unknown;
	selected: Set<string>;
}) {
	const targetLine = typeof options.targetLine === 'string' ? options.targetLine : null;
	const group = new Set(Array.isArray(options.group) ? options.group.map(String) : []);
	if (!targetLine || group.size === 0) return {};
	const versions: Record<string, string> = {};
	for (const pkg of workspacePackages(root)) {
		if (!group.has(pkg.name) || options.selected.has(pkg.name)) continue;
		const stableVersion = highestStableGitTagOnLine(pkg.dir, targetLine);
		if (stableVersion) {
			versions[pkg.name] = stableVersion;
		}
	}
	return versions;
}

function releaseCandidateProofDriver(mode: ReleaseCandidateMode, lane: 'fast' | 'promotion' = 'fast'): TreeseedProofDriver {
	if (lane === 'promotion' || mode === 'strict') return 'github-hosted';
	return 'local';
}

async function runReleaseCandidateProofForPlan(
	operation: Extract<TreeseedWorkflowOperationId, 'save' | 'stage' | 'release'>,
	root: string,
	plannedRelease: { plannedVersions?: unknown; packageSelection?: unknown },
	options: { mode?: ReleaseCandidateMode; lane?: 'fast' | 'promotion'; write?: (line: string, stream?: 'stdout' | 'stderr') => void } = {},
) {
	const packageSelection = releasePlanPackageSelection(plannedRelease.packageSelection);
	const mode = options.mode ?? normalizeReleaseCandidateMode(undefined, operation);
	const driver = releaseCandidateProofDriver(mode, options.lane ?? 'fast');
	const proof = await runTreeseedProof({
		root,
		target: operation === 'release' ? 'prod' : 'staging',
		driver,
		write: options.write,
	});
	if (proof.failures.length > 0) {
		const first = proof.failures[0]!;
		workflowError(operation, 'validation_failed', [
			'Treeseed release-candidate proof failed.',
			`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
			first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
			driver === 'github-hosted'
				? 'Hosted GitHub workflow proof is authoritative; local action simulation is advisory.'
				: 'Local proof is exact-input cached in the proof ledger and reruns only missing or invalid subjects.',
		].filter(Boolean).join('\n'), { details: { proof } });
	}
	return {
		mode,
		driver,
		selectedPackageNames: packageSelection.selected,
		proof,
		status: 'passed',
		reused: proof.reused.length,
		records: proof.records.length,
	};
}

function parseProofOlderThan(value: string | null | undefined) {
	if (!value) return 30 * 24 * 60 * 60 * 1000;
	const match = value.trim().match(/^(\d+)([smhd])?$/u);
	if (!match) return 30 * 24 * 60 * 60 * 1000;
	const amount = Number(match[1]);
	const unit = match[2] ?? 'd';
	if (!Number.isFinite(amount) || amount < 0) return 30 * 24 * 60 * 60 * 1000;
	if (unit === 's') return amount * 1000;
	if (unit === 'm') return amount * 60 * 1000;
	if (unit === 'h') return amount * 60 * 60 * 1000;
	return amount * 24 * 60 * 60 * 1000;
}

export async function workflowProof(helpers: WorkflowOperationHelpers, input: TreeseedProofInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const timer = createTreeseedWorkflowTimer();
			const tenantRoot = resolveProjectRootOrThrow('proof', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const action = input.action ?? (input.plan ? 'plan' : 'status');
			const target = input.target ?? 'staging';
			const driver = input.driver ?? 'github-hosted';
			const executionMode = action === 'plan' || input.plan ? 'plan' : 'execute';
			let payload: Record<string, unknown>;
			if (action === 'run') {
				const result = await timer.phaseAsync('proof-run', 'Run release proof subjects', () => runTreeseedProof({
					root,
					target,
					driver,
					subject: input.subject ?? null,
					write: (line, stream) => helpers.write(line, stream),
				}));
				payload = {
					action,
					target,
					driver,
					subject: input.subject ?? null,
					...result,
					authority: driver === 'github-hosted' ? 'authoritative' : 'advisory',
				};
				if (result.failures.length > 0) {
					const first = result.failures[0]!;
					workflowError('proof', 'validation_failed', [
						'Treeseed release proof failed.',
						`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
						first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
						'Hosted GitHub workflow proof is authoritative; local action simulation is advisory.',
					].filter(Boolean).join('\n'), { details: { proof: payload } });
				}
			} else if (action === 'clean') {
				payload = {
					action,
					target,
					...timer.phase('proof-clean', 'Clean old proof records', () => cleanProofLedger(root, {
						olderThanMs: parseProofOlderThan(input.olderThan),
					})),
				};
			} else if (action === 'failures') {
				const ledger = timer.phase('proof-failures', 'Inspect failed proof records', () => summarizeTreeseedProofLedger(root));
				payload = { action, target, failures: ledger.failures, summary: ledger.summary };
			} else if (action === 'explain') {
				const ledger = timer.phase('proof-explain', 'Explain proof duration and reuse', () => summarizeTreeseedProofLedger(root));
				payload = {
					action,
					target,
					latest: ledger.latest,
					slowest: ledger.slowest,
					reuse: {
						passed: ledger.summary.reusable,
						rerun: Math.max(0, ledger.summary.records - ledger.summary.reusable),
						blocked: ledger.summary.failed,
					},
					summary: ledger.summary,
				};
			} else {
				const plan = timer.phase('proof-plan', 'Plan release proof subjects', () => buildTreeseedProofPlan({
					root,
					target,
					driver,
					subject: input.subject ?? null,
				}));
				payload = { action, target, driver, plan, authority: driver === 'github-hosted' ? 'authoritative' : 'advisory' };
			}
			const timing = timer.finish();
			return buildWorkflowResult('proof', root, payload, {
				executionMode,
				summary: action === 'run' ? 'Treeseed release proof run completed.' : 'Treeseed release proof report ready.',
				timing,
				nextSteps: createNextSteps([
					{ operation: 'proof', reason: 'Run missing authoritative hosted proof before promotion.', input: { action: 'run', target, driver: 'github-hosted' } },
				]),
			});
		});
	} catch (error) {
		toError('proof', error);
	}
}

function normalizeReleaseCandidatePackages(value: TreeseedReleaseCandidateInput['package']) {
	if (Array.isArray(value)) return value.map(String).filter(Boolean);
	if (typeof value === 'string' && value.trim()) return [value.trim()];
	return [];
}

export async function workflowReleaseCandidate(helpers: WorkflowOperationHelpers, input: TreeseedReleaseCandidateInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const timer = createTreeseedWorkflowTimer();
			const tenantRoot = resolveProjectRootOrThrow('release-candidate', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const executionMode = normalizeExecutionMode(input);
			const selectedPackageNames = normalizeReleaseCandidatePackages(input.package);
			const mode = (input.mode ?? 'strict') as TreeseedReleaseCandidateMode;
			const driver: TreeseedProofDriver = input.verifyDriver === 'local'
				? 'local'
				: input.verifyDriver === 'action'
					? 'act'
					: releaseCandidateProofDriver(mode === 'skip' ? 'hybrid' : mode);
			const proofSubject = selectedPackageNames.length === 1 ? `package:${selectedPackageNames[0]}` : null;
			const plan = timer.phase('proof-plan', 'Plan release-candidate proof subjects', () => buildTreeseedProofPlan({
				root,
				target: 'staging',
				driver,
				subject: proofSubject,
			}));
			const payload = {
				mode,
				driver,
				verifyDriver: input.verifyDriver ?? 'auto',
				selectedPackageNames,
				keepWorkspace: input.keepWorkspace === true,
				plan,
				plannedSteps: [
					{ id: 'proof-plan', description: 'Discover reusable exact-input proof records for package subjects.' },
					{ id: 'proof-run', description: 'Run only missing or invalid release proof nodes.' },
				],
			};
			if (executionMode === 'plan') {
				return buildWorkflowResult('release-candidate', root, payload, {
					executionMode,
					summary: 'Treeseed release-candidate proof plan ready.',
					nextSteps: createNextSteps([
						{ operation: 'release-candidate', reason: 'Run missing proof nodes before promotion.' },
					]),
				});
			}
			if (mode === 'skip') {
				return buildWorkflowResult('release-candidate', root, {
					...payload,
					status: 'skipped',
					failures: [],
				}, {
					summary: 'Treeseed release-candidate proof skipped.',
					timing: timer.finish(),
				});
			}
			const proof = await timer.phaseAsync('proof-run', 'Run release-candidate proof nodes', () => runTreeseedProof({
				root,
				target: 'staging',
				driver,
				subject: proofSubject,
				write: (line, stream) => helpers.write(line, stream),
			}));
			const resultPayload = {
				...payload,
				proof,
				failures: proof.failures,
			};
			if (proof.failures.length > 0) {
				const first = proof.failures[0]!;
				workflowError('release-candidate', 'validation_failed', [
					'Treeseed release-candidate proof failed.',
					`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
					first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
				].filter(Boolean).join('\n'), {
					details: { releaseCandidate: resultPayload },
				});
			}
			return buildWorkflowResult('release-candidate', root, resultPayload, {
				summary: 'Treeseed release-candidate proof passed.',
				timing: timer.finish(),
				nextSteps: createNextSteps([
					{ operation: 'stage', reason: 'Run stage after the matching release proof passes.' },
				]),
			});
		});
	} catch (error) {
		toError('release-candidate', error);
	}
}

function buildReleasePlanSnapshot(input: {
	root: string;
	mode: TreeseedWorkflowMode;
	level: string;
	repairVersionLine?: boolean;
	targetVersionLine?: string;
	packageSelection: { changed: string[]; dependents: string[]; selected: string[] };
	packageReports: WorkflowRepoReport[];
	rootRepo: WorkflowRepoReport;
	blockers: string[];
}) {
	const publishablePackageNames = new Set(
		discoverTreeseedPackageAdapters(input.root)
			.filter((adapter) => adapter.capabilities.publish)
			.map((adapter) => adapter.id),
	);
	const selectedPackageNames = new Set(
		input.packageSelection.selected.filter((name) => publishablePackageNames.has(name)),
	);
	const publishablePackageSelection = {
		changed: input.packageSelection.changed.filter((name) => selectedPackageNames.has(name)),
		dependents: input.packageSelection.dependents.filter((name) => selectedPackageNames.has(name)),
		selected: [...selectedPackageNames],
	};
	const applicationSelection = selectWorkflowApplications(input.root, { packageSelection: input.packageSelection });
	const versionPlan = planWorkspaceReleaseBump(input.level, input.root, input.mode === 'recursive-workspace'
		? { selectedPackageNames, repairVersionLine: input.repairVersionLine === true, targetVersionLine: input.targetVersionLine }
		: {});
	if (input.repairVersionLine !== true) {
		for (const adapter of discoverTreeseedPackageAdapters(input.root)) {
			if (!selectedPackageNames.has(adapter.id) || versionPlan.versions.has(adapter.id) || !adapter.version) continue;
			versionPlan.selected.add(adapter.id);
			versionPlan.versions.set(adapter.id, incrementVersion(adapter.version, input.level));
		}
	}
	for (const adapter of discoverTreeseedPackageAdapters(input.root)) {
		let version = versionPlan.versions.get(adapter.id);
		if (!version) continue;
		while (releaseTagExists(adapter.dir, version)) {
			version = incrementVersion(version, input.level);
		}
		versionPlan.versions.set(adapter.id, version);
	}
	const plannedSelected = orderReleasePackageNames([...versionPlan.selected].filter((name) => versionPlan.versions.has(name)));
	const plannedChanged = input.repairVersionLine === true
		? plannedSelected
		: Array.from(new Set(publishablePackageSelection.changed.filter((name) => plannedSelected.includes(name))));
	const plannedDependents = plannedSelected.filter((name) => !plannedChanged.includes(name));
	const plannedPackageSelection = {
		changed: plannedChanged,
		dependents: plannedDependents,
		selected: plannedSelected,
	};
	const rootVersion = planRootPackageVersion(input.root, input.level);
	const stableDependencyVersions = stableDependencyVersionsForReleaseLine(input.root, {
		targetLine: versionPlan.releaseLine?.targetLine,
		group: versionPlan.releaseLine?.group,
		selected: new Set(plannedPackageSelection.selected),
	});
	const plannedVersions = {
		'@treeseed/market': rootVersion,
		...Object.fromEntries(versionPlan.versions.entries()),
	};
	const plannedDevReferenceRewrites = input.mode === 'recursive-workspace'
		? collectInternalDevReferenceIssues(input.root, new Set([
			...plannedPackageSelection.selected,
			...Object.keys(stableDependencyVersions),
		]))
		: [];
	return {
		mode: input.mode,
		mergeStrategy: 'merge-commit',
		level: input.level,
		releaseLine: versionPlan.releaseLine,
		rootVersion,
		releaseTag: rootVersion,
		stagingBranch: STAGING_BRANCH,
		productionBranch: PRODUCTION_BRANCH,
		packageSelection: plannedPackageSelection,
		plannedVersions,
		stableDependencyVersions,
		applicationSelection,
		plannedDevReferenceRewrites,
		releaseOrder: plannedPackageSelection.selected,
		plannedPublishWaits: plannedPackageSelection.selected.map((name) => ({
			name,
			workflow: releaseWorkflowForPackage(input.root, name),
			branch: String(plannedVersions[name] ?? PRODUCTION_BRANCH),
			status: 'planned',
		})),
		touchedPackages: plannedPackageSelection.selected,
		repos: input.packageReports,
		rootRepo: input.rootRepo,
		finalBranch: STAGING_BRANCH,
		plannedSteps: [
			{ id: 'release-plan', description: 'Record immutable release plan and target versions' },
			{ id: 'release-candidate', description: 'Run exact staging release-candidate readiness checks' },
			{ id: 'workspace-unlink', description: 'Remove local workspace links before stable release install' },
			{ id: 'prepare-release-metadata', description: 'Rewrite package metadata and lockfiles to production dependency mode' },
			...input.packageReports.filter((report) => plannedPackageSelection.selected.includes(report.name)).map((report) => ({
				id: `release-${report.name}`,
				description: `Release ${report.name} from staging to main and tag ${plannedVersions[report.name] ?? '(planned)'}`,
			})),
			{ id: 'release-root', description: `Release market ${rootVersion}` },
			{ id: 'release-back-merge', description: 'Back-merge production release history into staging' },
			{ id: 'workspace-link', description: 'Restore local workspace links after release syncs back to staging' },
		],
		blockers: input.blockers,
	};
}

function collectReleasePlanBlockers(
	session: TreeseedWorkflowSession,
	mode: TreeseedWorkflowMode,
	selectedPackageNames: string[],
	options: { level?: string; repairVersionLine?: boolean } = {},
) {
	const blockers: string[] = [];
	if (session.branchName !== STAGING_BRANCH) {
		blockers.push('Release must start from staging.');
	}
	if (session.rootRepo.dirty) {
		blockers.push('@treeseed/market has uncommitted changes.');
	}
	if (!session.rootRepo.hasOriginRemote) {
		blockers.push('@treeseed/market is missing origin remote.');
	}
	if (mode === 'recursive-workspace') {
		const lineState = collectPublicPackageReleaseLineState(session.root);
		if (options.repairVersionLine !== true && options.level === 'patch' && lineState.drifted) {
			blockers.push(`Public package version line drift detected (${lineState.packages.map((pkg) => `${pkg.name}@${pkg.version}`).join(', ')}). Run \`treeseed release --repair-version-line --target-version-line ${lineState.highestLine} --plan\` first.`);
		}
		for (const repo of session.packageRepos) {
			if (!selectedPackageNames.includes(repo.name)) continue;
			if (repo.detached) blockers.push(`${repo.name} is detached.`);
			if (repo.branchName !== STAGING_BRANCH) blockers.push(`${repo.name} is on ${repo.branchName ?? '(detached)'} instead of staging.`);
			if (repo.dirty) blockers.push(`${repo.name} has uncommitted changes.`);
			if (!repo.hasOriginRemote) blockers.push(`${repo.name} is missing origin remote.`);
		}
		try {
			validatePackageReleaseWorkflows(session.root, selectedPackageNames);
		} catch (error) {
			blockers.push(error instanceof Error ? error.message : String(error));
		}
	}
	return blockers;
}

function assertReleaseGitHubAutomationReady(root: string, selectedPackageNames: Set<string>, ciMode: TreeseedWorkflowCiMode) {
	if (ciMode === 'off') {
		return;
	}
	const values = resolveTreeseedMachineEnvironmentValues(root, 'prod');
	const missing: Array<{ packageName: string; repository: string; envName: string }> = [];
	for (const pkg of checkedOutWorkspacePackageRepos(root)) {
		if (!selectedPackageNames.has(pkg.name)) continue;
		const repository = resolveGitHubRepositorySlug(pkg.dir);
		const credential = resolveGitHubCredentialForRepository(repository, { values, env: process.env });
		if (!credential.token) {
			missing.push({ packageName: pkg.name, repository: credential.repository, envName: credential.envName });
		}
	}
	if (missing.length > 0) {
		workflowError(
			'release',
			'github_auth_unavailable',
			[
				'Treeseed release automation requires Treeseed-prefixed GitHub credentials.',
				...missing.map((pkg) => `- ${pkg.packageName}: configure ${pkg.envName} for ${pkg.repository}, or TREESEED_GITHUB_TOKEN as a fallback.`),
			].join('\n'),
			{ details: { missing } },
		);
	}
}

function assertReleaseGitHubWorkflowSucceeded(packageName: string, workflow: Record<string, unknown> | null | undefined) {
	if (!workflow || workflow.status !== 'completed') {
		return;
	}
	if (workflow.conclusion === 'success') {
		return;
	}
	const workflowName = typeof workflow.workflow === 'string' ? workflow.workflow : 'publish.yml';
	const repository = typeof workflow.repository === 'string' ? workflow.repository : packageName;
	const url = typeof workflow.url === 'string' && workflow.url ? `\n${workflow.url}` : '';
	const conclusion = typeof workflow.conclusion === 'string' && workflow.conclusion ? workflow.conclusion : 'unknown';
	workflowError('release', 'github_workflow_failed', `${packageName} ${workflowName} completed with conclusion ${conclusion} in ${repository}.${url}`, {
		details: {
			packageName,
			workflow,
		},
	});
}

type PublishedArtifactCheck = {
	id: string;
	kind: 'npm' | 'docker' | 'pypi' | 'crates' | 'hex' | 'github-tag';
	name: string;
	version: string;
	url: string;
	ok: boolean;
	status?: number | null;
	message?: string;
};

function npmRegistryPackageUrl(packageName: string) {
	return `https://registry.npmjs.org/${packageName.replace('/', '%2f')}`;
}

async function fetchJsonForArtifact(url: string): Promise<{ ok: boolean; status: number; json: unknown }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 20000);
	try {
		const response = await fetch(url, {
			headers: {
				accept: 'application/json',
				'user-agent': 'treeseed-release-verifier/1.0 (https://treeseed.dev)',
			},
			signal: controller.signal,
		});
		let json: unknown = null;
		try {
			json = await response.json();
		} catch {
			json = null;
		}
		return { ok: response.ok, status: response.status, json };
	} finally {
		clearTimeout(timeout);
	}
}

function hasObjectKey(value: unknown, key: string) {
	return Boolean(value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key));
}

async function verifyNpmArtifact(packageName: string, version: string): Promise<PublishedArtifactCheck> {
	const url = npmRegistryPackageUrl(packageName);
	try {
		const response = await fetchJsonForArtifact(url);
		const versions = stringRecord(response.json)?.versions;
		const ok = response.ok && hasObjectKey(versions, version);
		return {
			id: `npm:${packageName}:${version}`,
			kind: 'npm',
			name: packageName,
			version,
			url,
			ok,
			status: response.status,
			...(ok ? {} : { message: `${packageName}@${version} was not found in npm registry metadata.` }),
		};
	} catch (error) {
		return {
			id: `npm:${packageName}:${version}`,
			kind: 'npm',
			name: packageName,
			version,
			url,
			ok: false,
			status: null,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function fetchDockerRegistryManifestStatus(image: string, version: string): Promise<{ ok: boolean; status: number | null; message?: string }> {
	const [namespace, repository] = image.split('/');
	if (!namespace || !repository) {
		return { ok: false, status: null, message: `Invalid Docker image name ${image}.` };
	}
	const tokenUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${namespace}/${repository}:pull`;
	try {
		const tokenResponse = await fetchJsonForArtifact(tokenUrl);
		const token = typeof stringRecord(tokenResponse.json)?.token === 'string'
			? String(stringRecord(tokenResponse.json)?.token)
			: '';
		if (!tokenResponse.ok || !token) {
			return { ok: false, status: tokenResponse.status, message: `Docker registry token request failed for ${image}.` };
		}
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 20000);
		try {
			const manifestResponse = await fetch(`https://registry-1.docker.io/v2/${namespace}/${repository}/manifests/${version}`, {
				method: 'HEAD',
				headers: {
					accept: [
						'application/vnd.docker.distribution.manifest.list.v2+json',
						'application/vnd.oci.image.index.v1+json',
						'application/vnd.docker.distribution.manifest.v2+json',
					].join(', '),
					authorization: `Bearer ${token}`,
					'user-agent': 'treeseed-release-verifier/1.0 (https://treeseed.dev)',
				},
				signal: controller.signal,
			});
			return {
				ok: manifestResponse.ok,
				status: manifestResponse.status,
				...(manifestResponse.ok ? {} : { message: `Docker registry manifest for ${image}:${version} is not pullable yet.` }),
			};
		} finally {
			clearTimeout(timeout);
		}
	} catch (error) {
		return { ok: false, status: null, message: error instanceof Error ? error.message : String(error) };
	}
}

async function verifyDockerHubArtifact(image: string, version: string): Promise<PublishedArtifactCheck> {
	const [namespace, repository] = image.split('/');
	const url = `https://hub.docker.com/v2/repositories/${namespace}/${repository}/tags/${version}`;
	try {
		const response = await fetchJsonForArtifact(url);
		const images = Array.isArray(stringRecord(response.json)?.images) ? stringRecord(response.json)?.images as unknown[] : [];
		const architectures = new Set(images
			.map((entry) => stringRecord(entry))
			.map((entry) => typeof entry?.architecture === 'string' ? entry.architecture : null)
			.filter((entry): entry is string => Boolean(entry)));
		const registry = await fetchDockerRegistryManifestStatus(image, version);
		const ok = response.ok && architectures.has('amd64') && architectures.has('arm64') && registry.ok;
		return {
			id: `docker:${image}:${version}`,
			kind: 'docker',
			name: image,
			version,
			url,
			ok,
			status: registry.status ?? response.status,
			...(ok ? {} : { message: registry.message ?? `${image}:${version} was not found on Docker Hub with amd64 and arm64 images.` }),
		};
	} catch (error) {
		return {
			id: `docker:${image}:${version}`,
			kind: 'docker',
			name: image,
			version,
			url,
			ok: false,
			status: null,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function verifyGitHubTagArtifact(repository: string, version: string): Promise<PublishedArtifactCheck> {
	const url = `https://api.github.com/repos/${repository}/git/ref/tags/${encodeURIComponent(version)}`;
	try {
		const response = await fetchJsonForArtifact(url);
		return {
			id: `github-tag:${repository}:${version}`,
			kind: 'github-tag',
			name: repository,
			version,
			url,
			ok: response.ok,
			status: response.status,
			...(response.ok ? {} : { message: `GitHub tag ${repository}@${version} was not found.` }),
		};
	} catch (error) {
		return {
			id: `github-tag:${repository}:${version}`,
			kind: 'github-tag',
			name: repository,
			version,
			url,
			ok: false,
			status: null,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function verifySimpleRegistryArtifact(input: {
	kind: 'pypi' | 'crates' | 'hex';
	name: string;
	version: string;
	url: string;
}): Promise<PublishedArtifactCheck> {
	try {
		const response = await fetchJsonForArtifact(input.url);
		return {
			id: `${input.kind}:${input.name}:${input.version}`,
			kind: input.kind,
			name: input.name,
			version: input.version,
			url: input.url,
			ok: response.ok,
			status: response.status,
			...(response.ok ? {} : { message: `${input.name} ${input.version} was not found in ${input.kind}.` }),
		};
	} catch (error) {
		return {
			id: `${input.kind}:${input.name}:${input.version}`,
			kind: input.kind,
			name: input.name,
			version: input.version,
			url: input.url,
			ok: false,
			status: null,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

async function collectPublishedReleaseArtifactChecks(selectedVersions: Map<string, string>) {
	const checks: PublishedArtifactCheck[] = [];
	const githubRepositories: Record<string, string> = {
		'@treeseed/sdk': 'treeseed-ai/sdk',
		'@treeseed/ui': 'treeseed-ai/ui',
		'@treeseed/core': 'treeseed-ai/core',
		'@treeseed/admin': 'treeseed-ai/admin',
		'@treeseed/cli': 'treeseed-ai/cli',
		'@treeseed/agent': 'treeseed-ai/agent',
		'@treeseed/api': 'treeseed-ai/api',
		treedx: 'treeseed-ai/treedx',
		'@treeseed/treedx': 'treeseed-ai/treedx',
	};
	for (const [packageName, repository] of Object.entries(githubRepositories)) {
		const version = selectedVersions.get(packageName);
		if (version) checks.push(await verifyGitHubTagArtifact(repository, version));
	}
	const npmPackages = ['@treeseed/sdk', '@treeseed/ui', '@treeseed/core', '@treeseed/admin', '@treeseed/cli', '@treeseed/agent'];
	for (const packageName of npmPackages) {
		const version = selectedVersions.get(packageName);
		if (version) checks.push(await verifyNpmArtifact(packageName, version));
	}
	const agentVersion = selectedVersions.get('@treeseed/agent');
	if (agentVersion) {
		for (const image of ['treeseed/agent-manager', 'treeseed/agent-runner']) {
			checks.push(await verifyDockerHubArtifact(image, agentVersion));
		}
	}
	const apiVersion = selectedVersions.get('@treeseed/api');
	if (apiVersion) {
		for (const image of ['treeseed/api', 'treeseed/op-runner']) {
			checks.push(await verifyDockerHubArtifact(image, apiVersion));
		}
	}
	const treedxVersion = selectedVersions.get('treedx') ?? selectedVersions.get('@treeseed/treedx');
	if (treedxVersion) {
		checks.push(await verifyNpmArtifact('@treeseed/treedx', treedxVersion));
		checks.push(await verifySimpleRegistryArtifact({
			kind: 'pypi',
			name: 'treedx',
			version: treedxVersion,
			url: `https://pypi.org/pypi/treedx/${treedxVersion}/json`,
		}));
		checks.push(await verifySimpleRegistryArtifact({
			kind: 'crates',
			name: 'treedx',
			version: treedxVersion,
			url: `https://crates.io/api/v1/crates/treedx/${treedxVersion}`,
		}));
		checks.push(await verifySimpleRegistryArtifact({
			kind: 'hex',
			name: 'treedx',
			version: treedxVersion,
			url: `https://hex.pm/api/packages/treedx/releases/${treedxVersion}`,
		}));
		for (const image of ['treeseed/treedx', 'treeseed/treedx-profiler']) {
			checks.push(await verifyDockerHubArtifact(image, treedxVersion));
		}
	}
	return checks;
}

async function verifyPublishedReleaseArtifacts(selectedVersions: Map<string, string>): Promise<{ checks: PublishedArtifactCheck[] }> {
	if (process.env.TREESEED_WORKFLOW_RELEASE_GATES_MODE === 'skip') {
		return { checks: [] };
	}
	let checks = await collectPublishedReleaseArtifactChecks(selectedVersions);
	const deadline = Date.now() + 5 * 60 * 1000;
	while (checks.some((check) => !check.ok) && Date.now() < deadline) {
		await sleep(15000);
		checks = await collectPublishedReleaseArtifactChecks(selectedVersions);
	}
	const failures = checks.filter((check) => !check.ok);
	if (failures.length > 0) {
		const rendered = failures
			.map((check) => `${check.id}: ${check.message ?? `registry returned ${check.status ?? 'unknown'}`} (${check.url})`)
			.join('\n');
		workflowError('release', 'validation_failed', `Published release artifact verification failed.\n${rendered}`, {
			details: { checks },
		});
	}
	return { checks };
}

function assertSessionBranchSafety(
	operation: TreeseedWorkflowRunCommand,
	session: TreeseedWorkflowSession,
	{
		requireCleanPackages = false,
		requireCurrentBranch = false,
		allowPackageReposWithoutOrigin = false,
	}: {
		requireCleanPackages?: boolean;
		requireCurrentBranch?: boolean;
		allowPackageReposWithoutOrigin?: boolean;
	} = {},
) {
	const detached = session.managedRepos.filter((repo) => repo.kind !== 'fixture' && repo.detached).map((repo) => repo.name);
	if (detached.length > 0) {
		workflowError(operation, 'validation_failed', `Detached managed repository heads detected: ${detached.join(', ')}.`, {
			details: { detached },
		});
	}
	if (requireCleanPackages) {
		const dirty = session.managedRepos.filter((repo) => repo.dirty).map((repo) => repo.name);
		if (dirty.length > 0) {
			workflowError(operation, 'validation_failed', `Dirty managed repos block ${operation}: ${dirty.join(', ')}.`, {
				details: { dirty },
			});
		}
	}
	if (requireCurrentBranch && session.branchName) {
		const missing = session.managedRepos
			.filter((repo) => repo.kind !== 'fixture')
			.filter((repo) => repo.branchName !== session.branchName)
			.map((repo) => ({ name: repo.name, branchName: repo.branchName }));
		if (missing.length > 0) {
			workflowError(operation, 'validation_failed', `Managed repository branch alignment is required for ${operation}.`, {
				details: { expectedBranch: session.branchName, repos: missing },
			});
		}
	}
	const missingOriginRepos = [
		session.rootRepo,
		...(allowPackageReposWithoutOrigin ? [] : session.managedRepos),
	]
		.filter((repo) => !repo.hasOriginRemote)
		.map((repo) => repo.name);
	if (missingOriginRepos.length > 0 && operation !== 'destroy') {
		workflowError(operation, 'validation_failed', `Missing origin remote on: ${missingOriginRepos.join(', ')}.`, {
			details: { missingOrigin: missingOriginRepos },
		});
	}
}

function previewStateFor(tenantRoot: string, branchName: string) {
	const deployConfig = loadTreeseedPlatformConfig({ tenantRoot, environment: 'staging', env: process.env }).deployConfig;
	return loadDeployState(tenantRoot, deployConfig, {
		target: createBranchPreviewDeployTarget(branchName),
	});
}

function branchPreviewInitialized(tenantRoot: string, branchName: string | null) {
	if (!branchName) return false;
	try {
		return previewStateFor(tenantRoot, branchName).readiness?.initialized === true;
	} catch {
		return false;
	}
}

async function reconcileWorkflowBranchPreview(
	tenantRoot: string,
	branchName: string,
	context: TreeseedWorkflowContext,
	{ initialize }: { initialize: boolean },
) {
return reconcileTreeseedBranchPreview({
		root: tenantRoot,
		branch: branchName,
		planOnly: false,
		execute: true,
		workflowRunId: context.workflow?.resumeRunId ?? undefined,
		initialize,
		env: context.env,
	});
}

export async function reconcileTreeseedBranchPreview(input: {
	root: string;
	branch: string;
	appId?: string[];
	planOnly: boolean;
	execute: boolean;
	workflowRunId?: string;
	initialize?: boolean;
	env?: NodeJS.ProcessEnv;
}): Promise<{
	status: 'planned' | 'reconciled';
	branch: string;
	initialize: boolean;
	reconcile: Awaited<ReturnType<typeof planTreeseedReconciliation>> | Awaited<ReturnType<typeof reconcileTreeseedTarget>>;
}> {
	const target = { kind: 'branch' as const, branchName: input.branch };
	const graph = compileTreeseedDesiredResourceGraph({ tenantRoot: input.root, target });
	const selector = {
		environment: 'staging' as const,
		resourceKind: ['branch-preview'],
		...(input.appId?.length ? { appId: input.appId } : {}),
	};
	const units = compileTreeseedDesiredUnitsFromGraph(graph, selector);
	const planOnly = input.planOnly || !input.execute;
	const reconcile = planOnly
		? await planTreeseedReconciliation({ tenantRoot: input.root, target, env: input.env ?? process.env, units, selector })
		: await reconcileTreeseedTarget({
			tenantRoot: input.root,
			target,
			env: input.env ?? process.env,
			units,
			selector,
			planOnly: false,
		});
	return {
		status: planOnly ? 'planned' : 'reconciled',
		branch: input.branch,
		initialize: input.initialize === true,
		reconcile,
	};
}

async function destroyWorkflowBranchPreviewIfPresent(tenantRoot: string, branchName: string, context?: TreeseedWorkflowContext) {
return destroyTreeseedBranchPreview({
		root: tenantRoot,
		branch: branchName,
		planOnly: false,
		execute: true,
		reason: 'close',
		env: context?.env,
	});
}

export async function destroyTreeseedBranchPreview(input: {
	root: string;
	branch: string;
	planOnly: boolean;
	execute: boolean;
	reason: 'close' | 'branch-delete' | 'expired' | 'manual';
	env?: NodeJS.ProcessEnv;
}): Promise<{
	status: 'planned' | 'destroyed';
	branch: string;
	reason: string;
	reconcile: Awaited<ReturnType<typeof planTreeseedReconciliation>> | { target: { kind: 'branch'; branchName: string }; results: TreeseedReconcileResult[] };
}> {
	const target = { kind: 'branch' as const, branchName: input.branch };
	const graph = compileTreeseedDesiredResourceGraph({ tenantRoot: input.root, target });
	const selector = {
		environment: 'staging' as const,
		resourceKind: ['branch-preview', 'branch-preview-cleanup'],
	};
	const units = compileTreeseedDesiredUnitsFromGraph(graph, selector).map((unit) =>
		unit.unitType === 'branch-preview-cleanup'
			? { ...unit, spec: { ...unit.spec, reason: input.reason } }
			: unit);
	const planOnly = input.planOnly || !input.execute;
	const reconcile = planOnly
		? await planTreeseedReconciliation({ tenantRoot: input.root, target, env: input.env ?? process.env, units, selector })
		: await destroyTreeseedTargetUnits({
			tenantRoot: input.root,
			target,
			env: input.env ?? process.env,
			units,
			selector,
		});
	return {
		status: planOnly ? 'planned' : 'destroyed',
		branch: input.branch,
		reason: input.reason,
		reconcile,
	};
}

function resolveDestroyConfirmation(
	context: TreeseedWorkflowContext,
	expected: string,
	input: TreeseedDestroyInput,
) {
	if (input.plan) {
		return true;
	}
	if (input.confirm === true) {
		return true;
	}
	if (typeof input.confirm === 'string') {
		return input.confirm === expected;
	}
	if (context.confirm) {
		return context.confirm(
			`Destroy Treeseed environment by confirming "${expected}"`,
			expected,
		);
	}
	return false;
}

function syncCurrentBranchToOrigin(operation: TreeseedWorkflowOperationId, repoDir: string, branch: string) {
	try {
		if (remoteBranchExists(repoDir, branch)) {
			runGit(['pull', '--rebase', 'origin', branch], { cwd: repoDir });
			runGit(['push', 'origin', branch], { cwd: repoDir });
			return {
				remoteBranchExisted: true,
				pulledRebase: true,
				pushed: true,
				createdRemoteBranch: false,
				conflicts: false,
			};
		}

		runGit(['push', '-u', 'origin', branch], { cwd: repoDir });
		return {
			remoteBranchExisted: false,
			pulledRebase: false,
			pushed: true,
			createdRemoteBranch: true,
			conflicts: false,
		};
	} catch {
		const report = collectMergeConflictReport(repoDir);
		throw new TreeseedWorkflowError(operation, 'merge_conflict', formatMergeConflictReport(report, repoDir, branch), {
			details: { branch, report },
			exitCode: 12,
		});
	}
}

async function maybeAutoSaveCurrentTaskBranch(
	helpers: WorkflowOperationHelpers,
	operation: 'stage' | 'close',
	input: { message: string; autoSave?: boolean; verify?: boolean; preview?: boolean },
) {
	const tenantRoot = resolveProjectRootOrThrow(operation, helpers.cwd());
	const root = workspaceRoot(tenantRoot);
	const repoDir = gitWorkflowRoot(root);
	const before = resolveRepoState(repoDir);
	const packageDirty = checkedOutWorkspacePackageRepos(root).some((pkg) => hasMeaningfulChanges(pkg.dir));
	if (!before.dirtyWorktree && !packageDirty) {
		return { performed: false, save: null };
	}
	if (input.autoSave === false) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires a clean worktree or autoSave enabled.`);
	}

	const saveResult = await workflowSave(helpers, {
		message: operation === 'close' ? `close: ${input.message}` : input.message,
		verify: input.verify === true,
		refreshPreview: false,
		preview: input.preview,
	});
	return {
		performed: true,
		save: saveResult.payload,
	};
}

function checkoutOrCreateSaveBranch(repoDir: string, branch: string) {
	const current = currentBranch(repoDir);
	if (current === branch) {
		return current;
	}
	if (branchExists(repoDir, branch)) {
		checkoutBranch(repoDir, branch);
		return branch;
	}
	if (remoteBranchExists(repoDir, branch)) {
		runGit(['checkout', '-b', branch, `origin/${branch}`], { cwd: repoDir });
		return branch;
	}
	runGit(['checkout', '-b', branch], { cwd: repoDir });
	return branch;
}

function runPackageVerifyLocal(pkgDir: string) {
	run('npm', ['run', 'verify:local'], { cwd: pkgDir });
}

function branchNeedsSync(repoDir: string, branch: string) {
	if (!remoteBranchExists(repoDir, branch)) {
		return true;
	}
	const localHead = runGit(['rev-parse', 'HEAD'], { cwd: repoDir, capture: true }).trim();
	const remoteHead = runGit(['rev-parse', `origin/${branch}`], { cwd: repoDir, capture: true }).trim();
	return localHead !== remoteHead;
}

function savePackageRepo(
	report: WorkflowRepoReport,
	message: string,
	branch: string,
	shouldVerify: boolean,
) {
	checkoutOrCreateSaveBranch(report.path, branch);
	report.branch = currentBranch(report.path);
	report.dirty = hasMeaningfulChanges(report.path);
	const needsSync = branchNeedsSync(report.path, branch);

	if (!report.dirty && !needsSync) {
		report.skippedReason = 'clean';
		report.commitSha = runGit(['rev-parse', 'HEAD'], { cwd: report.path, capture: true }).trim();
		return report;
	}

	if (shouldVerify && report.dirty) {
		runPackageVerifyLocal(report.path);
		report.verified = true;
	}

	if (report.dirty) {
		runGit(['add', '-A'], { cwd: report.path });
		runGit(['commit', '-m', message], { cwd: report.path });
		report.committed = true;
	}
	report.commitSha = runGit(['rev-parse', 'HEAD'], { cwd: report.path, capture: true }).trim();
	const branchSync = syncCurrentBranchToOrigin('save', report.path, branch);
	report.pushed = branchSync.pushed === true;
	if (!report.dirty && needsSync) {
		report.skippedReason = 'sync-only';
	}
	return report;
}

function createSaveFailure(
	message: string,
	repos: WorkflowRepoReport[],
	rootRepo: WorkflowRepoReport | null,
	failingRepo: WorkflowRepoReport | null,
	error: unknown,
): never {
	const rendered = error instanceof Error ? error.message : String(error);
	const code = error instanceof TreeseedWorkflowError ? error.code : 'unsupported_state';
	const exitCode = error instanceof TreeseedWorkflowError ? error.exitCode : undefined;
	throw new TreeseedWorkflowError('save', code, `${message}\n${rendered}`, {
		details: {
			partialFailure: {
				message,
				failingRepo: failingRepo?.name ?? null,
				repos,
				rootRepo,
				error: rendered,
			},
		},
		exitCode,
	});
}

function ensureLocalTaskBranch(repoDir: string, branchName: string) {
	if (!branchExists(repoDir, branchName) && !remoteBranchExists(repoDir, branchName)) {
		return false;
	}
	if (!branchExists(repoDir, branchName) && remoteBranchExists(repoDir, branchName)) {
		ensureLocalBranchTracking(repoDir, branchName);
	}
	if (currentBranch(repoDir) !== branchName) {
		checkoutBranch(repoDir, branchName);
	}
	return true;
}

function cleanupTaskBranchReport(
	report: WorkflowRepoReport,
	branchName: string,
	_message: string,
	{ deleteBranch = true, targetBranch = STAGING_BRANCH } = {},
) {
	if (!ensureLocalTaskBranch(report.path, branchName)) {
		report.skippedReason = 'branch-missing';
		return report;
	}

	const tag = createDeprecatedTaskTag(report.path, branchName, _message);
	report.tagName = tag.tagName;
	report.commitSha = updateHead(report.path);
	report.deletedRemote = deleteBranch ? deleteRemoteBranch(report.path, branchName) : false;
	syncBranchWithOrigin(report.path, targetBranch);
	if (deleteBranch) {
		deleteLocalBranch(report.path, branchName);
		report.deletedLocal = true;
	}
	report.branch = currentBranch(report.path) || targetBranch;
	report.dirty = hasMeaningfulChanges(report.path);
	return report;
}

function syncAllCheckedOutPackageRepos(root: string, branchName: string) {
	for (const pkg of checkedOutWorkspacePackageRepos(root)) {
		syncBranchWithOrigin(pkg.dir, branchName);
	}
}

function reattachRepairablePackageRepos(
	root: string,
	expectedBranches: string[] = [STAGING_BRANCH, PRODUCTION_BRANCH],
	options: {
		operation?: TreeseedWorkflowRunCommand;
		onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
		throwOnBlocker?: boolean;
	} = {},
) {
	const reports = checkedOutWorkspacePackageRepos(root).map((pkg) => {
		const report = reattachDetachedHeadIfSafe(pkg.dir, expectedBranches);
		if (report.repaired && report.targetBranch && report.headSha) {
			options.onProgress?.(`[workflow][repair] Reattached ${pkg.name} to ${report.targetBranch} at ${report.headSha.slice(0, 12)}.`);
		}
		return {
			name: pkg.name,
			path: pkg.dir,
			...report,
		};
	});
	const blockers = reports
		.filter((report) => report.detached && !report.repairable)
		.map((report) => `${report.name}: ${report.blocker ?? 'detached HEAD requires manual review.'}`);
	if (blockers.length > 0 && options.throwOnBlocker) {
		workflowError(options.operation ?? 'release', 'validation_failed', `Detached package heads require manual recovery:\n${blockers.join('\n')}`, {
			details: { blockers, reports },
		});
	}
	return { reports, blockers };
}

function collectReleasePackageSelection(root: string) {
	const publishable = sortWorkspacePackages(
		publishableWorkspacePackages(root).filter((pkg) => pkg.name?.startsWith('@treeseed/')),
	);
	const changed = changedWorkspacePackages({
		root,
		baseRef: PRODUCTION_BRANCH,
		includeDependents: false,
		packages: publishable,
	});
	const selected = changedWorkspacePackages({
		root,
		baseRef: PRODUCTION_BRANCH,
		includeDependents: true,
		packages: publishable,
	});
	const changedNames = changed.map((pkg) => pkg.name);
	const selectedNames = selected.map((pkg) => pkg.name);
	const dependents = selected
		.filter((pkg) => !changedNames.includes(pkg.name))
		.map((pkg) => pkg.name);
	return {
		changed: changedNames,
		dependents,
		selected: selectedNames,
		publishable,
	};
}

function hasStagedChanges(repoDir: string) {
	return runGit(['diff', '--cached', '--name-only'], { cwd: repoDir, capture: true }).trim().length > 0;
}

export async function workflowStatus(helpers: WorkflowOperationHelpers, input: TreeseedWorkflowStatusOptions = {}) {
	return withContextEnv(helpers.context.env, async () => {
		const resolved = resolveTreeseedWorkflowPaths(helpers.cwd());
		if (resolved.tenantRoot) {
			try {
				await ensureTreeseedSecretSessionForConfig({
					tenantRoot: resolved.cwd,
					interactive: false,
					env: helpers.context.env,
					createIfMissing: false,
					allowMigration: false,
				});
			} catch {
				// Status must remain observational. If secrets cannot be unlocked
				// non-interactively, the resulting state reports locked/missing config.
			}
		}
		return createStatusResult(helpers.cwd(), {
			...input,
			env: input.env ?? helpers.context.env,
		});
	});
}

export async function workflowCi(helpers: WorkflowOperationHelpers, input: TreeseedCiInput = {}) {
	return withContextEnv(helpers.context.env, async () => {
		try {
			const resolved = resolveTreeseedWorkflowPaths(helpers.cwd());
			const branch = currentBranch(repoRoot(resolved.cwd)) || null;
			const scope = branch === PRODUCTION_BRANCH ? 'prod' : branch === STAGING_BRANCH ? 'staging' : 'local';
			const env = resolved.tenantRoot
				? resolveTreeseedLaunchEnvironment({
					tenantRoot: resolved.cwd,
					scope,
					baseEnv: { ...process.env, ...(helpers.context.env ?? {}) },
				})
				: { ...process.env, ...(helpers.context.env ?? {}) };
			return await withContextEnv(env, () => createCiResult(helpers.cwd(), input));
		} catch (error) {
			if (error instanceof TreeseedWorkflowError) {
				throw error;
			}
			const message = error instanceof Error ? error.message : String(error);
			if (/GH_TOKEN|GITHUB_TOKEN|GitHub authentication|authenticated|Bad credentials|Requires authentication/iu.test(message)) {
				workflowError('ci', 'github_auth_unavailable', message, { exitCode: 2 });
			}
			workflowError('ci', 'validation_failed', message, { exitCode: 2 });
		}
	});
}

export async function workflowTasks(helpers: WorkflowOperationHelpers, input: TreeseedTasksInput = {}) {
	return withContextEnv(helpers.context.env, () => {
		const cwd = helpers.cwd();
		if (!input.cleanupMerged) return createTasksResult(cwd);
		const live = input.cleanupMerged === 'live';
		const repos = [
			{ name: '@treeseed/market', dir: repoRoot(cwd) },
			...checkedOutStagePromotionRepos(cwd).map((repo) => ({ name: repo.name, dir: repo.dir })),
		];
		const branchCleanup = repos.map((repo) => {
			const branches = inspectMergedRemoteTaskBranches(repo.dir).map((branch) => {
				if (branch.current) {
					return { ...branch, status: 'preserved' as const, reason: 'branch is currently checked out' };
				}
				if (!branch.head || !branch.mergedInto) {
					return { ...branch, status: 'preserved' as const, reason: 'branch is not merged into staging or main' };
				}
				if (!live) {
					return { ...branch, status: 'planned' as const, reason: `exact head is merged into ${branch.mergedInto}` };
				}
				deleteRemoteBranchIfMerged(repo.dir, branch.branch, branch.mergedInto, branch.head, { fetch: false });
				return { ...branch, status: 'deleted' as const, reason: `exact head was merged into ${branch.mergedInto}` };
			});
			return { repository: repo.name, path: repo.dir, branches };
		});
		return buildWorkflowResult('tasks', cwd, { tasks: [], workstreams: [], branchCleanup }, {
			executionMode: live ? 'execute' : 'plan',
			includeFinalState: false,
			summary: live ? 'Merged remote task branches were cleaned safely.' : 'Merged remote task branch cleanup plan ready.',
		});
	});
}

export async function workflowConfig(helpers: WorkflowOperationHelpers, input: TreeseedConfigInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('config', helpers.cwd());
			const scopes = normalizeConfigScopes(input);
			const sync = input.syncProviders ?? input.sync ?? 'all';
			const printEnv = input.printEnv === true;
			const revealSecrets = input.showSecrets === true;
			const printEnvOnly = input.printEnvOnly === true;
			const rotateMachineKeyFlag = input.rotateMachineKey === true;
			const connectMarketFlag = input.connectMarket === true;
			const bootstrapOnly = input.bootstrap === true;
			const bootstrapPreflight = bootstrapOnly && input.preflight === true;
			const nonInteractive = input.nonInteractive === true;
			const bootstrapSystemsInput = input.systems;
			const skipUnavailable = input.skipUnavailable;
			const bootstrapExecution = input.bootstrapExecution ?? 'parallel';
			const dependencyInstall = await installTreeseedDependencies({
				tenantRoot,
				force: input.installMissingTooling === true,
				env: helpers.context.env,
				write: (line: string) => maybePrint(helpers.write, line),
			});
			if (!dependencyInstall.ok) {
				workflowError(
					'config',
					'validation_failed',
					`Treeseed dependency initialization failed:\n- ${formatTreeseedDependencyFailureDetails(dependencyInstall)}`,
					{ details: { dependencies: dependencyInstall } },
				);
			}
			const repairs = input.repair === false ? [] : (resolveTreeseedWorkflowState(tenantRoot).deployConfigPresent ? applyTreeseedSafeRepairs(tenantRoot) : []);
			const toolHealth = ensureTreeseedActVerificationTooling({
				tenantRoot,
				installIfMissing: input.installMissingTooling === true,
				env: helpers.context.env,
				write: (line: string) => maybePrint(helpers.write, line),
			});
			const passphraseEnv = inspectTreeseedPassphraseEnvDiagnostic(helpers.context.env ?? process.env);
			const secretSession = (printEnvOnly && !revealSecrets) || bootstrapPreflight
				? {
					status: inspectTreeseedKeyAgentStatus(tenantRoot),
					createdWrappedKey: false,
					migratedWrappedKey: false,
					unlockSource: 'existing-session' as const,
				}
				: await ensureTreeseedSecretSessionForConfig({
					tenantRoot,
					interactive: false,
					env: helpers.context.env,
					createIfMissing: true,
					allowMigration: true,
				});

			ensureTreeseedGitignoreEntries(tenantRoot);
			const preflight = collectCliPreflight({ cwd: tenantRoot, requireAuth: false });
			const contextSnapshot = collectTreeseedConfigContext({
				tenantRoot,
				scopes,
				env: helpers.context.env,
			});
			if (bootstrapPreflight && !secretSession.status.unlocked && !passphraseEnv.configured) {
				workflowError(
					'config',
					'validation_failed',
					`${passphraseEnv.envVar} is not visible to this Codex process. ${passphraseEnv.recommendedLaunch}`,
					{
						details: {
							passphraseEnv,
							secretSession: secretSession.status,
						},
					},
				);
			}

			if (printEnvOnly) {
				const reports = await Promise.all(scopes.map(async (scope) => ({
					scope,
					environment: collectTreeseedPrintEnvReport({
						tenantRoot,
						scope,
						env: helpers.context.env,
						revealSecrets,
					}),
					provider: await checkTreeseedProviderConnections({ tenantRoot, scope, env: helpers.context.env }),
				})));
				return buildWorkflowResult(
					'config',
					tenantRoot,
					{
						mode: 'print-env-only',
						scopes,
						sync,
						secretsRevealed: revealSecrets,
						reports,
						repairs,
						preflight,
						toolHealth,
						context: contextSnapshot,
						secretSession,
					},
					{
						nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Initialize the selected environment after reviewing the generated values.', input: { environment: scopes } },
						]),
					},
				);
			}

			if (rotateMachineKeyFlag) {
				const result = rotateTreeseedMachineKey(tenantRoot);
				return buildWorkflowResult(
					'config',
					tenantRoot,
					{
						mode: 'rotate-machine-key',
						scopes,
						sync,
						keyPath: result.keyPath,
						repairs,
						preflight,
						toolHealth,
						context: contextSnapshot,
						secretSession,
					},
					{
						nextSteps: createNextSteps([
						{ operation: 'config', reason: 'Inspect the regenerated local environment after the machine key rotation.', input: { environment: ['local'], printEnvOnly: true } },
						]),
					},
				);
			}

			if (connectMarketFlag) {
				return connectTreeseedMarketProject(helpers, tenantRoot, input, {
					scopes,
					sync,
					repairs,
					preflight,
					toolHealth,
				});
			}

			if (bootstrapPreflight) {
				maybePrint(helpers.write, 'Preparing bootstrap preflight...');
				const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
				const plansByScope = await Promise.all(scopes
					.filter((scope) => scope !== 'local')
					.map(async (scope) => {
						maybePrint(helpers.write, `Deriving desired units for ${scope}...`);
						const target = createPersistentDeployTarget(scope);
						const derived = deriveTreeseedDesiredUnits({ tenantRoot, target });
						const selection = resolveTreeseedBootstrapSelection({
							deployConfig: derived.deployConfig,
							env: contextSnapshot.valuesByScope[scope] ?? helpers.context.env ?? process.env,
							systems: bootstrapSystemsInput,
							skipUnavailable,
						});
						const selectedUnits = filterTreeseedDesiredUnitsByBootstrapSystems(
							derived.units,
							selection.runnable.filter((system) => system !== 'github'),
						);
						const registry = createTreeseedReconcileRegistry(derived.deployConfig);
						const capabilityMatrix = selectedUnits.map((unit) => {
							const adapter = registry.get(unit.unitType, unit.provider);
							return {
								unitId: unit.unitId,
								unitType: unit.unitType,
								provider: unit.provider,
								logicalName: unit.logicalName,
								requiredPostconditions: adapter.requiredPostconditions?.({
									context: {
										tenantRoot,
										target,
										deployConfig: derived.deployConfig,
										launchEnv: helpers.context.env ?? process.env,
										session: new Map(),
										write: (line: string) => maybePrint(helpers.write, line),
									},
									unit,
									persistedState: null,
								}) ?? [],
								verificationSupported: typeof adapter.verify === 'function',
							};
						});
						const planned = await planTreeseedReconciliation({
							tenantRoot,
							target,
							env: helpers.context.env,
							systems: selection.runnable.filter((system) => system !== 'github'),
							write: (line: string) => maybePrint(helpers.write, line),
						});
						return {
							scope,
							bootstrapSystems: selection,
							resourceInventory: buildProvisioningSummary(derived.deployConfig, loadDeployState(tenantRoot, derived.deployConfig, { target }), target),
							capabilityMatrix: await Promise.all(capabilityMatrix.map(async (entry) => ({
								...entry,
								requiredPostconditions: await Promise.resolve(entry.requiredPostconditions),
							}))),
							plans: planned.plans.map((plan) => ({
								unitId: plan.unit.unitId,
								unitType: plan.unit.unitType,
								provider: plan.unit.provider,
								action: plan.diff.action,
								reasons: plan.diff.reasons,
							})),
						};
					}));
				return buildWorkflowResult(
					'config',
					tenantRoot,
					{
						mode: 'bootstrap-preflight',
						scopes,
						sync,
						configPath,
						keyPath,
						repairs,
						preflight,
						toolHealth,
						passphraseEnv,
						secretSession,
						context: contextSnapshot,
						resourceInventoryByScope: Object.fromEntries(plansByScope.map((entry) => [entry.scope, entry.resourceInventory])),
						verificationPreflight: plansByScope,
						bootstrapSystemsByScope: Object.fromEntries(plansByScope.map((entry) => [entry.scope, entry.bootstrapSystems])),
					},
					{
						nextSteps: createNextSteps([
							{ operation: 'config', reason: 'Run bootstrap once the verification preflight is clean.', input: { environment: scopes, bootstrap: true } },
						]),
					},
				);
			}

			const explicitUpdates = Array.isArray((input as Record<string, unknown>).updates)
				? (input as Record<string, { scope: string; entryId: string; value: string; reused?: boolean }[]>).updates
					.map((update) => ({
						scope: update.scope as (typeof scopes)[number],
						entryId: String(update.entryId ?? ''),
						value: typeof update.value === 'string' ? update.value : '',
						reused: update.reused === true,
					}))
				: null;
			if (!bootstrapOnly && !explicitUpdates && !nonInteractive) {
				workflowError(
					'config',
					'validation_failed',
					'Treeseed config requires interactive input or explicit updates. Re-run in a TTY, or use --non-interactive/--json from the CLI when you want resolved values applied automatically.',
				);
			}
			const autoUpdates = scopes.flatMap((scope) =>
				contextSnapshot.entriesByScope[scope].map((entry) => ({
					scope,
					entryId: entry.id,
					value: entry.effectiveValue,
					reused: entry.currentValue.length > 0 || entry.suggestedValue.length > 0,
				})),
			);
			const applyResult = bootstrapOnly
				? { updated: [], sharedStorageMigrations: [] }
				: (() => {
					maybePrint(helpers.write, 'Saving resolved configuration values to machine config...');
					return applyTreeseedConfigValues({
						tenantRoot,
						updates: explicitUpdates ?? autoUpdates,
					});
				})();
			if (bootstrapOnly) {
				maybePrint(helpers.write, 'Bootstrapping platform reconciliation from existing configuration...');
			}
			const finalizeResult = await finalizeTreeseedConfig({
				tenantRoot,
				scopes,
				sync,
				env: helpers.context.env,
				checkConnections: bootstrapOnly || sync !== 'none' || scopes.some((scope) => scope !== 'local'),
				initializePersistent: bootstrapOnly,
				systems: bootstrapSystemsInput,
				skipUnavailable,
				bootstrapExecution,
				onProgress: (line, stream) => maybePrint(helpers.write, line, stream),
			});
			const refreshedContext = collectTreeseedConfigContext({
				tenantRoot,
				scopes,
				env: helpers.context.env,
			});
			const reports = printEnv
				? await Promise.all(scopes.map(async (scope) => ({
					scope,
					environment: collectTreeseedPrintEnvReport({
						tenantRoot,
						scope,
						env: helpers.context.env,
						revealSecrets,
					}),
					provider: finalizeResult.connectionChecks.find((report) => report.scope === scope) ?? await checkTreeseedProviderConnections({ tenantRoot, scope, env: helpers.context.env }),
				})))
				: [];
			const { configPath, keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
			const state = resolveTreeseedWorkflowState(tenantRoot);
			return buildWorkflowResult(
				'config',
				tenantRoot,
				{
					mode: bootstrapOnly ? 'bootstrap' : 'configure',
					scopes,
					sync,
					configPath,
					keyPath,
					repairs,
					preflight,
					toolHealth,
					passphraseEnv,
					secretSession,
					context: refreshedContext,
					result: {
						...applyResult,
						...finalizeResult,
					},
					reports,
					state,
					readiness: state.readiness,
				},
				createNextSteps([
					...(scopes.includes('local') ? [{ operation: 'dev', reason: 'Start the local Treeseed runtime on the initialized local environment.' }] : []),
					...(scopes.includes('staging') ? [{ operation: 'status', reason: 'Confirm staging readiness after initializing shared services.' }] : []),
					{ operation: 'switch', reason: 'Create or resume a task branch once the runtime foundation is ready.', input: { branch: 'feature/my-change', preview: true } },
				]),
			);
		});
	} catch (error) {
		toError('config', error);
	}
}

export async function workflowExport(helpers: WorkflowOperationHelpers, input: TreeseedExportInput = {}) {
	return await withContextEnv(helpers.context.env, async () => {
		const directory = resolve(helpers.context.cwd ?? helpers.cwd(), input.directory ?? '.');
		const exported = await exportTreeseedCodebase({ directory });
		return buildWorkflowResult('export', exported.tenantRoot, {
			...exported,
			...worktreePayload(exported.tenantRoot, input.worktreeMode),
		});
	});
}

export async function workflowSwitch(helpers: WorkflowOperationHelpers, input: TreeseedSwitchInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('switch', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const branchName = String(input.branch ?? input.branchName ?? '').trim();
			if (!branchName) {
				workflowError('switch', 'validation_failed', 'Treeseed switch requires a branch name.');
			}
			reattachRepairablePackageRepos(root, [branchName, STAGING_BRANCH, PRODUCTION_BRANCH], {
				operation: 'switch',
				onProgress: (line, stream) => helpers.write(line, stream),
				throwOnBlocker: true,
			});
			const session = resolveTreeseedWorkflowSession(root);
			const preview = input.preview === true;
			const adoptChanges = input.adoptChanges === true;
			const executionMode = normalizeExecutionMode(input);
			if (executionMode !== 'plan' && !adoptChanges && shouldDispatchSwitchToManagedWorktree(root, input, helpers.context.env)) {
				const managed = ensureManagedWorkflowWorktree({
					root,
					branchName,
					mode: input.worktreeMode,
					env: helpers.context.env,
				});
				const result = await workflowSwitch(helpersForCwd(helpers, managed.worktreePath), {
					...input,
					worktreeMode: 'off',
				});
				return {
					...result,
					payload: {
						...(result.payload as Record<string, unknown>),
						worktreeMode: input.worktreeMode ?? 'auto',
						worktreePath: managed.worktreePath,
						managedWorktree: managed,
					},
				};
			}
			const mode = session.mode;
			const repoDir = session.gitRoot;
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createManagedWorkflowRepoReports(root);
			let previewResult: Record<string, unknown> | null = null;
			const dirtyRepos = [rootRepo, ...packageReports].filter((repo) => repo.dirty).map((repo) => repo.name);

			if (executionMode === 'plan') {
				for (const report of [rootRepo, ...packageReports]) {
					const local = branchExists(report.path, branchName);
					const remote = remoteBranchExists(report.path, branchName);
					report.created = !local && !remote;
					report.resumed = local || remote;
				}
				const previewPlan = preview
					? await reconcileTreeseedBranchPreview({
						root,
						branch: branchName,
						planOnly: true,
						execute: false,
						initialize: !branchPreviewInitialized(root, branchName),
						env: helpers.context.env,
					})
					: null;
				return buildWorkflowResult(
					'switch',
					root,
					{
						mode,
						branchName,
						rootRepo,
						repos: packageReports,
						previewRequested: preview,
						worktreeMode: input.worktreeMode ?? 'auto',
						worktreePath: effectiveWorkflowWorktreeMode(input.worktreeMode, helpers.context.env) === 'on'
							? plannedManagedWorkflowWorktreePath(root, branchName)
							: null,
						blockers: !adoptChanges && dirtyRepos.length > 0 ? [`Clean worktrees required: ${dirtyRepos.join(', ')}`] : [],
						plannedSteps: [
							{ id: 'switch-root', description: `Switch market repo to ${branchName}` },
							...packageReports.map((report) => ({ id: `switch-${report.name}`, description: `Mirror ${branchName} into ${report.name}` })),
							{ id: 'workspace-link', description: 'Apply local workspace links for integrated development' },
							...(preview ? [{ id: 'preview', description: `Provision or refresh preview for ${branchName}` }] : []),
						],
						previewPlan,
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'switch', reason: 'Run without --plan to create or resume the task branch.', input: { branch: branchName, preview } },
						]),
					},
				);
			}

			if (adoptChanges) {
				const reports = [rootRepo, ...packageReports];
				const existingTargets = reports.filter((report) => branchExists(report.path, branchName) || remoteBranchExists(report.path, branchName));
				if (existingTargets.length > 0) {
					workflowError('switch', 'validation_failed', `--adopt-changes requires a new branch; ${branchName} already exists in ${existingTargets.map((report) => report.name).join(', ')}.`);
				}
				const unsafeDirtyRepos = reports.filter((report) => report.dirty && currentBranch(report.path) !== STAGING_BRANCH);
				if (unsafeDirtyRepos.length > 0) {
					workflowError('switch', 'validation_failed', `--adopt-changes only accepts dirty staging repositories: ${unsafeDirtyRepos.map((report) => report.name).join(', ')}.`);
				}
			} else if (mode === 'recursive-workspace') {
				assertWorkspaceClean(root);
				assertSessionBranchSafety('switch', session);
			} else {
				assertCleanWorktree(root);
			}
			const workflowRun = acquireWorkflowRun(
				'switch',
				session,
				{ branch: branchName, preview, adoptChanges, worktreeMode: input.worktreeMode ?? 'auto' },
				[
					{ id: 'switch-root', description: `Switch market repo to ${branchName}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true },
					...packageReports.map((report) => ({
						id: `switch-${report.name}`,
						description: `Mirror ${branchName} into ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch: branchName,
						resumable: true,
					})),
					{ id: 'workspace-link', description: 'Apply local workspace links', repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true },
					...(preview ? [{ id: 'preview', description: `Provision or refresh preview ${branchName}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true }] : []),
				],
				helpers.context,
			);

			try {
				const rootSwitch = await executeJournalStep(root, workflowRun.runId, 'switch-root', () =>
					(adoptChanges ? checkoutNewTaskBranchWithChanges : checkoutTaskBranchFromStaging)(repoDir, branchName, {
						createIfMissing: input.createIfMissing !== false,
						pushIfCreated: true,
					}),
				);
				rootRepo.branch = currentBranch(repoDir) || branchName;
				rootRepo.created = rootSwitch.created;
				rootRepo.resumed = rootSwitch.resumed;
				rootRepo.commitSha = headCommit(repoDir);
				rootRepo.pushed = rootSwitch.created;

				for (const managedRepo of checkedOutManagedWorkflowRepos(root)) {
					const report = findReportByName(packageReports, managedRepo.name);
					if (!report) {
						continue;
					}
					const packageSwitch = await executeJournalStep(root, workflowRun.runId, `switch-${report.name}`, () =>
						(adoptChanges ? checkoutNewTaskBranchWithChanges : checkoutTaskBranchFromStaging)(managedRepo.dir, branchName, {
							createIfMissing: input.createIfMissing !== false,
							pushIfCreated: false,
						}),
					);
					report.branch = currentBranch(managedRepo.dir) || branchName;
					report.created = packageSwitch.created;
					report.resumed = packageSwitch.resumed;
					report.commitSha = headCommit(managedRepo.dir);
					report.dirty = hasMeaningfulChanges(managedRepo.dir);
				}

				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, input.workspaceLinks ?? 'auto'));
				const stateAfterSwitch = resolveTreeseedWorkflowState(root);
				if (preview) {
					previewResult = await executeJournalStep(root, workflowRun.runId, 'preview', () =>
						reconcileWorkflowBranchPreview(root, branchName, helpers.context, { initialize: !stateAfterSwitch.preview.enabled }),
					) ?? null;
				}

				const state = resolveTreeseedWorkflowState(root);
				const payload = {
					mode,
					branchName,
					created: rootRepo.created,
					resumed: rootRepo.resumed,
					repos: packageReports,
					rootRepo,
					previewRequested: preview,
					preview: {
						enabled: state.preview.enabled,
						url: state.preview.url,
						lastDeploymentTimestamp: state.preview.lastDeploymentTimestamp,
					},
					previewResult,
					workspaceLinks,
					...worktreePayload(root, input.worktreeMode),
					preconditions: {
						cleanWorktreeRequired: !adoptChanges,
						adoptedDirtyStagingChanges: adoptChanges,
						baseBranch: STAGING_BRANCH,
					},
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'switch',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							state.preview.enabled
								? { operation: 'save', reason: 'Persist and verify the current task branch, then refresh its preview deployment.', input: { message: 'describe your change', preview: true } }
								: { operation: 'dev', reason: 'Start the local development environment for this task branch.' },
							{ operation: 'stage', reason: 'Merge the task into staging once the task branch is verified.', input: { message: 'describe the resolution' } },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'switch',
					message: `Resume the interrupted switch for ${branchName}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('switch', error);
	}
}

type TreeseedUpdateStrategy = 'merge' | 'ff-only';
type TreeseedUpdateRepoAction = 'planned' | 'up-to-date' | 'merged' | 'fast-forwarded' | 'pushed' | 'blocked';

type TreeseedUpdateRepoResult = {
	name: string;
	path: string;
	branch: string;
	sourceRef: string;
	action: TreeseedUpdateRepoAction;
	beforeHead: string | null;
	afterHead: string | null;
	pushed: boolean;
	changedFiles: string[];
	blockers: string[];
	ahead?: number | null;
	behind?: number | null;
	status?: 'up-to-date' | 'merge-needed' | 'fast-forward' | 'blocked';
};

type TreeseedUpdateConflict = {
	repo: string;
	path: string;
	files: string[];
};

function normalizeUpdateStrategy(strategy: TreeseedUpdateInput['strategy']): TreeseedUpdateStrategy {
	return strategy === 'ff-only' ? 'ff-only' : 'merge';
}

function normalizeUpdateSource(source: string | undefined) {
	const normalized = String(source ?? STAGING_BRANCH).trim();
	return normalized || STAGING_BRANCH;
}

function gitOutput(args: string[], cwd: string, allowFailure = false) {
	return runTreeseedGit(args, {
		cwd,
		mode: classifyTreeseedGitMode(args),
		allowFailure,
	}).stdout.trim();
}

function updateHead(repoDir: string) {
	return gitOutput(['rev-parse', 'HEAD'], repoDir, true) || null;
}

function updateStatusLines(repoDir: string) {
	const output = gitOutput(['status', '--porcelain'], repoDir, true);
	return output ? output.split(/\r?\n/u).filter(Boolean) : [];
}

function updateChangedFiles(repoDir: string) {
	return updateStatusLines(repoDir)
		.map((line) => line.slice(3).trim())
		.filter(Boolean);
}

function updateConflictedFiles(repoDir: string) {
	return updateStatusLines(repoDir)
		.filter((line) => {
			const status = line.slice(0, 2);
			return status.includes('U') || ['AA', 'DD'].includes(status);
		})
		.map((line) => line.slice(3).trim())
		.filter(Boolean);
}

function sourceBranchExists(repoDir: string, sourceBranch: string) {
	return runTreeseedGit(['ls-remote', '--exit-code', '--heads', 'origin', sourceBranch], {
		cwd: repoDir,
		mode: 'read',
		allowFailure: true,
	}).status === 0;
}

function localRemoteRefExists(repoDir: string, sourceBranch: string) {
	return runTreeseedGitOk(['show-ref', '--verify', `refs/remotes/origin/${sourceBranch}`], {
		cwd: repoDir,
		mode: 'read',
	});
}

function updateAheadBehind(repoDir: string, branch: string, sourceRef: string) {
	if (!localRemoteRefExists(repoDir, sourceRef.replace(/^origin\//u, ''))) {
		return { ahead: null, behind: null };
	}
	const output = gitOutput(['rev-list', '--left-right', '--count', `${branch}...${sourceRef}`], repoDir, true);
	const [aheadRaw, behindRaw] = output.split(/\s+/u);
	const ahead = Number.parseInt(aheadRaw ?? '', 10);
	const behind = Number.parseInt(behindRaw ?? '', 10);
	return {
		ahead: Number.isFinite(ahead) ? ahead : null,
		behind: Number.isFinite(behind) ? behind : null,
	};
}

function updatePlanChangedFiles(repoDir: string, sourceRef: string) {
	if (!runTreeseedGitOk(['show-ref', '--verify', `refs/remotes/${sourceRef}`], { cwd: repoDir, mode: 'read' })) {
		return [];
	}
	const output = gitOutput(['diff', '--name-only', `HEAD...${sourceRef}`], repoDir, true);
	return output ? output.split(/\r?\n/u).filter(Boolean).slice(0, 50) : [];
}

function planUpdateRepo(name: string, repoDir: string, branch: string, sourceBranch: string, strategy: TreeseedUpdateStrategy): TreeseedUpdateRepoResult {
	const sourceRef = `origin/${sourceBranch}`;
	const blockers: string[] = [];
	if (!sourceBranchExists(repoDir, sourceBranch)) {
		blockers.push(`origin/${sourceBranch} does not exist`);
	}
	const { ahead, behind } = blockers.length === 0 ? updateAheadBehind(repoDir, branch, sourceRef) : { ahead: null, behind: null };
	const status: TreeseedUpdateRepoResult['status'] = blockers.length > 0
		? 'blocked'
		: behind === 0
			? 'up-to-date'
			: strategy === 'ff-only' && ahead === 0
				? 'fast-forward'
				: 'merge-needed';
	return {
		name,
		path: repoDir,
		branch,
		sourceRef,
		action: blockers.length > 0 ? 'blocked' : 'planned',
		beforeHead: updateHead(repoDir),
		afterHead: null,
		pushed: false,
		changedFiles: updatePlanChangedFiles(repoDir, sourceRef),
		blockers,
		ahead,
		behind,
		status,
	};
}

function ensureUpdateRepoReady(operation: 'update', repo: TreeseedWorkflowSession['rootRepo'] | TreeseedWorkflowSession['managedRepos'][number], expectedBranch?: string) {
	if (repo.detached || !repo.branchName) {
		workflowError(operation, 'validation_failed', `${repo.name} is detached; update requires attached branches.`, {
			details: { repo },
		});
	}
	if (expectedBranch && repo.branchName !== expectedBranch) {
		workflowError(operation, 'validation_failed', `${repo.name} is on ${repo.branchName}, expected ${expectedBranch}.`, {
			details: { repo, expectedBranch },
		});
	}
	if (repo.dirty) {
		workflowError(operation, 'validation_failed', `${repo.name} has local changes. Run \`npx trsd save --json "checkpoint before update"\` first.`, {
			details: { repo },
		});
	}
	if (!repo.hasOriginRemote) {
		workflowError(operation, 'validation_failed', `${repo.name} is missing an origin remote.`, {
			details: { repo },
		});
	}
}

function formatUpdateConflict(repoName: string, repoDir: string, sourceBranch: string, targetBranch: string) {
	const files = updateConflictedFiles(repoDir);
	const status = updateStatusLines(repoDir);
	return {
		message: [
			`Treeseed update hit a merge conflict in ${repoName}.`,
			`Repository: ${repoDir}`,
			`Target branch: ${targetBranch}`,
			`Source branch: origin/${sourceBranch}`,
			files.length > 0 ? `Conflicted files:\n${files.map((file) => `- ${file}`).join('\n')}` : 'Conflicted files: inspect git status.',
			'Resolve the conflicts in that repository, then run `npx trsd save --json "resolve update conflict"` or abort manually and rerun `npx trsd update --from staging --json`.',
		].join('\n'),
		files,
		status,
	};
}

function mergeUpdateRepo(input: {
	name: string;
	repoDir: string;
	branch: string;
	sourceBranch: string;
	strategy: TreeseedUpdateStrategy;
	push: boolean;
}) {
	const sourceRef = `origin/${input.sourceBranch}`;
	const beforeHead = updateHead(input.repoDir);
	runTreeseedGit(['fetch', 'origin'], { cwd: input.repoDir, mode: 'mutate' });
	if (!sourceBranchExists(input.repoDir, input.sourceBranch)) {
		return {
			name: input.name,
			path: input.repoDir,
			branch: input.branch,
			sourceRef,
			action: 'blocked' as const,
			beforeHead,
			afterHead: beforeHead,
			pushed: false,
			changedFiles: [],
			blockers: [`origin/${input.sourceBranch} does not exist`],
		};
	}
	const mergeArgs = input.strategy === 'ff-only'
		? ['merge', '--ff-only', sourceRef]
		: ['merge', '--no-edit', sourceRef];
	const merge = runTreeseedGit(mergeArgs, {
		cwd: input.repoDir,
		mode: 'mutate',
		allowFailure: true,
	});
	if (merge.status !== 0) {
		const conflict = formatUpdateConflict(input.name, input.repoDir, input.sourceBranch, input.branch);
		throw new TreeseedWorkflowError('update', 'merge_conflict', conflict.message, {
			details: {
				repo: input.name,
				path: input.repoDir,
				files: conflict.files,
				status: conflict.status,
				sourceBranch: input.sourceBranch,
				targetBranch: input.branch,
			},
			exitCode: 12,
		});
	}
	const afterHead = updateHead(input.repoDir);
	const changed = beforeHead !== afterHead;
	let pushed = false;
	if (changed && input.push) {
		runTreeseedGit(['push', 'origin', input.branch], { cwd: input.repoDir, mode: 'mutate' });
		pushed = true;
	}
	return {
		name: input.name,
		path: input.repoDir,
		branch: input.branch,
		sourceRef,
		action: changed ? (input.strategy === 'ff-only' ? 'fast-forwarded' as const : 'merged' as const) : 'up-to-date' as const,
		beforeHead,
		afterHead,
		pushed,
		changedFiles: [],
		blockers: [],
	};
}

function commitRootUpdateIfNeeded(root: string, branch: string, push: boolean) {
	const changedFiles = updateChangedFiles(repoRoot(root));
	if (changedFiles.length === 0) {
		let pushed = false;
		if (push) {
			runTreeseedGit(['push', 'origin', branch], { cwd: repoRoot(root), mode: 'mutate' });
			pushed = true;
		}
		return {
			committed: false,
			pushed,
			commitSha: updateHead(repoRoot(root)),
			changedFiles,
		};
	}
	runTreeseedGit(['add', '-A'], { cwd: repoRoot(root), mode: 'mutate' });
	runTreeseedGit(['commit', '-m', `chore(workflow): update ${branch} from staging`], { cwd: repoRoot(root), mode: 'mutate' });
	const commitSha = updateHead(repoRoot(root));
	let pushed = false;
	if (push) {
		runTreeseedGit(['push', 'origin', branch], { cwd: repoRoot(root), mode: 'mutate' });
		pushed = true;
	}
	return {
		committed: true,
		pushed,
		commitSha,
		changedFiles,
	};
}

export async function workflowUpdate(helpers: WorkflowOperationHelpers, input: TreeseedUpdateInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('update', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const session = resolveTreeseedWorkflowSession(root);
			const sourceBranch = normalizeUpdateSource(input.from);
			const strategy = normalizeUpdateStrategy(input.strategy);
			const push = input.push !== false;
			const executionMode = normalizeExecutionMode(input);
			const branch = session.branchName;
			if (!branch) {
				workflowError('update', 'validation_failed', 'Treeseed update requires an attached current branch.');
			}
			if (branch === STAGING_BRANCH || branch === PRODUCTION_BRANCH) {
				workflowError('update', 'validation_failed', `Treeseed update must run from a task branch, not ${branch}.`, {
					details: { branch },
				});
			}
			if (sourceBranch === branch) {
				workflowError('update', 'validation_failed', 'Treeseed update source branch cannot match the current branch.', {
					details: { branch, sourceBranch },
				});
			}
			ensureUpdateRepoReady('update', session.rootRepo);
			for (const repo of session.managedRepos) {
				ensureUpdateRepoReady('update', repo, branch);
			}

			const repoPlans = session.managedRepos.map((repo) =>
				planUpdateRepo(repo.name, repo.path, branch, sourceBranch, strategy));
			const rootPlan = planUpdateRepo('@treeseed/market', session.gitRoot, branch, sourceBranch, strategy);
			const blockers = [...repoPlans, rootPlan].flatMap((repo) => repo.blockers.map((blocker) => `${repo.name}: ${blocker}`));

			if (executionMode === 'plan') {
				return buildWorkflowResult('update', root, {
					mode: session.mode,
					branch,
					sourceBranch,
					sourceRef: `origin/${sourceBranch}`,
					strategy,
					pushed: false,
					plan: true,
					repos: repoPlans,
					rootRepo: rootPlan,
					conflicts: [],
					blockers,
					...worktreePayload(root, input.worktreeMode),
				}, {
					executionMode,
					includeFinalState: false,
					nextSteps: createNextSteps([
						{ operation: 'update', reason: 'Run without --plan to merge staging into the current branch.', input: { from: sourceBranch } },
					]),
				});
			}

			if (blockers.length > 0) {
				workflowError('update', 'validation_failed', `Treeseed update is blocked:\n${blockers.join('\n')}`, {
					details: { blockers, repos: repoPlans, rootRepo: rootPlan },
				});
			}

			const workflowRun = acquireWorkflowRun(
				'update',
				session,
				{ from: sourceBranch, strategy, push, workspaceLinks: input.workspaceLinks ?? 'auto' },
				[
					{ id: 'validate-update', description: `Validate update from ${sourceBranch}`, repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
					...session.managedRepos.map((repo) => ({
						id: `update-${repo.name}`,
						description: `Merge origin/${sourceBranch} into ${repo.name}`,
						repoName: repo.name,
						repoPath: repo.path,
						branch,
						resumable: true,
					})),
					{ id: 'update-root', description: `Merge origin/${sourceBranch} into market`, repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
					{ id: 'refresh-root-pointers', description: 'Commit updated root pointers if package heads changed', repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
					{ id: 'restore-workspace-links', description: 'Restore local workspace links', repoName: session.rootRepo.name, repoPath: session.rootRepo.path, branch, resumable: true },
				],
				helpers.context,
			);

			try {
				await executeJournalStep(root, workflowRun.runId, 'validate-update', () => ({
					branch,
					sourceBranch,
					strategy,
					push,
				}));
				const repos: TreeseedUpdateRepoResult[] = [];
				for (const repo of session.managedRepos) {
					const result = await executeJournalStep(root, workflowRun.runId, `update-${repo.name}`, () =>
						mergeUpdateRepo({
							name: repo.name,
							repoDir: repo.path,
							branch,
							sourceBranch,
							strategy,
							push,
						}));
					if (result) repos.push(result);
				}
				const rootMerge = await executeJournalStep(root, workflowRun.runId, 'update-root', () =>
					mergeUpdateRepo({
						name: '@treeseed/market',
						repoDir: session.gitRoot,
						branch,
						sourceBranch,
						strategy,
						push: false,
					}));
				const rootCommit = await executeJournalStep(root, workflowRun.runId, 'refresh-root-pointers', () =>
					commitRootUpdateIfNeeded(root, branch, push));
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'restore-workspace-links', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, input.workspaceLinks ?? 'auto'));

				const rootRepo = {
					...rootMerge!,
					action: rootCommit?.committed ? 'committed' as const : rootMerge!.action,
					commitSha: rootCommit?.commitSha ?? rootMerge!.afterHead,
					pushed: rootCommit?.pushed ?? false,
					changedFiles: rootCommit?.changedFiles ?? rootMerge!.changedFiles,
				};
				const payload = {
					mode: session.mode,
					branch,
					sourceBranch,
					sourceRef: `origin/${sourceBranch}`,
					strategy,
					pushed: push,
					plan: false,
					repos,
					rootRepo,
					conflicts: [] as TreeseedUpdateConflict[],
					workspaceLinks,
					...worktreePayload(root, input.worktreeMode),
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult('update', root, payload, {
					runId: workflowRun.runId,
					summary: `Treeseed update merged ${sourceBranch} into ${branch}.`,
					includeFinalState: false,
					nextSteps: createNextSteps([
						{ operation: 'save', reason: 'Checkpoint any follow-up conflict resolutions or generated pointer changes.', input: { message: 'sync with staging' } },
						{ operation: 'stage', reason: 'Merge the updated task branch into staging when it is ready.', input: { message: 'describe the resolution' } },
					]),
				});
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'update',
					message: `Resume the interrupted update for ${branch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('update', error);
	}
}

export async function workflowDev(helpers: WorkflowOperationHelpers, input: TreeseedWorkflowDevInput = {}) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			if (helpers.context.transport === 'api') {
				workflowError('dev', 'unsupported_transport', 'Treeseed dev is not supported over the HTTP workflow API.');
			}
			const tenantRoot = resolveProjectRootOrThrow('dev', helpers.cwd());
			const workspaceLinks = ensureWorkflowWorkspaceLinks(workspaceRoot(tenantRoot), helpers, input.workspaceLinks ?? 'auto');
			const readiness = ensureLocalReadinessOrThrow('dev', tenantRoot);
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'local', override: true });
			assertTreeseedCommandEnvironment({ tenantRoot, scope: 'local', purpose: 'dev' });
			const args = [packageScriptPath('tenant-dev')];
			if (input.watch) {
				args.push('--watch');
			}
			if (input.port !== undefined) {
				args.push('--port', String(input.port));
			}
			const env = resolveTreeseedLaunchEnvironment({
				tenantRoot,
				scope: 'local',
				baseEnv: { ...process.env, ...(helpers.context.env ?? {}) },
			});
			if (input.background) {
				const child = spawn(process.execPath, args, {
					cwd: tenantRoot,
					env,
					stdio: input.stdio ?? 'inherit',
					detached: process.platform !== 'win32',
				});
				return buildWorkflowResult('dev', tenantRoot, {
					watch: input.watch === true,
					background: true,
					command: process.execPath,
					args,
					cwd: tenantRoot,
					pid: child.pid ?? null,
					exitCode: null,
					runtime: {
						mode: process.env.TREESEED_LOCAL_DEV_MODE ?? 'cloudflare',
						apiBaseUrl: process.env.TREESEED_API_BASE_URL ?? 'http://127.0.0.1:3000',
						webUrl: 'http://127.0.0.1:8787',
					},
					readiness: readiness.readiness.local,
					workspaceLinks,
				});
			}

			const result = spawnSync(process.execPath, args, {
				cwd: tenantRoot,
				env,
				stdio: input.stdio ?? 'inherit',
			});
			return buildWorkflowResult('dev', tenantRoot, {
				watch: input.watch === true,
				background: false,
				command: process.execPath,
				args,
				cwd: tenantRoot,
				pid: null,
				exitCode: result.status ?? 1,
				runtime: {
					mode: process.env.TREESEED_LOCAL_DEV_MODE ?? 'cloudflare',
					apiBaseUrl: process.env.TREESEED_API_BASE_URL ?? 'http://127.0.0.1:3000',
					webUrl: 'http://127.0.0.1:8787',
				},
				readiness: readiness.readiness.local,
				workspaceLinks,
			});
		});
	} catch (error) {
		toError('dev', error);
	}
}

export async function workflowSave(helpers: WorkflowOperationHelpers, input: TreeseedSaveInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('save', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			ensureTreeseedLocalStateExcluded(root);
			const rootBranch = currentBranch(repoRoot(root)) || null;
			reattachRepairablePackageRepos(root, [rootBranch, STAGING_BRANCH, PRODUCTION_BRANCH].filter((branch): branch is string => Boolean(branch)), {
				operation: 'save',
				onProgress: (line, stream) => helpers.write(line, stream),
				throwOnBlocker: true,
			});
			const session = resolveTreeseedWorkflowSession(root);
			const gitRoot = session.gitRoot;
			const branch = session.branchName;
			const scope = branch === STAGING_BRANCH ? 'staging' : branch === PRODUCTION_BRANCH ? 'prod' : 'local';
			const beforeState = resolveTreeseedWorkflowState(root);
			const recursiveWorkspace = session.mode === 'recursive-workspace';
			const mode = session.mode;
			const executionMode = normalizeExecutionMode(input);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId ?? null;
			const autoResumeRun = executionMode === 'execute' && !explicitResumeRunId
				? findAutoResumableSaveRun(root, branch)
				: null;
			rejectImplicitWorkflowResume('save', autoResumeRun);
			const planAutoResumeRun = null;
			const effectiveInput = autoResumeRun
				? (autoResumeRun.input as unknown as TreeseedSaveInput)
				: input;
			const localCleanup = maybeRunLocalWorkflowCleanup(helpers, root, 'save', effectiveInput);
			const message = String(effectiveInput.message ?? '').trim();
			const saveLane = normalizeSaveLane(effectiveInput.lane);
			const saveCiMode = 'off' as const;
			const releaseCandidateMode = 'skip' as const;
			const optionsHotfix = effectiveInput.hotfix === true;
			const previewInitialized = branchPreviewInitialized(root, branch);

			applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope, override: true });

			if (!branch) {
				workflowError('save', 'validation_failed', 'Treeseed save requires an active git branch.');
			}
			if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
				workflowError('save', 'unsupported_state', 'Treeseed save is blocked on main unless --hotfix is explicitly set.');
			}

			const packageReports = createManagedWorkflowRepoReports(root);
			const rootRepo = createRepoReport('@treeseed/market', gitRoot, branch, hasMeaningfulChanges(gitRoot));
			const blockers: string[] = [];

			if (executionMode === 'plan') {
				if (!session.rootRepo.hasOriginRemote) {
					blockers.push('Market repo is missing origin remote.');
				}
				if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
					blockers.push('Main saves require --hotfix.');
				}
				const repositoryPlan = planRepositorySave({
					root,
					gitRoot,
					branch,
					message,
					bump: (effectiveInput.bump ?? 'patch') as ReleaseBumpLevel,
					devVersionStrategy: (effectiveInput.devVersionStrategy ?? 'prerelease') as SaveDevVersionStrategy,
					devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-commit',
					gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin',
					gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl',
					verifyMode: normalizeSaveVerifyMode(effectiveInput.verify === false ? 'skip' : effectiveInput.verifyMode),
					commitMessageMode: (effectiveInput.commitMessageMode ?? 'auto') as SaveCommitMessageMode,
				});
				const applicationSelection = selectWorkflowApplications(root);
				const workspaceLinks = inspectWorkspaceDependencyMode(root, { mode: effectiveInput.workspaceLinks ?? 'auto', env: helpers.context.env });
				return buildWorkflowResult(
					'save',
					root,
					{
						mode,
						branch,
						scope,
						hotfix: optionsHotfix,
						message,
						repos: repositoryPlan.repos,
						rootRepo: repositoryPlan.rootRepo,
						blockers,
						autoResumeCandidate: planAutoResumeRun
							? {
								runId: planAutoResumeRun.runId,
								branch: planAutoResumeRun.session.branchName,
								failure: planAutoResumeRun.failure,
							}
							: null,
						workspaceLinks,
						sceneArtifacts: normalizeSceneArtifactsMode(effectiveInput.sceneArtifacts),
						localCleanup,
						ciMode: saveCiMode,
						lane: saveLane,
						verifyMode: effectiveInput.verifyMode ?? 'fast',
						releaseCandidateMode,
						applicationSelection,
						...worktreePayload(root, effectiveInput.worktreeMode),
						repositoryPlan,
						waves: repositoryPlan.waves,
						plannedVersions: repositoryPlan.plannedVersions,
						plannedSteps: [
							{ id: 'workspace-unlink', description: 'Remove local workspace links before deployment install and lockfile updates' },
							...repositoryPlan.plannedSteps,
							{ id: 'lockfile-validation', description: 'Validate refreshed package-lock.json files before any save commit is pushed' },
							...(shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
								? [{ id: 'hosted-ci', description: saveHostedEnvironmentForBranch(branch) ? `Reconcile and verify hosted deployments for ${saveHostedEnvironmentForBranch(branch)}` : `Wait for hosted save workflows on ${branch}` }]
								: []),
							...(saveLane === 'promotion'
								? [{ id: 'release-proof', description: 'Run or reuse authoritative hosted release proof records for exact package refs' }]
								: []),
							...(branch === STAGING_BRANCH && releaseCandidateMode !== 'skip'
								? [{ id: 'release-candidate', description: `Run ${releaseCandidateMode} release-candidate readiness checks for the saved staging state` }]
								: []),
							{ id: 'workspace-link', description: 'Restore local workspace links after save' },
							...((beforeState.branchRole === 'feature' && (effectiveInput.preview === true || previewInitialized))
								? [{ id: 'preview', description: `Refresh preview deployment for ${branch}` }]
								: []),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'save', reason: planAutoResumeRun ? `Run without --plan to resume ${planAutoResumeRun.runId}.` : 'Run without --plan to persist the workspace checkpoint.', input: { message, hotfix: optionsHotfix, preview: effectiveInput.preview === true } },
						]),
					},
				);
			}

			assertSessionBranchSafety('save', session, {
				allowPackageReposWithoutOrigin: true,
			});
			try {
				originRemoteUrl(gitRoot);
			} catch {
				workflowError('save', 'validation_failed', 'Treeseed save requires an origin remote.');
			}

			const workflowRun = acquireWorkflowRun(
				'save',
				session,
				{
					message,
					hotfix: optionsHotfix,
					preview: effectiveInput.preview === true,
					refreshPreview: effectiveInput.refreshPreview !== false,
					verify: effectiveInput.verify !== false,
					bump: effectiveInput.bump ?? 'patch',
					devVersionStrategy: effectiveInput.devVersionStrategy ?? 'prerelease',
					devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-commit',
					gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin',
					gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl',
						verifyMode: effectiveInput.verifyMode ?? (effectiveInput.verify === false ? 'skip' : 'fast'),
					ciMode: saveCiMode,
					lane: saveLane,
					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
					commitMessageMode: effectiveInput.commitMessageMode ?? 'auto',
					workspaceLinks: effectiveInput.workspaceLinks ?? 'auto',
					releaseCandidate: releaseCandidateMode,
					verifyDeployedResources: effectiveInput.verifyDeployedResources === true,
				},
				[
					{
						id: 'save-repositories',
						description: 'Save dependency-ordered repositories',
						repoName: rootRepo.name,
						repoPath: rootRepo.path,
						branch,
						resumable: true,
					},
					...(shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
						? [{
							id: 'hosted-ci',
							description: saveHostedEnvironmentForBranch(branch) ? `Reconcile and verify hosted deployments for ${saveHostedEnvironmentForBranch(branch)}` : `Wait for hosted save workflows on ${branch}`,
							repoName: rootRepo.name,
							repoPath: rootRepo.path,
							branch,
							resumable: true,
						}]
						: []),
					...(saveLane === 'promotion'
						? [{
							id: 'release-proof',
							description: 'Run authoritative hosted release proof records',
							repoName: rootRepo.name,
							repoPath: rootRepo.path,
							branch,
							resumable: true,
						}]
						: []),
					...(branch === STAGING_BRANCH && releaseCandidateMode !== 'skip'
						? [{
							id: 'release-candidate',
							description: 'Run release-candidate readiness checks',
							repoName: rootRepo.name,
							repoPath: rootRepo.path,
							branch,
							resumable: true,
						}]
						: []),
					...((beforeState.branchRole === 'feature' && (effectiveInput.preview === true || (effectiveInput.refreshPreview !== false && previewInitialized)))
						? [{
							id: 'preview',
							description: `Refresh preview ${branch}`,
							repoName: rootRepo.name,
							repoPath: rootRepo.path,
							branch,
							resumable: true,
						}]
						: []),
				],
				autoResumeRun
					? {
						...helpers.context,
						workflow: {
							...(helpers.context.workflow ?? {}),
							resumeRunId: autoResumeRun.runId,
						},
					}
					: helpers.context,
			);
			if (autoResumeRun) {
				helpers.write(`[workflow][resume] Resuming interrupted save ${autoResumeRun.runId} on ${branch}.`);
			}
			helpers.write(`[save][workflow] Preparing save on ${branch} (${mode}, ${scope}).`);

			try {
				const saveResult = await executeJournalStep(root, workflowRun.runId, 'save-repositories', () =>
					(async () => {
						helpers.write('[save][workflow] Saving repositories and validating lockfiles.');
						unlinkWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
						try {
							return await runRepositorySaveOrchestrator({
								root,
								gitRoot,
								branch,
								message,
									bump: (effectiveInput.bump ?? 'patch') as ReleaseBumpLevel,
									devVersionStrategy: (effectiveInput.devVersionStrategy ?? 'prerelease') as SaveDevVersionStrategy,
									devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-commit',
									gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin',
									gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl',
									verifyMode: normalizeSaveVerifyMode(effectiveInput.verify === false ? 'skip' : effectiveInput.verifyMode),
									commitMessageMode: (effectiveInput.commitMessageMode ?? 'auto') as SaveCommitMessageMode,
									workflowRunId: workflowRun.runId,
						deferPushUntilVerified: false,
									onProgress: (line, stream) => helpers.write(line, stream),
								onWaveSaved: branch === STAGING_BRANCH && shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
									? async ({ nodes, reports, rootRepo: waveRootRepo }) => {
										const nonRootReportsForWave = reports.filter((repo, index) => nodes[index]?.id !== '.');
										const rootReportForWave = nodes.some((node) => node.id === '.')
											? waveRootRepo
											: null;
										const hostedEnvironment = saveHostedEnvironmentForBranch(branch);
										const gates = [
											...gatesForSavedRepositoryReports(root, nonRootReportsForWave),
											...(rootReportForWave && !hostedEnvironment ? gateForSavedRootReport(rootReportForWave, branch, scope) : []),
										];
										if (gates.length === 0) {
											return [];
										}
										const repositoryNames = gates.map((gate) => gate.name).join(', ');
										if (nonRootReportsForWave.length > 0) {
											helpers.write(`[save][workflow] Waiting for hosted repository gates before saving dependents: ${repositoryNames}.`);
										} else if (rootReportForWave && !hostedEnvironment) {
											helpers.write('[save][workflow] Waiting for hosted market deploy gate.');
										}
										return waitForWorkflowGates('save', gates, 'hosted', {
											root,
											runId: workflowRun.runId,
											onProgress: (line, stream) => helpers.write(line, stream),
										});
									}
									: undefined,
							});
						} finally {
							ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
						}
					})());
				const savedPackageReports = saveResult?.repos ?? packageReports;
				const savedRootRepo = saveResult?.rootRepo ?? rootRepo;
				helpers.write('[save][workflow] Repository save phase complete; checking command readiness.');
				const head = savedRootRepo.commitSha ?? runGit(['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim();
				const commitCreated = savedRootRepo.committed === true;
				const branchSync = {
					...(savedRootRepo.publishWait ?? {}),
					pushed: savedRootRepo.pushed === true,
				};
				const workspaceLinks = inspectWorkspaceDependencyMode(root, { mode: effectiveInput.workspaceLinks ?? 'auto', env: helpers.context.env });
				const commandReadiness = ensureTreeseedCommandReadiness(root);
				const lockfileValidation = {
					root: savedRootRepo.lockfileValidation,
					repos: savedPackageReports.map((repo) => ({
						name: repo.name,
						path: repo.path,
						lockfileValidation: repo.lockfileValidation,
					})),
				};
				const saveWorkflowGates = shouldUseHostedSaveCi(effectiveInput, branch, saveLane)
					? await executeJournalStep(root, workflowRun.runId, 'hosted-ci', async () =>
						{
							const hostedEnvironment = saveHostedEnvironmentForBranch(branch);
							if (hostedEnvironment) {
								const workflowGates = saveResult?.workflowGates ?? [];
								return {
									workflowGates,
									hostedReconcile: await reconcileSaveHostedEnvironment(root, hostedEnvironment, helpers, workflowRun.runId),
								};
							}
							helpers.write('[save][workflow] Waiting for hosted save workflow gates.');
							return waitForWorkflowGates('save', [
							...(branch !== STAGING_BRANCH && savedRootRepo.pushed && savedRootRepo.commitSha && branch
								? [{
									name: savedRootRepo.name,
									repoPath: savedRootRepo.path,
									workflow: 'verify.yml',
									branch,
									headSha: savedRootRepo.commitSha,
								}]
								: []),
							...((branch === STAGING_BRANCH || effectiveInput.verifyDeployedResources === true) && scope !== 'local' && savedRootRepo.pushed && savedRootRepo.commitSha && branch
								? [hostedDeployGate({
									name: savedRootRepo.name,
									repoPath: savedRootRepo.path,
									workflow: 'deploy.yml',
									branch,
									headSha: savedRootRepo.commitSha,
								})]
								: []),
							...savedPackageReports
								.filter((repo) => repo.pushed && repo.commitSha && repo.branch)
								.flatMap((repo) => {
									return hostedWorkflowsForSavedRepository(root, repo).map((workflow) => {
										const gate = {
											name: repo.name,
											repoPath: repo.path,
											workflow,
											branch: String(repo.branch),
											headSha: String(repo.commitSha),
										};
										return /^deploy(?:[-.]|$)/u.test(workflow) ? hostedDeployGate(gate) : gate;
									});
								}),
						], 'hosted', {
							root,
							runId: workflowRun.runId,
							onProgress: (line, stream) => helpers.write(line, stream),
						}).then((workflowGates) => ({ workflowGates }));
						})
					: { workflowGates: [] };
				const releaseProof = saveLane === 'promotion' && process.env.TREESEED_STAGE_WAIT_MODE !== 'skip'
					? await executeJournalStep(root, workflowRun.runId, 'release-proof', async () => {
						helpers.write('[save][workflow] Running authoritative hosted release proof.');
						const proof = await runTreeseedProof({
							root,
							target: scope === 'prod' ? 'prod' : scope === 'local' ? 'local' : 'staging',
							driver: 'github-hosted',
							write: (line, stream) => helpers.write(line, stream),
						});
						if (proof.failures.length > 0) {
							const first = proof.failures[0]!;
							workflowError('save', 'validation_failed', [
								'Treeseed promotion proof failed.',
								`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
								first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
								'Hosted GitHub workflow proof is authoritative; local action simulation is advisory.',
							].filter(Boolean).join('\n'), { details: { proof } });
						}
						return proof;
					})
					: (saveLane === 'promotion'
						? (skipJournalStep(root, workflowRun.runId, 'release-proof', { skippedReason: 'disabled' }), { skipped: true, reason: 'disabled' })
						: null);
					const releaseCandidate = branch === STAGING_BRANCH
						&& releaseCandidateMode !== 'skip'
						&& process.env.TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE !== 'skip'
						? await executeJournalStep(root, workflowRun.runId, 'release-candidate', () => {
							helpers.write(`[save][workflow] Running staging release-candidate proof checks (${releaseCandidateMode}).`);
							const releaseSession = resolveTreeseedWorkflowSession(root);
						const stagingReleasePlan = buildReleasePlanSnapshot({
							root,
							mode,
							level: (effectiveInput.bump ?? 'patch') as string,
							packageSelection: releaseSession.packageSelection,
							packageReports: savedPackageReports,
							rootRepo: savedRootRepo,
							blockers: [],
						});
						return runReleaseCandidateProofForPlan('save', root, stagingReleasePlan, {
							mode: releaseCandidateMode,
							lane: saveLane,
							write: (line, stream) => helpers.write(line, stream),
						});
						})
						: (branch === STAGING_BRANCH && releaseCandidateMode !== 'skip'
							? (skipJournalStep(root, workflowRun.runId, 'release-candidate', { mode: releaseCandidateMode, status: 'skipped' }), {
								mode: releaseCandidateMode,
								status: 'skipped' as const,
								reason: 'release candidate rehearsal disabled',
							})
							: null);

				let previewAction: Record<string, unknown> = { status: 'skipped' };
				if (beforeState.branchRole === 'feature' && branch) {
					if (effectiveInput.preview === true) {
						previewAction = {
							status: previewInitialized ? 'refreshed' : 'created',
							details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
								reconcileWorkflowBranchPreview(root, branch, helpers.context, { initialize: !previewInitialized })),
						};
					} else if (effectiveInput.refreshPreview !== false && previewInitialized) {
						previewAction = {
							status: 'refreshed',
							details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
								reconcileWorkflowBranchPreview(root, branch, helpers.context, { initialize: false })),
						};
					}
				}
				const applicationSelection = selectWorkflowApplications(root, {
					packageSelection: {
						selected: savedPackageReports.map((report) => report.name),
					},
				});
				const hostingAudit = await workflowHostedVerificationGateRequired(
					'save',
					root,
					helpers,
					scope === 'prod' ? 'prod' : scope === 'local' ? 'local' : 'staging',
					{
						enabled: effectiveInput.verifyDeployedResources === true,
						strict: true,
						live: effectiveInput.verifyDeployedResources === true,
						appId: singleSelectedWorkflowAppId(applicationSelection),
					},
				);

				const payload = {
					mode: saveResult?.mode ?? mode,
					branch,
					scope,
					hotfix: optionsHotfix,
					message,
					resumed: workflowRun.resumed,
					resumedRunId: workflowRun.resumed ? workflowRun.runId : null,
					autoResumed: autoResumeRun != null,
					commitSha: head,
					commitCreated,
					noChanges: !commitCreated,
					branchSync,
					repos: savedPackageReports,
					rootRepo: savedRootRepo,
					waves: saveResult?.waves ?? [],
					plannedVersions: saveResult?.plannedVersions ?? {},
					partialFailure: null,
					previewAction,
					mergeConflict: null,
					workspaceLinks,
					commandReadiness,
					lockfileValidation,
					ciMode: saveCiMode,
					lane: saveLane,
					verifyMode: effectiveInput.verifyMode ?? 'fast',
					releaseCandidateMode,
					applicationSelection,
					workflowGates: saveWorkflowGates?.workflowGates ?? [],
					hostedReconcile: saveWorkflowGates?.hostedReconcile ?? null,
					releaseCandidate,
					releaseProof,
					hostingAudit,
					...worktreePayload(root, effectiveInput.worktreeMode),
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'save',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							branch === STAGING_BRANCH
								? { operation: 'release', reason: 'Promote the validated staging branch into production.', input: { bump: 'patch' } }
								: branch === PRODUCTION_BRANCH
									? { operation: 'status', reason: 'Inspect production state after the explicit hotfix save.' }
									: { operation: 'stage', reason: 'Merge the verified task branch into staging.', input: { message: 'describe the resolution' } },
						]),
					},
				);
			} catch (error) {
				const saveError = repositorySaveErrorDetails(error);
				const savedPartialFailure = saveError.details?.partialFailure as {
					message: string;
					failingRepo: string;
					phase?: string | null;
					currentVersion?: string | null;
					expectedTag?: string | null;
					tagState?: Record<string, unknown> | null;
					nextCommand?: string | null;
					repos: WorkflowRepoReport[];
					rootRepo: WorkflowRepoReport | null;
					error: string;
				} | undefined;
				const failingRepo = savedPartialFailure?.repos.find((report) => report.name === savedPartialFailure.failingRepo)
					?? packageReports.find((report) => report.dirty && report.pushed !== true)
					?? rootRepo;
				const wrappedError = error instanceof TreeseedWorkflowError && error.details?.partialFailure != null
					? error
					: new TreeseedWorkflowError(
						'save',
						error instanceof TreeseedWorkflowError ? error.code : 'unsupported_state',
						error instanceof Error ? error.message : String(error),
						{
							details: {
								...(error instanceof TreeseedWorkflowError ? (error.details ?? {}) : {}),
								...(saveError.details ?? {}),
								partialFailure: savedPartialFailure ?? {
									message: 'Treeseed save stopped before the workspace could finish syncing.',
									failingRepo: failingRepo.name,
									repos: packageReports,
									rootRepo,
									error: error instanceof Error ? error.message : String(error),
								},
							},
							exitCode: error instanceof TreeseedWorkflowError ? error.exitCode : saveError.exitCode,
						},
					);
				failWorkflowRun(root, workflowRun.runId, wrappedError, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'save',
					message: `Resume the interrupted save on ${branch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw wrappedError;
			}
		});
	} catch (error) {
		toError('save', error);
	}
}

export async function workflowClose(helpers: WorkflowOperationHelpers, input: TreeseedCloseInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('close', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const executionMode = normalizeExecutionMode(input);
			const session = resolveTreeseedWorkflowSession(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId ?? null;
			const autoResumeRun = executionMode === 'execute' && !explicitResumeRunId
				? findAutoResumableTaskRun(root, 'close', session.branchName)
				: null;
			rejectImplicitWorkflowResume('close', autoResumeRun);
			const planAutoResumeRun = null;
			const effectiveInput = autoResumeRun
				? (autoResumeRun.input as unknown as TreeseedCloseInput)
				: input;
			const message = ensureMessage('close', effectiveInput.message, 'a close reason');
			if (executionMode === 'plan') {
				const branchName = session.branchName;
				const blockers = session.branchRole !== 'feature'
					? ['Close only applies to task branches.']
					: [];
				return buildWorkflowResult(
					'close',
					root,
					{
						mode: session.mode,
						branchName,
						message,
						autoResumeCandidate: planAutoResumeRun
							? {
								runId: planAutoResumeRun.runId,
								branch: planAutoResumeRun.session.branchName,
								failure: planAutoResumeRun.failure,
							}
							: null,
						...worktreePayload(root, effectiveInput.worktreeMode),
						autoSaveRequired: session.rootRepo.dirty || session.managedRepos.some((repo) => repo.dirty),
						repos: createManagedWorkflowRepoReports(root),
						rootRepo: createWorkspaceRootRepoReport(root),
						blockers,
						plannedSteps: [
							{ id: 'workspace-unlink', description: 'Remove local workspace links before task cleanup' },
							{ id: 'preview-cleanup', description: `Destroy preview resources for ${branchName ?? '(current task)'}` },
							{ id: 'cleanup-root', description: `Archive and delete ${branchName ?? '(current task)'} in market` },
							...checkedOutManagedWorkflowRepos(root).map((repo) => ({
								id: `cleanup-${repo.name}`,
								description: `Archive and delete ${branchName ?? '(current task)'} in ${repo.name}`,
							})),
							{ id: 'workspace-link', description: 'Restore local workspace links on the final branch' },
							...(isManagedWorkflowWorktree(root)
								? [{ id: 'worktree-cleanup', description: 'Remove managed workflow worktree' }]
								: []),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'close', reason: 'Run without --plan to archive and delete the task branch.', input: { message } },
						]),
					},
				);
			}
				const autoSave = await maybeAutoSaveCurrentTaskBranch(helpers, 'close', {
					message,
					autoSave: effectiveInput.autoSave,
				});
				const activeSession = resolveTreeseedWorkflowSession(root);
			const featureBranch = assertFeatureBranch(root);
			const mode = activeSession.mode;
			const repoDir = activeSession.gitRoot;
			const managedWorktreeForClose = isManagedWorkflowWorktree(root);
			assertSessionBranchSafety('close', activeSession);
			if (mode === 'recursive-workspace') {
				assertWorkspaceClean(root);
			} else {
				assertCleanWorktree(root);
			}

			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createManagedWorkflowRepoReports(root);
			const workflowRun = acquireWorkflowRun(
				'close',
				activeSession,
				{
					message,
					deletePreview: effectiveInput.deletePreview !== false,
					deleteBranch: effectiveInput.deleteBranch !== false,
					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
				},
				[
					{ id: 'workspace-unlink', description: 'Remove local workspace links', repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'preview-cleanup', description: `Destroy preview resources for ${featureBranch}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'cleanup-root', description: `Archive ${featureBranch} in market`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					...packageReports.map((report) => ({
						id: `cleanup-${report.name}`,
						description: `Archive ${featureBranch} in ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch: featureBranch,
						resumable: true,
					})),
					{ id: 'workspace-link', description: 'Restore local workspace links', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					...(isManagedWorkflowWorktree(root)
						? [{ id: 'worktree-cleanup', description: 'Remove managed workflow worktree', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: false }]
						: []),
				],
				autoResumeRun
					? {
						...helpers.context,
						workflow: {
							...(helpers.context.workflow ?? {}),
							resumeRunId: autoResumeRun.runId,
						},
					}
					: helpers.context,
			);
			if (autoResumeRun) {
				helpers.write(`[workflow][resume] Resuming interrupted close ${autoResumeRun.runId} on ${featureBranch}.`);
			}

			try {
					await executeJournalStep(root, workflowRun.runId, 'workspace-unlink', () =>
						unlinkWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'), { rerunCompleted: true });
				const previewCleanup = effectiveInput.deletePreview === false
					? (skipJournalStep(root, workflowRun.runId, 'preview-cleanup', { performed: false }), { performed: false })
					: await executeJournalStep(root, workflowRun.runId, 'preview-cleanup', () => destroyWorkflowBranchPreviewIfPresent(root, featureBranch, helpers.context));
				const rootCleanup = await executeJournalStep(root, workflowRun.runId, 'cleanup-root', () => {
					const head = updateHead(repoDir);
					const tag = createDeprecatedTaskTag(repoDir, featureBranch, `close: ${message}`);
					const deletedRemote = effectiveInput.deleteBranch === false ? false : deleteRemoteBranch(repoDir, featureBranch);
					if (!managedWorktreeForClose) {
						syncBranchWithOrigin(repoDir, STAGING_BRANCH);
					}
					if (effectiveInput.deleteBranch !== false && !managedWorktreeForClose) {
						deleteLocalBranch(repoDir, featureBranch);
					}
					return {
						head,
						tagName: tag.tagName,
						deletedRemote,
						deletedLocal: effectiveInput.deleteBranch !== false && !managedWorktreeForClose,
						branch: managedWorktreeForClose ? featureBranch : (currentBranch(repoDir) || STAGING_BRANCH),
						dirty: hasMeaningfulChanges(repoDir),
					};
				});
				rootRepo.tagName = typeof rootCleanup?.tagName === 'string' ? rootCleanup.tagName : null;
				rootRepo.commitSha = String(rootCleanup?.head ?? rootRepo.commitSha ?? '');
				rootRepo.deletedRemote = rootCleanup?.deletedRemote === true;
				rootRepo.deletedLocal = rootCleanup?.deletedLocal === true;
				rootRepo.branch = typeof rootCleanup?.branch === 'string' ? rootCleanup.branch : (currentBranch(repoDir) || STAGING_BRANCH);
				rootRepo.dirty = rootCleanup?.dirty === true;

				for (const managedRepo of checkedOutManagedWorkflowRepos(root)) {
					const report = findReportByName(packageReports, managedRepo.name);
					if (!report) {
						continue;
					}
					const cleanup = await executeJournalStep(root, workflowRun.runId, `cleanup-${report.name}`, () =>
						cleanupTaskBranchReport(report, featureBranch, `close: ${message}`, {
							deleteBranch: effectiveInput.deleteBranch !== false,
							targetBranch: STAGING_BRANCH,
						}));
					Object.assign(report, cleanup);
				}
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				const finalBranch = managedWorktreeForClose ? STAGING_BRANCH : (currentBranch(repoDir) || STAGING_BRANCH);
				const managedWorktree = managedWorkflowWorktreeMetadata(root);
				const worktreeCleanup = managedWorktreeForClose
					? await executeJournalStep(root, workflowRun.runId, 'worktree-cleanup', () => removeManagedWorkflowWorktree(root, {
						deleteBranch: effectiveInput.deleteBranch !== false,
					}))
					: { removed: false, reason: 'not-managed' };
				if ((worktreeCleanup as { deletedLocalBranch?: boolean }).deletedLocalBranch === true) {
					rootRepo.deletedLocal = true;
					rootRepo.branch = STAGING_BRANCH;
				}

				const payload = {
					mode,
					branchName: featureBranch,
					message,
					autoSaved: autoSave.performed,
					autoSaveResult: autoSave.save,
					repos: packageReports,
					rootRepo,
					previewCleanup,
					remoteDeleted: rootRepo.deletedRemote,
					localDeleted: rootRepo.deletedLocal,
					finalBranch,
					workspaceLinks,
					worktreeCleanup,
					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
					managedWorktree,
					worktreePath: managedWorktree?.worktreePath ?? null,
					primaryRoot: managedWorktree?.primaryRoot ?? null,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'close',
					root,
					payload,
					{
						runId: workflowRun.runId,
						includeFinalState: !managedWorktreeForClose,
						nextSteps: createNextSteps([
							{ operation: 'tasks', reason: 'Inspect the remaining task branches after closing this one.' },
						]),
					},
				);
			} catch (error) {
				ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'close',
					message: `Resume the interrupted close for ${featureBranch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('close', error);
	}
}

type StageVerifyMode = 'action' | 'local' | 'none';
type StageCiMode = 'off' | 'hosted';
type StageCleanupMode = 'success' | 'manual';

type StageRepoPlan = {
	name: string;
	path: string;
	kind: 'root' | 'managed';
	repoKind?: TreeseedManagedRepository['kind'];
	sourceBranch: string;
	targetBranch: typeof STAGING_BRANCH;
	remoteSourceExists: boolean;
	beforeHead: string | null;
	stagingHeadBefore: string | null;
	integratedHead?: string | null;
	promotedHead?: string | null;
	cleanup?: {
		localDeleted: boolean;
		remoteDeleted: boolean;
		worktreeRemoved?: boolean;
	};
};

type StageCandidateManifest = {
	schemaVersion: 2;
	kind: 'treeseed.stage-candidate';
	candidateId: string;
	runId: string;
	branchName: string;
	targetBranch: typeof STAGING_BRANCH;
	createdAt: string;
	root: {
		repo: '@treeseed/market';
		commit: string;
		verified: boolean;
	};
	packages: Array<{
		name: string;
		path: string;
		repoKind?: TreeseedManagedRepository['kind'];
		commit: string;
		lockfileHash: string | null;
		dependencies: string[];
		remote: string | null;
		verified: boolean;
	}>;
	verification: {
		mode: StageVerifyMode;
		status: 'passed' | 'skipped';
		completedAt: string | null;
	};
	stagingHeadsBefore: Record<string, string | null>;
};

function stagingCandidateWorkflowGates(root: string, manifest: StageCandidateManifest): GitHubActionsWorkflowGate[] {
	const gates: GitHubActionsWorkflowGate[] = [];
	const add = (name: string, repoPath: string, headSha: string, workflow: string, deploy = false) => {
		if (!workflowFileExists(repoPath, workflow)) return;
		const gate: GitHubActionsWorkflowGate = { name, repoPath, workflow, branch: STAGING_BRANCH, headSha };
		gates.push(deploy ? hostedDeployGate(gate) : gate);
	};
	for (const pkg of manifest.packages) {
		const repoPath = resolve(root, pkg.path);
		if (manifest.stagingHeadsBefore[pkg.name] !== pkg.commit) {
			add(pkg.name, repoPath, pkg.commit, 'verify.yml');
		}
		if (manifest.stagingHeadsBefore[pkg.name] !== pkg.commit && existsSync(resolve(repoPath, 'treeseed.site.yaml'))) {
			add(pkg.name, repoPath, pkg.commit, 'deploy.yml', true);
		}
	}
	const marketRoot = repoRoot(root);
	add('@treeseed/market', marketRoot, manifest.root.commit, 'verify.yml');
	add('@treeseed/market', marketRoot, manifest.root.commit, 'deploy.yml', true);
	return gates;
}

function normalizeStageVerifyMode(value: unknown): StageVerifyMode {
	return value === 'local' || value === 'none' ? value : 'action';
}

function normalizeStageCiMode(input: TreeseedStageInput): StageCiMode {
	if (input.async === true || input.ciMode === 'off') return 'off';
	return 'hosted';
}

function sha256File(filePath: string) {
	return existsSync(filePath)
		? createHash('sha256').update(readFileSync(filePath)).digest('hex')
		: null;
}

function internalPackageDependencies(repoPath: string) {
	const packageJsonPath = resolve(repoPath, 'package.json');
	if (!existsSync(packageJsonPath)) return [];
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
	const names = new Set<string>();
	for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
		const values = packageJson[field];
		if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
		for (const name of Object.keys(values)) {
			if (name.startsWith('@treeseed/')) names.add(name);
		}
	}
	return [...names].sort();
}

function normalizeStageCleanupMode(input: TreeseedStageInput): StageCleanupMode {
	if (input.cleanupMode === 'manual' || input.deleteBranch === false) return 'manual';
	return 'success';
}

function stageCandidateManifestPath(root: string, runId: string) {
	return {
		latest: resolve(root, '.treeseed', 'workflow', 'stage-candidates', 'latest.json'),
		run: resolve(root, '.treeseed', 'workflow', 'runs', runId, 'stage-candidate.json'),
	};
}

function readJsonFile<T>(filePath: string): T | null {
	if (!existsSync(filePath)) return null;
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as T;
	} catch {
		return null;
	}
}

function stageCandidateAttestationBlockers(root: string) {
	const manifest = readJsonFile<StageCandidateManifest>(stageCandidateManifestPath(root, 'unused').latest);
	if (!manifest) return ['No staging candidate manifest is available. Run `trsd stage` and wait for staging verification and deployment workflows.'];
	const blockers: string[] = [];
	if (manifest.root.commit !== headCommit(repoRoot(root))) blockers.push('The local Market staging head no longer matches the latest staged candidate.');
	for (const pkg of manifest.packages) {
		const repoPath = resolve(root, pkg.path);
		if (!existsSync(repoPath) || headCommit(repoPath) !== pkg.commit) blockers.push(`${pkg.name} no longer matches staged commit ${pkg.commit}.`);
	}
	return blockers;
}

function writeStageCandidateManifest(root: string, runId: string, manifest: StageCandidateManifest) {
	const paths = stageCandidateManifestPath(root, runId);
	for (const filePath of [paths.latest, paths.run]) {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
	}
	return manifest;
}

function dedupeManagedReposByRemote(repos: TreeseedManagedRepository[]) {
	const seen = new Set<string>();
	const deduped: TreeseedManagedRepository[] = [];
	for (const repo of repos) {
		const key = repo.remoteUrl ? `remote:${repo.remoteUrl}` : `path:${repo.dir}`;
		if (seen.has(key)) continue;
		seen.add(key);
		deduped.push(repo);
	}
	return deduped;
}

function checkedOutStagePromotionRepos(root: string) {
	return dedupeManagedReposByRemote(checkedOutManagedWorkflowRepos(root)
		.filter((repo) => repo.kind === 'package' || repo.kind === 'template' || repo.kind === 'fixture'));
}

function checkedOutReleaseHelperRepos(root: string) {
	return dedupeManagedReposByRemote(checkedOutManagedWorkflowRepos(root)
		.filter((repo) => repo.kind === 'template' || repo.kind === 'fixture'));
}

function syncAllCheckedOutReleaseHelperRepos(root: string, branchName: string) {
	for (const repo of checkedOutManagedWorkflowRepos(root).filter((entry) => entry.kind === 'template' || entry.kind === 'fixture')) {
		if (remoteBranchExists(repo.dir, branchName)) {
			syncBranchWithOrigin(repo.dir, branchName);
		}
	}
}

function buildStagePromotionPlan(root: string, branchName: string, input: {
	verifyMode: StageVerifyMode;
	ciMode: StageCiMode;
	cleanupMode: StageCleanupMode;
	updateFrom: typeof STAGING_BRANCH;
}): {
	schemaVersion: 1;
	branchName: string;
	targetBranch: typeof STAGING_BRANCH;
	updateFrom: typeof STAGING_BRANCH;
	verifyMode: StageVerifyMode;
	ciMode: StageCiMode;
	cleanupMode: StageCleanupMode;
	repos: StageRepoPlan[];
	phases: string[];
} {
	const gitRoot = repoRoot(root);
	const repos: StageRepoPlan[] = [
		...checkedOutStagePromotionRepos(root).map((repo) => ({
			name: repo.name,
			path: repo.dir,
			kind: 'managed' as const,
			repoKind: repo.kind,
			sourceBranch: branchName,
			targetBranch: STAGING_BRANCH,
			remoteSourceExists: remoteBranchExists(repo.dir, branchName),
			beforeHead: branchExists(repo.dir, branchName) ? headCommit(repo.dir, branchName) : null,
			stagingHeadBefore: remoteBranchExists(repo.dir, STAGING_BRANCH) ? remoteHeadCommit(repo.dir, STAGING_BRANCH) : null,
		})),
		{
			name: '@treeseed/market',
			path: gitRoot,
			kind: 'root' as const,
			sourceBranch: branchName,
			targetBranch: STAGING_BRANCH,
			remoteSourceExists: remoteBranchExists(gitRoot, branchName),
			beforeHead: branchExists(gitRoot, branchName) ? headCommit(gitRoot, branchName) : null,
			stagingHeadBefore: remoteBranchExists(gitRoot, STAGING_BRANCH) ? remoteHeadCommit(gitRoot, STAGING_BRANCH) : null,
		},
	];
	return {
		schemaVersion: 1,
		branchName,
		targetBranch: STAGING_BRANCH,
		updateFrom: input.updateFrom,
		verifyMode: input.verifyMode,
		ciMode: input.ciMode,
		cleanupMode: input.cleanupMode,
		repos,
		phases: [
			'preflight',
			'merge-staging-down',
			'save-integrated-feature',
			'verify-integrated-feature',
			'promote-to-staging',
			'verify-staging-refs',
			'workspace-link-restore',
			'cleanup-source',
		],
	};
}

function stagePreflightBlockers(root: string, branchName: string, plan: { repos: StageRepoPlan[] }) {
	const blockers: string[] = [];
	if (!branchName || branchName === STAGING_BRANCH || branchName === PRODUCTION_BRANCH) {
		blockers.push(`stage requires a feature branch; current branch is ${branchName || '(none)'}.`);
	}
	for (const repo of plan.repos) {
		const branch = currentBranch(repo.path) || null;
		if (hasMeaningfulChanges(repo.path)) {
			blockers.push(`${repo.name} has uncommitted changes.`);
		}
		if (branch !== branchName && repo.kind === 'managed' && repo.remoteSourceExists) {
			blockers.push(`${repo.name} is on ${branch ?? '(detached)'} instead of ${branchName}.`);
		}
		if (repo.kind === 'root' && branch !== branchName) {
			blockers.push(`${repo.name} is on ${branch ?? '(detached)'} instead of ${branchName}.`);
		}
		try {
			originRemoteUrl(repo.path);
		} catch {
			blockers.push(`${repo.name} has no readable origin remote.`);
		}
		if (repo.kind === 'root' && !repo.remoteSourceExists) {
			blockers.push(`${repo.name} feature branch ${branchName} has not been pushed to origin.`);
		}
		if (repo.kind === 'managed' && branchExists(repo.path, branchName) && repo.remoteSourceExists) {
			const localHead = headCommit(repo.path, branchName);
			const remoteHead = remoteHeadCommit(repo.path, branchName);
			if (localHead !== remoteHead) {
				blockers.push(`${repo.name} local ${branchName} (${localHead.slice(0, 12)}) does not match origin/${branchName} (${remoteHead.slice(0, 12)}). Run save first.`);
			}
		}
	}
	return blockers;
}

function stageConflictError(message: string, details: Record<string, unknown>) {
	return new TreeseedWorkflowError('stage', 'merge_conflict', message, {
		details,
		exitCode: 12,
	});
}

function createStageCandidateManifest(root: string, runId: string, branchName: string, plan: { repos: StageRepoPlan[] }, verification: StageCandidateManifest['verification']): StageCandidateManifest {
	const gitRoot = repoRoot(root);
	const packageRepos = plan.repos.filter((repo) => repo.kind === 'managed');
	const rootCommit = headCommit(gitRoot);
	const submodules = packageRepos
		.map((repo) => `${relative(root, repo.path).replaceAll('\\', '/')}:${headCommit(repo.path)}`)
		.sort();
	const candidateId = createHash('sha256').update(JSON.stringify({
		rootSha: rootCommit,
		submodules,
	})).digest('hex');
	return {
		schemaVersion: 2,
		kind: 'treeseed.stage-candidate',
		candidateId,
		runId,
		branchName,
		targetBranch: STAGING_BRANCH,
		createdAt: new Date().toISOString(),
		root: {
			repo: '@treeseed/market',
			commit: rootCommit,
			verified: verification.status === 'passed' || verification.status === 'skipped',
		},
		packages: packageRepos.map((repo) => ({
			name: repo.name,
			path: repo.path,
			repoKind: repo.repoKind,
			commit: headCommit(repo.path),
			lockfileHash: sha256File(resolve(repo.path, 'package-lock.json')),
			dependencies: internalPackageDependencies(repo.path),
			remote: (() => {
				try {
					return originRemoteUrl(repo.path);
				} catch {
					return null;
				}
			})(),
			verified: verification.status === 'passed' || verification.status === 'skipped',
		})),
		verification,
		stagingHeadsBefore: Object.fromEntries(plan.repos.map((repo) => [repo.name, repo.stagingHeadBefore])),
	};
}

function cleanupStageSourceBranches(root: string, branchName: string, manifest: StageCandidateManifest) {
	const results: Array<Record<string, unknown>> = [];
	for (const repo of checkedOutStagePromotionRepos(root)) {
		const manifestRepo = manifest.packages.find((entry) => entry.name === repo.name);
		if (!manifestRepo) continue;
		const remoteDeleted = deleteRemoteBranchIfMerged(repo.dir, branchName, STAGING_BRANCH, manifestRepo.commit);
		if ((currentBranch(repo.dir) || null) === branchName) {
			syncBranchWithOrigin(repo.dir, STAGING_BRANCH);
		}
		const localExists = branchExists(repo.dir, branchName);
		if (localExists && (currentBranch(repo.dir) || null) !== branchName) {
			deleteLocalBranch(repo.dir, branchName);
		}
		results.push({
			name: repo.name,
			path: repo.dir,
			remoteDeleted,
			localDeleted: localExists && !branchExists(repo.dir, branchName),
		});
	}
	const gitRoot = repoRoot(root);
	const rootRemoteDeleted = deleteRemoteBranchIfMerged(gitRoot, branchName, STAGING_BRANCH, manifest.root.commit);
	const managedWorktree = managedWorkflowWorktreeMetadata(root);
	const worktreeCleanup = managedWorktree
		? removeManagedWorkflowWorktree(root, { deleteBranch: false })
		: { removed: false, reason: 'not-managed' };
	const branchDeletionRoot = managedWorktree?.primaryRoot ? repoRoot(managedWorktree.primaryRoot) : gitRoot;
	if (!managedWorktree && (currentBranch(gitRoot) || null) === branchName) {
		syncBranchWithOrigin(gitRoot, STAGING_BRANCH);
	}
	const rootLocalExists = branchExists(branchDeletionRoot, branchName);
	if (rootLocalExists && (currentBranch(branchDeletionRoot) || null) !== branchName) {
		deleteLocalBranch(branchDeletionRoot, branchName);
	}
	results.push({
		name: '@treeseed/market',
		path: branchDeletionRoot,
		remoteDeleted: rootRemoteDeleted,
		localDeleted: rootLocalExists && !branchExists(branchDeletionRoot, branchName),
	});
	return {
		status: 'completed',
		repos: results,
		worktreeCleanup,
	};
}

export async function workflowStage(helpers: WorkflowOperationHelpers, input: TreeseedStageInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('stage', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const executionMode = normalizeExecutionMode(input);
			const session = resolveTreeseedWorkflowSession(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId ?? null;
			const rawAutoResumeRun = executionMode === 'execute' && !explicitResumeRunId
				? findAutoResumableTaskRun(root, 'stage', session.branchName)
				: null;
			rejectImplicitWorkflowResume('stage', rawAutoResumeRun);
			const autoResumeRun = rawAutoResumeRun?.steps.some((step) => step.id === 'preflight')
				? rawAutoResumeRun
				: null;
			const planAutoResumeRun = null;
			const effectiveInput = autoResumeRun
				? (autoResumeRun.input as unknown as TreeseedStageInput)
				: input;
			const localCleanup = maybeRunLocalWorkflowCleanup(helpers, root, 'stage', effectiveInput);
			const message = ensureMessage('stage', effectiveInput.message, 'a resolution message');
			if (effectiveInput.verifyDeployedResources === true) {
				workflowError('stage', 'validation_failed', 'Stage no longer verifies deployed resources. Promote refs with stage, then run staging release/hosting verification separately.');
			}
			const verifyMode = normalizeStageVerifyMode(effectiveInput.verifyMode);
			const ciMode = normalizeStageCiMode(effectiveInput);
			const cleanupMode = normalizeStageCleanupMode(effectiveInput);
			const updateFrom = effectiveInput.updateFrom ?? STAGING_BRANCH;
			if (updateFrom !== STAGING_BRANCH) {
				workflowError('stage', 'validation_failed', `Stage currently supports only --update-from ${STAGING_BRANCH}. Received ${updateFrom}.`);
			}
			const applicationSelection = selectWorkflowApplications(root, { packageSelection: session.packageSelection });
			const featureBranch = executionMode === 'execute' ? assertFeatureBranch(root) : session.branchName ?? '';
			let plan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
			let blockers = stagePreflightBlockers(root, featureBranch, plan);
			const basePayload = {
				mode: 'stage-promotion',
				branchName: featureBranch,
				branchRole: session.branchRole,
				mergeTarget: STAGING_BRANCH,
				mergeStrategy: 'merge-staging-down-then-exact-sha',
				message,
				verifyMode,
				ciMode,
				cleanupMode,
				updateFrom,
				waitForStaging: ciMode === 'hosted',
				sceneArtifacts: normalizeSceneArtifactsMode(effectiveInput.sceneArtifacts),
				localCleanup,
				applicationSelection,
				plan,
				phases: plan.phases,
				blockers,
				autoResumeCandidate: planAutoResumeRun
					? {
						runId: planAutoResumeRun.runId,
						branch: planAutoResumeRun.session.branchName,
						failure: planAutoResumeRun.failure,
					}
					: null,
				legacyMutationPathDisabled: true,
				...worktreePayload(root, effectiveInput.worktreeMode),
			};
			if (executionMode === 'plan') {
				return buildWorkflowResult('stage', root, basePayload, {
					executionMode,
					summary: blockers.length > 0 ? 'Treeseed stage plan blocked.' : 'Treeseed stage promotion plan ready.',
					includeFinalState: false,
					nextSteps: createNextSteps([
						blockers.length > 0
							? { operation: 'status', reason: 'Resolve blockers before staging.' }
							: { operation: 'stage', reason: 'Promote the verified feature branch to staging.', input: { message } },
					]),
				});
			}
			if (effectiveInput.autoSave === true) {
				await maybeAutoSaveCurrentTaskBranch(helpers, 'stage', {
					message,
					autoSave: true,
					verify: false,
					preview: false,
				});
				plan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
				blockers = stagePreflightBlockers(root, featureBranch, plan);
			}
			if (blockers.length > 0) {
				workflowError('stage', 'validation_failed', `stage is blocked:\n${blockers.map((entry) => `- ${entry}`).join('\n')}`, {
					details: { blockers, plan },
				});
			}
			const workflowRun = acquireWorkflowRun('stage', resolveTreeseedWorkflowSession(root), {
				...effectiveInput,
				verifyMode,
				ciMode,
				cleanupMode,
				updateFrom,
			} as Record<string, unknown>, [
				{ id: 'preflight', description: 'Validate clean feature branch before staging', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'merge-staging-down', description: 'Merge staging into feature branches', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'save-integrated-feature', description: 'Save integrated feature state after staging merge-down', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'verify-integrated-feature', description: 'Run local proof before staging mutation', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'write-stage-candidate', description: 'Write exact stage candidate manifest', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'promote-to-staging', description: 'Promote exact verified refs to staging', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
				{ id: 'verify-staging-refs', description: 'Verify remote staging refs match promoted commits', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: STAGING_BRANCH, resumable: true },
					{ id: 'hosted-ci', description: 'Wait for hosted staging CI when explicitly requested', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: STAGING_BRANCH, resumable: true },
				{ id: 'workspace-link-restore', description: 'Restore local workspace links after stage', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: STAGING_BRANCH, resumable: true },
				{ id: 'cleanup-source', description: 'Clean up source branches and worktree after successful promotion', repoName: '@treeseed/market', repoPath: repoRoot(root), branch: featureBranch, resumable: true },
			], helpers.context);
			try {
				await executeJournalStep(root, workflowRun.runId, 'preflight', () => {
					const currentPlan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
					const currentBlockers = stagePreflightBlockers(root, featureBranch, currentPlan);
					if (currentBlockers.length > 0) {
						workflowError('stage', 'validation_failed', `stage is blocked:\n${currentBlockers.map((entry) => `- ${entry}`).join('\n')}`, {
							details: { blockers: currentBlockers, plan: currentPlan },
						});
					}
					return { status: 'passed', checkedAt: new Date().toISOString() };
				});
				const mergeDown = await executeJournalStep(root, workflowRun.runId, 'merge-staging-down', () => {
					const results: Array<Record<string, unknown>> = [];
					try {
						for (const repo of checkedOutStagePromotionRepos(root)) {
							if (!remoteBranchExists(repo.dir, featureBranch)) {
								results.push({ name: repo.name, path: repo.dir, skipped: true, reason: 'remote-branch-missing' });
								continue;
							}
							results.push({
								name: repo.name,
								path: repo.dir,
								...mergeBranchDownIntoFeature(repo.dir, {
									featureBranch,
									sourceBranch: STAGING_BRANCH,
									message: `stage: merge ${STAGING_BRANCH} into ${featureBranch}`,
									allowGeneratedMetadataAutoResolution: true,
								}),
							});
						}
						results.push({
							name: '@treeseed/market',
							path: repoRoot(root),
							...mergeBranchDownIntoFeature(repoRoot(root), {
								featureBranch,
								sourceBranch: STAGING_BRANCH,
								message: `stage: merge ${STAGING_BRANCH} into ${featureBranch}`,
								allowGeneratedMetadataAutoResolution: true,
							}),
						});
					} catch (error) {
						const details = error && typeof error === 'object' ? error as Record<string, unknown> : {};
						throw stageConflictError(error instanceof Error ? error.message : String(error), {
							...details,
							results,
							branchName: featureBranch,
							targetBranch: STAGING_BRANCH,
						});
					}
					return { status: 'completed', results };
				});
				const mergeChanged = Array.isArray(mergeDown?.results)
					&& mergeDown.results.some((entry) => Boolean((entry as Record<string, unknown>).merged));
				const saveResult = mergeChanged || hasMeaningfulChanges(repoRoot(root))
					? await executeJournalStep(root, workflowRun.runId, 'save-integrated-feature', () =>
						workflowSave(helpersForCwd(helpers, root), {
							message: `integrate staging before stage: ${message}`,
							verifyMode: 'skip',
							ciMode: 'off',
							refreshPreview: false,
							preview: false,
							workspaceLinks: effectiveInput.workspaceLinks ?? 'auto',
						}))
					: (skipJournalStep(root, workflowRun.runId, 'save-integrated-feature', { skippedReason: 'staging already integrated' }), null);
				const verification = verifyMode === 'none' || process.env.TREESEED_RELEASE_CANDIDATE_REHEARSAL_MODE === 'skip'
					? (skipJournalStep(root, workflowRun.runId, 'verify-integrated-feature', { mode: verifyMode, status: 'skipped' }), {
						mode: verifyMode,
						status: 'skipped' as const,
						completedAt: null,
					})
					: await executeJournalStep(root, workflowRun.runId, 'verify-integrated-feature', async () => {
						const proof = await runTreeseedProof({
							root,
							target: 'staging',
							driver: verifyMode === 'action' ? 'act' : 'local',
							write: (line, stream) => helpers.write(`[stage][verify] ${line}`, stream),
						});
						if (proof.failures.length > 0) {
							const first = proof.failures[0]!;
							workflowError('stage', 'validation_failed', [
								'Treeseed stage proof failed.',
								`- ${first.subject.id}: ${first.invalidationReasons[0] ?? first.status}`,
								first.result.workflow?.url ? `Run: ${first.result.workflow.url}` : null,
							].join('\n'), {
								details: { proof },
							});
						}
						return {
							mode: verifyMode,
							status: 'passed' as const,
							completedAt: new Date().toISOString(),
							proof,
						};
					});
				const manifest = await executeJournalStep(root, workflowRun.runId, 'write-stage-candidate', () => {
					const currentPlan = buildStagePromotionPlan(root, featureBranch, { verifyMode, ciMode, cleanupMode, updateFrom });
					return writeStageCandidateManifest(root, workflowRun.runId, createStageCandidateManifest(root, workflowRun.runId, featureBranch, currentPlan, {
						mode: verifyMode,
						status: verification.status,
						completedAt: verification.completedAt,
					}));
				});
				const typedManifest = manifest as unknown as StageCandidateManifest;
				const promotion = await executeJournalStep(root, workflowRun.runId, 'promote-to-staging', () => {
					const results: Array<Record<string, unknown>> = [];
					for (const pkg of typedManifest.packages) {
						results.push({
							name: pkg.name,
							...promoteCommitToBranchWithExpectedHead(resolve(root, pkg.path), {
								commitSha: pkg.commit,
								targetBranch: STAGING_BRANCH,
								expectedBefore: typedManifest.stagingHeadsBefore[pkg.name] ?? null,
							}),
						});
					}
					results.push({
						name: '@treeseed/market',
						...promoteCommitToBranchWithExpectedHead(repoRoot(root), {
							commitSha: typedManifest.root.commit,
							targetBranch: STAGING_BRANCH,
							expectedBefore: typedManifest.stagingHeadsBefore['@treeseed/market'] ?? null,
						}),
					});
					return { status: 'completed', results };
				});
				const stagingRefs = await executeJournalStep(root, workflowRun.runId, 'verify-staging-refs', () => {
					const refs: Record<string, string> = {};
					for (const pkg of typedManifest.packages) {
						const observed = remoteHeadCommit(resolve(root, pkg.path), STAGING_BRANCH);
						if (observed !== pkg.commit) {
							throw new Error(`${pkg.name} staging ref mismatch: expected ${pkg.commit}, observed ${observed}.`);
						}
						refs[pkg.name] = observed;
					}
					const rootObserved = remoteHeadCommit(repoRoot(root), STAGING_BRANCH);
					if (rootObserved !== typedManifest.root.commit) {
						throw new Error(`@treeseed/market staging ref mismatch: expected ${typedManifest.root.commit}, observed ${rootObserved}.`);
					}
					refs['@treeseed/market'] = rootObserved;
					return { status: 'verified', refs };
				});
				const hostedCi = ciMode === 'hosted'
						? await executeJournalStep(root, workflowRun.runId, 'hosted-ci', () => waitForWorkflowGates(
							'stage',
							stagingCandidateWorkflowGates(root, typedManifest),
							'hosted',
							{ root, runId: workflowRun.runId, onProgress: (line, stream) => helpers.write(line, stream) },
						))
						: (skipJournalStep(root, workflowRun.runId, 'hosted-ci', { skippedReason: 'ci off' }), { status: 'skipped', reason: 'ci off' });
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link-restore', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				for (const repo of checkedOutStagePromotionRepos(root)) {
					syncBranchWithOrigin(repo.dir, STAGING_BRANCH);
				}
				syncBranchWithOrigin(repoRoot(root), STAGING_BRANCH);
				const cleanup = cleanupMode === 'success'
					? await executeJournalStep(root, workflowRun.runId, 'cleanup-source', () => cleanupStageSourceBranches(root, featureBranch, typedManifest))
					: (skipJournalStep(root, workflowRun.runId, 'cleanup-source', { skippedReason: 'manual cleanup selected' }), { status: 'skipped', reason: 'manual cleanup selected' });
				const payload = {
					...basePayload,
					blockers: [],
					runId: workflowRun.runId,
					mergeDown,
					saveResult,
					verification,
					manifest: typedManifest,
					promotion,
					stagingRefs,
					hostedCi,
					stagingGuarantees: null,
					cleanup,
					workspaceLinks,
					finalBranch: STAGING_BRANCH,
					summary: ciMode === 'hosted'
						? `Staging candidate ${typedManifest.candidateId} passed all exact-SHA verification and deployment workflows.`
						: `Staging candidate ${typedManifest.candidateId} was promoted asynchronously; hosted verification is pending.`,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult('stage', root, payload, {
					runId: workflowRun.runId,
					summary: 'Treeseed stage completed successfully.',
					includeFinalState: false,
					nextSteps: createNextSteps([
						{ operation: 'ci', reason: 'Inspect staging CI/CD status after branch promotion.', input: { branch: STAGING_BRANCH, failed: true } },
					]),
				});
			} catch (error) {
				try {
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				} catch {
					// Preserve the original stage failure.
				}
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'stage',
					message: `Resume the interrupted stage for ${featureBranch}.`,
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('stage', error);
	}
}

async function runReleaseGateReconcileFacade(
	operation: 'stage' | 'release',
	helpers: WorkflowOperationHelpers,
	root: string,
	target: TreeseedReconcileTarget,
	input: { plan?: boolean; execute?: boolean; verifyDeployedResources?: boolean; releaseImageRefs?: Record<string, string>; includeHostedReleaseGates?: boolean },
	extraPayload: Record<string, unknown> = {},
) {
	const executionMode = normalizeExecutionMode(input);
	const reconcileEnv = { ...helpers.context.env, ...(input.releaseImageRefs ?? {}) };
	const includeHostedReleaseGates = input.includeHostedReleaseGates === true;
	const selector: TreeseedReconcileSelector = {
		environment: target.kind === 'persistent' ? target.scope : 'staging',
		resourceKind: ['release-gate'],
		provider: ['treeseed'],
	};
	const desiredGraph = await withContextEnv(reconcileEnv, () =>
		compileTreeseedDesiredResourceGraph({ tenantRoot: root, target }));
	const rawUnits = compileTreeseedDesiredUnitsFromGraph(desiredGraph)
		.filter((unit) => (
			unit.provider === 'treeseed'
			&& (unit.unitType === 'package-manifest' || unit.unitType.startsWith('release-gate:'))
			&& unit.unitType !== 'release-gate:npm-publish'
			&& unit.unitType !== 'release-gate:image-publish'
			&& (
				includeHostedReleaseGates
				|| (unit.unitType !== 'release-gate:hosted-reconcile' && unit.unitType !== 'release-gate:live-verify')
			)
		) || (
			unit.provider === 'github'
			&& (
				unit.unitType === 'github-environment'
				|| unit.unitType === 'github-secret-binding'
				|| unit.unitType === 'github-variable-binding'
			)
		));
	const unitsWithReleaseImageRefs = appendReleaseImageRefGitHubVariableBindings(rawUnits, input.releaseImageRefs ?? {});
	const rawUnitIds = new Set(unitsWithReleaseImageRefs.map((unit) => unit.unitId));
	const units = unitsWithReleaseImageRefs.map((unit) => ({
		...unit,
		dependencies: unit.dependencies.filter((dependency) => rawUnitIds.has(dependency)),
	}));
	const unitSelector: TreeseedReconcileSelector = {
		environment: selector.environment,
		unitId: units.map((unit) => unit.unitId),
	};
	const plan = await planTreeseedReconciliation({
		tenantRoot: root,
		target,
		env: reconcileEnv,
		units,
		selector: unitSelector,
		write: (line) => helpers.write(`[${operation}][reconcile] ${line}`, 'stderr'),
	});
	const blockers = Array.isArray(extraPayload.blockers)
		? extraPayload.blockers.map((blocker) => String(blocker)).filter(Boolean)
		: [];
	if (executionMode === 'execute' && blockers.length > 0) {
		workflowError(operation, 'validation_failed', `${operation} is blocked:\n${blockers.join('\n')}`, {
			details: {
				blockers,
				target,
				plannedSteps: plan.plans.map((entry) => ({
					id: entry.unit.unitId,
					action: entry.diff.action,
					reasons: entry.diff.reasons,
				})),
			},
		});
	}
	const result = executionMode === 'execute'
		? await reconcileTreeseedTarget({
			tenantRoot: root,
			target,
			env: reconcileEnv,
			units,
			selector: unitSelector,
			planOnly: false,
			write: (line) => helpers.write(`[${operation}][reconcile] ${line}`, 'stderr'),
		})
		: null;
	const payload = {
		...extraPayload,
		mode: 'reconcile-release-gates',
		target,
		executionMode,
		verifyDeployedResources: input.verifyDeployedResources === true,
		releaseImageRefs: input.releaseImageRefs ?? {},
		includeHostedReleaseGates,
		desiredGraph,
		units: units.map((unit) => ({
			unitId: unit.unitId,
			unitType: unit.unitType,
			provider: unit.provider,
			logicalName: unit.logicalName,
			dependencies: unit.dependencies,
		})),
		plannedSteps: plan.plans.map((entry) => ({
			id: entry.unit.unitId,
			description: `${entry.unit.provider}:${entry.unit.unitType} ${entry.unit.logicalName}`,
			action: entry.diff.action,
			reasons: entry.diff.reasons,
		})),
		reconcile: result,
		legacyMutationPathDisabled: true,
	};
	return buildWorkflowResult(operation, root, payload, {
		executionMode,
		summary: executionMode === 'execute'
			? `${operation} release gates reconciled through the canonical adapter path.`
			: `${operation} release gate plan ready.`,
		nextSteps: createNextSteps([
			operation === 'stage'
				? { operation: 'release', reason: 'Promote production after the staging release-gate candidate is green.', input: { bump: 'patch', plan: true } }
				: { operation: 'status', reason: 'Inspect production readiness after release gates complete.' },
		]),
	});
}

function appendReleaseImageRefGitHubVariableBindings(units: TreeseedDesiredUnit[], releaseImageRefs: Record<string, string>): TreeseedDesiredUnit[] {
	const entries = Object.entries(releaseImageRefs)
		.map(([name, value]) => [name.trim(), value.trim()] as const)
		.filter(([name, value]) => name.length > 0 && value.length > 0);
	if (entries.length === 0) return units;
	const apiProductionEnvironment = units.find((unit) =>
		unit.provider === 'github'
		&& unit.unitType === 'github-environment'
		&& unit.unitId === 'github-environment:@treeseed/api:production');
	if (!apiProductionEnvironment) return units;
	const existingUnitIds = new Set(units.map((unit) => unit.unitId));
	const additions = entries
		.map(([variableName]) => {
			const unitId = `github-variable-binding:@treeseed/api:production:${variableName}`;
			if (existingUnitIds.has(unitId)) return null;
			return {
				...apiProductionEnvironment,
				unitId,
				unitType: 'github-variable-binding' as const,
				logicalName: `@treeseed/api production ${variableName}`,
				dependencies: [apiProductionEnvironment.unitId],
				spec: {
					packageId: '@treeseed/api',
					packageRoot: apiProductionEnvironment.spec.packageRoot,
					repository: apiProductionEnvironment.spec.repository,
					environment: 'production',
					variableName,
					envName: variableName,
				},
				secrets: {},
				metadata: {
					...apiProductionEnvironment.metadata,
					releaseImageRef: true,
				},
			} satisfies TreeseedDesiredUnit;
		})
		.filter((unit): unit is TreeseedDesiredUnit => Boolean(unit));
	return additions.length > 0 ? [...units, ...additions] : units;
}

export async function workflowRelease(helpers: WorkflowOperationHelpers, input: TreeseedReleaseInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = workspaceRoot(resolveProjectRootOrThrow('release', helpers.cwd()));
			const session = resolveTreeseedWorkflowSession(root);
			const executionMode = normalizeExecutionMode(input);
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			const releaseHelperRepos = checkedOutReleaseHelperRepos(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId ?? null;
			const autoResumeRun = executionMode === 'execute' && !explicitResumeRunId && input.fresh !== true
				? findAutoResumableReleaseRun(root, session.branchName, rootRepo, packageReports, { archiveStale: false })
				: null;
			const planAutoResumeRun = executionMode === 'plan' && input.fresh !== true
				? findAutoResumableReleaseRun(root, session.branchName, rootRepo, packageReports)
				: null;
			const effectiveInput = autoResumeRun
				? {
					...(autoResumeRun.input as unknown as TreeseedReleaseInput),
					ciMode: input.ciMode ?? (autoResumeRun.input as unknown as TreeseedReleaseInput).ciMode,
				}
					: input;
			const localCleanup = maybeRunLocalWorkflowCleanup(helpers, root, 'release', effectiveInput);
			const level = effectiveInput.bump ?? 'patch';
			const ciMode = normalizeCiMode(effectiveInput.ciMode, 'release');
			const packageSelection = session.packageSelection;
			const plannedRelease = buildReleasePlanSnapshot({
				root,
				mode: session.mode,
				level,
				repairVersionLine: effectiveInput.repairVersionLine === true,
				targetVersionLine: effectiveInput.targetVersionLine,
				packageSelection,
				packageReports,
				rootRepo,
				blockers: [],
			});
			const selectedPackageNames = releasePlanPackageSelection(plannedRelease.packageSelection).selected;
			const blockers = collectReleasePlanBlockers(session, session.mode, selectedPackageNames, {
				level,
				repairVersionLine: effectiveInput.repairVersionLine === true,
			});
				blockers.push(...collectReleaseHelperRepoBlockers(root));
				blockers.push(...stageCandidateAttestationBlockers(root));
			const selectedVersions = releasePlanVersionMap(plannedRelease.plannedVersions);
			const releaseImageVersions = productionReleaseImageRefVersions(root, selectedVersions);
			const releaseImageRefs = productionReleaseImageRefEnv(releaseImageVersions);
			const plannedReadiness = await withContextEnv({ ...helpers.context.env, ...releaseImageRefs }, () =>
				collectTreeseedDeploymentReadiness({
					tenantRoot: root,
					environment: 'prod',
					appId: singleSelectedWorkflowAppId(plannedRelease.applicationSelection),
				}));
			blockers.push(...plannedReadiness.checks
				.filter((check) => check.status === 'failed')
				.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`));
			plannedRelease.blockers = blockers;
			const releaseBasePayload = {
				...plannedRelease,
				readiness: plannedReadiness,
				ciMode,
				level,
				fresh: input.fresh === true,
				sceneArtifacts: normalizeSceneArtifactsMode(effectiveInput.sceneArtifacts),
				releaseImageRefs,
				localCleanup,
				releaseHelperRepos: releaseHelperRepos.map((repo) => ({
					name: repo.name,
					kind: repo.kind,
					path: repo.relativeDir,
					remote: repo.remoteUrl,
				})),
				freshArchivedRuns: [],
				autoResumeCandidate: planAutoResumeRun
					? {
						runId: planAutoResumeRun.runId,
						branch: planAutoResumeRun.session.branchName,
						failure: planAutoResumeRun.failure,
					}
					: null,
				...worktreePayload(root, effectiveInput.worktreeMode),
			};
			if (executionMode === 'plan') {
				return runReleaseGateReconcileFacade(
					'release',
					helpers,
					root,
					{ kind: 'persistent', scope: 'prod' },
					{
						plan: true,
						verifyDeployedResources: effectiveInput.verifyDeployedResources,
						releaseImageRefs,
					},
					releaseBasePayload,
				);
			}
			if (blockers.length > 0) {
				workflowError('release', 'validation_failed', `Treeseed release cannot continue until blockers are resolved:\n${blockers.join('\n')}`, {
					details: { blockers, releasePlan: plannedRelease },
				});
			}
			const freshPreparation = input.fresh === true
				? prepareFreshReleaseRun(root, session.branchName, rootRepo, packageReports)
				: { archived: [], blockers: [] };
			const stableVersions = new Map([
				...releasePlanStableDependencyVersionMap(plannedRelease).entries(),
				...selectedVersions.entries(),
			]);
			const allVersions = new Map([
				['@treeseed/market', plannedRelease.rootVersion],
				...stableVersions.entries(),
			]);
			const selectedPackageSet = new Set(selectedPackageNames);
			const workflowRun = acquireWorkflowRun(
				'release',
				session,
				{
					...effectiveInput,
					bump: level,
					ciMode,
					fresh: input.fresh === true,
				} as Record<string, unknown>,
				[
					{ id: 'release-plan', description: 'Record immutable release plan and target versions', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'release-gates', description: 'Run production release gates against staging evidence', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'workspace-unlink', description: 'Remove local workspace links before stable release metadata', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'prepare-release-metadata', description: 'Rewrite package metadata and lockfiles to production dependency mode', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					...selectedPackageNames.map((name) => {
						const report = packageReports.find((entry) => entry.name === name);
						return {
							id: `release-${name}`,
							description: `Release ${name} ${selectedVersions.get(name) ?? '(planned)'}`,
							repoName: name,
							repoPath: report?.path ?? root,
							branch: STAGING_BRANCH,
							resumable: true,
						};
					}),
					{
						id: 'release-helper-repos',
						description: 'Promote starter templates and shared fixture repositories from staging to production',
						repoName: rootRepo.name,
						repoPath: rootRepo.path,
						branch: STAGING_BRANCH,
						resumable: true,
					},
					{ id: 'verify-published-artifacts', description: 'Verify immutable registry artifacts exist after publish workflows', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'production-package-deploy-workflows', description: 'Wait for production package deploy workflows before live verification', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'release-root', description: `Release market ${plannedRelease.rootVersion}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'publish-wait', description: 'Wait for production release workflows', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'release-back-merge', description: 'Back-merge production release history into staging', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'workspace-link', description: 'Restore local workspace links after release', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
				],
				autoResumeRun
					? {
						...helpers.context,
						workflow: {
							...(helpers.context.workflow ?? {}),
							resumeRunId: autoResumeRun.runId,
						},
					}
					: helpers.context,
			);
			if (autoResumeRun) {
				helpers.write(`[workflow][resume] Resuming interrupted release ${autoResumeRun.runId}.`);
			}
			try {
				const releasePlan = await executeJournalStep(root, workflowRun.runId, 'release-plan', () => ({
					...releaseBasePayload,
					freshArchivedRuns: freshPreparation.archived,
				}));
				const releaseGates = await executeJournalStep(root, workflowRun.runId, 'release-gates', async () => {
					const workspaceLinks = ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
					const gates = await runReleaseGateReconcileFacade(
						'release',
						helpers,
						root,
						{ kind: 'persistent', scope: 'prod' },
						{
							execute: true,
							verifyDeployedResources: effectiveInput.verifyDeployedResources,
							releaseImageRefs,
						},
						{
							...releaseBasePayload,
							freshArchivedRuns: freshPreparation.archived,
						},
					) as unknown as Record<string, unknown>;
					return { workspaceLinks, gates };
				});
				const workspaceUnlink = await executeJournalStep(root, workflowRun.runId, 'workspace-unlink', () =>
					unlinkWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				const releaseMetadata = await executeJournalStep(root, workflowRun.runId, 'prepare-release-metadata', () => {
					applyStableWorkspaceVersionChanges(root, allVersions);
					const adapterMetadata = checkedOutWorkspacePackageRepos(root)
						.filter((pkg) => selectedPackageSet.has(pkg.name))
						.map((pkg) => ({
							name: pkg.name,
							version: selectedVersions.get(pkg.name) ?? null,
							result: selectedVersions.has(pkg.name)
								? { status: 'pending-package-release-step' }
								: { status: 'skipped', reason: 'no planned version' },
						}));
					const rootPackageLock = updatePackageLockRootVersion(root, plannedRelease.rootVersion);
					const remainingDevReferences = collectInternalDevReferenceIssues(root, selectedPackageSet)
						.filter((issue) => !issue.reason.startsWith('lockfile-'));
					if (remainingDevReferences.length > 0) {
						const rendered = remainingDevReferences
							.map((issue) => `${issue.repoName}: ${issue.filePath} ${issue.dependencyName ?? ''} ${issue.reason} ${issue.spec}`)
							.join('\n');
						throw new Error(`Stable release metadata still contains development references.\n${rendered}`);
					}
					return {
						versions: Object.fromEntries(allVersions.entries()),
						adapterMetadata,
						rootPackageLock,
						workspaceUnlink,
					};
				});
				const packageReleases: Array<Record<string, unknown>> = [];
				const packageRepoByName = new Map(checkedOutWorkspacePackageRepos(root).map((entry) => [entry.name, entry]));
				for (const packageName of selectedPackageNames) {
					const pkg = packageRepoByName.get(packageName);
					if (!pkg) continue;
					const version = selectedVersions.get(pkg.name);
					if (!version) continue;
					const packageRelease = await executeJournalStep(root, workflowRun.runId, `release-${pkg.name}`, async () => {
						const metadata = prepareAdapterReleaseMetadata(root, pkg, version);
						const changelog = updateReleaseChangelog(pkg.dir, {
							version,
							sourceRef: `origin/${PRODUCTION_BRANCH}`,
							targetRef: 'HEAD',
						});
						const commit = commitAllIfChanged(pkg.dir, releaseAdminMessage({
							subject: `release: ${pkg.name} ${version}`,
							version,
							tagName: version,
							sourceRef: STAGING_BRANCH,
							targetRef: PRODUCTION_BRANCH,
							changelog,
						}));
						pushBranch(pkg.dir, STAGING_BRANCH);
						const promotion = promoteCommitToProductionBranch(pkg.dir, commit.commitSha);
						const tag = ensureReleaseTag(pkg.dir, version, commit.commitSha, `release: ${pkg.name} ${version}`);
						const publishGate = {
							name: pkg.name,
							repoPath: pkg.dir,
							workflow: releaseWorkflowForPackage(root, pkg.name),
							branch: version,
							headSha: commit.commitSha,
						};
						const publishWait = await waitForWorkflowGates('release', [publishGate], ciMode, {
							root,
							runId: workflowRun.runId,
							onProgress: (line, stream) => helpers.write(line, stream),
						});
						const publishedArtifacts = await verifyPublishedReleaseArtifacts(new Map([[pkg.name, version]]));
						return {
							name: pkg.name,
							path: relative(root, pkg.dir),
							version,
							changelog,
							metadata,
							commit,
							promotion,
							tag,
							publishWait,
							publishedArtifacts,
						};
					});
					packageReleases.push(packageRelease);
				}
				const managedHelperReleases = await executeJournalStep(root, workflowRun.runId, 'release-helper-repos', () => {
					const releases = releaseHelperRepos.map((repo) => releaseHelperRepoToProduction(repo));
					syncAllCheckedOutReleaseHelperRepos(root, STAGING_BRANCH);
					return { status: 'completed', repos: releases };
				});
				const publishedArtifacts = await executeJournalStep(root, workflowRun.runId, 'verify-published-artifacts', () =>
					verifyPublishedReleaseArtifacts(selectedVersions));
				const productionPackageDeployWorkflows = await executeJournalStep(root, workflowRun.runId, 'production-package-deploy-workflows', () => {
					const deployGates = productionPackageDeployGates(root, allVersions);
					if (deployGates.length === 0) {
						return { workflowGates: [], status: 'skipped', reason: 'no selected production package deploy workflows' };
					}
					return waitForWorkflowGates('release', deployGates, ciMode, {
						root,
						runId: workflowRun.runId,
						onProgress: (line, stream) => helpers.write(line, stream),
					}).then((workflowGates) => ({ workflowGates }));
				});
				const rootRelease = await executeJournalStep(root, workflowRun.runId, 'release-root', () => {
					const rootInstall = runReleaseNpmInstall(root, { workspaceRoot: root });
					const changelog = updateReleaseChangelog(repoRoot(root), {
						version: plannedRelease.rootVersion,
						sourceRef: `origin/${PRODUCTION_BRANCH}`,
						targetRef: 'HEAD',
						extraDependencyBullets: versionLines(stableVersions),
					});
					const commit = commitAllIfChanged(repoRoot(root), releaseAdminMessage({
						subject: `release: market ${plannedRelease.rootVersion}`,
						version: plannedRelease.rootVersion,
						tagName: plannedRelease.releaseTag,
						sourceRef: STAGING_BRANCH,
						targetRef: PRODUCTION_BRANCH,
						changelog,
						extraLines: versionLines(stableVersions).map((line) => `Released package ${line}`),
					}));
					pushBranch(repoRoot(root), STAGING_BRANCH);
					const promotion = promoteCommitToProductionBranch(repoRoot(root), commit.commitSha);
					const tag = ensureReleaseTag(repoRoot(root), plannedRelease.releaseTag, commit.commitSha, `release: market ${plannedRelease.rootVersion}`);
					return {
						name: '@treeseed/market',
						version: plannedRelease.rootVersion,
						releaseTag: plannedRelease.releaseTag,
						changelog,
						rootInstall,
						commit,
						promotion,
						tag,
					};
				});
				const publishGates = [
					hostedDeployGate({
						name: '@treeseed/market',
						repoPath: repoRoot(root),
						workflow: 'deploy.yml',
						branch: plannedRelease.releaseTag,
						headSha: String((rootRelease.commit as { commitSha?: string }).commitSha ?? ''),
					}),
				].filter((gate) => gate.headSha);
				const publishWait = await executeJournalStep(root, workflowRun.runId, 'publish-wait', () =>
					waitForWorkflowGates('release', publishGates, ciMode, {
						root,
						runId: workflowRun.runId,
						onProgress: (line, stream) => helpers.write(line, stream),
					}).then((workflowGates) => ({ workflowGates })));
				const backMerge = await executeJournalStep(root, workflowRun.runId, 'release-back-merge', () => {
					const packageBackMerges = selectedPackageNames
						.map((name) => packageRepoByName.get(name))
						.filter((pkg): pkg is NonNullable<typeof pkg> => Boolean(pkg))
						.map((pkg) => backMergeProductionIntoStaging(pkg.dir, pkg.name, releaseAdminMessage({
							subject: `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`,
							version: selectedVersions.get(pkg.name) ?? null,
							sourceRef: PRODUCTION_BRANCH,
							targetRef: STAGING_BRANCH,
						})));
					const rootBackMerge = backMergeRootProductionIntoStaging(root, true, {
						version: plannedRelease.rootVersion,
						selectedVersions: stableVersions,
					});
					return { packages: packageBackMerges, root: rootBackMerge };
				});
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				const payload = {
					...releaseBasePayload,
					mode: plannedRelease.mode,
					runId: workflowRun.runId,
					releasePlan,
					releaseGates,
					workspaceUnlink,
					releaseMetadata,
					packageReleases,
					managedHelperReleases,
					rootRelease,
					publishWait: publishWait.workflowGates,
					publishedArtifacts,
					productionPackageDeployWorkflows,
					backMerge,
					workspaceLinks,
					releasedCommit: String((rootRelease.commit as { commitSha?: string }).commitSha ?? ''),
					touchedPackages: selectedPackageNames,
					finalBranch: STAGING_BRANCH,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult('release', root, payload, {
					runId: workflowRun.runId,
					summary: 'Treeseed production release completed successfully.',
					nextSteps: createNextSteps([
						{ operation: 'status', reason: 'Inspect release state after production promotion.' },
					]),
				});
			} catch (error) {
				try {
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				} catch {
					// Preserve the original release failure.
				}
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'release',
					message: 'Resume the interrupted production release after fixing the cause.',
					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${workflowRun.runId}`,
				});
				throw error;
			}
		});
	} catch (error) {
		toError('release', error);
	}
}

export async function workflowResume(helpers: WorkflowOperationHelpers, input: TreeseedResumeInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('resume', helpers.cwd());
			const runId = String(input.runId ?? '').trim();
			if (!runId) {
				workflowError('resume', 'validation_failed', 'Treeseed resume requires a run id.');
			}
			const journal = readWorkflowRunJournal(root, runId);
			if (!journal) {
				workflowError('resume', 'resume_unavailable', `Treeseed resume could not find run ${runId}.`, {
					details: { runId },
				});
			}
			if (journal.status === 'completed') {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is already completed.`, {
					details: { runId, status: journal.status },
				});
			}
			if (!journal.resumable) {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is not resumable.`, {
					details: { runId, status: journal.status },
				});
			}
			const session = resolveTreeseedWorkflowSession(root);
			const currentHeads = Object.fromEntries(
				[createWorkspaceRootRepoReport(root), ...createWorkspacePackageReports(root)]
					.map((report) => [report.name, report.commitSha ?? null]),
			);
			const classification = classifyWorkflowRunJournal(journal, {
				currentBranch: session.branchName,
				currentHeads,
			});
			if (classification.state !== 'resumable') {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is ${classification.state} and is not safe to resume.`, {
					details: { runId, status: journal.status, classification },
				});
			}
			const resumeRoot = typeof journal.session?.root === 'string' && existsSync(journal.session.root)
				? journal.session.root
				: root;
			const resumedHelpers: WorkflowOperationHelpers = helpersForCwd({
				...helpers,
				context: {
					...helpers.context,
					workflow: {
						...(helpers.context.workflow ?? {}),
						resumeRunId: runId,
					},
				},
			}, resumeRoot);
			switch (journal.command) {
				case 'switch':
					return workflowSwitch(resumedHelpers, journal.input as unknown as TreeseedSwitchInput);
				case 'save':
					return workflowSave(resumedHelpers, journal.input as unknown as TreeseedSaveInput);
				case 'update':
					return workflowUpdate(resumedHelpers, journal.input as unknown as TreeseedUpdateInput);
				case 'close':
					return workflowClose(resumedHelpers, journal.input as unknown as TreeseedCloseInput);
				case 'stage':
					return workflowStage(resumedHelpers, journal.input as unknown as TreeseedStageInput);
				case 'release':
					return workflowRelease(resumedHelpers, journal.input as unknown as TreeseedReleaseInput);
				case 'destroy':
					return workflowDestroy(resumedHelpers, journal.input as unknown as TreeseedDestroyInput);
				default:
					workflowError('resume', 'resume_unavailable', `Run ${runId} uses unsupported command ${journal.command}.`, {
						details: { runId, command: journal.command },
					});
			}
		});
	} catch (error) {
		toError('resume', error);
	}
}

export async function workflowRecover(helpers: WorkflowOperationHelpers, input: TreeseedRecoverInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('recover', helpers.cwd());
			const initialLocks = (['worktree', 'shared'] as const).map((scope) => ({
				scope,
				inspection: inspectWorkflowLock(root, { scope }),
			}));
			const clearedStaleLocks = initialLocks
				.filter((entry) => entry.inspection.stale && entry.inspection.lock?.runId)
				.map((entry) => ({
					scope: entry.scope,
					runId: entry.inspection.lock!.runId,
					command: entry.inspection.lock!.command,
					staleReason: entry.inspection.staleReason,
					removed: releaseWorkflowLock(root, entry.inspection.lock!.runId),
				}));
			const locks = (['worktree', 'shared'] as const).map((scope) => ({
				scope,
				inspection: inspectWorkflowLock(root, { scope }),
			}));
			const lock = locks.find((entry) => entry.inspection.active)?.inspection
				?? locks.find((entry) => entry.inspection.stale)?.inspection
				?? locks[0]!.inspection;
			const hasActiveLock = locks.some((entry) => entry.inspection.active);
			const orphanedRunningRuns = hasActiveLock
				? []
				: listWorkflowRunJournals(root).filter((journal) => journal.status === 'running');
			const prunedOrphanedRuns = input.pruneStale === true
				? orphanedRunningRuns.map((journal) => {
					const classification = {
						state: 'stale' as const,
						reasons: ['workflow journal was left running without an active workflow lock'],
						classifiedAt: new Date().toISOString(),
					};
					archiveWorkflowRun(root, journal.runId, classification);
					return { runId: journal.runId, command: journal.command, status: journal.status, classification };
				})
				: orphanedRunningRuns.map((journal) => {
					updateWorkflowRunJournal(root, journal.runId, (current) => ({
						...current,
						status: 'failed',
						updatedAt: new Date().toISOString(),
						failure: {
							code: 'interrupted',
							message: 'Workflow process ended without finalizing its journal.',
							details: { recovery: { resumable: current.resumable, runId: current.runId, resumeCommand: `treeseed resume ${current.runId}` } },
							at: new Date().toISOString(),
						},
					}));
					return null;
				}).filter((entry): entry is never => entry !== null);
			const journals = listWorkflowRunJournals(root);
			const session = resolveTreeseedWorkflowSession(root);
			const currentHeads = Object.fromEntries(
				[createWorkspaceRootRepoReport(root), ...createWorkspacePackageReports(root)]
					.map((report) => [report.name, report.commitSha ?? null]),
			);
			const classifiedRuns = classifyWorkflowRunJournals(root, {
				currentBranch: session.branchName,
				currentHeads,
			});
			const markedObsoleteRun = input.obsoleteRunId
				? (() => {
					const entry = classifiedRuns.find((candidate) => candidate.journal.runId === input.obsoleteRunId);
					if (!entry) {
						workflowError('recover', 'validation_failed', `Treeseed recover could not find workflow run ${input.obsoleteRunId}.`);
					}
					const reason = input.obsoleteReason?.trim() || 'marked obsolete by operator';
					const classification = {
						state: 'obsolete' as const,
						reasons: [reason],
						classifiedAt: new Date().toISOString(),
					};
					archiveWorkflowRun(root, entry.journal.runId, classification);
					return {
						runId: entry.journal.runId,
						command: entry.journal.command,
						reason,
					};
				})()
				: null;
			const effectiveClassifiedRuns = markedObsoleteRun
				? classifyWorkflowRunJournals(root, {
					currentBranch: session.branchName,
					currentHeads,
				})
				: classifiedRuns;
			const interruptedRuns = effectiveClassifiedRuns
				.filter((entry) => entry.classification.state === 'resumable')
				.map(({ journal }) => ({
					runId: journal.runId,
					command: journal.command,
					status: journal.status,
					createdAt: journal.createdAt,
					updatedAt: journal.updatedAt,
					nextStep: nextPendingJournalStep(journal)?.description ?? null,
					failure: journal.failure,
					resumeCommand: `treeseed resume ${journal.runId}`,
				}));
			const staleRuns = effectiveClassifiedRuns
				.filter((entry) => entry.classification.state === 'stale')
				.map(({ journal, classification }) => ({
					runId: journal.runId,
					command: journal.command,
					status: journal.status,
					createdAt: journal.createdAt,
					updatedAt: journal.updatedAt,
					nextStep: nextPendingJournalStep(journal)?.description ?? null,
					failure: journal.failure,
					classification,
				}));
			const obsoleteRuns = effectiveClassifiedRuns
				.filter((entry) => entry.classification.state === 'obsolete')
				.map(({ journal, classification }) => ({
					runId: journal.runId,
					command: journal.command,
					status: journal.status,
					createdAt: journal.createdAt,
					updatedAt: journal.updatedAt,
					failure: journal.failure,
					classification,
				}));
			const prunedRuns = input.pruneStale === true
				? staleRuns.map((run) => {
					archiveWorkflowRun(root, run.runId, run.classification);
					return run;
				})
				: [];
			const selectedRun = input.runId ? readWorkflowRunJournal(root, input.runId) : null;
			return buildWorkflowResult(
				'recover',
				root,
				{
					lock,
					locks: locks.map((entry) => ({ scope: entry.scope, ...entry.inspection })),
					clearedStaleLocks,
					interruptedRuns,
					staleRuns,
					obsoleteRuns,
					prunedRuns: [...prunedOrphanedRuns, ...prunedRuns],
					markedObsoleteRun,
					selectedRun,
					runCount: journals.length,
				},
				{
					includeFinalState: false,
					nextSteps: createNextSteps([
						...(interruptedRuns.length > 0
							? [{ operation: 'resume', reason: 'Resume the most recent interrupted workflow run.', input: { runId: interruptedRuns[0].runId } }]
							: staleRuns.length > 0 && input.pruneStale !== true
								? [{ operation: 'recover', reason: 'Archive stale interrupted runs that no longer match current heads.', input: { pruneStale: true } }]
							: [{ operation: 'status', reason: 'No interrupted runs were found; inspect current workflow state instead.' }]),
					]),
				},
			);
		});
	} catch (error) {
		toError('recover', error);
	}
}

export async function workflowDestroy(helpers: WorkflowOperationHelpers, input: TreeseedDestroyInput) {
	try {
		return withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('destroy', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const session = resolveTreeseedWorkflowSession(root);
			const scope = String(input.environment ?? input.target ?? '');
			if (!scope) {
				workflowError('destroy', 'validation_failed', 'Treeseed destroy requires an environment target.');
			}
			const executionMode = normalizeExecutionMode(input);
			const target = createPersistentDeployTarget(scope);
			const planOnly = executionMode === 'plan';
			const force = input.force === true;
			const deleteData = input.deleteData === true;
			const sweepTreeseed = input.sweepTreeseed === true;
			const destroyRemote = input.destroyRemote !== false;
			const destroyLocal = input.destroyLocal !== false;
			const removeBuildArtifacts = input.removeBuildArtifacts === true;
			applyTreeseedEnvironmentToProcess({ tenantRoot, scope, override: true });
			assertTreeseedCommandEnvironment({ tenantRoot, scope, purpose: 'destroy' });
			const deployConfig = validateDestroyPrerequisites(tenantRoot, { requireRemote: executionMode === 'execute' && destroyRemote });
			const state = loadDeployState(tenantRoot, deployConfig, { target });
			const expectedConfirmation = deployConfig.slug;
			const payload = {
				scope,
				planOnly,
				force,
				deleteData,
				sweepTreeseed,
				destroyRemote,
				destroyLocal,
				removeBuildArtifacts,
				expectedConfirmation,
				stateSummary: {
					workerName: state.workerName,
					lastDeploymentTimestamp: state.lastDeploymentTimestamp ?? null,
				},
				plannedSteps: [
					...(destroyRemote ? [{ id: 'destroy-remote', description: `Destroy remote ${scope} resources` }] : []),
					...(sweepTreeseed ? [{ id: 'sweep-treeseed-resources', description: 'Sweep TreeSeed-owned provider resources across persistent environments' }] : []),
					...(destroyLocal ? [{ id: 'cleanup-local', description: `Clean local ${scope} state${removeBuildArtifacts ? ' and build artifacts' : ''}` }] : []),
				],
				remoteResult: null,
			};

			if (executionMode === 'plan') {
				const plannedRemoteResult = destroyRemote
					? await destroyTreeseedEnvironmentResources(tenantRoot, { planOnly: true, force, deleteData, sweepTreeseed, target })
					: null;
				return buildWorkflowResult(
					'destroy',
					tenantRoot,
					{
						...payload,
						remoteResult: plannedRemoteResult,
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'destroy', reason: 'Run without --plan to destroy the selected environment.', input: { environment: scope, force, deleteData, sweepTreeseed, removeBuildArtifacts } },
							{ operation: 'status', reason: 'Confirm the current environment state before making destructive changes.' },
						]),
					},
				);
			}

			const workflowRun = acquireWorkflowRun(
				'destroy',
				session,
				{
					environment: scope,
					force,
					deleteData,
					sweepTreeseed,
					destroyRemote,
					destroyLocal,
					removeBuildArtifacts,
				},
				[
					...(destroyRemote
						? [{
							id: 'destroy-remote',
							description: `Destroy remote ${scope} resources`,
							repoName: session.rootRepo.name,
							repoPath: session.rootRepo.path,
							branch: session.branchName,
							resumable: false,
						}]
						: []),
					...(destroyLocal
						? [{
							id: 'cleanup-local',
							description: `Clean local ${scope} state${removeBuildArtifacts ? ' and build artifacts' : ''}`,
							repoName: session.rootRepo.name,
							repoPath: session.rootRepo.path,
							branch: session.branchName,
							resumable: false,
						}]
						: []),
				],
				helpers.context,
			);

			try {
				const confirmed = await Promise.resolve(resolveDestroyConfirmation(helpers.context, expectedConfirmation, input));
				if (!confirmed) {
					workflowError('destroy', 'confirmation_required', `Destroy confirmation required. Re-run with confirm="${expectedConfirmation}".`);
				}

				const remoteResult = destroyRemote
					? await executeJournalStep(root, workflowRun.runId, 'destroy-remote', () =>
						destroyTreeseedEnvironmentResources(tenantRoot, { planOnly: false, force, deleteData, sweepTreeseed, target }) as Record<string, unknown>)
					: null;
				if (!destroyRemote) {
					skipJournalStep(root, workflowRun.runId, 'destroy-remote', { skippedReason: 'destroyRemote=false' });
				}

				if (destroyLocal) {
					await executeJournalStep(root, workflowRun.runId, 'cleanup-local', () => {
						cleanupDestroyedState(tenantRoot, { target, removeBuildArtifacts });
						return {
							cleaned: true,
							removeBuildArtifacts,
						};
					});
				} else {
					skipJournalStep(root, workflowRun.runId, 'cleanup-local', { skippedReason: 'destroyLocal=false' });
				}

				const resultPayload = {
					...payload,
					planOnly: false,
					remoteResult,
				};
				completeWorkflowRun(root, workflowRun.runId, resultPayload);
				return buildWorkflowResult(
					'destroy',
					tenantRoot,
					resultPayload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'config', reason: 'Recreate the destroyed environment before using it again.', input: { environment: [scope] } },
							{ operation: 'status', reason: 'Confirm the environment teardown state and any remaining local runtime setup.' },
						]),
					},
				);
			} catch (error) {
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: false,
					runId: workflowRun.runId,
					command: 'destroy',
					message: `Inspect the failed destroy run for ${scope} before retrying manually.`,
					recoverCommand: 'treeseed recover',
				});
				throw error;
			}
		});
	} catch (error) {
		toError('destroy', error);
	}
}
