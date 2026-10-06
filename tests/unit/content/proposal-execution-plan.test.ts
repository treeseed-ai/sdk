import { describe, expect, it } from 'vitest';
import { describeContentFrontmatterContract, describeContentFrontmatterJsonSchema, validatePortableContentData } from '../../../src/content/validation/index.ts';
import type { ExactEntityReference } from '../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeContentFrontmatterSchema } from '../../../src/content/validation/index.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { exportSchemaConstraints } from '../../../src/content/validation/schema-constraints.ts';

function proposal() {
	const dependsOn: string[] = [], write: string[] = [];
	const contextRefs: ExactEntityReference[] = [{ store: 'git', model: 'repository', id: 'sdk', repository: 'treeseed-ai/sdk', commit: 'a'.repeat(40) }];
	return {
		schemaVersion: 'treeseed.proposal/v1', id: 'proposal-one', projectId: 'sdk', title: 'Reliable pagination',
		request: 'Make pagination reliable.', summary: 'Define, test, and implement bounded pagination.', status: 'ready',
		executionPlan: { workItems: [{
			id: 'implement', activity: 'acting', agentClass: 'engineer', workspace: 'git', review: 'required',
			objective: 'Implement the accepted pagination behavior.', estimate: { expectedSeconds: 120, maximumSeconds: 240 },
			reviewEstimate: { expectedSeconds: 60, maximumSeconds: 120 }, maximumReviewCycles: 2,
			dependsOn, requestedPermissions: { content: { read: ['proposal', 'decision'], write }, tools: ['source.read', 'source.write', 'verification'] },
			contextRefs,
			requiredCapabilities: ['code-change'], acceptanceCriteria: ['Focused tests pass.'],
		}] },
	};
}

function observeWorkItemSlugs(native: boolean) {
	const base = proposal(), item = base.executionPlan.workItems[0]!;
	const valid = ['a', '0', 'work.part', 'work_part', 'work/part', 'work-part', 'work.part/next_part-last', 'a'.repeat(100)];
	const malformed: unknown[] = ['', ' ', ' padded', 'padded ', 'Upper', 'é', '-first', 'last-',
		'work..part', 'work__part', 'work//part', 'work--part', 'work._part', 'work part', 'a'.repeat(101), null, 1, {}, []];
	const entries = [...valid.map(id => ({ valid: true, data: { ...base, executionPlan: { workItems: [
		{ ...item, id, dependsOn: ['final'] }, { ...item, id: 'final', dependsOn: [] },
	] } } })), ...malformed.map(id => ({ valid: false, data: { ...base, executionPlan: { workItems: [Object.assign({}, item, { id })] } } })),
		...malformed.map(id => ({ valid: false, data: { ...base, executionPlan: { workItems: [Object.assign({}, item, { dependsOn: [id] })] } } }))];
	const held = structuredClone(entries);
	if (native) {
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'proposal-inventory'], {
			input: JSON.stringify(entries.map(entry => entry.data)), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const output: unknown = JSON.parse(child.stdout);
		if (!output || typeof output !== 'object' || !('schema' in output) || !('observations' in output) || !Array.isArray(output.observations))
			throw new Error('Native Proposal schema and slug observations required.');
		expect(output.observations).toHaveLength(entries.length);
		expect(output.observations.map(value => value.ok)).toEqual(entries.map(entry => entry.valid));
		for (const [index, entry] of entries.entries()) if (entry.valid) expect(output.observations[index]).toMatchObject({ data: entry.data });
		expect(output.schema).toMatchObject({ properties: { executionPlan: { properties: { workItems: { items: { properties: {
			id: { minLength: 1, maxLength: 100, pattern: '^[a-z0-9]+(?:[._/-][a-z0-9]+)*$' },
			dependsOn: { uniqueItems: true, items: { minLength: 1, maxLength: 100, pattern: '^[a-z0-9]+(?:[._/-][a-z0-9]+)*$' } },
		} } } } } } });
		expect(readFileSync(path)).toEqual(bytes);
	} else {
		const results = entries.map(entry => validatePortableContentData('proposal', entry.data));
		expect(results.map(result => result.ok)).toEqual(entries.map(entry => entry.valid));
		for (const [index, entry] of entries.entries()) if (entry.valid) expect(results[index]).toMatchObject({ data: entry.data });
	}
	const dependency = { ...base, executionPlan: { workItems: [{ ...item, id: 'dependent', dependsOn: ['work.part'] }, { ...item, id: 'work.part', dependsOn: [] }] } };
	const before = structuredClone(dependency);
	expect(validatePortableContentData('proposal', dependency)).toMatchObject({ ok: true, data: dependency });
	expect(dependency).toEqual(before); expect(entries).toEqual(held);
}

function boundedWorkItemEntries() {
	const value = proposal(), item = value.executionPlan.workItems[0]!;
	const input = (patch: Record<string, unknown>) => ({ ...value, executionPlan: { workItems: [Object.assign({}, item, patch)] } });
	const duplicate = item.contextRefs[0]!;
	return [
		{ data: value, valid: true },
		{ data: input({ id: 'a'.repeat(100), agentClass: 'a'.repeat(100), requiredCapabilities: ['a'.repeat(200), 'source.read'] }), valid: true },
		...[{ id: 'a'.repeat(101) }, { agentClass: 'a'.repeat(101) }, { agentClass: ' padded' }, { agentClass: 'padded ' },
			...['', ' padded ', 'internal space', 'é', 'a'.repeat(201), null].map(value => ({ requiredCapabilities: ['source.read', value] })),
			{ requiredCapabilities: ['source.read', 'source.read'] }, { contextRefs: [duplicate, Object.fromEntries(Object.entries(duplicate).reverse())] },
			...['read', 'write'].map(field => ({ requestedPermissions: { ...item.requestedPermissions,
				content: { ...item.requestedPermissions.content, [field]: ['proposal', 'proposal'] } } })),
			{ requestedPermissions: { ...item.requestedPermissions, tools: ['source.read', 'source.read'] } }]
			.map(patch => ({ data: input(patch), valid: false })),
	];
}
function observeBoundedWorkItems(native: boolean) {
	const entries = boundedWorkItemEntries(), before = structuredClone(entries);
	if (native) {
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'content-records'], {
			input: JSON.stringify(entries.map(({ data }) => ({ model: 'proposal', data }))), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const results: unknown = JSON.parse(child.stdout); if (!Array.isArray(results)) throw new Error('Native work-item observations required.');
		expect(results).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(results[index]).toMatchObject(entry.valid ? { ok: true, data: entry.data } : { ok: false });
		expect(readFileSync(path)).toEqual(bytes);
	} else {
		const results = entries.map(entry => validatePortableContentData('proposal', entry.data));
		expect(results.map(result => result.ok)).toEqual(entries.map(entry => entry.valid));
		for (const [index, entry] of entries.entries()) if (entry.valid) expect(results[index]).toMatchObject({ data: entry.data });
	}
		expect(entries).toEqual(before);
}
function observeWorkItemReview(native: boolean) {
	const base = proposal(), item = base.executionPlan.workItems[0]!;
	const { reviewEstimate: _review, maximumReviewCycles: _cycles, ...withoutReview } = item;
	const variants = [
		{ item, valid: true }, { item: { ...withoutReview, review: 'none' }, valid: true },
		{ item: { ...item, maximumReviewCycles: 1 }, valid: true },
		...[undefined, null, 0, -1, 0.5, '1'].map(maximumReviewCycles => ({ item: { ...item, maximumReviewCycles }, valid: false })),
		...[{ reviewEstimate: item.reviewEstimate }, { maximumReviewCycles: 1 },
			{ reviewEstimate: item.reviewEstimate, maximumReviewCycles: 1 }].map(extra => ({ item: { ...withoutReview, review: 'none', ...extra }, valid: false })),
	];
	const entries = ['draft', 'ready', 'decided'].flatMap(status => variants.map(variant => ({
		data: JSON.parse(JSON.stringify({ ...base, status, executionPlan: { workItems: [variant.item] } })), valid: variant.valid,
	}))), held = structuredClone(entries);
	const expected = [
		{ if: { type: 'object', required: ['review'], properties: { review: { const: 'required' } } },
			then: { type: 'object', required: ['maximumReviewCycles'] } },
		{ if: { type: 'object', required: ['review'], properties: { review: { const: 'none' } } },
			then: { type: 'object', not: { type: 'object', anyOf: [
				{ type: 'object', required: ['reviewEstimate'] }, { type: 'object', required: ['maximumReviewCycles'] },
			] } } },
	];
	if (native) {
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'proposal-inventory'], {
			input: JSON.stringify(entries.map(entry => entry.data)), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const output: unknown = JSON.parse(child.stdout);
		if (!output || typeof output !== 'object' || !('schema' in output) || !('observations' in output) || !Array.isArray(output.observations))
			throw new Error('Native work-item review schema and observations required.');
		expect(output.observations).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(output.observations[index]).toMatchObject(entry.valid ? { ok: true, data: entry.data } : { ok: false });
		expect(output.schema).toMatchObject({ properties: { executionPlan: { properties: { workItems: { items: { allOf: expected } } } } } });
		expect(readFileSync(path)).toEqual(bytes);
	} else {
		const results = entries.map(entry => validatePortableContentData('proposal', entry.data));
		expect(results.map(result => result.ok)).toEqual(entries.map(entry => entry.valid));
		for (const [index, entry] of entries.entries()) if (entry.valid) expect(results[index]).toMatchObject({ data: entry.data });
		expect(zodToJsonSchema(describeContentFrontmatterSchema('proposal'), { $refStrategy: 'none', postProcess: exportSchemaConstraints }))
			.toMatchObject({ properties: { executionPlan: { properties: { workItems: { items: { allOf: expected } } } } } });
	}
	expect(entries).toEqual(held);
}
function observeReadyProposal(native: boolean) {
	const original = proposal(), item = original.executionPlan.workItems[0]!;
	const { estimate: _estimate, reviewEstimate: _reviewEstimate, ...unestimated } = item;
	const { reviewEstimate: _review, maximumReviewCycles: _cycles, ...withoutReview } = item;
	const plans = [undefined, { workItems: [unestimated] }, { workItems: [{ ...item, reviewEstimate: undefined }] },
		{ workItems: [item] }, { workItems: [{ ...withoutReview, review: 'none' }] }];
	const entries = ['draft', 'discussing', 'ready', 'decided', 'withdrawn'].flatMap(status => [undefined, original.summary].flatMap(summary =>
		plans.map((plan, index) => ({ data: { schemaVersion: original.schemaVersion, id: original.id, projectId: original.projectId,
			title: original.title, request: original.request, status, ...(summary === undefined ? {} : { summary }),
			...(plan === undefined ? {} : { executionPlan: JSON.parse(JSON.stringify(plan)) }) },
			valid: !['ready', 'decided'].includes(status) || (summary !== undefined && index >= 3) }))));
	const held = structuredClone(entries), expected = [{
		if: { type: 'object', required: ['status'], properties: { status: { enum: ['ready', 'decided'] } } },
		then: { type: 'object', required: ['summary', 'executionPlan'], properties: { executionPlan: { type: 'object', properties: {
			workItems: { type: 'array', items: { type: 'object', required: ['estimate'], allOf: [{
				if: { properties: { review: { const: 'required' } }, required: ['review'] }, then: { required: ['reviewEstimate'] },
			}] } },
		} } } },
	}];
	if (native) {
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'proposal-inventory'], {
			input: JSON.stringify(entries.map(entry => entry.data)), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const output: unknown = JSON.parse(child.stdout);
		if (!output || typeof output !== 'object' || !('schema' in output) || !('observations' in output) || !Array.isArray(output.observations))
			throw new Error('Native Proposal schema and observations required.');
		expect(output.observations).toHaveLength(entries.length);
		for (const [index, entry] of entries.entries()) expect(output.observations[index]).toMatchObject(entry.valid ? { ok: true, data: entry.data } : { ok: false });
		expect(output.schema).toMatchObject({ allOf: expected }); expect(readFileSync(path)).toEqual(bytes);
	} else {
		const observed = entries.map(entry => validatePortableContentData('proposal', entry.data));
		expect(observed.map(value => value.ok)).toEqual(entries.map(entry => entry.valid));
		for (const [index, entry] of entries.entries()) if (entry.valid) expect(observed[index]).toMatchObject({ data: entry.data });
		expect(zodToJsonSchema(describeContentFrontmatterSchema('proposal'),
			{ $refStrategy: 'none', postProcess: exportSchemaConstraints })).toMatchObject({ allOf: expected });
	}
		expect(entries).toEqual(held);
}

describe('proposal-owned execution plan', () => {
	it('retains exact canonical work-item slugs and dependency identities without trimming padding or accepting malformed separators', () => observeWorkItemSlugs(false));
	it('native public Proposal validation and schema preserve canonical work-item slug grammar and reject malformed identity bytes without repair', () => observeWorkItemSlugs(true));
	it('exports the same independent review cycle requirement and absence of unreviewed estimates enforced on governed executable work', () => observeWorkItemReview(false));
	it('native public Proposal work-item review validation and schema agree on bounded required review and denial of unreviewed authority without input repair', () => observeWorkItemReview(true));
	it('exports the same ready and decided proposal summary plan and independent estimate requirements enforced by native execution intake', () => observeReadyProposal(false));
	it('native public Proposal schema and validation agree on draft estimation and fail closed ready execution authority without rewriting supplied requests', () => observeReadyProposal(true));
	it('bounds governed work-item identities and denies duplicated capability permission and context authority without normalizing request bytes', () => observeBoundedWorkItems(false));
	it('native public proposal validation retains exact bounded work-item authority and rejects duplicated or malformed demand inventories', () => observeBoundedWorkItems(true));
	it('retains optional governed work-item integer priority in draft ready and decided proposals without coercion or an independent node authority', () => {
		for (const status of ['draft', 'ready', 'decided']) {
			const original = { ...proposal(), status }, before = structuredClone(original);
			const omitted = validatePortableContentData('proposal', original);
			expect(omitted.ok).toBe(true); expect(omitted.data).toMatchObject({ executionPlan: { workItems: original.executionPlan.workItems } });
			for (const priority of [Number.MIN_SAFE_INTEGER, -1, 0, 1, Number.MAX_SAFE_INTEGER]) {
				const input = { ...original, executionPlan: { workItems: original.executionPlan.workItems.map(item => ({ ...item, priority })) } }, held = structuredClone(input);
				const result = validatePortableContentData('proposal', input);
				expect(result.ok).toBe(true); expect(result.data).toMatchObject({ executionPlan: input.executionPlan }); expect(input).toEqual(held);
			}
			for (const priority of [null, '', '1', false, true, [], {}, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, Number.MIN_SAFE_INTEGER - 1]) {
				const input = { ...original, executionPlan: { workItems: original.executionPlan.workItems.map(item => Object.assign({}, item, { priority })) } }, held = structuredClone(input);
				expect(validatePortableContentData('proposal', input).ok).toBe(false); expect(input).toEqual(held);
			}
			expect(original).toEqual(before); expect(Object.hasOwn(original.executionPlan.workItems[0]!, 'priority')).toBe(false);
		}
	});
	it('allows draft work to be estimated without fabricating initial budgets but gates ready work', () => {
		const value = proposal();
		const { estimate: _estimate, reviewEstimate: _reviewEstimate, ...unestimated } = value.executionPlan.workItems[0]!;
		const draft = { ...value, status: 'draft', executionPlan: { workItems: [unestimated] } };
		expect(validatePortableContentData('proposal', draft).ok).toBe(true);
		expect(validatePortableContentData('proposal', { ...draft, status: 'ready' }).ok).toBe(false);
		expect(validatePortableContentData('proposal', { ...draft, status: 'decided' }).ok).toBe(false);
	});
	it('accepts complete reviewed work without a separate execution-plan model', () => expect(validatePortableContentData('proposal', proposal()).ok).toBe(true));
	it('allows exact read-only Books alongside one TreeDX workspace repository', () => {
		const value = proposal();
		const item = value.executionPlan.workItems[0]!;
		item.workspace = 'treedx';
		item.contextRefs = [
			{ store: 'treedx', model: 'book', id: 'sdk-architecture', repository: 'treeseed-ai/sdk-library', commit: 'b'.repeat(40), path: 'books/architecture.md', revision: 1, digest: `sha256:${'c'.repeat(64)}` },
			{ store: 'treedx', model: 'repository', id: 'sdk-library', repository: 'treeseed-ai/sdk-library', commit: 'b'.repeat(40), path: '.' },
		];
		expect(validatePortableContentData('proposal', value).ok).toBe(true);
		item.contextRefs.push({ store: 'treedx', model: 'repository', id: 'second-library', repository: 'treeseed-ai/second-library', commit: 'd'.repeat(40), path: '.' });
		expect(validatePortableContentData('proposal', value).ok).toBe(false);
	});
	it('uses exact TreeDX context and permissions without accepting the retired work item output selector', () => {
		const value = proposal();
		const item = value.executionPlan.workItems[0]!;
		item.workspace = 'treedx';
		item.requestedPermissions = { content: { read: ['proposal'], write: ['knowledge'] }, tools: ['source.read'] };
		item.contextRefs = [{ store: 'treedx', model: 'repository', id: 'sdk-library', repository: 'treeseed-ai/sdk-library', commit: 'b'.repeat(40), path: '.' }];
		expect(validatePortableContentData('proposal', value).ok).toBe(true);
		const held = structuredClone(value);
		for (const output of [undefined, null, '', {}, [], 'knowledge', { model: 'knowledge', id: 'sdk-workday-contract-inventory-v1' }]) {
			const supplied = { ...value, executionPlan: { workItems: [Object.assign({}, item, { output })] } }, before = structuredClone(supplied);
			expect(validatePortableContentData('proposal', supplied).ok).toBe(false); expect(supplied).toEqual(before);
		}
		expect(value).toEqual(held);
		item.workspace = 'git';
		expect(validatePortableContentData('proposal', value).ok).toBe(false);
	});
	it('native public Proposal validation retains exact grant context and denies retired output selectors without repairing supplied authority', () => {
		const base = proposal(), item = base.executionPlan.workItems[0]!;
		item.workspace = 'treedx'; item.requestedPermissions = { content: { read: ['proposal'], write: ['knowledge'] }, tools: ['source.read'] };
		item.contextRefs = [{ store: 'treedx', model: 'repository', id: 'sdk-library', repository: 'treeseed-ai/sdk-library', commit: 'b'.repeat(40), path: '.' }];
		const entries = [base, ...[null, '', {}, [], 'knowledge', { model: 'knowledge', id: 'sdk-workday-contract-inventory-v1' }].map(output =>
			({ ...base, executionPlan: { workItems: [Object.assign({}, item, { output })] } }))], held = structuredClone(entries);
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'proposal-inventory'], {
			input: JSON.stringify(entries), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const result: unknown = JSON.parse(child.stdout);
		if (!result || typeof result !== 'object' || !('observations' in result) || !Array.isArray(result.observations) || !('schema' in result)) throw new Error('Native Proposal observations required.');
		expect(result.observations).toHaveLength(entries.length); expect(result.observations[0]).toMatchObject({ ok: true, data: base });
		for (const observed of result.observations.slice(1)) expect(observed).toMatchObject({ ok: false });
		expect(result.schema).toMatchObject({ properties: { executionPlan: { properties: { workItems: { items: { additionalProperties: false } } } } } });
		expect(entries).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	it('preserves canonical exact evidence references without legacy registry translation', () => {
		const value = { ...proposal(), evidenceRefs: [{ store: 'git', model: 'repository', id: 'sdk', repository: 'treeseed-ai/sdk', commit: 'b'.repeat(40) }] };
		const result = validatePortableContentData('proposal', value);
		expect(result.ok).toBe(true);
		expect(result.data).toMatchObject({ evidenceRefs: value.evidenceRefs });
	});
	it('rejects invalid estimate ordering', () => { const value = proposal(); value.executionPlan.workItems[0]!.estimate.expectedSeconds = 300; expect(validatePortableContentData('proposal', value).ok).toBe(false); });
	it('retains omitted or represented empty governed work-item capabilities without inventing provider admission authority', () => {
		const value = proposal(), { requiredCapabilities: _required, ...missing } = value.executionPlan.workItems[0]!;
		for (const item of [missing, { ...missing, requiredCapabilities: [] }]) {
			const input = { ...value, executionPlan: { workItems: [item] } }, held = structuredClone(input);
			expect(validatePortableContentData('proposal', input)).toMatchObject({ ok: true, data: input }); expect(input).toEqual(held);
		}
	});
	it('native public Proposal validation preserves optional capability declarations while rejecting malformed or duplicate demands', () => {
		const base = proposal(), { requiredCapabilities: _required, ...missing } = base.executionPlan.workItems[0]!;
		const items = [missing, { ...missing, requiredCapabilities: [] }, { ...missing, requiredCapabilities: ['code-change'] },
			...[null, '', [''], ['code-change', 'code-change']].map(requiredCapabilities => Object.assign({}, missing, { requiredCapabilities }))];
		const inputs = items.map(item => ({ ...base, executionPlan: { workItems: [item] } })), held = structuredClone(inputs);
		const path = fileURLToPath(new URL('./architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'proposal-inventory'], { input: JSON.stringify(inputs), encoding: 'utf8', timeout: 15_000 });
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const result: unknown = JSON.parse(child.stdout);
		if (!result || typeof result !== 'object' || !('observations' in result) || !Array.isArray(result.observations)) throw new Error('Native Proposal observations required.');
		expect(result.observations).toHaveLength(inputs.length);
		for (const [index, input] of inputs.entries()) expect(result.observations[index]).toMatchObject(index < 3 ? { ok: true, data: input } : { ok: false });
		expect(inputs).toEqual(held); expect(readFileSync(path)).toEqual(bytes);
	});
	it('rejects missing and cyclic work-item dependencies', () => {
		const missing = proposal(); missing.executionPlan.workItems[0]!.dependsOn.push('missing'); expect(validatePortableContentData('proposal', missing).ok).toBe(false);
		const cyclic = proposal(); cyclic.executionPlan.workItems.push({ ...structuredClone(cyclic.executionPlan.workItems[0]!), id: 'verify', dependsOn: ['implement'] }); cyclic.executionPlan.workItems[0]!.dependsOn = ['verify'];
		expect(validatePortableContentData('proposal', cyclic).ok).toBe(false);
		const repeated = proposal(); repeated.executionPlan.workItems.push({ ...structuredClone(repeated.executionPlan.workItems[0]!), id: 'verify', dependsOn: ['implement', 'implement'] });
		const before = structuredClone(repeated);
		expect(validatePortableContentData('proposal', repeated).ok).toBe(false); expect(repeated).toEqual(before);
		repeated.executionPlan.workItems[1]!.dependsOn = ['implement'];
		const restored = structuredClone(repeated);
		expect(validatePortableContentData('proposal', repeated).ok).toBe(true); expect(repeated).toEqual(restored);
	});
	it('rejects retired work-product and dependency taxonomies', () => {
		const value = proposal();
		Object.assign(value.executionPlan.workItems[0]!, { produces: [{ outputType: 'specialized-output' }] });
		expect(validatePortableContentData('proposal', value).ok).toBe(false);
	});
	it('describes nested execution-plan fields from the canonical validator', () => {
		const contract = describeContentFrontmatterContract('proposal') as any;
		expect(contract.fields.executionPlan).toMatchObject({
			type: 'object', fields: { workItems: { type: 'array', items: { type: 'object', fields: {
				activity: { value: 'acting' }, agentClass: { type: 'string' }, estimate: { type: 'object' },
				requestedPermissions: { type: 'object' },
			} } } },
		});
	});
	it('generates strict structured output from the canonical proposal validator', () => {
		const schema = describeContentFrontmatterJsonSchema('proposal') as { additionalProperties: boolean; properties: Record<string, any>; required: string[] };
		expect(schema.additionalProperties).toBe(false);
		expect(schema.properties).toHaveProperty('evidenceRefs');
		expect(schema.properties).not.toHaveProperty('evidence_refs');
		expect(schema.required).toContain('evidenceRefs');
		expect(schema.properties.evidenceRefs.anyOf).toContainEqual({ type: 'null' });
		expect(schema.properties.objectiveRefs.anyOf[0].items.required).toContain('revision');
		expect(schema.properties.executionPlan.anyOf[0].properties.workItems.items.properties.agentClass.pattern).toBe('^[a-z][a-z0-9-]*$');
	});
});
