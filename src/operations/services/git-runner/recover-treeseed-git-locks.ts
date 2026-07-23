import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { RunOptions, TreeseedGitBatchOperation, TreeseedGitLockDiagnostic, TreeseedGitLockError, TreeseedGitRunnerResult, TreeseedGitWorkspaceLockDiagnostics, acquireMutationLock, gitSync, resolveCommonGitDir, resolveGitRoot } from './treeseed-git-runner-mode.ts';
import { absentDiagnostic, inspectGitLocks, presentLocks, workspaceGitRepositories } from './active-git-process-hints.ts';

export function recoverTreeseedGitLocks(cwd: string, { execute = false, all = false }: { execute?: boolean; all?: boolean } = {}): TreeseedGitLockDiagnostic | TreeseedGitWorkspaceLockDiagnostics {
	if (all) {
		const repositories = workspaceGitRepositories(cwd).map((repo) => ({
			repoRoot: resolveGitRoot(repo),
			locks: recoverTreeseedGitLocks(repo, { execute, all: false }) as TreeseedGitLockDiagnostic[],
		}));
		const allLocks = repositories.flatMap((repo) => repo.locks).filter((entry) => entry.exists);
		return {
			root: repositories[0]?.locks ?? [absentDiagnostic(cwd)],
			repositories,
			summary: {
				repositoriesChecked: repositories.length,
				locksPresent: allLocks.length,
				safeToRepair: allLocks.filter((entry) => entry.safeToRepair).length,
				unsafe: allLocks.filter((entry) => !entry.safeToRepair).length,
				removed: allLocks.filter((entry) => entry.removed).length,
			},
		};
	}
	const diagnostics = inspectGitLocks(cwd);
	return diagnostics.map((diagnostic) => {
		if (execute && diagnostic.lockPath && diagnostic.exists && diagnostic.safeToRepair) {
			rmSync(diagnostic.lockPath, { force: true });
			return { ...diagnostic, removed: true };
		}
		return diagnostic;
	});
}

export function repairSafeLocks(cwd: string) {
	const diagnostics = inspectGitLocks(cwd);
	const repaired: TreeseedGitLockDiagnostic[] = [];
	for (const diagnostic of diagnostics) {
		if (diagnostic.exists && diagnostic.safeToRepair && diagnostic.lockPath) {
			rmSync(diagnostic.lockPath, { force: true });
			repaired.push({ ...diagnostic, removed: true });
		}
	}
	return repaired;
}

export function gitLockFailure(output: TreeseedGitRunnerResult) {
	const text = `${output.stderr}\n${output.stdout}`;
	return /cannot lock ref|Unable to create .*\.lock|Another git process seems to be running|index\.lock|packed-refs\.lock|HEAD\.lock|File exists/iu.test(text);
}

export function gitLockErrorMessage(cwd: string, args: string[], diagnostics: TreeseedGitLockDiagnostic[], original: TreeseedGitRunnerResult, retry?: TreeseedGitRunnerResult) {
	const present = diagnostics.filter((entry) => entry.exists);
	const details = present.length > 0
		? present.map((entry) => `${entry.repoRoot}: ${entry.relativeLockPath ?? entry.lockPath} safe=${entry.safeToRepair ? 'yes' : 'no'} - ${entry.reason}`).join('\n')
		: 'No known Git lock files were present after the failure.';
	return [
		`Git command failed because the repository appears to be locked: git ${args.join(' ')}`,
		`Working directory: ${cwd}`,
		details,
		'Run `npx trsd recover --git-locks --json` for diagnostics.',
		`Original Git error: ${(original.stderr || original.stdout).trim()}`,
		retry ? `Retry Git error: ${(retry.stderr || retry.stdout).trim()}` : null,
	].filter(Boolean).join('\n');
}

export function runTreeseedGit(args: string[], options: RunOptions): TreeseedGitRunnerResult {
	if ((options.mode ?? 'read') === 'read') {
		return gitSync(args, options);
	}
	const commonGitDir = resolveCommonGitDir(options.cwd);
	const release = acquireMutationLock(commonGitDir);
	try {
		const locks = presentLocks(options.cwd);
		const unsafe = locks.find((entry) => !entry.safeToRepair);
		if (unsafe) {
			throw new TreeseedGitLockError(
				`Git ${unsafe.kind} lock is not safe to remove for ${unsafe.repoRoot}: ${unsafe.reason}. Run npx trsd recover --git-locks --json for diagnostics.`,
				{ diagnostics: locks, command: args, cwd: options.cwd },
			);
		}
		repairSafeLocks(options.cwd);
		const first = gitSync(args, { ...options, allowFailure: true });
		if (first.status === 0) return first;
		if (!gitLockFailure(first)) {
			if (options.allowFailure) return first;
			throw new Error(first.stderr.trim() || first.stdout.trim() || `git ${args.join(' ')} failed in ${options.cwd}.`);
		}
		const afterFailure = presentLocks(options.cwd);
		const unsafeAfterFailure = afterFailure.find((entry) => !entry.safeToRepair);
		if (unsafeAfterFailure) {
			throw new TreeseedGitLockError(
				gitLockErrorMessage(options.cwd, args, afterFailure, first),
				{ diagnostics: afterFailure, command: args, cwd: options.cwd },
			);
		}
		repairSafeLocks(options.cwd);
		const retry = gitSync(args, { ...options, allowFailure: true });
		if (retry.status === 0) return retry;
		if (options.allowFailure) return retry;
		throw new TreeseedGitLockError(
			gitLockErrorMessage(options.cwd, args, afterFailure, first, retry),
			{ diagnostics: afterFailure, command: args, cwd: options.cwd },
		);
	} finally {
		release();
	}
}

export function runTreeseedGitText(args: string[], options: RunOptions): string {
	return runTreeseedGit(args, options).stdout.trim();
}

export function runTreeseedGitOk(args: string[], options: Omit<RunOptions, 'allowFailure'>): boolean {
	return runTreeseedGit(args, { ...options, allowFailure: true }).status === 0;
}

export async function runTreeseedGitBatch(
	operations: TreeseedGitBatchOperation[],
	_options: { repoSerialization?: boolean } = {},
): Promise<TreeseedGitRunnerResult[]> {
	const results: TreeseedGitRunnerResult[] = [];
	for (const operation of operations) {
		results.push(runTreeseedGit(operation.args, operation));
	}
	return results;
}
