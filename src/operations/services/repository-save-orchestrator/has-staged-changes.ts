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
import { RepositorySaveNode, RepositorySaveOptions, emitProgress, readJson, runGit, writeJson } from './repo-kind.ts';
import { runCapturedCommand } from './with-short-process-temp-env.ts';
import { nextDevVersion } from './classify-repo-kind.ts';

export function hasStagedChanges(repoDir: string) {
	try {
		return runGit(['diff', '--cached', '--name-only'], { cwd: repoDir, capture: true }).trim().length > 0;
	} catch {
		return false;
	}
}

export function updateDependencyReferences(node: RepositorySaveNode, finalizedReferences: Map<string, PackageDependencyReference>) {
	if (!node.packageJson || !node.packageJsonPath) return [];
	const changed = updateInternalDependencySpecs(node.packageJson, finalizedReferences);
	if (changed.length > 0) {
		writeJson(node.packageJsonPath, node.packageJson);
	}
	return changed;
}

export function isRootWorkspaceRepository(node: RepositorySaveNode, options: Pick<RepositorySaveOptions, 'root'>) {
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	return node.path === options.root && Array.isArray(packageJson?.workspaces);
}

export function syncDirectGitDependencyLockfileEntries(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	references: PackageDependencyReference[],
) {
	if (references.length === 0) return false;
	const lockfilePath = resolve(node.path, 'package-lock.json');
	if (!existsSync(lockfilePath)) return false;
	const lockfile = readJson(lockfilePath);
	const rootPackage = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
		? (lockfile.packages as Record<string, Record<string, unknown>>)['']
		: null;
	const packageEntries = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
		? lockfile.packages as Record<string, Record<string, unknown>>
		: null;
	if (!rootPackage || !packageEntries) return false;
	let changed = false;
	for (const reference of references) {
		const manifestSpec = reference.manifestSpec ?? reference.spec;
		const declaredSpec = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
			.map((field) => node.packageJson?.[field])
			.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
			.map((dependencies) => dependencies[reference.packageName])
			.find((value): value is string => typeof value === 'string');
		if (declaredSpec !== manifestSpec) continue;
		const visitDependencyMaps = (value: unknown) => {
			if (!value || typeof value !== 'object') return;
			if (Array.isArray(value)) {
				for (const item of value) visitDependencyMaps(item);
				return;
			}
			const record = value as Record<string, unknown>;
			for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
				const dependencies = record[field];
				if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
				const dependencyMap = dependencies as Record<string, unknown>;
				const current = dependencyMap[reference.packageName];
				if (typeof current === 'string' && current !== manifestSpec) {
					dependencyMap[reference.packageName] = manifestSpec;
					changed = true;
				}
			}
			for (const nested of Object.values(record)) visitDependencyMaps(nested);
		};
		visitDependencyMaps(lockfile);
		for (const [entryKey, entry] of Object.entries(packageEntries)) {
			if (entryKey !== `node_modules/${reference.packageName}` && !entryKey.endsWith(`/node_modules/${reference.packageName}`)) continue;
			const nextResolved = normalizeGitRemoteForDependency(reference.remoteUrl ?? '', 'ssh');
			const resolved = nextResolved ? `${nextResolved}#${manifestSpec.slice(manifestSpec.lastIndexOf('#') + 1)}` : manifestSpec;
			if (entry.resolved !== resolved) {
				entry.resolved = resolved;
				changed = true;
			}
			if (typeof reference.version === 'string' && reference.version && entry.version !== reference.version) {
				entry.version = reference.version;
				changed = true;
			}
			if ('integrity' in entry) {
				delete entry.integrity;
				changed = true;
			}
		}
	}
	if (!changed) return false;
	writeJson(lockfilePath, lockfile);
	emitProgress(options, node, 'lockfile', 'Synchronized direct internal Git dependency lockfile entries without npm git preparation.');
	return true;
}

export function validateStandaloneGitDependencyLockfile(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
) {
	const lockfilePath = resolve(node.path, 'package-lock.json');
	const lockfileExists = existsSync(lockfilePath);
	const previousLockfile = lockfileExists ? readFileSync(lockfilePath, 'utf8') : null;
	const isolatedRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-lockfile-'));
	const validateArgs = [
		'ci',
		'--package-lock-only',
		'--ignore-scripts',
		'--workspaces=false',
		'--no-audit',
		'--no-fund',
	];
	try {
		if (!lockfileExists) throw new Error('standalone lockfile missing');
		copyFileSync(resolve(node.path, 'package.json'), resolve(isolatedRoot, 'package.json'));
		copyFileSync(lockfilePath, resolve(isolatedRoot, 'package-lock.json'));
		runCapturedCommand(node, options, 'lockfile', 'npm', validateArgs, {
			cwd: isolatedRoot,
			timeoutMs: 5 * 60_000,
		});
	} catch (validationError) {
		try {
			rmSync(isolatedRoot, { recursive: true, force: true });
			mkdirSync(isolatedRoot, { recursive: true });
			copyFileSync(resolve(node.path, 'package.json'), resolve(isolatedRoot, 'package.json'));
			runCapturedCommand(node, options, 'lockfile', 'npm', [
				'install',
				'--package-lock-only',
				'--ignore-scripts',
				'--workspaces=false',
				'--no-audit',
				'--no-fund',
			], {
				cwd: isolatedRoot,
				timeoutMs: 15 * 60_000,
			});
			runCapturedCommand(node, options, 'lockfile', 'npm', validateArgs, {
				cwd: isolatedRoot,
				timeoutMs: 5 * 60_000,
			});
			copyFileSync(resolve(isolatedRoot, 'package-lock.json'), lockfilePath);
		} catch (regenerationError) {
			if (previousLockfile !== null) writeFileSync(lockfilePath, previousLockfile, 'utf8');
			throw regenerationError instanceof Error ? regenerationError : validationError;
		}
	} finally {
		rmSync(isolatedRoot, { recursive: true, force: true });
	}
	emitProgress(options, node, 'lockfile', 'Validated the standalone lockfile against the committed package manifest.');
	return true;
}

export function planPackageVersion(node: RepositorySaveNode, options: RepositorySaveOptions) {
	if (!node.packageJson || !node.packageJsonPath) return null;
	const current = String(node.packageJson.version ?? '0.0.0');
	return node.branchMode === 'package-release-main'
		? incrementVersion(current, options.bump ?? 'patch')
		: nextDevVersion(current, options.branch);
}

export function applyPackageVersion(node: RepositorySaveNode, version: string) {
	if (!node.packageJson || !node.packageJsonPath) return false;
	let changed = false;
	if (node.packageJson.version !== version) {
		node.packageJson.version = version;
		writeJson(node.packageJsonPath, node.packageJson);
		changed = true;
	}
	const lockfilePath = resolve(node.path, 'package-lock.json');
	if (existsSync(lockfilePath)) {
		const lockfile = readJson(lockfilePath);
		const rootEntry = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
			? (lockfile.packages as Record<string, Record<string, unknown>>)['']
			: null;
		const lockfileMatches = lockfile.version === version
			&& rootEntry?.version === version
			&& (typeof node.packageJson.name !== 'string' || rootEntry?.name === node.packageJson.name);
		if (lockfileMatches) return changed;
		lockfile.version = version;
		const packages = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
			? lockfile.packages as Record<string, Record<string, unknown>>
			: {};
		packages[''] = {
			...(packages[''] ?? {}),
			...(typeof node.packageJson.name === 'string' ? { name: node.packageJson.name } : {}),
			version,
		};
		lockfile.packages = packages;
		writeJson(lockfilePath, lockfile);
		changed = true;
	}
	return changed;
}

export function shouldSkipNetworkInstall() {
	return process.env.TREESEED_SAVE_NPM_INSTALL_MODE !== 'allow';
}

export function shouldSkipGitDependencySmoke(options?: Pick<RepositorySaveOptions, 'verifyMode'>) {
	return shouldSkipNetworkInstall()
		|| process.env.TREESEED_GIT_DEPENDENCY_SMOKE === 'skip'
		|| options?.verifyMode === 'skip';
}

export function hasNpmLockfile(repoDir: string) {
	return existsSync(resolve(repoDir, 'package-lock.json')) || existsSync(resolve(repoDir, 'npm-shrinkwrap.json'));
}
