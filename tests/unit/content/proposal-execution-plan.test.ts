import { describe, expect, it } from 'vitest';
import { describeContentFrontmatterContract, describeContentFrontmatterJsonSchema, validatePortableContentData } from '../../../src/content/validation/index.ts';
import type { ExactEntityReference } from '../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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

function boundedWorkItemEntries() {
	const value = proposal(), item = value.executionPlan.workItems[0]!;
	const input = (patch: Record<string, unknown>) => ({ ...value, executionPlan: { workItems: [Object.assign({}, item, patch)] } });
	const duplicate = item.contextRefs[0]!;
	return [
		{ data: value, valid: true },
		{ data: input({ id: 'a'.repeat(100), agentClass: 'a'.repeat(100), requiredCapabilities: ['a'.repeat(200), 'source.read'] }), valid: true },
		...[{ id: 'a'.repeat(101) }, { agentClass: 'a'.repeat(101) },
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

describe('proposal-owned execution plan', () => {
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
	it('binds one exact TreeDX output identity without introducing an output taxonomy', () => {
		const value = proposal();
		const item = value.executionPlan.workItems[0]!;
		item.workspace = 'treedx';
		item.requestedPermissions = { content: { read: ['proposal'], write: ['knowledge'] }, tools: ['source.read'] };
		item.contextRefs = [{ store: 'treedx', model: 'repository', id: 'sdk-library', repository: 'treeseed-ai/sdk-library', commit: 'b'.repeat(40), path: '.' }];
		Object.assign(item, { output: { model: 'knowledge', id: 'sdk-workday-contract-inventory-v1' } });
		expect(validatePortableContentData('proposal', value).ok).toBe(true);
		item.workspace = 'git';
		expect(validatePortableContentData('proposal', value).ok).toBe(false);
	});
	it('preserves canonical exact evidence references without legacy registry translation', () => {
		const value = { ...proposal(), evidenceRefs: [{ store: 'git', model: 'repository', id: 'sdk', repository: 'treeseed-ai/sdk', commit: 'b'.repeat(40) }] };
		const result = validatePortableContentData('proposal', value);
		expect(result.ok).toBe(true);
		expect(result.data).toMatchObject({ evidenceRefs: value.evidenceRefs });
	});
	it('rejects invalid estimate ordering', () => { const value = proposal(); value.executionPlan.workItems[0]!.estimate.expectedSeconds = 300; expect(validatePortableContentData('proposal', value).ok).toBe(false); });
	it('rejects executable work without a provider capability demand', () => {
		const value = proposal(), { requiredCapabilities: _required, ...missing } = value.executionPlan.workItems[0]!;
		expect(validatePortableContentData('proposal', { ...value, executionPlan: { workItems: [missing] } }).ok).toBe(false);
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
