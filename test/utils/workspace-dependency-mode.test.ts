import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	assertNoWorkspaceLinksInDeploymentLockfiles,
	collectDeploymentLockfileWorkspaceIssues,
	discoverWorkspaceLinks,
	ensureLocalWorkspaceLinks,
	inspectWorkspaceDependencyMode,
	unlinkLocalWorkspaceLinks,
} from '../../src/operations/services/workspace-dependency-mode.ts';

function writeJson(path: string, value: Record<string, unknown>) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function createWorkspace() {
	const root = mkdtempSync(join(tmpdir(), 'treeseed-workspace-links-'));
	writeJson(resolve(root, 'package.json'), {
		name: '@treeseed/market',
		version: '1.0.0',
		workspaces: ['packages/*'],
		dependencies: {
			'@treeseed/core': 'github:treeseed-ai/core#0.1.0-dev.staging.20260427T000000Z',
			'@treeseed/cli': 'github:treeseed-ai/cli#0.1.0-dev.staging.20260427T000000Z',
		},
	});
	writeJson(resolve(root, 'packages/sdk/package.json'), {
		name: '@treeseed/sdk',
		version: '0.1.0',
	});
	writeJson(resolve(root, 'packages/core/package.json'), {
		name: '@treeseed/core',
		version: '0.1.0',
		dependencies: {
			'@treeseed/sdk': 'github:treeseed-ai/sdk#0.1.0-dev.staging.20260427T000000Z',
		},
	});
	writeJson(resolve(root, 'packages/cli/package.json'), {
		name: '@treeseed/cli',
		version: '0.1.0',
		dependencies: {
			'@treeseed/sdk': 'github:treeseed-ai/sdk#0.1.0-dev.staging.20260427T000000Z',
			'@treeseed/core': 'github:treeseed-ai/core#0.1.0-dev.staging.20260427T000000Z',
		},
	});
	return root;
}

describe('workspace dependency mode', () => {
	it('discovers root and package-local workspace links', () => {
		const root = createWorkspace();
		const links = discoverWorkspaceLinks(root);

		expect(links.map((link) => link.packageName)).toEqual([
			'@treeseed/sdk',
			'@treeseed/core',
			'@treeseed/cli',
			'@treeseed/sdk',
			'@treeseed/core',
			'@treeseed/sdk',
		]);
		expect(links.some((link) => link.linkPath.endsWith('packages/core/node_modules/@treeseed/sdk'))).toBe(true);
	});

	it('creates, inspects, and unlinks managed workspace symlinks', () => {
		const root = createWorkspace();
		const created = ensureLocalWorkspaceLinks(root);
		const sdkLink = resolve(root, 'node_modules/@treeseed/sdk');

		expect(created.created.length).toBeGreaterThan(0);
		expect(lstatSync(sdkLink).isSymbolicLink()).toBe(true);
		expect(readlinkSync(sdkLink)).toContain('../../packages/sdk');
		expect(inspectWorkspaceDependencyMode(root).mode).toBe('local-workspace');
		expect(existsSync(resolve(root, '.treeseed/workspace-links.json'))).toBe(true);

		const removed = unlinkLocalWorkspaceLinks(root);

		expect(removed.removed.length).toBeGreaterThan(0);
		expect(existsSync(sdkLink)).toBe(false);
	});

	it('repairs broken managed links idempotently', () => {
		const root = createWorkspace();
		ensureLocalWorkspaceLinks(root);
		const sdkLink = resolve(root, 'node_modules/@treeseed/sdk');
		const current = readlinkSync(sdkLink);
		unlinkLocalWorkspaceLinks(root);
		mkdirSync(dirname(sdkLink), { recursive: true });
		symlinkSync(resolve(root, 'missing-sdk'), sdkLink, 'dir');

		ensureLocalWorkspaceLinks(root);

		expect(readlinkSync(sdkLink)).toBe(current);
	});

	it('refuses to replace unmanaged non-package paths', () => {
		const root = createWorkspace();
		const sdkLink = resolve(root, 'node_modules/@treeseed/sdk');
		mkdirSync(sdkLink, { recursive: true });
		writeFileSync(resolve(sdkLink, 'README.md'), 'unmanaged\n', 'utf8');

		expect(() => ensureLocalWorkspaceLinks(root)).toThrow(/Refusing to replace unmanaged path/u);
	});

	it('allows declared root workspace links in the root lockfile', () => {
		const root = createWorkspace();
		writeJson(resolve(root, 'package-lock.json'), {
			name: '@treeseed/market',
			lockfileVersion: 3,
			packages: {
				'': {
					name: '@treeseed/market',
					workspaces: ['packages/*'],
					dependencies: {
						'@treeseed/core': 'github:treeseed-ai/core#0.1.0-dev.staging.20260427T000000Z',
						'@treeseed/cli': 'github:treeseed-ai/cli#0.1.0-dev.staging.20260427T000000Z',
					},
				},
				'node_modules/@treeseed/sdk': {
					resolved: 'packages/sdk',
					link: true,
				},
				'node_modules/@treeseed/core': {
					resolved: 'packages/core',
					link: true,
				},
				'node_modules/@treeseed/cli': {
					resolved: 'packages/cli',
					link: true,
				},
				'packages/sdk': {
					name: '@treeseed/sdk',
					version: '0.1.0',
				},
				'packages/core': {
					name: '@treeseed/core',
					version: '0.1.0',
				},
				'packages/cli': {
					name: '@treeseed/cli',
					version: '0.1.0',
				},
			},
		});

		expect(collectDeploymentLockfileWorkspaceIssues(root)).toHaveLength(0);
		expect(() => assertNoWorkspaceLinksInDeploymentLockfiles(root)).not.toThrow();
	});

	it('rejects stale root workspace lockfile metadata', () => {
		const root = createWorkspace();
		writeJson(resolve(root, 'package-lock.json'), {
			name: '@treeseed/market',
			lockfileVersion: 3,
			packages: {
				'': { name: '@treeseed/market' },
				'node_modules/@treeseed/sdk': {
					resolved: 'packages/sdk',
					link: true,
				},
				'packages/sdk': {
					name: '@treeseed/sdk',
					version: '0.0.9',
				},
			},
		});

		const issues = collectDeploymentLockfileWorkspaceIssues(root).map((issue) => issue.reason);
		expect(issues.some((issue) => issue.startsWith('root-workspaces-mismatch'))).toBe(true);
		expect(issues.some((issue) => issue.startsWith('workspace-package-version-mismatch'))).toBe(true);
		expect(() => assertNoWorkspaceLinksInDeploymentLockfiles(root)).toThrow(/Deployment lockfile validation failed/u);
	});

	it('rejects package-local workspace-link contamination in deployment lockfiles', () => {
		const root = createWorkspace();
		writeJson(resolve(root, 'packages/core/package-lock.json'), {
			name: '@treeseed/core',
			lockfileVersion: 3,
			packages: {
				'': { name: '@treeseed/core' },
				'node_modules/@treeseed/sdk': {
					resolved: '../sdk',
					link: true,
				},
			},
		});

		expect(collectDeploymentLockfileWorkspaceIssues(root)).toEqual([
			expect.objectContaining({
				filePath: resolve(root, 'packages/core/package-lock.json'),
				packageName: '@treeseed/sdk',
				reason: 'workspace-link-lock-entry',
			}),
		]);
		expect(() => assertNoWorkspaceLinksInDeploymentLockfiles(root)).toThrow(/Deployment lockfile validation failed/u);
	});
});
