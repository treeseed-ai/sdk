import { existsSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	checkSharedFixture,
	prepareFixturePackages,
	resolveSharedFixtureRoot,
	type FixtureSupportDeclaration,
} from '../../src/fixture-support.ts';

const createdPaths: string[] = [];

function makeTempDir(prefix: string) {
	const tempDir = mkdtempSync(join(os.tmpdir(), prefix));
	createdPaths.push(tempDir);
	return tempDir;
}

function writeJson(filePath: string, value: unknown) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function createFixtureSite(root: string) {
	mkdirSync(join(root, 'src', 'content'), { recursive: true });
	writeFileSync(join(root, 'src', 'manifest.yaml'), 'site:\n  title: Fixture\n', 'utf8');
}

afterEach(() => {
	for (const path of createdPaths.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe('fixture support', () => {
	it('resolves and checks a shared fixture from the canonical fixtures repo layout', () => {
		const packageRoot = makeTempDir('treeseed-sdk-fixture-pkg-');
		const fixtureRepoRoot = join(packageRoot, '.fixtures', 'treeseed-fixtures');
		const fixtureSiteRoot = join(fixtureRepoRoot, 'sites', 'working-site');
		createFixtureSite(fixtureSiteRoot);
		writeJson(join(fixtureSiteRoot, 'fixture.manifest.json'), {
			id: 'treeseed-working-site',
			root: '.',
		});

		expect(resolveSharedFixtureRoot({ packageRoot })).toBe(fixtureSiteRoot);
		expect(checkSharedFixture({ packageRoot })).toBe(fixtureSiteRoot);
	});

	it('links workspace packages into the fixture when sibling packages are available', () => {
		const workspaceRoot = makeTempDir('treeseed-sdk-fixture-workspace-');
		const sdkRoot = join(workspaceRoot, 'sdk');
		const coreRoot = join(workspaceRoot, 'core');
		const fixtureRoot = join(coreRoot, '.fixtures', 'treeseed-fixtures', 'sites', 'working-site');
		const siblingSdkRoot = join(workspaceRoot, 'sdk');
		mkdirSync(sdkRoot, { recursive: true });
		writeJson(join(sdkRoot, 'package.json'), { name: '@treeseed/sdk' });
		mkdirSync(coreRoot, { recursive: true });
		createFixtureSite(fixtureRoot);

		const declarations: FixtureSupportDeclaration[] = [
			{
				packageName: '@treeseed/sdk',
				modes: ['workspace-link'],
				workspaceDirName: 'sdk',
			},
		];

		prepareFixturePackages({
			fixtureRoot,
			packageRoot: coreRoot,
			declarations,
		});

		const linkedPath = join(fixtureRoot, 'node_modules', '@treeseed', 'sdk');
		expect(existsSync(linkedPath)).toBe(true);
		expect(resolve(dirname(linkedPath), readlinkSync(linkedPath))).toBe(siblingSdkRoot);
	});

	it('creates the canonical agent contracts shim for package-only verification', () => {
		const packageRoot = makeTempDir('treeseed-sdk-fixture-core-');
		const fixtureRoot = join(packageRoot, '.fixtures', 'treeseed-fixtures', 'sites', 'working-site');
		createFixtureSite(fixtureRoot);

		prepareFixturePackages({
			fixtureRoot,
			packageRoot,
			declarations: [
				{
					packageName: '@treeseed/agent',
					modes: ['contracts-only'],
					contractsShim: 'agent',
				},
			],
		});

		expect(existsSync(join(fixtureRoot, 'node_modules', '@treeseed', 'agent', 'runtime-types.d.ts'))).toBe(true);
		expect(existsSync(join(fixtureRoot, 'node_modules', '@treeseed', 'agent', 'contracts', 'messages.d.ts'))).toBe(true);
		expect(existsSync(join(fixtureRoot, 'node_modules', '@treeseed', 'agent', 'contracts', 'run.d.ts'))).toBe(true);
	});

	it('links installed packages when no workspace sibling is available', () => {
		const packageRoot = makeTempDir('treeseed-sdk-fixture-installed-');
		const fixtureRoot = join(packageRoot, '.fixtures', 'treeseed-fixtures', 'sites', 'working-site');
		createFixtureSite(fixtureRoot);

		const installedRoot = makeTempDir('treeseed-installed-package-');
		writeJson(join(installedRoot, 'package.json'), { name: '@treeseed/fixture-installed' });
		writeFileSync(join(installedRoot, 'index.js'), 'export const fixtureInstalled = true;\n', 'utf8');

		const sdkNodeModulesRoot = resolve(new URL('../../node_modules', import.meta.url).pathname);
		const installedLinkPath = join(sdkNodeModulesRoot, '@treeseed', 'fixture-installed');
		mkdirSync(dirname(installedLinkPath), { recursive: true });
		symlinkSync(installedRoot, installedLinkPath, 'dir');
		createdPaths.push(installedLinkPath);

		prepareFixturePackages({
			fixtureRoot,
			packageRoot,
			declarations: [
				{
					packageName: '@treeseed/fixture-installed',
					modes: ['installed-link'],
				},
			],
		});

		expect(existsSync(join(fixtureRoot, 'node_modules', '@treeseed', 'fixture-installed', 'package.json'))).toBe(true);
	});
});
