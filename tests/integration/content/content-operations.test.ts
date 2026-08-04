import { describe, expect, it } from 'vitest';
import {
	createContentToolPresets,
	genericContentInputSchema,
	renderContentRecord,
	validateContentRecord,
} from '../../../src/operations/content-operations.ts';

describe('content operations', () => {
	it('exposes exact hierarchical paths for model-aware reads', () => {
		const schema = genericContentInputSchema('read') as { properties: Record<string, unknown> };
		expect(schema.properties.path).toMatchObject({ type: 'string' });
	});
	it('advertises the TreeDX search query boundary to execution providers', () => {
		const schema = genericContentInputSchema('query') as { properties: { query: Record<string, unknown> } };
		expect(schema.properties.query).toMatchObject({ type: 'string', maxLength: 200 });
	});
	it('requires a structured non-empty relation for content link tools', () => {
		const schema = genericContentInputSchema('link') as {
			required: string[];
			properties: { relations: { minItems: number; items: { required: string[]; additionalProperties: boolean } } };
		};
		expect(schema.required).toEqual(['model', 'relations']);
		expect(schema.properties.relations).toMatchObject({
			minItems: 1,
			items: { required: ['field', 'targetSlug'], additionalProperties: false },
		});
	});

	it('generates model-specific presets from content-backed models', () => {
		const ids = createContentToolPresets().map((preset) => preset.id);
		expect(ids).toContain('treeseed.questions.create');
		expect(ids).toContain('treeseed.proposals.create');
		expect(ids).toContain('treeseed.notes.create');
		expect(ids).toContain('treeseed.books.add_knowledge');
		expect(ids).toContain('treeseed.content.link_note');
	});

	it('renders canonical content with SDK field aliases', () => {
		const record = renderContentRecord({
			model: 'question',
			title: 'How should agent content tools work?',
			fields: {
				questionType: 'implementation',
				relatedObjectives: ['agent-tooling'],
			},
			body: 'Use model-aware commands.',
		});

		expect(record.path).toBe('src/content/questions/how-should-agent-content-tools-work.mdx');
		expect(record.frontmatter).toMatchObject({
			title: 'How should agent content tools work?',
			question_type: 'implementation',
			related_objectives: ['agent-tooling'],
		});
		expect(record.content).toContain('Use model-aware commands.');
		expect(record.ref).toMatchObject({ subjectId: 'agent-tooling', subjectField: 'related_objectives' });
	});

	it('validates required title or name fields', () => {
		const record = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			body: 'A note body.',
		});

		expect(validateContentRecord('note', record.content)).toMatchObject({ ok: true });
		expect(validateContentRecord('note', '---\nstatus: planned\n---\nBody')).toMatchObject({ ok: false });
	});

	it('renders package content beneath its configured repository-relative root', () => {
		const record = renderContentRecord({
			model: 'note',
			title: 'Package planning note',
			contentRoot: 'docs/src/content',
		});
		expect(record.path).toBe('docs/src/content/notes/package-planning-note.mdx');
	});

	it('preserves an exact repository-relative knowledge placement and extension', () => {
		const record = renderContentRecord({
			model: 'knowledge',
			title: 'Agent Lab Guide Writing',
			contentRoot: 'src/content',
			placement: { path: 'src/content/knowledge/treeseed-guide/foundation/agent-lab-guide-writing.mdx' },
		});
		expect(record.path).toBe('src/content/knowledge/treeseed-guide/foundation/agent-lab-guide-writing.mdx');
	});

	it('preserves existing linked frontmatter and body during partial updates', () => {
		const existing = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			fields: { relatedObjectives: ['core'], author: 'tester' },
			body: 'Existing body.',
		});
		const updated = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			existingContent: existing.content,
			fields: { status: 'reviewed' },
		});

		expect(updated.frontmatter).toMatchObject({
			related_objectives: ['core'],
			author: 'tester',
			status: 'reviewed',
		});
		expect(updated.body).toBe('Existing body.');
		expect(updated.ref).toMatchObject({ subjectId: 'core', subjectField: 'related_objectives' });
	});

	it('adds a relation without replacing existing linked content', () => {
		const existing = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			fields: { author: 'tester' },
			body: 'Existing body.',
		});
		const linked = renderContentRecord({
			model: 'note',
			title: 'Linked observation',
			existingContent: existing.content,
			relations: [{ field: 'related_objectives', targetModel: 'objective', targetSlug: 'core' }],
		});

		expect(linked.frontmatter).toMatchObject({ author: 'tester', related_objectives: ['core'] });
		expect(linked.body).toBe('Existing body.');
		expect(linked.ref).toMatchObject({ subjectId: 'core', subjectField: 'related_objectives' });
	});

	it('reports the explicitly requested relation when existing content has another subject edge', () => {
		const existing = renderContentRecord({
			model: 'note',
			title: 'Editorial review',
			fields: { about: ['guide.overview'] },
			body: 'Existing review.',
		});
		const linked = renderContentRecord({
			model: 'note',
			title: 'Editorial review',
			existingContent: existing.content,
			relations: [{ field: 'relatedObjectives', targetModel: 'objective', targetSlug: 'objective:core' }],
		});

		expect(linked.frontmatter).toMatchObject({ about: ['guide.overview'], relatedObjectives: ['objective:core'] });
		expect(linked.ref).toMatchObject({ subjectId: 'objective:core', subjectField: 'relatedObjectives' });
	});
});
