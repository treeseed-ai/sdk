import { z } from 'zod';
import { defineOperation } from '../../operation-builder.ts';

const record = z.record(z.unknown()), team = { teamId: z.string().min(1) };
function operation(operationId: `${string}.${string}`, method: 'GET' | 'POST', path: `/v1/${string}`,
	pathShape: z.ZodRawShape, surfaces: Array<'rest' | 'cli' | 'mcp_tool' | 'mcp_resource'>, pagination: 'none' | 'cursor' = 'none', queryShape: z.ZodRawShape = {}) {
	const mutation = method === 'POST';
	return defineOperation({ operationId, description: `${mutation ? 'Apply' : 'Read'} ${operationId}.`, rest: { method, path },
		parameters: `treeseed.${operationId}.parameters/v1`, capability: mutation ? 'assignments.execute' : 'assignments.read', authentication: 'oauth',
		oauthScopes: mutation ? ['treeseed:execution'] : ['treeseed:read'], kind: mutation ? 'mutation' : 'read', riskClass: 'ordinary', confirmation: 'never',
		surfaces, cacheScope: mutation ? 'none' : 'principal', pagination },
	{ path: z.object(pathShape).strict(), query: z.object(queryShape).strict(), body: mutation ? record : z.undefined(), output: record });
}

export const EXECUTION_OPERATIONS = {
	graph: {
		show: operation('execution.graph.show', 'GET', '/v1/teams/{teamId}/execution-graph', team, ['rest', 'cli', 'mcp_tool', 'mcp_resource'], 'none', { projectId: z.string().optional(), decisionId: z.string().optional() }),
		watch: operation('execution.graph.watch', 'GET', '/v1/teams/{teamId}/execution-graph/events', team, ['rest', 'cli', 'mcp_tool'], 'cursor', { cursor: z.string().optional(), waitSeconds: z.coerce.number().int().positive().optional() }),
	},
	nodes: {
		show: operation('execution.nodes.show', 'GET', '/v1/teams/{teamId}/execution-nodes/{nodeId}', { ...team, nodeId: z.string().min(1) }, ['rest', 'cli', 'mcp_resource']),
		explain: operation('execution.nodes.explain', 'GET', '/v1/teams/{teamId}/execution-nodes/{nodeId}/explanation', { ...team, nodeId: z.string().min(1) }, ['rest', 'cli', 'mcp_tool', 'mcp_resource']),
	},
	reconcile: operation('execution.reconcile', 'POST', '/v1/teams/{teamId}/execution-graph/reconcile', team, ['rest', 'cli', 'mcp_tool']),
	assignments: operation('execution.assignments.list', 'GET', '/v1/teams/{teamId}/execution-assignments', team, ['rest', 'cli', 'mcp_tool'], 'cursor', { status: z.string().optional(), limit: z.coerce.number().int().positive().optional(), cursor: z.string().optional() }),
} as const;
