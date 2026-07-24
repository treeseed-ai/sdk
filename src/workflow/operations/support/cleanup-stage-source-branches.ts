import { branchExists, deleteLocalBranch, deleteRemoteBranchIfMerged, STAGING_BRANCH, syncBranchWithOrigin } from "../../../operations/services/operations/git-workflow.ts";
import { currentBranch, repoRoot } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { managedWorkflowWorktreeMetadata, removeManagedWorkflowWorktree } from "../../worktrees.ts";
import { StageCandidateManifest } from '../workspace-lifecycle/workflow-close.ts';
import { checkedOutStagePromotionRepos } from '../coordination/staging-candidate-workflow-gates.ts';

export function cleanupStageSourceBranches(root: string, branchName: string, manifest: StageCandidateManifest) {
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
			name: repo.name, 			path: repo.dir, 			remoteDeleted, 			localDeleted: localExists && !branchExists(repo.dir, branchName),
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
