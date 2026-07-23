import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runTreeseedGit } from '../../../src/operations/services/git-runner.ts';
import { planTreeseedReconciliation, reconcileTreeseedTarget } from '../../../src/reconcile/index.ts';
import type { TreeseedDesiredUnit } from '../../../src/reconcile/contracts.ts';

function createTenantRoot() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-content-tenant-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
hosting:
  kind: self_hosted_project
  teamId: acme
  projectId: docs
runtime:
  mode: treeseed_managed
`);
	return tenantRoot;
}

function createSourceRepo() {
	const repoRoot = mkdtempSync(join(tmpdir(), 'treeseed-local-content-source-'));
	runTreeseedGit(['init', '--initial-branch=main'], { cwd: repoRoot, mode: 'mutate' });
	runTreeseedGit(['config', 'user.email', 'test@example.com'], { cwd: repoRoot, mode: 'mutate' });
	runTreeseedGit(['config', 'user.name', 'Treeseed Test'], { cwd: repoRoot, mode: 'mutate' });
	writeFileSync(resolve(repoRoot, 'README.md'), '# Content\n');
	runTreeseedGit(['add', 'README.md'], { cwd: repoRoot, mode: 'mutate' });
	runTreeseedGit(['commit', '-m', 'seed content'], { cwd: repoRoot, mode: 'mutate' });
	return repoRoot;
}

function localContentUnit(tenantRoot: string, sourceRepo: string, targetPath: string): TreeseedDesiredUnit {
	return {
		unitId: 'local-content-materialization:acme:docs:content',
		unitType: 'local-content-materialization',
		provider: 'local',
		identity: {
			teamId: 'acme',
			projectId: 'docs',
			slug: 'docs',
			environment: 'local',
			deploymentKey: 'acme:local',
			environmentKey: 'local',
		},
		target: { kind: 'persistent', scope: 'local' },
		logicalName: 'Docs local content materialization',
		dependencies: [],
		spec: {
			teamSlug: 'acme',
			projectSlug: 'docs',
			topology: 'split_site_content',
			rootPath: '.',
			sitePath: 'docs',
			contentPath: 'docs',
			contentRuntimeSource: 'treedx_snapshot',
			contentSourceMode: 'treedx',
			localContentMaterialization: 'managed_clone',
			configuredLocalContentMaterialization: 'none',
			requestedLocalContentMode: 'preview',
			executeRequested: true,
			contentRepository: {
				provider: 'github',
				owner: 'acme',
				name: 'docs-content',
				gitUrl: sourceRepo,
				defaultBranch: 'main',
				submodulePath: null,
			},
			sourceRepoSlug: 'acme/docs-content',
			effectiveLocalPath: targetPath,
			siteLocalPath: resolve(targetPath, 'docs'),
			docsSiteReadiness: 'site_not_prepared',
			materializationStatus: 'managed_clone_missing',
			managedCloneRoot: resolve(tenantRoot, '.treeseed', 'local-content'),
		},
		secrets: {},
		metadata: {
			resourceKind: 'local-content-materialization',
		},
	};
}

describe('local content materialization reconcile adapter', () => {
	it('plans and applies managed clones without serializing GitHub tokens', async () => {
		const tenantRoot = createTenantRoot();
		const sourceRepo = createSourceRepo();
		const targetPath = resolve(tenantRoot, '.treeseed/local-content/acme/docs/content');
		const unit = localContentUnit(tenantRoot, sourceRepo, targetPath);
		const env = {
			...process.env,
			TREESEED_GITHUB_TOKEN: 'secret-token',
		};

		const plan = await planTreeseedReconciliation({
			tenantRoot,
			target: { kind: 'persistent', scope: 'local' },
			env,
			units: [unit],
		});

		expect(plan.plans[0]?.diff.action).toBe('create');
		expect(JSON.stringify(plan)).not.toContain('secret-token');

		const result = await reconcileTreeseedTarget({
			tenantRoot,
			target: { kind: 'persistent', scope: 'local' },
			env,
			units: [unit],
		});

		expect(result.results.every((entry) => entry.verification?.verified === true)).toBe(true);
		expect(existsSync(resolve(targetPath, 'README.md'))).toBe(true);
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('secret-token');
		expect(serialized).not.toContain('"GH_TOKEN"');
		expect(serialized).not.toContain('"GITHUB_TOKEN"');
	}, 30_000);
});
