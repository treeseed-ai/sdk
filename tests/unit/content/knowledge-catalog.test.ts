import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	buildKnowledgeHierarchy, loadKnowledgeCatalog, parseKnowledgePage, renderKnowledgeMarkdown,
	resolveKnowledgePage, searchKnowledgePages, validateKnowledgeHierarchy, validateKnowledgeMarkdown,
	compileEditorialContext, validateEditorialReview,
} from '../../../src/knowledge/index.ts';

const temporaryRoots: string[] = [];
const page = (body = 'Use **safe** guidance.') => `---
schemaVersion: treeseed.knowledge-page/v1
id: knowledge.safe
bookId: knowledge-book
slug: safe
title: Safe knowledge
summary: Safe contextual guidance.
status: published
visibility: authenticated
order: 10
relatedKnowledgeIds: []
capabilityIds: [admin.safe]
routePatterns: ["/app/safe"]
resourceTypes: [safe-resource]
actionIds: [safe.read]
keywords: [safe, guidance]
guaranteeIds: [guarantee.user.auth.user-login.004]
---

${body}
`;

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('knowledge catalog', () => {
	it('renders a deliberately small safe Markdown subset', () => {
		const html = renderKnowledgeMarkdown(`# Heading

<script>alert('x')</script>

[Safe](https://example.com) [Unsafe](javascript:alert(1))

![tracking](https://example.com/pixel.png)
`);
		expect(html).toContain('<h2>Heading</h2>');
		expect(html).toContain('rel="noreferrer noopener"');
		expect(html).toContain('Unsafe');
		expect(html).not.toMatch(/script|javascript:|img|onerror/iu);
	});

	it('parses the versioned contract and derives a content revision', () => {
		const parsed = parseKnowledgePage({ path: 'safe.md', raw: page() });
		expect(parsed).toMatchObject({
			schemaVersion: 'treeseed.knowledge-page/v1', id: 'knowledge.safe',
			bookId: 'knowledge-book', visibility: 'authenticated',
			context: { capabilityIds: ['admin.safe'] },
			guaranteeIds: ['guarantee.user.auth.user-login.004'],
			audiences: { primary: [], secondary: [], excluded: [] },
		});
		expect(parsed.revision).toMatch(/^[a-f0-9]{64}$/u);
		expect(parsed.bodyHtml).toContain('<strong>safe</strong>');
	});

	it('compiles layered editorial context with stable precedence and provenance', () => {
		const pack = compileEditorialContext([
			{ kind: 'book-core', id: 'note:book:core', revision: 'book-1', content: 'Book voice.' },
			{ kind: 'core-objective', id: 'objective:core', revision: 'objective-1', content: 'Project purpose.' },
			{ kind: 'project-core', id: 'note:project:core', revision: 'project-1', content: 'Project voice.' },
		], { requiredKinds: ['core-objective', 'project-core', 'book-core'],
			requireUniqueKinds: ['core-objective', 'project-core', 'book-core'] });
		expect(pack.schemaVersion).toBe('treeseed.editorial-context/v1');
		expect(pack.layers.map((layer) => layer.kind)).toEqual(['core-objective', 'project-core', 'book-core']);
		expect(pack.digest).toMatch(/^[a-f0-9]{64}$/u);
		expect(pack.compiledEditorialInstructions).toContain('Project purpose.');
	});

	it('rejects self-review and approval with failed editorial criteria', () => {
		expect(() => validateEditorialReview({ kind: 'technical', disposition: 'approved', reviewerId: 'writer',
			authorId: 'writer', contentRevision: 'rev', contextDigest: 'a'.repeat(64),
			criteria: [{ id: 'truth', status: 'pass' }] })).toThrow(/cannot review their own/u);
		expect(() => validateEditorialReview({ kind: 'audience', disposition: 'approved', reviewerId: 'reviewer',
			authorId: 'writer', contentRevision: 'rev', contextDigest: 'a'.repeat(64),
			criteria: [{ id: 'operator', status: 'fail' }] })).toThrow(/failed criteria/u);
		expect(() => validateEditorialReview({ kind: 'publisher' as never, disposition: 'approved', reviewerId: 'reviewer',
			authorId: 'writer', contentRevision: 'rev', contextDigest: 'a'.repeat(64),
			criteria: [{ id: 'truth', status: 'pass' }] })).toThrow(/kind is invalid/u);
		expect(() => validateEditorialReview({ kind: 'technical', disposition: 'approved', reviewerId: 'reviewer',
			authorId: 'writer', contentRevision: 'rev', contextDigest: 'a'.repeat(64),
			criteria: [{ id: 'truth', status: 'pass' }, { id: 'truth', status: 'pass' }] })).toThrow(/Duplicate/u);
	});

	it('builds a deterministic hierarchy and detects parent cycles', () => {
		const hierarchy = buildKnowledgeHierarchy([
			{ id: 'child-b', parentId: 'root', order: 20, title: 'B' },
			{ id: 'root', order: 0, title: 'Root' },
			{ id: 'child-a', parentId: 'root', order: 10, title: 'A' },
		]);
		expect(hierarchy[0].children.map((entry) => entry.page.id)).toEqual(['child-a', 'child-b']);
		expect(validateKnowledgeHierarchy([
			{ ...parseKnowledgePage({ path: 'a.md', raw: page() }), id: 'a', parentId: 'b' },
			{ ...parseKnowledgePage({ path: 'b.md', raw: page() }), id: 'b', parentId: 'a' },
		])).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'knowledge.parent_cycle' })]));
	});

	it('rejects missing relationships while resolving context and search', () => {
		const root = mkdtempSync(join(tmpdir(), 'contextual-knowledge-'));
		temporaryRoots.push(root);
		writeFileSync(join(root, 'safe.md'), page());
		writeFileSync(join(root, 'related.md'), page('Credential rotation and recovery.')
			.replace('id: knowledge.safe', 'id: knowledge.related')
			.replace('slug: safe', 'slug: related')
			.replace('title: Safe knowledge', 'title: Related knowledge')
			.replace('capabilityIds: [admin.safe]', 'capabilityIds: [admin.related]')
			.replace('relatedKnowledgeIds: []', 'relatedKnowledgeIds: [knowledge.safe]'));
		const pages = loadKnowledgeCatalog(root, '@treeseed/test');
		expect(resolveKnowledgePage(pages, { capabilityId: 'admin.safe' })?.id).toBe('knowledge.safe');
		expect(searchKnowledgePages(pages, 'credential recovery').map((item) => item.id)).toEqual(['knowledge.related']);
		writeFileSync(join(root, 'missing.md'), page().replace('id: knowledge.safe', 'id: knowledge.missing')
			.replace('slug: safe', 'slug: missing').replace('relatedKnowledgeIds: []', 'relatedKnowledgeIds: [knowledge.unknown]'));
		expect(() => loadKnowledgeCatalog(root)).toThrow(/references missing pages/u);
	});

	it('rejects malformed identifiers', () => {
		expect(() => parseKnowledgePage({ path: 'bad.md', raw: page().replace('id: knowledge.safe', 'id: Bad Page') }))
			.toThrow(/invalid id/u);
	});

	it('reports Zod field diagnostics before semantic knowledge parsing', () => {
		expect(() => parseKnowledgePage({ path: 'missing-book.md', raw: page().replace('bookId: knowledge-book\n', '') }))
			.toThrow(expect.objectContaining({ code: 'content_model_invalid', details: [expect.objectContaining({
				path: 'missing-book.md', model: 'knowledge', field: 'book_id', code: 'content_zod_invalid_type',
			})] }));
	});

	it('rejects executable MDX expressions and unsafe authoritative links', () => {
		expect(() => validateKnowledgeMarkdown('Hello {globalThis.process.env.SECRET}')).toThrow(/expressions/u);
		expect(validateKnowledgeMarkdown('Use `{literal}` in an example.')).toBe('Use `{literal}` in an example.');
		expect(validateKnowledgeMarkdown('```ts\nexport type SafeExample = { value: string };\n```'))
			.toContain('export type SafeExample');
		expect(validateKnowledgeMarkdown('[Related guidance](../related/page.md)'))
			.toBe('[Related guidance](../related/page.md)');
		expect(() => validateKnowledgeMarkdown('export const secret = globalThis.process.env.SECRET;'))
			.toThrow(/imports and exports/u);
		expect(() => validateKnowledgeMarkdown('<Aside title={globalThis.process.env.SECRET}>Unsafe</Aside>'))
			.toThrow(/properties/u);
		expect(() => parseKnowledgePage({ path: 'bad-url.md', raw: page().replace('keywords: [safe, guidance]', 'keywords: [safe]\ndocumentationUrls: [javascript:alert(1)]') }))
			.toThrow(/unsafe documentation URL/u);
	});

	it('renders only approved MDX components as inert semantic HTML', () => {
		const parsed = parseKnowledgePage({ path: 'guide.md', raw: page('<Aside type="note">\n\nUse **reviewed** guidance.\n\n</Aside>') });
		expect(parsed.bodyHtml).toContain('<aside class="ts-knowledge-aside" data-type="note">');
		expect(parsed.bodyHtml).toContain('<strong>reviewed</strong>');
		expect(() => parseKnowledgePage({ path: 'unsafe.md', raw: page('<iframe>unsafe</iframe>') }))
			.toThrow(/not allowed/u);
	});
});
