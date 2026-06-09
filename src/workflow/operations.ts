import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
	applyTreeseedEnvironmentToProcess,
	applyTreeseedConfigValues,
	applyTreeseedSafeRepairs,
	assertTreeseedCommandEnvironment,
	checkTreeseedProviderConnections,
	collectTreeseedConfigContext,
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
import { collectTreeseedToolStatus, formatTreeseedDependencyFailureDetails, installTreeseedDependencies } from '../managed-dependencies.ts';
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
	recordHostedDeploymentState,
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
	checkoutTaskBranchFromStaging,
	createDeprecatedTaskTag,
	deleteLocalBranch,
	deleteRemoteBranch,
	ensureLocalBranchTracking,
	gitWorkflowRoot,
	headCommit,
	listTaskBranches,
	mergeBranchIntoTarget,
	prepareReleaseBranches,
	PRODUCTION_BRANCH,
	pushBranch,
	pushHeadToBranch,
	reattachDetachedHeadIfSafe,
	remoteBranchExists,
	STAGING_BRANCH,
	squashMergeBranchIntoStaging,
	syncBranchWithOrigin,
} from '../operations/services/git-workflow.ts';
import { resolveGitHubRepositorySlug } from '../operations/services/github-automation.ts';
import { resolveGitHubCredentialForRepository } from '../operations/services/github-credentials.ts';
import { dispatchGitHubWorkflowRun } from '../operations/services/github-api.ts';
import {
	formatGitHubActionsGateFailure,
	inspectGitHubActionsVerification,
	skippedGitHubActionsGate,
	waitForGitHubActionsGate,
	type GitHubActionsVerificationTarget,
	type GitHubActionsWorkflowGate,
	type GitHubActionsVerificationReport,
} from '../operations/services/github-actions-verification.ts';
import {
	runReleaseCandidateGate,
	type ReleaseCandidateReport,
} from '../operations/services/release-candidate.ts';
import {
	collectReleaseHistoryCommits,
	renderAdministrativeCommitMessage,
	upsertReleaseChangelog,
	type ReleaseHistoryCommit,
	type ReleaseHistorySummary,
} from '../operations/services/release-history.ts';
import { loadCliDeployConfig, packageScriptPath, resolveWranglerBin } from '../operations/services/runtime-tools.ts';
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
import {
	assertNoInternalDevReferences,
	cleanupStaleTreeseedDevTags,
	collectTreeseedDevTagCleanupPlan,
	collectInternalDevReferenceIssues,
	devTagFromDependencySpec,
	normalizeGitRemoteForManifest,
	rewriteProjectInternalDependenciesToStableVersions,
	type DevTagBranchScope,
	type DevTagCleanupMode,
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
import { runTreeseedHostingAudit, type TreeseedHostingAuditEnvironment } from '../operations/services/hosting-audit.ts';
import { collectTreeseedHostedServiceChecks } from '../operations/services/hosted-service-checks.ts';
import { collectTreeseedDeploymentReadiness } from '../operations/services/deployment-readiness.ts';
import { collectTreeseedLiveHostedServiceChecks } from '../operations/services/live-hosted-service-checks.ts';
import { discoverTreeseedApplications } from '../hosting/apps.ts';
import { resolveTreeseedWorkflowState, type TreeseedWorkflowStatusOptions } from '../workflow-state.ts';
import { createTreeseedReconcileRegistry, deriveTreeseedDesiredUnits, filterTreeseedDesiredUnitsByBootstrapSystems, planTreeseedReconciliation, resolveTreeseedBootstrapSelection, reconcileTreeseedTarget } from '../reconcile/index.ts';
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
	TreeseedReleaseInput,
	TreeseedRecoverInput,
	TreeseedResumeInput,
	TreeseedSaveInput,
	TreeseedStageInput,
	TreeseedSwitchInput,
	TreeseedTagsCleanupInput,
	TreeseedTaskBranchMetadata,
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
} from '../workflow.ts';

type WorkflowWrite = NonNullable<TreeseedWorkflowContext['write']>;
type WorkflowStatePayload = ReturnType<typeof resolveTreeseedWorkflowState>;

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
	| 'github_auth_unavailable';

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
		{ name: '@treeseed/sdk', dir: 'packages/sdk', artifacts: ['dist/workflow-support.js', 'dist/plugin-default.js', 'dist/platform/env.yaml'] },
		{ name: '@treeseed/agent', dir: 'packages/agent', artifacts: ['dist/api/index.js', 'dist/services/worker.js'] },
		{ name: '@treeseed/core', dir: 'packages/core', artifacts: ['dist/plugin-default.js'] },
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
	return run('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: repoDir, capture: true })
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
		run('git', ['add', pkg.repoPath], { cwd: gitRoot });
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
	const report = unlinkLocalWorkspaceLinks(root, { mode, env: helpers.context.env });
	if (report.removed.length > 0) {
		helpers.write(`[workspace][unlink] Removed ${report.removed.length} local workspace package links for deployment install.`);
	}
	return report;
}

function normalizeCiMode(mode: TreeseedWorkflowCiMode | undefined, operation: 'save' | 'stage' | 'release') {
	if (mode === 'hosted' || mode === 'off') return mode;
	return operation === 'save' ? 'off' : 'hosted';
}

function normalizeSaveCiMode(mode: TreeseedWorkflowCiMode | undefined, branch: string | null | undefined) {
	if (mode === 'hosted' || mode === 'off') return mode;
	return branch === STAGING_BRANCH ? 'hosted' : 'off';
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

function shouldUseHostedSaveCi(input: TreeseedSaveInput, branch: string | null | undefined) {
	return normalizeSaveCiMode(input.ciMode, branch) === 'hosted'
		|| input.verifyMode === 'hosted'
		|| input.verifyMode === 'both'
		|| input.verifyDeployedResources === true;
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

function assertHostedGitHubWorkflowAuthReady(operation: TreeseedWorkflowOperationId, root: string) {
	const tools = collectTreeseedToolStatus({
		tenantRoot: root,
		env: process.env,
	});
	const github = tools.auth.github;
	if (!github.authenticated) {
		const command = github.command.length > 0 ? github.command.join(' ') : 'npx trsd tools --json';
		workflowError(
			operation,
			'github_auth_unavailable',
			[
				'Treeseed hosted GitHub workflow gates require an authenticated managed GitHub CLI.',
				github.detail,
				`Managed gh check: ${command}`,
				'Remediation:',
				...github.remediation.map((item) => `- ${item}`),
			].join('\n'),
			{
				details: {
					toolsHome: tools.toolsHome,
					ghConfigDir: tools.ghConfigDir,
					github,
					tools: tools.tools,
				},
			},
		);
	}
	return tools;
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
	assertHostedGitHubWorkflowAuthReady(operation, options.root ?? gates[0]!.repoPath);
	const results: Array<Record<string, unknown>> = [];
	for (const gate of gates) {
		if (options.root && options.runId) {
			const cached = getCachedSuccessfulWorkflowGate(options.root, options.runId, {
				repository: gate.repository ?? null,
				workflow: gate.workflow,
				headSha: gate.headSha,
				branch: gate.branch,
			});
			if (cached) {
				results.push({
					...cached.result,
					name: gate.name,
					cached: true,
				});
				continue;
			}
		}
		const result = await waitForGitHubActionsGate(gate, {
			operation,
			env: githubWorkflowGateEnv(options.root, gate),
			onProgress: options.onProgress,
		});
		const normalized = {
			name: gate.name,
			...result,
			workflow: String(result.workflow ?? gate.workflow),
			branch: String(result.branch ?? gate.branch),
			headSha: String(result.headSha ?? gate.headSha),
			timeoutSeconds: gate.timeoutSeconds ?? null,
			cached: false,
		};
		if (normalized.status === 'completed' && normalized.conclusion !== 'success') {
			workflowError(operation, 'github_workflow_failed', formatGitHubActionsGateFailure(gate, normalized), {
				details: { gate, workflow: normalized },
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
			GH_TOKEN: credential.token,
			GITHUB_TOKEN: credential.token,
		};
	} catch {
		return process.env;
	}
}

const HOSTED_DEPLOY_GATE_TIMEOUT_SECONDS = 45 * 60;

function hostedDeployGate(gate: GitHubActionsWorkflowGate): GitHubActionsWorkflowGate {
	return {
		...gate,
		timeoutSeconds: gate.timeoutSeconds ?? HOSTED_DEPLOY_GATE_TIMEOUT_SECONDS,
	};
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
			candidate.workflow === 'deploy-web.yml'
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

function findReportByName(reports: WorkflowRepoReport[], name: string) {
	return reports.find((report) => report.name === name) ?? null;
}

function findReportByPath(reports: WorkflowRepoReport[], path: string) {
	return reports.find((report) => report.path === path) ?? null;
}

function assertWorkspaceClean(root: string) {
	const repoDirs = [repoRoot(root), ...checkedOutWorkspacePackageRepos(root).map((pkg) => pkg.dir)];
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
	} = {},
): TreeseedWorkflowResult<TPayload & { finalState?: WorkflowStatePayload }> {
	const resolvedPayload = (options.includeFinalState ?? true)
		? {
			...(payload as Record<string, unknown>),
			finalState: resolveWorkflowStateSnapshot(cwd),
		}
		: payload;
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
		payload: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload },
		result: resolvedPayload as TPayload & { finalState?: WorkflowStatePayload },
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
	for (const packageName of packages) {
		if (packageName === '@treeseed/api' || packageName === '@treeseed/treedx' || packageName === '@treeseed/agent') {
			add('api', `${packageName} changed`);
		} else if (packageName === '@treeseed/core') {
			add('web', `${packageName} changed`);
		} else if (packageName === '@treeseed/sdk' || packageName === '@treeseed/cli') {
			add('web', `${packageName} is shared`);
			add('api', `${packageName} is shared`);
		}
	}

	const changedPaths = input.changedPaths ?? parseGitStatusChangedPaths(gitStatusPorcelain(root));
	for (const file of changedPaths) {
		if (file.startsWith('packages/api/') || file === 'packages/api') {
			add('api', `${file} is API-owned`);
		} else if (file.startsWith('packages/treedx/') || file === 'packages/treedx') {
			add('api', `${file} is TreeDX implementation`);
		} else if (file.startsWith('packages/core/') || file.startsWith('src/') || file.startsWith('content/') || file.startsWith('public/') || file === 'treeseed.site.yaml') {
			add('web', `${file} is web-owned`);
		} else if (file.startsWith('packages/sdk/') || file.startsWith('packages/cli/') || file === 'package.json' || file === 'package-lock.json' || file.startsWith('.github/')) {
			add('web', `${file} is shared workflow/config`);
			add('api', `${file} is shared workflow/config`);
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

async function runWorkflowHostedResourceVerification(
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
	const hostingAudit = await runTreeseedHostingAudit({
		tenantRoot: root,
		environment,
		repair: false,
		hostKinds: options.appId === 'api' ? ['repository'] : undefined,
		env: helpers.context.env,
		write: (line) => helpers.write(line),
	});
	const hostedServices = options.live
		? await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root,
			target,
			strict: options.strict === true,
			requireLiveRailway: options.strict === true,
			requireLiveHttp: options.strict === true,
			appId: options.appId,
			env: helpers.context.env,
		})
		: collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target,
			appId: options.appId,
		});
	if (options.strict && !hostingAudit.ok) {
		workflowError(operation, 'validation_failed', `Hosting audit failed for ${hostingAudit.environment}: ${hostingAudit.blockers.join('\n')}`, {
			details: { hostingAudit, hostedServices, readiness },
		});
	}
	if (options.strict && hostedServices.summary.failed > 0) {
		const failures = hostedServices.checks
			.filter((check) => check.status === 'failed')
			.map((check) => `${check.id}: ${check.issues.join('; ') || check.description}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`);
		workflowError(operation, 'validation_failed', `Hosted service checks failed for ${hostedServices.target}:\n${failures.join('\n')}`, {
			details: { hostingAudit, hostedServices, readiness },
		});
	}
	return {
		hostingAudit,
		hostedServices,
		readiness,
		live: options.live === true,
	};
}

function normalizeExecutionMode(input: { plan?: boolean; dryRun?: boolean } | undefined): TreeseedWorkflowExecutionMode {
	return input?.plan === true || input?.dryRun === true ? 'plan' : 'execute';
}

function submodulePointerForRef(repoDir: string, ref: string, relativeDir: string) {
	try {
		const output = run('git', ['ls-tree', ref, relativeDir], { cwd: repoDir, capture: true }).trim();
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

function applyStableWorkspaceVersionChanges(root: string, versions: Map<string, string>) {
	const stableGitReferences = stablePackageGitReferences(root, versions);
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
				const dependencySpec = stableGitReferences.get(dependencyName) ?? version;
				if (String((values as Record<string, unknown>)[dependencyName]) === dependencySpec) continue;
				(values as Record<string, unknown>)[dependencyName] = dependencySpec;
				changed = true;
			}
		}
		if (changed) {
			writeJsonFile(packageJsonPath, packageJson);
		}
	}
}

function stablePackageGitReferences(root: string, versions: Map<string, string>) {
	return new Map(workspacePackages(root)
		.map((pkg) => {
			const version = versions.get(pkg.name);
			if (!version) return null;
			let remote: string | null = null;
			try {
				remote = originRemoteUrl(pkg.dir);
			} catch {
				remote = null;
			}
			const manifestRemote = normalizeGitRemoteForManifest(remote ?? '', 'preserve-origin');
			return manifestRemote ? [pkg.name, `${manifestRemote}#${version}`] as const : null;
		})
		.filter((entry): entry is readonly [string, string] => Boolean(entry)));
}

function gitObjectCommit(repoDir: string, ref: string) {
	try {
		return run('git', ['rev-list', '-n', '1', ref], { cwd: repoDir, capture: true }).trim() || null;
	} catch {
		return null;
	}
}

function remoteTagCommit(repoDir: string, tagName: string) {
	const output = run('git', ['ls-remote', 'origin', `refs/tags/${tagName}`, `refs/tags/${tagName}^{}`], { cwd: repoDir, capture: true }).trim();
	if (!output) return null;
	const peeled = output.split('\n').find((line) => line.endsWith(`refs/tags/${tagName}^{}`));
	const direct = output.split('\n').find((line) => line.endsWith(`refs/tags/${tagName}`));
	return (peeled ?? direct)?.split(/\s+/u)[0] ?? null;
}

function ensureReleaseTag(repoDir: string, tagName: string, commitSha: string, message?: string) {
	const localCommit = gitObjectCommit(repoDir, tagName);
	if (localCommit && localCommit !== commitSha) {
		throw new Error(`Release tag ${tagName} already exists locally at ${localCommit}, expected ${commitSha}.`);
	}
	if (!localCommit) {
		run('git', ['tag', '-a', tagName, commitSha, '-m', message ?? `release: ${tagName}`], { cwd: repoDir });
	}
	const remoteCommit = remoteTagCommit(repoDir, tagName);
	if (remoteCommit && remoteCommit !== commitSha) {
		throw new Error(`Release tag ${tagName} already exists on origin at ${remoteCommit}, expected ${commitSha}.`);
	}
	if (!remoteCommit) {
		run('git', ['push', 'origin', tagName], { cwd: repoDir });
	}
	return {
		tagName,
		local: localCommit ? 'existing' : 'created',
		remote: remoteCommit ? 'existing' : 'pushed',
	};
}

function commitAllIfChanged(repoDir: string, message: string) {
	run('git', ['add', '-A'], { cwd: repoDir });
	if (!hasMeaningfulChanges(repoDir)) {
		return { committed: false, commitSha: headCommit(repoDir) };
	}
	run('git', ['commit', '-m', message], { cwd: repoDir });
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
		return ['deploy-web.yml'];
	}
	return ['verify.yml'];
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
	const workflows = workflowOverrides.length > 0 ? workflowOverrides : defaultCiWorkflows(kind, branch);
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
	const deployConfig = loadCliDeployConfig(tenantRoot);
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
	return listInterruptedWorkflowRuns(root).find((journal) =>
		journal.command === 'save'
		&& journal.resumable
		&& journal.session.branchName === branch) ?? null;
}

function gatesForSavedPackageReports(reports: RepositorySaveReport[]) {
	return reports
		.filter((repo) => repo.pushed && repo.commitSha && repo.branch)
		.map((repo) => ({
			name: repo.name,
			repoPath: repo.path,
			workflow: 'verify.yml',
			branch: String(repo.branch),
			headSha: String(repo.commitSha),
		}));
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
				run('git', ['ls-files', '--error-unmatch', filePath], { cwd: repoDir, capture: true });
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
		const status = run('git', ['status', '--porcelain', '--', filePath], { cwd: repo.path, capture: true });
		if (!status.trim()) {
			skipped.push(filePath);
			continue;
		}
		run('git', ['restore', '--staged', '--worktree', '--', filePath], { cwd: repo.path, capture: true });
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
	for (const journal of listInterruptedWorkflowRuns(root).filter((entry) => entry.command === 'release')) {
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
	return listInterruptedWorkflowRuns(root).find((journal) => {
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
		.filter((pkg) => !existsSync(resolve(pkg.dir, '.github', 'workflows', 'publish.yml')))
		.map((pkg) => pkg.name);
	if (missing.length > 0) {
		workflowError('release', 'workflow_contract_missing', `Treeseed release requires .github/workflows/publish.yml in: ${missing.join(', ')}.`, {
			details: {
				missing,
			},
		});
	}
}

function validateStagingWorkflowContracts(root: string) {
	if (process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return;
	}
	const missing: string[] = [];
	for (const fileName of ['verify.yml', 'deploy-web.yml']) {
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

function runReleaseNpmInstall(repoDir: string, options: { workspaceRoot?: string } = {}) {
	if (shouldSkipReleaseInstall()) {
		return { status: 'skipped', reason: 'disabled' };
	}
	const args = repoDir === options.workspaceRoot
		? ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund']
		: ['install', '--package-lock-only', '--ignore-scripts', '--workspaces=false', '--no-audit', '--no-fund'];
	const result = spawnSync('npm', args, {
		cwd: repoDir,
		env: {
			...process.env,
			npm_config_audit: 'false',
			npm_config_fund: 'false',
		},
		stdio: 'pipe',
		encoding: 'utf8',
	});
	if (result.status !== 0) {
		const detail = [
			result.error?.message,
			result.stderr?.trim(),
			result.stdout?.trim(),
		].filter(Boolean).join('\n');
		throw new Error(detail || `npm ${args.join(' ')} failed`);
	}
	return { status: 'completed', reason: null };
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
	syncBranchWithOrigin(repoDir, PRODUCTION_BRANCH);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	checkoutBranch(repoDir, STAGING_BRANCH);
	try {
		run('git', ['merge-base', '--is-ancestor', `origin/${PRODUCTION_BRANCH}`, 'HEAD'], { cwd: repoDir, capture: true });
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
		run('git', ['merge', '--no-ff', `origin/${PRODUCTION_BRANCH}`, '-m', message ?? `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`], { cwd: repoDir });
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

function collectActiveDevTagReferences(root: string) {
	return collectInternalDevReferenceIssues(root)
		.map((issue) => devTagFromDependencySpec(issue.spec) ?? (issue.spec.includes('-dev.') ? issue.spec : null))
		.filter((value): value is string => Boolean(value));
}

function normalizeIncludePackages(value: TreeseedTagsCleanupInput['includePackages']) {
	if (!value) return null;
	const values = Array.isArray(value) ? value : String(value).split(',');
	const normalized = values.map((entry) => String(entry).trim()).filter(Boolean);
	return normalized.length > 0 ? new Set(normalized) : null;
}

function normalizeDevTagBranchScope(value: TreeseedTagsCleanupInput['branchScope']): DevTagBranchScope {
	return value === 'staging' || value === 'preview' || value === 'all' ? value : 'all';
}

function packageJsonVersion(repoDir: string) {
	const packageJson = JSON.parse(readFileSync(resolve(repoDir, 'package.json'), 'utf8')) as Record<string, unknown>;
	return String(packageJson.version ?? '');
}

function collectStaleDevTagCleanupReports(root: string, input: TreeseedTagsCleanupInput, options: { execute: boolean }) {
	const includePackages = normalizeIncludePackages(input.includePackages);
	const branchScope = normalizeDevTagBranchScope(input.branchScope);
	const activeDevTags = collectActiveDevTagReferences(root);
	const repos = checkedOutWorkspacePackageRepos(root)
		.filter((pkg) => !includePackages || includePackages.has(pkg.name))
		.map((pkg) => {
			const currentVersion = packageJsonVersion(pkg.dir);
			const report = options.execute
				? cleanupStaleTreeseedDevTags({
					repoDir: pkg.dir,
					packageName: pkg.name,
					currentVersion,
					activeReferences: activeDevTags,
					branchScope,
				})
				: {
					...collectTreeseedDevTagCleanupPlan({
						repoDir: pkg.dir,
						packageName: pkg.name,
						currentVersion,
						activeReferences: activeDevTags,
						branchScope,
					}),
					status: 'planned',
					candidateCount: 0,
					cleaned: [] as string[],
					cleanedCount: 0,
					skippedCount: 0,
				};
			if (!options.execute) {
				const planned = report as ReturnType<typeof collectTreeseedDevTagCleanupPlan> & { status: string; candidateCount: number; cleaned: string[]; cleanedCount: number; skippedCount: number };
				planned.candidateCount = planned.candidates.length;
				planned.skippedCount = planned.skipped.length;
			}
			return {
				name: pkg.name,
				path: relative(root, pkg.dir),
				...report,
			};
		});
	return {
		status: options.execute ? 'completed' : 'planned',
		branchScope,
		includePackages: includePackages ? [...includePackages].sort() : [],
		repos,
		candidateCount: repos.reduce((total, repo) => total + Number(repo.candidateCount ?? 0), 0),
		cleanedCount: repos.reduce((total, repo) => total + Number(repo.cleanedCount ?? 0), 0),
		skippedCount: repos.reduce((total, repo) => total + Number(repo.skippedCount ?? 0), 0),
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

function releasePlanPackageSelection(value: unknown): { changed: string[]; dependents: string[]; selected: string[] } {
	const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	return {
		changed: Array.isArray(record.changed) ? record.changed.map(String) : [],
		dependents: Array.isArray(record.dependents) ? record.dependents.map(String) : [],
		selected: Array.isArray(record.selected) ? record.selected.map(String) : [],
	};
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

function assertReleaseCandidatePassed(operation: Extract<TreeseedWorkflowOperationId, 'save' | 'stage' | 'release'>, report: ReleaseCandidateReport) {
	if (report.status === 'passed') {
		return;
	}
	const rendered = report.failures.map((failure) => `- ${failure.scope}${failure.provider ? ` ${failure.provider}` : ''}: ${failure.message}`);
	workflowError(operation, 'validation_failed', [
		'Treeseed release-candidate readiness failed.',
		...rendered,
	].join('\n'), {
		details: {
			releaseCandidate: report,
		},
	});
}

async function runReleaseCandidateForPlan(
	operation: Extract<TreeseedWorkflowOperationId, 'save' | 'stage' | 'release'>,
	root: string,
	plannedRelease: { plannedVersions?: unknown; packageSelection?: unknown },
	options: { allowReuse?: boolean } = {},
) {
	const plannedVersions = plannedRelease.plannedVersions && typeof plannedRelease.plannedVersions === 'object' && !Array.isArray(plannedRelease.plannedVersions)
		? plannedRelease.plannedVersions as Record<string, unknown>
		: {};
	const stableDependencyVersions = plannedRelease.stableDependencyVersions && typeof plannedRelease.stableDependencyVersions === 'object' && !Array.isArray(plannedRelease.stableDependencyVersions)
		? plannedRelease.stableDependencyVersions as Record<string, unknown>
		: {};
	const packageSelection = releasePlanPackageSelection(plannedRelease.packageSelection);
	const report = await runReleaseCandidateGate({
		root,
		plannedVersions: { ...stableDependencyVersions, ...plannedVersions },
		selectedPackageNames: packageSelection.selected,
		allowReuse: options.allowReuse,
	});
	assertReleaseCandidatePassed(operation, report);
	return report;
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
	const selectedPackageNames = new Set(input.packageSelection.selected);
	const applicationSelection = selectWorkflowApplications(input.root, { packageSelection: input.packageSelection });
	const versionPlan = planWorkspaceReleaseBump(input.level, input.root, input.mode === 'recursive-workspace'
		? { selectedPackageNames, repairVersionLine: input.repairVersionLine === true, targetVersionLine: input.targetVersionLine }
		: {});
	const plannedSelected = [...versionPlan.selected].filter((name) => versionPlan.versions.has(name));
	const plannedChanged = input.repairVersionLine === true
		? plannedSelected
		: Array.from(new Set(input.packageSelection.changed.filter((name) => plannedSelected.includes(name))));
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
		plannedPublishWaits: plannedPackageSelection.selected.map((name) => ({
			name,
			workflow: 'publish.yml',
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
			{ id: 'cleanup-dev-tags', description: 'Clean replaced Treeseed dev tags after stable release' },
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
	assertHostedGitHubWorkflowAuthReady('release', root);
	for (const pkg of checkedOutWorkspacePackageRepos(root)) {
		if (!selectedPackageNames.has(pkg.name)) continue;
		resolveGitHubRepositorySlug(pkg.dir);
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
	const detached = session.packageRepos.filter((repo) => repo.detached).map((repo) => repo.name);
	if (detached.length > 0) {
		workflowError(operation, 'validation_failed', `Detached package heads detected: ${detached.join(', ')}.`, {
			details: { detached },
		});
	}
	if (requireCleanPackages) {
		const dirty = session.packageRepos.filter((repo) => repo.dirty).map((repo) => repo.name);
		if (dirty.length > 0) {
			workflowError(operation, 'validation_failed', `Dirty package repos block ${operation}: ${dirty.join(', ')}.`, {
				details: { dirty },
			});
		}
	}
	if (requireCurrentBranch && session.branchName) {
		const missing = session.packageRepos
			.filter((repo) => repo.branchName !== session.branchName)
			.map((repo) => ({ name: repo.name, branchName: repo.branchName }));
		if (missing.length > 0) {
			workflowError(operation, 'validation_failed', `Package branch alignment is required for ${operation}.`, {
				details: { expectedBranch: session.branchName, repos: missing },
			});
		}
	}
	const missingOriginRepos = [
		session.rootRepo,
		...(allowPackageReposWithoutOrigin ? [] : session.packageRepos),
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
	const deployConfig = loadCliDeployConfig(tenantRoot);
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

async function deployBranchPreview(
	tenantRoot: string,
	branchName: string,
	context: TreeseedWorkflowContext,
	{ initialize }: { initialize: boolean },
) {
	applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging', override: true });
	assertTreeseedCommandEnvironment({ tenantRoot, scope: 'staging', purpose: 'deploy' });
	const target = createBranchPreviewDeployTarget(branchName);
	const existingState = previewStateFor(tenantRoot, branchName);

	if (initialize && !existingState.readiness?.initialized) {
		validateDeployPrerequisites(tenantRoot, { requireRemote: true });
		await reconcileTreeseedTarget({
			tenantRoot,
			target,
			env: { ...process.env, ...(context.env ?? {}) },
			write: (line) => context.write?.(line),
		});
		runRemoteD1Migrations(tenantRoot, { target });
	} else {
		assertDeploymentInitialized(tenantRoot, { target });
		runRemoteD1Migrations(tenantRoot, { target });
	}

	runTenantDeployPreflight({ cwd: tenantRoot, scope: 'staging' });
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	runNodeScript('tenant-build', context, tenantRoot, 'tenant build');
	const deployResult = spawnSync(process.execPath, [resolveWranglerBin(), 'deploy', '--config', wranglerPath], {
		cwd: tenantRoot,
		env: { ...process.env, ...(context.env ?? {}) },
		stdio: 'inherit',
	});
	if ((deployResult.status ?? 1) !== 0) {
		workflowError('switch', 'unsupported_state', 'Preview deployment failed.', {
			exitCode: deployResult.status ?? 1,
			details: { branchName, wranglerPath },
		});
	}

	const state = finalizeDeploymentState(tenantRoot, { target });
	return {
		initialized: existingState.readiness?.initialized !== true,
		previewUrl: state.lastDeployedUrl ?? null,
		lastDeploymentTimestamp: state.lastDeploymentTimestamp ?? null,
		wranglerPath,
	};
}

function destroyPreviewIfPresent(tenantRoot: string, branchName: string) {
	const previewTarget = createBranchPreviewDeployTarget(branchName);
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const previewState = loadDeployState(tenantRoot, deployConfig, { target: previewTarget });
	if (previewState.readiness?.initialized) {
		applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging', override: true });
		validateDestroyPrerequisites(tenantRoot, { requireRemote: true });
		destroyCloudflareResources(tenantRoot, { target: previewTarget });
	}
	cleanupDestroyedState(tenantRoot, { target: previewTarget });
	return {
		performed: previewState.readiness?.initialized === true,
		state: previewState,
	};
}

function resolveDestroyConfirmation(
	context: TreeseedWorkflowContext,
	expected: string,
	input: TreeseedDestroyInput,
) {
	if (input.dryRun) {
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
			run('git', ['pull', '--rebase', 'origin', branch], { cwd: repoDir });
			run('git', ['push', 'origin', branch], { cwd: repoDir });
			return {
				remoteBranchExisted: true,
				pulledRebase: true,
				pushed: true,
				createdRemoteBranch: false,
				conflicts: false,
			};
		}

		run('git', ['push', '-u', 'origin', branch], { cwd: repoDir });
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
		run('git', ['checkout', '-b', branch, `origin/${branch}`], { cwd: repoDir });
		return branch;
	}
	run('git', ['checkout', '-b', branch], { cwd: repoDir });
	return branch;
}

function runPackageVerifyLocal(pkgDir: string) {
	run('npm', ['run', 'verify:local'], { cwd: pkgDir });
}

function branchNeedsSync(repoDir: string, branch: string) {
	if (!remoteBranchExists(repoDir, branch)) {
		return true;
	}
	const localHead = run('git', ['rev-parse', 'HEAD'], { cwd: repoDir, capture: true }).trim();
	const remoteHead = run('git', ['rev-parse', `origin/${branch}`], { cwd: repoDir, capture: true }).trim();
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
		report.commitSha = run('git', ['rev-parse', 'HEAD'], { cwd: report.path, capture: true }).trim();
		return report;
	}

	if (shouldVerify && report.dirty) {
		runPackageVerifyLocal(report.path);
		report.verified = true;
	}

	if (report.dirty) {
		run('git', ['add', '-A'], { cwd: report.path });
		run('git', ['commit', '-m', message], { cwd: report.path });
		report.committed = true;
	}
	report.commitSha = run('git', ['rev-parse', 'HEAD'], { cwd: report.path, capture: true }).trim();
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
	message: string,
	{ deleteBranch = true, targetBranch = STAGING_BRANCH } = {},
) {
	if (!ensureLocalTaskBranch(report.path, branchName)) {
		report.skippedReason = 'branch-missing';
		return report;
	}

	const deprecatedTag = createDeprecatedTaskTag(report.path, branchName, message);
	report.tagName = deprecatedTag.tagName;
	report.commitSha = deprecatedTag.head;
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
	return run('git', ['diff', '--cached', '--name-only'], { cwd: repoDir, capture: true }).trim().length > 0;
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

export async function workflowTasks(helpers: WorkflowOperationHelpers) {
	return withContextEnv(helpers.context.env, () => createTasksResult(helpers.cwd()));
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
			const executionMode = normalizeExecutionMode(input);
			if (executionMode !== 'plan' && shouldDispatchSwitchToManagedWorktree(root, input, helpers.context.env)) {
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
			const packageReports = createWorkspacePackageReports(root);
			let previewResult: Record<string, unknown> | null = null;
			const dirtyRepos = [rootRepo, ...packageReports].filter((repo) => repo.dirty).map((repo) => repo.name);

			if (executionMode === 'plan') {
				for (const report of [rootRepo, ...packageReports]) {
					const local = branchExists(report.path, branchName);
					const remote = remoteBranchExists(report.path, branchName);
					report.created = !local && !remote;
					report.resumed = local || remote;
				}
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
						blockers: dirtyRepos.length > 0 ? [`Clean worktrees required: ${dirtyRepos.join(', ')}`] : [],
						plannedSteps: [
							{ id: 'switch-root', description: `Switch market repo to ${branchName}` },
							...packageReports.map((report) => ({ id: `switch-${report.name}`, description: `Mirror ${branchName} into ${report.name}` })),
							{ id: 'workspace-link', description: 'Apply local workspace links for integrated development' },
							...(preview ? [{ id: 'preview', description: `Provision or refresh preview for ${branchName}` }] : []),
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'switch', reason: 'Run without --plan to create or resume the task branch.', input: { branch: branchName, preview } },
						]),
					},
				);
			}

			if (mode === 'recursive-workspace') {
				assertWorkspaceClean(root);
				assertSessionBranchSafety('switch', session);
			} else {
				assertCleanWorktree(root);
			}
			const workflowRun = acquireWorkflowRun(
				'switch',
				session,
				{ branch: branchName, preview, worktreeMode: input.worktreeMode ?? 'auto' },
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
					checkoutTaskBranchFromStaging(repoDir, branchName, {
						createIfMissing: input.createIfMissing !== false,
						pushIfCreated: true,
					}),
				);
				rootRepo.branch = currentBranch(repoDir) || branchName;
				rootRepo.created = rootSwitch.created;
				rootRepo.resumed = rootSwitch.resumed;
				rootRepo.commitSha = headCommit(repoDir);
				rootRepo.pushed = rootSwitch.created;

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					const packageSwitch = await executeJournalStep(root, workflowRun.runId, `switch-${report.name}`, () =>
						checkoutTaskBranchFromStaging(pkg.dir, branchName, {
							createIfMissing: input.createIfMissing !== false,
							pushIfCreated: false,
						}),
					);
					report.branch = currentBranch(pkg.dir) || branchName;
					report.created = packageSwitch.created;
					report.resumed = packageSwitch.resumed;
					report.commitSha = headCommit(pkg.dir);
					report.dirty = hasMeaningfulChanges(pkg.dir);
				}

				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, input.workspaceLinks ?? 'auto'));
				const stateAfterSwitch = resolveTreeseedWorkflowState(root);
				if (preview) {
					previewResult = await executeJournalStep(root, workflowRun.runId, 'preview', () =>
						deployBranchPreview(root, branchName, helpers.context, { initialize: !stateAfterSwitch.preview.enabled }),
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
						cleanWorktreeRequired: true,
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
			const planAutoResumeRun = executionMode === 'plan'
				? findAutoResumableSaveRun(root, branch)
				: null;
			const effectiveInput = autoResumeRun
				? (autoResumeRun.input as unknown as TreeseedSaveInput)
				: input;
			const message = String(effectiveInput.message ?? '').trim();
			const optionsHotfix = effectiveInput.hotfix === true;
			const previewInitialized = branchPreviewInitialized(root, branch);

			applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope, override: true });

			if (!branch) {
				workflowError('save', 'validation_failed', 'Treeseed save requires an active git branch.');
			}
			if (branch === PRODUCTION_BRANCH && !optionsHotfix) {
				workflowError('save', 'unsupported_state', 'Treeseed save is blocked on main unless --hotfix is explicitly set.');
			}

			const packageReports = createWorkspacePackageReports(root);
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
					devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-tag',
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
						ciMode: normalizeSaveCiMode(effectiveInput.ciMode, branch),
						verifyMode: effectiveInput.verifyMode ?? 'fast',
						applicationSelection,
						...worktreePayload(root, effectiveInput.worktreeMode),
						repositoryPlan,
						waves: repositoryPlan.waves,
						plannedVersions: repositoryPlan.plannedVersions,
						plannedSteps: [
							{ id: 'workspace-unlink', description: 'Remove local workspace links before deployment install and lockfile updates' },
							...repositoryPlan.plannedSteps,
							{ id: 'lockfile-validation', description: 'Validate refreshed package-lock.json files before any save commit is pushed' },
							...(shouldUseHostedSaveCi(effectiveInput, branch)
								? [{ id: 'hosted-ci', description: `Wait for hosted save workflows on ${branch}` }]
								: []),
							...(branch === STAGING_BRANCH
								? [{ id: 'release-candidate', description: 'Run release-candidate readiness checks for the saved staging state' }]
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
					devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-tag',
					gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin',
					gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl',
						verifyMode: effectiveInput.verifyMode ?? (effectiveInput.verify === false ? 'skip' : 'fast'),
					ciMode: effectiveInput.ciMode ?? (branch === STAGING_BRANCH ? 'hosted' : 'auto'),
					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
					commitMessageMode: effectiveInput.commitMessageMode ?? 'auto',
					workspaceLinks: effectiveInput.workspaceLinks ?? 'auto',
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
					...(shouldUseHostedSaveCi(effectiveInput, branch)
						? [{
							id: 'hosted-ci',
							description: `Wait for hosted save workflows on ${branch}`,
							repoName: rootRepo.name,
							repoPath: rootRepo.path,
							branch,
							resumable: true,
						}]
						: []),
					...(branch === STAGING_BRANCH
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
								devDependencyReferenceMode: effectiveInput.devDependencyReferenceMode ?? 'git-tag',
								gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin',
								gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl',
								verifyMode: normalizeSaveVerifyMode(effectiveInput.verify === false ? 'skip' : effectiveInput.verifyMode),
								commitMessageMode: (effectiveInput.commitMessageMode ?? 'auto') as SaveCommitMessageMode,
								workflowRunId: workflowRun.runId,
								onProgress: (line, stream) => helpers.write(line, stream),
								onWaveSaved: branch === STAGING_BRANCH && shouldUseHostedSaveCi(effectiveInput, branch)
									? async ({ nodes, reports, rootRepo: waveRootRepo }) => {
										const packageReportsForWave = reports.filter((repo, index) => nodes[index]?.kind === 'package');
										const rootReportForWave = nodes.some((node) => node.kind === 'project')
											? waveRootRepo
											: null;
										const gates = [
											...gatesForSavedPackageReports(packageReportsForWave),
											...(rootReportForWave ? gateForSavedRootReport(rootReportForWave, branch, scope) : []),
										];
										if (gates.length === 0) {
											return [];
										}
										const packageNames = packageReportsForWave.map((repo) => repo.name).join(', ');
										if (packageNames) {
											helpers.write(`[save][workflow] Waiting for hosted package gates before saving dependents: ${packageNames}.`);
										} else if (rootReportForWave) {
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
				const head = savedRootRepo.commitSha ?? run('git', ['rev-parse', 'HEAD'], { cwd: gitRoot, capture: true }).trim();
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
				const saveWorkflowGates = shouldUseHostedSaveCi(effectiveInput, branch)
					? await executeJournalStep(root, workflowRun.runId, 'hosted-ci', async () =>
						{
							if (branch === STAGING_BRANCH) {
								const workflowGates = saveResult?.workflowGates ?? [];
								if (effectiveInput.verifyDeployedResources !== true || scope === 'local' || !savedRootRepo.commitSha) {
									return { workflowGates };
								}
								helpers.write('[save][workflow] Dispatching hosted market deploy gate for deployed resource verification.');
								const repository = resolveGitHubRepositorySlug(savedRootRepo.path);
								await dispatchGitHubWorkflowRun(repository, {
									workflow: 'deploy.yml',
									branch,
									inputs: {
										environment: 'staging',
										action_kind: 'deploy_web',
									},
								});
								await sleep(5000);
								helpers.write('[save][workflow] Waiting for hosted market deploy gate.');
								const dispatchedGates = await waitForWorkflowGates('save', [
									hostedDeployGate({
										name: savedRootRepo.name,
										repoPath: savedRootRepo.path,
										repository,
										workflow: 'deploy.yml',
										branch,
										headSha: savedRootRepo.commitSha,
									}),
								], 'hosted', {
									root,
									runId: workflowRun.runId,
									onProgress: (line, stream) => helpers.write(line, stream),
								});
								return {
									workflowGates: [
										...workflowGates.filter((gate) => !(gate.repository === repository && gate.workflow === 'deploy.yml')),
										...dispatchedGates,
									],
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
								.map((repo) => ({
									name: repo.name,
									repoPath: repo.path,
									workflow: 'verify.yml',
									branch: String(repo.branch),
									headSha: String(repo.commitSha),
								})),
						], 'hosted', {
							root,
							runId: workflowRun.runId,
							onProgress: (line, stream) => helpers.write(line, stream),
						}).then((workflowGates) => ({ workflowGates }));
						})
					: { workflowGates: [] };
				const releaseCandidate = branch === STAGING_BRANCH
					? await executeJournalStep(root, workflowRun.runId, 'release-candidate', () => {
						helpers.write('[save][workflow] Running staging release-candidate readiness checks.');
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
						return runReleaseCandidateForPlan('save', root, stagingReleasePlan);
					})
					: null;

				let previewAction: Record<string, unknown> = { status: 'skipped' };
				if (beforeState.branchRole === 'feature' && branch) {
					if (effectiveInput.preview === true) {
						previewAction = {
							status: previewInitialized ? 'refreshed' : 'created',
							details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
								deployBranchPreview(root, branch, helpers.context, { initialize: !previewInitialized })),
						};
					} else if (effectiveInput.refreshPreview !== false && previewInitialized) {
						previewAction = {
							status: 'refreshed',
							details: await executeJournalStep(root, workflowRun.runId, 'preview', () =>
								deployBranchPreview(root, branch, helpers.context, { initialize: false })),
						};
					}
				}
				const applicationSelection = selectWorkflowApplications(root, {
					packageSelection: {
						selected: savedPackageReports.map((report) => report.name),
					},
				});
				const hostingAudit = await runWorkflowHostedResourceVerification(
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
					ciMode: normalizeSaveCiMode(effectiveInput.ciMode, branch),
					verifyMode: effectiveInput.verifyMode ?? 'fast',
					applicationSelection,
					workflowGates: saveWorkflowGates?.workflowGates ?? [],
					releaseCandidate,
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
			const planAutoResumeRun = executionMode === 'plan'
				? findAutoResumableTaskRun(root, 'close', session.branchName)
				: null;
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
						autoSaveRequired: session.rootRepo.dirty || session.packageRepos.some((repo) => repo.dirty),
						repos: createWorkspacePackageReports(root),
						rootRepo: createWorkspaceRootRepoReport(root),
						blockers,
						plannedSteps: [
							{ id: 'workspace-unlink', description: 'Remove local workspace links before task cleanup' },
							{ id: 'preview-cleanup', description: `Destroy preview resources for ${branchName ?? '(current task)'}` },
							{ id: 'cleanup-root', description: `Archive and delete ${branchName ?? '(current task)'} in market` },
							...checkedOutWorkspacePackageRepos(root).map((pkg) => ({
								id: `cleanup-${pkg.name}`,
								description: `Archive and delete ${branchName ?? '(current task)'} in ${pkg.name}`,
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
			assertSessionBranchSafety('close', activeSession);
			if (mode === 'recursive-workspace') {
				assertWorkspaceClean(root);
			} else {
				assertCleanWorktree(root);
			}

			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
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
					: await executeJournalStep(root, workflowRun.runId, 'preview-cleanup', () => destroyPreviewIfPresent(root, featureBranch));
				const rootCleanup = await executeJournalStep(root, workflowRun.runId, 'cleanup-root', () => {
					const deprecatedTag = createDeprecatedTaskTag(repoDir, featureBranch, `close: ${message}`);
					const deletedRemote = effectiveInput.deleteBranch === false ? false : deleteRemoteBranch(repoDir, featureBranch);
					syncBranchWithOrigin(repoDir, STAGING_BRANCH);
					if (effectiveInput.deleteBranch !== false) {
						deleteLocalBranch(repoDir, featureBranch);
					}
					return {
						deprecatedTag,
						deletedRemote,
						deletedLocal: effectiveInput.deleteBranch !== false,
						branch: currentBranch(repoDir) || STAGING_BRANCH,
						dirty: hasMeaningfulChanges(repoDir),
					};
				});
				rootRepo.tagName = String(rootCleanup?.deprecatedTag?.tagName ?? null);
				rootRepo.commitSha = String(rootCleanup?.deprecatedTag?.head ?? rootRepo.commitSha ?? '');
				rootRepo.deletedRemote = rootCleanup?.deletedRemote === true;
				rootRepo.deletedLocal = rootCleanup?.deletedLocal === true;
				rootRepo.branch = typeof rootCleanup?.branch === 'string' ? rootCleanup.branch : (currentBranch(repoDir) || STAGING_BRANCH);
				rootRepo.dirty = rootCleanup?.dirty === true;

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
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
				const finalBranch = currentBranch(repoDir) || STAGING_BRANCH;
				const managedWorktree = managedWorkflowWorktreeMetadata(root);
				const worktreeCleanup = isManagedWorkflowWorktree(root)
					? await executeJournalStep(root, workflowRun.runId, 'worktree-cleanup', () => removeManagedWorkflowWorktree(root))
					: { removed: false, reason: 'not-managed' };

				const payload = {
					mode,
					branchName: featureBranch,
					message,
					autoSaved: autoSave.performed,
					autoSaveResult: autoSave.save,
					deprecatedTag: rootCleanup?.deprecatedTag ?? null,
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

export async function workflowStage(helpers: WorkflowOperationHelpers, input: TreeseedStageInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('stage', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const executionMode = normalizeExecutionMode(input);
			const initialSession = resolveTreeseedWorkflowSession(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId ?? null;
			const autoResumeRun = executionMode === 'execute' && !explicitResumeRunId
				? findAutoResumableTaskRun(root, 'stage', initialSession.branchName)
				: null;
			const planAutoResumeRun = executionMode === 'plan'
				? findAutoResumableTaskRun(root, 'stage', initialSession.branchName)
				: null;
			const effectiveInput = autoResumeRun
				? (autoResumeRun.input as unknown as TreeseedStageInput)
				: input;
			const message = ensureMessage('stage', effectiveInput.message, 'a resolution message');
			const ciMode = normalizeCiMode(effectiveInput.ciMode, 'stage');
			const waitForStaging = effectiveInput.verifyDeployedResources === true || effectiveInput.waitForStaging !== false;
				if (executionMode === 'plan') {
					const blockers: string[] = [];
					if (initialSession.branchRole !== 'feature') {
						blockers.push('Stage only applies to task branches.');
					}
					try {
						validateStagingWorkflowContracts(root);
					} catch (error) {
					blockers.push(error instanceof Error ? error.message : String(error));
				}
				const applicationSelection = selectWorkflowApplications(root, { packageSelection: initialSession.packageSelection });
				const readiness = collectTreeseedDeploymentReadiness({
					tenantRoot: root,
					environment: 'staging',
					appId: singleSelectedWorkflowAppId(applicationSelection),
				});
				blockers.push(...readiness.checks
					.filter((check) => check.status === 'failed')
					.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`));
				return buildWorkflowResult(
					'stage',
					root,
					{
						mode: initialSession.mode,
						branchName: initialSession.branchName,
						mergeTarget: STAGING_BRANCH,
						mergeStrategy: 'squash',
						message,
						ciMode,
						applicationSelection,
						autoResumeCandidate: planAutoResumeRun
							? {
								runId: planAutoResumeRun.runId,
								branch: planAutoResumeRun.session.branchName,
								failure: planAutoResumeRun.failure,
							}
							: null,
						...worktreePayload(root, effectiveInput.worktreeMode),
						autoSaveRequired: initialSession.rootRepo.dirty || initialSession.packageRepos.some((repo) => repo.dirty),
						blockers,
						readiness,
						rootRepo: createWorkspaceRootRepoReport(root),
						repos: createWorkspacePackageReports(root),
						plannedSteps: [
							...checkedOutWorkspacePackageRepos(root).map((pkg) => ({
								id: `merge-${pkg.name}`,
								description: `Squash-merge ${initialSession.branchName ?? '(current task)'} into ${pkg.name} staging`,
							})),
							{ id: 'workspace-unlink', description: 'Remove local workspace links before staging promotion' },
							{ id: 'merge-root', description: `Squash-merge ${initialSession.branchName ?? '(current task)'} into market staging` },
							{ id: 'lockfile-validation', description: 'Refresh and validate the merged root workspace lockfile before pushing staging' },
							{ id: 'wait-staging', description: 'Wait for exact-SHA staging GitHub Actions gates' },
							{ id: 'release-candidate', description: 'Run release-candidate readiness checks for the exact staging state' },
							{ id: 'preview-cleanup', description: 'Destroy preview resources' },
							{ id: 'cleanup-root', description: 'Archive and delete the task branch from market' },
							...checkedOutWorkspacePackageRepos(root).map((pkg) => ({
								id: `cleanup-${pkg.name}`,
								description: `Archive and delete the task branch from ${pkg.name}`,
							})),
							{ id: 'workspace-link', description: 'Restore local workspace links on staging' },
						],
					},
					{
						executionMode,
						nextSteps: createNextSteps([
							{ operation: 'stage', reason: 'Run without --plan to promote the task branch into staging.', input: { message } },
						]),
					},
				);
			}
				const autoSave = await maybeAutoSaveCurrentTaskBranch(helpers, 'stage', {
					message,
					autoSave: effectiveInput.autoSave,
				});
				const session = resolveTreeseedWorkflowSession(root);
			const featureBranch = assertFeatureBranch(root);
			const mode = session.mode;
			assertSessionBranchSafety('stage', session);
				if (mode === 'recursive-workspace') {
					assertWorkspaceClean(root);
				} else {
					assertCleanWorktree(root);
				}
				ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope: 'staging', override: true });
				validateStagingWorkflowContracts(root);
				runWorkspaceSavePreflight({ cwd: root });
				const stagingReadiness = collectTreeseedDeploymentReadiness({ tenantRoot: root, environment: 'staging' });
				if (!stagingReadiness.ok) {
					workflowError(
						'stage',
						'validation_failed',
						`Deployment readiness failed for staging:\n${stagingReadiness.checks
							.filter((check) => check.status === 'failed')
							.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`)
							.join('\n')}`,
						{ details: { readiness: stagingReadiness } },
					);
				}
			const repoDir = session.gitRoot;
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			const workflowRun = acquireWorkflowRun(
				'stage',
				session,
				{
					message,
					waitForStaging,
					deletePreview: effectiveInput.deletePreview !== false,
					deleteBranch: effectiveInput.deleteBranch !== false,
					ciMode,
					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
					verifyDeployedResources: effectiveInput.verifyDeployedResources === true,
				},
				[
					{ id: 'workspace-unlink', description: 'Remove local workspace links', repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					...packageReports.map((report) => ({
						id: `merge-${report.name}`,
						description: `Merge ${featureBranch} into ${report.name} staging`,
						repoName: report.name,
						repoPath: report.path,
						branch: featureBranch,
						resumable: true,
					})),
					{ id: 'merge-root', description: `Merge ${featureBranch} into market staging`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'wait-staging', description: 'Wait for exact-SHA staging GitHub Actions gates', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'release-candidate', description: 'Run release-candidate readiness checks', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'preview-cleanup', description: 'Destroy preview resources', repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
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
				helpers.write(`[workflow][resume] Resuming interrupted stage ${autoResumeRun.runId} on ${featureBranch}.`);
			}

			try {
					await executeJournalStep(root, workflowRun.runId, 'workspace-unlink', () =>
						unlinkWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'), { rerunCompleted: true });
				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					if (!ensureLocalTaskBranch(pkg.dir, featureBranch)) {
						report.skippedReason = 'branch-missing';
						skipJournalStep(root, workflowRun.runId, `merge-${report.name}`, { skippedReason: 'branch-missing' });
						continue;
					}
					try {
						const mergeResult = await executeJournalStep(root, workflowRun.runId, `merge-${report.name}`, () =>
							squashMergeBranchIntoStaging(pkg.dir, featureBranch, message, { pushTarget: true }));
						report.merged = mergeResult.committed;
						report.committed = mergeResult.committed;
						report.pushed = mergeResult.pushed;
						report.commitSha = mergeResult.commitSha;
						report.branch = STAGING_BRANCH;
						checkoutBranch(pkg.dir, featureBranch);
						report.branch = featureBranch;
					} catch (error) {
						const reportData = collectMergeConflictReport(pkg.dir);
						throw new TreeseedWorkflowError('stage', 'merge_conflict', formatMergeConflictReport(reportData, pkg.dir, STAGING_BRANCH), {
							details: { branch: featureBranch, packageName: pkg.name, report: reportData, originalError: error instanceof Error ? error.message : String(error) },
							exitCode: 12,
						});
					}
				}

					let rootMerge: Record<string, unknown> | null = null;
					try {
						rootMerge = await executeJournalStep(root, workflowRun.runId, 'merge-root', async () => {
							assertCleanWorktree(root);
							if (isManagedWorkflowWorktree(root)) {
								checkoutDetachedOriginBranch(repoDir, STAGING_BRANCH);
							} else {
								syncBranchWithOrigin(repoDir, STAGING_BRANCH);
							}
							run('git', ['merge', '--squash', featureBranch], { cwd: repoDir });
							if (mode === 'recursive-workspace') {
								syncAllCheckedOutPackageRepos(root, STAGING_BRANCH);
						}
						const lockfileSafety = await refreshAndValidateRootWorkspaceLockfileForSave({
							root,
							gitRoot: repoDir,
							branch: STAGING_BRANCH,
							onProgress: (line, stream) => helpers.write(line, stream),
						});
						if (hasStagedChanges(repoDir) || hasMeaningfulChanges(repoDir)) {
								run('git', ['add', '-A'], { cwd: repoDir });
								run('git', ['commit', '-m', message], { cwd: repoDir });
							}
							if (isManagedWorkflowWorktree(root)) {
								pushHeadToBranch(repoDir, STAGING_BRANCH);
							} else {
								pushBranch(repoDir, STAGING_BRANCH);
							}
							return {
								commitSha: headCommit(repoDir),
								branch: STAGING_BRANCH,
								committed: hasMeaningfulChanges(repoDir) ? false : true,
								lockfileValidation: lockfileSafety.lockfileValidation,
							lockfileInstall: lockfileSafety.install,
						};
					});
					rootRepo.merged = true;
					rootRepo.committed = true;
					rootRepo.commitSha = String(rootMerge?.commitSha ?? headCommit(repoDir));
					rootRepo.pushed = true;
					rootRepo.branch = typeof rootMerge?.branch === 'string' ? rootMerge.branch : (currentBranch(repoDir) || STAGING_BRANCH);
				} catch (error) {
					const report = collectMergeConflictReport(repoDir);
					throw new TreeseedWorkflowError('stage', 'merge_conflict', formatMergeConflictReport(report, repoDir, STAGING_BRANCH), {
						details: { branch: featureBranch, report, originalError: error instanceof Error ? error.message : String(error) },
						exitCode: 12,
					});
				}

				const stageWorkflowGateResult = !waitForStaging
					? (skipJournalStep(root, workflowRun.runId, 'wait-staging', { status: 'skipped', reason: 'disabled' }), { status: 'skipped', reason: 'disabled' })
					: await executeJournalStep(root, workflowRun.runId, 'wait-staging', () =>
							waitForWorkflowGates('stage', [
								hostedDeployGate({
									name: rootRepo.name,
									repoPath: rootRepo.path,
									workflow: 'deploy.yml',
									branch: STAGING_BRANCH,
									headSha: rootRepo.commitSha,
								}),
							...packageReports
								.filter((report) => report.merged && report.commitSha)
								.map((report) => ({
									name: report.name,
									repoPath: report.path,
									workflow: 'verify.yml',
									branch: STAGING_BRANCH,
									headSha: String(report.commitSha),
								})),
						], ciMode, {
							root,
							runId: workflowRun.runId,
							onProgress: (line, stream) => helpers.write(line, stream),
						}).then((workflowGates) => ({
							status: 'completed',
							workflowGates,
						})));
				const stagingWait = {
					status: String(stageWorkflowGateResult?.status ?? 'completed'),
					workflowGates: Array.isArray(stageWorkflowGateResult?.workflowGates) ? stageWorkflowGateResult.workflowGates : [],
				};
				const stageReleasePlan = buildReleasePlanSnapshot({
					root,
					mode,
					level: 'patch',
					packageSelection: session.packageSelection,
					packageReports,
					rootRepo,
					blockers: [],
				});
				const releaseCandidate = await executeJournalStep(root, workflowRun.runId, 'release-candidate', () =>
					runReleaseCandidateForPlan('stage', root, stageReleasePlan));
				const applicationSelection = selectWorkflowApplications(root, { packageSelection: session.packageSelection });
				const hostingAudit = await runWorkflowHostedResourceVerification(
					'stage',
					root,
					helpers,
					'staging',
					{
						enabled: effectiveInput.verifyDeployedResources === true,
						strict: true,
						live: effectiveInput.verifyDeployedResources === true,
						appId: singleSelectedWorkflowAppId(applicationSelection),
					},
				);
				const previewCleanup = effectiveInput.deletePreview === false
					? (skipJournalStep(root, workflowRun.runId, 'preview-cleanup', { performed: false }), { performed: false })
					: await executeJournalStep(root, workflowRun.runId, 'preview-cleanup', () => destroyPreviewIfPresent(root, featureBranch));
				const rootCleanup = await executeJournalStep(root, workflowRun.runId, 'cleanup-root', () => {
					const deprecatedTag = createDeprecatedTaskTag(repoDir, featureBranch, `stage: ${message}`);
					const deletedRemote = effectiveInput.deleteBranch === false ? false : deleteRemoteBranch(repoDir, featureBranch);
					if (effectiveInput.deleteBranch !== false) {
						deleteLocalBranch(repoDir, featureBranch);
					}
					return {
						deprecatedTag,
						deletedRemote,
						deletedLocal: effectiveInput.deleteBranch !== false,
						branch: currentBranch(repoDir) || STAGING_BRANCH,
					};
				});
				rootRepo.tagName = String(rootCleanup?.deprecatedTag?.tagName ?? rootRepo.tagName ?? '');
				rootRepo.commitSha = String(rootCleanup?.deprecatedTag?.head ?? rootRepo.commitSha ?? '');
				rootRepo.deletedRemote = rootCleanup?.deletedRemote === true;
				rootRepo.deletedLocal = rootCleanup?.deletedLocal === true;
				rootRepo.branch = typeof rootCleanup?.branch === 'string' ? rootCleanup.branch : (currentBranch(repoDir) || STAGING_BRANCH);

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report) {
						continue;
					}
					const cleanup = await executeJournalStep(root, workflowRun.runId, `cleanup-${report.name}`, () =>
						cleanupTaskBranchReport(report, featureBranch, `stage: ${message}`, {
							deleteBranch: effectiveInput.deleteBranch !== false,
							targetBranch: STAGING_BRANCH,
						}));
					Object.assign(report, cleanup);
				}
				const workspaceLinks = await executeJournalStep(root, workflowRun.runId, 'workspace-link', () =>
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'));
				const finalBranch = currentBranch(repoDir) || STAGING_BRANCH;
				const managedWorktree = managedWorkflowWorktreeMetadata(root);
				const worktreeCleanup = isManagedWorkflowWorktree(root)
					? await executeJournalStep(root, workflowRun.runId, 'worktree-cleanup', () => removeManagedWorkflowWorktree(root))
					: { removed: false, reason: 'not-managed' };

				const payload = {
					mode,
					branchName: featureBranch,
					mergeTarget: STAGING_BRANCH,
					mergeStrategy: 'squash',
					message,
					autoSaved: autoSave.performed,
					autoSaveResult: autoSave.save,
					deprecatedTag: rootCleanup?.deprecatedTag ?? null,
					repos: packageReports,
					rootRepo,
					stagingWait,
					releaseCandidate,
					applicationSelection,
					previewCleanup,
					lockfileValidation: rootMerge?.lockfileValidation ?? null,
					lockfileInstall: rootMerge?.lockfileInstall ?? null,
					remoteDeleted: rootRepo.deletedRemote,
					localDeleted: rootRepo.deletedLocal,
					finalBranch,
					workspaceLinks,
					ciMode,
					workflowGates: stagingWait.workflowGates,
					hostingAudit,
					worktreeCleanup,
					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
					managedWorktree,
					worktreePath: managedWorktree?.worktreePath ?? null,
					primaryRoot: managedWorktree?.primaryRoot ?? null,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'stage',
					root,
					payload,
					{
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'release', reason: 'Promote the updated staging branch into production when ready.', input: { bump: 'patch' } },
							{ operation: 'status', reason: 'Inspect staging readiness after the task branch merge.' },
						]),
					},
				);
			} catch (error) {
				ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
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

export async function workflowTagsCleanup(helpers: WorkflowOperationHelpers, input: TreeseedTagsCleanupInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('tags:cleanup', helpers.cwd());
			const executionMode: TreeseedWorkflowExecutionMode = input.plan === true || input.dryRun === true ? 'plan' : 'execute';
			const cleanup = collectStaleDevTagCleanupReports(root, input, { execute: executionMode === 'execute' });
			return buildWorkflowResult('tags:cleanup', root, {
				...cleanup,
				mode: hasCompleteTreeseedPackageCheckout(root) ? 'recursive-workspace' : 'root-only',
			}, {
				executionMode,
				summary: executionMode === 'plan' ? 'Treeseed dev tag cleanup plan ready.' : 'Treeseed dev tag cleanup completed.',
				nextSteps: executionMode === 'plan'
					? createNextSteps([{ operation: 'tags:cleanup', reason: 'Run without --plan to delete the stale Treeseed-managed dev tags.', input: { branchScope: cleanup.branchScope } }])
					: createNextSteps([{ operation: 'status', reason: 'Inspect workspace state after tag cleanup.' }]),
			});
		});
	} catch (error) {
		toError('tags:cleanup', error);
	}
}

export async function workflowRelease(helpers: WorkflowOperationHelpers, input: TreeseedReleaseInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('release', helpers.cwd());
			reattachRepairablePackageRepos(root, [STAGING_BRANCH, PRODUCTION_BRANCH], {
				operation: 'release',
				onProgress: (line, stream) => helpers.write(line, stream),
				throwOnBlocker: true,
			});
			const session = resolveTreeseedWorkflowSession(root);
			const gitRoot = session.gitRoot;
			const mode = session.mode;
			const executionMode = normalizeExecutionMode(input);
			const rootRepo = createWorkspaceRootRepoReport(root);
			const packageReports = createWorkspacePackageReports(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId ?? null;
			const freshRelease = input.fresh === true && !explicitResumeRunId;
			const freshPreparation = freshRelease && executionMode === 'execute'
				? prepareFreshReleaseRun(root, session.branchName, rootRepo, packageReports)
				: { archived: [], blockers: [] };
			const autoResumeRun = executionMode === 'execute' && !explicitResumeRunId && !freshRelease
				? findAutoResumableReleaseRun(root, session.branchName, rootRepo, packageReports, { archiveStale: true })
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
			const level = effectiveInput.bump ?? 'patch';
			const ciMode = normalizeCiMode(effectiveInput.ciMode, 'release');
			const isResume = Boolean(explicitResumeRunId || autoResumeRun);
			const packageSelection = session.packageSelection;
			const plannedRelease = buildReleasePlanSnapshot({
				root,
				mode,
				level,
				repairVersionLine: effectiveInput.repairVersionLine === true,
				targetVersionLine: effectiveInput.targetVersionLine,
				packageSelection,
				packageReports,
				rootRepo,
				blockers: [],
			});
			const plannedPackageSelection = releasePlanPackageSelection(plannedRelease.packageSelection);
			const selectedPackageNames = new Set(plannedPackageSelection.selected);
			const blockers = isResume
				? []
				: collectReleasePlanBlockers(session, mode, plannedPackageSelection.selected, {
					level,
					repairVersionLine: effectiveInput.repairVersionLine === true,
				});
			const plannedReadiness = collectTreeseedDeploymentReadiness({
				tenantRoot: root,
				environment: 'prod',
				appId: singleSelectedWorkflowAppId(plannedRelease.applicationSelection),
			});
			if (!isResume) {
				blockers.push(...plannedReadiness.checks
					.filter((check) => check.status === 'failed')
					.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`));
			}
			plannedRelease.blockers = blockers;

			if (executionMode === 'plan') {
				return buildWorkflowResult('release', root, {
					...plannedRelease,
					readiness: plannedReadiness,
					ciMode,
					fresh: input.fresh === true,
					freshArchivedRuns: [],
					...worktreePayload(root, effectiveInput.worktreeMode),
					autoResumeCandidate: planAutoResumeRun
						? {
							runId: planAutoResumeRun.runId,
							branch: planAutoResumeRun.session.branchName,
							failure: planAutoResumeRun.failure,
						}
						: null,
				}, {
					executionMode,
					nextSteps: createNextSteps([
						{ operation: 'release', reason: planAutoResumeRun ? `Run without --plan to resume ${planAutoResumeRun.runId}.` : 'Run without --plan to promote staging into production.', input: { bump: level } },
					]),
				});
			}

			if (blockers.length > 0) {
				workflowError('release', 'validation_failed', blockers.join('\n'), {
					details: { blockers },
				});
			}

			const workflowRun = acquireWorkflowRun(
				'release',
				session,
				{
					bump: level,
					repairVersionLine: effectiveInput.repairVersionLine === true,
					targetVersionLine: effectiveInput.targetVersionLine,
					devTagCleanup: effectiveInput.devTagCleanup ?? 'safe-after-release',
					gitDependencyProtocol: effectiveInput.gitDependencyProtocol ?? 'preserve-origin',
					gitRemoteWriteMode: effectiveInput.gitRemoteWriteMode ?? 'ssh-pushurl',
					ciMode,
					fresh: input.fresh === true,
					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
					workspaceLinks: effectiveInput.workspaceLinks ?? 'auto',
				},
				[
					{ id: 'release-plan', description: 'Record release plan', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'release-staging-gates', description: 'Verify current staging GitHub Actions gates', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'release-candidate', description: 'Run release-candidate readiness checks', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'workspace-unlink', description: 'Remove local workspace links before release', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					...(mode === 'recursive-workspace'
						? [{ id: 'prepare-release-metadata', description: 'Rewrite stable release metadata', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true }]
						: []),
					...packageReports.filter((report) => selectedPackageNames.has(report.name)).map((report) => ({
						id: `release-${report.name}`,
						description: `Release ${report.name}`,
						repoName: report.name,
						repoPath: report.path,
						branch: STAGING_BRANCH,
						resumable: true,
					})),
					{ id: 'release-root', description: 'Release market repo', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					{ id: 'release-root-gates', description: 'Wait for market release GitHub Actions gates', repoName: rootRepo.name, repoPath: rootRepo.path, branch: PRODUCTION_BRANCH, resumable: true },
					{ id: 'release-back-merge', description: 'Back-merge main into staging', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					...(mode === 'recursive-workspace'
						? [{ id: 'cleanup-dev-tags', description: 'Clean replaced dev package tags', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true }]
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
				helpers.write(`[workflow][resume] Resuming interrupted release ${autoResumeRun.runId} on ${STAGING_BRANCH}.`);
			}
			const resumeAtRootGates = workflowRun.resumed && shouldResumeReleaseAtRootGates(root, workflowRun.runId);
			if (resumeAtRootGates) {
				helpers.write(`[workflow][resume] Resuming release ${workflowRun.runId} directly at production deploy gates.`);
			}

			let releaseCleanupSnapshot: ReleaseCleanupSnapshot | null = null;
			try {
				const releasePlan = await executeJournalStep(root, workflowRun.runId, 'release-plan', () => plannedRelease) as typeof plannedRelease;
				const effectivePackageSelection = releasePlanPackageSelection(releasePlan.packageSelection);
				const effectiveSelectedPackageNames = new Set(effectivePackageSelection.selected);
				const effectiveVersions = releasePlanVersionMap(releasePlan.plannedVersions as Record<string, unknown>);
				const effectiveStableDependencyVersions = releasePlanStableDependencyVersionMap(releasePlan);
				const effectiveDependencyReplacementVersions = new Map([
					...effectiveStableDependencyVersions.entries(),
					...effectiveVersions.entries(),
				]);
				const rootVersion = String(releasePlan.rootVersion);

				applyTreeseedEnvironmentToProcess({ tenantRoot: root, scope: 'staging', override: true });
				assertReleaseGitHubAutomationReady(root, effectiveSelectedPackageNames, ciMode);
				const productionReadiness = collectTreeseedDeploymentReadiness({ tenantRoot: root, environment: 'prod' });
				if (!productionReadiness.ok) {
					workflowError(
						'release',
						'validation_failed',
						`Deployment readiness failed for prod:\n${productionReadiness.checks
							.filter((check) => check.status === 'failed')
							.map((check) => `${check.id}: ${check.message}${check.remediation ? ` Remediation: ${check.remediation}` : ''}`)
							.join('\n')}`,
						{ details: { readiness: productionReadiness } },
					);
				}
				const stagingGateResult = resumeAtRootGates
					? (completedJournalStepData(root, workflowRun.runId, 'release-staging-gates') as { workflowGates?: Array<Record<string, unknown>> } | null)
					: await executeJournalStep(root, workflowRun.runId, 'release-staging-gates', () => {
						helpers.write('[release][workflow] Verifying current staging gates before production release.');
						const packageGates = checkedOutWorkspacePackageRepos(root)
							.filter((pkg) => effectiveSelectedPackageNames.has(pkg.name))
							.map((pkg) => ({
								name: pkg.name,
								repoPath: pkg.dir,
								workflow: 'verify.yml',
								branch: STAGING_BRANCH,
								headSha: headCommit(pkg.dir),
							}));
							return waitForWorkflowGates('release', [
								hostedDeployGate({
									name: rootRepo.name,
									repoPath: rootRepo.path,
									workflow: 'deploy.yml',
									branch: STAGING_BRANCH,
									headSha: headCommit(gitRoot),
								}),
							...packageGates,
						], ciMode, {
							root,
							runId: workflowRun.runId,
							onProgress: (line, stream) => helpers.write(line, stream),
						}).then((workflowGates) => ({ workflowGates }));
					});
				const releaseCandidate = resumeAtRootGates
					? (completedJournalStepData(root, workflowRun.runId, 'release-candidate') as ReleaseCandidateReport | null)
					: await executeJournalStep(root, workflowRun.runId, 'release-candidate', () =>
						runReleaseCandidateForPlan('release', root, releasePlan, { allowReuse: true }));
					if (!resumeAtRootGates && !isResume) {
						assertSessionBranchSafety('release', session, { requireCleanPackages: true, requireCurrentBranch: true });
						assertCleanWorktree(root);
					}
					if (!resumeAtRootGates) {
						prepareReleaseBranches(root);
						ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
						runWorkspaceReleasePreflight({ cwd: root });
						await executeJournalStep(root, workflowRun.runId, 'workspace-unlink', () =>
							unlinkWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto'), { rerunCompleted: true });
					}

				if (mode === 'root-only') {
					const rootRelease = await executeJournalStep(root, workflowRun.runId, 'release-root', () => {
						setRootPackageJsonVersion(root, rootVersion);
						run('git', ['checkout', STAGING_BRANCH], { cwd: gitRoot });
						const rootCommitsBeforeChangelog = releaseHistoryCommits(gitRoot);
						const changelog = updateReleaseChangelog(gitRoot, {
							version: rootVersion,
							commits: rootCommitsBeforeChangelog,
							extraDependencyBullets: [`Release @treeseed/market ${rootVersion}.`],
						});
						commitAllIfChanged(gitRoot, releaseAdminMessage({
							subject: `release: ${level} bump`,
							version: rootVersion,
							tagName: rootVersion,
							commits: rootCommitsBeforeChangelog,
							changelog,
						}));
						pushBranch(gitRoot, STAGING_BRANCH);
						const stagingCommit = headCommit(gitRoot);
						const rootCommits = releaseHistoryCommits(gitRoot);
						const released = mergeBranchIntoTarget(root, {
							sourceBranch: STAGING_BRANCH,
							targetBranch: PRODUCTION_BRANCH,
							message: releaseAdminMessage({
								subject: `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`,
								version: rootVersion,
								tagName: rootVersion,
								commits: rootCommits,
								changelog,
							}),
							pushTarget: true,
						});
						const tag = ensureReleaseTag(gitRoot, rootVersion, released.commitSha, releaseAdminMessage({
							subject: `release: ${rootVersion}`,
							version: rootVersion,
							tagName: rootVersion,
							commits: rootCommits,
							changelog,
						}));
						syncBranchWithOrigin(gitRoot, STAGING_BRANCH);
						return {
							rootVersion,
							stagingCommit,
							releasedCommit: released.commitSha,
							tag,
							changelog,
							adminCommitSummary: {
								commitCount: rootCommits.length,
								notableCommits: rootCommits.slice(0, 12),
							},
						};
					});
					rootRepo.committed = true;
					rootRepo.pushed = true;
					rootRepo.merged = true;
					rootRepo.branch = PRODUCTION_BRANCH;
					rootRepo.commitSha = String(rootRelease?.releasedCommit ?? headCommit(gitRoot));
					rootRepo.tagName = String(rootRelease?.rootVersion ?? '');
					const rootWorkflowGateResult = await executeJournalStep(root, workflowRun.runId, 'release-root-gates', () =>
						waitForWorkflowGates('release', [
							hostedDeployGate({
								name: rootRepo.name,
								repoPath: rootRepo.path,
								workflow: 'deploy.yml',
								branch: rootVersion,
								headSha: String(rootRelease?.releasedCommit ?? rootRepo.commitSha ?? ''),
							}),
						].filter((gate) => gate.headSha), ciMode, {
							root,
							runId: workflowRun.runId,
							onProgress: (line, stream) => helpers.write(line, stream),
						}).then((workflowGates) => ({ workflowGates })));
					const hostedDeploymentState = recordHostedDeploymentStatesFromRootGates(root, rootRelease, rootWorkflowGateResult?.workflowGates);
					ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
					const applicationSelection = selectWorkflowApplications(root, { changedPaths: ['treeseed.site.yaml'] });
					const hostingAudit = await runWorkflowHostedResourceVerification('release', root, helpers, 'prod', {
						enabled: true,
						strict: effectiveInput.verifyDeployedResources === true,
						live: effectiveInput.verifyDeployedResources === true,
						appId: singleSelectedWorkflowAppId(applicationSelection),
					});
					const releaseBackMerge = await executeJournalStep(root, workflowRun.runId, 'release-back-merge', () =>
						backMergeRootProductionIntoStaging(root, false, {
							version: rootVersion,
							changelog: (rootRelease?.changelog as ReleaseHistorySummary | undefined) ?? null,
						}));
					const workspaceLinks = ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
					const payload = {
						mode,
						mergeStrategy: 'merge-commit',
						level,
						fresh: input.fresh === true,
						freshArchivedRuns: freshPreparation.archived,
						resumed: workflowRun.resumed,
						resumedRunId: workflowRun.resumed ? workflowRun.runId : null,
						autoResumed: autoResumeRun != null,
						rootVersion: String(rootRelease?.rootVersion ?? ''),
						releaseTag: String(rootRelease?.rootVersion ?? ''),
						releasedCommit: String(rootRelease?.releasedCommit ?? rootRepo.commitSha ?? ''),
						stagingBranch: STAGING_BRANCH,
						productionBranch: PRODUCTION_BRANCH,
						touchedPackages: [],
						packageSelection: { changed: [], dependents: [], selected: [] },
						applicationSelection,
						publishWait: [],
						repos: [],
						rootRepo,
						releaseCandidate,
						stagingWorkflowGates: stagingGateResult?.workflowGates ?? [],
						releaseBackMerge,
						hostedDeploymentState,
						finalBranch: currentBranch(gitRoot) || STAGING_BRANCH,
						pushStatus: { stagingPushed: true, productionPushed: true, tagPushed: true },
						workspaceLinks,
						ciMode,
						workflowGates: [
							...(Array.isArray(stagingGateResult?.workflowGates) ? stagingGateResult.workflowGates : []),
							...(Array.isArray(rootWorkflowGateResult?.workflowGates) ? rootWorkflowGateResult.workflowGates : []),
						],
						hostingAudit,
						...worktreePayload(root, effectiveInput.worktreeMode),
					};
					completeWorkflowRun(root, workflowRun.runId, payload);
					return buildWorkflowResult('release', root, payload, {
						runId: workflowRun.runId,
						nextSteps: createNextSteps([
							{ operation: 'status', reason: 'Inspect release readiness and production state after the promotion.' },
						]),
					});
				}

				if (!resumeAtRootGates) {
					validatePackageReleaseWorkflows(root, effectivePackageSelection.selected);
					for (const pkg of checkedOutWorkspacePackageRepos(root)) {
						if (effectiveSelectedPackageNames.has(pkg.name)) {
							prepareReleaseBranches(pkg.dir);
						}
					}
				}

				releaseCleanupSnapshot = resumeAtRootGates ? null : collectReleaseCleanupSnapshot(root, effectiveSelectedPackageNames);
				const metadata = await executeJournalStep(root, workflowRun.runId, 'prepare-release-metadata', () => {
					const releasedPackageDevTags = Object.fromEntries(
						checkedOutWorkspacePackageRepos(root)
							.filter((pkg) => effectiveSelectedPackageNames.has(pkg.name))
							.map((pkg) => {
								const packageJson = JSON.parse(readFileSync(resolve(pkg.dir, 'package.json'), 'utf8')) as Record<string, unknown>;
								return [pkg.name, String(packageJson.version ?? '')] as const;
							})
							.filter(([, version]) => version.includes('-dev.')),
					);
					const replacedDevReferences = rewriteProjectInternalDependenciesToStableVersions(root, effectiveDependencyReplacementVersions);
					applyStableWorkspaceVersionChanges(root, effectiveVersions);
					setRootPackageJsonVersion(root, rootVersion);
					const releaseInstalls: Array<Record<string, unknown>> = [
						{ name: '@treeseed/market', ...runReleaseNpmInstall(root, { workspaceRoot: root }) },
					];
					assertNoInternalDevReferencesForRepo(root, root, effectiveSelectedPackageNames);
					return {
						releasedPackageDevTags,
						replacedDevReferences,
						releaseInstalls,
					};
				}, { rerunCompleted: workflowRun.resumed && !resumeAtRootGates });
				const replacedDevReferences = Array.isArray(metadata?.replacedDevReferences) ? metadata.replacedDevReferences : [];
				const releaseInstalls = Array.isArray(metadata?.releaseInstalls) ? metadata.releaseInstalls : [];
				const releasedPackageDevTags = new Map(Object.entries((metadata?.releasedPackageDevTags ?? {}) as Record<string, unknown>).map(([name, version]) => [name, String(version)]));
				const publishWait: Array<Record<string, unknown>> = [];

				for (const pkg of checkedOutWorkspacePackageRepos(root)) {
					const report = findReportByName(packageReports, pkg.name);
					if (!report || !effectiveSelectedPackageNames.has(pkg.name)) {
						if (report) {
							report.skippedReason = 'unchanged';
						}
						continue;
					}
					const releasedPackage = await executeJournalStep(root, workflowRun.runId, `release-${report.name}`, async () => {
						checkoutBranch(pkg.dir, STAGING_BRANCH);
						const tagName = String(effectiveVersions.get(pkg.name));
						releaseInstalls.push({
							name: pkg.name,
							...runReleaseNpmInstall(pkg.dir, { workspaceRoot: root }),
						});
						assertNoInternalDevReferencesForRepo(root, pkg.dir, effectiveSelectedPackageNames);
						const packageCommitsBeforeChangelog = releaseHistoryCommits(pkg.dir);
						const changelog = updateReleaseChangelog(pkg.dir, {
							version: tagName,
							commits: packageCommitsBeforeChangelog,
							extraDependencyBullets: [`Release ${pkg.name} ${tagName}.`],
						});
						if (hasMeaningfulChanges(pkg.dir)) {
							run('git', ['add', '-A'], { cwd: pkg.dir });
							run('git', ['commit', '-m', releaseAdminMessage({
								subject: `release: ${tagName}`,
								version: tagName,
								tagName,
								commits: packageCommitsBeforeChangelog,
								changelog,
								extraLines: [`Package: ${pkg.name}`],
							})], { cwd: pkg.dir });
						}
						pushBranch(pkg.dir, STAGING_BRANCH);
						const packageCommits = releaseHistoryCommits(pkg.dir);
						const mergeResult = mergeBranchIntoTarget(pkg.dir, {
							sourceBranch: STAGING_BRANCH,
							targetBranch: PRODUCTION_BRANCH,
							message: releaseAdminMessage({
								subject: `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`,
								version: tagName,
								tagName,
								commits: packageCommits,
								changelog,
								extraLines: [`Package: ${pkg.name}`],
							}),
							pushTarget: true,
						});
						const tag = ensureReleaseTag(pkg.dir, tagName, mergeResult.commitSha, releaseAdminMessage({
							subject: `release: ${tagName}`,
							version: tagName,
							tagName,
							commits: packageCommits,
							changelog,
							extraLines: [`Package: ${pkg.name}`],
						}));
						const workflowGates = await waitForWorkflowGates('release', [
							{
								name: pkg.name,
								repoPath: pkg.dir,
								workflow: 'publish.yml',
								headSha: mergeResult.commitSha,
								branch: tagName,
							},
						], ciMode, {
							root,
							runId: workflowRun.runId,
							onProgress: (line, stream) => helpers.write(line, stream),
						});
						const publish = workflowGates.find((gate) => gate.workflow === 'publish.yml') ?? workflowGates[0] ?? null;
						assertReleaseGitHubWorkflowSucceeded(pkg.name, publish);
						const backMerge = backMergeProductionIntoStaging(pkg.dir, pkg.name, releaseAdminMessage({
							subject: `release: back-merge ${PRODUCTION_BRANCH} into ${STAGING_BRANCH}`,
							version: tagName,
							tagName,
							sourceRef: PRODUCTION_BRANCH,
							targetRef: STAGING_BRANCH,
							commits: packageCommits,
							changelog,
							extraLines: [`Package: ${pkg.name}`],
						}));
						syncBranchWithOrigin(pkg.dir, STAGING_BRANCH);
						return {
							commitSha: mergeResult.commitSha,
							tagName,
							tag,
							changelog,
							adminCommitSummary: {
								commitCount: packageCommits.length,
								notableCommits: packageCommits.slice(0, 12),
							},
							publish,
							workflowGates,
							backMerge,
						};
					});
					report.committed = true;
					report.pushed = true;
					report.merged = true;
					report.tagName = String(releasedPackage?.tagName ?? '');
					report.commitSha = String(releasedPackage?.commitSha ?? report.commitSha ?? '');
					report.publishWait = (releasedPackage?.publish as Record<string, unknown> | undefined) ?? null;
					report.workflowGates = Array.isArray(releasedPackage?.workflowGates) ? releasedPackage.workflowGates : [];
					report.backMerge = (releasedPackage?.backMerge as Record<string, unknown> | undefined) ?? null;
					report.changelog = (releasedPackage?.changelog as Record<string, unknown> | undefined) ?? null;
					report.adminCommitSummary = (releasedPackage?.adminCommitSummary as Record<string, unknown> | undefined) ?? null;
					report.branch = STAGING_BRANCH;
					publishWait.push({
						name: report.name,
						...(releasedPackage?.publish as Record<string, unknown> | undefined ?? {}),
					});
				}
				assertNoInternalDevReferences(root, effectiveSelectedPackageNames);

				const rootRelease = await executeJournalStep(root, workflowRun.runId, 'release-root', () => {
					setRootPackageJsonVersion(root, rootVersion);
					run('git', ['checkout', STAGING_BRANCH], { cwd: gitRoot });
					const rootCommitsBeforeChangelog = releaseHistoryCommits(gitRoot);
					const changelog = updateReleaseChangelog(gitRoot, {
						version: rootVersion,
						commits: rootCommitsBeforeChangelog,
						extraDependencyBullets: [
							`Release @treeseed/market ${rootVersion}.`,
							...versionLines(effectiveVersions).map((line) => `Release package ${line}.`),
						],
					});
					commitAllIfChanged(gitRoot, releaseAdminMessage({
						subject: `release: ${level} bump`,
						version: rootVersion,
						tagName: rootVersion,
						commits: rootCommitsBeforeChangelog,
						changelog,
						extraLines: versionLines(effectiveVersions).map((line) => `Package ${line}`),
					}));
					pushBranch(gitRoot, STAGING_BRANCH);
					const stagingCommit = headCommit(gitRoot);
					const rootCommits = releaseHistoryCommits(gitRoot);
					let released: { commitSha: string };
					let submoduleReconciliation: Record<string, unknown> | null = null;
					const mergeMessage = releaseAdminMessage({
						subject: `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`,
						version: rootVersion,
						tagName: rootVersion,
						commits: rootCommits,
						changelog,
						extraLines: versionLines(effectiveVersions).map((line) => `Package ${line}`),
					});
					try {
						released = mergeBranchIntoTarget(root, {
							sourceBranch: STAGING_BRANCH,
							targetBranch: PRODUCTION_BRANCH,
							message: mergeMessage,
							pushTarget: false,
							quietMerge: true,
						});
					} catch (error) {
						const reconciliation = resolveRootReleaseSubmoduleConflicts(root, effectiveSelectedPackageNames);
						if (!reconciliation.resolved) {
							throw error;
						}
						helpers.write(`[release][reconcile] Resolving generated package pointer reconciliation for ${reconciliation.entries.map((entry) => String(entry.path)).join(', ')}.`);
						submoduleReconciliation = reconciliation;
						commitAllIfChanged(gitRoot, mergeMessage);
						released = { commitSha: headCommit(gitRoot) };
					}
					for (const pkg of checkedOutWorkspacePackageRepos(root)) {
						if (effectiveSelectedPackageNames.has(pkg.name)) {
							syncBranchWithOrigin(pkg.dir, PRODUCTION_BRANCH);
						}
					}
					const mainPointerCommits = releaseHistoryCommits(gitRoot, released.commitSha, 'HEAD');
					commitAllIfChanged(gitRoot, releaseAdminMessage({
						subject: 'release: sync package main heads',
						version: rootVersion,
						tagName: rootVersion,
						sourceRef: 'package main heads',
						targetRef: PRODUCTION_BRANCH,
						commits: mainPointerCommits,
						changelog,
						extraLines: versionLines(effectiveVersions).map((line) => `Main package ${line}`),
					}));
					const releasedCommit = headCommit(gitRoot);
					const tag = ensureReleaseTag(gitRoot, rootVersion, releasedCommit, releaseAdminMessage({
						subject: `release: ${rootVersion}`,
						version: rootVersion,
						tagName: rootVersion,
						commits: rootCommits,
						changelog,
						extraLines: versionLines(effectiveVersions).map((line) => `Package ${line}`),
					}));
					run('git', ['push', 'origin', PRODUCTION_BRANCH], { cwd: gitRoot });
					syncAllCheckedOutPackageRepos(root, STAGING_BRANCH);
					syncBranchWithOrigin(gitRoot, STAGING_BRANCH);
					return {
						rootVersion,
						stagingCommit,
						releasedCommit,
						mergeCommit: released.commitSha,
						tag,
						changelog,
						adminCommitSummary: {
							commitCount: rootCommits.length,
							notableCommits: rootCommits.slice(0, 12),
						},
						submoduleReconciliation,
					};
				});
				rootRepo.committed = true;
				rootRepo.pushed = true;
				rootRepo.merged = true;
				rootRepo.branch = PRODUCTION_BRANCH;
				rootRepo.commitSha = String(rootRelease?.releasedCommit ?? headCommit(gitRoot));
				rootRepo.tagName = String(rootRelease?.rootVersion ?? '');
				const rootWorkflowGateResult = await executeJournalStep(root, workflowRun.runId, 'release-root-gates', () =>
					waitForWorkflowGates('release', [
						hostedDeployGate({
							name: rootRepo.name,
							repoPath: rootRepo.path,
							workflow: 'deploy.yml',
							branch: rootVersion,
							headSha: String(rootRelease?.releasedCommit ?? rootRepo.commitSha ?? ''),
						}),
					].filter((gate) => gate.headSha), ciMode, {
						root,
						runId: workflowRun.runId,
						onProgress: (line, stream) => helpers.write(line, stream),
					}).then((workflowGates) => ({ workflowGates })));
				const hostedDeploymentState = recordHostedDeploymentStatesFromRootGates(root, rootRelease, rootWorkflowGateResult?.workflowGates);
				ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				const applicationSelection = releasePlan.applicationSelection as WorkflowApplicationSelection;
				const hostingAudit = await runWorkflowHostedResourceVerification('release', root, helpers, 'prod', {
					enabled: true,
					strict: effectiveInput.verifyDeployedResources === true,
					live: effectiveInput.verifyDeployedResources === true,
					appId: singleSelectedWorkflowAppId(applicationSelection),
				});
				const releaseBackMerge = await executeJournalStep(root, workflowRun.runId, 'release-back-merge', () =>
					backMergeRootProductionIntoStaging(root, true, {
						version: rootVersion,
						changelog: (rootRelease?.changelog as ReleaseHistorySummary | undefined) ?? null,
						selectedVersions: effectiveVersions,
					}));
				const devTagCleanupMode = (effectiveInput.devTagCleanup ?? 'safe-after-release') as DevTagCleanupMode;
				const devTagCleanup = devTagCleanupMode === 'off'
					? (skipJournalStep(root, workflowRun.runId, 'cleanup-dev-tags', { status: 'skipped', reason: 'disabled' }), { status: 'skipped', reason: 'disabled' })
					: await executeJournalStep(root, workflowRun.runId, 'cleanup-dev-tags', () => {
						const cleanup = collectStaleDevTagCleanupReports(root, {
							includePackages: effectivePackageSelection.selected,
							branchScope: 'all',
						}, { execute: true });
						return { ...cleanup, replacedDevReferenceCount: replacedDevReferences.length, releasedPackageDevTagCount: releasedPackageDevTags.size };
					});
				syncAllCheckedOutPackageRepos(root, STAGING_BRANCH);
				const workspaceLinks = ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				const payload = {
					mode,
					mergeStrategy: 'merge-commit',
					level,
					fresh: input.fresh === true,
					freshArchivedRuns: freshPreparation.archived,
					resumed: workflowRun.resumed,
					resumedRunId: workflowRun.resumed ? workflowRun.runId : null,
					autoResumed: autoResumeRun != null,
					rootVersion: String(rootRelease?.rootVersion ?? ''),
					releaseTag: String(rootRelease?.rootVersion ?? ''),
					releasedCommit: String(rootRelease?.releasedCommit ?? rootRepo.commitSha ?? ''),
					stagingBranch: STAGING_BRANCH,
					productionBranch: PRODUCTION_BRANCH,
					touchedPackages: effectivePackageSelection.selected,
					packageSelection: effectivePackageSelection,
					applicationSelection,
					replacedDevReferences,
					releaseInstalls,
					devTagCleanup,
					publishWait,
					repos: packageReports,
					rootRepo,
					releaseCandidate,
					stagingWorkflowGates: stagingGateResult?.workflowGates ?? [],
					releaseBackMerge,
					hostedDeploymentState,
					finalBranch: currentBranch(gitRoot) || STAGING_BRANCH,
					pushStatus: {
						stagingPushed: true,
						productionPushed: true,
						tagPushed: true,
					},
					workspaceLinks,
					ciMode,
					workflowGates: [
						...(Array.isArray(stagingGateResult?.workflowGates) ? stagingGateResult.workflowGates : []),
						...packageReports.flatMap((report) => report.workflowGates),
						...(Array.isArray(rootWorkflowGateResult?.workflowGates) ? rootWorkflowGateResult.workflowGates : []),
					],
					hostingAudit,
					...worktreePayload(root, effectiveInput.worktreeMode),
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult('release', root, payload, {
					runId: workflowRun.runId,
					nextSteps: createNextSteps([
						{ operation: 'status', reason: 'Inspect release readiness and production state after the promotion.' },
					]),
				});
			} catch (error) {
				const localCleanup = cleanupFailedReleaseLocalState(root, helpers, releaseCleanupSnapshot, effectiveInput.workspaceLinks ?? 'auto');
				const latestJournal = readWorkflowRunJournal(root, workflowRun.runId);
				const lastCompleted = [...(latestJournal?.steps ?? [])].reverse().find((step) => step.status === 'completed') ?? null;
				const nextPending = latestJournal?.steps.find((step) => step.status === 'pending') ?? null;
				helpers.write(`[release][recovery] Last release phase: ${lastCompleted?.id ?? 'not-started'}; next phase: ${nextPending?.id ?? 'none'}.`, 'stderr');
				try {
					const repair = reattachRepairablePackageRepos(root, [STAGING_BRANCH, PRODUCTION_BRANCH], {
						onProgress: (line, stream) => helpers.write(line, stream),
					});
					if (repair.blockers.length > 0) {
						helpers.write(`[release][recovery] Package repos need manual review before retrying:\n${repair.blockers.join('\n')}`, 'stderr');
					}
				} catch (repairError) {
					helpers.write(`[release][recovery] Package repo repair failed: ${repairError instanceof Error ? repairError.message : String(repairError)}`, 'stderr');
				}
				if (localCleanup.restored.length > 0) {
					helpers.write(`[release][recovery] Restored generated release metadata in ${localCleanup.restored.length} repo(s).`, 'stderr');
				}
				if (localCleanup.manualReview.length > 0) {
					helpers.write(`[release][recovery] Local cleanup needs manual review:\n${localCleanup.manualReview.map((entry) => `- ${String(entry.repo ?? entry.scope ?? 'repo')}: ${String(entry.reason ?? 'unknown')}`).join('\n')}`, 'stderr');
				}
				helpers.write(`Safe recovery: npx trsd release --${level} --json, npx trsd release --${level} --fresh --json, or inspect with npx trsd recover --json.`, 'stderr');
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true,
					runId: workflowRun.runId,
					command: 'release',
					message: `Resume the interrupted release on ${STAGING_BRANCH}. Last phase: ${lastCompleted?.id ?? 'not-started'}; next phase: ${nextPending?.id ?? 'none'}.`,
					recoverCommand: 'npx trsd recover --json',
					resumeCommand: `npx trsd release --${level} --json`,
					localCleanup,
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
			const lock = inspectWorkflowLock(root);
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
					interruptedRuns,
					staleRuns,
					obsoleteRuns,
					prunedRuns,
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
			const dryRun = executionMode === 'plan';
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
				dryRun,
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
					? await destroyTreeseedEnvironmentResources(tenantRoot, { dryRun: true, force, deleteData, sweepTreeseed, target })
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
						destroyTreeseedEnvironmentResources(tenantRoot, { dryRun: false, force, deleteData, sweepTreeseed, target }) as Record<string, unknown>)
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
					dryRun: false,
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
