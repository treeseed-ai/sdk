import { assertCleanWorktree, assertFeatureBranch, createDeprecatedTaskTag, deleteLocalBranch, deleteRemoteBranch, STAGING_BRANCH, syncBranchWithOrigin } from "../../operations/services/git-workflow.ts";
import { currentBranch, hasMeaningfulChanges } from "../../operations/services/workspace-save.ts";
import { workspaceRoot } from "../../operations/services/workspace-tools.ts";
import { resolveTreeseedWorkflowSession } from ".././session.ts";
import { checkedOutManagedWorkflowRepos, type TreeseedManagedRepository } from "../../operations/services/managed-repositories.ts";
import { isManagedWorkflowWorktree, managedWorkflowWorktreeMetadata, removeManagedWorkflowWorktree } from ".././worktrees.ts";
import type { TreeseedCloseInput } from "../../workflow.ts";
import { WorkflowOperationHelpers, ensureWorkflowWorkspaceLinks, unlinkWorkflowWorkspaceLinks } from './workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv } from './run-release-production-guarantees.ts';
import { assertWorkspaceClean, buildWorkflowResult, createManagedWorkflowRepoReports, createWorkspaceRootRepoReport, findReportByName, normalizeExecutionMode } from './create-repo-report.ts';
import { findAutoResumableTaskRun, rejectImplicitWorkflowResume } from './gates-for-saved-repository-reports.ts';
import { ensureMessage, toError } from './connect-treeseed-market-project.ts';
import { worktreePayload } from './normalize-release-candidate-mode.ts';
import { createNextSteps } from './release-admin-message.ts';
import { cleanupTaskBranchReport, maybeAutoSaveCurrentTaskBranch } from './sync-current-branch-to-origin.ts';
import { assertSessionBranchSafety, destroyWorkflowBranchPreviewIfPresent } from './collect-published-release-artifact-checks.ts';
import { acquireWorkflowRun, completeWorkflowRun, executeJournalStep, skipJournalStep } from './prepare-fresh-release-run.ts';
import { updateHead } from './workflow-switch.ts';
import { failWorkflowRun } from './fail-workflow-run.ts';

export async function workflowClose(helpers: WorkflowOperationHelpers, input: TreeseedCloseInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const tenantRoot = resolveProjectRootOrThrow('close', helpers.cwd());
			const root = workspaceRoot(tenantRoot);
			const executionMode = normalizeExecutionMode(input);
			const session = resolveTreeseedWorkflowSession(root);
			const explicitResumeRunId = helpers.context.workflow?.resumeRunId
				?? (input as TreeseedCloseInput & { resumeRunId?: string }).resumeRunId
				?? null;
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
					'close', 					root,
					{
						mode: session.mode, 						branchName, 						message,
						autoResumeCandidate: planAutoResumeRun
							? {
								runId: planAutoResumeRun.runId, 								branch: planAutoResumeRun.session.branchName, 								failure: planAutoResumeRun.failure,
							}
							: null, 						...worktreePayload(root, effectiveInput.worktreeMode), 						autoSaveRequired: session.rootRepo.dirty || session.managedRepos.some((repo) => repo.dirty), 						repos: createManagedWorkflowRepoReports(root), 						rootRepo: createWorkspaceRootRepoReport(root), 						blockers,
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
					message, 					autoSave: effectiveInput.autoSave,
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
				'close', 				activeSession,
				{
					message, 					deletePreview: effectiveInput.deletePreview !== false, 					deleteBranch: effectiveInput.deleteBranch !== false, 					worktreeMode: effectiveInput.worktreeMode ?? 'auto',
				},
				[
					{ id: 'workspace-unlink', description: 'Remove local workspace links', repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'preview-cleanup', description: `Destroy preview resources for ${featureBranch}`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					{ id: 'cleanup-root', description: `Archive ${featureBranch} in market`, repoName: rootRepo.name, repoPath: rootRepo.path, branch: featureBranch, resumable: true },
					...packageReports.map((report) => ({
						id: `cleanup-${report.name}`,
						description: `Archive ${featureBranch} in ${report.name}`,
						repoName: report.name, 						repoPath: report.path, 						branch: featureBranch, 						resumable: true,
					})),
					{ id: 'workspace-link', description: 'Restore local workspace links', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: true },
					...(isManagedWorkflowWorktree(root)
						? [{ id: 'worktree-cleanup', description: 'Remove managed workflow worktree', repoName: rootRepo.name, repoPath: rootRepo.path, branch: STAGING_BRANCH, resumable: false }]
						: []),
				],
				explicitResumeRunId
					? {
						...helpers.context,
						workflow: {
							...(helpers.context.workflow ?? {}),
							resumeRunId: explicitResumeRunId,
						},
					}
					: autoResumeRun
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
						head, 						tagName: tag.tagName, 						deletedRemote, 						deletedLocal: effectiveInput.deleteBranch !== false && !managedWorktreeForClose, 						branch: managedWorktreeForClose ? featureBranch : (currentBranch(repoDir) || STAGING_BRANCH), 						dirty: hasMeaningfulChanges(repoDir),
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
							deleteBranch: effectiveInput.deleteBranch !== false, 							targetBranch: STAGING_BRANCH,
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
					mode, 					branchName: featureBranch, 					message, 					autoSaved: autoSave.performed, 					autoSaveResult: autoSave.save, 					repos: packageReports, 					rootRepo, 					previewCleanup, 					remoteDeleted: rootRepo.deletedRemote, 					localDeleted: rootRepo.deletedLocal, 					finalBranch, 					workspaceLinks, 					worktreeCleanup, 					worktreeMode: effectiveInput.worktreeMode ?? 'auto', 					managedWorktree, 					worktreePath: managedWorktree?.worktreePath ?? null, 					primaryRoot: managedWorktree?.primaryRoot ?? null,
				};
				completeWorkflowRun(root, workflowRun.runId, payload);
				return buildWorkflowResult(
					'close', 					root, 					payload,
					{
						runId: workflowRun.runId, 						includeFinalState: !managedWorktreeForClose,
						nextSteps: createNextSteps([
							{ operation: 'tasks', reason: 'Inspect the remaining task branches after closing this one.' },
						]),
					},
				);
			} catch (error) {
				ensureWorkflowWorkspaceLinks(root, helpers, effectiveInput.workspaceLinks ?? 'auto');
				failWorkflowRun(root, workflowRun.runId, error, {
					resumable: true, 					runId: workflowRun.runId, 					command: 'close',
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

export type StageVerifyMode = 'action' | 'local' | 'none';

export type StageCiMode = 'off' | 'hosted';

export type StageCleanupMode = 'success' | 'manual';

export type StageRepoPlan = {
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

export type StageCandidateManifest = {
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
