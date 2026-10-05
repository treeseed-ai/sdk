import { describe, expect, it } from 'vitest';
import { compareMcp, type McpContractModel } from '../../../src/standards/mcp/index.ts';

function model(): McpContractModel {
	return {
		schemaVersion: 1,
		protocolVersion: '2026-07-28',
		tools: {
			'projects.list': { inputSchema: { type: 'object' }, outputSchema: { type: 'object' }, requiredScopes: ['treeseed:read'], riskClass: 'ordinary' },
		},
		resources: {
			'treeseed://projects/{projectId}': { uriTemplate: 'treeseed://projects/{projectId}', operationId: 'projects.show', subscribable: true },
		},
		prompts: {
			operate: { argumentSchema: { type: 'object' }, requiredScopes: ['treeseed:read'] },
		},
	};
}

describe('MCP standards compatibility', () => {
	it('classifies additions as compatible', () => {
		const candidate = model();
		candidate.tools['projects.show'] = { ...candidate.tools['projects.list']! };
		expect(compareMcp(model(), candidate).classification).toBe('compatible_addition');
	});

	it('classifies removals and authority escalation as breaking', () => {
		const removed = model();
		delete removed.resources['treeseed://projects/{projectId}'];
		expect(compareMcp(model(), removed).findings.map((entry) => entry.code)).toContain('mcp_resource_removed');

		const escalated = model();
		escalated.tools['projects.list']!.requiredScopes.push('treeseed:admin');
		expect(compareMcp(model(), escalated).findings.map((entry) => entry.code)).toContain('mcp_tool_scope_escalated');
	});
});
