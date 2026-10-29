import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describeContentFrontmatterContract, describeContentFrontmatterJsonSchema, validatePortableContentData } from '../../../../src/content/validation/index.ts';

function proposal() {
	return { schemaVersion: 'treeseed.proposal/v2', id: 'prepared-runner-boundary', projectId: 'agent',
		title: 'Execute the prepared model request through an opaque guest', groupIds: ['provider-runtime'],
		request: 'Move agent task policy out of the guest runner and preserve the configured handler request.',
		summary: 'Document the boundary, reproduce the lost request, and repair the handoff.', status: 'ready',
		executionPlan: { workItems: ['document-boundary', 'reproduce-request-loss', 'repair-handoff'].map((id, index, ids) => ({
			id, activity: 'acting', objective: id, workspace: 'git', review: 'required', maximumReviewCycles: 2,
			estimateRef: { store: 'postgresql', model: 'assignment-attempt', id: `estimate-${index}`, revision: 1 },
			estimate: { expectedSeconds: 120, maximumSeconds: 240, rationale: 'Own bounded contribution against the actual provider source.' },
			reviewEstimate: { expectedSeconds: 60, maximumSeconds: 120, rationale: 'Own independent peer-review effort.' },
			dependsOn: index ? [ids[index - 1]!] : [],
			requestedPermissions: { content: { read: ['proposal', 'decision'], write: [] }, tools: ['source.read', 'source.write', 'verification'] },
			contextRefs: [{ store: 'git', model: 'repository', id: 'agent', repository: 'treeseed-ai/agent', commit: 'a'.repeat(40) }],
			acceptanceCriteria: ['Preserve the exact prepared request and original authority.'],
		})) } };
}

describe('group-owned proposal contributions', () => {
	it('exports JSON Schema types for every real planning product instead of internal validator type names', () => {
		const invalid: Array<{ path: string; type: unknown }> = [];
		const inspect = (value: unknown, path: string) => {
			if (!value || typeof value !== 'object') return;
			if (Array.isArray(value)) { value.forEach((item, index) => inspect(item, `${path}/${index}`)); return; }
			const node = value as Record<string, unknown>;
			if (node.type !== undefined && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(node.type)))
				invalid.push({ path, type: node.type });
			for (const [key, item] of Object.entries(node)) inspect(item, `${path}/${key}`);
		};
		for (const model of ['proposal', 'question', 'note'] as const) inspect(describeContentFrontmatterJsonSchema(model), model);
		expect(invalid).toEqual([]);
	});
	it('keeps discussion contributions and dependencies before their authors supply estimates without permitting approval', () => {
		for (const status of ['draft', 'discussing']) {
			const input = proposal(); input.status = status;
			for (const item of input.executionPlan.workItems) for (const field of ['estimate', 'estimateRef', 'reviewEstimate'])
				Reflect.deleteProperty(item, field);
			const before = structuredClone(input), checked = validatePortableContentData('proposal', input);
			expect(checked.ok, JSON.stringify(checked.diagnostics)).toBe(true);
			expect(checked.data).toEqual(before); expect(input).toEqual(before);
			for (const executable of ['ready', 'decided'])
				expect(validatePortableContentData('proposal', { ...input, status: executable }).ok).toBe(false);
			Object.assign(input.executionPlan.workItems[0]!, proposal().executionPlan.workItems[0]);
			expect(validatePortableContentData('proposal', input).ok).toBe(true);
			input.executionPlan.workItems[0]!.dependsOn = ['repair-handoff'];
			expect(validatePortableContentData('proposal', input).ok).toBe(false);
		}
		for (const status of ['ready', 'decided']) for (const field of ['estimate', 'estimateRef', 'reviewEstimate']) {
			const input = proposal(); input.status = status;
			Reflect.deleteProperty(input.executionPlan.workItems[1]!, field);
			expect(validatePortableContentData('proposal', input).ok, `${status}/${field}`).toBe(false);
		}
	});
	it('retains each independently estimated contribution and dependency without agent targeting', () => {
		const input = proposal(), before = structuredClone(input), checked = validatePortableContentData('proposal', input);
		expect(checked.ok, JSON.stringify(checked.diagnostics)).toBe(true);
		expect(checked.data).toEqual(before); expect(input).toEqual(before);
	});
	it('requires a group and actual estimate-assignment provenance rather than caller-selected agent identity', () => {
		const noGroups = proposal(); noGroups.groupIds = [];
		expect(validatePortableContentData('proposal', noGroups).ok).toBe(false);
		for (const field of ['agentClass', 'agentId', 'agentIds', 'agentSlug', 'actorId', 'reviewerId']) {
			const input = proposal(); Object.assign(input.executionPlan.workItems[0]!, { [field]: 'engineer' });
			expect(validatePortableContentData('proposal', input).ok, field).toBe(false);
		}
		for (const patch of [{ estimateRef: undefined }, { estimateRef: { store: 'postgresql', model: 'agent', id: 'engineer', revision: 1 } },
			{ estimateRef: { store: 'postgresql', model: 'assignment-attempt', id: 'estimate', revision: 0 } }, { estimate: undefined },
			{ estimate: { expectedSeconds: 120, maximumSeconds: 240, rationale: '' } },
			{ estimate: { expectedSeconds: 300, maximumSeconds: 240, rationale: 'Invalid bound.' } }, { reviewEstimate: undefined }]) {
			const input = proposal(); Object.assign(input.executionPlan.workItems[0]!, patch);
			expect(validatePortableContentData('proposal', input).ok, JSON.stringify(patch)).toBe(false);
		}
	});
	it('preserves acyclic dependency and exact mutable-source requirements across contributors', () => {
		const cycle = proposal(); cycle.executionPlan.workItems[0]!.dependsOn = ['repair-handoff'];
		expect(validatePortableContentData('proposal', cycle).ok).toBe(false);
		const missing = proposal(); missing.executionPlan.workItems[0]!.contextRefs = [];
		expect(validatePortableContentData('proposal', missing).ok).toBe(false);
	});
	it('describes current class-free writes separately from historical v1 content', () => {
		const contract = describeContentFrontmatterContract('proposal');
		expect(contract.fields.schemaVersion).toMatchObject({ value: 'treeseed.proposal/v2' });
		const schema = describeContentFrontmatterJsonSchema('proposal') as { properties: Record<string, any> };
		const fields = schema.properties.executionPlan.anyOf[0].properties.workItems.items.properties;
		expect(fields).toHaveProperty('estimateRef'); expect(fields).not.toHaveProperty('agentClass');
		const old = describeContentFrontmatterJsonSchema('proposal', 'treeseed.proposal/v1') as { properties: Record<string, any> };
		expect(old.properties.executionPlan.anyOf[0].properties.workItems.items.properties).toHaveProperty('agentClass');
	});
	it('native public proposal validation preserves every contribution and historical read while rejecting forged target fields and malformed estimates', () => {
		const valid = proposal(), noGroups = proposal(), cycle = proposal();
		noGroups.groupIds = []; cycle.executionPlan.workItems[0]!.dependsOn = ['repair-handoff'];
		const denied = [noGroups, cycle, ...[
			{ agentClass: 'engineer' }, { agentId: 'engineer' }, { reviewerId: 'reviewer' },
			{ estimateRef: undefined }, { estimateRef: { store: 'postgresql', model: 'assignment-attempt', id: 'estimate', revision: 0 } },
			{ estimateRef: { store: 'postgresql', model: 'assignment-attempt', id: 'estimate', revision: 1, agentId: 'engineer' } },
			{ estimate: { expectedSeconds: 300, maximumSeconds: 240, rationale: 'Invalid bound.' } },
			{ estimate: { expectedSeconds: 120, maximumSeconds: 240, rationale: '' } }, { reviewEstimate: undefined },
		].map(patch => { const value = proposal(); Object.assign(value.executionPlan.workItems[0]!, patch); return value; })];
		const historical = { ...valid, schemaVersion: 'treeseed.proposal/v1', executionPlan: { workItems:
			valid.executionPlan.workItems.map(({ estimateRef: _ref, ...item }) => ({ ...item, agentClass: 'historical-class' })) } };
		const draft = proposal(); draft.status = 'discussing';
		for (const item of draft.executionPlan.workItems) for (const field of ['estimate', 'estimateRef', 'reviewEstimate'])
			Reflect.deleteProperty(item, field);
		const partial = structuredClone(draft);
		Object.assign(partial.executionPlan.workItems[0]!, valid.executionPlan.workItems[0]);
		const invalidDraft = structuredClone(draft); invalidDraft.executionPlan.workItems[0]!.dependsOn = ['absent-product'];
		const planning = [draft, partial, { ...draft, status: 'ready' }, { ...draft, status: 'decided' }, invalidDraft];
		const input = [valid, ...denied, ...planning, historical], before = structuredClone(input);
		const path = fileURLToPath(new URL('../architecture/closeout-native.ts', import.meta.url)), bytes = readFileSync(path);
		const child = spawnSync(process.execPath, ['--import', import.meta.resolve('tsx'), path, 'proposal-inventory'], {
			input: JSON.stringify(input), encoding: 'utf8', timeout: 15_000,
		});
		expect(child.error).toBeUndefined(); expect(child.signal).toBeNull(); expect(child.status, child.stderr).toBe(0);
		const output = JSON.parse(child.stdout);
		expect(output.observations.map((entry: { ok: boolean }) => entry.ok)).toEqual([true, ...denied.map(() => false), true, true, false, false, false, true]);
		expect(output.observations[0].data).toEqual(valid); expect(output.observations.at(-1).data).toEqual(historical);
		expect(output.observations[1 + denied.length].data).toEqual(draft);
		expect(output.observations[2 + denied.length].data).toEqual(partial);
		const fields = output.schema.properties.executionPlan.properties.workItems.items.properties;
		expect(fields).toHaveProperty('estimateRef'); expect(fields).not.toHaveProperty('agentClass');
		expect(input).toEqual(before); expect(readFileSync(path)).toEqual(bytes);
	});
});
