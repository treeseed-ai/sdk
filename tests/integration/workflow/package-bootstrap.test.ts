import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { initializePackage, type PackageBootstrapInput } from '../../../src/operations/services/package-bootstrap/index.ts';

function git(args: string[], cwd: string) {
	return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function fixture() {
	const base = mkdtempSync(resolve(tmpdir(), 'treeseed-package-bootstrap-'));
	const root = resolve(base, 'market');
	const remote = resolve(base, 'ai.git');
	mkdirSync(resolve(root, 'packages'), { recursive: true });
	mkdirSync(remote);
	git(['init', '-b', 'ai'], root);
	git(['init', '--bare'], remote);
	const input: PackageBootstrapInput = {
		workspaceRoot: root, packageId: '@treeseed/ai', name: 'TreeSeed AI', repository: 'treeseed-ai/ai', path: 'packages/ai',
		kind: 'node-typescript', type: 'runtime-appliance', license: 'Apache-2.0', template: 'metadata', defaultBranch: 'main', execute: false, remoteUrl: remote,
	};
	return { root, remote, input };
}

describe('package bootstrap', () => {
	it('plans without mutating the workspace or remote', () => {
		const { root, remote, input } = fixture();
		const result = initializePackage(input);
		expect(result.status).toBe('planned');
		expect(result.actions.map((entry) => entry.kind)).toContain('push');
		expect(existsSync(resolve(root, 'packages/ai'))).toBe(false);
		expect(git(['for-each-ref', '--format=%(refname)'], remote)).toBe('');
	});

	it('initializes, verifies, registers, and replays one package', () => {
		const { root, remote, input } = fixture();
		const created = initializePackage({ ...input, execute: true });
		expect(created.status).toBe('created');
		expect(git(['rev-parse', 'refs/heads/main'], remote)).toBe(created.commitSha);
		expect(git(['config', '-f', '.gitmodules', '--get', 'submodule.packages/ai.url'], root)).toBe(remote);
		expect(git(['ls-files', '--stage', 'packages/ai'], root)).toContain('160000');
		const replay = initializePackage({ ...input, execute: true });
		expect(replay.status).toBe('unchanged');
		expect(replay.commitSha).toBe(created.commitSha);
	}, 30_000);

	it('rejects nonempty remotes and unsafe targets', () => {
		const { root, remote, input } = fixture();
		const seed = resolve(root, 'seed');
		mkdirSync(seed);
		git(['init', '-b', 'main'], seed);
		writeFileSync(resolve(seed, 'README.md'), 'occupied\n');
		git(['add', 'README.md'], seed);
		git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'seed'], seed);
		git(['remote', 'add', 'origin', remote], seed);
		git(['push', 'origin', 'main'], seed);
		expect(() => initializePackage(input)).toThrow('Remote repository is not empty');
		expect(() => initializePackage({ ...input, path: '../ai' })).toThrow('Package target');
	});
});
