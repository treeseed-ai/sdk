import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
	currentBranch,
	gitStatusPorcelain,
	originRemoteUrl,
	repoRoot,
} from '../operations/services/treedx/workspaces/workspace-save.ts';
import {
	hasCompletePackageCheckout,
	publishableWorkspacePackages,
	sortWorkspacePackages,
	workspacePackages,
	workspaceRoot,
} from '../operations/services/treedx/workspaces/workspace-tools.ts';
import { discoverPackageAdapters } from '../operations/services/reconciliation/package-adapters.ts';
import { runRepositoryGit } from '../operations/services/operations/git-runner.ts';
import {
	classifyBranchRole,
	type WorkflowBranchRole,
	resolveWorkflowPaths,
} from './policy.ts';
import {
	checkedOutManagedWorkflowRepos,
	type ManagedRepositoryKind,
} from '../operations/services/support/managed-repositories.ts';

export type WorkflowMode = 'root-only' | 'recursive-workspace';

export type WorkflowSessionRepo = {
	name: string;
	path: string;
	relativePath: string;
	kind: ManagedRepositoryKind | 'package';
	branchName: string | null;
	branchRole: WorkflowBranchRole;
	dirty: boolean;
	detached: boolean;
	hasOriginRemote: boolean;
};

export type WorkflowPackageSelection = {
	changed: string[];
	dependents: string[];
	selected: string[];
};

export type WorkflowSession = {
	root: string;
	gitRoot: string;
	mode: WorkflowMode;
	branchName: string | null;
	branchRole: WorkflowBranchRole;
	rootRepo: WorkflowSessionRepo;
	managedRepos: WorkflowSessionRepo[];
	packageRepos: WorkflowSessionRepo[];
	packageSelection: WorkflowPackageSelection;
};

export function hasOriginRemote(repoDir: string) {
	try {
		originRemoteUrl(repoDir);
		return true;
	} catch {
		return false;
	}
}

export function repoState(root: string, name: string, repoDir: string, kind: WorkflowSessionRepo['kind'] = 'package'): WorkflowSessionRepo {
	const branchName = currentBranch(repoDir) || null;
	return {
		name,
		path: repoDir,
		relativePath: relative(root, repoDir).replaceAll('\\', '/') || '.',
		kind,
		branchName,
		branchRole: classifyBranchRole(branchName, repoDir),
		dirty: gitStatusPorcelain(repoDir).length > 0,
		detached: branchName == null,
		hasOriginRemote: hasOriginRemote(repoDir),
	};
}

export function checkedOutWorkspacePackageRepos(root: string) {
	let packages: ReturnType<typeof workspacePackages> = [];
	try {
		packages = workspacePackages(root);
	} catch {
		packages = [];
	}
	if (!hasCompletePackageCheckout(root) && packages.length === 0) {
		return [];
	}
	const repos = new Map<string, ReturnType<typeof workspacePackages>[number]>();
	for (const pkg of packages.filter((pkg) => pkg.name?.startsWith('@treeseed/'))) {
		if (!existsSync(resolve(pkg.dir, '.git'))) continue;
		repos.set(pkg.name, pkg);
	}
	for (const adapter of discoverPackageAdapters(root)) {
		if (!adapter.publishTarget && adapter.artifacts.length === 0) continue;
		if (repos.has(adapter.id)) continue;
		if (!existsSync(resolve(adapter.dir, '.git'))) continue;
		repos.set(adapter.id, {
			dir: adapter.dir,
			name: adapter.id,
			packageJson: {},
			relativeDir: adapter.relativeDir,
		});
	}
	return sortWorkspacePackages([...repos.values()]);
}

export function workflowModeForRoot(root: string): WorkflowMode {
	return hasCompletePackageCheckout(root) ? 'recursive-workspace' : 'root-only';
}

export function collectReleasePackageSelection(root: string): WorkflowPackageSelection {
	const publishableByName = new Map<string, ReturnType<typeof workspacePackages>[number]>();
	for (const pkg of publishableWorkspacePackages(root).filter((pkg) => pkg.name?.startsWith('@treeseed/'))) {
		publishableByName.set(pkg.name, pkg);
	}
	for (const adapter of discoverPackageAdapters(root)) {
		if (!adapter.publishTarget && adapter.artifacts.length === 0) continue;
		if (publishableByName.has(adapter.id)) continue;
		publishableByName.set(adapter.id, {
			dir: adapter.dir,
			name: adapter.id,
			packageJson: {},
			relativeDir: adapter.relativeDir,
		});
	}
	const publishable = sortWorkspacePackages([...publishableByName.values()]);
	const changedNames = publishable
		.filter((pkg) => {
			const remoteMain = runRepositoryGit(['rev-parse', '--verify', 'origin/main'], {
				cwd: pkg.dir,
				mode: 'read',
				allowFailure: true,
			});
			const baseRef = remoteMain.status === 0 ? 'origin/main' : 'main';
			const diff = runRepositoryGit(['diff', '--quiet', baseRef, 'HEAD'], {
				cwd: pkg.dir,
				mode: 'read',
				allowFailure: true,
			});
			return diff.status !== 0 || gitStatusPorcelain(pkg.dir).length > 0;
		})
		.map((pkg) => pkg.name);
	const selectedNames = new Set(changedNames);
	const reverseDependencies = new Map(publishable.map((pkg) => [pkg.name, new Set<string>()]));
	const packageNames = new Set(publishable.map((pkg) => pkg.name));
	for (const pkg of publishable) {
		for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
			const dependencies = pkg.packageJson?.[field];
			if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
			for (const dependency of Object.keys(dependencies)) {
				if (packageNames.has(dependency)) reverseDependencies.get(dependency)?.add(pkg.name);
			}
		}
	}
	const queue = [...changedNames];
	while (queue.length > 0) {
		const dependency = queue.shift()!;
		for (const dependent of reverseDependencies.get(dependency) ?? []) {
			if (selectedNames.has(dependent)) continue;
			selectedNames.add(dependent);
			queue.push(dependent);
		}
	}
	const selected = publishable.filter((pkg) => selectedNames.has(pkg.name));
	return {
		changed: changedNames,
		dependents: selected.filter((pkg) => !changedNames.includes(pkg.name)).map((pkg) => pkg.name),
		selected: selected.map((pkg) => pkg.name),
	};
}

export function resolveWorkflowSession(cwd: string): WorkflowSession {
	const resolved = resolveWorkflowPaths(cwd);
	const root = workspaceRoot(resolved.cwd);
	const gitRoot = repoRoot(root);
	const mode = workflowModeForRoot(root);
	const packageRepos = checkedOutWorkspacePackageRepos(root).map((pkg) => repoState(root, pkg.name, pkg.dir));
	const managedRepos = checkedOutManagedWorkflowRepos(root).map((repo) => repoState(root, repo.name, repo.dir, repo.kind));
	return {
		root,
		gitRoot,
		mode,
		branchName: currentBranch(gitRoot) || null,
		branchRole: classifyBranchRole(currentBranch(gitRoot) || null, gitRoot),
		rootRepo: repoState(root, '@treeseed/market', gitRoot, 'root'),
		managedRepos,
		packageRepos,
		packageSelection: collectReleasePackageSelection(root),
	};
}
