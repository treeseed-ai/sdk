import { z } from 'zod';
import { capabilityDefinitionSchema, capabilityOntologySchema } from '../../capacity-provider/capability-ontology.ts';
import { defineOperation } from '../operation-builder.ts';

const none = z.undefined(), empty = z.object({}).strict();
export function capabilityOntologyOperations() {
	return {
		list: defineOperation({ operationId: 'capabilities.list', description: 'List standardized execution capabilities from the active ontology generation.', rest: { method: 'GET', path: '/v1/capability-ontology' }, parameters: 'treeseed.capabilities.list.parameters/v1', capability: 'capabilities.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest','cli','mcp_tool','mcp_resource'], cacheScope: 'principal', pagination: 'cursor' }, {
			path: empty, query: z.object({ family: z.string().optional(), status: z.enum(['active','deprecated','revoked']).optional(), namespace: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).optional(), cursor: z.string().optional() }).strict(), body: none,
			output: z.object({ generation: z.number().int().positive(), ontologyDigest: z.string(), items: z.array(capabilityDefinitionSchema), nextCursor: z.string().nullable() }).strict(),
		}),
		show: defineOperation({ operationId: 'capabilities.show', description: 'Read one exact standardized execution capability.', rest: { method: 'GET', path: '/v1/capability-ontology/{capabilityId}' }, parameters: 'treeseed.capabilities.show.parameters/v1', capability: 'capabilities.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest','cli','mcp_tool','mcp_resource'], cacheScope: 'principal', pagination: 'none' }, {
			path: z.object({ capabilityId: z.string().min(1) }).strict(), query: z.object({ version: z.string().optional() }).strict(), body: none, output: capabilityDefinitionSchema,
		}),
		generation: defineOperation({ operationId: 'capabilities.generation.show', description: 'Read the complete active immutable capability ontology.', rest: { method: 'GET', path: '/v1/capability-ontology/generations/active' }, capability: 'capabilities.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest','mcp_resource'], cacheScope: 'principal', pagination: 'none' }, { path: empty, query: empty, body: none, output: capabilityOntologySchema }),
	};
}
