import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

export type TreeseedGitRunnerMode = 'read' | 'mutate';

export type TreeseedGitRunnerResult = {
	status: number | null;
	stdout: string;
	stderr: string;
};

export type TreeseedGitLockKind =
	| 'index'
	| 'ref'
	| 'packed-refs'
	| 'head'
	| 'treeseed-mutation'
	| 'unknown';

export type TreeseedGitLockProcessHint = {
	pid: number;
	command: string;
};

export type TreeseedGitLockDiagnostic = {
	repoRoot: string;
	commonGitDir: string | null;
	lockPath: string | null;
	relativeLockPath: string | null;
	kind: TreeseedGitLockKind;
	exists: boolean;
	indexLockPath: string | null;
	indexLockExists: boolean;
	safeToRepair: boolean;
	reason: string;
	removed: boolean;
	ageMs: number | null;
	activeGitProcessHints: TreeseedGitLockProcessHint[];
};

export type TreeseedGitWorkspaceLockDiagnostics = {
	root: TreeseedGitLockDiagnostic | TreeseedGitLockDiagnostic[];
	repositories: Array<TreeseedGitLockDiagnostic | {
		repoRoot: string;
		locks: TreeseedGitLockDiagnostic[];
	}>;
	summary?: {
		repositoriesChecked: number;
		locksPresent: number;
		safeToRepair: number;
		unsafe: number;
		removed: number;
	};
};

type RunOptions = {
	cwd: string;
	mode?: TreeseedGitRunnerMode;
	allowFailure?: boolean;
	timeoutMs?: number;
	maxBuffer?: number;
};

export type TreeseedGitBatchOperation = RunOptions & {
	args: string[];
};

function pidAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function gitSync(args: string[], options: RunOptions): TreeseedGitRunnerResult {
	const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
		cwd: options.cwd,
		encoding: 'utf8',
		stdio: 'pipe',
		timeout: options.timeoutMs,
		maxBuffer: options.maxBuffer ?? 1024 * 1024 * 32,
	};
	const result = spawnSync('git', args, spawnOptions);
	const output = {
		status: result.status,
		stdout: result.stdout ?? '',
		stderr: result.stderr ?? '',
	};
	if (result.status !== 0 && !options.allowFailure) {
		throw new Error(output.stderr.trim() || output.stdout.trim() || `git ${args.join(' ')} failed in ${options.cwd}.`);
	}
	return output;
}

class TreeseedGitLockError extends Error {
	diagnostics: TreeseedGitLockDiagnostic[];
	command: string[];
	cwd: string;

	constructor(message: string, input: {
		diagnostics: TreeseedGitLockDiagnostic[];
		command: string[];
		cwd: string;
	}) {
		super(message);
		this.name = 'TreeseedGitLockError';
		this.diagnostics = input.diagnostics;
		this.command = input.command;
		this.cwd = input.cwd;
	}
}

export function classifyTreeseedGitMode(args: string[]): TreeseedGitRunnerMode {
	const command = args[0] ?? '';
	if (command === 'remote' && args[1] !== 'set-url') {
		return 'read';
	}
	if (command === 'tag' && (args[1] === '-l' || args[1] === '--list')) {
		return 'read';
	}
	if (command === 'merge-base' && args.includes('--is-ancestor')) {
		return 'read';
	}
	return new Set([
		'add',
		'checkout',
		'commit',
		'fetch',
		'merge',
		'pull',
		'push',
		'rebase',
		'reset',
		'restore',
		'switch',
		'tag',
		'worktree',
	]).has(command) ? 'mutate' : 'read';
}

function resolveCommonGitDir(cwd: string) {
	const result = gitSync(['rev-parse', '--git-common-dir'], { cwd, allowFailure: true });
	const raw = result.status === 0 ? result.stdout.trim() : '';
	if (!raw) return null;
	return resolve(cwd, raw);
}

function resolveGitDir(cwd: string) {
	const result = gitSync(['rev-parse', '--git-dir'], { cwd, allowFailure: true });
	const raw = result.status === 0 ? result.stdout.trim() : '';
	if (!raw) return null;
	return resolve(cwd, raw);
}

function resolveGitRoot(cwd: string) {
	const result = gitSync(['rev-parse', '--show-toplevel'], { cwd, allowFailure: true });
	const raw = result.status === 0 ? result.stdout.trim() : '';
	return raw || cwd;
}

function lockRoot(commonGitDir: string | null) {
	return commonGitDir ? resolve(commonGitDir, 'treeseed', 'locks') : resolve(process.cwd(), '.treeseed', 'locks');
}

function lockPathFor(commonGitDir: string | null) {
	const base = lockRoot(commonGitDir);
	return resolve(base, 'git-mutation.lock');
}

function lockMetadataPath(lockPath: string) {
	return resolve(lockPath, 'owner.json');
}

function isWithin(parent: string, candidate: string) {
	const rel = relative(parent, candidate);
	return rel === '' || (!!rel && !rel.startsWith('..') && !rel.startsWith('/'));
}

function staleTreeseedLock(lockPath: string) {
	if (!existsSync(lockPath)) return false;
	try {
		const metadata = JSON.parse(readFileSync(lockMetadataPath(lockPath), 'utf8')) as { pid?: unknown; updatedAt?: unknown };
		const pid = typeof metadata.pid === 'number' ? metadata.pid : null;
		if (pid && !pidAlive(pid)) return true;
		const updatedAt = typeof metadata.updatedAt === 'string' ? Date.parse(metadata.updatedAt) : Number.NaN;
		return Number.isFinite(updatedAt) && Date.now() - updatedAt > 30 * 60 * 1000;
	} catch {
		return false;
	}
}

function acquireMutationLock(commonGitDir: string | null) {
	const path = lockPathFor(commonGitDir);
	mkdirSync(dirname(path), { recursive: true });
	for (let attempt = 0; attempt < 80; attempt += 1) {
		try {
			mkdirSync(path);
			writeFileSync(lockMetadataPath(path), `${JSON.stringify({
				pid: process.pid,
				host: process.env.HOSTNAME ?? null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			}, null, 2)}\n`, 'utf8');
			return () => rmSync(path, { recursive: true, force: true });
		} catch {
			if (staleTreeseedLock(path)) {
				rmSync(path, { recursive: true, force: true });
				continue;
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125);
		}
	}
	throw new Error(`Timed out waiting for Treeseed Git mutation lock ${path}.`);
}

function activeGitProcessHints(repoRoot: string, commonGitDir: string | null, gitDir: string | null, lockPath?: string | null): TreeseedGitLockProcessHint[] {
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

function absentDiagnostic(cwd: string, kind: TreeseedGitLockKind = 'index'): TreeseedGitLockDiagnostic {
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

function classifyGitLockPath(baseGitDir: string, lockPath: string): TreeseedGitLockKind {
	const rel = relative(baseGitDir, lockPath).replace(/\\/gu, '/');
	if (rel === 'index.lock') return 'index';
	if (rel === 'packed-refs.lock') return 'packed-refs';
	if (rel === 'HEAD.lock') return 'head';
	if (rel === 'treeseed/locks/git-mutation.lock') return 'treeseed-mutation';
	if (/^refs\/.+\.lock$/u.test(rel)) return 'ref';
	return 'unknown';
}

function staleThresholdMs(kind: TreeseedGitLockKind) {
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

function lockDiagnostic(cwd: string, lockPath: string): TreeseedGitLockDiagnostic {
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

function collectLockPaths(commonGitDir: string, gitDir: string): string[] {
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

function inspectGitLocks(cwd: string): TreeseedGitLockDiagnostic[] {
	const commonGitDir = resolveCommonGitDir(cwd);
	const gitDir = resolveGitDir(cwd);
	if (!commonGitDir || !gitDir) return [absentDiagnostic(cwd)];
	const diagnostics = collectLockPaths(commonGitDir, gitDir)
		.filter((lockPath) => existsSync(lockPath))
		.map((lockPath) => lockDiagnostic(cwd, lockPath));
	return diagnostics.length > 0 ? diagnostics : [absentDiagnostic(cwd)];
}

function presentLocks(cwd: string) {
	return inspectGitLocks(cwd).filter((entry) => entry.exists);
}

function primaryDiagnostic(cwd: string) {
	const diagnostics = inspectGitLocks(cwd);
	const index = diagnostics.find((entry) => entry.kind === 'index' && entry.exists);
	const present = diagnostics.find((entry) => entry.exists);
	return index ?? present ?? diagnostics[0] ?? absentDiagnostic(cwd);
}

function inspectIndexLock(cwd: string): TreeseedGitLockDiagnostic {
	const repoRoot = resolveGitRoot(cwd);
	const commonGitDir = resolveCommonGitDir(cwd);
	const gitDir = resolveGitDir(cwd);
	const indexLockPath = gitDir ? resolve(gitDir, 'index.lock') : null;
	if (!indexLockPath || !existsSync(indexLockPath)) {
		return absentDiagnostic(cwd);
	}
	return lockDiagnostic(cwd, indexLockPath);
}

function waitForIndexLockToClear(cwd: string) {
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

function workspaceGitRepositories(cwd: string) {
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

function repairSafeLocks(cwd: string) {
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

function gitLockFailure(output: TreeseedGitRunnerResult) {
	const text = `${output.stderr}\n${output.stdout}`;
	return /cannot lock ref|Unable to create .*\.lock|Another git process seems to be running|index\.lock|packed-refs\.lock|HEAD\.lock|File exists/iu.test(text);
}

function gitLockErrorMessage(cwd: string, args: string[], diagnostics: TreeseedGitLockDiagnostic[], original: TreeseedGitRunnerResult, retry?: TreeseedGitRunnerResult) {
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
