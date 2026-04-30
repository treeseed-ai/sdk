import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { getTreeseedVerifyDriverStatus, runTreeseedVerifyDriver } from '../../src/verification.ts';

async function createPackage(
	root: string,
	name: string,
	dependencies?: Record<string, string>,
) {
	const dirName = name.split('/').pop() ?? name;
	const packageRoot = join(root, 'packages', dirName);
	await mkdir(packageRoot, { recursive: true });
	await writeFile(
		join(packageRoot, 'package.json'),
		JSON.stringify({
			name,
			version: '0.0.0',
			type: 'module',
			scripts: {
				'verify:direct': 'echo direct',
			},
			...(dependencies ? { dependencies } : {}),
		}, null, 2),
	);
	await mkdir(join(packageRoot, '.github', 'workflows'), { recursive: true });
	await writeFile(join(packageRoot, '.github', 'workflows', 'verify.yml'), 'name: Verify\n');
	return packageRoot;
}

async function createWorkspaceFixture(
	currentPackageName: string,
	currentDependencies?: Record<string, string>,
) {
	const root = await mkdtemp(join(tmpdir(), 'treeseed-sdk-verification-'));
	const currentPackageRoot = await createPackage(root, currentPackageName, currentDependencies);
	return { root, currentPackageRoot };
}

describe('verify driver', () => {
	afterEach(() => {
		delete process.env.GITHUB_ACTIONS;
		delete process.env.TREESEED_VERIFY_DRIVER;
		delete process.env.TREESEED_VERIFY_EVENT;
		delete process.env.TREESEED_VERIFY_ACT_UBUNTU_LATEST_IMAGE;
	});

	it('detects local sibling treeseed dependencies in a packages workspace', async () => {
		delete process.env.GITHUB_ACTIONS;
		const fixture = await createWorkspaceFixture('@treeseed/core', {
			'@treeseed/sdk': '^0.3.1',
		});
		await createPackage(fixture.root, '@treeseed/sdk');

		try {
			const status = getTreeseedVerifyDriverStatus({ packageRoot: fixture.currentPackageRoot, driver: 'auto' });

			expect(status.workspaceRoot).toBe(fixture.root);
			expect(status.currentPackageName).toBe('@treeseed/core');
			expect(status.localTreeseedPackageNames).toEqual(['@treeseed/core', '@treeseed/sdk']);
			expect(status.localTreeseedSiblingDependencies).toEqual(['@treeseed/sdk']);
			expect(status.prefersDirectForLocalWorkspace).toBe(true);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it('does not prefer direct without local sibling treeseed dependencies', async () => {
		const fixture = await createWorkspaceFixture('@treeseed/sdk');
		await createPackage(fixture.root, '@treeseed/core', {
			'@treeseed/sdk': '^0.3.1',
		});

		try {
			const status = getTreeseedVerifyDriverStatus({ packageRoot: fixture.currentPackageRoot });
			expect(status.localTreeseedPackageNames).toEqual(['@treeseed/core', '@treeseed/sdk']);
			expect(status.localTreeseedSiblingDependencies).toEqual([]);
			expect(status.prefersDirectForLocalWorkspace).toBe(false);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it('prefers verify:direct in auto mode for local sibling treeseed dependencies', async () => {
		const fixture = await createWorkspaceFixture('@treeseed/core', {
			'@treeseed/sdk': '^0.3.1',
		});
		await createPackage(fixture.root, '@treeseed/sdk');
		const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

		try {
			expect(runTreeseedVerifyDriver({
				packageRoot: fixture.currentPackageRoot,
				checkCommand() {
					return { ok: true, detail: '' };
				},
				runCommand(command, args, cwd) {
					calls.push({ command, args, cwd });
					return 0;
				},
			})).toBe(0);
			expect(calls).toEqual([
				{ command: 'npm', args: ['run', 'verify:direct'], cwd: fixture.currentPackageRoot },
			]);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it('still honors explicit act mode even when local sibling treeseed dependencies exist', async () => {
		const fixture = await createWorkspaceFixture('@treeseed/core', {
			'@treeseed/sdk': '^0.3.1',
		});
		await createPackage(fixture.root, '@treeseed/sdk');
		const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

		try {
			expect(runTreeseedVerifyDriver({
				packageRoot: fixture.currentPackageRoot,
				driver: 'act',
				checkCommand() {
					return { ok: true, detail: '' };
				},
				runCommand(command, args, cwd) {
					calls.push({ command, args, cwd });
					return 0;
				},
			})).toBe(0);
			expect(calls).toHaveLength(1);
			expect(calls[0]).toMatchObject({
				command: 'gh',
				args: [
					'act',
					'workflow_dispatch',
					'-W',
					expect.stringMatching(/treeseed-verify-act-.*\/verify\.yml$/),
					'-j',
					'verify',
					'-P',
					'ubuntu-latest=catthehacker/ubuntu:act-latest',
				],
				cwd: fixture.root,
			});
			const workflow = await readFile(calls[0].args[3], 'utf8');
			expect(workflow).toContain('npm --prefix packages/sdk ci --workspaces=false');
			expect(workflow).toContain('npm ci --workspaces=false');
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it('allows the act ubuntu-latest image mapping to be overridden', async () => {
		const fixture = await createWorkspaceFixture('@treeseed/sdk');
		const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
		process.env.TREESEED_VERIFY_ACT_UBUNTU_LATEST_IMAGE = 'example.local/ubuntu:verify';

		try {
			expect(runTreeseedVerifyDriver({
				packageRoot: fixture.currentPackageRoot,
				driver: 'act',
				checkCommand() {
					return { ok: true, detail: '' };
				},
				runCommand(command, args, cwd) {
					calls.push({ command, args, cwd });
					return 0;
				},
			})).toBe(0);
			expect(calls).toEqual([
				{
					command: 'gh',
					args: ['act', 'workflow_dispatch', '-W', '.github/workflows/verify.yml', '-j', 'verify', '-P', 'ubuntu-latest=example.local/ubuntu:verify'],
					cwd: fixture.currentPackageRoot,
				},
			]);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});

	it('still honors direct mode and github actions direct execution', async () => {
		const fixture = await createWorkspaceFixture('@treeseed/core', {
			'@treeseed/sdk': '^0.3.1',
		});
		await createPackage(fixture.root, '@treeseed/sdk');
		const calls: Array<{ command: string; args: string[]; cwd: string }> = [];

		try {
			expect(runTreeseedVerifyDriver({
				packageRoot: fixture.currentPackageRoot,
				driver: 'direct',
				checkCommand() {
					return { ok: true, detail: '' };
				},
				runCommand(command, args, cwd) {
					calls.push({ command, args, cwd });
					return 0;
				},
			})).toBe(0);

			process.env.GITHUB_ACTIONS = 'true';
			expect(runTreeseedVerifyDriver({
				packageRoot: fixture.currentPackageRoot,
				checkCommand() {
					return { ok: true, detail: '' };
				},
				runCommand(command, args, cwd) {
					calls.push({ command, args, cwd });
					return 0;
				},
			})).toBe(0);
			expect(calls).toEqual([
				{ command: 'npm', args: ['run', 'verify:direct'], cwd: fixture.currentPackageRoot },
				{ command: 'npm', args: ['run', 'verify:direct'], cwd: fixture.currentPackageRoot },
			]);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	});
});
