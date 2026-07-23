import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
	inspectTreeseedGitLockSet,
	recoverTreeseedGitLocks,
	resolveTreeseedGitCommandTimeoutMs,
	runTreeseedGit,
	treeseedGitCommandUsesRemote,
} from '../../../src/operations/services/git-runner.ts';

const roots: string[] = [];

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, {
		cwd,
		encoding: 'utf8',
		stdio: 'pipe',
	});
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

function tempRepo() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-git-runner-'));
	roots.push(root);
	git(root, ['init', '-b', 'main']);
	git(root, ['config', 'user.name', 'TreeSeed Test']);
	git(root, ['config', 'user.email', 'test@treeseed.test']);
	writeFileSync(resolve(root, 'README.md'), '# Test\n', 'utf8');
	git(root, ['add', 'README.md']);
	git(root, ['commit', '-m', 'initial']);
	return root;
}

function stale(path: string) {
	const then = new Date(Date.now() - 15 * 60 * 1000);
	utimesSync(path, then, then);
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

describe('Treeseed Git runner locks', () => {
	it('bounds remote commands without changing local command timeouts', () => {
		expect(treeseedGitCommandUsesRemote(['ls-remote', 'origin'])).toBe(true);
		expect(treeseedGitCommandUsesRemote(['status', '--porcelain'])).toBe(false);
		expect(resolveTreeseedGitCommandTimeoutMs(['fetch', 'origin'])).toBe(60_000);
		expect(resolveTreeseedGitCommandTimeoutMs(['push', 'origin'], 12_345)).toBe(12_345);
		expect(resolveTreeseedGitCommandTimeoutMs(['status'])).toBeUndefined();
	});

	it('detects stale remote ref locks', () => {
		const root = tempRepo();
		const lockPath = resolve(root, '.git', 'refs', 'remotes', 'origin', 'scenes.lock');
		mkdirSync(resolve(lockPath, '..'), { recursive: true });
		writeFileSync(lockPath, '', 'utf8');
		stale(lockPath);

		const locks = inspectTreeseedGitLockSet(root).filter((entry) => entry.exists);

		expect(locks).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: 'ref',
				relativeLockPath: 'refs/remotes/origin/scenes.lock',
				safeToRepair: true,
			}),
		]));
	});

	it('recovers stale ref locks through the public recovery helper', () => {
		const root = tempRepo();
		const lockPath = resolve(root, '.git', 'refs', 'remotes', 'origin', 'scenes.lock');
		mkdirSync(resolve(lockPath, '..'), { recursive: true });
		writeFileSync(lockPath, '', 'utf8');
		stale(lockPath);

		const diagnostics = recoverTreeseedGitLocks(root, { execute: true });

		expect(Array.isArray(diagnostics)).toBe(true);
		expect(diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: 'ref',
				removed: true,
			}),
		]));
		expect(existsSync(lockPath)).toBe(false);
	});

	it('does not remove recent ref locks', () => {
		const root = tempRepo();
		const lockPath = resolve(root, '.git', 'refs', 'remotes', 'origin', 'scenes.lock');
		mkdirSync(resolve(lockPath, '..'), { recursive: true });
		writeFileSync(lockPath, '', 'utf8');

		const diagnostics = recoverTreeseedGitLocks(root, { execute: true });

		expect(diagnostics).toEqual(expect.arrayContaining([
			expect.objectContaining({
				kind: 'ref',
				removed: false,
				safeToRepair: false,
			}),
		]));
		expect(existsSync(lockPath)).toBe(true);
	});

	it('removes safe stale locks before mutating Git commands', () => {
		const root = tempRepo();
		const lockPath = resolve(root, '.git', 'refs', 'remotes', 'origin', 'scenes.lock');
		mkdirSync(resolve(lockPath, '..'), { recursive: true });
		writeFileSync(lockPath, '', 'utf8');
		stale(lockPath);

		runTreeseedGit(['status', '--porcelain'], {
			cwd: root,
			mode: 'mutate',
		});

		expect(existsSync(lockPath)).toBe(false);
	});
});
