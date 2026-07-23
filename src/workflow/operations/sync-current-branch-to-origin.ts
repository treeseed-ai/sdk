import { ensureTreeseedSecretSessionForConfig } from "../../operations/services/config-runtime.ts";
import { branchExists, checkoutBranch, createDeprecatedTaskTag, deleteLocalBranch, deleteRemoteBranch, ensureLocalBranchTracking, gitWorkflowRoot, PRODUCTION_BRANCH, reattachDetachedHeadIfSafe, remoteBranchExists, STAGING_BRANCH, syncBranchWithOrigin } from "../../operations/services/git-workflow.ts";
import { collectMergeConflictReport, currentBranch, formatMergeConflictReport, hasMeaningfulChanges } from "../../operations/services/workspace-save.ts";
import { changedWorkspacePackages, publishableWorkspacePackages, run, sortWorkspacePackages, workspaceRoot } from "../../operations/services/workspace-tools.ts";
import { type TreeseedWorkflowStatusOptions } from "../../workflow-state.ts";
import { type TreeseedWorkflowRunCommand } from ".././runs.ts";
import { checkedOutWorkspacePackageRepos } from ".././session.ts";
import { resolveTreeseedWorkflowPaths } from ".././policy.ts";
import type { TreeseedWorkflowOperationId } from "../../workflow.ts";
import { TreeseedWorkflowError, WorkflowOperationHelpers, runGit } from './workflow-write.ts';
import { WorkflowRepoReport, resolveProjectRootOrThrow, resolveRepoState, withContextEnv, workflowError } from './run-release-production-guarantees.ts';
import { workflowSave } from './workflow-save.ts';
import { updateHead } from './workflow-switch.ts';
import { createStatusResult } from './release-admin-message.ts';

export function syncCurrentBranchToOrigin(operation: TreeseedWorkflowOperationId, repoDir: string, branch: string) {
	try {
		if (remoteBranchExists(repoDir, branch)) {
			runGit(['pull', '--rebase', 'origin', branch], { cwd: repoDir });
			runGit(['push', 'origin', branch], { cwd: repoDir });
			return {
				remoteBranchExisted: true, 				pulledRebase: true, 				pushed: true, 				createdRemoteBranch: false, 				conflicts: false,
			};
		}

		runGit(['push', '-u', 'origin', branch], { cwd: repoDir });
		return {
			remoteBranchExisted: false, 			pulledRebase: false, 			pushed: true, 			createdRemoteBranch: true, 			conflicts: false,
		};
	} catch {
		const report = collectMergeConflictReport(repoDir);
		throw new TreeseedWorkflowError(operation, 'merge_conflict', formatMergeConflictReport(report, repoDir, branch), {
			details: { branch, report },
			exitCode: 12,
		});
	}
}

export async function maybeAutoSaveCurrentTaskBranch(
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

export function checkoutOrCreateSaveBranch(repoDir: string, branch: string) {
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

export function runPackageVerifyLocal(pkgDir: string) {
	run('npm', ['run', 'verify:local'], { cwd: pkgDir });
}

export function branchNeedsSync(repoDir: string, branch: string) {
	if (!remoteBranchExists(repoDir, branch)) {
		return true;
	}
	const localHead = runGit(['rev-parse', 'HEAD'], { cwd: repoDir, capture: true }).trim();
	const remoteHead = runGit(['rev-parse', `origin/${branch}`], { cwd: repoDir, capture: true }).trim();
	return localHead !== remoteHead;
}

export function savePackageRepo(
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

export function createSaveFailure(
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
				message, 				failingRepo: failingRepo?.name ?? null, 				repos, 				rootRepo, 				error: rendered,
			},
		},
		exitCode,
	});
}

export function ensureLocalTaskBranch(repoDir: string, branchName: string) {
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

export function cleanupTaskBranchReport(
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

export function syncAllCheckedOutPackageRepos(root: string, branchName: string) {
	for (const pkg of checkedOutWorkspacePackageRepos(root)) {
		syncBranchWithOrigin(pkg.dir, branchName);
	}
}

export function reattachRepairablePackageRepos(
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
			name: pkg.name, 			path: pkg.dir, 			...report,
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

export function collectReleasePackageSelection(root: string) {
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

export function hasStagedChanges(repoDir: string) {
	return runGit(['diff', '--cached', '--name-only'], { cwd: repoDir, capture: true }).trim().length > 0;
}

export async function workflowStatus(helpers: WorkflowOperationHelpers, input: TreeseedWorkflowStatusOptions = {}) {
	return withContextEnv(helpers.context.env, async () => {
		const resolved = resolveTreeseedWorkflowPaths(helpers.cwd());
		if (resolved.tenantRoot) {
			try {
				await ensureTreeseedSecretSessionForConfig({
					tenantRoot: resolved.cwd, 					interactive: false, 					env: helpers.context.env, 					createIfMissing: false, 					allowMigration: false,
				});
			} catch {
				// Status must remain observational. If secrets cannot be unlocked
				// non-interactively, the resulting state reports locked/missing config.
			}
		}
		return createStatusResult(helpers.cwd(), {
			...input, 			env: input.env ?? helpers.context.env,
		});
	});
}
