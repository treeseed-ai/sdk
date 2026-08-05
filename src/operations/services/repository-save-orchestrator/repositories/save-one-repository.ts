import { resolve } from 'node:path';
import {
headCommit
} from '../../operations/git-workflow.ts';
import type { PackageDependencyReference } from '../../packages/package-reference-policy.ts';
import { collectDeploymentLockfileWorkspaceIssues,ensureLocalWorkspaceLinks } from '../../treedx/workspaces/workspace-dependency-mode.ts';
import {
currentBranch,
hasMeaningfulChanges
} from '../../treedx/workspaces/workspace-save.ts';
import { finalizeCleanPackageVersion } from '../packages/finalize-clean-package-version.ts';
import { isNoOpGitCommitError,runCapturedCommand } from '../runtime/with-short-process-temp-env.ts';
import { canManagePackageJsonVersion,createReport,dependencyFields,ensureWritableRemote,packageVersionTagConflictsWithHead,remoteBranchCommitSafe,remoteRefCommitExistsSafe,selectPackageVersion } from '../support/classify-repo-kind.ts';
import { applyPackageVersion,hasNpmLockfile,hasStagedChanges,isRootWorkspaceRepository,shouldSkipNetworkInstall,syncDirectGitDependencyLockfileEntries,updateDependencyReferences,validateStandaloneGitDependencyLockfile } from '../support/has-staged-changes.ts';
import { RepositorySaveError,RepositorySaveNode,RepositorySaveOptions,SaveState,emitProgress,readJson } from '../support/repo-kind.ts';
import { classifyRepositoryChanges,repositoryChangedPaths } from '../support/change-classification.ts';
import { finishRepositorySavePublish,pullRebaseFromOrigin,runRepoVerification } from '../support/run-script.ts';
import { collectSubmodulePointerChanges,commitContextDependencyUpdates,commitContextPackageChanges,ensurePackageTagReady,ensureRemoteAccessBeforeVerification,finalizePackageReference,refreshRepositoryNodePackageMetadata,syncBranchBeforeSave } from '../support/tag-state.ts';
import { runNpmInstallWithRetry,validateRepositoryLockfile } from '../treedx/repositories/sync-root-workspace-lockfile-metadata.ts';
import { commitMessageFor,gitDiffSummary } from './discover-repository-save-nodes.ts';

function recordFinalizedCommit(state: SaveState, node: RepositorySaveNode, commitSha: string | null) {
	for (const path of node.checkoutAliases) state.finalizedCommits.set(path, commitSha);
}

export function dependencyReferenceIsPublished(reference: PackageDependencyReference) {
	if (reference.mode !== 'dev-git-commit' || !reference.sourcePath) return true;
	const expectedCommit = (reference.manifestSpec ?? reference.spec).slice((reference.manifestSpec ?? reference.spec).lastIndexOf('#') + 1);
	const branch = currentBranch(reference.sourcePath);
	return Boolean(branch && remoteBranchCommitSafe(reference.sourcePath, branch) === expectedCommit)
		|| remoteRefCommitExistsSafe(reference.sourcePath, expectedCommit);
}

export function shouldValidateGitDependencyLockfile(
	references: PackageDependencyReference[],
	deferPushUntilVerified: boolean,
) {
	return references.length > 0
		&& (!deferPushUntilVerified || references.every(dependencyReferenceIsPublished));
}

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
	const validateGitDependencyLockfile = shouldValidateGitDependencyLockfile(
		gitDependencyRefreshReferences,
		options.deferPushUntilVerified === true,
	);
	const deferredGitDependencyValidation = gitDependencyRefreshReferences.length > 0
		&& !validateGitDependencyLockfile;
	const lockfileGitDependenciesSynced = validateGitDependencyLockfile
		? false
		: syncDirectGitDependencyLockfileEntries(node, options, gitDependencyRefreshReferences);
	if (
		!isRootWorkspaceRepository(node, options)
		&& validateGitDependencyLockfile
	) {
		validateStandaloneGitDependencyLockfile(node, options);
	}
	const gitDependencyRefreshSpecs = lockfileGitDependenciesSynced
		? []
		: gitDependencyRefreshReferences.map((reference) => `${reference.packageName}@${reference.installSpec ?? reference.spec}`);
	const submodulePointers = collectSubmodulePointerChanges(node, state.finalizedCommits);
	const submodulesChanged = submodulePointers.length > 0;
	node.changeKind = classifyRepositoryChanges(repositoryChangedPaths(node.path), node.contentPath ?? null);
	const contentOnly = node.changeKind === 'content' && !dependencyChanged && !submodulesChanged;
	if (!contentOnly && node.changeKind === 'content') node.changeKind = 'mixed';
	report.changeKind = node.changeKind;
	if (contentOnly) {
		emitProgress(options, node, 'classify', `Content-only change under ${node.contentPath}; code verification and package versioning are not required.`);
	}
	const packageHasMeaningfulChanges = hasMeaningfulChanges(node.path);
	const packageNeedsVersion = canManagePackageJsonVersion(node) && (
		(packageHasMeaningfulChanges && !contentOnly)
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

	if (!contentOnly && hasNpmLockfile(node.path) && (node.kind === 'project' || packageNeedsVersion || dependencyChanged || submodulesChanged)) {
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
		recordFinalizedCommit(state, node, report.commitSha);
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
		recordFinalizedCommit(state, node, report.commitSha);
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
		recordFinalizedCommit(state, node, report.commitSha);
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

	if (canManagePackageJsonVersion(node) && !contentOnly) {
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
	recordFinalizedCommit(state, node, report.commitSha);
	emitProgress(options, node, 'done', `Saved ${report.commitSha?.slice(0, 12) ?? 'current HEAD'}.`);
	return report;
}
