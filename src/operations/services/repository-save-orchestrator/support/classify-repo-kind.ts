import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { classifyGitMode, runGitText } from '../../operations/git-runner.ts';
import {
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
	type GitRemoteWriteMode,
} from '../../repositories/git-remote-policy.ts';
import {
	generateRepositoryCommitMessage,
	type CommitMessageDependencyUpdate,
	type CommitMessageContext,
	type CommitMessagePackageChange,
	type CommitMessageProvider,
	type CommitMessageProviderMode,
	type CommitMessageSubmodulePointer,
} from '../../capacity/providers/commit-message-provider.ts';
import {
	createPackageDependencyReference,
	type DevDependencyReferenceMode,
	type GitDependencyProtocol,
	normalizeGitRemoteForDependency,
	type PackageDependencyReference,
	type RewrittenDevReference,
	updateInternalDependencySpecs,
} from '../../packages/package-reference-policy.ts';
import {
	PRODUCTION_BRANCH,
	branchExists,
	checkoutBranch,
	headCommit,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
} from '../../operations/git-workflow.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	repoRoot,
} from '../../treedx/workspaces/workspace-save.ts';
import {
	hasCompletePackageCheckout,
	run,
	sortWorkspacePackages,
	workspacePackages,
} from '../../treedx/workspaces/workspace-tools.ts';
import { collectDeploymentLockfileWorkspaceIssues, ensureLocalWorkspaceLinks } from '../../treedx/workspaces/workspace-dependency-mode.ts';
import {
	createBuildWarningSummary,
	formatAllowedBuildWarnings,
	type BuildWarningPolicyOptions,
} from '../../build/build-warning-policy.js';
import {
	readVerificationCache,
	writeVerificationCache,
} from '../../support/verification-cache.ts';
import {
	discoverPackageAdapters,
	type PackageCommand,
} from '../../reconciliation/package-adapters.ts';
import {
	discoverManagedRepositories,
	parseGitmodulesPaths,
	readTemplateRepositoryManifest,
	type ManagedRepositoryKind,
} from '../../support/managed-repositories.ts';
import { RepoKind, RepositorySaveNode, RepositorySaveOptions, RepositorySaveReport, emitProgress, runGit } from './repo-kind.ts';
import { packageScripts } from '../runtime/with-short-process-temp-env.ts';
import { tagState } from './tag-state.ts';
import { tagExists } from './run-script.ts';
import { planPackageVersion } from './has-staged-changes.ts';

export function classifyRepoKind(packageJson: Record<string, unknown> | null, managedKind?: ManagedRepositoryKind): RepoKind {
	if (managedKind === 'template') return 'template';
	if (managedKind === 'fixture') return 'fixture';
	if (typeof packageJson?.name !== 'string' || typeof packageJson?.version !== 'string') {
		return 'project';
	}
	if (packageJson.private === true) {
		return 'project';
	}
	const scripts = packageScripts(packageJson);
	const publishConfig = packageJson.publishConfig;
	return typeof scripts['release:publish'] === 'string'
		|| (publishConfig !== null && typeof publishConfig === 'object' && !Array.isArray(publishConfig))
		? 'package'
		: 'project';
}

export function dependencyFields(packageJson: Record<string, unknown> | null) {
	if (!packageJson) return [];
	return ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
		.filter((field) => packageJson[field] && typeof packageJson[field] === 'object' && !Array.isArray(packageJson[field]));
}

export function repoIdForPath(root: string, repoDir: string) {
	return relative(root, repoDir).replaceAll('\\', '/') || '.';
}

export function isGitRepo(repoDir: string) {
	try {
		runGit(['rev-parse', '--is-inside-work-tree'], { cwd: repoDir, capture: true });
		return true;
	} catch {
		return false;
	}
}

export function isIndependentGitRepo(repoDir: string) {
	try {
		return resolve(repoRoot(repoDir)) === resolve(repoDir);
	} catch {
		return false;
	}
}

export function originRemoteUrlSafe(repoDir: string) {
	try {
		return originRemoteUrl(repoDir);
	} catch {
		return null;
	}
}

export function ensureWritableRemote(node: RepositorySaveNode, options: RepositorySaveOptions) {
	if (!node.remoteUrl || (options.gitRemoteWriteMode ?? 'ssh-pushurl') === 'off') return;
	const result = ensureSshPushUrlForOrigin(node.path, node.remoteUrl, options.gitRemoteWriteMode ?? 'ssh-pushurl');
	if (result.changed && result.pushUrl) {
		emitProgress(options, node, 'remote', `Configured origin push URL ${result.pushUrl}; keeping ${node.remoteUrl} for reads.`);
	}
}

export function repoDisplayName(repoDir: string, packageJson: Record<string, unknown> | null) {
	return typeof packageJson?.name === 'string' && packageJson.name.length > 0
		? packageJson.name
		: basename(repoDir);
}

export function emptyManifestVerifyCommands(): RepositorySaveNode['manifestVerifyCommands'] {
	return { fast: null, local: null, release: null };
}

export function verifyCommandFromString(repoDir: string, label: 'fast' | 'local' | 'release', command: string | null): PackageCommand | null {
	return command ? { label, command: 'bash', args: ['-lc', command], cwd: repoDir } : null;
}

export function templateVerifyCommands(repoDir: string): RepositorySaveNode['manifestVerifyCommands'] | null {
	const manifest = readTemplateRepositoryManifest(repoDir);
	if (!manifest) return null;
	return {
		fast: verifyCommandFromString(repoDir, 'fast', manifest.verify.fast),
		local: verifyCommandFromString(repoDir, 'local', manifest.verify.local),
		release: verifyCommandFromString(repoDir, 'release', manifest.verify.release),
	};
}

export function parseGitmodules(root: string) {
	return parseGitmodulesPaths(root);
}

export function slugBranch(branch: string) {
	return branch
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'dev';
}

export function timestampLabel(date = new Date()) {
	return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/u, 'Z');
}

export function nextDevVersion(version: string, branch: string, date = new Date()) {
	return `${incrementVersion(version, 'patch')}-dev.${slugBranch(branch)}.${timestampLabel(date)}`;
}

export function escapeRegExp(value: string) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function isStableSemverVersion(version: string) {
	return /^\d+\.\d+\.\d+$/u.test(version);
}

export function isDevVersionForBranch(version: string, branch: string) {
	const branchSlug = escapeRegExp(slugBranch(branch));
	return new RegExp(`^\\d+\\.\\d+\\.\\d+-dev\\.${branchSlug}\\.\\d{8}T\\d{6}Z$`, 'u').test(version);
}

export function packageVersionAtHead(node: RepositorySaveNode) {
	if (!node.packageJsonPath) return null;
	try {
		const source = runGit(['show', 'HEAD:package.json'], { cwd: node.path, capture: true });
		const packageJson = JSON.parse(source) as Record<string, unknown>;
		return typeof packageJson.version === 'string' ? packageJson.version : null;
	} catch {
		return null;
	}
}

export function headCommitOrPlanPlaceholder(cwd: string) {
	try {
		return headCommit(cwd);
	} catch {
		return 'HEAD';
	}
}

export function remoteBranchCommitSafe(cwd: string, branch: string) {
	try {
		const output = runGit(['ls-remote', 'origin', `refs/heads/${branch}`], { cwd, capture: true });
		const [sha] = output.trim().split(/\s+/u);
		return /^[a-f0-9]{40}$/u.test(sha ?? '') ? sha! : null;
	} catch {
		return null;
	}
}

export function canManagePackageJsonVersion(node: RepositorySaveNode) {
	return node.kind === 'package' && Boolean(node.packageJsonPath) && typeof node.packageJson?.version === 'string';
}

export function packageVersionEligibleForBranch(node: RepositorySaveNode, version: string, options: RepositorySaveOptions) {
	return node.branchMode === 'package-release-main'
		? isStableSemverVersion(version)
		: isDevVersionForBranch(version, node.branch || options.branch);
}

export function packageVersionTagConflictsWithHead(node: RepositorySaveNode, options: RepositorySaveOptions) {
	if (node.kind !== 'package') return false;
	if (node.branchMode === 'package-dev-save' && (options.devDependencyReferenceMode ?? 'git-commit') === 'git-commit') return false;
	const version = typeof node.packageJson?.version === 'string' ? node.packageJson.version : null;
	if (!version || !packageVersionEligibleForBranch(node, version, options)) return false;
	const head = headCommit(node.path);
	const state = tagState(node.path, version);
	return (state.localCommit != null && state.localCommit !== head)
		|| (state.remoteCommit != null && state.remoteCommit !== head);
}

export function selectPackageVersion(node: RepositorySaveNode, options: RepositorySaveOptions) {
	const current = String(node.packageJson?.version ?? '0.0.0');
	if (
		node.branchMode === 'package-dev-save'
		&& isDevVersionForBranch(current, node.branch || options.branch)
		&& ((options.devDependencyReferenceMode ?? 'git-commit') === 'git-commit' || !tagExists(node.path, current))
	) {
		return { version: current, reused: true };
	}
	if (node.branchMode === 'package-release-main') {
		const headVersion = packageVersionAtHead(node);
		if (headVersion && current === incrementVersion(headVersion, options.bump ?? 'patch') && !tagExists(node.path, current)) {
			return { version: current, reused: true };
		}
	}
	return { version: planPackageVersion(node, options), reused: false };
}

export function createReport(node: RepositorySaveNode): RepositorySaveReport {
	return {
		name: node.name,
		path: node.path,
		branch: node.branch,
		dirty: hasMeaningfulChanges(node.path),
		created: false,
		resumed: false,
		merged: false,
		verified: false,
		committed: false,
		pushed: false,
		deletedLocal: false,
		deletedRemote: false,
		tagName: null,
		commitSha: node.branch ? headCommit(node.path) : null,
		skippedReason: null,
		publishWait: null,
		version: typeof node.packageJson?.version === 'string' ? node.packageJson.version : null,
		dependencySpec: node.plannedDependencySpec,
		branchMode: node.branchMode,
		verification: null,
		install: null,
		lockfileValidation: null,
		commitMessage: null,
		commitMessageProvider: null,
		commitMessageFallbackUsed: false,
		commitMessageError: null,
	};
}
