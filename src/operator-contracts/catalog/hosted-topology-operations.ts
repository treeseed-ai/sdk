import { z } from 'zod';
import { hostedTopologyDeclarationSchema, hostedTopologyPlanSchema, hostedTopologyReceiptSchema, hostedTopologyRollbackExecutionSchema } from '../../deployment/hosted-topology.ts';
import { defineOperation } from '../operation-builder.ts';

const teamPath = z.object({ teamId: z.string().min(1) }).strict();
const empty = z.object({}).strict();
const none = z.undefined();
const operationReceipt = z.record(z.unknown());

export const HOSTED_TOPOLOGY_OPERATIONS = {
	plan: defineOperation({
		operationId: 'infrastructure.topology.plan', description: 'Plan exact hosted topology reconciliation from authoritative provider observations.',
		rest: { method: 'POST', path: '/v1/teams/{teamId}/infrastructure/topology/plan' }, parameters: 'treeseed.infrastructure.topology.plan.parameters/v1',
		capability: 'infrastructure.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never',
		surfaces: ['rest', 'cli'], cacheScope: 'none', pagination: 'none', idempotencyRequired: false,
	}, { path: teamPath, query: empty, body: z.object({ declaration: hostedTopologyDeclarationSchema }).strict(), output: operationReceipt }),
	apply: defineOperation({
		operationId: 'infrastructure.topology.apply', description: 'Apply an exact agent-authorized hosted topology plan through the operations runner.',
		rest: { method: 'POST', path: '/v1/teams/{teamId}/infrastructure/topology/apply' }, parameters: 'treeseed.infrastructure.topology.apply.parameters/v1',
		capability: 'infrastructure.write', authentication: 'oauth', oauthScopes: ['treeseed:admin'], kind: 'mutation', riskClass: 'authority', confirmation: 'input_required',
		surfaces: ['rest', 'cli'], cacheScope: 'none', pagination: 'none', concurrencyRequired: true,
	}, { path: teamPath, query: empty, body: z.object({ plan: hostedTopologyPlanSchema }).strict(), output: operationReceipt }),
	status: defineOperation({
		operationId: 'infrastructure.topology.status', description: 'Read the latest authoritative hosted topology receipt and operation state.',
		rest: { method: 'GET', path: '/v1/teams/{teamId}/infrastructure/topology' }, parameters: 'treeseed.infrastructure.topology.status.parameters/v1',
		capability: 'infrastructure.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never',
		surfaces: ['rest', 'cli'], cacheScope: 'principal', pagination: 'none',
	}, { path: teamPath, query: empty, body: none, output: z.object({ receipt: hostedTopologyReceiptSchema.nullable(), operation: operationReceipt.nullable() }).strict() }),
	rollback: defineOperation({
		operationId: 'infrastructure.topology.rollback', description: 'Restore exact prior hosted topology lineage from a known-good receipt.',
		rest: { method: 'POST', path: '/v1/teams/{teamId}/infrastructure/topology/rollback' }, parameters: 'treeseed.infrastructure.topology.rollback.parameters/v1',
		capability: 'infrastructure.write', authentication: 'oauth', oauthScopes: ['treeseed:admin'], kind: 'mutation', riskClass: 'destructive', confirmation: 'input_required',
		surfaces: ['rest', 'cli'], cacheScope: 'none', pagination: 'none', concurrencyRequired: true,
	}, { path: teamPath, query: empty, body: z.object({ execution: hostedTopologyRollbackExecutionSchema,
		sourcePlan: hostedTopologyPlanSchema,
		targetPlan: hostedTopologyPlanSchema }).strict(), output: operationReceipt }),
} as const;
