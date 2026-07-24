import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { dirname, join, resolve } from 'node:path';

import { spawnSync } from 'node:child_process';

import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
	applyPackageVersion,
	discoverRepositorySaveNodes,
	nextDevVersion,
	planRepositorySave,
	repositorySaveErrorDetails,
	repositorySaveWaves,
	runRepositorySaveOrchestrator,
	runStreamingCommand,
	validateStandaloneGitDependencyLockfile,
	type RepositorySaveNode,
} from '../../../../src/operations/services/repositories/repository-save-orchestrator.ts';

const testDir = dirname(fileURLToPath(import.meta.url));

function git(cwd: string, args: string[]) {
	const result = spawnSync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(result.stderr || result.stdout || `git ${args.join(' ')} failed`);
	}
	return result.stdout.trim();
}

function node(input: Partial<RepositorySaveNode> & Pick<RepositorySaveNode, 'id' | 'name'>): RepositorySaveNode {
	return {
		id: input.id,
		name: input.name,
		path: `/tmp/${input.id}`,
		relativePath: input.id,
		kind: 'package',
		branch: 'feature/demo',
		branchMode: 'package-dev-save',
		packageJsonPath: null,
		packageJson: null,
		scripts: {},
		remoteUrl: null,
		dependencies: [],
		dependents: [],
		submoduleDependencies: [],
		plannedVersion: null,
		plannedTag: null,
		plannedDependencySpec: null,
		...input,
	};
}

function writeJson(path: string, value: Record<string, unknown>) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
describe('repository save orchestrator helpers', () => {
it('finalizes a clean package with an interrupted dev version as a commit ref without creating a tag', async () => {
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		try {
			const root = mkdtempSync(join(tmpdir(), 'treeseed-save-partial-'));
			const origin = mkdtempSync(join(tmpdir(), 'treeseed-save-partial-origin-'));
			git(origin, ['init', '--bare']);
			git(root, ['init', '-b', 'staging']);
			git(root, ['config', 'user.email', 'test@example.com']);
			git(root, ['config', 'user.name', 'Test User']);
			git(root, ['remote', 'add', 'origin', origin]);
			writeFileSync(resolve(root, 'package.json'), JSON.stringify({
				name: '@treeseed/demo',
				version: '1.0.0',
				type: 'module',
				publishConfig: { access: 'public' },
				scripts: {
					'verify:action': 'node -e "process.exit(0)"',
					'verify:local': 'node -e "process.exit(0)"',
					'release:publish': 'node -e "process.exit(0)"',
				},
			}, null, 2), 'utf8');
			git(root, ['add', '-A']);
			git(root, ['commit', '-m', 'chore: initial']);
			git(root, ['push', '-u', 'origin', 'staging']);

			const version = '1.0.1-dev.staging.20260427T010203Z';
			writeFileSync(resolve(root, 'package.json'), JSON.stringify({
				name: '@treeseed/demo',
				version,
				type: 'module',
				publishConfig: { access: 'public' },
				scripts: {
					'verify:action': 'node -e "process.exit(0)"',
					'verify:local': 'node -e "process.exit(0)"',
					'release:publish': 'node -e "process.exit(0)"',
				},
			}, null, 2), 'utf8');
			git(root, ['add', '-A']);
			git(root, ['commit', '-m', 'feat: partial save']);

			const progress: string[] = [];
			const result = await runRepositorySaveOrchestrator({
				root,
				gitRoot: root,
				branch: 'staging',
				commitMessageMode: 'fallback',
				verifyMode: 'skip',
				onProgress: (line) => progress.push(line),
			});

			expect(result.rootRepo.version).toBe(version);
			expect(result.rootRepo.tagName).toBeNull();
			expect(result.rootRepo.dependencySpec).toContain(git(root, ['rev-parse', 'HEAD']));
			expect(result.rootRepo.pushed).toBe(true);
			expect(git(root, ['ls-remote', 'origin', 'refs/heads/staging'])).toContain(git(root, ['rev-parse', 'HEAD']));
			expect(git(root, ['ls-remote', '--tags', 'origin', `refs/tags/${version}`])).toBe('');
		} finally {
			vi.unstubAllEnvs();
		}
	});

it('summarizes successful lockfile plan output during save', async () => {
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'run');
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-lockfile-summary-'));
		const origin = mkdtempSync(join(tmpdir(), 'treeseed-save-lockfile-summary-origin-'));
		try {
			git(origin, ['init', '--bare']);
			git(root, ['init', '-b', 'staging']);
			git(root, ['config', 'user.email', 'test@example.com']);
			git(root, ['config', 'user.name', 'Test User']);
			git(root, ['remote', 'add', 'origin', origin]);
			writeJson(resolve(root, 'package.json'), {
				name: '@treeseed/market',
				version: '1.0.0',
				private: true,
			});
			writeJson(resolve(root, 'package-lock.json'), {
				name: '@treeseed/market',
				lockfileVersion: 3,
				packages: {
					'': { name: '@treeseed/market', version: '1.0.0' },
				},
			});
			writeFileSync(resolve(root, 'README.md'), 'initial\n', 'utf8');
			git(root, ['add', '-A']);
			git(root, ['commit', '-m', 'chore: initial']);
			git(root, ['push', '-u', 'origin', 'staging']);
			writeFileSync(resolve(root, 'README.md'), 'initial\nupdated\n', 'utf8');
			const progress: string[] = [];

			await runRepositorySaveOrchestrator({
				root,
				gitRoot: root,
				branch: 'staging',
				commitMessageMode: 'fallback',
				verifyMode: 'skip',
				onProgress: (line) => progress.push(line),
			});

			expect(progress.some((line) => line.includes('network install mode is disabled'))).toBe(true);
			expect(progress.some((line) => /\[lockfile\] add /u.test(line))).toBe(false);
		} finally {
			vi.unstubAllEnvs();
		}
	});

it('summarizes allowed build warnings in local subprocess output', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-warning-summary-'));
		const progress: string[] = [];

		await runStreamingCommand(
			{ name: '@treeseed/demo-warning', path: root },
			{ onProgress: (line) => progress.push(line) },
			'verify',
			process.execPath,
			['-e', 'console.log(`[WARN] [vite] [plugin vite:resolve] Module "url" has been externalized for browser compatibility, imported by "/workspace/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs".`)'],
		);

		expect(progress.some((line) => line.includes('Allowed build warnings: 1'))).toBe(true);
		expect(progress.some((line) => line.includes('vite-browser-external-libsodium-url: 1'))).toBe(true);
		expect(progress.some((line) =>
			!line.includes('$ ')
			&& line.includes('[WARN]')
			&& line.includes('Module "url" has been externalized'))).toBe(false);
	});

it('uses a short temp directory for tsx subprocesses in long worktree paths', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-tsx-temp-'));
		const packageRoot = resolve(testDir, '..', '..');
		const longTemp = resolve(
			root,
			'very-long-managed-worktree-temp-directory-name',
			'that-would-overflow-unix-socket-paths-for-tsx',
			'when-the-worktree-itself-is-already-deep',
		);
		const progress: string[] = [];

		await runStreamingCommand(
			{ name: '@treeseed/demo-temp', path: packageRoot },
			{ onProgress: (line) => progress.push(line) },
			'verify',
			process.execPath,
			['--import', 'tsx', '-e', 'console.log(process.env.TMPDIR)'],
			{ env: { TMPDIR: longTemp, TMP: longTemp, TEMP: longTemp } },
		);

		expect(progress).toContain(`[@treeseed/demo-temp][verify] ${tmpdir()}`);
		expect(progress).not.toContain(`[@treeseed/demo-temp][verify] ${longTemp}`);
	});
});
