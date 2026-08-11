import { describe, expect, it } from 'vitest';
import { classifyContentHistoryBranch,contentTreesUnchanged,isRecognizedContentMigrationMetadata,isRecognizedOrganizationMigrationMetadata,isVerifiedSoftwareContentRemoval,normalizeSeedGitOutput } from '../../../src/seeds/repositories/repository-history.ts';

describe('content repository history migration recovery', () => {
	it('creates only when the source exists and the target is empty', () => {
		expect(classifyContentHistoryBranch({ sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: null })).toMatchObject({ action: 'create' });
		expect(classifyContentHistoryBranch({ sourceCommit: null, contentPath: null, targetCommit: null })).toMatchObject({ action: 'blocked' });
	});

	it('replays as noop only when all live commits and the verified receipt match', () => {
		const receipt = { sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: 'target', verified: true };
		expect(classifyContentHistoryBranch({ sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: 'target', receipt })).toMatchObject({ action: 'noop' });
		expect(classifyContentHistoryBranch({ sourceCommit: 'moved', contentPath: 'docs/src/content', targetCommit: 'target', receipt })).toMatchObject({ action: 'update' });
		expect(classifyContentHistoryBranch({ sourceCommit: 'source', contentPath: 'docs/src/content', targetCommit: 'unexpected', receipt })).toMatchObject({ action: 'blocked' });
	});

	it('treats two absent content trees as unchanged', () => {
		expect(contentTreesUnchanged(null, null)).toBe(true);
		expect(contentTreesUnchanged('old', 'new')).toBe(false);
		expect(contentTreesUnchanged('old', 'new', true)).toBe(true);
	});

	it('preserves exact file bytes when a reconciler requests raw Git output', () => {
		const content = '                    GNU AFFERO GENERAL PUBLIC LICENSE\n';
		expect(normalizeSeedGitOutput(content)).toBe('GNU AFFERO GENERAL PUBLIC LICENSE');
		expect(normalizeSeedGitOutput(content, true)).toBe(content);
	});

	it('recognizes only the exact TreeSeed organization-migration identity', () => {
		expect(isRecognizedOrganizationMigrationMetadata(['Migrate organization references to treeseed-ai', 'TreeSeed migration', 'operations@treeseed.dev'])).toBe(true);
		expect(isRecognizedOrganizationMigrationMetadata(['Migrate organization references to treeseed-ai', 'Other author', 'operations@treeseed.dev'])).toBe(false);
		expect(isRecognizedOrganizationMigrationMetadata(['Unrelated change', 'TreeSeed migration', 'operations@treeseed.dev'])).toBe(false);
	});

	it('recognizes only canonical content migration commits for the selected project', () => {
		expect(isRecognizedContentMigrationMetadata(['Migrate market content history', 'TreeSeed migration', 'operations@treeseed.dev'], 'market')).toBe(true);
		expect(isRecognizedContentMigrationMetadata(['Reconcile market content history', 'TreeSeed migration', 'operations@treeseed.dev'], 'market')).toBe(true);
		expect(isRecognizedContentMigrationMetadata(['Reconcile api content history', 'TreeSeed migration', 'operations@treeseed.dev'], 'market')).toBe(false);
		expect(isRecognizedContentMigrationMetadata(['Reconcile market content history', 'Other author', 'operations@treeseed.dev'], 'market')).toBe(false);
	});

	it('accepts removed software content only with exact verified cutover evidence', () => {
		const cutover = {
			contract: 'treeseed.content-cutover/v1', verified: true, softwarePathRemoved: true,
			evidence: {
				project: 'admin', sourceRepository: 'treeseed-ai/admin', targetRepository: 'treeseed-ai/admin-content',
				contentPath: 'docs/src/content', sourceTree: 'tree', targetTree: 'tree', historyVerified: true,
				publicationVerified: true, treeDxVerified: true, status: 'ready',
			},
		};
		const input = { cutover, project: 'admin', sourceRepository: 'treeseed-ai/admin', targetRepository: 'treeseed-ai/admin-content', contentPath: 'docs/src/content', previousTree: 'tree', targetTree: 'tree' };
		expect(isVerifiedSoftwareContentRemoval(input)).toBe(true);
		expect(isVerifiedSoftwareContentRemoval({ ...input, previousTree: null })).toBe(true);
		expect(isVerifiedSoftwareContentRemoval({ ...input, targetTree: 'drift' })).toBe(false);
		expect(isVerifiedSoftwareContentRemoval({ ...input, cutover: { ...cutover, softwarePathRemoved: false } })).toBe(false);
		expect(isVerifiedSoftwareContentRemoval({ ...input, targetRepository: 'treeseed-ai/other-content' })).toBe(false);
	});
});
