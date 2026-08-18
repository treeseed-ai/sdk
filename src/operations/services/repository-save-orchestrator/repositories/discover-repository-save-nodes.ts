import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
generateRepositoryCommitMessage
} from '../../capacity/providers/commit-message-provider.ts';
import {
PRODUCTION_BRANCH,
branchExists,
headCommit,
remoteBranchExists
} from '../../operations/git-workflow.ts';
import { repositoryIdentityKey } from '../../../../repositories/repository-identity.ts';
import {
discoverPackageAdapters
} from '../../reconciliation/package-adapters.ts';
import {
discoverManagedRepositories
} from '../../support/managed-repositories.ts';
import {
currentBranch,
repoRoot
} from '../../treedx/workspaces/workspace-save.ts';
import {
hasCompletePackageCheckout,
sortWorkspacePackages,
workspacePackages
} from '../../treedx/workspaces/workspace-tools.ts';
import { packageScripts,runCapturedCommand } from '../runtime/with-short-process-temp-env.ts';
import { classifyRepoKind,dependencyFields,emptyManifestVerifyCommands,isIndependentGitRepo,originRemoteUrlSafe,parseGitmodules,repoDisplayName,repoIdForPath,templateVerifyCommands } from '../support/classify-repo-kind.ts';
import { RepoBranchMode,RepositoryCommitMessageContext,RepositorySaveError,RepositorySaveNode,RepositorySaveOptions,emitProgress,readJson,runGit } from '../support/repo-kind.ts';
import { classifyRepositoryChanges,contentPathForRepository,repositoryChangedPaths } from '../support/change-classification.ts';
import { recoverableAliasRepresentative,repositoryWorktreeFingerprint } from './repository-alias-state.ts';

export function discoverRepositorySaveNodes(
	root: string,
	gitRoot = repoRoot(root),
	branch = currentBranch(gitRoot),
	options: { stablePackageRelease?: boolean } = {},
): RepositorySaveNode[] {
	const repoDirs = new Map<string, string>();
	const packageAdaptersByDir = new Map(discoverPackageAdapters(root).map((adapter) => [resolve(adapter.dir), adapter]));
	const managedRepositoriesByDir = new Map(discoverManagedRepositories(root).map((repo) => [resolve(repo.dir), repo]));
	for (const repo of managedRepositoriesByDir.values()) {
		repoDirs.set(repo.relativeDir, repo.dir);
	}
	if (!repoDirs.has('.')) {
		repoDirs.set('.', gitRoot);
	}

	if (hasCompletePackageCheckout(root)) {
		for (const pkg of workspacePackages(root)) {
			if (isIndependentGitRepo(pkg.dir)) {
				repoDirs.set(pkg.relativeDir, pkg.dir);
			}
		}
	}
	for (const adapter of packageAdaptersByDir.values()) {
		if (isIndependentGitRepo(adapter.dir)) {
			repoDirs.set(adapter.relativeDir, adapter.dir);
		}
	}

	for (const submodulePath of parseGitmodules(root)) {
		const dir = resolve(root, submodulePath);
		if (existsSync(dir) && isIndependentGitRepo(dir)) {
			repoDirs.set(submodulePath, dir);
		}
	}

	const discoveredNodes = [...repoDirs.entries()].map(([relativePath, repoDir]) => {
		const packageJsonPath = resolve(repoDir, 'package.json');
		const packageJson = existsSync(packageJsonPath) ? readJson(packageJsonPath) : null;
		const adapter = packageAdaptersByDir.get(resolve(repoDir)) ?? null;
		const managed = managedRepositoriesByDir.get(resolve(repoDir)) ?? null;
		const kind = adapter && !packageJson ? 'package' : classifyRepoKind(packageJson, managed?.kind);
		const repoBranch = relativePath === '.'
			? (currentBranch(repoDir) || branch || null)
			: (branch || currentBranch(repoDir) || null);
		const branchMode: RepoBranchMode = kind === 'project'
			? 'project-save'
			: options.stablePackageRelease === true && repoBranch === PRODUCTION_BRANCH
				? 'package-release-main'
				: 'package-dev-save';
		const contentPath = contentPathForRepository({ adapter, relativePath, repoDir });
		const changeKind = classifyRepositoryChanges(repositoryChangedPaths(repoDir), contentPath);
		return {
			id: relativePath,
			checkoutAliases: [relativePath],
			name: managed?.kind === 'template' || managed?.kind === 'fixture'
				? managed.name
				: adapter?.id ?? repoDisplayName(repoDir, packageJson),
			path: repoDir,
			relativePath,
			kind,
			branch: repoBranch,
			branchMode,
			packageJsonPath: packageJson ? packageJsonPath : null,
			packageJson,
			scripts: packageScripts(packageJson),
			manifestVerifyCommands: adapter?.verifyCommands
				?? templateVerifyCommands(repoDir)
				?? emptyManifestVerifyCommands(),
			remoteUrl: originRemoteUrlSafe(repoDir),
			dependencies: [],
			referenceDependencies: [],
			workflowDependencies: Array.isArray(adapter?.metadata.workflowDependencies)
				? adapter.metadata.workflowDependencies.filter((value): value is string => typeof value === 'string' && Boolean(value.trim()))
				: [],
			dependents: [],
			submoduleDependencies: [],
			plannedVersion: null,
			plannedTag: null,
			plannedDependencySpec: null,
			contentPath,
			changeKind,
		} satisfies RepositorySaveNode;
	});
	const nodes = deduplicateRepositorySaveNodes(discoveredNodes);

	return deriveRepositoryGraph(root, nodes);
}

function deduplicateRepositorySaveNodes(nodes: RepositorySaveNode[]) {
	const groups = new Map<string, RepositorySaveNode[]>();
	for (const node of nodes) {
		const identityKey = repositoryIdentityKey(node.remoteUrl);
		const key = node.id === '.' || !identityKey
			? `checkout:${node.id}`
			: `repository:${identityKey}`;
		groups.set(key, [...(groups.get(key) ?? []), node]);
	}
	return [...groups.values()].map((group) => {
		if (group.length === 1) return group[0]!;
		const heads = new Set(group.map((node) => headCommit(node.path)));
		if (heads.size !== 1) {
			const representative = recoverableAliasRepresentative(group);
			if (!representative) {
				throw new RepositorySaveError(`Repository aliases do not resolve to one exact revision or identical worktree state: ${group.map((node) => node.relativePath).join(', ')}.`, {
					details: { aliases: group.map((node) => ({ path: node.relativePath, head: headCommit(node.path), remoteUrl: node.remoteUrl })) },
				});
			}
			return {
				...representative,
				checkoutAliases: group.map((node) => node.relativePath).sort(),
			};
		}
		const dirty = group.filter((node) => repositoryChangedPaths(node.path).length > 0);
		if (dirty.length > 1 && new Set(dirty.map((node) => repositoryWorktreeFingerprint(node.path))).size !== 1) {
			throw new RepositorySaveError(`Repository aliases contain changes in more than one checkout: ${dirty.map((node) => node.relativePath).join(', ')}.`, {
				details: { aliases: group.map((node) => ({ path: node.relativePath, dirty: repositoryChangedPaths(node.path).length > 0, remoteUrl: node.remoteUrl })) },
			});
		}
		const representative = dirty[0] ?? [...group].sort((left, right) => left.relativePath.localeCompare(right.relativePath))[0]!;
		return {
			...representative,
			checkoutAliases: group.map((node) => node.relativePath).sort(),
		};
	});
}

export function deriveRepositoryGraph(root: string, nodes: RepositorySaveNode[]) {
	const byPackageName = new Map(nodes
		.filter((node) => node.kind === 'package')
		.map((node) => [String(node.packageJson?.name), node]));
	const byId = new Map(nodes.flatMap((node) => node.checkoutAliases.map((id) => [id, node] as const)));
	const byNameOrId = new Map(nodes.flatMap((node) => [[node.name, node], [node.id, node]] as const));
	const dependencies = new Map(nodes.map((node) => [node.id, new Set<string>()]));
	const referenceDependencies = new Map(nodes.map((node) => [node.id, new Set<string>()]));
	const dependents = new Map(nodes.map((node) => [node.id, new Set<string>()]));
	const submoduleDependencies = new Map(nodes.map((node) => [node.id, new Set<string>()]));

	for (const node of nodes) {
		for (const dependencyName of node.workflowDependencies ?? []) {
			const dependency = byNameOrId.get(dependencyName);
			if (!dependency || dependency.id === node.id) continue;
			dependencies.get(node.id)?.add(dependency.id);
			dependents.get(dependency.id)?.add(node.id);
		}
		for (const field of dependencyFields(node.packageJson)) {
			const values = node.packageJson?.[field] as Record<string, unknown>;
			for (const depName of Object.keys(values)) {
				const dependency = byPackageName.get(depName);
				if (!dependency || dependency.id === node.id) continue;
				dependencies.get(node.id)?.add(dependency.id);
				referenceDependencies.get(node.id)?.add(dependency.id);
				dependents.get(dependency.id)?.add(node.id);
			}
		}

		for (const submodulePath of parseGitmodules(node.path)) {
			const absolute = resolve(node.path, submodulePath);
			const relativeToRoot = repoIdForPath(root, absolute);
			const dependency = byId.get(relativeToRoot);
			if (!dependency || dependency.id === node.id) continue;
			dependencies.get(node.id)?.add(dependency.id);
			dependents.get(dependency.id)?.add(node.id);
			submoduleDependencies.get(node.id)?.add(dependency.id);
		}
	}

	return nodes.map((node) => ({
		...node,
		dependencies: [...(dependencies.get(node.id) ?? [])].sort(),
		referenceDependencies: [...(referenceDependencies.get(node.id) ?? [])].sort(),
		dependents: [...(dependents.get(node.id) ?? [])].sort(),
		submoduleDependencies: [...(submoduleDependencies.get(node.id) ?? [])].sort(),
	}));
}

export function repositorySaveWaves(nodes: RepositorySaveNode[]) {
	const nodeIds = new Set(nodes.map((node) => node.id));
	const dependencies = new Map(nodes.map((node) => [node.id, new Set(node.dependencies.filter((id) => nodeIds.has(id)))]));
	const dependents = new Map(nodes.map((node) => [node.id, new Set(node.dependents.filter((id) => nodeIds.has(id)))]));
	const ready = [...nodes]
		.filter((node) => (dependencies.get(node.id)?.size ?? 0) === 0)
		.sort(compareNodes);
	const waves: RepositorySaveNode[][] = [];
	const processed = new Set<string>();

	while (ready.length > 0) {
		const wave = ready.splice(0).filter((node) => !processed.has(node.id));
		if (wave.length === 0) continue;
		waves.push(wave);
		for (const node of wave) {
			processed.add(node.id);
			for (const dependentId of dependents.get(node.id) ?? []) {
				const remaining = dependencies.get(dependentId);
				remaining?.delete(node.id);
				if (remaining && remaining.size === 0 && !processed.has(dependentId)) {
					const dependent = nodes.find((candidate) => candidate.id === dependentId);
					if (dependent) ready.push(dependent);
				}
			}
		}
		ready.sort(compareNodes);
	}

	if (processed.size !== nodes.length) {
		const unresolved = nodes
			.filter((node) => !processed.has(node.id))
			.map((node) => `${node.name} depends on ${(dependencies.get(node.id) ? [...dependencies.get(node.id)!] : []).join(', ')}`);
		throw new RepositorySaveError(`Repository dependency cycle detected:\n${unresolved.join('\n')}`, {
			details: { unresolved },
		});
	}

	return waves;
}

export function selectRepositorySaveNodes(nodes: RepositorySaveNode[], selectedRepositoryPath?: string | null) {
	if (!selectedRepositoryPath) return nodes;
	const selected = nodes.find((node) => resolve(node.path) === resolve(selectedRepositoryPath));
	if (!selected) {
		throw new RepositorySaveError(`Selected repository is not part of the managed workspace: ${selectedRepositoryPath}.`, {
			details: { selectedRepositoryPath, managedRepositories: nodes.map((node) => node.path) },
		});
	}
	return [selected];
}

export function compareNodes(left: RepositorySaveNode, right: RepositorySaveNode) {
	if (left.id === '.') return 1;
	if (right.id === '.') return -1;
	const sorted = sortWorkspacePackages([
		{ name: left.name, relativeDir: left.relativePath, dir: left.path, packageJson: left.packageJson ?? {} },
		{ name: right.name, relativeDir: right.relativePath, dir: right.path, packageJson: right.packageJson ?? {} },
	]);
	return sorted[0]?.name === left.name ? -1 : 1;
}

export function runLimited<T>(items: T[], limit: number, action: (item: T) => Promise<void>) {
	let index = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (index < items.length) {
			const current = items[index++];
			await action(current);
		}
	});
	return Promise.all(workers);
}

export function repositorySaveConcurrency(options: Pick<RepositorySaveOptions, 'verifyMode'>) {
	if (options.verifyMode && options.verifyMode !== 'skip') {
		return 1;
	}
	const configured = Number.parseInt(process.env.TREESEED_SAVE_REPOSITORY_CONCURRENCY ?? '', 10);
	return Number.isFinite(configured) && configured > 0 ? configured : 3;
}

export function remoteBranchExistsSafe(repoDir: string, branch: string) {
	// A checkout can retain refs/remotes/origin/* after its canonical origin is
	// migrated to another repository. Those refs describe the previous remote,
	// so only a fresh observation of the current origin can establish that the
	// branch exists.
	return remoteBranchExists(repoDir, branch);
}

export function checkoutCommandFor(repoDir: string, branch: string) {
	if (currentBranch(repoDir) === branch) return `git checkout ${branch} # already current`;
	if (branchExists(repoDir, branch)) return `git checkout ${branch}`;
	if (remoteBranchExistsSafe(repoDir, branch)) return `git checkout -b ${branch} origin/${branch}`;
	return `git checkout -b ${branch}`;
}

export function checkoutOrCreateBranch(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string) {
	if (currentBranch(node.path) === branch) {
		emitProgress(options, node, 'branch', `Already on ${branch}.`);
		return;
	}
	if (branchExists(node.path, branch)) {
		runCapturedCommand(node, options, 'branch', 'git', ['checkout', branch]);
		return;
	}
	if (remoteBranchExistsSafe(node.path, branch)) {
		runCapturedCommand(node, options, 'branch', 'git', ['checkout', '-b', branch, `origin/${branch}`]);
		return;
	}
	runCapturedCommand(node, options, 'branch', 'git', ['checkout', '-b', branch]);
}

export async function commitMessageFor(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	context: Pick<
		RepositoryCommitMessageContext,
		'changedFiles'
		| 'diff'
		| 'plannedVersion'
		| 'plannedTag'
		| 'dependencyUpdates'
		| 'submodulePointers'
		| 'packageChanges'
	>,
) {
	return generateRepositoryCommitMessage({
		repoName: node.name,
		repoPath: node.path,
		branch: node.branch || options.branch,
		kind: node.kind,
		branchMode: node.branchMode,
		userMessage: options.message?.trim() || undefined,
		...context,
	}, {
		mode: options.commitMessageMode ?? 'auto',
		provider: options.commitMessageProvider,
	});
}

export function commitSubject(message: string | null | undefined) {
	return String(message ?? '').split(/\r?\n/u)[0]?.trim() || null;
}

export function gitDiffSummary(repoDir: string) {
	const changedFiles = runGit(['status', '--porcelain'], { cwd: repoDir, capture: true });
	const rawDiff = runGit(['diff', '--cached'], { cwd: repoDir, capture: true, maxBuffer: 1024 * 1024 * 32 });
	const maxDiffChars = 120_000;
	const diff = rawDiff.length > maxDiffChars
		? `${rawDiff.slice(0, maxDiffChars)}\n\n[treeseed-save: diff truncated from ${rawDiff.length} characters for commit-message generation]\n`
		: rawDiff;
	return { changedFiles, diff };
}
