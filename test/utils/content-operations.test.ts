import { describe, expect, it } from 'vitest';
import {
	createTreeseedContentToolPresets,
	genericTreeseedContentInputSchema,
	renderTreeseedContentRecord,
	validateTreeseedContentRecord,
} from '../../src/content-operations.ts';

describe('content operations', () => {
	it('requires a structured non-empty relation for content link tools', () => {
		const schema = genericTreeseedContentInputSchema('link') as {
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
		const ids = createTreeseedContentToolPresets().map((preset) => preset.id);
		expect(ids).toContain('treeseed.questions.create');
		expect(ids).toContain('treeseed.proposals.create');
		expect(ids).toContain('treeseed.notes.create');
		expect(ids).toContain('treeseed.books.add_knowledge');
		expect(ids).toContain('treeseed.content.link_note');
	});

	it('renders canonical content with SDK field aliases', () => {
		const record = renderTreeseedContentRecord({
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
		const record = renderTreeseedContentRecord({
			model: 'note',
			title: 'Linked observation',
			body: 'A note body.',
		});

		expect(validateTreeseedContentRecord('note', record.content)).toMatchObject({ ok: true });
		expect(validateTreeseedContentRecord('note', '---\nstatus: planned\n---\nBody')).toMatchObject({ ok: false });
	});

	it('renders package content beneath its configured repository-relative root', () => {
		const record = renderTreeseedContentRecord({
			model: 'note',
			title: 'Package planning note',
			contentRoot: 'docs/src/content',
		});
		expect(record.path).toBe('docs/src/content/notes/package-planning-note.mdx');
	});

	it('preserves existing linked frontmatter and body during partial updates', () => {
		const existing = renderTreeseedContentRecord({
			model: 'note',
			title: 'Linked observation',
			fields: { relatedObjectives: ['core'], author: 'tester' },
			body: 'Existing body.',
		});
		const updated = renderTreeseedContentRecord({
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
		const existing = renderTreeseedContentRecord({
			model: 'note',
			title: 'Linked observation',
			fields: { author: 'tester' },
			body: 'Existing body.',
		});
		const linked = renderTreeseedContentRecord({
			model: 'note',
			title: 'Linked observation',
			existingContent: existing.content,
			relations: [{ field: 'related_objectives', targetModel: 'objective', targetSlug: 'core' }],
		});

		expect(linked.frontmatter).toMatchObject({ author: 'tester', related_objectives: ['core'] });
		expect(linked.body).toBe('Existing body.');
		expect(linked.ref).toMatchObject({ subjectId: 'core', subjectField: 'related_objectives' });
	});
});
