import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	assertNoInternalDevReferences,
	createDevTagMessage,
	createPackageDependencyReference,
	devTagFromDependencySpec,
	normalizeGitRemoteForDependency,
	normalizeGitRemoteForManifest,
	rewriteInternalDependenciesToStableVersions,
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
});
