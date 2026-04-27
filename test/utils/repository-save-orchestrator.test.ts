import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import {
	discoverRepositorySaveNodes,
	nextDevVersion,
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

		expect(progress).toContain('[save][@treeseed/demo][start] Starting project-save on staging.');
		expect(progress.some((line) => line.startsWith('[save][@treeseed/demo][commit] $ git commit'))).toBe(true);
		expect(progress.some((line) => line.startsWith('[save][@treeseed/demo][push] $ git push'))).toBe(true);
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

			const result = await runRepositorySaveOrchestrator({
				root,
				gitRoot: root,
				branch: 'staging',
				commitMessageMode: 'fallback',
				verifyMode: 'skip',
			});

			expect(result.rootRepo.version).toBe(version);
			expect(result.rootRepo.tagName).toBe(version);
			expect(result.rootRepo.pushed).toBe(true);
			expect(git(root, ['rev-list', '-n', '1', version])).toBe(git(root, ['rev-parse', 'HEAD']));
			expect(git(root, ['ls-remote', '--tags', 'origin', `refs/tags/${version}`])).toContain(version);
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
