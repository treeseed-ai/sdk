import { describe, expect, it } from 'vitest';
import { describeContentFrontmatterContract, describeContentFrontmatterJsonSchema, validatePortableContentData } from '../../../src/content/validation/index.ts';

function proposal() {
	return {
		schemaVersion: 'treeseed.proposal/v1', id: 'proposal-one', projectId: 'sdk', title: 'Reliable pagination',
		request: 'Make pagination reliable.', summary: 'Define, test, and implement bounded pagination.', status: 'ready',
		executionPlan: { workItems: [{
			id: 'implement', activity: 'acting', agentClass: 'engineer', workspace: 'git', review: 'required',
			objective: 'Implement the accepted pagination behavior.', estimate: { minimumSeconds: 60, expectedSeconds: 120, maximumSeconds: 240 },
			reviewEstimate: { minimumSeconds: 30, expectedSeconds: 60, maximumSeconds: 120 }, maximumReviewCycles: 2,
			dependsOn: [], requestedPermissions: { content: { read: ['proposal', 'decision'], write: [] }, tools: ['source.read', 'source.write', 'verification'] },
			contextRefs: [{ store: 'git', model: 'repository', id: 'sdk', repository: 'treeseed-ai/sdk', commit: 'a'.repeat(40) }],
			requiredCapabilities: ['code-change'], acceptanceCriteria: ['Focused tests pass.'],
		}] },
	};
}

describe('proposal-owned execution plan', () => {
	it('allows draft work to be estimated without fabricating initial budgets but gates ready work', () => {
		const value = proposal();
		const { estimate: _estimate, reviewEstimate: _reviewEstimate, ...unestimated } = value.executionPlan.workItems[0]!;
		const draft = { ...value, status: 'draft', executionPlan: { workItems: [unestimated] } };
		expect(validatePortableContentData('proposal', draft).ok).toBe(true);
		expect(validatePortableContentData('proposal', { ...draft, status: 'ready' }).ok).toBe(false);
		expect(validatePortableContentData('proposal', { ...draft, status: 'decided' }).ok).toBe(false);
	});
	it('accepts complete reviewed work without a separate execution-plan model', () => expect(validatePortableContentData('proposal', proposal()).ok).toBe(true));
	it('preserves canonical exact evidence references without legacy registry translation', () => {
		const value = { ...proposal(), evidenceRefs: [{ store: 'git', model: 'repository', id: 'sdk', repository: 'treeseed-ai/sdk', commit: 'b'.repeat(40) }] };
		const result = validatePortableContentData('proposal', value);
		expect(result.ok).toBe(true);
		expect(result.data).toMatchObject({ evidenceRefs: value.evidenceRefs });
	});
	it('rejects invalid estimate ordering', () => { const value = proposal(); value.executionPlan.workItems[0]!.estimate.minimumSeconds = 300; expect(validatePortableContentData('proposal', value).ok).toBe(false); });
	it('rejects executable work without a provider capability demand', () => {
		const value = proposal() as ReturnType<typeof proposal> & { executionPlan: { workItems: Array<Record<string, unknown>> } };
		delete value.executionPlan.workItems[0]!.requiredCapabilities;
		expect(validatePortableContentData('proposal', value).ok).toBe(false);
	});
	it('rejects missing and cyclic work-item dependencies', () => {
		const missing = proposal(); missing.executionPlan.workItems[0]!.dependsOn.push('missing'); expect(validatePortableContentData('proposal', missing).ok).toBe(false);
		const cyclic = proposal(); cyclic.executionPlan.workItems.push({ ...structuredClone(cyclic.executionPlan.workItems[0]!), id: 'verify', dependsOn: ['implement'] }); cyclic.executionPlan.workItems[0]!.dependsOn = ['verify'];
		expect(validatePortableContentData('proposal', cyclic).ok).toBe(false);
	});
	it('rejects retired work-product and dependency taxonomies', () => {
		const value = proposal() as ReturnType<typeof proposal> & { executionPlan: { workItems: Array<Record<string, unknown>> } };
		value.executionPlan.workItems[0]!.produces = [{ outputType: 'specialized-output' }];
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
