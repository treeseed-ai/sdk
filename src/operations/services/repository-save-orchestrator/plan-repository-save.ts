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
import { RepositoryInstallResult, RepositoryLockfileValidationResult, RepositorySaveError, RepositorySaveNode, RepositorySaveOptions, RepositorySavePlan, RepositorySavePlanRepo, readJson } from './repo-kind.ts';
import { compareNodes, discoverRepositorySaveNodes, repositorySaveWaves } from './discover-repository-save-nodes.ts';
import { canManagePackageJsonVersion, emptyManifestVerifyCommands, headCommitOrPlanPlaceholder, originRemoteUrlSafe, repoDisplayName, selectPackageVersion } from './classify-repo-kind.ts';
import { branchModeLabel, repoPlanCommands } from './finalize-clean-package-version.ts';
import { packageScripts } from './with-short-process-temp-env.ts';
import { hasNpmLockfile } from './has-staged-changes.ts';
import { runNpmInstallWithRetry, validateRepositoryLockfile } from './sync-root-workspace-lockfile-metadata.ts';

export function planRepositorySave(options: RepositorySaveOptions): RepositorySavePlan {
	const scope = options.branch === STAGING_BRANCH ? 'staging' : options.branch === PRODUCTION_BRANCH ? 'prod' : 'local';
	const allNodes = discoverRepositorySaveNodes(options.root, options.gitRoot, options.branch, {
		stablePackageRelease: options.stablePackageRelease === true,
	});
	const nodes = options.includeRoot === false ? allNodes.filter((node) => node.id !== '.') : allNodes;
	const mode = nodes.some((node) => node.id !== '.') ? 'recursive-workspace' : 'root-only';
	const waves = repositorySaveWaves(nodes);
	const plannedVersions = new Map<string, string>();
	const plannedReferences = new Map<string, PackageDependencyReference>();
	const plans = new Map<string, RepositorySavePlanRepo>();

	for (const wave of waves) {
		for (const node of wave) {
			const dependencyUpdates = node.dependencies
				.map((id) => nodes.find((candidate) => candidate.id === id))
				.filter((candidate): candidate is RepositorySaveNode => Boolean(candidate))
				.map((dependency) => {
					const reference = plannedReferences.get(dependency.name);
					return reference ? `${dependency.name} -> ${reference.spec}` : null;
				})
				.filter((value): value is string => Boolean(value));
			const dependencyChanged = dependencyUpdates.length > 0;
			const submoduleChanged = node.submoduleDependencies.length > 0 && node.submoduleDependencies.some((id) => {
				const dependency = plans.get(id);
				return dependency?.dirty || Boolean(dependency?.plannedVersion);
			});
			const dirty = hasMeaningfulChanges(node.path);
			const packageNeedsVersion = canManagePackageJsonVersion(node) && (dirty || dependencyChanged || submoduleChanged);
			const currentVersion = typeof node.packageJson?.version === 'string' ? node.packageJson.version : null;
			const plannedVersion = packageNeedsVersion ? selectPackageVersion(node, options).version : null;
			let plannedDependencySpec: string | null = null;
			if (node.kind === 'package' && plannedVersion) {
				const reference = createPackageDependencyReference({
					packageName: node.name,
					version: plannedVersion,
					branchMode: node.branchMode === 'package-release-main' ? 'package-release-main' : 'package-dev-save',
					remoteUrl: node.remoteUrl,
					commitSha: headCommitOrPlanPlaceholder(node.path),
					devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-commit',
					gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
				});
				plannedDependencySpec = reference.spec;
				plannedVersions.set(node.name, plannedVersion);
				plannedReferences.set(node.name, reference);
			}
			const current = currentBranch(node.path) || null;
			const branch = node.branch || options.branch;
			const notes = [
				`${branchModeLabel(node.branchMode)} on top-level ${options.branch}`,
				...(current && current !== branch ? [`current branch ${current} will be switched to ${branch}`] : []),
				...(node.kind === 'package' && plannedVersion?.includes('-dev.')
					? ['development and staging dependency refs use the package commit SHA; no Git tag is created']
					: []),
			];
			const repoPlan: RepositorySavePlanRepo = {
				id: node.id,
				name: node.name,
				path: node.path,
				relativePath: node.relativePath,
				kind: node.kind,
				currentBranch: current,
				targetBranch: branch,
				branchMode: node.branchMode,
				dirty,
				dependencies: node.dependencies,
				dependents: node.dependents,
				submoduleDependencies: node.submoduleDependencies,
				currentVersion,
				plannedVersion,
				plannedTag: plannedReferences.get(node.name)?.tagName ?? null,
				plannedDependencySpec,
				remoteUrl: node.remoteUrl,
				commands: repoPlanCommands(node, options, plannedVersion, plannedDependencySpec, dependencyUpdates),
				notes,
			};
			plans.set(node.id, repoPlan);
		}
	}

	const rootNode = nodes.find((node) => node.id === '.') ?? allNodes.find((node) => node.id === '.');
	const rootRepo = rootNode ? plans.get(rootNode.id) : null;
	if (!rootRepo) {
		throw new RepositorySaveError('Unable to build repository save plan for root repository.');
	}
	const repoPlans = nodes
		.filter((node) => node.id !== '.')
		.sort(compareNodes)
		.map((node) => plans.get(node.id))
		.filter((plan): plan is RepositorySavePlanRepo => Boolean(plan));
	const wavePlans = waves.map((wave, index) => ({
		index: index + 1,
		parallel: wave.length > 1,
		repos: wave.map((node) => node.name),
		commands: wave.map((node) => ({
			repo: node.name,
			commands: plans.get(node.id)?.commands ?? [],
		})),
	}));
	return {
		mode,
		branch: options.branch,
		scope,
		devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-commit',
		gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
		verifyMode: options.verifyMode ?? 'action-first',
		commitMessageMode: options.commitMessageMode ?? 'auto',
		repos: repoPlans,
		rootRepo,
		waves: wavePlans,
		plannedVersions: Object.fromEntries(plannedVersions.entries()),
		plannedSteps: wavePlans.flatMap((wave) => wave.commands.map((entry) => ({
			id: `wave-${wave.index}-${entry.repo}`,
			description: `Wave ${wave.index}${wave.parallel ? ' parallel' : ''}: ${entry.repo}`,
		}))),
	};
}

export async function refreshAndValidateRootWorkspaceLockfileForSave(options: {
	root: string;
	gitRoot?: string;
	branch?: string | null;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
}): Promise<{ install: RepositoryInstallResult | null; lockfileValidation: RepositoryLockfileValidationResult | null }> {
	const repoDir = options.gitRoot ?? options.root;
	const packageJsonPath = resolve(repoDir, 'package.json');
	const packageJson = existsSync(packageJsonPath) ? readJson(packageJsonPath) : null;
	const node: RepositorySaveNode = {
		id: '.',
		name: repoDisplayName(repoDir, packageJson),
		path: repoDir,
		relativePath: '.',
		kind: 'project',
		branch: options.branch ?? currentBranch(repoDir) ?? null,
		branchMode: 'project-save',
		packageJsonPath: packageJson ? packageJsonPath : null,
		packageJson,
		scripts: packageScripts(packageJson),
		manifestVerifyCommands: emptyManifestVerifyCommands(),
		remoteUrl: originRemoteUrlSafe(repoDir),
		dependencies: [],
		dependents: [],
		submoduleDependencies: [],
		plannedVersion: null,
		plannedTag: null,
		plannedDependencySpec: null,
	};
	if (!hasNpmLockfile(repoDir)) {
		return {
			install: null,
			lockfileValidation: { status: 'skipped', command: null, issues: [], error: 'no npm lockfile' },
		};
	}
	const install = await runNpmInstallWithRetry(node, { root: options.root, onProgress: options.onProgress });
	const lockfileValidation = await validateRepositoryLockfile(node, { root: options.root, onProgress: options.onProgress });
	return { install, lockfileValidation };
}
