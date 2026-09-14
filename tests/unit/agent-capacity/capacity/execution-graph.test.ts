import { describe, expect, it } from 'vitest';
import { validateExecutionGraph, type ExecutionEdge, type ExecutionNode } from '../../../../src/capacity/agents/agent-capacity.ts';

const digest = `sha256:${'a'.repeat(64)}`;
const sourceRef = { store: 'treedx' as const, model: 'proposal', id: 'proposal-1', revision: 1, digest };
const permissions = { content: { read: ['proposal' as const, 'decision' as const], write: [] }, tools: ['source.read' as const] };

function node(id: string): ExecutionNode {
	return {
		schemaVersion: 'treeseed.execution-node/v1', id, teamId: 'team-1', projectId: 'project-1', workItemId: id,
		kind: 'acting', pairRole: 'actor', sourceRef, authorityRefs: [], ruleRevision: 1, nodeRevision: 1, agentClass: 'engineer',
		status: 'ready', estimate: { minimumSeconds: 10, expectedSeconds: 20, maximumSeconds: 30 }, requiredCapabilities: [],
		requestedPermissions: permissions, workspace: 'git', acceptanceCriteria: ['Tests pass.'], maximumReviewCycles: 2,
		graphRevisionCreated: 1, graphRevisionUpdated: 1,
	};
}

function edge(fromNodeId: string, toNodeId: string): ExecutionEdge {
	return { schemaVersion: 'treeseed.execution-edge/v1', id: `${fromNodeId}-to-${toNodeId}`, teamId: 'team-1', fromNodeId, toNodeId, provenance: 'work-item', graphRevisionCreated: 1 };
}

describe('living execution graph contracts', () => {
	it('accepts normalized nodes and edges without embedded output or assignment state', () => {
		expect(validateExecutionGraph([node('actor-a'), node('actor-b')], [edge('actor-a', 'actor-b')])).toEqual({ ok: true, diagnostics: [] });
	});

	it('rejects cycles, missing endpoints, and duplicate identities', () => {
		const nodes = [node('actor-a'), node('actor-b'), node('actor-b')];
		const result = validateExecutionGraph(nodes, [edge('actor-a', 'actor-b'), edge('actor-b', 'actor-a'), edge('missing', 'actor-a')]);
		expect(result.diagnostics.map(({ code }) => code)).toEqual(expect.arrayContaining(['execution_node_duplicate', 'execution_edge_endpoint_missing', 'execution_graph_cycle']));
	});

	it('requires condition-only and assignable-only fields', () => {
		const condition = { ...node('condition'), kind: 'condition' as const, pairRole: null, condition: { conditionType: 'lifecycle' as const, subjectRef: sourceRef, expectedState: 'workday-closing' } };
		expect(validateExecutionGraph([condition], []).ok).toBe(false);
		for (const key of ['agentClass', 'estimate', 'requiredCapabilities', 'requestedPermissions', 'workspace'] as const) delete condition[key];
		expect(validateExecutionGraph([condition], []).ok).toBe(true);
	});

	it('rejects retired graph duplication fields', () => {
		const legacy = { ...node('legacy'), activeAssignmentId: 'assignment-1', blockingReasons: ['waiting'], produces: [] };
		expect(validateExecutionGraph([legacy], []).ok).toBe(false);
	});
});
