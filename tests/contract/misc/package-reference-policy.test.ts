import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	assertDevelopmentInternalCommitReferences,
	assertNoInternalDevReferences,
	collectInternalDevReferenceIssues,
	collectDevelopmentCommitReferenceIssues,
	createPackageDependencyReference,
	devTagFromDependencySpec,
	installableInternalDependencyVersions,
	normalizeGitRemoteForDependency,
	normalizeGitRemoteForManifest,
	rewriteInternalDependenciesToStableVersions,
	rewriteProjectInternalDependenciesToStableVersions,
} from '../../../src/operations/services/package-reference-policy.ts';

describe('package reference policy', () => {
	it('creates Git dependency specs for local, HTTPS, and SSH remotes', () => {
		expect(normalizeGitRemoteForDependency('/tmp/sdk.git')).toBe('git+file:///tmp/sdk.git');
		expect(normalizeGitRemoteForDependency('https://github.com/treeseed-ai/sdk.git')).toBe('git+https://github.com/treeseed-ai/sdk.git');
		expect(normalizeGitRemoteForDependency('git@github.com:treeseed-ai/sdk.git')).toBe('git+ssh://git@github.com/treeseed-ai/sdk.git');
		expect(normalizeGitRemoteForDependency('git@github.com:treeseed-ai/sdk.git', 'https')).toBe('git+https://github.com/treeseed-ai/sdk.git');
		expect(normalizeGitRemoteForManifest('https://github.com/treeseed-ai/sdk.git')).toBe('github:treeseed-ai/sdk');
		expect(normalizeGitRemoteForManifest('git@github.com:treeseed-ai/sdk.git')).toBe('github:treeseed-ai/sdk');

		const reference = createPackageDependencyReference({
			packageName: '@treeseed/sdk',
			version: '0.6.8-dev.feature-demo.20260426T153000Z',
			branchMode: 'package-dev-save',
			remoteUrl: '/tmp/sdk.git',
			commitSha: '0123456789abcdef0123456789abcdef01234567',
		});

		expect(reference.spec).toBe('git+file:///tmp/sdk.git#0123456789abcdef0123456789abcdef01234567');
		expect(reference.tagName).toBeNull();
		expect(reference.mode).toBe('dev-git-commit');
		expect(devTagFromDependencySpec(reference.spec)).toBeNull();
	});

	it('uses GitHub shorthand and commit refs in manifests and smoke specs by default', () => {
		const reference = createPackageDependencyReference({
			packageName: '@treeseed/sdk',
			version: '0.6.8-dev.staging.20260427T190628Z',
			branchMode: 'package-dev-save',
			remoteUrl: 'git@github.com:treeseed-ai/sdk.git',
			commitSha: 'fedcba9876543210fedcba9876543210fedcba98',
		});

		expect(reference.spec).toBe('github:treeseed-ai/sdk#fedcba9876543210fedcba9876543210fedcba98');
		expect(reference.manifestSpec).toBe('github:treeseed-ai/sdk#fedcba9876543210fedcba9876543210fedcba98');
		expect(reference.installSpec).toBe('github:treeseed-ai/sdk#fedcba9876543210fedcba9876543210fedcba98');
		expect(reference.tagName).toBeNull();
		expect(devTagFromDependencySpec(reference.manifestSpec)).toBeNull();
	});

	it('rewrites internal Git/dev refs to stable semver and validates the result', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-package-policy-'));
		const sdkDir = resolve(root, 'packages', 'sdk');
		const coreDir = resolve(root, 'packages', 'core');
		mkdirSync(sdkDir, { recursive: true });
		mkdirSync(coreDir, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: 'root',
			version: '1.0.0',
			workspaces: ['packages/*'],
		}, null, 2), 'utf8');
		writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({ name: 'root', lockfileVersion: 3 }, null, 2), 'utf8');
		writeFileSync(resolve(sdkDir, 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.6.8-dev.feature-demo.20260426T153000Z',
		}, null, 2), 'utf8');
		writeFileSync(resolve(coreDir, 'package.json'), JSON.stringify({
			name: '@treeseed/core',
			version: '0.6.9-dev.feature-demo.20260426T153000Z',
			dependencies: {
				'@treeseed/sdk': '0.6.8-dev.feature-demo.20260426T153000Z',
			},
		}, null, 2), 'utf8');

		const rewrites = rewriteInternalDependenciesToStableVersions(root, new Map([['@treeseed/sdk', '0.6.8']]));

		expect(rewrites).toHaveLength(1);
		expect(rewrites[0]?.tagName).toBe('0.6.8-dev.feature-demo.20260426T153000Z');
		expect(JSON.parse(readFileSync(resolve(coreDir, 'package.json'), 'utf8')).dependencies['@treeseed/sdk']).toBe('0.6.8');
		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).not.toThrow();
	});

	it('requires development and staging internal package refs to use commit SHAs', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-package-policy-'));
		const sdkDir = resolve(root, 'packages', 'sdk');
		const coreDir = resolve(root, 'packages', 'core');
		mkdirSync(sdkDir, { recursive: true });
		mkdirSync(coreDir, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			version: '1.0.0',
			workspaces: ['packages/*'],
			dependencies: {
				'@treeseed/core': '^0.11.1-dev.demo.20260626T000000Z',
			},
		}, null, 2), 'utf8');
		writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify({
			name: '@treeseed/market',
			lockfileVersion: 3,
			packages: {
				'': {
					dependencies: {
						'@treeseed/core': 'github:treeseed-ai/core#0.11.1-dev.demo.20260626T000000Z',
					},
				},
			},
		}, null, 2), 'utf8');
		writeFileSync(resolve(sdkDir, 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.11.1-dev.demo.20260626T000000Z',
		}, null, 2), 'utf8');
		writeFileSync(resolve(coreDir, 'package.json'), JSON.stringify({
			name: '@treeseed/core',
			version: '0.11.1-dev.demo.20260626T000000Z',
			dependencies: {
				'@treeseed/sdk': 'github:treeseed-ai/sdk#0123456789abcdef0123456789abcdef01234567',
			},
		}, null, 2), 'utf8');

		expect(collectDevelopmentCommitReferenceIssues(root).map((issue) => issue.reason)).toEqual([
			'prerelease-ref',
			'lockfile-git-ref-is-not-commit-sha',
		]);
		expect(() => assertDevelopmentInternalCommitReferences(root)).toThrow(/commit SHAs/u);

		const rootPackageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
		rootPackageJson.dependencies['@treeseed/core'] = 'github:treeseed-ai/core#fedcba9876543210fedcba9876543210fedcba98';
		writeFileSync(resolve(root, 'package.json'), JSON.stringify(rootPackageJson, null, 2), 'utf8');
		const rootLockfile = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
		rootLockfile.packages[''].dependencies['@treeseed/core'] = 'github:treeseed-ai/core#fedcba9876543210fedcba9876543210fedcba98';
		writeFileSync(resolve(root, 'package-lock.json'), JSON.stringify(rootLockfile, null, 2), 'utf8');
		expect(() => assertDevelopmentInternalCommitReferences(root)).not.toThrow();
	});

	it('rewrites public npm packages with Docker images while excluding private Docker-only packages', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-package-policy-'));
		const sdkDir = resolve(root, 'packages', 'sdk');
		const adminDir = resolve(root, 'packages', 'admin');
		const agentDir = resolve(root, 'packages', 'agent');
		const apiDir = resolve(root, 'packages', 'api');
		mkdirSync(sdkDir, { recursive: true });
		mkdirSync(adminDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(apiDir, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			version: '1.0.0',
			workspaces: ['packages/*'],
		}, null, 2), 'utf8');
		writeFileSync(resolve(sdkDir, 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.11.0-dev.staging.1',
		}, null, 2), 'utf8');
		writeFileSync(resolve(apiDir, 'package.json'), JSON.stringify({
			name: '@treeseed/api',
			version: '0.5.0-dev.staging.1',
			private: true,
		}, null, 2), 'utf8');
		writeFileSync(resolve(apiDir, 'treeseed.package.yaml'), 'id: "@treeseed/api"\nname: TreeSeed API\nkind: node-typescript\npublishTarget: docker\n', 'utf8');
		writeFileSync(resolve(agentDir, 'package.json'), JSON.stringify({
			name: '@treeseed/agent',
			version: '0.11.0-dev.staging.1',
			publishConfig: {
				access: 'public',
			},
		}, null, 2), 'utf8');
		writeFileSync(resolve(agentDir, 'treeseed.package.yaml'), 'id: "@treeseed/agent"\nname: TreeSeed Agent\nkind: node-typescript\npublishTarget: docker\n', 'utf8');
		writeFileSync(resolve(adminDir, 'package.json'), JSON.stringify({
			name: '@treeseed/admin',
			version: '0.11.0-dev.staging.1',
			dependencies: {
				'@treeseed/sdk': '0.11.0-dev.staging.1',
				'@treeseed/agent': '^0.11.0-dev.staging.1',
			},
			peerDependencies: {
				'@treeseed/api': '^0.4.1',
			},
			peerDependenciesMeta: {
				'@treeseed/api': {
					optional: true,
				},
			},
		}, null, 2), 'utf8');

		const versions = new Map([
			['@treeseed/sdk', '0.11.0'],
			['@treeseed/agent', '0.11.0'],
			['@treeseed/api', '0.5.0'],
		]);
		const installableVersions = installableInternalDependencyVersions(root, versions);
		const rewrites = rewriteProjectInternalDependenciesToStableVersions(root, versions);

		expect(installableVersions.has('@treeseed/sdk')).toBe(true);
		expect(installableVersions.has('@treeseed/agent')).toBe(true);
		expect(installableVersions.has('@treeseed/api')).toBe(false);
		expect(rewrites.map((rewrite) => rewrite.packageName)).toEqual(['@treeseed/sdk', '@treeseed/agent']);
		const adminPackageJson = JSON.parse(readFileSync(resolve(adminDir, 'package.json'), 'utf8'));
		expect(adminPackageJson.dependencies['@treeseed/sdk']).toBe('0.11.0');
		expect(adminPackageJson.dependencies['@treeseed/agent']).toBe('0.11.0');
		expect(adminPackageJson.peerDependencies['@treeseed/api']).toBe('^0.4.1');
	});

	it('rejects internal Git refs in production package manifests, including stable release tags', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-package-policy-'));
		const sdkDir = resolve(root, 'packages', 'sdk');
		const coreDir = resolve(root, 'packages', 'core');
		mkdirSync(sdkDir, { recursive: true });
		mkdirSync(coreDir, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: 'root',
			version: '1.0.0',
			workspaces: ['packages/*'],
		}, null, 2), 'utf8');
		writeFileSync(resolve(sdkDir, 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.10.1',
		}, null, 2), 'utf8');
		writeFileSync(resolve(coreDir, 'package.json'), JSON.stringify({
			name: '@treeseed/core',
			version: '0.10.1',
			dependencies: {
				'@treeseed/sdk': 'github:treeseed-ai/sdk#0.10.1',
			},
		}, null, 2), 'utf8');

		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).toThrow(/plain semver npm versions/u);

		const corePackageJson = JSON.parse(readFileSync(resolve(coreDir, 'package.json'), 'utf8'));
		corePackageJson.dependencies['@treeseed/sdk'] = 'github:treeseed-ai/sdk#0.10.2-dev.staging.20260520T010203Z';
		writeFileSync(resolve(coreDir, 'package.json'), JSON.stringify(corePackageJson, null, 2), 'utf8');

		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).toThrow(/plain semver npm versions/u);

		corePackageJson.dependencies['@treeseed/sdk'] = '^0.10.2-dev.staging.20260520T010203Z';
		writeFileSync(resolve(coreDir, 'package.json'), JSON.stringify(corePackageJson, null, 2), 'utf8');

		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).toThrow(/plain semver npm versions/u);

		corePackageJson.dependencies['@treeseed/sdk'] = '0.10.1';
		writeFileSync(resolve(coreDir, 'package.json'), JSON.stringify(corePackageJson, null, 2), 'utf8');
		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).not.toThrow();
	});

	it('leaves unselected verification-only packages unchanged during stable release rewrites', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-package-policy-selected-'));
		const sdkDir = resolve(root, 'packages', 'sdk');
		const cliDir = resolve(root, 'packages', 'cli');
		const reviewerDir = resolve(root, 'packages', 'reviewer');
		mkdirSync(sdkDir, { recursive: true });
		mkdirSync(cliDir, { recursive: true });
		mkdirSync(reviewerDir, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: '@treeseed/market',
			workspaces: ['packages/*'],
			dependencies: { '@treeseed/sdk': 'github:treeseed-ai/sdk#old' },
		}, null, 2), 'utf8');
		writeFileSync(resolve(sdkDir, 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.12.0-dev.staging.1',
			publishConfig: { access: 'public' },
		}, null, 2), 'utf8');
		writeFileSync(resolve(cliDir, 'package.json'), JSON.stringify({
			name: '@treeseed/cli',
			publishConfig: { access: 'public' },
			dependencies: { '@treeseed/sdk': 'github:treeseed-ai/sdk#old' },
		}, null, 2), 'utf8');
		writeFileSync(resolve(reviewerDir, 'package.json'), JSON.stringify({
			name: '@treeseed/reviewer',
			dependencies: {
				'@treeseed/cli': 'github:treeseed-ai/cli#old',
				'@treeseed/sdk': 'github:treeseed-ai/sdk#old',
			},
		}, null, 2), 'utf8');

		const reviewerBefore = readFileSync(resolve(reviewerDir, 'package.json'), 'utf8');
		const rewrites = rewriteProjectInternalDependenciesToStableVersions(root, new Map([
			['@treeseed/sdk', '0.12.57'],
			['@treeseed/cli', '0.12.53'],
		]), new Set(['@treeseed/sdk', '@treeseed/cli']));

		expect(rewrites.map((rewrite) => rewrite.repoName)).toEqual(['@treeseed/market', '@treeseed/cli']);
		expect(JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).dependencies['@treeseed/sdk']).toBe('0.12.57');
		expect(JSON.parse(readFileSync(resolve(cliDir, 'package.json'), 'utf8')).dependencies['@treeseed/sdk']).toBe('0.12.57');
		expect(readFileSync(resolve(reviewerDir, 'package.json'), 'utf8')).toBe(reviewerBefore);
		expect(collectInternalDevReferenceIssues(
			root,
			new Set(['@treeseed/sdk', '@treeseed/cli']),
			new Set(['@treeseed/sdk', '@treeseed/cli']),
		)).toEqual([]);
	});

	it('does not treat a lockfile root package prerelease version as an internal dependency ref', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-package-policy-'));
		const sdkDir = resolve(root, 'packages', 'sdk');
		mkdirSync(sdkDir, { recursive: true });
		writeFileSync(resolve(root, 'package.json'), JSON.stringify({
			name: 'root',
			version: '1.0.0',
			workspaces: ['packages/*'],
		}, null, 2), 'utf8');
		writeFileSync(resolve(sdkDir, 'package.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.6.8',
		}, null, 2), 'utf8');
		writeFileSync(resolve(sdkDir, 'package-lock.json'), JSON.stringify({
			name: '@treeseed/sdk',
			version: '0.6.9-dev.staging.20260501T202609Z',
			lockfileVersion: 3,
			packages: {
				'': {
					name: '@treeseed/sdk',
					version: '0.6.9-dev.staging.20260501T202609Z',
				},
			},
		}, null, 2), 'utf8');

		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).not.toThrow();
	});

});
