import { describe, expect, it } from 'vitest';
import { validatePortableContentData } from '../../../src/content/validation/portable-content-data.ts';

describe('canonical blocking question content', () => {
	it('accepts exact proposal and work-item relationships with explicit lifecycle', () => {
		const result = validatePortableContentData('question', {
			schemaVersion: 'treeseed.question/v1', id: 'artifact-authority', projectId: 'sdk',
			subjectRef: { store: 'treedx', model: 'proposal', id: 'proposal-1', revision: 1, digest: `sha256:${'a'.repeat(64)}`, path: 'proposals/proposal-1.mdx', anchor: 'implementation' },
			question: 'Which source reference is authoritative?', status: 'open', addressedTo: ['architect'],
			askedAt: '2026-09-13T12:00:00.000Z',
		});
		expect(result).toMatchObject({ ok: true, data: {
			status: 'open', subjectRef: { model: 'proposal', id: 'proposal-1', anchor: 'implementation' },
		} });
	});

	it('rejects an implicit lifecycle and inexact subject', () => {
		const result = validatePortableContentData('question', { title: 'Ambiguous question' });
		expect(result.ok).toBe(false);
		expect(result.diagnostics.map((diagnostic) => diagnostic.field)).toEqual(expect.arrayContaining(['status', 'subjectRef']));
	});
});
