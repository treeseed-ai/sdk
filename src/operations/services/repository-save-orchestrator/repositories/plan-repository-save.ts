import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
PRODUCTION_BRANCH,
STAGING_BRANCH
} from '../../operations/git-workflow.ts';
import {
createPackageDependencyReference,
type PackageDependencyReference
} from '../../packages/package-reference-policy.ts';
import {
currentBranch,
hasMeaningfulChanges
} from '../../treedx/workspaces/workspace-save.ts';
import { branchModeLabel,repoPlanCommands } from '../packages/finalize-clean-package-version.ts';
import { packageScripts } from '../runtime/with-short-process-temp-env.ts';
import { canManagePackageJsonVersion,emptyManifestVerifyCommands,headCommitOrPlanPlaceholder,originRemoteUrlSafe,repoDisplayName,selectPackageVersion } from '../support/classify-repo-kind.ts';
import { hasNpmLockfile } from '../support/has-staged-changes.ts';
import { RepositoryInstallResult,RepositoryLockfileValidationResult,RepositorySaveError,RepositorySaveNode,RepositorySaveOptions,RepositorySavePlan,RepositorySavePlanRepo,readJson } from '../support/repo-kind.ts';
import { runNpmInstallWithRetry,validateRepositoryLockfile } from '../treedx/repositories/sync-root-workspace-lockfile-metadata.ts';
import { compareNodes,discoverRepositorySaveNodes,repositorySaveWaves } from './discover-repository-save-nodes.ts';

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
			const dependencyUpdates = (node.referenceDependencies ?? node.dependencies)
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
			const contentOnly = node.changeKind === 'content' && !dependencyChanged && !submoduleChanged;
			if (!contentOnly && node.changeKind === 'content') node.changeKind = 'mixed';
			const packageNeedsVersion = canManagePackageJsonVersion(node) && ((!contentOnly && dirty) || dependencyChanged || submoduleChanged);
			const currentVersion = typeof node.packageJson?.version === 'string' ? node.packageJson.version : null;
			const plannedVersion = packageNeedsVersion ? selectPackageVersion(node, options).version : null;
			let plannedDependencySpec: string | null = null;
			if (node.kind === 'package' && plannedVersion) {
				const reference = createPackageDependencyReference({
					packageName: node.name,
					sourcePath: node.path,
					version: plannedVersion,
					branchMode: node.branchMode === 'package-release-main' ? 'package-release-main' : 'package-dev-save',
					remoteUrl: node.remoteUrl,
					commitSha: headCommitOrPlanPlaceholder(node.path),
					devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-commit',
					gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
					sourcePath: node.path,
				});
				plannedDependencySpec = reference.spec;
				plannedVersions.set(node.name, plannedVersion);
				plannedReferences.set(node.name, reference);
			}
			const current = currentBranch(node.path) || null;
			const branch = node.branch || options.branch;
			const notes = [
				`${branchModeLabel(node.branchMode)} on top-level ${options.branch}`,
				...(node.checkoutAliases.length > 1 ? [`canonical repository target for ${node.checkoutAliases.join(', ')}`] : []),
				...(current && current !== branch ? [`current branch ${current} will be switched to ${branch}`] : []),
				...(node.kind === 'package' && plannedVersion?.includes('-dev.')
					? ['development and staging dependency refs use the package commit SHA; no Git tag is created']
					: []),
				...(contentOnly ? [`content-only change under ${node.contentPath}; publish through the content pipeline without code verification or package versioning`] : []),
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
		checkoutAliases: ['.'],
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
