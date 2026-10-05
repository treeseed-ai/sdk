import { describe, expect, it } from 'vitest';
import { validatePortableContentData } from '../../../src/content/validation/portable-content-data.ts';
import { AGENT_OPERATIONAL_CONTENT_COLLECTIONS } from '../../../src/content/validation/agent-operational-content-schemas.ts';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeContentFrontmatterSchema } from '../../../src/content/validation/index.ts';
import { exportSchemaConstraints } from '../../../src/content/validation/schema-constraints.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';

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

function decisionEntries() {
	const base = records()[2]!.data, positions = [{ actorRef: to, position: 'approve', recordedAt: note.createdAt }];
	return ['proposal', 'work-review', 'publication'].flatMap(decisionClass =>
		['approved', 'rejected', 'request-changes', 'deferred', 'superseded'].flatMap(disposition =>
			['authority', 'approval', 'vote'].flatMap(decisionMethod => [undefined, [], positions].map(value => ({
				data: { ...base, decisionClass, disposition, decisionMethod, ...(value === undefined ? {} : { positions: value }) },
				valid: (decisionClass === 'work-review' ? ['approved', 'request-changes'].includes(disposition) : disposition !== 'request-changes')
					&& (value === undefined ? decisionMethod === 'authority' : value.length > 0),
			})))));
}
function observeReportRules(native: boolean) {
	const workday = { store: 'postgresql', model: 'workday', id: 'bounded-workday' };
	const entries = ['general', 'feedback', 'research', 'workday-report'].flatMap(classification => [
		{ refs: [workday], valid: true }, { refs: [from, workday, to], valid: true },
		{ refs: [from], valid: classification !== 'workday-report' },
		{ refs: [{ ...from, model: 'workday' }], valid: classification !== 'workday-report' },
		{ refs: [{ ...workday, model: 'proposal' }], valid: classification !== 'workday-report' },
		{ refs: [], valid: false }, { refs: [workday, workday], valid: false },
		{ refs: [{ ...workday, id: null }], valid: false }, { refs: null, valid: false },
	].map(({ refs, valid }) => ({ data: { ...note, classification, subjectRefs: refs }, valid })));
	const held = structuredClone(entries), expected = [{
		if: { type: 'object', required: ['classification'], properties: { classification: { const: 'workday-report' } } },
		then: { type: 'object', properties: { subjectRefs: { type: 'array', contains: {
			type: 'object', required: ['store', 'model'], properties: { store: { const: 'postgresql' }, model: { const: 'workday' } },
		} } } },
	}];
	if (native) {
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'note-inventory'], {
			input: JSON.stringify(entries.map(entry => entry.data)), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const output: unknown = JSON.parse(child.stdout);
		if (!output || typeof output !== 'object' || !('schema' in output) || !('observations' in output) || !Array.isArray(output.observations))
			throw new Error('Native Note schema and observations required.');
		expect(output.observations).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(output.observations[index]).toMatchObject(entry.valid ? { ok: true, data: entry.data } : { ok: false });
		expect(output.schema).toMatchObject({ allOf: expected }); expect(readFileSync(path)).toEqual(bytes);
	} else {
		const observations = entries.map(entry => validatePortableContentData('note', entry.data));
		expect(observations.map(value => value.ok)).toEqual(entries.map(entry => entry.valid));
		for (const [index, entry] of entries.entries()) if (entry.valid) expect(observations[index]).toMatchObject({ data: entry.data });
		expect(zodToJsonSchema(describeContentFrontmatterSchema('note'),
			{ $refStrategy: 'none', postProcess: exportSchemaConstraints })).toMatchObject({ allOf: expected });
	}
		expect(entries).toEqual(held);
}
function observeDecisionRules(native: boolean) {
	const entries = decisionEntries(), held = structuredClone(entries);
	const expected = [
		{
			if: { type: 'object', required: ['decisionMethod'], properties: { decisionMethod: { enum: ['approval', 'vote'] } } },
			then: { type: 'object', required: ['positions'] },
		},
		...['work-review', 'proposal', 'publication'].map(kind => ({
			if: { type: 'object', required: ['decisionClass'], properties: { decisionClass: { const: kind } } },
			then: { type: 'object', properties: { disposition: { enum: kind === 'work-review'
				? ['approved', 'request-changes'] : ['approved', 'rejected', 'deferred', 'superseded'] } } },
		})),
	];
	if (native) {
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'decision-inventory'], {
			input: JSON.stringify(entries.map(entry => entry.data)), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const output: unknown = JSON.parse(child.stdout);
		if (!output || typeof output !== 'object' || !('schema' in output) || !('observations' in output) || !Array.isArray(output.observations)) {
			throw new Error('Native Decision schema and observations required.');
		}
		expect(output.observations).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(output.observations[index]).toMatchObject(entry.valid ? { ok: true, data: entry.data } : { ok: false });
		expect(output.schema).toMatchObject({ allOf: expected }); expect(readFileSync(path)).toEqual(bytes);
	} else {
		const observations = entries.map(entry => validatePortableContentData('decision', entry.data));
		expect(observations.map(value => value.ok)).toEqual(entries.map(entry => entry.valid));
		for (const [index, entry] of entries.entries()) if (entry.valid) expect(observations[index]).toMatchObject({ data: entry.data });
		expect(zodToJsonSchema(describeContentFrontmatterSchema('decision'),
			{ $refStrategy: 'none', postProcess: exportSchemaConstraints })).toMatchObject({ allOf: expected });
	}
		expect(entries).toEqual(held);
}

function records(): Array<{ model: string; data: Record<string, unknown> }> {
	return [{ model: 'note', data: note },
		{ model: 'question', data: { schemaVersion: 'treeseed.question/v1', id: 'question', projectId: 'api', subjectRef: from,
			question: 'Which exact source is authorized?', status: 'open', askedAt: note.createdAt } },
		{ model: 'decision', data: { schemaVersion: 'treeseed.decision/v1', id: 'decision', projectId: 'api', decisionClass: 'proposal',
			decisionMethod: 'authority', subjectRef: from, disposition: 'approved', rationale: 'Supplied parser input, not native approval.',
			authorityRefs: [from], decidedByRefs: [to], decidedAt: note.createdAt } },
		{ model: 'proposal', data: { schemaVersion: 'treeseed.proposal/v1', id: 'proposal', projectId: 'api', title: 'Controlled request',
			request: 'Complete only the exact authorized work.', status: 'draft' } }];
}
function identifierEntries() {
	return records().flatMap(({ model, data }) => ['id', 'projectId'].flatMap(field => [
		...['A', 'a'.repeat(200), 'A._:/-z'].map(value => ({ model, data: { ...data, [field]: value }, valid: true })),
		...['', ' ', ' padded ', 'a b', 'é', 'a'.repeat(201), null, 1].map(value => ({ model, data: { ...data, [field]: value }, valid: false })),
		{ model, data: Object.fromEntries(Object.entries(data).filter(([key]) => key !== field)), valid: false },
	]));
}
function referenceEntries() {
	return records().flatMap(({ model, data }) => {
		const fields = model === 'note' ? ['subjectRefs'] : model === 'question' ? ['answerRefs']
			: model === 'decision' ? ['authorityRefs', 'decidedByRefs', 'findingRefs'] : ['objectiveRefs', 'evidenceRefs'];
		return fields.flatMap(field => [
			{ model, data: { ...data, [field]: [from, to] }, valid: true },
			{ model, data: { ...data, [field]: [] }, valid: !['subjectRefs', 'authorityRefs', 'decidedByRefs'].includes(field) },
			...[ [from, structuredClone(from)], [from, Object.fromEntries(Object.entries(from).reverse())], [from, null] ]
				.map(value => ({ model, data: { ...data, [field]: value }, valid: false })),
		]);
	}).concat([[], ['renamed-author'], ['a'.repeat(100)], ['first', 'second']]
		.map(addressedTo => ({ model: 'question', data: { ...records()[1]!.data, addressedTo }, valid: true })),
		[['same', 'same'], ['UPPER'], ['a'.repeat(101)], ['a b'], [''], [null], null, 'author']
			.map(addressedTo => ({ model: 'question', data: { ...records()[1]!.data, addressedTo }, valid: false })));
}
function observations(entries: ReturnType<typeof identifierEntries>, native: boolean) {
	const held = structuredClone(entries);
	if (!native) {
		const result = entries.map(entry => {
			const parsed = validatePortableContentData(entry.model, entry.data);
			if (entry.valid) expect(parsed).toMatchObject({ ok: true, data: entry.data });
			return parsed.ok;
		});
		expect(result).toEqual(entries.map(entry => entry.valid));
	} else {
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'content-records'], {
			input: JSON.stringify(entries.map(({ model, data }) => ({ model, data }))), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const result: unknown = JSON.parse(child.stdout); if (!Array.isArray(result)) throw new Error('Native governed content observations required.');
		expect(result).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(result[index]).toMatchObject(entry.valid ? { ok: true, data: entry.data } : { ok: false });
		expect(readFileSync(path)).toEqual(bytes);
	}
		expect(entries).toEqual(held);
}

describe('exact dependency links on an ordinary TreeDX note', () => {
	it('exports the same exact workday subject requirement that the owning report Note validator enforces', () => observeReportRules(false));
	it('native public report Note validation and schema retain exact workday subjects and deny missing duplicated or malformed authority', () => observeReportRules(true));
	it('exports the same classed Decision dispositions and required approval or vote positions enforced by the owning validator', () => observeDecisionRules(false));
	it('native public Decision validation and schema agree across every class disposition method and retained position inventory', () => observeDecisionRules(true));
	it('retains exact bounded governed execution content identifiers and denies malformed or missing identities without normalization', () => observations(identifierEntries(), false));
	it('native public governed content validation denies malformed identities while retaining exact valid source bytes', () => observations(identifierEntries(), true));
	it('retains distinct governed evidence and agent addresses but denies duplicated malformed or empty required inventories', () => observations(referenceEntries(), false));
	it('native public governed content validation preserves distinct evidence and rejects duplicate refs or malformed addressed agent classes', () => observations(referenceEntries(), true));
	it('registers the existing governed Note and Decision collections for execution authority without introducing another model', () => {
		const collections: Readonly<Record<string, string>> = AGENT_OPERATIONAL_CONTENT_COLLECTIONS;
		expect(collections.note).toBe('notes');
		expect(collections.decision).toBe('decisions');
		expect(Object.values(collections).filter((collection) => collection === 'notes')).toEqual(['notes']);
		expect(Object.values(collections).filter((collection) => collection === 'decisions')).toEqual(['decisions']);
		expect(validatePortableContentData('note', note).ok).toBe(true);
	});
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
