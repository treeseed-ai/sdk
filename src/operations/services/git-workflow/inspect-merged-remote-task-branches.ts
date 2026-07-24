import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { run, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { collectMergeConflictReport, currentBranch, formatMergeConflictReport, gitStatusPorcelain, repoRoot } from '../treedx/workspaces/workspace-save.ts';
import { ensureSshPushUrlForOrigin } from '../repositories/git-remote-policy.ts';
import { runRepositoryGit, type GitRunnerMode } from '../operations/git-runner.ts';
import { createManagedToolEnv, resolveToolBinary } from '../../../entrypoints/runtime/managed-dependencies.ts';
import { assertCleanWorktree, branchExists, checkoutBranch, fetchOrigin, gitWorkflowRoot, remoteBranchExists, remoteHeadCommit } from './inspect-detached-head-repair.ts';
import { PRODUCTION_BRANCH, RESERVED_BRANCHES, STAGING_BRANCH, abortInProgressMerge, headCommit, repoHasStagedChanges, resolveGeneratedPackageMetadataConflicts, runGit, runGitAllowFailure } from './staging-branch.ts';
import { pushBranch, syncBranchWithOrigin } from './checkout-task-branch-from-staging.ts';

export function inspectMergedRemoteTaskBranches(repoDir) {
	fetchOrigin(repoDir);
	const targets = [STAGING_BRANCH, PRODUCTION_BRANCH]
		.map((branch) => ({ branch, head: remoteHeadCommit(repoDir, branch) }))
		.filter((target): target is { branch: string; head: string } => Boolean(target.head));
	return listTaskBranches(repoDir, { fetch: false })
		.filter((branch) => branch.remote)
		.map((branch) => {
			const head = remoteHeadCommit(repoDir, branch.name);
			const mergedTarget = head
				? targets.find((target) => runGitAllowFailure(['merge-base', '--is-ancestor', head, target.head], { cwd: repoDir }).status === 0)
				: undefined;
			return {
				branch: branch.name,
				head,
				current: branch.current,
				mergedInto: mergedTarget?.branch ?? null,
			};
		});
}

export function mergeCurrentBranchIntoStaging(cwd, featureBranch) {
	return squashMergeBranchIntoStaging(cwd, featureBranch, `stage: ${featureBranch}`);
}

export function squashMergeBranchIntoStaging(cwd, featureBranch, message, { pushTarget = true, reportGeneratedMetadataReconciliation = true } = {}) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	let generatedMetadataReconciliation = null;
	try {
		runGit(['merge', '--squash', featureBranch], { cwd: repoDir, capture: true });
	} catch (error) {
		const reconciliation = resolveGeneratedPackageMetadataConflicts(repoDir);
		if (!reconciliation.resolved) {
			const report = collectMergeConflictReport(repoDir);
			const mergeAborted = abortInProgressMerge(repoDir);
			const conflictError = new Error(formatMergeConflictReport(report, repoDir, STAGING_BRANCH));
			Object.assign(conflictError, {
				cause: error,
				mergeAborted,
				mergeConflictReport: report,
			});
			throw conflictError;
		}
		if (reportGeneratedMetadataReconciliation) {
			console.log(`Resolving generated package metadata reconciliation for ${reconciliation.reconciledFiles.join(', ')}.`);
		}
		generatedMetadataReconciliation = {
			...reconciliation,
			commitSha: null,
		};
	}
	let committed = false;
	if (repoHasStagedChanges(repoDir)) {
		runGit(['commit', '-m', message], { cwd: repoDir });
		committed = true;
	}
	const commitSha = headCommit(repoDir);
	if (generatedMetadataReconciliation) {
		generatedMetadataReconciliation.commitSha = commitSha;
	}
	if (pushTarget) {
		pushBranch(repoDir, STAGING_BRANCH);
	}
	return {
		repoDir,
		targetBranch: STAGING_BRANCH,
		committed,
		commitSha,
		pushed: pushTarget,
		generatedMetadataReconciliation,
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

export function gitLines(repoDir, args) {
	return runGit(args, { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function listTaskBranches(repoDir, options: { fetch?: boolean } = {}) {
	if (options.fetch !== false) {
		try {
			runGit(['fetch', 'origin'], { cwd: repoDir, capture: true });
		} catch {
			// Local-only repositories can still report local task branches.
		}
	}
	const local = new Set(
		gitLines(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
			.filter(isTaskBranch),
	);
	const remote = new Set(
		gitLines(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
			.filter((branchName) => branchName.startsWith('origin/') && branchName !== 'origin/HEAD')
			.map((branchName) => branchName.replace(/^origin\//, ''))
			.filter(isTaskBranch),
	);
	const current = currentBranch(repoDir);
	const branches = [...new Set([...local, ...remote])].sort((left, right) => left.localeCompare(right));

	return branches.map((branchName) => {
		const ref = local.has(branchName) ? `refs/heads/${branchName}` : `refs/remotes/origin/${branchName}`;
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

export function shouldRetryFailedStagingAutomation(status: string | null, conclusion: string | null) {
	return status === 'completed' && Boolean(conclusion) && conclusion !== 'success';
}

export function waitForStagingAutomation(repoDir, env: NodeJS.ProcessEnv = process.env) {
	if (process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return { status: 'skipped', reason: 'disabled' };
	}

	try {
		const gh = resolveToolBinary('gh', { env });
		if (!gh) {
			throw new Error('GitHub CLI `gh` is unavailable.');
		}
		const headSha = remoteHeadCommit(repoDir, STAGING_BRANCH);
		let runId: number | null = null;
		let runStatus: string | null = null;
		let runConclusion: string | null = null;
		for (let attempt = 0; attempt < 120 && runId == null; attempt += 1) {
			const output = run(gh, [
				'run', 'list',
				'--workflow', 'deploy.yml',
				'--branch', STAGING_BRANCH,
				'--commit', headSha,
				'--limit', '1',
				'--json', 'databaseId,status,conclusion',
			], {
				cwd: repoDir,
				env: createManagedToolEnv(env),
				capture: true,
			});
			const rows = JSON.parse(output || '[]') as Array<{ databaseId?: number; status?: string; conclusion?: string }>;
			runId = typeof rows[0]?.databaseId === 'number' ? rows[0].databaseId : null;
			runStatus = typeof rows[0]?.status === 'string' ? rows[0].status : null;
			runConclusion = typeof rows[0]?.conclusion === 'string' ? rows[0].conclusion : null;
			if (runId == null) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
		}
		if (runId == null) throw new Error(`No deploy.yml run appeared for ${headSha}.`);
		if (shouldRetryFailedStagingAutomation(runStatus, runConclusion)) {
			run(gh, ['run', 'rerun', String(runId), '--failed'], {
				cwd: repoDir,
				env: createManagedToolEnv(env),
			});
		}
		run(gh, ['run', 'watch', String(runId), '--exit-status'], {
			cwd: repoDir,
			env: createManagedToolEnv(env),
		});
		return { status: 'completed', branch: STAGING_BRANCH, headSha, runId };
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
		allowUnrelatedHistories: false,
	});
}

export function mergeBranchIntoTarget(
	cwd = workspaceRoot(),
	{ sourceBranch, targetBranch, message, pushTarget = true, quietMerge = false, allowUnrelatedHistories = false } = {},
) {
	const repoDir = prepareReleaseBranches(cwd);
	checkoutBranch(repoDir, targetBranch);
	if (remoteBranchExists(repoDir, targetBranch)) {
		runGit(['merge', '--ff-only', `origin/${targetBranch}`], { cwd: repoDir });
	}
	const mergeArgs = ['merge', '--no-ff'];
	if (allowUnrelatedHistories) {
		mergeArgs.push('--allow-unrelated-histories');
	}
	mergeArgs.push(sourceBranch, '-m', message);
	runGit(mergeArgs, { cwd: repoDir, capture: quietMerge });
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
