import { describe, expect, it } from 'vitest';
import {
	createTreeseedContentToolPresets,
	renderTreeseedContentRecord,
	validateTreeseedContentRecord,
} from '../../src/content-operations.ts';

describe('content operations', () => {
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
});
