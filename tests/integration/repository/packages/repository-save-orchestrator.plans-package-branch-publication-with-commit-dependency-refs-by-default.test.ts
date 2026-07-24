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
it('plans package branch publication with commit dependency refs by default', () => {
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
		expect(plan.rootRepo.plannedTag).toBeNull();
		expect(plan.rootRepo.plannedDependencySpec).toMatch(/^git\+file:\/\/.*#HEAD$/u);
		expect(plan.rootRepo.commands).toContain('git push -u origin staging');
		expect(plan.rootRepo.commands).not.toContain(`git push -u origin staging ${version}`);
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
					'': {
						name: '@treeseed/market',
						dependencies: {
							'@treeseed/sdk': 'github:treeseed-ai/sdk#stale-release-ref',
						},
					},
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

it('pushes a clean starter repository when its committed head is ahead of origin', async () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-save-clean-ahead-template-'));
		const origin = mkdtempSync(join(tmpdir(), 'treeseed-save-clean-ahead-template-origin-'));
		git(origin, ['init', '--bare']);
		git(root, ['init', '-b', 'staging']);
		git(root, ['config', 'user.email', 'test@example.com']);
		git(root, ['config', 'user.name', 'Test User']);
		git(root, ['remote', 'add', 'origin', origin]);
		writeJson(resolve(root, 'template.config.json'), {
			id: 'engineering',
			displayName: 'Engineering',
			category: 'starter',
			templateVersion: '1.0.0',
		});
		writeFileSync(resolve(root, 'treeseed.template.yaml'), [
			'id: engineering',
			'name: Engineering',
			'category: starter',
			'versionSource: template.config.json',
			'',
		].join('\n'), 'utf8');
		writeFileSync(resolve(root, 'README.md'), 'initial\n', 'utf8');
		git(root, ['add', '-A']);
		git(root, ['commit', '-m', 'chore: initial']);
		git(root, ['push', '-u', 'origin', 'staging']);
		writeFileSync(resolve(root, 'README.md'), 'initial\ncompleted locally\n', 'utf8');
		git(root, ['add', 'README.md']);
		git(root, ['commit', '-m', 'docs: complete starter']);
		const aheadHead = git(root, ['rev-parse', 'HEAD']);

		const result = await runRepositorySaveOrchestrator({
			root,
			gitRoot: root,
			branch: 'staging',
			commitMessageMode: 'fallback',
			verifyMode: 'skip',
		});

		expect(result.rootRepo.dirty).toBe(false);
		expect(result.rootRepo.committed).toBe(false);
		expect(result.rootRepo.pushed).toBe(true);
		expect(result.rootRepo.skippedReason).toBe('clean');
		expect(git(root, ['ls-remote', 'origin', 'refs/heads/staging']).split(/\s+/u)[0]).toBe(aheadHead);
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
});
