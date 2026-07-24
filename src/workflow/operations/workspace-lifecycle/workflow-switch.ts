import { assertCleanWorktree, branchExists, checkoutNewTaskBranchWithChanges, checkoutTaskBranchFromStaging, headCommit, PRODUCTION_BRANCH, remoteBranchExists, STAGING_BRANCH } from "../../../operations/services/operations/git-workflow.ts";
import { currentBranch, hasMeaningfulChanges } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { workspaceRoot } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { classifyGitMode, runRepositoryGit, runGitOk } from "../../../operations/services/operations/git-runner.ts";
import { resolveWorkflowState } from "../../../operations/workflow-state.ts";
import { resolveWorkflowSession } from "../../session.ts";
import { checkedOutManagedWorkflowRepos } from "../../../operations/services/support/managed-repositories.ts";
import { effectiveWorkflowWorktreeMode, ensureManagedWorkflowWorktree, plannedManagedWorkflowWorktreePath } from "../../worktrees.ts";
import type { SwitchInput, UpdateInput } from "../../../operations/workflow.ts";
import { WorkflowOperationHelpers, ensureWorkflowWorkspaceLinks } from '../recovery/workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv, workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { reattachRepairablePackageRepos } from '../support/sync-current-branch-to-origin.ts';
import { assertWorkspaceClean, buildWorkflowResult, createManagedWorkflowRepoReports, createWorkspaceRootRepoReport, findReportByName, normalizeExecutionMode } from '../support/create-repo-report.ts';
import { helpersForCwd, shouldDispatchSwitchToManagedWorktree, worktreePayload } from '../packages/normalize-release-candidate-mode.ts';
import { assertSessionBranchSafety, branchPreviewInitialized, reconcileBranchPreview, reconcileWorkflowBranchPreview } from '../packages/collect-published-release-artifact-checks.ts';
import { createNextSteps } from '../packages/release-admin-message.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep } from '../packages/prepare-fresh-release-run.ts';
import { failWorkflowRun } from '../recovery/fail-workflow-run.ts';
import { toError } from '../projects/projects-core/connect-market-project.ts';

export async function workflowSwitch(helpers: WorkflowOperationHelpers, input: SwitchInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('switch', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const branchName = String(input.branch ?? input.branchName ?? '').trim();
			if (!branchName) {
				workflowError('switch', 'validation_failed', 'Treeseed switch requires a branch name.');
			}
			reattachRepairablePackageRepos(root, [branchName, STAGING_BRANCH, PRODUCTION_BRANCH], {
				operation: 'switch', 				onProgress: (line, stream) => helpers.write(line, stream), 				throwOnBlocker: true,
			});
			const session = resolveWorkflowSession(root);
			const preview = input.preview === true;
			const adoptChanges = input.adoptChanges === true;
			const executionMode = normalizeExecutionMode(input);
			if (executionMode !== 'plan' && !adoptChanges && shouldDispatchSwitchToManagedWorktree(root, input, helpers.context.env)) {
				const managed = ensureManagedWorkflowWorktree({
					root, 					branchName, 					mode: input.worktreeMode, 					env: helpers.context.env,
				});
				const result = await workflowSwitch(helpersForCwd(helpers, managed.worktreePath), {
					...input, 					worktreeMode: 'off',
				});
				return {
					...result,
					payload: {
						...(result.payload as Record<string, unknown>), 						worktreeMode: input.worktreeMode ?? 'auto', 						worktreePath: managed.worktreePath, 						managedWorktree: managed,
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
					? await reconcileBranchPreview({
						root, 						branch: branchName, 						planOnly: true, 						execute: false, 						initialize: !branchPreviewInitialized(root, branchName), 						env: helpers.context.env,
					})
					: null;
				return buildWorkflowResult(
					'switch', 					root,
					{
						mode, 						branchName, 						rootRepo, 						repos: packageReports, 						previewRequested: preview, 						worktreeMode: input.worktreeMode ?? 'auto', 						worktreePath: effectiveWorkflowWorktreeMode(input.worktreeMode, helpers.context.env) === 'on'
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
				'switch', 				session,
				{ branch: branchName, preview, adoptChanges, worktreeMode: input.worktreeMode ?? 'auto' },
				[
					{ id: 'switch-root', description: `Switch market repo to ${branchName}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true },
					...packageReports.map((report) => ({
						id: `switch-${report.name}`,
						description: `Mirror ${branchName} into ${report.name}`,
						repoName: report.name, 						repoPath: report.path, 						branch: branchName, 						resumable: true,
					})),
					{ id: 'workspace-link', description: 'Apply local workspace links', repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true },
					...(preview ? [{ id: 'preview', description: `Provision or refresh preview ${branchName}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: branchName, resumable: true }] : []),
				],
				helpers.context,
			);

			try {
				const rootSwitch = await executeJournalStep(root, workflowRun.runId, 'switch-root', () =>
					(adoptChanges ? checkoutNewTaskBranchWithChanges : checkoutTaskBranchFromStaging)(repoDir, branchName, {
						createIfMissing: input.createIfMissing !== false, 						pushIfCreated: true,
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
							createIfMissing: input.createIfMissing !== false, 							pushIfCreated: false,
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
				const stateAfterSwitch = resolveWorkflowState(root);
				if (preview) {
					previewResult = await executeJournalStep(root, workflowRun.runId, 'preview', () =>
						reconcileWorkflowBranchPreview(root, branchName, helpers.context, { initialize: !stateAfterSwitch.preview.enabled }),
					) ?? null;
				}

				const state = resolveWorkflowState(root);
				const payload = {
					mode, 					branchName, 					created: rootRepo.created, 					resumed: rootRepo.resumed, 					repos: packageReports, 					rootRepo, 					previewRequested: preview,
					preview: {
						enabled: state.preview.enabled, 						url: state.preview.url, 						lastDeploymentTimestamp: state.preview.lastDeploymentTimestamp,
					},
					previewResult, 					workspaceLinks, 					...worktreePayload(root, input.worktreeMode),
					preconditions: {
						cleanWorktreeRequired: !adoptChanges, 						adoptedDirtyStagingChanges: adoptChanges, 						baseBranch: STAGING_BRANCH,
					},
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'switch', 					root, 					payload,
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
					resumable: true, 					runId: workflowRun.runId, 					command: 'switch',
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

export type UpdateStrategy = 'merge' | 'ff-only';

export type UpdateRepoAction = 'planned' | 'up-to-date' | 'merged' | 'fast-forwarded' | 'pushed' | 'blocked';

export type UpdateRepoResult = {
	name: string;
	path: string;
	branch: string;
	sourceRef: string;
	action: UpdateRepoAction;
	beforeHead: string | null;
	afterHead: string | null;
	pushed: boolean;
	changedFiles: string[];
	blockers: string[];
	ahead?: number | null;
	behind?: number | null;
	status?: 'up-to-date' | 'merge-needed' | 'fast-forward' | 'blocked';
};

export type UpdateConflict = {
	repo: string;
	path: string;
	files: string[];
};

export function normalizeUpdateStrategy(strategy: UpdateInput['strategy']): UpdateStrategy {
	return strategy === 'ff-only' ? 'ff-only' : 'merge';
}

export function normalizeUpdateSource(source: string | undefined) {
	const normalized = String(source ?? STAGING_BRANCH).trim();
	return normalized || STAGING_BRANCH;
}

export function gitOutput(args: string[], cwd: string, allowFailure = false) {
	return runRepositoryGit(args, {
		cwd,
		mode: classifyGitMode(args),
		allowFailure,
	}).stdout.trim();
}

export function updateHead(repoDir: string) {
	return gitOutput(['rev-parse', 'HEAD'], repoDir, true) || null;
}

export function updateStatusLines(repoDir: string) {
	const output = gitOutput(['status', '--porcelain'], repoDir, true);
	return output ? output.split(/\r?\n/u).filter(Boolean) : [];
}

export function updateChangedFiles(repoDir: string) {
	return updateStatusLines(repoDir)
		.map((line) => line.slice(3).trim())
		.filter(Boolean);
}

export function updateConflictedFiles(repoDir: string) {
	return updateStatusLines(repoDir)
		.filter((line) => {
			const status = line.slice(0, 2);
			return status.includes('U') || ['AA', 'DD'].includes(status);
		})
		.map((line) => line.slice(3).trim())
		.filter(Boolean);
}

export function sourceBranchExists(repoDir: string, sourceBranch: string) {
	return runRepositoryGit(['ls-remote', '--exit-code', '--heads', 'origin', sourceBranch], {
		cwd: repoDir,
		mode: 'read',
		allowFailure: true,
	}).status === 0;
}

export function localRemoteRefExists(repoDir: string, sourceBranch: string) {
	return runGitOk(['show-ref', '--verify', `refs/remotes/origin/${sourceBranch}`], {
		cwd: repoDir,
		mode: 'read',
	});
}
