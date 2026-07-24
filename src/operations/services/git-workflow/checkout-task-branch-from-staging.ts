import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { run, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { collectMergeConflictReport, currentBranch, formatMergeConflictReport, gitStatusPorcelain, repoRoot } from '../treedx/workspaces/workspace-save.ts';
import { ensureSshPushUrlForOrigin } from '../repositories/git-remote-policy.ts';
import { runRepositoryGit, type GitRunnerMode } from '../operations/git-runner.ts';
import { createManagedToolEnv, resolveToolBinary } from '../../../entrypoints/runtime/managed-dependencies.ts';
import { assertCleanWorktree, branchExists, checkoutBranch, fetchOrigin, remoteBranchExists, remoteHeadCommit } from './inspect-detached-head-repair.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH, ensureWritableOrigin, headCommit, runGit, runGitAllowFailure } from './staging-branch.ts';

export function checkoutTaskBranchFromStaging(
	cwd,
	branchName,
	{ createIfMissing = true, pushIfCreated = false } = {},
) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	const stagingBaseRef = remoteBranchExists(repoDir, STAGING_BRANCH)
		? `origin/${STAGING_BRANCH}`
		: branchExists(repoDir, STAGING_BRANCH)
			? STAGING_BRANCH
			: null;
	if (!stagingBaseRef) {
		throw new Error(`Base branch "${STAGING_BRANCH}" does not exist locally or on origin.`);
	}

	if (currentBranch(repoDir) === branchName) {
		return {
			repoDir,
			branchName,
			baseBranch: STAGING_BRANCH,
			created: false,
			resumed: true,
			remoteBranch: remoteBranchExists(repoDir, branchName),
		};
	}

	if (branchExists(repoDir, branchName)) {
		checkoutBranch(repoDir, branchName);
		if (remoteBranchExists(repoDir, branchName)) {
			runGit(['pull', '--rebase', 'origin', branchName], { cwd: repoDir });
		}
		return {
			repoDir,
			branchName,
			baseBranch: STAGING_BRANCH,
			created: false,
			resumed: true,
			remoteBranch: remoteBranchExists(repoDir, branchName),
		};
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
		runGit(['pull', '--rebase', 'origin', branchName], { cwd: repoDir });
		return {
			repoDir,
			branchName,
			baseBranch: STAGING_BRANCH,
			created: false,
			resumed: true,
			remoteBranch: true,
		};
	}

	if (!createIfMissing) {
		throw new Error(`Branch "${branchName}" does not exist locally or on origin.`);
	}

	runGit(['checkout', '-b', branchName, stagingBaseRef], { cwd: repoDir });
	if (pushIfCreated) {
		pushBranch(repoDir, branchName, { setUpstream: true });
	}
	return {
		repoDir,
		branchName,
		baseBranch: STAGING_BRANCH,
		created: true,
		resumed: false,
		remoteBranch: pushIfCreated,
	};
}

export function checkoutNewTaskBranchWithChanges(cwd: string, branchName: string, { pushIfCreated = false } = {}) {
	const repoDir = repoRoot(cwd);
	if (currentBranch(repoDir) !== STAGING_BRANCH) {
		const stagingHead = remoteBranchExists(repoDir, STAGING_BRANCH) ? remoteHeadCommit(repoDir, STAGING_BRANCH) : null;
		const canNormalizeStagingCheckout = gitStatusPorcelain(repoDir).length === 0
			&& stagingHead !== null
			&& headCommit(repoDir) === stagingHead;
		if (!canNormalizeStagingCheckout) {
			throw new Error(`Dirty change adoption requires ${repoDir} to be on ${STAGING_BRANCH}.`);
		}
		syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	}
	if (branchExists(repoDir, branchName) || remoteBranchExists(repoDir, branchName)) {
		throw new Error(`Dirty change adoption requires a new branch; ${branchName} already exists.`);
	}
	runGit(['checkout', '-b', branchName], { cwd: repoDir });
	if (pushIfCreated) pushBranch(repoDir, branchName, { setUpstream: true });
	return {
		repoDir,
		branchName,
		baseBranch: STAGING_BRANCH,
		created: true,
		resumed: false,
		remoteBranch: pushIfCreated,
	};
}

export function syncBranchWithOrigin(repoDir, branchName) {
	fetchOrigin(repoDir);
	if (!branchExists(repoDir, branchName) && remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
	} else {
		checkoutBranch(repoDir, branchName);
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['merge', '--ff-only', `origin/${branchName}`], { cwd: repoDir, capture: true });
	}
}

export function checkoutDetachedOriginBranch(repoDir, branchName) {
	fetchOrigin(repoDir);
	if (!remoteBranchExists(repoDir, branchName)) {
		throw new Error(`Remote branch "origin/${branchName}" does not exist.`);
	}
	runGit(['checkout', '--detach', `origin/${branchName}`], { cwd: repoDir });
}

export function pushHeadToBranch(repoDir, branchName) {
	ensureWritableOrigin(repoDir);
	runGit(['push', 'origin', `HEAD:${branchName}`], { cwd: repoDir });
}

export function createFeatureBranchFromStaging(cwd, branchName) {
	const result = checkoutTaskBranchFromStaging(cwd, branchName, {
		createIfMissing: true,
		pushIfCreated: false,
	});
	if (!result.created) {
		throw new Error(`Branch "${branchName}" already exists locally or on origin.`);
	}
	return result;
}

export function pushBranch(repoDir, branchName, { setUpstream = false } = {}) {
	ensureWritableOrigin(repoDir);
	const args = setUpstream ? ['push', '-u', 'origin', branchName] : ['push', 'origin', branchName];
	runGit(args, { cwd: repoDir });
}

export function taskTagSlug(branchName) {
	return String(branchName ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.replace(/[^a-z0-9._-]+/giu, '-')
		.toLowerCase()
		.replace(/-+/gu, '-')
		.replace(/^-|-$/gu, '')
		|| 'task';
}

export function createDeprecatedTaskTag(repoDir, branchName, reason = '') {
	const head = headCommit(repoDir, branchName);
	const tagName = `deprecated/${taskTagSlug(branchName)}/${head.slice(0, 12)}`;
	const message = [
		`Deprecated task branch ${branchName}`,
		String(reason ?? '').trim(),
	].filter(Boolean).join('\n\n');
	runGit(['tag', '-a', tagName, head, '-m', message], { cwd: repoDir });
	ensureWritableOrigin(repoDir);
	runGit(['push', 'origin', tagName], { cwd: repoDir });
	return {
		repoDir,
		branchName,
		tagName,
		head,
		pushed: true,
	};
}

export function ensureRemoteBranchFromBase(
	repoDir,
	branchName,
	{ baseBranch = PRODUCTION_BRANCH } = {},
) {
	fetchOrigin(repoDir);
	if (remoteBranchExists(repoDir, branchName)) {
		return {
			branchName,
			baseBranch,
			createdLocal: branchExists(repoDir, branchName) ? false : (() => {
				runGit(['branch', branchName, `origin/${branchName}`], { cwd: repoDir });
				return true;
			})(),
			pushed: false,
			existed: true,
		};
	}

	const baseRef = remoteBranchExists(repoDir, baseBranch)
		? `origin/${baseBranch}`
		: branchExists(repoDir, baseBranch)
			? baseBranch
			: '';
	if (!baseRef) {
		throw new Error(`Base branch "${baseBranch}" does not exist locally or on origin.`);
	}
	const createdLocal = !branchExists(repoDir, branchName);
	if (createdLocal) {
		runGit(['branch', branchName, baseRef], { cwd: repoDir });
	}
	pushBranch(repoDir, branchName, { setUpstream: true });
	return {
		branchName,
		baseBranch,
		createdLocal,
		pushed: true,
		existed: false,
	};
}

export function deleteLocalBranch(repoDir, branchName) {
	if (!branchExists(repoDir, branchName)) {
		return;
	}
	runGit(['branch', '-D', branchName], { cwd: repoDir });
}

export function deleteRemoteBranch(repoDir, branchName) {
	if (!remoteBranchExists(repoDir, branchName)) {
		return false;
	}
	ensureWritableOrigin(repoDir);
	runGit(['push', 'origin', '--delete', branchName], { cwd: repoDir });
	return true;
}

export function deleteRemoteBranchIfMerged(repoDir, branchName, targetBranch, expectedHead, options: { fetch?: boolean } = {}) {
	if (!remoteBranchExists(repoDir, branchName)) return false;
	if (options.fetch !== false) fetchOrigin(repoDir);
	const observedHead = remoteHeadCommit(repoDir, branchName);
	if (!expectedHead || observedHead !== expectedHead) {
		throw new Error(`Refusing to delete origin/${branchName}: expected ${expectedHead || '(missing)'}, observed ${observedHead || '(missing)'}.`);
	}
	const targetHead = remoteHeadCommit(repoDir, targetBranch);
	if (!targetHead) {
		throw new Error(`Refusing to delete origin/${branchName}: origin/${targetBranch} is missing.`);
	}
	const ancestry = runGitAllowFailure(['merge-base', '--is-ancestor', observedHead, targetHead], { cwd: repoDir });
	if (ancestry.status !== 0) {
		throw new Error(`Refusing to delete origin/${branchName}: ${observedHead} is not merged into origin/${targetBranch} (${targetHead}).`);
	}
	ensureWritableOrigin(repoDir);
	runGit(['push', `--force-with-lease=refs/heads/${branchName}:${expectedHead}`, 'origin', '--delete', branchName], { cwd: repoDir });
	return true;
}
