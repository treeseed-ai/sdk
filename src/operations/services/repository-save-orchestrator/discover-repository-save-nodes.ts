import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../git-runner.ts';
import {
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
	type GitRemoteWriteMode,
} from '../git-remote-policy.ts';
import {
	generateRepositoryCommitMessage,
	type CommitMessageDependencyUpdate,
	type CommitMessageContext,
	type CommitMessagePackageChange,
	type CommitMessageProvider,
	type CommitMessageProviderMode,
	type CommitMessageSubmodulePointer,
} from '../commit-message-provider.ts';
import {
	createPackageDependencyReference,
	type DevDependencyReferenceMode,
	type GitDependencyProtocol,
	normalizeGitRemoteForDependency,
	type PackageDependencyReference,
	type RewrittenDevReference,
	updateInternalDependencySpecs,
} from '../package-reference-policy.ts';
import {
	PRODUCTION_BRANCH,
	branchExists,
	checkoutBranch,
	headCommit,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
} from '../git-workflow.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	repoRoot,
} from '../workspace-save.ts';
import {
	hasCompleteTreeseedPackageCheckout,
	run,
	sortWorkspacePackages,
	workspacePackages,
} from '../workspace-tools.ts';
import { collectDeploymentLockfileWorkspaceIssues, ensureLocalWorkspaceLinks } from '../workspace-dependency-mode.ts';
import {
	createBuildWarningSummary,
	formatAllowedBuildWarnings,
	type BuildWarningPolicyOptions,
} from '../build-warning-policy.js';
import {
	readTreeseedVerificationCache,
	writeTreeseedVerificationCache,
} from '../verification-cache.ts';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageCommand,
} from '../package-adapters.ts';
import {
	discoverTreeseedManagedRepositories,
	parseGitmodulesPaths,
	readTreeseedTemplateRepositoryManifest,
	type TreeseedManagedRepositoryKind,
} from '../managed-repositories.ts';
import { RepoBranchMode, RepositoryCommitMessageContext, RepositorySaveError, RepositorySaveNode, RepositorySaveOptions, emitProgress, readJson, runGit } from './repo-kind.ts';
import { classifyRepoKind, dependencyFields, emptyManifestVerifyCommands, isIndependentGitRepo, originRemoteUrlSafe, parseGitmodules, repoDisplayName, repoIdForPath, templateVerifyCommands } from './classify-repo-kind.ts';
import { packageScripts, runCapturedCommand } from './with-short-process-temp-env.ts';

export function discoverRepositorySaveNodes(
	root: string,
	gitRoot = repoRoot(root),
	branch = currentBranch(gitRoot),
	options: { stablePackageRelease?: boolean } = {},
): RepositorySaveNode[] {
	const repoDirs = new Map<string, string>();
	const packageAdaptersByDir = new Map(discoverTreeseedPackageAdapters(root).map((adapter) => [resolve(adapter.dir), adapter]));
	const managedRepositoriesByDir = new Map(discoverTreeseedManagedRepositories(root).map((repo) => [resolve(repo.dir), repo]));
	for (const repo of managedRepositoriesByDir.values()) {
		repoDirs.set(repo.relativeDir, repo.dir);
	}
	if (!repoDirs.has('.')) {
		repoDirs.set('.', gitRoot);
	}

	if (hasCompleteTreeseedPackageCheckout(root)) {
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

	const nodes = [...repoDirs.entries()].map(([relativePath, repoDir]) => {
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
		return {
			id: relativePath,
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
			dependents: [],
			submoduleDependencies: [],
			plannedVersion: null,
			plannedTag: null,
			plannedDependencySpec: null,
		} satisfies RepositorySaveNode;
	});

	return deriveRepositoryGraph(root, nodes);
}

export function deriveRepositoryGraph(root: string, nodes: RepositorySaveNode[]) {
	const byPackageName = new Map(nodes
		.filter((node) => node.kind === 'package')
		.map((node) => [String(node.packageJson?.name), node]));
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const dependencies = new Map(nodes.map((node) => [node.id, new Set<string>()]));
	const dependents = new Map(nodes.map((node) => [node.id, new Set<string>()]));

	for (const node of nodes) {
		for (const field of dependencyFields(node.packageJson)) {
			const values = node.packageJson?.[field] as Record<string, unknown>;
			for (const depName of Object.keys(values)) {
				const dependency = byPackageName.get(depName);
				if (!dependency || dependency.id === node.id) continue;
				dependencies.get(node.id)?.add(dependency.id);
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
		}
	}

	return nodes.map((node) => ({
		...node,
		dependencies: [...(dependencies.get(node.id) ?? [])].sort(),
		dependents: [...(dependents.get(node.id) ?? [])].sort(),
		submoduleDependencies: [...(dependencies.get(node.id) ?? [])]
			.filter((id) => node.id === '.' || id.startsWith(`${node.id}/`))
			.sort(),
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
	try {
		runGit(['rev-parse', '--verify', `refs/remotes/origin/${branch}`], { cwd: repoDir, capture: true });
		return true;
	} catch {
		// Fall through to live remote discovery below.
	}
	try {
		return remoteBranchExists(repoDir, branch);
	} catch {
		return false;
	}
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
