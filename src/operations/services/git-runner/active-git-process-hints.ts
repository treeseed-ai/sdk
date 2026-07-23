import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { TreeseedGitLockDiagnostic, TreeseedGitLockKind, TreeseedGitLockProcessHint, TreeseedGitWorkspaceLockDiagnostics, isWithin, resolveCommonGitDir, resolveGitDir, resolveGitRoot } from './treeseed-git-runner-mode.ts';

export function activeGitProcessHints(repoRoot: string, commonGitDir: string | null, gitDir: string | null, lockPath?: string | null): TreeseedGitLockProcessHint[] {
	const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', stdio: 'pipe' });
	return (ps.stdout ?? '').split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const match = /^(\d+)\s+(.*)$/u.exec(line);
			return match ? { pid: Number(match[1]), command: match[2] ?? '' } : null;
		})
		.filter((entry): entry is TreeseedGitLockProcessHint => entry !== null)
		.filter((entry) => {
			if (!/(^|[\/\s])git(\s|$)/u.test(entry.command)) return false;
			return entry.command.includes(repoRoot)
				|| (commonGitDir ? entry.command.includes(commonGitDir) : false)
				|| (gitDir ? entry.command.includes(gitDir) : false)
				|| (lockPath ? entry.command.includes(lockPath) || entry.command.includes(dirname(lockPath)) : false);
		});
}

export function absentDiagnostic(cwd: string, kind: TreeseedGitLockKind = 'index'): TreeseedGitLockDiagnostic {
	const repoRoot = resolveGitRoot(cwd);
	const commonGitDir = resolveCommonGitDir(cwd);
	const gitDir = resolveGitDir(cwd);
	const indexLockPath = gitDir ? resolve(gitDir, 'index.lock') : null;
	return {
		repoRoot,
		commonGitDir,
		lockPath: indexLockPath,
		relativeLockPath: indexLockPath && commonGitDir ? relative(commonGitDir, indexLockPath) : null,
		kind,
		exists: false,
		indexLockPath,
		indexLockExists: false,
		safeToRepair: false,
		reason: 'no Git lock present',
		removed: false,
		ageMs: null,
		activeGitProcessHints: [],
	};
}

export function classifyGitLockPath(baseGitDir: string, lockPath: string): TreeseedGitLockKind {
	const rel = relative(baseGitDir, lockPath).replace(/\\/gu, '/');
	if (rel === 'index.lock') return 'index';
	if (rel === 'packed-refs.lock') return 'packed-refs';
	if (rel === 'HEAD.lock') return 'head';
	if (rel === 'treeseed/locks/git-mutation.lock') return 'treeseed-mutation';
	if (/^refs\/.+\.lock$/u.test(rel)) return 'ref';
	return 'unknown';
}

export function staleThresholdMs(kind: TreeseedGitLockKind) {
	switch (kind) {
		case 'ref':
			return 30 * 1000;
		case 'packed-refs':
		case 'head':
			return 2 * 60 * 1000;
		case 'treeseed-mutation':
			return 30 * 60 * 1000;
		case 'index':
			return 10 * 60 * 1000;
		default:
			return Number.POSITIVE_INFINITY;
	}
}

export function lockDiagnostic(cwd: string, lockPath: string): TreeseedGitLockDiagnostic {
	const repoRoot = resolveGitRoot(cwd);
	const commonGitDir = resolveCommonGitDir(cwd);
	const gitDir = resolveGitDir(cwd);
	const resolvedLockPath = resolve(lockPath);
	const baseGitDir = gitDir && isWithin(gitDir, resolvedLockPath)
		? gitDir
		: commonGitDir && isWithin(commonGitDir, resolvedLockPath)
			? commonGitDir
			: null;
	const kind = baseGitDir
		? classifyGitLockPath(baseGitDir, resolvedLockPath)
		: 'unknown';
	const indexLockPath = gitDir ? resolve(gitDir, 'index.lock') : null;
	if (!baseGitDir || !existsSync(resolvedLockPath)) {
		return {
			...absentDiagnostic(cwd, kind),
			lockPath: resolvedLockPath,
			relativeLockPath: baseGitDir ? relative(baseGitDir, resolvedLockPath) : null,
		};
	}
	const stat = statSync(resolvedLockPath);
	const ageMs = Date.now() - stat.mtimeMs;
	const activeHints = activeGitProcessHints(repoRoot, commonGitDir, gitDir, resolvedLockPath);
	const insideGitDir = isWithin(baseGitDir, resolvedLockPath);
	const safeToRepair = insideGitDir
		&& kind !== 'unknown'
		&& ageMs > staleThresholdMs(kind)
		&& activeHints.length === 0;
	return {
		repoRoot,
		commonGitDir,
		lockPath: resolvedLockPath,
		relativeLockPath: relative(baseGitDir, resolvedLockPath),
		kind,
		exists: true,
		indexLockPath,
		indexLockExists: resolvedLockPath === indexLockPath,
		safeToRepair,
		reason: safeToRepair
			? `${kind} lock is stale and no active Git process references this repo`
			: !insideGitDir
				? 'lock path is outside the Git directory'
				: kind === 'unknown'
					? 'unknown Git lock kind is not safe to remove automatically'
					: activeHints.length > 0
						? `active Git process references this repo: ${activeHints.map((hint) => hint.pid).join(', ')}`
						: `${kind} lock may be owned by a recent Git process`,
		removed: false,
		ageMs,
		activeGitProcessHints: activeHints,
	};
}

export function collectLockPaths(commonGitDir: string, gitDir: string): string[] {
	const paths = [
		resolve(gitDir, 'index.lock'),
		resolve(gitDir, 'HEAD.lock'),
		resolve(commonGitDir, 'packed-refs.lock'),
	];
	const refRoots = [
		resolve(commonGitDir, 'refs'),
		resolve(gitDir, 'refs'),
	];
	for (const refRoot of refRoots) {
		if (!existsSync(refRoot)) continue;
		const stack = [refRoot];
		while (stack.length > 0) {
			const current = stack.pop();
			if (!current) continue;
			for (const entry of readdirSync(current, { withFileTypes: true })) {
				const next = resolve(current, entry.name);
				if (entry.isDirectory()) {
					stack.push(next);
				} else if (entry.isFile() && entry.name.endsWith('.lock')) {
					paths.push(next);
				}
			}
		}
	}
	return [...new Set(paths)];
}

export function inspectGitLocks(cwd: string): TreeseedGitLockDiagnostic[] {
	const commonGitDir = resolveCommonGitDir(cwd);
	const gitDir = resolveGitDir(cwd);
	if (!commonGitDir || !gitDir) return [absentDiagnostic(cwd)];
	const diagnostics = collectLockPaths(commonGitDir, gitDir)
		.filter((lockPath) => existsSync(lockPath))
		.map((lockPath) => lockDiagnostic(cwd, lockPath));
	return diagnostics.length > 0 ? diagnostics : [absentDiagnostic(cwd)];
}

export function presentLocks(cwd: string) {
	return inspectGitLocks(cwd).filter((entry) => entry.exists);
}

export function primaryDiagnostic(cwd: string) {
	const diagnostics = inspectGitLocks(cwd);
	const index = diagnostics.find((entry) => entry.kind === 'index' && entry.exists);
	const present = diagnostics.find((entry) => entry.exists);
	return index ?? present ?? diagnostics[0] ?? absentDiagnostic(cwd);
}

export function inspectIndexLock(cwd: string): TreeseedGitLockDiagnostic {
	const repoRoot = resolveGitRoot(cwd);
	const commonGitDir = resolveCommonGitDir(cwd);
	const gitDir = resolveGitDir(cwd);
	const indexLockPath = gitDir ? resolve(gitDir, 'index.lock') : null;
	if (!indexLockPath || !existsSync(indexLockPath)) {
		return absentDiagnostic(cwd);
	}
	return lockDiagnostic(cwd, indexLockPath);
}

export function waitForIndexLockToClear(cwd: string) {
	let diagnostic = inspectIndexLock(cwd);
	if (!diagnostic.indexLockExists) {
		return diagnostic;
	}
	for (let attempt = 0; attempt < 40; attempt += 1) {
		Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125);
		diagnostic = inspectIndexLock(cwd);
		if (!diagnostic.indexLockExists) {
			return diagnostic;
		}
	}
	return diagnostic;
}

export function inspectTreeseedGitLocks(cwd: string): TreeseedGitLockDiagnostic {
	return primaryDiagnostic(cwd);
}

export function inspectTreeseedGitLockSet(cwd: string): TreeseedGitLockDiagnostic[] {
	return inspectGitLocks(cwd);
}

export function workspaceGitRepositories(cwd: string) {
	const root = resolveGitRoot(cwd);
	const repositories = new Set<string>([root]);
	const packagesDir = resolve(root, 'packages');
	if (existsSync(packagesDir)) {
		for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = resolve(packagesDir, entry.name);
			if (existsSync(resolve(dir, '.git'))) repositories.add(dir);
		}
	}
	const worktreesDir = resolve(root, '.treeseed', 'worktrees');
	if (existsSync(worktreesDir)) {
		for (const entry of readdirSync(worktreesDir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const dir = resolve(worktreesDir, entry.name);
			if (existsSync(resolve(dir, '.git'))) repositories.add(dir);
		}
	}
	return [...repositories];
}

export function inspectTreeseedWorkspaceGitLocks(cwd: string): TreeseedGitWorkspaceLockDiagnostics {
	const repositories = workspaceGitRepositories(cwd).map((repo) => ({
		repoRoot: resolveGitRoot(repo),
		locks: inspectGitLocks(repo),
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
