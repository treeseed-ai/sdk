import { describe,expect,it } from 'vitest';
import type { PackageAdapter } from '../../../src/operations/services/package-adapters/package-kind.ts';
import { classifyRepositoryChanges,contentPathForRepository } from '../../../src/operations/services/repository-save-orchestrator/support/change-classification.ts';

describe('repository change classification', () => {
	it('separates publishable content from code and mixed changes', () => {
		expect(classifyRepositoryChanges([], 'docs/src/content')).toBe('clean');
		expect(classifyRepositoryChanges([
			'docs/src/content/notes/finding.mdx',
			'docs/src/content/questions/open-question.mdx',
		], 'docs/src/content')).toBe('content');
		expect(classifyRepositoryChanges(['src/index.ts'], 'docs/src/content')).toBe('code');
		expect(classifyRepositoryChanges([
			'docs/src/content/notes/finding.mdx',
			'src/index.ts',
		], 'docs/src/content')).toBe('mixed');
	});

	it('uses only a declared publishable package content root', () => {
		const adapter = {
			metadata: {
				projectArchitecture: {
					contentPath: 'docs/src/content',
					contentRuntimeSource: 'r2_published_manifest',
					contentPublishTarget: { kind: 'cloudflare_r2' },
				},
			},
		} as unknown as PackageAdapter;
		expect(contentPathForRepository({ adapter, relativePath: 'packages/sdk', repoDir: '/unused' }))
			.toBe('docs/src/content');
		expect(contentPathForRepository({
			adapter: { ...adapter, metadata: { projectArchitecture: {
				contentPath: 'docs/src/content', contentRuntimeSource: 'none',
			} } } as PackageAdapter,
			relativePath: 'packages/reviewer',
			repoDir: '/unused',
		})).toBeNull();
	});
});
