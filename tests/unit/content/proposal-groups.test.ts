import { describe, expect, it } from 'vitest';
import { validateAgentDefinitionModel } from '../../../src/agent-capacity/validation/agent-definition-schema.ts';
import { describeContentFrontmatterContract, validatePortableContentData } from '../../../src/content/validation/index.ts';

const agent = {
	schemaVersion: 'treeseed.agent/v1', id: 'ui/engineer', name: 'UI Engineer', agentClass: 'engineer',
	purpose: 'Implement reusable UI components for the portfolio.', responsibilities: ['Implement accepted UI work.'],
	capabilities: ['code-change'], context: { include: ['assignment-subject'] },
	activityProfiles: { planning: { handler: 'writer', permissions: {
		content: { read: ['proposal'], write: ['proposal'] }, tools: ['source.read'],
	}, prompt: { system: 'Plan useful reusable UI work through the governed proposal workflow.' } } },
};
const proposal = {
	schemaVersion: 'treeseed.proposal/v1', id: 'complete-activity-snapshots', projectId: 'ui',
	title: 'Support complete scoped activity snapshots in the UI',
	request: 'Replace complete scoped snapshots while retaining incremental activity updates.', status: 'draft',
};

describe('proposal group membership', () => {
	it('preserves shared team and occupation groups independently of the single agent class', () => {
		const groupIds = ['portfolio-atlas', 'service-design'];
		const member = { ...agent, groupIds }, grouped = { ...proposal, groupIds };
		const held = structuredClone({ member, grouped });
		expect(validateAgentDefinitionModel(member)).toMatchObject({ ok: true, data: member });
		expect(validatePortableContentData('proposal', grouped)).toMatchObject({ ok: true, data: grouped });
		expect({ member, grouped }).toEqual(held);
	});

	it('retains historical ungrouped records without inventing group membership', () => {
		expect(validateAgentDefinitionModel(agent)).toMatchObject({ ok: true, data: agent });
		expect(validatePortableContentData('proposal', proposal)).toMatchObject({ ok: true, data: proposal });
		for (const data of [agent, proposal]) expect(data).not.toHaveProperty('groupIds');
	});

	it('rejects malformed and duplicate group identifiers and individual proposal targets', () => {
		for (const groupIds of [null, 'portfolio-atlas', [''], [' '], ['bad group'], ['portfolio-atlas', 'portfolio-atlas'], [1]]) {
			expect(validateAgentDefinitionModel({ ...agent, groupIds }).ok).toBe(false);
			expect(validatePortableContentData('proposal', { ...proposal, groupIds }).ok).toBe(false);
		}
		for (const extra of [{ agentClass: ['engineer', 'reviewer'] }, { classes: ['engineer'] }, { topics: ['atlas-chat'] }]) {
			expect(validateAgentDefinitionModel({ ...agent, ...extra }).ok).toBe(false);
		}
		for (const extra of [{ agentIds: ['ui/engineer'] }, { agentSlugs: ['engineer'] }, { group_ids: ['portfolio-atlas'] }]) {
			expect(validatePortableContentData('proposal', { ...proposal, ...extra }).ok).toBe(false);
		}
	});

	it('describes the same group field for machine authoring of agents and proposals', () => {
		for (const model of ['agent', 'proposal'] as const) {
			expect(describeContentFrontmatterContract(model)).toMatchObject({ fields: {
				groupIds: { required: model === 'proposal', type: 'array', items: { type: 'string', minLength: 1, maxLength: 200 } },
			} });
		}
		expect(describeContentFrontmatterContract('proposal', 'treeseed.proposal/v1').fields.groupIds).toMatchObject({ required: false });
	});
});
