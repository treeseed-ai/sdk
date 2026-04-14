import { findNearestTreeseedRoot, run } from '../operations/services/workspace-tools.ts';
import { currentBranch, repoRoot } from '../operations/services/workspace-save.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../operations/services/git-workflow.ts';

export type TreeseedWorkflowBranchRole = 'feature' | 'staging' | 'main' | 'detached' | 'none';

export type TreeseedResolvedWorkflowPaths = {
	requestedCwd: string;
	tenantRoot: string | null;
	cwd: string;
	repoRoot: string | null;
	branchName: string | null;
	branchRole: TreeseedWorkflowBranchRole;
};

function safeRepoRoot(cwd: string) {
	try {
		return repoRoot(cwd);
	} catch {
		return null;
	}
}

function repoHasHead(repoDir: string) {
	try {
		run('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoDir, capture: true });
		return true;
	} catch {
		return false;
	}
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
