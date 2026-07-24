import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readSourceModule } from '../../../support/workspace-test-root.ts';

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
it('validates package locks without mutating the live install and synchronizes package versions', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-isolated-lock-'));
		const packageJsonPath = resolve(root, 'package.json');
		const packageJson = { name: '@treeseed/demo', version: '1.0.0' };
		writeJson(packageJsonPath, packageJson);
		writeJson(resolve(root, 'package-lock.json'), {
			name: '@treeseed/demo',
			version: '1.0.0',
			lockfileVersion: 3,
			packages: { '': { name: '@treeseed/demo', version: '1.0.0' } },
		});
		const sentinelPath = resolve(root, 'node_modules/.bin/sentinel');
		mkdirSync(dirname(sentinelPath), { recursive: true });
		writeFileSync(sentinelPath, 'installed dependency state\n', 'utf8');
		const repo = node({
			id: root,
			name: '@treeseed/demo',
			path: root,
			packageJsonPath,
			packageJson,
		});

		expect(applyPackageVersion(repo, '1.0.1')).toBe(true);
		validateStandaloneGitDependencyLockfile(repo, {});

		const lockfile = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
		expect(lockfile.version).toBe('1.0.1');
		expect(lockfile.packages[''].version).toBe('1.0.1');
		expect(readFileSync(sentinelPath, 'utf8')).toBe('installed dependency state\n');
	});

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

		expect(plan.rootRepo.commands).toContain('npm ci --ignore-scripts --plan # validate root manifest, workspaces, and lockfile before commit');
		expect(plan.rootRepo.commands).not.toContain('npm install --workspaces=false # refresh project lockfile after internal dependency updates');
	});

it('keeps root workspace project verification off script-enabled npm ci', () => {
		const source = readSourceModule(resolve(testDir, '../../../../src/operations/services/repositories/repository-save-orchestrator.ts'));

		expect(source).toContain('Skipped root npm ci project verification install');
		expect(source).toContain('ensureLocalWorkspaceLinks(options.root)');
	});

it('installs package dependencies before unlinked local verification', () => {
		const source = readSourceModule(resolve(testDir, '../../../../src/operations/services/repositories/repository-save-orchestrator.ts'));

		expect(source).toContain('npm ci for verification failed; retrying in 60 seconds.');
		expect(source).not.toContain("if (node.branchMode !== 'project-save' || !hasNpmLockfile(node.path)) return;");
	});

it('rebases each save node against one explicit origin branch ref', () => {
		const source = readSourceModule(resolve(testDir, '../../../../src/operations/services/repositories/repository-save-orchestrator.ts'));

		expect(source).toContain("['fetch', 'origin'");
		expect(source).toContain('refs/heads/${branch}:refs/remotes/origin/${branch}');
		expect(source).toContain('refs/remotes/origin/${branch}');
		expect(source).not.toContain("['pull', '--rebase', '--recurse-submodules=no', 'origin', branch]");
	});

it('serializes verified repository saves to avoid package install resource exhaustion', () => {
		const source = readSourceModule(resolve(testDir, '../../../../src/operations/services/repositories/repository-save-orchestrator.ts'));

		expect(source).toContain("options.verifyMode && options.verifyMode !== 'skip'");
		expect(source).toContain('return 1;');
		expect(source).toContain('TREESEED_SAVE_REPOSITORY_CONCURRENCY');
		expect(source).toContain('await runLimited(wave, concurrency');
	});
});
