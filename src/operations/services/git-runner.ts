import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export type TreeseedGitRunnerMode = 'read' | 'mutate';

export type TreeseedGitRunnerResult = {
	status: number | null;
	stdout: string;
	stderr: string;
};

export type TreeseedGitLockDiagnostic = {
	repoRoot: string;
	commonGitDir: string | null;
	indexLockPath: string | null;
	indexLockExists: boolean;
	safeToRepair: boolean;
	reason: string;
	removed: boolean;
};

export type TreeseedGitWorkspaceLockDiagnostics = {
	root: TreeseedGitLockDiagnostic;
	repositories: TreeseedGitLockDiagnostic[];
};

type RunOptions = {
	cwd: string;
	mode?: TreeseedGitRunnerMode;
	allowFailure?: boolean;
	timeoutMs?: number;
	maxBuffer?: number;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
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
		env: options.env ? { ...process.env, ...options.env } : process.env,
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

function resolveGitRoot(cwd: string) {
	const result = gitSync(['rev-parse', '--show-toplevel'], { cwd, allowFailure: true });
	const raw = result.status === 0 ? result.stdout.trim() : '';
	return raw || cwd;
}

function lockRoot(commonGitDir: string | null) {
	return commonGitDir ? resolve(commonGitDir, 'treeseed', 'locks') : resolve(tmpdir(), 'treeseed-git-locks');
}

function lockPathFor(commonGitDir: string | null) {
	const base = lockRoot(commonGitDir);
	return resolve(base, 'git-mutation.lock');
}

function lockMetadataPath(lockPath: string) {
	return resolve(lockPath, 'owner.json');
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

function inspectIndexLock(cwd: string): TreeseedGitLockDiagnostic {
	const repoRoot = resolveGitRoot(cwd);
	const commonGitDir = resolveCommonGitDir(cwd);
	const indexLockPath = commonGitDir ? resolve(commonGitDir, 'index.lock') : null;
	if (!indexLockPath || !existsSync(indexLockPath)) {
		return {
			repoRoot,
			commonGitDir,
			indexLockPath,
			indexLockExists: false,
			safeToRepair: false,
			reason: 'no index.lock present',
			removed: false,
		};
	}
	const stat = statSync(indexLockPath);
	const ageMs = Date.now() - stat.mtimeMs;
	const ps = spawnSync('ps', ['-eo', 'pid=,args='], { encoding: 'utf8', stdio: 'pipe' });
	const activeGitForRepo = (ps.stdout ?? '').split(/\r?\n/u).some((line) =>
		line.includes('git ') && (line.includes(repoRoot) || line.includes(commonGitDir ?? repoRoot)));
	const safeToRepair = ageMs > 10 * 60 * 1000 && !activeGitForRepo;
	return {
		repoRoot,
		commonGitDir,
		indexLockPath,
		indexLockExists: true,
		safeToRepair,
		reason: safeToRepair
			? 'index.lock is older than 10 minutes and no active Git process references this repo'
			: 'index.lock may be owned by an active or recent Git process',
		removed: false,
	};
}

export function inspectTreeseedGitLocks(cwd: string): TreeseedGitLockDiagnostic {
	return inspectIndexLock(cwd);
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
	const repositories = workspaceGitRepositories(cwd).map((repo) => inspectIndexLock(repo));
	return {
		root: repositories[0] ?? inspectIndexLock(cwd),
		repositories,
	};
}

export function recoverTreeseedGitLocks(cwd: string, { execute = false, all = false }: { execute?: boolean; all?: boolean } = {}): TreeseedGitLockDiagnostic | TreeseedGitWorkspaceLockDiagnostics {
	if (all) {
		const repositories = workspaceGitRepositories(cwd).map((repo) => recoverTreeseedGitLocks(repo, { execute, all: false }) as TreeseedGitLockDiagnostic);
		return {
			root: repositories[0] ?? inspectIndexLock(cwd),
			repositories,
		};
	}
	const diagnostic = inspectIndexLock(cwd);
	if (execute && diagnostic.indexLockPath && diagnostic.indexLockExists && diagnostic.safeToRepair) {
		rmSync(diagnostic.indexLockPath, { force: true });
		return { ...diagnostic, removed: true };
	}
	return diagnostic;
}

export function runTreeseedGit(args: string[], options: RunOptions): TreeseedGitRunnerResult {
	if ((options.mode ?? 'read') === 'read') {
		return gitSync(args, options);
	}
	const commonGitDir = resolveCommonGitDir(options.cwd);
	const release = acquireMutationLock(commonGitDir);
	try {
		const indexLock = inspectIndexLock(options.cwd);
		if (indexLock.indexLockExists) {
			if (!indexLock.safeToRepair || !indexLock.indexLockPath) {
				throw new Error(`Git index is locked for ${indexLock.repoRoot}: ${indexLock.reason}. Run trsd recover --git-locks --plan for diagnostics.`);
			}
			rmSync(indexLock.indexLockPath, { force: true });
		}
		return gitSync(args, options);
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
