import { chmod, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
	collectTreeseedDependencyStatus,
	collectTreeseedToolStatus,
	installTreeseedDependencies,
	resolveTreeseedToolBinary,
} from '../../src/managed-dependencies.ts';

const roots: string[] = [];
type SpawnCall = { command: string; args: string[]; cwd?: string; env?: NodeJS.ProcessEnv };

async function createTempToolsHome() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-managed-deps-'));
	roots.push(root);
	return root;
}

async function createManagedGh(toolsHome: string) {
	const gh = join(toolsHome, 'gh', '2.90.0', `${process.platform}-${process.arch}`, 'bin', 'gh');
	await mkdir(join(gh, '..'), { recursive: true });
	await writeFile(gh, '#!/bin/sh\necho gh version 2.90.0\n', 'utf8');
	await chmod(gh, 0o755);
	return gh;
}

async function createPackageRoot(options: { nodeModules?: boolean } = {}) {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-managed-deps-package-'));
	roots.push(root);
	await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'managed-deps-test', private: true }, null, 2), 'utf8');
	if (options.nodeModules) {
		await mkdir(join(root, 'node_modules'), { recursive: true });
	}
	return root;
}

function spawnMock(options: { docker?: boolean; actInstalled?: boolean; npmStatus?: number; calls?: SpawnCall[] } = {}) {
	let actInstalled = options.actInstalled === true;
	return ((command: string, args: string[], spawnOptions?: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
		options.calls?.push({ command, args, cwd: spawnOptions?.cwd, env: spawnOptions?.env });
			if (args.includes('install') && args.includes('--no-audit') && args.includes('--no-fund')) {
				return options.npmStatus === 1
					? { status: 1, stdout: '', stderr: 'npm install failed' }
					: { status: 0, stdout: 'npm install completed\n', stderr: '' };
			}
			if (command === 'bash' && args.join(' ').includes('command -v git')) {
				return { status: 0, stdout: 'Agent pid 123\n/usr/bin/git\n', stderr: '' };
			}
		if (command === 'bash' && args.join(' ').includes('command -v docker')) {
			return options.docker ? { status: 0, stdout: '/usr/bin/docker\n', stderr: '' } : { status: 1, stdout: '', stderr: '' };
		}
		if (args.includes('--version') && !args.includes('act')) {
			return { status: 0, stdout: 'gh version 2.90.0\n', stderr: '' };
		}
			if (args[0] === 'auth' && args[1] === 'status') {
				return spawnOptions?.env?.GH_TOKEN
					? { status: 0, stdout: 'Logged in to github.com\n  - Token: github_pat_example123********************************\n', stderr: '' }
					: { status: 1, stdout: '', stderr: 'You are not logged into any GitHub hosts.' };
			}
		if (args[0] === 'act' && args[1] === '--version') {
			return actInstalled
				? { status: 0, stdout: 'gh act version 0.2.80\n', stderr: '' }
				: { status: 1, stdout: '', stderr: 'unknown command act' };
		}
		if (args[0] === 'extension' && args[1] === 'install') {
			actInstalled = true;
			return { status: 0, stdout: 'installed\n', stderr: '' };
		}
		return { status: 0, stdout: '', stderr: '' };
	}) as never;
}

describe('managed dependencies', () => {
	afterEach(async () => {
		await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
		roots.length = 0;
	});

	it('uses TREESEED_TOOLS_HOME for managed dependency status', async () => {
		const toolsHome = await createTempToolsHome();
		const result = collectTreeseedDependencyStatus({
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome },
			spawn: spawnMock(),
		});

		expect(result.toolsHome).toBe(toolsHome);
		expect(result.ghConfigDir).toBe(join(toolsHome, 'gh-config'));
	});

	it('resolves npm-backed tool binaries from the SDK dependency graph', () => {
		expect(resolveTreeseedToolBinary('wrangler')).toContain('wrangler');
		expect(resolveTreeseedToolBinary('railway')).toContain('@railway');
		expect(resolveTreeseedToolBinary('copilot')).toContain('@github');
		expect(resolveTreeseedToolBinary('copilot-sdk')).toBeNull();
	});

	it('reports the Copilot TypeScript SDK as a managed npm package', () => {
		const result = collectTreeseedDependencyStatus({ spawn: spawnMock() });
		const sdk = result.reports.find((entry) => entry.name === 'copilot-sdk');
		expect(sdk?.status).toBe('already-present');
		expect(sdk?.detail).toContain('@github/copilot-sdk');
	});

	it('reports tool invocation paths and GitHub auth remediation without installing', async () => {
		const toolsHome = await createTempToolsHome();
		const gh = await createManagedGh(toolsHome);
		const result = collectTreeseedToolStatus({
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome, GH_TOKEN: '' },
			spawn: spawnMock(),
		});

		expect(result.tools.find((entry) => entry.name === 'gh')?.invocation).toMatchObject({
			mode: 'direct',
			command: gh,
			binaryPath: gh,
		});
		expect(result.auth.github.authenticated).toBe(false);
		expect(result.auth.github.remediation.join('\n')).toContain('GH_TOKEN');
	});

	it('authenticates managed GitHub CLI through GH_TOKEN for hosted workflow gates', async () => {
		const toolsHome = await createTempToolsHome();
		await createManagedGh(toolsHome);
		const result = collectTreeseedToolStatus({
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome, GH_TOKEN: 'secret-token' },
			spawn: spawnMock(),
		});

			expect(result.auth.github.authenticated).toBe(true);
			expect(result.auth.github.command.join(' ')).toContain('auth status --hostname github.com');
			expect(result.auth.github.detail).not.toContain('github_pat_example123');
			expect(result.auth.github.detail).toContain('Token: ***');
		});

	it('runs npm install when package.json exists and node_modules is missing', async () => {
		const toolsHome = await createTempToolsHome();
		const packageRoot = await createPackageRoot();
		await createManagedGh(toolsHome);
		const calls: SpawnCall[] = [];
		const result = await installTreeseedDependencies({
			tenantRoot: packageRoot,
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome, npm_execpath: '/tmp/npm-cli.js' },
			spawn: spawnMock({ calls }),
			downloadFile: async () => {
				throw new Error('download should not be called');
			},
		});

		expect(result.ok).toBe(true);
		expect(result.npmInstalls[0]).toMatchObject({
			root: packageRoot,
			status: 'installed',
			exitCode: 0,
		});
		const npmCall = calls.find((call) => call.args.includes('install'));
		expect(npmCall?.command).toBe(process.execPath);
		expect(npmCall?.args).toEqual(['/tmp/npm-cli.js', 'install', '--no-audit', '--no-fund']);
		expect(npmCall?.cwd).toBe(packageRoot);
		expect(npmCall?.env?.TREESEED_MANAGED_NPM_INSTALL).toBe('1');
	});

	it('skips npm install when no package.json exists', async () => {
		const toolsHome = await createTempToolsHome();
		await createManagedGh(toolsHome);
		const calls: SpawnCall[] = [];
		const result = await installTreeseedDependencies({
			tenantRoot: toolsHome,
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome },
			spawn: spawnMock({ calls }),
			downloadFile: async () => {
				throw new Error('download should not be called');
			},
		});

		expect(result.npmInstalls[0]?.status).toBe('skipped');
		expect(calls.some((call) => call.args.includes('install'))).toBe(false);
	});

	it('forces npm install when dependencies are already present', async () => {
		const toolsHome = await createTempToolsHome();
		const packageRoot = await createPackageRoot({ nodeModules: true });
		await createManagedGh(toolsHome);
		const calls: SpawnCall[] = [];
		const result = await installTreeseedDependencies({
			tenantRoot: packageRoot,
			force: true,
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome },
			spawn: spawnMock({ calls }),
			downloadFile: async () => {
				throw new Error('download should not be called');
			},
		});

		expect(result.npmInstalls[0]?.status).toBe('installed');
		expect(calls.some((call) => call.args.includes('install'))).toBe(true);
	});

	it('skips npm install during managed npm lifecycle recursion', async () => {
		const toolsHome = await createTempToolsHome();
		const packageRoot = await createPackageRoot();
		await createManagedGh(toolsHome);
		const calls: SpawnCall[] = [];
		const result = await installTreeseedDependencies({
			tenantRoot: packageRoot,
			env: {
				...process.env,
				TREESEED_TOOLS_HOME: toolsHome,
				TREESEED_MANAGED_NPM_INSTALL: '1',
			},
			spawn: spawnMock({ calls }),
			downloadFile: async () => {
				throw new Error('download should not be called');
			},
		});

		expect(result.npmInstalls[0]?.status).toBe('skipped');
		expect(result.npmInstalls[0]?.detail).toContain('TREESEED_MANAGED_NPM_INSTALL=1');
		expect(calls.some((call) => call.args.includes('install'))).toBe(false);
	});

	it('fails the dependency install report when npm install fails', async () => {
		const toolsHome = await createTempToolsHome();
		const packageRoot = await createPackageRoot();
		await createManagedGh(toolsHome);
		const result = await installTreeseedDependencies({
			tenantRoot: packageRoot,
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome },
			spawn: spawnMock({ npmStatus: 1 }),
			downloadFile: async () => {
				throw new Error('download should not be called');
			},
		});

		expect(result.ok).toBe(false);
		expect(result.npmInstalls[0]).toMatchObject({
			status: 'failed',
			exitCode: 1,
		});
		expect(result.npmInstalls[0]?.detail).toContain('npm install failed');
	});

	it('skips gh-act installation when docker is not on PATH', async () => {
		const toolsHome = await createTempToolsHome();
		await createManagedGh(toolsHome);
		const result = await installTreeseedDependencies({
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome },
			spawn: spawnMock({ docker: false }),
			downloadFile: async () => {
				throw new Error('download should not be called');
			},
		});

		expect(result.ok).toBe(true);
		expect(result.reports.find((entry) => entry.name === 'gh')?.status).toBe('already-present');
		expect(result.reports.find((entry) => entry.name === 'gh-act')?.status).toBe('skipped');
	});

	it('installs gh-act when docker is on PATH without requiring docker info', async () => {
		const toolsHome = await createTempToolsHome();
		await createManagedGh(toolsHome);
		const calls: Array<{ command: string; args: string[] }> = [];
		const result = await installTreeseedDependencies({
			env: { ...process.env, TREESEED_TOOLS_HOME: toolsHome },
			spawn: spawnMock({ docker: true, calls }),
			downloadFile: async () => {
				throw new Error('download should not be called');
			},
		});

		expect(result.ok).toBe(true);
		expect(result.reports.find((entry) => entry.name === 'gh-act')?.status).toBe('installed');
		expect(calls.some((call) => call.command === 'docker')).toBe(false);
		expect(calls.some((call) => call.args.includes('https://github.com/nektos/gh-act'))).toBe(true);
	});
});
