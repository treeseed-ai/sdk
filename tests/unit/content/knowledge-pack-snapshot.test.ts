import { describe, expect, it } from 'vitest';
import { buildKnowledgeSnapshotPack } from '../../../src/knowledge-packs/snapshot.ts';
import type { BookDefinition, KnowledgePageDefinition } from '../../../src/knowledge/contracts.ts';

const book: BookDefinition = {
	schemaVersion: 'treeseed.book/v2', id: 'book.one', slug: 'book-one', title: 'Book one', summary: 'Summary',
	description: 'Description', status: 'published', visibility: 'team', order: 1, topics: [], audience: [],
	relatedBookIds: [], packPolicy: 'allowed',
};
const page: KnowledgePageDefinition = {
	schemaVersion: 'treeseed.knowledge-page/v1', id: 'page.one', bookId: book.id, slug: 'start', title: 'Start',
	summary: 'Start here', status: 'published', visibility: 'team', order: 1, tags: [], contributors: [],
	relatedBookIds: [], relatedKnowledgeIds: ['page.external'], relatedNoteIds: [], relatedQuestionIds: [],
	relatedObjectiveIds: [], relatedProposalIds: [], relatedDecisionIds: [], guaranteeIds: [], context: { capabilityIds: [], routePatterns: [],
		resourceTypes: [], actionIds: [], keywords: [], documentationUrls: [] }, bodyMarkdown: '# Start', bodyHtml: '' as any,
	revision: 'revision-one',
};

describe('TreeDX snapshot knowledge packs', () => {
	it('builds deterministic selected-book closure without filesystem paths or implicit related books', () => {
		const input = { teamId: 'team-1', createdAt: '2026-07-31T00:00:00.000Z', bookIds: [book.id],
			publicationRevision: 'publication-one', publicationSourceClosure: 'publication-closure-one', projects: [{
			teamId: 'team-1', projectId: 'project-1', repositoryId: 'repository-1', commitSha: 'abc123', books: [book],
			pages: [{ definition: page, source: '---\ntitle: Start\n---\n\n# Start\n' }],
		}] };
		const first = buildKnowledgeSnapshotPack(input);
		const second = buildKnowledgeSnapshotPack(input);
		expect(first.bytes).toEqual(second.bytes);
		expect(first.manifest.members[0]).toMatchObject({ commitSha: 'abc123', bookId: 'book.one', pageIds: ['page.one'] });
		expect(first.graph).toEqual([{ sourceId: 'page.one', targetId: 'page.external', type: 'related-knowledge', included: false }]);
		expect(JSON.stringify(first.manifest)).not.toMatch(/\/tmp\/|src\/content/u);
	});

	it('rejects unknown and pack-disabled selections', () => {
		const base = { teamId: 'team-1', createdAt: '2026-07-31T00:00:00.000Z', publicationRevision: 'publication-one',
			publicationSourceClosure: 'publication-closure-one', projects: [{ teamId: 'team-1', projectId: 'project-1',
			repositoryId: 'repository-1', commitSha: 'abc123', books: [book], pages: [] }] };
		expect(() => buildKnowledgeSnapshotPack({ ...base, bookIds: ['missing'] })).toThrow(/Unknown selected books/u);
		expect(() => buildKnowledgeSnapshotPack({ ...base, bookIds: [book.id], projects: [{ ...base.projects[0]!, books: [{ ...book, packPolicy: 'disabled' }] }] }))
			.toThrow(/does not permit/u);
		expect(() => buildKnowledgeSnapshotPack({ ...base, bookIds: [book.id], projects: [{ ...base.projects[0]!, books: [{ ...book, status: 'draft' }] }] }))
			.toThrow(/not published/u);
		expect(() => buildKnowledgeSnapshotPack({ ...base, bookIds: [book.id], projects: [{ ...base.projects[0]!, teamId: 'another-team' }] }))
			.toThrow(/outside the pack team/u);
		expect(() => buildKnowledgeSnapshotPack({ ...base, bookIds: [book.id], projects: [base.projects[0]!, base.projects[0]!] }))
			.toThrow(/Duplicate book ids/u);
	});
});
