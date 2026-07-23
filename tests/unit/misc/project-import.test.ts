import { describe, expect, it } from 'vitest';
import {
	planTreeseedRepositoryImport,
} from '../../../src/index.ts';
import { githubRepositoryCredentialEnvName } from '../../../src/operations/services/github-credentials.ts';

describe('project repository import planning', () => {
	it('plans single_repository_site imports from a GitHub repository with docs', () => {
		const plan = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/sdk',
			env: {
				TREESEED_GITHUB_TOKEN_TREESEED_AI_SDK: 'ghp_not-rendered',
			},
			observation: {
				defaultBranch: 'main',
				visibility: 'public',
				files: [
					'package.json',
					'treeseed.package.yaml',
					'docs/index.md',
					'docs/src/content/intro.md',
				],
				directories: ['docs', 'docs/src', 'docs/src/content'],
			},
		});

		expect(plan.ok).toBe(true);
		expect(plan.repository.slug).toBe('treeseed-ai/sdk');
		expect(plan.architecture).toMatchObject({
			topology: 'single_repository_site',
			rootPath: '.',
			sitePath: 'docs',
			contentPath: 'docs/src/content',
			contentRuntimeSource: 'r2_published_manifest',
			localContentMaterialization: 'existing_path',
		});
		expect(plan.credentialRef).toBe('env:TREESEED_GITHUB_TOKEN_TREESEED_AI_SDK');
		expect(JSON.stringify(plan)).not.toContain('ghp_not-rendered');
	});

	it('detects common site and content path candidates', () => {
		const docsPlan = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/docs-project',
			observation: { files: ['docs/index.md'], directories: ['docs'] },
		});
		const sitePlan = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/site-project',
			observation: { files: ['site/package.json', 'content/page.md'], directories: ['site', 'content'] },
		});
		const appPlan = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/app-project',
			observation: { files: ['apps/web/package.json', 'src/content/page.md'], directories: ['apps', 'apps/web', 'src/content'] },
		});
		const rootPlan = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'knowledge-coop/market',
			observation: { files: ['treeseed.site.yaml', 'src/content/index.md'], directories: ['src', 'src/content'] },
		});

		expect(docsPlan.architecture.sitePath).toBe('docs');
		expect(docsPlan.architecture.contentPath).toBe('docs');
		expect(sitePlan.architecture.sitePath).toBe('site');
		expect(sitePlan.architecture.contentPath).toBe('content');
		expect(appPlan.architecture.sitePath).toBe('apps/web');
		expect(appPlan.architecture.contentPath).toBe('src/content');
		expect(rootPlan.architecture.sitePath).toBe('.');
		expect(rootPlan.architecture.contentPath).toBe('src/content');
	});

	it('uses repo-scoped credential refs when available and falls back safely', () => {
		const scopedName = githubRepositoryCredentialEnvName('treeseed-ai/ui');
		const scoped = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/ui',
			env: { [scopedName]: 'scoped-value', TREESEED_GITHUB_TOKEN: 'fallback-value' },
		});
		const fallback = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/core',
			env: { TREESEED_GITHUB_TOKEN: 'fallback-value' },
		});
		const missing = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/agent',
			env: {},
		});

		expect(scoped.credentialRef).toBe(`env:${scopedName}`);
		expect(fallback.credentialRef).toBe('env:TREESEED_GITHUB_TOKEN');
		expect(missing.credentialRef).toBe('env:TREESEED_GITHUB_TOKEN');
		expect(missing.diagnostics.some((entry) => entry.code === 'github_credential_missing')).toBe(true);
		expect(JSON.stringify({ scoped, fallback, missing })).not.toContain('fallback-value');
		expect(JSON.stringify({ scoped, fallback, missing })).not.toContain('scoped-value');
	});

	it('emits diagnostics for ambiguous or missing paths without forcing restructuring', () => {
		const ambiguous = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/platform',
			observation: {
				files: ['docs/index.md', 'site/package.json'],
				directories: ['docs', 'site'],
			},
		});
		const missing = planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/blank',
			observation: { files: ['README.md'], directories: [] },
		});

		expect(ambiguous.diagnostics.some((entry) => entry.code === 'ambiguous_site_path')).toBe(true);
		expect(missing.architecture.sitePath).toBe('.');
		expect(missing.diagnostics.some((entry) => entry.code === 'site_path_assumed_root')).toBe(true);
	});

	it('rejects token and plaintext fields in import inputs', () => {
		expect(() => planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/sdk',
			observation: {
				files: ['docs/index.md'],
				token: 'ghp_should-not-appear',
			} as any,
		})).toThrow(/secret material/u);
		expect(() => planTreeseedRepositoryImport({
			team: 'treeseed',
			repository: 'treeseed-ai/sdk',
			credentialRef: 'env:GH_TOKEN',
		})).toThrow(/TREESEED_GITHUB_TOKEN/u);
	});
});
