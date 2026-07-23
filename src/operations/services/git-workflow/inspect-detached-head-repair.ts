import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { run, workspaceRoot } from '../workspace-tools.ts';
import { collectMergeConflictReport, currentBranch, formatMergeConflictReport, gitStatusPorcelain, repoRoot } from '../workspace-save.ts';
import { ensureSshPushUrlForOrigin } from '../git-remote-policy.ts';
import { runTreeseedGit, type TreeseedGitRunnerMode } from '../git-runner.ts';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../../../managed-dependencies.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH, ensureWritableOrigin, headCommit, maybeHeadCommit, repoHasStagedChanges, resolveGeneratedPackageMetadataConflicts, runGit } from './staging-branch.ts';
import { pushBranch } from './checkout-task-branch-from-staging.ts';

export function inspectDetachedHeadRepair(repoDir, expectedBranches = [STAGING_BRANCH, PRODUCTION_BRANCH]) {
	const branchName = currentBranch(repoDir) || null;
	const headSha = maybeHeadCommit(repoDir);
	const dirty = gitStatusPorcelain(repoDir).length > 0;
	if (branchName) {
		return {
			repoDir,
			branchName,
			detached: false,
			dirty,
			headSha,
			targetBranch: branchName,
			targetSha: headSha,
			repairable: false,
			repaired: false,
			blocker: null,
		};
	}

	for (const branch of expectedBranches) {
		const branchSha = branchExists(repoDir, branch) ? maybeHeadCommit(repoDir, branch) : null;
		if (headSha && branchSha && headSha === branchSha) {
			return {
				repoDir,
				branchName: null,
				detached: true,
				dirty,
				headSha,
				targetBranch: branch,
				targetSha: branchSha,
				repairable: true,
				repaired: false,
				blocker: null,
			};
		}
	}

	const expected = expectedBranches.join(' or ');
	return {
		repoDir,
		branchName: null,
		detached: true,
		dirty,
		headSha,
		targetBranch: null,
		targetSha: null,
		repairable: false,
		repaired: false,
		blocker: `Detached HEAD ${headSha ?? '(unknown)'} does not match ${expected}; review manually before continuing.`,
	};
}

export function reattachDetachedHeadIfSafe(repoDir, expectedBranches = [STAGING_BRANCH, PRODUCTION_BRANCH]) {
	const inspection = inspectDetachedHeadRepair(repoDir, expectedBranches);
	if (!inspection.detached || !inspection.repairable || !inspection.targetBranch) {
		return inspection;
	}
	runGit(['switch', inspection.targetBranch], { cwd: repoDir });
	return {
		...inspection,
		branchName: inspection.targetBranch,
		detached: false,
		repaired: true,
	};
}

export function gitWorkflowRoot(cwd = workspaceRoot()) {
	return repoRoot(cwd);
}

export function assertCleanWorktree(cwd = workspaceRoot()) {
	const root = gitWorkflowRoot(cwd);
	if (gitStatusPorcelain(root).length > 0) {
		throw new Error('Treeseed requires a clean git worktree before changing branches.');
	}
	return root;
}

export function assertCleanWorktrees(repoDirs) {
	for (const repoDir of repoDirs) {
		assertCleanWorktree(repoDir);
	}
	return repoDirs;
}

export function branchExists(repoDir, branchName) {
	try {
		runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoDir });
		return true;
	} catch {
		return false;
	}
}

export function remoteBranchExists(repoDir, branchName) {
	try {
		const output = runGit(['ls-remote', '--heads', 'origin', branchName], { cwd: repoDir, capture: true });
		return output.trim().length > 0;
	} catch {
		return false;
	}
}

export function fetchOrigin(repoDir) {
	runGit(['fetch', 'origin'], { cwd: repoDir, capture: true });
}

export function remoteHeadCommit(repoDir, branchName) {
	fetchOrigin(repoDir);
	return runGit(['rev-parse', `origin/${branchName}`], { cwd: repoDir, capture: true }).trim();
}

export function pushCommitToBranch(repoDir, commitSha, branchName, { forceWithLease = false } = {}) {
	ensureWritableOrigin(repoDir);
	const args = forceWithLease
		? ['push', '--force-with-lease', 'origin', `${commitSha}:refs/heads/${branchName}`]
		: ['push', 'origin', `${commitSha}:refs/heads/${branchName}`];
	runGit(args, { cwd: repoDir });
}

export type StageMergeDownResult = {
	repoDir: string;
	featureBranch: string;
	sourceBranch: string;
	beforeHead: string;
	sourceHead: string | null;
	afterHead: string;
	merged: boolean;
	pushed: boolean;
	generatedMetadataReconciliation: Record<string, unknown> | null;
};

export type StageExactPromotionResult = {
	repoDir: string;
	targetBranch: string;
	expectedBefore: string | null;
	actualBefore: string | null;
	commitSha: string;
	pushed: boolean;
	verified: boolean;
};

export function mergeBranchDownIntoFeature(repoDir: string, input: {
	featureBranch: string;
	sourceBranch?: typeof STAGING_BRANCH;
	message: string;
	allowGeneratedMetadataAutoResolution?: boolean;
}): StageMergeDownResult {
	const sourceBranch = input.sourceBranch ?? STAGING_BRANCH;
	assertCleanWorktree(repoDir);
	fetchOrigin(repoDir);
	if (!branchExists(repoDir, input.featureBranch)) {
		if (!remoteBranchExists(repoDir, input.featureBranch)) {
			throw new Error(`Feature branch "${input.featureBranch}" does not exist locally or on origin.`);
		}
		runGit(['branch', input.featureBranch, `origin/${input.featureBranch}`], { cwd: repoDir });
	}
	checkoutBranch(repoDir, input.featureBranch);
	const beforeHead = headCommit(repoDir);
	const sourceHead = remoteBranchExists(repoDir, sourceBranch) ? remoteHeadCommit(repoDir, sourceBranch) : null;
	if (!sourceHead) {
		throw new Error(`Source branch "${sourceBranch}" does not exist on origin.`);
	}
	let generatedMetadataReconciliation: Record<string, unknown> | null = null;
	try {
		runGit(['merge', '--no-ff', `origin/${sourceBranch}`, '-m', input.message], { cwd: repoDir, capture: true });
	} catch (error) {
		const reconciliation = input.allowGeneratedMetadataAutoResolution === false
			? { resolved: false }
			: resolveGeneratedPackageMetadataConflicts(repoDir);
		if (!reconciliation.resolved) {
			const report = collectMergeConflictReport(repoDir);
			const conflictError = new Error(formatMergeConflictReport(report, repoDir, sourceBranch));
			Object.assign(conflictError, {
				cause: error,
				mergeConflictReport: report,
				code: 'conflict_resolution_required',
			});
			throw conflictError;
		}
		generatedMetadataReconciliation = reconciliation as Record<string, unknown>;
		if (repoHasStagedChanges(repoDir)) {
			runGit(['commit', '-m', input.message], { cwd: repoDir });
		}
	}
	const afterHead = headCommit(repoDir);
	const merged = beforeHead !== afterHead;
	if (merged) {
		pushBranch(repoDir, input.featureBranch);
	}
	return {
		repoDir,
		featureBranch: input.featureBranch,
		sourceBranch,
		beforeHead,
		sourceHead,
		afterHead,
		merged,
		pushed: merged,
		generatedMetadataReconciliation,
	};
}

export function promoteCommitToBranchWithExpectedHead(repoDir: string, input: {
	commitSha: string;
	targetBranch?: typeof STAGING_BRANCH;
	expectedBefore: string | null;
}): StageExactPromotionResult {
	const targetBranch = input.targetBranch ?? STAGING_BRANCH;
	fetchOrigin(repoDir);
	const actualBefore = remoteBranchExists(repoDir, targetBranch) ? remoteHeadCommit(repoDir, targetBranch) : null;
	if (actualBefore !== input.expectedBefore) {
		throw new Error(`Refusing to promote ${targetBranch}; origin/${targetBranch} moved from ${input.expectedBefore ?? '(missing)'} to ${actualBefore ?? '(missing)'}.`);
	}
	ensureWritableOrigin(repoDir);
	const lease = actualBefore
		? `--force-with-lease=refs/heads/${targetBranch}:${actualBefore}`
		: '--force-with-lease';
	runGit(['push', lease, 'origin', `${input.commitSha}:refs/heads/${targetBranch}`], { cwd: repoDir });
	fetchOrigin(repoDir);
	const verifiedHead = remoteHeadCommit(repoDir, targetBranch);
	if (verifiedHead !== input.commitSha) {
		throw new Error(`Promotion verification failed for ${targetBranch}; expected ${input.commitSha}, observed ${verifiedHead}.`);
	}
	return {
		repoDir,
		targetBranch,
		expectedBefore: input.expectedBefore,
		actualBefore,
		commitSha: input.commitSha,
		pushed: true,
		verified: true,
	};
}

export function ensureLocalBranchTracking(repoDir, branchName) {
	if (branchExists(repoDir, branchName)) {
		return;
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
		return;
	}

	runGit(['checkout', '--orphan', branchName], { cwd: repoDir });
}

export function checkoutBranch(repoDir, branchName) {
	runGit(['checkout', branchName], { cwd: repoDir, capture: true });
}
