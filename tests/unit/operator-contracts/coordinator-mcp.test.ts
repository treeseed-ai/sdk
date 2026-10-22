import { describe, expect, it } from 'vitest';
import { buildMcpCatalog, CONTROL_PLANE_CATALOG, CONTROL_PLANE_OPERATION_LIST } from '../../../src/operator-contracts/index.ts';

describe('coordinator MCP boundary', () => {
	it('keeps storage, service, account and project administration off both MCP surfaces', () => {
		const excluded = CONTROL_PLANE_OPERATION_LIST.filter(({ descriptor: d }) =>
			d.operationId.startsWith('treedx.') || d.operationId.startsWith('services.')
			|| d.operationId.startsWith('research.') || d.operationId.startsWith('knowledge.shares.')
			|| d.operationId.startsWith('accounts.') || d.operationId === 'teams.create'
			|| d.operationId === 'teams.profile.show' || d.operationId === 'feedback.create'
			|| d.operationId.startsWith('discussions.')
			|| ['projects.create', 'projects.update', 'projects.archive', 'projects.restore'].includes(d.operationId));
		expect(excluded.length).toBeGreaterThan(80);
		for (const { descriptor } of excluded) {
			expect(descriptor.surfaces, descriptor.operationId).not.toContain('mcp_tool');
			expect(descriptor.surfaces, descriptor.operationId).not.toContain('mcp_resource');
			if (descriptor.rest) expect(descriptor.surfaces, descriptor.operationId).toContain('rest');
		}
	});

	it('retains governed team planning, communication, admission and evaluation', () => {
		const catalog = buildMcpCatalog(CONTROL_PLANE_CATALOG.operations);
		const tools = catalog.tools.map(tool => tool.name);
		expect(tools).toEqual(expect.arrayContaining([
			'agents.team.clone.plan', 'agents.team.clone.apply', 'communications.send',
			'communications.topics.timeline', 'governance.proposals.create',
			'workdays.plan', 'workdays.start', 'workdays.stop', 'execution.graph.show',
			'assignments.explain', 'assignments.recover', 'capacity.usage', 'providers.status',
		]));
		const exposed = CONTROL_PLANE_CATALOG.operations.filter(d => d.surfaces.includes('mcp_tool') || d.surfaces.includes('mcp_resource'));
		for (const descriptor of exposed) {
			expect(descriptor.authentication, descriptor.operationId).toBe('oauth');
			expect(descriptor.oauthScopes, descriptor.operationId).not.toContain('treeseed:admin');
		}
		// MCP is a projection of the same descriptors, never a generic dispatch API.
		expect(tools.some(name => /invoke|batch|provider.*lease|provider.*settle/u.test(name))).toBe(false);
	});
});
