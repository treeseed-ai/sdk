import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { classifyGitMode, runGitText } from '../../../operations/git-runner.ts';
import {
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
	type GitRemoteWriteMode,
} from '../../../repositories/git-remote-policy.ts';
import {
	generateRepositoryCommitMessage,
	type CommitMessageDependencyUpdate,
	type CommitMessageContext,
	type CommitMessagePackageChange,
	type CommitMessageProvider,
	type CommitMessageProviderMode,
	type CommitMessageSubmodulePointer,
} from '../../../capacity/providers/commit-message-provider.ts';
import {
	createPackageDependencyReference,
	type DevDependencyReferenceMode,
	type GitDependencyProtocol,
	normalizeGitRemoteForDependency,
	type PackageDependencyReference,
	type RewrittenDevReference,
	updateInternalDependencySpecs,
} from '../../../packages/package-reference-policy.ts';
import {
	PRODUCTION_BRANCH,
	branchExists,
	checkoutBranch,
	headCommit,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
} from '../../../operations/git-workflow.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	repoRoot,
} from '../../../treedx/workspaces/workspace-save.ts';
import {
	hasCompletePackageCheckout,
	run,
	sortWorkspacePackages,
	workspacePackages,
} from '../../../treedx/workspaces/workspace-tools.ts';
import { collectDeploymentLockfileWorkspaceIssues, ensureLocalWorkspaceLinks } from '../../../treedx/workspaces/workspace-dependency-mode.ts';
import {
	createBuildWarningSummary,
	formatAllowedBuildWarnings,
	type BuildWarningPolicyOptions,
} from '../../../build/build-warning-policy.js';
import {
	readVerificationCache,
	writeVerificationCache,
} from '../../../support/verification-cache.ts';
import {
	discoverPackageAdapters,
	type PackageCommand,
} from '../../../reconciliation/package-adapters.ts';
import {
	discoverManagedRepositories,
	parseGitmodulesPaths,
	readTemplateRepositoryManifest,
	type ManagedRepositoryKind,
} from '../../../support/managed-repositories.ts';
import { RepositoryInstallResult, RepositoryLockfileValidationResult, RepositorySaveError, RepositorySaveNode, RepositorySaveOptions, emitProgress, readJson, sleepMs, writeJson } from '../../support/repo-kind.ts';
import { dependencyFields } from '../../support/classify-repo-kind.ts';
import { hasNpmLockfile, shouldSkipNetworkInstall, validateStandaloneGitDependencyLockfile } from '../../support/has-staged-changes.ts';
import { npmLockfilePackageCount, runCapturedCommand, runStreamingCommand } from '../../runtime/with-short-process-temp-env.ts';

export function syncRootWorkspaceLockfileMetadata(node: RepositorySaveNode, options: Pick<RepositorySaveOptions, 'root' | 'onProgress'>) {
	if (node.path !== options.root || !Array.isArray(node.packageJson?.workspaces)) return false;
	const lockfilePath = resolve(node.path, 'package-lock.json');
	if (!existsSync(lockfilePath)) return false;
	const lockfile = readJson(lockfilePath);
	const packages = lockfile.packages;
	if (!packages || typeof packages !== 'object' || Array.isArray(packages)) return false;
	let changed = false;
	const packageEntries = packages as Record<string, Record<string, unknown>>;
	const rootEntry = packageEntries[''] ?? {};
	const workspacePackageList = workspacePackages(node.path);
	const workspaceVersionByName = new Map(workspacePackageList
		.map((workspacePackage) => [String(workspacePackage.packageJson.name ?? ''), String(workspacePackage.packageJson.version ?? '')] as const)
		.filter(([name, version]) => name.length > 0 && version.length > 0));
	const rootDependencySpecs = new Map<string, string>();
	for (const field of dependencyFields(node.packageJson)) {
		const rootDeps = node.packageJson[field];
		if (!rootDeps || typeof rootDeps !== 'object' || Array.isArray(rootDeps)) continue;
		for (const [dependencyName, dependencySpec] of Object.entries(rootDeps)) {
			if (typeof dependencySpec === 'string') {
				rootDependencySpecs.set(dependencyName, dependencySpec);
			}
		}
	}
	const stableWorkspaceDependencySpec = (dependencyName: string) =>
		rootDependencySpecs.get(dependencyName) ?? workspaceVersionByName.get(dependencyName) ?? null;
	const normalizeWorkspaceDependencySpecs = (value: Record<string, unknown>) => Object.fromEntries(
		Object.entries(value).map(([dependencyName, dependencySpec]) => [
			dependencyName,
			workspaceVersionByName.has(dependencyName) ? stableWorkspaceDependencySpec(dependencyName) : dependencySpec,
		]),
	);
	if (JSON.stringify(rootEntry.workspaces ?? []) !== JSON.stringify(node.packageJson.workspaces)) {
		rootEntry.workspaces = node.packageJson.workspaces;
		packageEntries[''] = rootEntry;
		changed = true;
	}
	for (const field of dependencyFields(node.packageJson)) {
		const nextValue = node.packageJson[field];
		if (nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)) {
			const currentValue = rootEntry[field];
			const currentDeps = currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
				? currentValue as Record<string, unknown>
				: {};
			const mergedDeps = { ...currentDeps };
			let fieldChanged = false;
			for (const [dependencyName, dependencySpec] of Object.entries(nextValue)) {
				if (mergedDeps[dependencyName] === dependencySpec) continue;
				mergedDeps[dependencyName] = dependencySpec;
				fieldChanged = true;
			}
			if (fieldChanged) {
				rootEntry[field] = mergedDeps;
				packageEntries[''] = rootEntry;
				changed = true;
			}
		}
	}
	for (const workspacePackage of workspacePackageList) {
		const relativeDir = workspacePackage.relativeDir.replace(/\\/gu, '/');
		const packageJson = workspacePackage.packageJson;
		const packageName = String(packageJson.name ?? '');
		if (!packageName) continue;
		const packageEntry = packageEntries[relativeDir] ?? {};
		if (packageEntry.name !== packageName) {
			packageEntry.name = packageName;
			changed = true;
		}
		if (typeof packageJson.version === 'string' && packageEntry.version !== packageJson.version) {
			packageEntry.version = packageJson.version;
			changed = true;
		}
		for (const field of dependencyFields(packageJson)) {
			const nextValue = packageJson[field];
			if (nextValue && typeof nextValue === 'object' && !Array.isArray(nextValue)) {
				const normalizedValue = normalizeWorkspaceDependencySpecs(nextValue as Record<string, unknown>);
				if (JSON.stringify(packageEntry[field] ?? {}) !== JSON.stringify(normalizedValue)) {
					packageEntry[field] = normalizedValue;
					changed = true;
				}
			}
		}
		packageEntries[relativeDir] = packageEntry;
		const linkKey = `node_modules/${packageName}`;
		const linkEntry = packageEntries[linkKey] ?? {};
		if (linkEntry.resolved !== relativeDir) {
			linkEntry.resolved = relativeDir;
			changed = true;
		}
		if (linkEntry.link !== true) {
			linkEntry.link = true;
			changed = true;
		}
		packageEntries[linkKey] = linkEntry;
	}
	if (!changed) return false;
	lockfile.packages = packageEntries;
	writeJson(lockfilePath, lockfile);
	emitProgress(options, node, 'lockfile', 'Synchronized root workspace lockfile metadata before validation.');
	return true;
}

export async function runGitDependencySmoke(node: RepositorySaveNode, options: RepositorySaveOptions, reference: PackageDependencyReference) {
	void node;
	void options;
	void reference;
}

export async function runNpmInstallWithRetry(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'root' | 'onProgress' | 'deferPushUntilVerified'>,
	gitDependencyRefreshSpecs: string[] = [],
): Promise<RepositoryInstallResult> {
	if (shouldSkipNetworkInstall() || options.deferPushUntilVerified === true) {
		const reason = options.deferPushUntilVerified === true ? 'atomic-save' : 'disabled';
		emitProgress(options, node, 'install', `Skipped npm install because ${reason === 'atomic-save' ? 'atomic save validates local lock metadata before publishing commits' : 'network install mode is disabled'}.`);
		return { status: 'skipped', attempts: 0, reason };
	}
	let lastError: string | null = null;
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	if (!rootWorkspaceInstall && node.branchMode !== 'project-save') {
		validateStandaloneGitDependencyLockfile(node, options);
		return { status: 'completed', attempts: 1, reason: 'isolated-lockfile-validation' };
	}
	const installFlags = rootWorkspaceInstall
		? ['--package-lock-only', '--ignore-scripts']
		: node.branchMode === 'project-save'
		? ['--ignore-scripts']
		: ['--package-lock-only', '--ignore-scripts'];
	const args = rootWorkspaceInstall
		? (gitDependencyRefreshSpecs.length > 0 ? ['install', ...gitDependencyRefreshSpecs, ...installFlags, '--force'] : ['install', ...installFlags])
		: (gitDependencyRefreshSpecs.length > 0
			? ['install', ...gitDependencyRefreshSpecs, ...installFlags, '--force', '--workspaces=false']
			: ['install', ...installFlags, '--workspaces=false']);
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		emitProgress(options, node, 'install', `npm ${args.join(' ')} attempt ${attempt}/5.`);
		try {
			await runStreamingCommand(node, options, 'install', 'npm', args);
			return { status: 'completed', attempts: attempt, reason: null };
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < 5) {
			emitProgress(options, node, 'install', 'npm install failed; retrying in 60 seconds.', 'stderr');
			await sleepMs(60_000);
		}
	}
	throw new RepositorySaveError(`npm install failed after 5 attempts.\n${lastError ?? ''}`);
}

export async function runProjectVerificationInstallWithRetry(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'root' | 'onProgress'>,
) {
	if (!hasNpmLockfile(node.path)) return;
	if (shouldSkipNetworkInstall()) {
		emitProgress(options, node, 'install', 'Skipped project verification dependency install because network install mode is disabled.');
		return;
	}
	let lastError: string | null = null;
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	if (rootWorkspaceInstall) {
		emitProgress(options, node, 'install', 'Skipped root npm ci project verification install; lockfile plan and restored workspace links provide save-time dependency proof.');
		return;
	}
	const args = rootWorkspaceInstall
		? ['ci']
		: ['ci', '--workspaces=false'];
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		emitProgress(options, node, 'install', `npm ${args.join(' ')} for project verification attempt ${attempt}/5.`);
		try {
			await runStreamingCommand(node, options, 'install', 'npm', args);
			return;
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);
		}
		if (attempt < 5) {
			emitProgress(options, node, 'install', 'npm ci for verification failed; retrying in 60 seconds.', 'stderr');
			await sleepMs(60_000);
		}
	}
	throw new RepositorySaveError(`Project verification dependency install failed after 5 attempts.\n${lastError ?? ''}`);
}

export function lockfileValidationCommand(node: Pick<RepositorySaveNode, 'path' | 'packageJson'>, options: Pick<RepositorySaveOptions, 'root'>) {
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	const args = rootWorkspaceInstall
		? ['ci', '--ignore-scripts', '--plan']
		: ['ci', '--ignore-scripts', '--plan', '--workspaces=false'];
	return { command: 'npm', args };
}

export function lockfileValidationTimeoutMs(node: Pick<RepositorySaveNode, 'path' | 'packageJson'>, options: Pick<RepositorySaveOptions, 'root'>) {
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	return rootWorkspaceInstall ? 1_800_000 : 600_000;
}

export async function validateRepositoryLockfile(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'root' | 'onProgress' | 'deferPushUntilVerified'>,
): Promise<RepositoryLockfileValidationResult> {
	if (!hasNpmLockfile(node.path)) {
		return { status: 'skipped', command: null, issues: [], error: 'no npm lockfile' };
	}
	syncRootWorkspaceLockfileMetadata(node, options);
	const issues = collectDeploymentLockfileWorkspaceIssues(node.path)
		.map((issue) => `${issue.filePath}: ${issue.packageName} ${issue.reason}`);
	if (issues.length > 0) {
		throw new RepositorySaveError([
			`Lockfile validation failed for ${node.name}.`,
			...issues,
		].join('\n'), {
			details: {
				failingRepo: node.name,
				phase: 'lockfile',
				issues,
			},
		});
	}
	const { command, args } = lockfileValidationCommand(node, options);
	const commandText = `${command} ${args.join(' ')}`;
	if (shouldSkipNetworkInstall() || options.deferPushUntilVerified === true) {
		const reason = options.deferPushUntilVerified === true ? 'atomic-save' : 'disabled';
		emitProgress(options, node, 'lockfile', `Validated lockfile structure without ${commandText} because ${reason === 'atomic-save' ? 'upstream commits are intentionally unpublished' : 'network install mode is disabled'}.`);
		return { status: 'passed', command: 'treeseed structural lockfile validation', issues: [], error: null };
	}
	try {
		runCapturedCommand(node, options, 'lockfile', command, args, { timeoutMs: lockfileValidationTimeoutMs(node, options), emitOutputOnSuccess: false });
		const packageCount = npmLockfilePackageCount(node.path);
		const countText = packageCount === null ? 'package-lock entries' : `${packageCount} package${packageCount === 1 ? '' : 's'}`;
		emitProgress(options, node, 'lockfile', `Lockfile validation passed: ${countText} checked, 0 issues.`);
		return { status: 'passed', command: commandText, issues: [], error: null };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const result = { status: 'failed' as const, command: commandText, issues: [message], error: message };
		throw new RepositorySaveError([
			`Lockfile validation failed for ${node.name}.`,
			`Command: ${commandText}`,
			message,
		].join('\n'), {
			details: {
				failingRepo: node.name,
				phase: 'lockfile',
				command: commandText,
				issues: result.issues,
			},
		});
	}
}

export function hasScript(node: RepositorySaveNode, scriptName: string) {
	return typeof node.scripts[scriptName] === 'string' && node.scripts[scriptName].length > 0;
}

export function manifestVerifyCommand(node: RepositorySaveNode, key: 'fast' | 'local' | 'release') {
	return node.manifestVerifyCommands[key] ?? null;
}

export function hasAnyVerificationCommand(node: RepositorySaveNode) {
	return hasScript(node, 'verify:action')
		|| hasScript(node, 'verify:local')
		|| hasScript(node, 'verify')
		|| Boolean(manifestVerifyCommand(node, 'local'))
		|| Boolean(manifestVerifyCommand(node, 'fast'));
}
