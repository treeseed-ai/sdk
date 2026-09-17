import { z } from 'zod';
import { defineOperation } from '../../operation-builder.ts';
import { workdayPolicySchema, workdayProfileSchema } from '../../../agent-capacity/contracts/capacity/workdays/workday-allocation.ts';

const team = z.object({ teamId: z.string().min(1) }).strict();
const empty = z.object({}).strict();
const output = z.record(z.unknown());
const read = (operationId: 'workdays.profiles.list' | 'workdays.profiles.show', path: `/v1/${string}`, parameters: z.AnyZodObject, query: z.AnyZodObject, pagination: 'cursor' | 'none') => defineOperation({
	operationId, description: 'Read the team-owned canonical workday allocation policy.', rest: { method: 'GET', path }, parameters: `treeseed.${operationId}.parameters/v1`,
	capability: 'workdays.read', authentication: 'oauth', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest', 'cli'], cacheScope: 'principal', pagination,
}, { path: parameters, query, body: z.undefined(), output });

export const WORKDAY_PROFILE_OPERATIONS = {
	profilesList: read('workdays.profiles.list', '/v1/teams/{teamId}/workday-profiles', team,
		z.object({ limit: z.coerce.number().int().min(1).max(100).optional(), cursor: z.string().optional() }).strict(), 'cursor'),
	profilesShow: read('workdays.profiles.show', '/v1/teams/{teamId}/workday-profiles/{profileId}', team.extend({ profileId: z.string().min(1) }), empty, 'none'),
	profilesUpdate: defineOperation({ operationId: 'workdays.profiles.update', description: 'Replace the team default policy without changing existing workday snapshots.',
		rest: { method: 'PUT', path: '/v1/teams/{teamId}/workday-profiles/{profileId}' }, parameters: 'treeseed.workdays.profiles.update.parameters/v1', concurrencyRequired: true,
		capability: 'workdays.execute', authentication: 'oauth', oauthScopes: ['treeseed:execution'], kind: 'mutation', riskClass: 'authority', confirmation: 'input_required', surfaces: ['rest', 'cli'], cacheScope: 'none', pagination: 'none',
	}, { path: team.extend({ profileId: z.literal('default') }), query: empty, body: z.object({ policy: workdayPolicySchema }).strict(), output: workdayProfileSchema }),
};
