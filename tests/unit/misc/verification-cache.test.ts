import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	readTreeseedVerificationCache,
	treeseedVerificationCacheKey,
	writeTreeseedVerificationCache,
} from '../../../src/operations/services/verification-cache.ts';
import { run } from '../../../src/operations/services/workspace-tools.ts';

let roots: string[] = [];

function testTempBase() {
	const base = resolve('.treeseed', 'test-tmp');
	mkdirSync(base, { recursive: true });
	return base;
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

function repo() {
	const root = mkdtempSync(join(testTempBase(), 'treeseed-verify-cache-'));
	roots.push(root);
	mkdirSync(resolve(root, 'pkg'), { recursive: true });
	run('git', ['init'], { cwd: root });
	run('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
	run('git', ['config', 'user.name', 'Test User'], { cwd: root });
	writeFileSync(resolve(root, 'pkg', 'package.json'), '{"name":"pkg","scripts":{"verify:local":"node -e true"}}\n');
	writeFileSync(resolve(root, 'pkg', 'package-lock.json'), '{"lockfileVersion":3}\n');
	run('git', ['add', '.'], { cwd: root });
	run('git', ['commit', '-m', 'init'], { cwd: root });
	return { root, pkg: resolve(root, 'pkg') };
}

describe('verification cache', () => {
	it('stays disabled in GitHub Actions unless explicitly enabled', () => {
		const { root, pkg } = repo();
		const input = {
			workspaceRoot: root,
			repoName: 'pkg',
			repoPath: pkg,
			command: 'npm run verify:local',
			verifyMode: 'local-only',
			env: { GITHUB_ACTIONS: 'true' },
		};
		expect(writeTreeseedVerificationCache(input, 12)).toBeNull();
		expect(readTreeseedVerificationCache(input)).toBeNull();
	});

	it('reuses successful verification for the same head and lockfile', () => {
		const { root, pkg } = repo();
		const input = {
			workspaceRoot: root,
			repoName: 'pkg',
			repoPath: pkg,
			command: 'npm run verify:local',
			verifyMode: 'local-only',
			env: { GITHUB_ACTIONS: 'true', TREESEED_VERIFY_CACHE: '1' },
		};
		expect(readTreeseedVerificationCache(input)).toBeNull();
		const written = writeTreeseedVerificationCache(input, 12);
		expect(written?.status).toBe('passed');
		expect(readTreeseedVerificationCache(input)).toMatchObject({ status: 'passed', command: 'npm run verify:local' });
	});

	it('misses after lockfile changes', () => {
		const { root, pkg } = repo();
		const input = {
			workspaceRoot: root,
			repoName: 'pkg',
			repoPath: pkg,
			command: 'npm run verify:local',
			verifyMode: 'local-only',
			env: { GITHUB_ACTIONS: 'true', TREESEED_VERIFY_CACHE: '1' },
		};
		const before = treeseedVerificationCacheKey(input).key;
		writeTreeseedVerificationCache(input, 12);
		writeFileSync(resolve(pkg, 'package-lock.json'), '{"lockfileVersion":3,"packages":{"x":{}}}\n');
		expect(treeseedVerificationCacheKey(input).key).not.toBe(before);
		expect(readTreeseedVerificationCache(input)).toBeNull();
	});
});
