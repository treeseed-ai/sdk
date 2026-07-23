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
import { RepositorySaveError, RepositorySaveNode, RepositorySaveOptions, SaveState, emitProgress, readJson } from './repo-kind.ts';
import { canManagePackageJsonVersion, createReport, dependencyFields, ensureWritableRemote, packageVersionTagConflictsWithHead, selectPackageVersion } from './classify-repo-kind.ts';
import { collectSubmodulePointerChanges, commitContextDependencyUpdates, commitContextPackageChanges, ensurePackageTagReady, ensureRemoteAccessBeforeVerification, finalizePackageReference, refreshRepositoryNodePackageMetadata, syncBranchBeforeSave } from './tag-state.ts';
import { applyPackageVersion, hasNpmLockfile, hasStagedChanges, isRootWorkspaceRepository, shouldSkipNetworkInstall, syncDirectGitDependencyLockfileEntries, updateDependencyReferences, validateStandaloneGitDependencyLockfile } from './has-staged-changes.ts';
import { runNpmInstallWithRetry, validateRepositoryLockfile } from './sync-root-workspace-lockfile-metadata.ts';
import { finalizeCleanPackageVersion } from './finalize-clean-package-version.ts';
import { finishRepositorySavePublish, pullRebaseFromOrigin, runRepoVerification } from './run-script.ts';
import { isNoOpGitCommitError, runCapturedCommand } from './with-short-process-temp-env.ts';
import { commitMessageFor, gitDiffSummary } from './discover-repository-save-nodes.ts';

export async function saveOneRepository(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	state: SaveState,
) {
	const report = state.reports.get(node.id) ?? createReport(node);
	state.reports.set(node.id, report);
	const branch = node.branch || options.branch;
	emitProgress(options, node, 'start', `Starting ${node.branchMode} on ${branch}.`);
	syncBranchBeforeSave(node, options, branch);
	node.branch = currentBranch(node.path) || branch;
	report.branch = node.branch;
	refreshRepositoryNodePackageMetadata(node);
	ensureWritableRemote(node, options);

	const dependencyUpdates = isRootWorkspaceRepository(node, options)
		? []
		: updateDependencyReferences(node, state.finalizedReferences);
	const dependencyChanged = dependencyUpdates.length > 0;
	const directDependencyNames = new Set(dependencyFields(node.packageJson ?? {}).flatMap((field) => {
		const value = node.packageJson?.[field];
		return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
	}));
	const gitDependencyRefreshReferences = [...state.finalizedReferences.values()]
		.filter((reference) => reference.mode === 'dev-git-commit' && directDependencyNames.has(reference.packageName));
	const deferredGitDependencyValidation = options.deferPushUntilVerified === true && gitDependencyRefreshReferences.length > 0;
	const lockfileGitDependenciesSynced = syncDirectGitDependencyLockfileEntries(node, options, gitDependencyRefreshReferences);
	if (!isRootWorkspaceRepository(node, options) && (
		lockfileGitDependenciesSynced
		|| (gitDependencyRefreshReferences.length > 0 && !existsSync(resolve(node.path, 'package-lock.json')))
	) && !deferredGitDependencyValidation) {
		validateStandaloneGitDependencyLockfile(node, options);
	}
	const gitDependencyRefreshSpecs = lockfileGitDependenciesSynced
		? []
		: gitDependencyRefreshReferences.map((reference) => `${reference.packageName}@${reference.installSpec ?? reference.spec}`);
	const submodulePointers = collectSubmodulePointerChanges(node, state.finalizedCommits);
	const submodulesChanged = submodulePointers.length > 0;
	const packageHasMeaningfulChanges = hasMeaningfulChanges(node.path);
	const packageNeedsVersion = canManagePackageJsonVersion(node) && (
		packageHasMeaningfulChanges
		|| dependencyChanged
		|| submodulesChanged
		|| packageVersionTagConflictsWithHead(node, options)
	);
	let plannedVersion: string | null = null;

	if (packageNeedsVersion) {
		const selection = selectPackageVersion(node, options);
		plannedVersion = selection.version;
		if (!plannedVersion) {
			throw new RepositorySaveError(`Unable to plan package version for ${node.name}.`);
		}
		if (selection.reused) {
			emitProgress(options, node, 'version', `Reusing existing interrupted save version ${plannedVersion}.`);
		} else {
			emitProgress(options, node, 'version', `Planned ${plannedVersion}.`);
		}
		applyPackageVersion(node, plannedVersion);
		node.plannedVersion = plannedVersion;
		report.version = plannedVersion;
		const reference = finalizePackageReference(node, plannedVersion, options);
		node.plannedTag = reference.tagName;
		report.tagName = reference.tagName;
		report.dependencySpec = reference.spec;
		report.install = await runNpmInstallWithRetry(node, options, gitDependencyRefreshSpecs);
	} else if (node.kind === 'package') {
		report.version = String(node.packageJson?.version ?? report.version ?? '');
	} else if (node.kind === 'project' && (dependencyChanged || (node.path === options.root && submodulesChanged)) && hasNpmLockfile(node.path)) {
		report.install = await runNpmInstallWithRetry(node, options, gitDependencyRefreshSpecs);
	}

	if (
		!isRootWorkspaceRepository(node, options)
		&& hasNpmLockfile(node.path)
		&& (packageNeedsVersion || dependencyChanged)
		&& !deferredGitDependencyValidation
	) {
		validateStandaloneGitDependencyLockfile(node, options);
	}

	if (hasNpmLockfile(node.path) && (node.kind === 'project' || packageNeedsVersion || dependencyChanged || submodulesChanged)) {
		const lockfileIssues = collectDeploymentLockfileWorkspaceIssues(node.path);
		if (node.kind === 'project' && lockfileIssues.length > 0 && !shouldSkipNetworkInstall()) {
			emitProgress(options, node, 'lockfile', 'Refreshing package-lock.json before validation.');
			report.install = await runNpmInstallWithRetry(node, options, gitDependencyRefreshSpecs);
		}
		report.lockfileValidation = await validateRepositoryLockfile(node, options);
	}

	const dirty = hasMeaningfulChanges(node.path);
	report.dirty = dirty;
	if (!dirty) {
		report.skippedReason = 'clean';
		report.commitSha = headCommit(node.path);
		emitProgress(options, node, 'clean', 'No meaningful changes to commit.');
		if (node.kind === 'package') {
			const finalized = await finalizeCleanPackageVersion(node, options, state, report, branch);
			if (finalized) {
				return report;
			}
		}
		if (!canManagePackageJsonVersion(node)) {
			const rebase = pullRebaseFromOrigin(node, options, branch);
			await finishRepositorySavePublish(node, options, state, report, { branch, rebase });
			report.commitSha = headCommit(node.path);
		}
		state.finalizedCommits.set(node.relativePath, report.commitSha);
		return report;
	}

	runCapturedCommand(node, options, 'commit', 'git', ['add', '-A']);
	if (!hasStagedChanges(node.path)) {
		report.dirty = false;
		report.skippedReason = 'clean-after-add';
		report.commitSha = headCommit(node.path);
		emitProgress(options, node, 'clean', 'No staged changes to commit after refreshing the index.');
		if (node.kind === 'package') {
			const finalized = await finalizeCleanPackageVersion(node, options, state, report, branch);
			if (finalized) {
				return report;
			}
		}
		if (!canManagePackageJsonVersion(node)) {
			const rebase = pullRebaseFromOrigin(node, options, branch);
			await finishRepositorySavePublish(node, options, state, report, { branch, rebase });
			report.commitSha = headCommit(node.path);
		}
		state.finalizedCommits.set(node.relativePath, report.commitSha);
		return report;
	}
	const { changedFiles, diff } = gitDiffSummary(node.path);
	emitProgress(options, node, 'message', 'Generating commit message.');
	const messageResult = await commitMessageFor(node, options, {
		changedFiles,
		diff,
		plannedVersion: plannedVersion ?? report.version,
		plannedTag: node.plannedTag ?? report.tagName,
		dependencyUpdates: commitContextDependencyUpdates(dependencyUpdates),
		submodulePointers,
		packageChanges: commitContextPackageChanges(node, state, submodulePointers),
	});
	report.commitMessage = messageResult.message;
	report.commitMessageProvider = messageResult.provider;
	report.commitMessageFallbackUsed = messageResult.fallbackUsed;
	report.commitMessageError = messageResult.error;
	emitProgress(options, node, 'message', `${messageResult.provider}${messageResult.fallbackUsed ? ' fallback' : ''}: ${messageResult.message.split(/\r?\n/u)[0]}`);
	try {
		runCapturedCommand(node, options, 'commit', 'git', ['commit', '-m', messageResult.message]);
	} catch (error) {
		if (
			!isNoOpGitCommitError(error)
			|| hasMeaningfulChanges(node.path)
			|| hasStagedChanges(node.path)
		) {
			throw error;
		}
		report.dirty = false;
		report.skippedReason = 'clean-at-commit';
		report.commitSha = headCommit(node.path);
		emitProgress(options, node, 'clean', 'No changes remained to commit after Git refreshed the index.');
		if (node.kind === 'package') {
			const finalized = await finalizeCleanPackageVersion(node, options, state, report, branch);
			if (finalized) {
				return report;
			}
		}
		if (!canManagePackageJsonVersion(node)) {
			const rebase = pullRebaseFromOrigin(node, options, branch);
			await finishRepositorySavePublish(node, options, state, report, { branch, rebase });
			report.commitSha = headCommit(node.path);
		}
		state.finalizedCommits.set(node.relativePath, report.commitSha);
		return report;
	}
	report.committed = true;
	report.commitSha = headCommit(node.path);

	const rebase = pullRebaseFromOrigin(node, options, branch);
	const verifyMode = options.verifyMode ?? 'action-first';
	if (node.kind === 'project' && node.path === options.root && Array.isArray(node.packageJson?.workspaces)) {
		const linkReport = ensureLocalWorkspaceLinks(options.root);
		const restoredLinks = Array.isArray(linkReport.created) ? linkReport.created.length : 0;
		if (restoredLinks > 0) {
			emitProgress(options, node, 'install', `Restored ${restoredLinks} local workspace package link${restoredLinks === 1 ? '' : 's'} before project verification.`);
		}
	}
	if (node.kind === 'package') {
		ensureRemoteAccessBeforeVerification(node, options, state);
	}
	report.verification = await runRepoVerification(node, options, verifyMode);
	report.verified = report.verification.status === 'passed';

	if (canManagePackageJsonVersion(node)) {
		const version = plannedVersion ?? String((readJson(resolve(node.path, 'package.json')).version ?? report.version ?? ''));
		const reference = finalizePackageReference(node, version, options);
		const tagMessage = reference.tagName ? ensurePackageTagReady(node, options, reference.tagName, branch, options.workflowRunId) : null;
		void tagMessage;
		report.tagName = reference.tagName;
		report.version = version;
		report.dependencySpec = reference.spec;
		state.finalizedVersions.set(node.name, version);
		state.finalizedReferences.set(node.name, reference);
		await finishRepositorySavePublish(node, options, state, report, { branch, rebase, reference, tagName: reference.tagName });
	} else {
		await finishRepositorySavePublish(node, options, state, report, { branch, rebase });
	}
	report.commitSha = headCommit(node.path);
	report.skippedReason = null;
	state.finalizedCommits.set(node.relativePath, report.commitSha);
	emitProgress(options, node, 'done', `Saved ${report.commitSha?.slice(0, 12) ?? 'current HEAD'}.`);
	return report;
}
