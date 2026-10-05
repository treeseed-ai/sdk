import { z } from 'zod';
import { agentTeamClonePlanSchema,agentTeamCloneReceiptSchema,agentTeamCloneRequestSchema } from '../../../agent-capacity/contracts/operations/agent-team-clone.ts';
import { defineOperation } from '../../operation-builder.ts';

const path = z.object({ teamId: z.string().trim().min(1) }).strict();
const empty = z.object({}).strict();

export const AGENT_TEAM_CLONE_OPERATIONS = {
	plan: defineOperation({
		operationId: 'agents.team.clone.plan', description: 'Plan an exact agent-team clone into selected projects.',
		rest: { method: 'POST', path: '/v1/teams/{teamId}/agent-team-clones/plan' },
		parameters: 'treeseed.agents.team.clone.plan.parameters/v1', capability: 'agents.read',
		authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never',
		surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'none', pagination: 'none', idempotencyRequired: false,
	}, { path, query: empty, body: agentTeamCloneRequestSchema, output: agentTeamClonePlanSchema }),
	apply: defineOperation({
		operationId: 'agents.team.clone.apply', description: 'Apply an unchanged exact agent-team clone plan.',
		rest: { method: 'POST', path: '/v1/teams/{teamId}/agent-team-clones/apply' },
		parameters: 'treeseed.agents.team.clone.apply.parameters/v1', capability: 'agents.write',
		authentication: 'oauth', oauthScopes: ['treeseed:projects:write'], kind: 'mutation', riskClass: 'authority', confirmation: 'input_required',
		surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'none', pagination: 'none', idempotencyRequired: true,
	}, { path, query: empty, body: agentTeamClonePlanSchema, output: agentTeamCloneReceiptSchema }),
} as const;
