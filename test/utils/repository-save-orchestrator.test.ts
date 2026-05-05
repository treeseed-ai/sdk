import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
	discoverRepositorySaveNodes,
	nextDevVersion,
	planRepositorySave,
	repositorySaveWaves,
	runRepositorySaveOrchestrator,
	type RepositorySaveNode,
} from '../../src/operations/services/repository-save-orchestrator.ts';

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
	it('creates deterministic semver dev prerelease versions from branch names', () => {
		expect(nextDevVersion('0.6.7', 'feature/search filters', new Date('2026-04-26T15:30:00Z'))).toBe(
			'0.6.8-dev.feature-search-filters.20260426T153000Z',
		);
	});

	it('orders dependency waves from leaves to dependents', () => {
		const sdk = node({ id: 'packages/sdk', name: '@treeseed/sdk', dependents: ['packages/core', 'packages/cli'] });
		const core = node({ id: 'packages/core', name: '@treeseed/core', dependencies: ['packages/sdk'], dependents: ['.'] });
		const cli = node({ id: 'packages/cli', name: '@treeseed/cli', dependencies: ['packages/sdk'], dependents: ['.'] });
		const root = node({ id: '.', name: '@treeseed/market', kind: 'project', branchMode: 'project-save', dependencies: ['packages/core', 'packages/cli'] });

		expect(repositorySaveWaves([root, cli, core, sdk]).map((wave) => wave.map((entry) => entry.name))).toEqual([
			['@treeseed/sdk'],
			['@treeseed/core', '@treeseed/cli'],
			['@treeseed/market'],
		]);
	});

	it('reports dependency cycles before mutation', () => {
		const left = node({ id: 'left', name: 'left', dependencies: ['right'], dependents: ['right'] });
		const right = node({ id: 'right', name: 'right', dependencies: ['left'], dependents: ['left'] });

		expect(() => repositorySaveWaves([left, right])).toThrow('Repository dependency cycle detected');
	});

	it('keeps package repos in dev-save mode unless stable release is explicit', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-mode-'));
		git(root, ['init', '-b', 'main']);
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/demo',
			version: '1.2.3',
			publishConfig: { access: 'public' },
			scripts: { 'release:publish': 'npm publish' },
		}, null, 2), 'utf8');

		expect(discoverRepositorySaveNodes(root, root, 'main')[0].branchMode).toBe('package-dev-save');
		expect(discoverRepositorySaveNodes(root, root, 'main', { stablePackageRelease: true })[0].branchMode).toBe('package-release-main');
	});

	it('classifies private package.json repositories as projects', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-project-'));
		git(root, ['init', '-b', 'staging']);
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			version: '0.3.5',
			private: true,
		}, null, 2), 'utf8');

		const [repo] = discoverRepositorySaveNodes(root, root, 'staging');
		expect(repo.kind).toBe('project');
		expect(repo.branchMode).toBe('project-save');
	});

	it('plans root workspace lockfile refresh against the real manifest', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-plan-lockfile-'));
		git(root, ['init', '-b', 'staging']);
		writeJson(resolve(root, 'package.json'), {
			name: '@treeseed/market',
			version: '1.0.0',
			private: true,
			workspaces: ['packages/*'],
			dependencies: {
				'@treeseed/sdk': 'github:treeseed-ai/sdk#0.1.0-dev.staging.20260427T000000Z',
			},
		});
		writeJson(resolve(root, 'package-lock.json'), {
			name: '@treeseed/market',
			lockfileVersion: 3,
			packages: { '': { name: '@treeseed/market', workspaces: ['packages/*'] } },
		});
		writeJson(resolve(root, 'packages/sdk/package.json'), {
			name: '@treeseed/sdk',
			version: '0.1.0',
		});

		const plan = planRepositorySave({
			root,
			gitRoot: root,
			branch: 'staging',
			commitMessageMode: 'fallback',
			verifyMode: 'skip',
		});

		expect(plan.rootRepo.commands).toContain('npm ci --ignore-scripts --dry-run # validate root manifest, workspaces, and lockfile before commit');
		expect(plan.rootRepo.commands).not.toContain('npm install --workspaces=false # refresh project lockfile after internal dependency updates');
	});

	it('plans package branch and tag publication in one push command', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-plan-package-push-'));
		const origin = mkdtempSync(join(tmpdir(), 'treeseed-save-plan-package-push-origin-'));
		git(origin, ['init', '--bare']);
		git(root, ['init', '-b', 'staging']);
		git(root, ['remote', 'add', 'origin', origin]);
		writeJson(resolve(root, 'package.json'), {
			name: '@treeseed/demo',
			version: '1.0.0',
			type: 'module',
			publishConfig: { access: 'public' },
			scripts: { 'release:publish': 'node -e "process.exit(0)"' },
		});
		writeFileSync(resolve(root, 'README.md'), 'changed\n', 'utf8');

		const plan = planRepositorySave({
			root,
			gitRoot: root,
			branch: 'staging',
			commitMessageMode: 'fallback',
			verifyMode: 'skip',
		});

		const version = plan.rootRepo.plannedVersion;
		expect(version).toMatch(/^1\.0\.1-dev\.staging\./u);
		expect(plan.rootRepo.commands).toContain(`git push -u origin staging ${version}`);
		expect(plan.rootRepo.commands).not.toContain(`git push origin ${version}`);
	});

	it('fails stale root workspace lockfiles before committing', async () => {
		vi.stubEnv('TREESEED_GITHUB_AUTOMATION_MODE', 'stub');
		try {
			const root = mkdtempSync(join(tmpdir(), 'treeseed-save-lockfile-fail-'));
			const origin = mkdtempSync(join(tmpdir(), 'treeseed-save-lockfile-fail-origin-'));
			git(origin, ['init', '--bare']);
			git(root, ['init', '-b', 'staging']);
			git(root, ['config', 'user.email', 'test@example.com']);
			git(root, ['config', 'user.name', 'Test User']);
			git(root, ['remote', 'add', 'origin', origin]);
			writeJson(resolve(root, 'package.json'), {
				name: '@treeseed/market',
				version: '1.0.0',
				private: true,
				workspaces: ['packages/*'],
				dependencies: {
					'@treeseed/sdk': 'github:treeseed-ai/sdk#0.1.0-dev.staging.20260427T000000Z',
				},
			});
			writeJson(resolve(root, 'packages/sdk/package.json'), {
				name: '@treeseed/sdk',
				version: '0.1.0',
			});
			writeJson(resolve(root, 'package-lock.json'), {
				name: '@treeseed/market',
				lockfileVersion: 3,
				packages: {
					'': { name: '@treeseed/market' },
					'packages/sdk': { name: '@treeseed/sdk', version: '0.0.9' },
					'node_modules/@treeseed/sdk': { resolved: 'packages/sdk', link: true },
				},
			});
			writeFileSync(resolve(root, 'README.md'), 'initial\n', 'utf8');
			git(root, ['add', '-A']);
			git(root, ['commit', '-m', 'chore: initial']);
			git(root, ['push', '-u', 'origin', 'staging']);
			const before = git(root, ['rev-parse', 'HEAD']);
			writeFileSync(resolve(root, 'README.md'), 'initial\nupdated\n', 'utf8');

			await expect(runRepositorySaveOrchestrator({
				root,
				gitRoot: root,
				branch: 'staging',
				commitMessageMode: 'fallback',
				verifyMode: 'skip',
			})).rejects.toThrow(/Lockfile validation failed/u);

			expect(git(root, ['rev-parse', 'HEAD'])).toBe(before);
			expect(git(root, ['status', '--porcelain'])).toContain('README.md');
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('streams save progress with repository and phase prefixes', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-progress-'));
		const origin = mkdtempSync(join(tmpdir(), 'treeseed-save-progress-origin-'));
		git(origin, ['init', '--bare']);
		git(root, ['init', '-b', 'staging']);
		git(root, ['config', 'user.email', 'test@example.com']);
		git(root, ['config', 'user.name', 'Test User']);
		git(root, ['remote', 'add', 'origin', origin]);
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/demo',
			version: '1.0.0',
			private: true,
		}, null, 2), 'utf8');
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

		expect(progress).toContain('[@treeseed/demo][start] Starting project-save on staging.');
		expect(progress.some((line) => line.startsWith('[@treeseed/demo][commit] $ git commit'))).toBe(true);
		expect(progress.some((line) => line.startsWith('[@treeseed/demo][push] $ git push'))).toBe(true);
	});

	it('injects package summaries and submodule pointers into the root commit context', async () => {
		vi.stubEnv('TREESEED_GITHUB_AUTOMATION_MODE', 'stub');
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
			expect(rootContext?.dependencyUpdates?.[0]).toMatchObject({
				packageName: '@treeseed/sdk',
				field: 'dependencies',
			});
			expect(rootContext?.dependencyUpdates?.[0]?.from).toContain('0.1.0-dev.old');
			expect(rootContext?.dependencyUpdates?.[0]?.to).toContain(String(sdkReport?.tagName));
			expect(rootContext?.submodulePointers?.[0]).toMatchObject({
				path: 'packages/sdk',
				oldSha: oldSdkHead,
				newSha: sdkReport?.commitSha,
				packageName: '@treeseed/sdk',
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('finalizes a clean package with an interrupted dev version and missing tag', async () => {
		vi.stubEnv('TREESEED_GITHUB_AUTOMATION_MODE', 'stub');
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
			expect(result.rootRepo.tagName).toBe(version);
			expect(result.rootRepo.pushed).toBe(true);
			expect(progress).toContain(`[@treeseed/demo][push] $ git push origin staging ${version}`);
			expect(git(root, ['rev-list', '-n', '1', version])).toBe(git(root, ['rev-parse', 'HEAD']));
			expect(git(root, ['ls-remote', '--tags', 'origin', `refs/tags/${version}`])).toContain(version);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
