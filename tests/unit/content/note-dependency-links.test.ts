import { describe, expect, it } from 'vitest';
import { validatePortableContentData } from '../../../src/content/validation/portable-content-data.ts';

const ref = (id: string, anchor: string) => ({
	store: 'treedx', model: 'proposal', id, revision: 1,
	digest: `sha256:${'a'.repeat(64)}`, repository: `${id}-library`, commit: 'b'.repeat(40),
	path: `proposals/${id}.md`, anchor,
});
const from = ref('sdk', 'work-item/simulate-release');
const to = ref('api', 'work-item/tests-first');
const note = { schemaVersion: 'treeseed.note/v1', id: 'cross-project-dependency', projectId: 'api',
	classification: 'general', subjectRefs: [from, to], body: 'The API tests depend on the SDK candidate.',
	createdAt: '2026-09-20T00:00:00Z', links: [{ relation: 'depends_on', from, to }] };

describe('exact dependency links on an ordinary TreeDX note', () => {
	it('accepts a directional exact work-item link', () => {
		expect(validatePortableContentData('note', note).ok).toBe(true);
	});
	it('rejects moved refs, ambiguous anchors, and self-dependency', () => {
		for (const links of [
			[{ relation: 'depends_on', from: { ...from, commit: undefined }, to }],
			[{ relation: 'depends_on', from: { ...from, anchor: undefined }, to }],
			[{ relation: 'depends_on', from, to: from }],
		]) expect(validatePortableContentData('note', { ...note, links }).ok).toBe(false);
	});
});
