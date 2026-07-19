import { describe, expect, it } from 'vitest';
import { buildBuiltinModelRegistry } from '../../src/model-registry.ts';
import { canonicalizeFrontmatter } from '../../src/sdk-fields.ts';
import { validateResearchCitation, validateResearchCitations } from '../../src/agent-capacity/validation/research-citation.ts';

const citation = {
	sourceUrl: 'https://example.test/source',
	title: 'Primary source',
	retrievedAt: '2026-07-18T12:00:00.000Z',
	contentHash: 'sha256:source',
	claimIds: ['claim-1'],
	confidence: 'high' as const,
};

describe('ResearchCitation', () => {
	it('accepts complete claim-linked source evidence', () => {
		expect(validateResearchCitation(citation).ok).toBe(true);
	});

	it('rejects evidence without durable claim and retrieval provenance', () => {
		const result = validateResearchCitation({
			sourceUrl: 'not-a-url',
			title: '',
			retrievedAt: '',
			contentHash: '',
			claimIds: [],
			confidence: 'low',
		});
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'research_citation_url_invalid',
			'research_citation_title_required',
			'research_citation_retrieved_at_invalid',
			'research_citation_content_hash_required',
			'research_citation_claim_ids_invalid',
		]));
	});

	it('rejects malformed non-object citation values without throwing', () => {
		expect(validateResearchCitation('not-a-citation').ok).toBe(false);
		expect(validateResearchCitations({ citation }).diagnostics).toEqual([
			expect.objectContaining({ code: 'research_citations_array_required', path: 'citations' }),
		]);
	});

	it('enforces one canonical citation field on every research-capable content model', () => {
		const models = buildBuiltinModelRegistry();
		for (const modelName of ['note', 'proposal', 'decision', 'book', 'knowledge'] as const) {
			const definition = models[modelName];
			expect(definition.fields.citations).toBeDefined();
			expect(canonicalizeFrontmatter(definition, {}, { citations: [citation] })).toMatchObject({ citations: [citation] });
			expect(() => canonicalizeFrontmatter(definition, {}, { citations: [{ ...citation, claimIds: [] }] })).toThrow(/research_citation_claim_ids_invalid/u);
		}
		expect(models.question.fields.citations).toBeUndefined();
		expect(models.page.fields.citations).toBeUndefined();
	});
});
