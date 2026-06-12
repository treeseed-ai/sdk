import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	assertNoInternalDevReferences,
	classifyStaleTreeseedDevTag,
	createDevTagMessage,
	createPackageDependencyReference,
	devTagFromDependencySpec,
	installableInternalDependencyVersions,
	normalizeGitRemoteForDependency,
	normalizeGitRemoteForManifest,
	rewriteInternalDependenciesToStableVersions,
	rewriteProjectInternalDependenciesToStableVersions,
} from '../../src/operations/services/package-reference-policy.ts';

describe('package reference policy', () => {
	it('creates Git tag dependency specs for local, HTTPS, and SSH remotes', () => {
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
		});

		expect(reference.spec).toBe('git+file:///tmp/sdk.git#0.6.8-dev.feature-demo.20260426T153000Z');
		expect(devTagFromDependencySpec(reference.spec)).toBe('0.6.8-dev.feature-demo.20260426T153000Z');
	});

	it('uses GitHub shorthand in manifests and smoke specs', () => {
		const reference = createPackageDependencyReference({
			packageName: '@treeseed/sdk',
			version: '0.6.8-dev.staging.20260427T190628Z',
			branchMode: 'package-dev-save',
			remoteUrl: 'git@github.com:treeseed-ai/sdk.git',
		});

		expect(reference.spec).toBe('github:treeseed-ai/sdk#0.6.8-dev.staging.20260427T190628Z');
		expect(reference.manifestSpec).toBe('github:treeseed-ai/sdk#0.6.8-dev.staging.20260427T190628Z');
		expect(reference.installSpec).toBe('github:treeseed-ai/sdk#0.6.8-dev.staging.20260427T190628Z');
		expect(devTagFromDependencySpec(reference.manifestSpec)).toBe('0.6.8-dev.staging.20260427T190628Z');
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

	it('does not rewrite Docker-only packages as installable release dependencies', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-package-policy-'));
		const sdkDir = resolve(root, 'packages', 'sdk');
		const adminDir = resolve(root, 'packages', 'admin');
		const apiDir = resolve(root, 'packages', 'api');
		mkdirSync(sdkDir, { recursive: true });
		mkdirSync(adminDir, { recursive: true });
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
		writeFileSync(resolve(apiDir, 'treeseed.package.yaml'), 'id: "@treeseed/api"\nkind: node-typescript\npublishTarget: docker\n', 'utf8');
		writeFileSync(resolve(adminDir, 'package.json'), JSON.stringify({
			name: '@treeseed/admin',
			version: '0.11.0-dev.staging.1',
			dependencies: {
				'@treeseed/sdk': '0.11.0-dev.staging.1',
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
			['@treeseed/api', '0.5.0'],
		]);
		const installableVersions = installableInternalDependencyVersions(root, versions);
		const rewrites = rewriteProjectInternalDependenciesToStableVersions(root, versions);

		expect(installableVersions.has('@treeseed/sdk')).toBe(true);
		expect(installableVersions.has('@treeseed/api')).toBe(false);
		expect(rewrites.map((rewrite) => rewrite.packageName)).toEqual(['@treeseed/sdk']);
		const adminPackageJson = JSON.parse(readFileSync(resolve(adminDir, 'package.json'), 'utf8'));
		expect(adminPackageJson.dependencies['@treeseed/sdk']).toBe('0.11.0');
		expect(adminPackageJson.peerDependencies['@treeseed/api']).toBe('^0.4.1');
	});

	it('allows stable release tag Git refs while rejecting dev Git refs', () => {
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

		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).not.toThrow();

		const corePackageJson = JSON.parse(readFileSync(resolve(coreDir, 'package.json'), 'utf8'));
		corePackageJson.dependencies['@treeseed/sdk'] = 'github:treeseed-ai/sdk#0.10.2-dev.staging.20260520T010203Z';
		writeFileSync(resolve(coreDir, 'package.json'), JSON.stringify(corePackageJson, null, 2), 'utf8');

		expect(() => assertNoInternalDevReferences(root, new Set(['@treeseed/sdk']))).toThrow(/Stable release still contains internal Git\/dev dependency references/u);
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

	it('writes machine-readable metadata for dev tags', () => {
		const message = createDevTagMessage({
			packageName: '@treeseed/sdk',
			version: '0.6.8-dev.feature-demo.20260426T153000Z',
			branch: 'feature/demo',
			commitSha: 'abc123',
			workflowRunId: 'run-1',
			createdAt: '2026-04-26T15:30:00.000Z',
		});

		expect(message).toContain('treeseed-dev-tag: true');
		expect(message).toContain('package: @treeseed/sdk');
		expect(message).toContain('branch: feature/demo');
		expect(message).toContain('workflowRunId: run-1');
	});

	it('classifies old staging and preview Treeseed dev tags as cleanup candidates', () => {
		const stagingTag = '0.6.39-dev.staging.20260507T010203Z';
		const previewTag = '0.6.39-dev.feature-demo.20260507T010203Z';

		expect(classifyStaleTreeseedDevTag({
			tagName: stagingTag,
			message: createDevTagMessage({
				packageName: '@treeseed/sdk',
				version: stagingTag,
				branch: 'staging',
				commitSha: 'abc123',
			}),
			currentVersion: '0.6.40-dev.staging.20260508T010203Z',
		}).action).toBe('delete');
		expect(classifyStaleTreeseedDevTag({
			tagName: previewTag,
			message: createDevTagMessage({
				packageName: '@treeseed/sdk',
				version: previewTag,
				branch: 'feature/demo',
				commitSha: 'abc123',
			}),
			currentVersion: '0.6.40-dev.staging.20260508T010203Z',
		}).action).toBe('delete');
	});

	it('keeps current, stable, malformed, non-Treeseed, and referenced dev tags', () => {
		const currentTag = '0.6.40-dev.staging.20260508T010203Z';
		const currentMessage = createDevTagMessage({
			packageName: '@treeseed/sdk',
			version: currentTag,
			branch: 'staging',
			commitSha: 'abc123',
		});

		expect(classifyStaleTreeseedDevTag({
			tagName: currentTag,
			message: currentMessage,
			currentVersion: '0.6.40-dev.staging.20260508T020304Z',
		}).reason).toBe('current-version');
		expect(classifyStaleTreeseedDevTag({
			tagName: '0.6.39',
			message: '',
			currentVersion: '0.6.40',
		}).reason).toBe('not-dev-tag');
		expect(classifyStaleTreeseedDevTag({
			tagName: '0.6.39-dev.staging.bad',
			message: 'treeseed-dev-tag: true',
			currentVersion: '0.6.40',
		}).reason).toBe('malformed-dev-tag');
		expect(classifyStaleTreeseedDevTag({
			tagName: '0.6.39-dev.staging.20260508T010203Z',
			message: 'save: old tag',
			currentVersion: '0.6.40',
		}).reason).toBe('missing-treeseed-metadata');
		expect(classifyStaleTreeseedDevTag({
			tagName: '0.6.39-dev.staging.20260508T010203Z',
			message: createDevTagMessage({
				packageName: '@treeseed/sdk',
				version: '0.6.39-dev.staging.20260508T010203Z',
				branch: 'staging',
				commitSha: 'abc123',
			}),
			currentVersion: '0.6.40',
			activeReferences: ['0.6.39-dev.staging.20260508T010203Z'],
		}).reason).toBe('still-referenced');
	});
});
