import { z } from 'zod';
import { defineOperation } from '../operation-builder.ts';
import type { ControlPlaneOperationDescriptor } from '../control-plane-operation.ts';

const empty = z.object({}).strict();
const none = z.undefined();
const record = z.record(z.unknown());

function teamOperation<T extends z.ZodRawShape>(operationId: `${string}.${string}`, method: 'DELETE' | 'GET' | 'POST' | 'PUT', path: `/v1/${string}`, pathShape: T,
	options: { risk?: ControlPlaneOperationDescriptor['riskClass']; pagination?: ControlPlaneOperationDescriptor['pagination']; redactedPaths?: string[]; capability?: string; concurrency?: boolean } = {}) {
	const kind = method === 'GET' ? 'read' : 'mutation';
	const riskClass = options.risk ?? 'ordinary';
	return defineOperation({ operationId, description: `${kind === 'read' ? 'Read' : 'Apply'} ${operationId}.`, rest: { method, path },
		parameters: `treeseed.${operationId}.parameters/v1`, capability: options.capability ?? (kind === 'read' ? 'providers.read' : 'providers.write'), authentication: 'oauth',
		oauthScopes: kind === 'read' ? ['treeseed:read'] : ['treeseed:admin'], kind, riskClass, confirmation: riskClass === 'ordinary' ? 'never' : 'input_required',
		surfaces: ['rest', 'cli'], cacheScope: kind === 'read' ? 'principal' : 'none', pagination: options.pagination ?? 'none', concurrencyRequired: options.concurrency ?? ['DELETE', 'PUT'].includes(method),
		redactedPaths: options.redactedPaths }, { path: z.object(pathShape).strict(), query: kind === 'read' ? record : empty, body: kind === 'read' ? none : record, output: record });
}

const providerPublish = defineOperation({ operationId: 'providers.environment.profiles.publish', description: 'Publish a value-free provider environment profile descriptor.',
	rest: { method: 'PUT', path: '/v1/provider/environment-profiles/{profileId}' }, parameters: 'treeseed.providers.environment.profiles.publish.parameters/v1',
	capability: 'providers.execute', authentication: 'provider', oauthScopes: [], kind: 'mutation', riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'],
	cacheScope: 'none', pagination: 'none' }, { path: z.object({ profileId: z.string().min(1) }).strict(), query: empty, body: record, output: record });

export const PROVIDER_ENVIRONMENT_OPERATIONS = {
	registrationCode: {
		status: teamOperation('providers.registration.code.status', 'GET', '/v1/teams/{teamId}/capacity-provider-registration-code', { teamId: z.string().min(1) }),
		reveal: teamOperation('providers.registration.code.reveal', 'POST', '/v1/teams/{teamId}/capacity-provider-registration-code/reveal', { teamId: z.string().min(1) }, { risk: 'credential', redactedPaths: ['output.registrationCode'] }),
		rotate: teamOperation('providers.registration.code.rotate', 'POST', '/v1/teams/{teamId}/capacity-provider-registration-code/rotate', { teamId: z.string().min(1) }, { risk: 'credential', redactedPaths: ['output.registrationCode'], concurrency: true }),
	},
	environmentProfiles: {
		list: teamOperation('providers.environment.profiles.list', 'GET', '/v1/teams/{teamId}/capacity-providers/{providerId}/environment-profiles', { teamId: z.string().min(1), providerId: z.string().min(1) }, { pagination: 'cursor' }),
		show: teamOperation('providers.environment.profiles.show', 'GET', '/v1/teams/{teamId}/capacity-providers/{providerId}/environment-profiles/{profileId}', { teamId: z.string().min(1), providerId: z.string().min(1), profileId: z.string().min(1) }),
		publish: providerPublish,
	},
	environmentGrants: {
		show: teamOperation('providers.environment.grants.show', 'GET', '/v1/teams/{teamId}/assignments/{assignmentId}/environment-grant', { teamId: z.string().min(1), assignmentId: z.string().min(1) }),
		put: teamOperation('providers.environment.grants.put', 'PUT', '/v1/teams/{teamId}/assignments/{assignmentId}/environment-grant', { teamId: z.string().min(1), assignmentId: z.string().min(1) }, { risk: 'authority' }),
		revoke: teamOperation('providers.environment.grants.revoke', 'DELETE', '/v1/teams/{teamId}/assignments/{assignmentId}/environment-grant', { teamId: z.string().min(1), assignmentId: z.string().min(1) }, { risk: 'destructive' }),
	},
} as const;
