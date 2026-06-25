import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
	discoverRepositorySaveNodes,
	nextDevVersion,
	planRepositorySave,
	repositorySaveErrorDetails,
	repositorySaveWaves,
	runRepositorySaveOrchestrator,
	runStreamingCommand,
	type RepositorySaveNode,
} from '../../src/operations/services/repository-save-orchestrator.ts';

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

	it('discovers starter templates and nested fixture submodules as managed save nodes', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-managed-repos-'));
		git(root, ['init', '-b', 'demo']);
		writeJson(resolve(root, 'package.json'), {
			name: '@treeseed/market',
			version: '1.0.0',
			private: true,
			workspaces: ['packages/*'],
		});
		writeFileSync(resolve(root, '.gitmodules'), [
			'[submodule "packages/core"]',
			'\tpath = packages/core',
			'\turl = ../core.git',
			'[submodule "starters/research"]',
			'\tpath = starters/research',
			'\turl = ../research.git',
			'',
		].join('\n'), 'utf8');
		const coreDir = resolve(root, 'packages/core');
		const fixtureDir = resolve(coreDir, '.fixtures/treeseed-fixtures');
		const researchDir = resolve(root, 'starters/research');
		for (const dir of [coreDir, fixtureDir, researchDir]) {
			mkdirSync(dir, { recursive: true });
			git(dir, ['init', '-b', 'demo']);
		}
		writeJson(resolve(coreDir, 'package.json'), {
			name: '@treeseed/core',
			version: '1.0.0',
			private: true,
		});
		writeFileSync(resolve(coreDir, '.gitmodules'), [
			'[submodule ".fixtures/treeseed-fixtures"]',
			'\tpath = .fixtures/treeseed-fixtures',
			'\turl = ../treeseed-fixtures.git',
			'',
		].join('\n'), 'utf8');
		writeJson(resolve(researchDir, 'template.config.json'), {
			id: 'research',
			displayName: 'TreeSeed Research',
			category: 'starter',
			templateVersion: '1.0.0',
		});
		writeFileSync(resolve(researchDir, 'treeseed.template.yaml'), [
			'id: research',
			'name: TreeSeed Research',
			'category: starter',
			'versionSource: template.config.json',
			'verify:',
			'  local: echo verify',
			'  release: echo release',
			'',
		].join('\n'), 'utf8');

		const nodes = discoverRepositorySaveNodes(root, root, 'demo');
		expect(nodes.map((entry) => [entry.id, entry.kind, entry.name])).toEqual(expect.arrayContaining([
			['.', 'project', '@treeseed/market'],
			['packages/core', 'project', '@treeseed/core'],
			['packages/core/.fixtures/treeseed-fixtures', 'fixture', 'fixture:packages/core/.fixtures/treeseed-fixtures'],
			['starters/research', 'template', 'template:research'],
		]));
		expect(nodes.find((entry) => entry.id === 'packages/core')?.submoduleDependencies).toEqual([
			'packages/core/.fixtures/treeseed-fixtures',
		]);
		expect(nodes.find((entry) => entry.id === '.')?.submoduleDependencies).toEqual(expect.arrayContaining([
			'packages/core',
			'starters/research',
		]));
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

	it('keeps root workspace project verification off script-enabled npm ci', () => {
		const source = readFileSync(resolve(testDir, '../../src/operations/services/repository-save-orchestrator.ts'), 'utf8');

		expect(source).toContain('Skipped root npm ci project verification install');
		expect(source).toContain('ensureLocalWorkspaceLinks(options.root)');
	});

	it('installs package dependencies before unlinked local verification', () => {
		const source = readFileSync(resolve(testDir, '../../src/operations/services/repository-save-orchestrator.ts'), 'utf8');

		expect(source).toContain('npm ci for verification failed; retrying in 60 seconds.');
		expect(source).not.toContain("if (node.branchMode !== 'project-save' || !hasNpmLockfile(node.path)) return;");
	});

	it('serializes verified repository saves to avoid package install resource exhaustion', () => {
		const source = readFileSync(resolve(testDir, '../../src/operations/services/repository-save-orchestrator.ts'), 'utf8');

		expect(source).toContain("options.verifyMode && options.verifyMode !== 'skip'");
		expect(source).toContain('return 1;');
		expect(source).toContain('TREESEED_SAVE_REPOSITORY_CONCURRENCY');
		expect(source).toContain('await runLimited(wave, concurrency');
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

	it('repairs stale root workspace lockfile metadata before committing', async () => {
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
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
			writeFileSync(resolve(root, 'README.md'), 'initial\nupdated\n', 'utf8');

			const result = await runRepositorySaveOrchestrator({
				root,
				gitRoot: root,
				branch: 'staging',
				commitMessageMode: 'fallback',
				verifyMode: 'skip',
			});

			expect(result.rootRepo.committed).toBe(true);
			expect(result.rootRepo.lockfileValidation?.issues).toEqual([]);
			const lockfile = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
			expect(lockfile.packages[''].workspaces).toEqual(['packages/*']);
			expect(lockfile.packages[''].dependencies).toEqual({
				'@treeseed/sdk': 'github:treeseed-ai/sdk#0.1.0-dev.staging.20260427T000000Z',
			});
			expect(lockfile.packages['packages/sdk'].version).toBe('0.1.0');
			expect(lockfile.packages['node_modules/@treeseed/sdk']).toEqual({
				resolved: 'packages/sdk',
				link: true,
			});
			expect(git(root, ['status', '--porcelain'])).toBe('');
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

	it('runs verification for hosted project repositories that declare verify scripts', async () => {
		vi.stubEnv('TREESEED_SAVE_NPM_INSTALL_MODE', 'skip');
		try {
			const root = mkdtempSync(join(tmpdir(), 'treeseed-save-hosted-project-'));
			const origin = mkdtempSync(join(tmpdir(), 'treeseed-save-hosted-project-origin-'));
			git(origin, ['init', '--bare']);
			git(root, ['init', '-b', 'staging']);
			git(root, ['config', 'user.email', 'test@example.com']);
			git(root, ['config', 'user.name', 'Test User']);
			git(root, ['remote', 'add', 'origin', origin]);
			writeFileSync(resolve(root, 'package.json'), JSON.stringify({
				name: '@treeseed/api',
				version: '0.4.1',
				private: true,
				scripts: {
					'verify:local': 'node -e "process.exit(0)"',
				},
			}, null, 2), 'utf8');
			writeFileSync(resolve(root, 'README.md'), 'initial\n', 'utf8');
			git(root, ['add', '-A']);
			git(root, ['commit', '-m', 'chore: initial']);
			git(root, ['push', '-u', 'origin', 'staging']);

			writeFileSync(resolve(root, 'README.md'), 'initial\nupdated\n', 'utf8');
			const progress: string[] = [];
			const result = await runRepositorySaveOrchestrator({
				root,
				gitRoot: root,
				branch: 'staging',
				commitMessageMode: 'fallback',
				verifyMode: 'local-only',
				onProgress: (line) => progress.push(line),
			});

			expect(result.rootRepo.branchMode).toBe('project-save');
			expect(result.rootRepo.verification).toMatchObject({
				status: 'passed',
				primary: 'verify:local',
			});
			expect(progress).toContain('[@treeseed/api][verify] $ npm run verify:local');
			expect(progress).not.toContain('[@treeseed/api][verify] Skipped package verification for project repository.');
		} finally {
			vi.unstubAllEnvs();
		}
	});

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

	it('finalizes a clean package with an interrupted dev version and missing tag', async () => {
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
			expect(result.rootRepo.tagName).toBe(version);
			expect(result.rootRepo.pushed).toBe(true);
			expect(progress).toContain(`[@treeseed/demo][push] $ git push origin staging ${version}`);
			expect(git(root, ['rev-list', '-n', '1', version])).toBe(git(root, ['rev-parse', 'HEAD']));
			expect(git(root, ['ls-remote', '--tags', 'origin', `refs/tags/${version}`])).toContain(version);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it('summarizes successful lockfile dry-run output during save', async () => {
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

			expect(
				progress.some((line) => /Lockfile validation passed: \d+ packages? checked, 0 issues\./u.test(line)),
				progress.join('\n'),
			).toBe(true);
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
