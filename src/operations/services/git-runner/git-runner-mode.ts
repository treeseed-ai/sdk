import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { activeGitProcessHints } from './active-git-process-hints.ts';

export type GitRunnerMode = 'read' | 'mutate';

export type GitRunnerResult = {
	status: number | null;
	stdout: string;
	stderr: string;
};

export type GitLockKind =
	| 'index'
	| 'ref'
	| 'packed-refs'
	| 'head'
	| 'treeseed-mutation'
	| 'unknown';

export type GitLockProcessHint = {
	pid: number;
	command: string;
};

export type GitLockDiagnostic = {
	repoRoot: string;
	commonGitDir: string | null;
	lockPath: string | null;
	relativeLockPath: string | null;
	kind: GitLockKind;
	exists: boolean;
	indexLockPath: string | null;
	indexLockExists: boolean;
	safeToRepair: boolean;
	reason: string;
	removed: boolean;
	ageMs: number | null;
	activeGitProcessHints: GitLockProcessHint[];
};

export type GitWorkspaceLockDiagnostics = {
	root: GitLockDiagnostic | GitLockDiagnostic[];
	repositories: Array<GitLockDiagnostic | {
		repoRoot: string;
		locks: GitLockDiagnostic[];
	}>;
	summary?: {
		repositoriesChecked: number;
		locksPresent: number;
		safeToRepair: number;
		unsafe: number;
		removed: number;
	};
};

export type RunOptions = {
	cwd: string;
	mode?: GitRunnerMode;
	allowFailure?: boolean;
	timeoutMs?: number;
	maxBuffer?: number;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type GitBatchOperation = RunOptions & {
	args: string[];
};

export const DEFAULT_REMOTE_GIT_TIMEOUT_MS = 60_000;

export const REMOTE_GIT_COMMANDS = new Set(['clone', 'fetch', 'ls-remote', 'pull', 'push']);

export function GitCommandUsesRemote(args: string[]) {
	return REMOTE_GIT_COMMANDS.has(args[0] ?? '');
}

export function resolveGitCommandTimeoutMs(args: string[], timeoutMs?: number) {
	return timeoutMs ?? (GitCommandUsesRemote(args) ? DEFAULT_REMOTE_GIT_TIMEOUT_MS : undefined);
}

export function pidAlive(pid: number) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

export function gitSync(args: string[], options: RunOptions): GitRunnerResult {
	const env: NodeJS.ProcessEnv = {
		...process.env,
		...(options.env ?? {}),
	};
	for (const [key, value] of Object.entries(env)) {
		if (value === undefined) {
			delete env[key];
		}
	}
	if (args[0] === 'ls-remote') {
		for (const key of Object.keys(env)) {
			if (key.startsWith('GIT_') && key !== 'GIT_ALLOW_PROTOCOL' && key !== 'GIT_TERMINAL_PROMPT') {
				delete env[key];
			}
		}
	}
	if (GitCommandUsesRemote(args) && !env.GIT_SSH_COMMAND) {
		env.GIT_SSH_COMMAND = 'ssh -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2';
	}
	const timeoutMs = resolveGitCommandTimeoutMs(args, options.timeoutMs);
	const spawnOptions: SpawnSyncOptionsWithStringEncoding = {
		cwd: options.cwd,
		env,
		encoding: 'utf8',
		stdio: 'pipe',
		timeout: timeoutMs,
		maxBuffer: options.maxBuffer ?? 1024 * 1024 * 32,
	};
	const result = spawnSync('git', args, spawnOptions);
	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		if (code === 'ETIMEDOUT') {
			throw new Error(`Git remote command timed out after ${timeoutMs}ms: git ${args.join(' ')} in ${options.cwd}. Check network and repository access, then rerun the Treeseed command.`);
		}
		throw new Error(`Unable to run git ${args.join(' ')} in ${options.cwd}: ${result.error.message}`);
	}
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

export class GitLockError extends Error {
	diagnostics: GitLockDiagnostic[];
	command: string[];
	cwd: string;

	constructor(message: string, input: {
		diagnostics: GitLockDiagnostic[];
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

export function classifyGitMode(args: string[]): GitRunnerMode {
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

export function resolveCommonGitDir(cwd: string) {
	const result = gitSync(['rev-parse', '--git-common-dir'], { cwd, allowFailure: true });
	const raw = result.status === 0 ? result.stdout.trim() : '';
	if (!raw) return null;
	return resolve(cwd, raw);
}

export function resolveGitDir(cwd: string) {
	const result = gitSync(['rev-parse', '--git-dir'], { cwd, allowFailure: true });
	const raw = result.status === 0 ? result.stdout.trim() : '';
	if (!raw) return null;
	return resolve(cwd, raw);
}

export function resolveGitRoot(cwd: string) {
	const result = gitSync(['rev-parse', '--show-toplevel'], { cwd, allowFailure: true });
	const raw = result.status === 0 ? result.stdout.trim() : '';
	return raw || cwd;
}

export function lockRoot(commonGitDir: string | null) {
	return commonGitDir ? resolve(commonGitDir, 'treeseed', 'locks') : resolve(process.cwd(), '.treeseed', 'locks');
}

export function lockPathFor(commonGitDir: string | null) {
	const base = lockRoot(commonGitDir);
	return resolve(base, 'git-mutation.lock');
}

export function lockMetadataPath(lockPath: string) {
	return resolve(lockPath, 'owner.json');
}

export function isWithin(parent: string, candidate: string) {
	const rel = relative(parent, candidate);
	return rel === '' || (!!rel && !rel.startsWith('..') && !rel.startsWith('/'));
}

export function staleLock(lockPath: string) {
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

export function acquireMutationLock(commonGitDir: string | null) {
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
			if (staleLock(path)) {
				rmSync(path, { recursive: true, force: true });
				continue;
			}
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 125);
		}
	}
	throw new Error(`Timed out waiting for Treeseed Git mutation lock ${path}.`);
}
