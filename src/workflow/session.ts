import { relative } from 'node:path';
import {
	currentBranch,
	gitStatusPorcelain,
	originRemoteUrl,
	repoRoot,
} from '../operations/services/workspace-save.ts';
import {
	changedWorkspacePackages,
	hasCompleteTreeseedPackageCheckout,
	publishableWorkspacePackages,
	sortWorkspacePackages,
	workspacePackages,
	workspaceRoot,
} from '../operations/services/workspace-tools.ts';
import {
	classifyTreeseedBranchRole,
	type TreeseedWorkflowBranchRole,
	resolveTreeseedWorkflowPaths,
} from './policy.ts';

export type TreeseedWorkflowMode = 'root-only' | 'recursive-workspace';

export type TreeseedWorkflowSessionRepo = {
	name: string;
	path: string;
	relativePath: string;
	branchName: string | null;
	branchRole: TreeseedWorkflowBranchRole;
	dirty: boolean;
	detached: boolean;
	hasOriginRemote: boolean;
};

export type TreeseedWorkflowPackageSelection = {
	changed: string[];
	dependents: string[];
	selected: string[];
};

export type TreeseedWorkflowSession = {
	root: string;
	gitRoot: string;
	mode: TreeseedWorkflowMode;
	branchName: string | null;
	branchRole: TreeseedWorkflowBranchRole;
	rootRepo: TreeseedWorkflowSessionRepo;
	packageRepos: TreeseedWorkflowSessionRepo[];
	packageSelection: TreeseedWorkflowPackageSelection;
};

function hasOriginRemote(repoDir: string) {
	try {
		originRemoteUrl(repoDir);
		return true;
	} catch {
		return false;
	}
}

function repoState(root: string, name: string, repoDir: string): TreeseedWorkflowSessionRepo {
	const branchName = currentBranch(repoDir) || null;
	return {
		name,
		path: repoDir,
		relativePath: relative(root, repoDir).replaceAll('\\', '/') || '.',
		branchName,
		branchRole: classifyTreeseedBranchRole(branchName, repoDir),
		dirty: gitStatusPorcelain(repoDir).length > 0,
		detached: branchName == null,
		hasOriginRemote: hasOriginRemote(repoDir),
	};
}

export function checkedOutWorkspacePackageRepos(root: string) {
	if (!hasCompleteTreeseedPackageCheckout(root)) {
		return [];
	}
	return sortWorkspacePackages(
		workspacePackages(root).filter((pkg) => pkg.name?.startsWith('@treeseed/')),
	);
}

export function workflowModeForRoot(root: string): TreeseedWorkflowMode {
	return hasCompleteTreeseedPackageCheckout(root) ? 'recursive-workspace' : 'root-only';
}

export function collectReleasePackageSelection(root: string): TreeseedWorkflowPackageSelection {
	const publishable = sortWorkspacePackages(
		publishableWorkspacePackages(root).filter((pkg) => pkg.name?.startsWith('@treeseed/')),
	);
	const changed = changedWorkspacePackages({
		root,
		baseRef: 'main',
		includeDependents: false,
		packages: publishable,
	});
	const selected = changedWorkspacePackages({
		root,
		baseRef: 'main',
		includeDependents: true,
		packages: publishable,
	});
	const changedNames = changed.map((pkg) => pkg.name);
	return {
		changed: changedNames,
		dependents: selected.filter((pkg) => !changedNames.includes(pkg.name)).map((pkg) => pkg.name),
		selected: selected.map((pkg) => pkg.name),
	};
}

export function resolveTreeseedWorkflowSession(cwd: string): TreeseedWorkflowSession {
	const resolved = resolveTreeseedWorkflowPaths(cwd);
	const root = workspaceRoot(resolved.cwd);
	const gitRoot = repoRoot(root);
	const mode = workflowModeForRoot(root);
	const packageRepos = checkedOutWorkspacePackageRepos(root).map((pkg) => repoState(root, pkg.name, pkg.dir));
	return {
		root,
		gitRoot,
		mode,
		branchName: currentBranch(gitRoot) || null,
		branchRole: classifyTreeseedBranchRole(currentBranch(gitRoot) || null, gitRoot),
		rootRepo: repoState(root, '@treeseed/market', gitRoot),
		packageRepos,
		packageSelection: collectReleasePackageSelection(root),
	};
}
