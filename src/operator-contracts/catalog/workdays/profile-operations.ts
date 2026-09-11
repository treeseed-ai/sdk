import { z } from 'zod';
import { defineOperation } from '../../operation-builder.ts';

const team = z.object({ teamId: z.string().min(1) }).strict();
const empty = z.object({}).strict();
const output = z.record(z.unknown());
const read = (operationId: 'workdays.profiles.list' | 'workdays.profiles.show', path: `/v1/${string}`, parameters: z.AnyZodObject, query: z.AnyZodObject, pagination: 'cursor' | 'none') => defineOperation({
	operationId, description: 'Read accepted repository workday profile generations.', rest: { method: 'GET', path }, parameters: `treeseed.${operationId}.parameters/v1`,
	capability: 'workdays.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli'], cacheScope: 'principal', pagination,
}, { path: parameters, query, body: z.undefined(), output });

export const WORKDAY_PROFILE_OPERATIONS = {
	profilesList: read('workdays.profiles.list', '/v1/teams/{teamId}/workday-profiles', team,
		z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().optional(), status: z.enum(['active', 'archived', 'superseded']).optional() }).strict(), 'cursor'),
	profilesShow: read('workdays.profiles.show', '/v1/teams/{teamId}/workday-profiles/{profileId}', team.extend({ profileId: z.string().min(1) }), empty, 'none'),
	profilesReconcile: defineOperation({ operationId: 'workdays.profiles.reconcile', description: 'Reconcile a bound repository profile after exact successful source verification.',
		rest: { method: 'POST', path: '/v1/teams/{teamId}/projects/{projectId}/workday-profiles/reconcile' }, parameters: 'treeseed.workdays.profiles.reconcile.parameters/v1',
		capability: 'workdays.execute', authentication: 'oauth', oauthScopes: ['treeseed:execution'], kind: 'mutation', riskClass: 'authority', confirmation: 'input_required', surfaces: ['rest', 'cli'], cacheScope: 'none', pagination: 'none',
	}, { path: team.extend({ projectId: z.string().min(1) }), query: empty, body: empty, output }),
};
