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
} from '../../../src/operations/services/repository-save-orchestrator.ts';

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
it('injects package summaries and submodule pointers into the root commit context', async () => {
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		try {
			const root = mkdtempSync(join(tmpdir(), 'treeseed-save-root-context-'));
			const rootOrigin = mkdtempSync(join(tmpdir(), 'treeseed-save-root-context-origin-'));
			const sdkOrigin = mkdtempSync(join(tmpdir(), 'treeseed-save-root-context-sdk-origin-'));
			const sdkDir = resolve(root, 'packages/sdk');
			git(rootOrigin, ['init', '--bare']);
			git(sdkOrigin, ['init', '--bare']);
			git(root, ['init', '-b', 'staging']);
			git(root, ['config', 'user.email', 'test@example.com']);
			git(root, ['config', 'user.name', 'Test User']);
			git(root, ['remote', 'add', 'origin', rootOrigin]);
			writeJson(resolve(root, 'package.json'), {
				name: '@treeseed/market',
				version: '1.0.0',
				private: true,
				workspaces: ['packages/*'],
				dependencies: {
					'@treeseed/sdk': 'github:treeseed-ai/sdk#0.1.0-dev.old.20260427T000000Z',
				},
			});
			writeJson(resolve(root, 'packages/core/package.json'), {
				name: '@treeseed/core',
				version: '0.1.0',
				private: true,
			});
			writeJson(resolve(root, 'packages/cli/package.json'), {
				name: '@treeseed/cli',
				version: '0.1.0',
				private: true,
			});
			writeJson(resolve(root, 'packages/agent/package.json'), {
				name: '@treeseed/agent',
				version: '0.1.0',
				private: true,
			});
			mkdirSync(resolve(sdkDir, 'src'), { recursive: true });
			git(sdkDir, ['init', '-b', 'staging']);
			git(sdkDir, ['config', 'user.email', 'test@example.com']);
			git(sdkDir, ['config', 'user.name', 'Test User']);
			git(sdkDir, ['remote', 'add', 'origin', sdkOrigin]);
			writeJson(resolve(sdkDir, 'package.json'), {
				name: '@treeseed/sdk',
				version: '0.1.0',
				type: 'module',
				publishConfig: { access: 'public' },
				scripts: { 'release:publish': 'node -e "process.exit(0)"' },
			});
			writeFileSync(resolve(sdkDir, 'src/index.ts'), 'export const value = 1;\n', 'utf8');
			git(sdkDir, ['add', '-A']);
			git(sdkDir, ['commit', '-m', 'chore: initial sdk']);
			git(sdkDir, ['push', '-u', 'origin', 'staging']);
			const oldSdkHead = git(sdkDir, ['rev-parse', 'HEAD']);
			git(root, ['add', '-A']);
			git(root, ['commit', '-m', 'chore: initial root']);
			git(root, ['push', '-u', 'origin', 'staging']);

			writeFileSync(resolve(sdkDir, 'src/index.ts'), 'export const value = 2;\n', 'utf8');
			const contexts: any[] = [];
			const result = await runRepositorySaveOrchestrator({
				root,
				gitRoot: root,
				branch: 'staging',
				commitMessageMode: 'generated',
				commitMessageProvider: {
					generate(context) {
						contexts.push(JSON.parse(JSON.stringify(context)));
						if (context.repoName === '@treeseed/market') {
							return [
								'chore(deps): sync integrated package updates',
								'',
								'Changes:',
								'- Updates root package metadata for finalized package commits.',
								'',
								'Integrated package changes:',
								'- Records the finalized SDK package commit.',
								'',
								'Dependency and pointer updates:',
								'- Updates package dependency specs and submodule pointers.',
							].join('\n');
						}
						return [
							'feat(save): record package source changes',
							'',
							'Changes:',
							'- Updates package source files for the save workflow.',
						].join('\n');
					},
				},
				verifyMode: 'skip',
			});

			const sdkReport = result.repos.find((repo) => repo.name === '@treeseed/sdk');
			const rootContext = contexts.find((context) => context.repoName === '@treeseed/market');
			expect(sdkReport?.commitMessage?.split('\n')[0]).toBe('feat(save): record package source changes');
			expect(rootContext?.packageChanges?.[0]).toMatchObject({
				name: '@treeseed/sdk',
				path: 'packages/sdk',
				oldSha: oldSdkHead,
				newSha: sdkReport?.commitSha,
				tagName: sdkReport?.tagName,
				commitSubject: 'feat(save): record package source changes',
			});
			expect(sdkReport?.tagName).toBeNull();
			expect(rootContext?.dependencyUpdates ?? []).toEqual([]);
			expect(rootContext?.submodulePointers?.[0]).toMatchObject({
				path: 'packages/sdk',
				oldSha: oldSdkHead,
				newSha: sdkReport?.commitSha,
				packageName: '@treeseed/sdk',
			});
		} finally {
			vi.unstubAllEnvs();
		}
	}, 20_000);

it('stops before dependent packages when a wave gate fails', async () => {
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		try {
			const root = mkdtempSync(join(tmpdir(), 'treeseed-save-wave-gate-'));
			const rootOrigin = mkdtempSync(join(tmpdir(), 'treeseed-save-wave-gate-root-origin-'));
			const packageNames = ['sdk', 'agent', 'core', 'cli'];
			const packageOrigins = new Map(packageNames.map((name) => [
				name,
				mkdtempSync(join(tmpdir(), `treeseed-save-wave-gate-${name}-origin-`)),
			]));

			git(rootOrigin, ['init', '--bare']);
			git(root, ['init', '-b', 'staging']);
			git(root, ['config', 'user.email', 'test@example.com']);
			git(root, ['config', 'user.name', 'Test User']);
			git(root, ['remote', 'add', 'origin', rootOrigin]);
			writeJson(resolve(root, 'package.json'), {
				name: '@treeseed/market',
				version: '1.0.0',
				private: true,
				workspaces: ['packages/*'],
				dependencies: {
					'@treeseed/agent': 'github:treeseed-ai/agent#old',
					'@treeseed/core': 'github:treeseed-ai/core#old',
					'@treeseed/cli': 'github:treeseed-ai/cli#old',
				},
			});

			for (const name of packageNames) {
				const packageDir = resolve(root, 'packages', name);
				mkdirSync(resolve(packageDir, 'src'), { recursive: true });
				git(packageOrigins.get(name)!, ['init', '--bare']);
				git(packageDir, ['init', '-b', 'staging']);
				git(packageDir, ['config', 'user.email', 'test@example.com']);
				git(packageDir, ['config', 'user.name', 'Test User']);
				git(packageDir, ['remote', 'add', 'origin', packageOrigins.get(name)!]);
				writeJson(resolve(packageDir, 'package.json'), {
					name: `@treeseed/${name}`,
					version: '0.1.0',
					type: 'module',
					publishConfig: { access: 'public' },
					scripts: { 'release:publish': 'node -e "process.exit(0)"' },
					...(name === 'sdk'
						? {}
						: { dependencies: { '@treeseed/sdk': 'github:treeseed-ai/sdk#old' } }),
				});
				writeFileSync(resolve(packageDir, 'src/index.ts'), `export const name = '${name}';\n`, 'utf8');
				git(packageDir, ['add', '-A']);
				git(packageDir, ['commit', '-m', `chore: initial ${name}`]);
				git(packageDir, ['push', '-u', 'origin', 'staging']);
			}

			git(root, ['add', '-A']);
			git(root, ['commit', '-m', 'chore: initial root']);
			git(root, ['push', '-u', 'origin', 'staging']);
			const before = {
				root: git(root, ['rev-parse', 'HEAD']),
				agent: git(resolve(root, 'packages/agent'), ['rev-parse', 'HEAD']),
				core: git(resolve(root, 'packages/core'), ['rev-parse', 'HEAD']),
				cli: git(resolve(root, 'packages/cli'), ['rev-parse', 'HEAD']),
			};

			writeFileSync(resolve(root, 'packages/sdk/src/index.ts'), 'export const name = "sdk-updated";\n', 'utf8');
			const gateWaves: string[][] = [];
			let caughtError: unknown;
			try {
				await runRepositorySaveOrchestrator({
					root,
					gitRoot: root,
					branch: 'staging',
					commitMessageMode: 'fallback',
					verifyMode: 'skip',
					onWaveSaved: ({ reports }) => {
						gateWaves.push(reports.map((report) => report.name));
						const error = new Error('sdk remote ci failed');
						Object.assign(error, { details: { gate: { name: '@treeseed/sdk' } } });
						throw error;
					},
				});
			} catch (error) {
				caughtError = error;
			}

			expect(caughtError).toBeInstanceOf(Error);
			expect((caughtError as Error).message).toContain('sdk remote ci failed');
			expect(repositorySaveErrorDetails(caughtError).details?.partialFailure).toMatchObject({
				message: 'Treeseed save stopped while waiting for hosted gates after wave 1.',
				failingRepo: '@treeseed/sdk',
				error: 'sdk remote ci failed',
			});
			expect(gateWaves).toEqual([['@treeseed/sdk']]);
			expect(git(resolve(root, 'packages/agent'), ['rev-parse', 'HEAD'])).toBe(before.agent);
			expect(git(resolve(root, 'packages/core'), ['rev-parse', 'HEAD'])).toBe(before.core);
			expect(git(resolve(root, 'packages/cli'), ['rev-parse', 'HEAD'])).toBe(before.cli);
			expect(git(root, ['rev-parse', 'HEAD'])).toBe(before.root);
		} finally {
			vi.unstubAllEnvs();
		}
	}, 20_000);
});
