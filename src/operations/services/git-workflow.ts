import { run, workspaceRoot } from './workspace-tools.ts';
import { currentBranch, gitStatusPorcelain, repoRoot } from './workspace-save.ts';

export const STAGING_BRANCH = 'staging';
export const PRODUCTION_BRANCH = 'main';
const RESERVED_BRANCHES = new Set([STAGING_BRANCH, PRODUCTION_BRANCH]);

function runGit(args, { cwd, capture = false } = {}) {
	return run('git', args, { cwd, capture });
}

function repoHasStagedChanges(repoDir) {
	try {
		runGit(['diff', '--cached', '--quiet'], { cwd: repoDir });
		return false;
	} catch {
		return true;
	}
}

export function headCommit(repoDir, ref = 'HEAD') {
	return runGit(['rev-parse', ref], { cwd: repoDir, capture: true }).trim();
}

export function gitWorkflowRoot(cwd = workspaceRoot()) {
	return repoRoot(cwd);
}

export function assertCleanWorktree(cwd = workspaceRoot()) {
	const root = gitWorkflowRoot(cwd);
	if (gitStatusPorcelain(root).length > 0) {
		throw new Error('Treeseed requires a clean git worktree before changing branches.');
	}
	return root;
}

export function assertCleanWorktrees(repoDirs) {
	for (const repoDir of repoDirs) {
		assertCleanWorktree(repoDir);
	}
	return repoDirs;
}

export function branchExists(repoDir, branchName) {
	try {
		runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoDir });
		return true;
	} catch {
		return false;
	}
}

export function remoteBranchExists(repoDir, branchName) {
	try {
		const output = runGit(['ls-remote', '--heads', 'origin', branchName], { cwd: repoDir, capture: true });
		return output.trim().length > 0;
	} catch {
		return false;
	}
}

export function fetchOrigin(repoDir) {
	runGit(['fetch', 'origin'], { cwd: repoDir });
}

export function ensureLocalBranchTracking(repoDir, branchName) {
	if (branchExists(repoDir, branchName)) {
		return;
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
		return;
	}

	runGit(['checkout', '--orphan', branchName], { cwd: repoDir });
}

export function checkoutBranch(repoDir, branchName) {
	runGit(['checkout', branchName], { cwd: repoDir });
}

export function checkoutTaskBranchFromStaging(
	cwd,
	branchName,
	{ createIfMissing = true, pushIfCreated = false } = {},
) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);

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

	checkoutBranch(repoDir, STAGING_BRANCH);
	runGit(['checkout', '-b', branchName], { cwd: repoDir });
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

export function syncBranchWithOrigin(repoDir, branchName) {
	fetchOrigin(repoDir);
	if (!branchExists(repoDir, branchName) && remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
	} else {
		checkoutBranch(repoDir, branchName);
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['pull', '--rebase', 'origin', branchName], { cwd: repoDir });
	}
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
	const args = setUpstream ? ['push', '-u', 'origin', branchName] : ['push', 'origin', branchName];
	runGit(args, { cwd: repoDir });
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
	runGit(['push', 'origin', '--delete', branchName], { cwd: repoDir });
	return true;
}

export function mergeCurrentBranchIntoStaging(cwd, featureBranch) {
	return squashMergeBranchIntoStaging(cwd, featureBranch, `stage: ${featureBranch}`);
}

export function squashMergeBranchIntoStaging(cwd, featureBranch, message, { pushTarget = true } = {}) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	runGit(['merge', '--squash', featureBranch], { cwd: repoDir });
	let committed = false;
	if (repoHasStagedChanges(repoDir)) {
		runGit(['commit', '-m', message], { cwd: repoDir });
		committed = true;
	}
	if (pushTarget) {
		pushBranch(repoDir, STAGING_BRANCH);
	}
	return {
		repoDir,
		targetBranch: STAGING_BRANCH,
		committed,
		commitSha: headCommit(repoDir),
		pushed: pushTarget,
	};
}

export function currentManagedBranch(cwd = workspaceRoot()) {
	return currentBranch(gitWorkflowRoot(cwd));
}

export function isTaskBranch(branchName) {
	return Boolean(branchName)
		&& !RESERVED_BRANCHES.has(branchName)
		&& !branchName.startsWith('deprecated/');
}

export function assertFeatureBranch(cwd = workspaceRoot()) {
	const branchName = currentManagedBranch(cwd);
	if (!branchName) {
		throw new Error('Unable to determine the current git branch.');
	}
	if (!isTaskBranch(branchName)) {
		throw new Error(`Treeseed task commands only work on task branches. Current branch: ${branchName}`);
	}
	return branchName;
}

function gitLines(repoDir, args) {
	return runGit(args, { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function listTaskBranches(repoDir) {
	try {
		runGit(['fetch', 'origin'], { cwd: repoDir, capture: true });
	} catch {
		// Local-only repositories can still report local task branches.
	}
	const local = new Set(
		gitLines(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
			.filter(isTaskBranch),
	);
	const remote = new Set(
		gitLines(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
			.map((branchName) => branchName.replace(/^origin\//, ''))
			.filter(isTaskBranch),
	);
	const current = currentBranch(repoDir);
	const branches = [...new Set([...local, ...remote])].sort((left, right) => left.localeCompare(right));

	return branches.map((branchName) => {
		const ref = local.has(branchName) ? branchName : `origin/${branchName}`;
		return {
			name: branchName,
			head: runGit(['rev-parse', ref], { cwd: repoDir, capture: true }).trim(),
			lastCommitDate: runGit(['log', '-1', '--format=%cI', ref], { cwd: repoDir, capture: true }).trim(),
			lastCommitSubject: runGit(['log', '-1', '--format=%s', ref], { cwd: repoDir, capture: true }).trim(),
			local: local.has(branchName),
			remote: remote.has(branchName),
			current: branchName === current,
		};
	});
}

export function taskTagSlug(branchName) {
	return String(branchName)
		.trim()
		.replaceAll('\\', '/')
		.replace(/[^A-Za-z0-9._/-]+/g, '-')
		.replace(/\/+/g, '-')
		.replace(/^-+|-+$/g, '')
		|| 'task';
}

export function createDeprecatedTaskTag(repoDir, branchName, message) {
	const head = runGit(['rev-parse', branchName], { cwd: repoDir, capture: true }).trim();
	const shortSha = head.slice(0, 12);
	const tagName = `deprecated/${taskTagSlug(branchName)}/${shortSha}`;
	runGit(['tag', '-a', tagName, head, '-m', message], { cwd: repoDir });
	runGit(['push', 'origin', tagName], { cwd: repoDir, capture: true });
	return { tagName, head };
}

export function waitForStagingAutomation(repoDir) {
	if (process.env.TREESEED_STAGE_WAIT_MODE === 'skip' || process.env.TREESEED_GITHUB_AUTOMATION_MODE === 'stub') {
		return { status: 'skipped', reason: 'stubbed' };
	}

	try {
		run('gh', ['run', 'watch', '--branch', STAGING_BRANCH, '--exit-status'], { cwd: repoDir });
		return { status: 'completed', branch: STAGING_BRANCH };
	} catch (error) {
		throw new Error([
			'Treeseed stage could not confirm the staging deploy/checks completed.',
			error instanceof Error ? error.message : String(error),
			'Inspect GitHub Actions with `gh run list --branch staging` or your deployment provider logs.',
		].join('\n'));
	}
}

export function prepareReleaseBranches(cwd = workspaceRoot()) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	if (remoteBranchExists(repoDir, PRODUCTION_BRANCH) || branchExists(repoDir, PRODUCTION_BRANCH)) {
		syncBranchWithOrigin(repoDir, PRODUCTION_BRANCH);
		syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	}
	return repoDir;
}

export function mergeStagingIntoMain(cwd = workspaceRoot()) {
	return mergeBranchIntoTarget(cwd, {
		sourceBranch: STAGING_BRANCH,
		targetBranch: PRODUCTION_BRANCH,
		message: `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`,
		pushTarget: true,
	});
}

export function mergeBranchIntoTarget(
	cwd = workspaceRoot(),
	{ sourceBranch, targetBranch, message, pushTarget = true } = {},
) {
	const repoDir = prepareReleaseBranches(cwd);
	checkoutBranch(repoDir, targetBranch);
	if (remoteBranchExists(repoDir, targetBranch)) {
		runGit(['pull', '--rebase', 'origin', targetBranch], { cwd: repoDir });
	}
	runGit(['merge', '--no-ff', sourceBranch, '-m', message], { cwd: repoDir });
	pushBranch(repoDir, STAGING_BRANCH);
	if (pushTarget) {
		pushBranch(repoDir, targetBranch);
	}
	return {
		repoDir,
		targetBranch,
		commitSha: headCommit(repoDir),
		pushed: pushTarget,
	};
}
