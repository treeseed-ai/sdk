import { relative } from 'node:path';
import { findNearestRoot } from '../operations/services/treedx/workspaces/workspace-tools.ts';
import { currentBranch, repoRoot } from '../operations/services/treedx/workspaces/workspace-save.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../operations/services/operations/git-workflow.ts';
import { runGitOk } from '../operations/services/operations/git-runner.ts';

export type WorkflowBranchRole = 'feature' | 'staging' | 'main' | 'detached' | 'none';

export type ResolvedWorkflowPaths = {
	requestedCwd: string;
	tenantRoot: string | null;
	cwd: string;
	repoRoot: string | null;
	branchName: string | null;
	branchRole: WorkflowBranchRole;
};

export function safeRepoRoot(cwd: string) {
	try {
		return repoRoot(cwd);
	} catch {
		return null;
	}
}

export function repoHasHead(repoDir: string) {
	return runGitOk(['rev-parse', '--verify', 'HEAD'], { cwd: repoDir, mode: 'read' });
}

export function isInsideUnresolvedManagedWorktree(startCwd: string, tenantRoot: string | null) {
	if (!tenantRoot) return false;
	const relativePath = relative(tenantRoot, startCwd).replaceAll('\\', '/');
	return relativePath === '.treeseed/worktrees' || relativePath.startsWith('.treeseed/worktrees/');
}

export function classifyBranchRole(branchName: string | null, repoDir: string | null): WorkflowBranchRole {
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

export function resolveWorkflowPaths(startCwd: string): ResolvedWorkflowPaths {
	const tenantRoot = findNearestRoot(startCwd);
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
		branchRole: classifyBranchRole(branchName, gitRoot),
	};
}

export function workflowEnvironmentForBranchRole(branchRole: WorkflowBranchRole) {
	if (branchRole === 'staging') return 'staging';
	if (branchRole === 'main') return 'prod';
	if (branchRole === 'feature') return 'local';
	return 'none';
}
