import { relative } from 'node:path';
import { findNearestTreeseedRoot } from '../operations/services/workspace-tools.ts';
import { currentBranch, repoRoot } from '../operations/services/workspace-save.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../operations/services/git-workflow.ts';
import { runTreeseedGitOk } from '../operations/services/git-runner.ts';

export type TreeseedWorkflowBranchRole = 'feature' | 'staging' | 'main' | 'detached' | 'none';

export type TreeseedResolvedWorkflowPaths = {
	requestedCwd: string;
	tenantRoot: string | null;
	cwd: string;
	repoRoot: string | null;
	branchName: string | null;
	branchRole: TreeseedWorkflowBranchRole;
};

export function safeRepoRoot(cwd: string) {
	try {
		return repoRoot(cwd);
	} catch {
		return null;
	}
}

export function repoHasHead(repoDir: string) {
	return runTreeseedGitOk(['rev-parse', '--verify', 'HEAD'], { cwd: repoDir, mode: 'read' });
}

export function isInsideUnresolvedManagedWorktree(startCwd: string, tenantRoot: string | null) {
	if (!tenantRoot) return false;
	const relativePath = relative(tenantRoot, startCwd).replaceAll('\\', '/');
	return relativePath === '.treeseed/worktrees' || relativePath.startsWith('.treeseed/worktrees/');
}

export function classifyTreeseedBranchRole(branchName: string | null, repoDir: string | null): TreeseedWorkflowBranchRole {
	if (!repoDir) {
		return 'none';
	}
	if (!branchName) {
		return repoHasHead(repoDir) ? 'detached' : 'none';
	}
	if (branchName === STAGING_BRANCH) {
		return 'staging';
	}
	if (branchName === PRODUCTION_BRANCH) {
		return 'main';
	}
	return 'feature';
}

export function resolveTreeseedWorkflowPaths(startCwd: string): TreeseedResolvedWorkflowPaths {
	const tenantRoot = findNearestTreeseedRoot(startCwd);
	if (isInsideUnresolvedManagedWorktree(startCwd, tenantRoot)) {
		return {
			requestedCwd: startCwd,
			tenantRoot: null,
			cwd: startCwd,
			repoRoot: null,
			branchName: null,
			branchRole: 'none',
		};
	}
	const cwd = tenantRoot ?? startCwd;
	const gitRoot = safeRepoRoot(cwd);
	const branchName = gitRoot ? (currentBranch(gitRoot) || null) : null;
	return {
		requestedCwd: startCwd,
		tenantRoot,
		cwd,
		repoRoot: gitRoot,
		branchName,
		branchRole: classifyTreeseedBranchRole(branchName, gitRoot),
	};
}

export function workflowEnvironmentForBranchRole(branchRole: TreeseedWorkflowBranchRole) {
	if (branchRole === 'staging') return 'staging';
	if (branchRole === 'main') return 'prod';
	if (branchRole === 'feature') return 'local';
	return 'none';
}
