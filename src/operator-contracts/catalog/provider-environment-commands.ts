import type { CommandExecutionBinding, CommandLeafDescriptor, CommandNodeDescriptor } from '../command-tree.ts';

const plan = { name: '--plan', description: 'Return the exact proposed outcome without mutation.', type: 'boolean' as const };
const local = (handlerId: `local.${string}`): CommandExecutionBinding => ({ kind: 'local', handlerId });
const operation = (operationId: `${string}.${string}`, input: Extract<CommandExecutionBinding, { kind: 'operation' }>['input']): CommandExecutionBinding => ({ kind: 'operation', operationId, input });
const path = (field: string, source: 'argument' | 'context', name: string, required = true) => ({ target: 'path' as const, field, source, name, required, transform: 'identity' as const });

export const PROVIDER_ENVIRONMENT_COMMAND_BINDINGS: Record<string, CommandExecutionBinding> = {
	'host provider environment list': local('local.host.provider.environment.list'),
	'host provider environment show': local('local.host.provider.environment.show'),
	'host provider environment status': local('local.host.provider.environment.status'),
	'host provider environment set': local('local.host.provider.environment.set'),
	'host provider environment import': local('local.host.provider.environment.import'),
	'host provider environment unset': local('local.host.provider.environment.unset'),
	'host provider environment rotate': local('local.host.provider.environment.rotate'),
	'host provider environment verify': local('local.host.provider.environment.verify'),
	'providers registration code status': operation('providers.registration.code.status', [path('teamId', 'context', 'team')]),
	'providers registration code reveal': operation('providers.registration.code.reveal', [path('teamId', 'context', 'team')]),
	'providers registration code rotate': operation('providers.registration.code.rotate', [path('teamId', 'context', 'team')]),
	'providers environments list': operation('providers.environment.profiles.list', [path('teamId', 'context', 'team'), path('providerId', 'argument', 'provider'), { target: 'query', field: 'status', source: 'option', name: 'status', transform: 'identity' }, { target: 'query', field: 'limit', source: 'option', name: 'limit', transform: 'integer' }, { target: 'query', field: 'cursor', source: 'option', name: 'cursor', transform: 'identity' }]),
	'providers environments show': operation('providers.environment.profiles.show', [path('teamId', 'context', 'team'), path('providerId', 'argument', 'provider'), path('profileId', 'argument', 'profile')]),
	'providers environments grant': operation('providers.environment.grants.put', [path('teamId', 'context', 'team'), path('assignmentId', 'argument', 'assignment'), { target: 'body', field: 'file', source: 'option', name: 'input', required: true, transform: 'identity' }]),
	'providers environments revoke': operation('providers.environment.grants.revoke', [path('teamId', 'context', 'team'), path('assignmentId', 'argument', 'assignment')]),
};

const profileArguments = [{ name: 'profile', description: 'Provider-local environment profile.', required: true }];
const valueArguments = [...profileArguments, { name: 'name', description: 'Environment variable name.', required: true }];
const localMutation = (segment: 'rotate' | 'set' | 'unset', confirmation: 'credential' | 'destructive', description: string): CommandLeafDescriptor => ({
	segment, description, kind: 'mutation', arguments: valueArguments, options: [plan, ...(segment === 'unset' ? [] : [{ name: '--stdin' as const, description: 'Read the replacement value from standard input instead of the hidden prompt.', type: 'boolean' as const }])],
	authorization: { capability: 'host.provider.environment.write', confirmation }, resultSchemaId: 'treeseed.provider-environment-profile/v1', execution: local(`local.host.provider.environment.${segment}`),
});

export function hostProviderEnvironmentBranch(): CommandNodeDescriptor {
	const read = (segment: 'show' | 'status' | 'verify'): CommandLeafDescriptor => ({ segment, description: `${segment} a provider-local environment profile.`, kind: 'read', arguments: profileArguments, resultSchemaId: 'treeseed.provider-environment-profile/v1', execution: local(`local.host.provider.environment.${segment}`) });
	return { nodeType: 'branch', segment: 'environment', description: 'Provider-local environment profile operations.', children: [
		{ nodeType: 'leaf', segment: 'list', description: 'List provider-local environment profiles without values.', kind: 'read', resultSchemaId: 'treeseed.provider-environment-profile-page/v1', execution: local('local.host.provider.environment.list') },
		{ nodeType: 'leaf', ...read('show') }, { nodeType: 'leaf', ...read('status') }, { nodeType: 'leaf', ...localMutation('set', 'credential', 'Set one provider-local environment value through a hidden prompt or standard input.') },
		{ nodeType: 'leaf', segment: 'import', description: 'Import provider-local environment values from an env file.', kind: 'mutation', arguments: profileArguments,
			options: [plan, { name: '--env-file', description: 'Local env file whose values remain under provider custody.', type: 'string', required: true }], authorization: { capability: 'host.provider.environment.write', confirmation: 'credential' }, resultSchemaId: 'treeseed.provider-environment-profile/v1', execution: local('local.host.provider.environment.import') },
		{ nodeType: 'leaf', ...localMutation('unset', 'destructive', 'Remove one provider-local environment value.') }, { nodeType: 'leaf', ...localMutation('rotate', 'credential', 'Replace one provider-local environment value and advance its generation.') }, { nodeType: 'leaf', ...read('verify') },
	] };
}

export function providerEnvironmentBranches(): CommandNodeDescriptor[] {
	const remote = { kind: 'unavailable' as const, code: 'standards_migration_not_enabled', reason: 'Execution binding is attached from the canonical operation map.' };
	const leaf = (segment: string, kind: 'read' | 'mutation', arguments_: CommandLeafDescriptor['arguments'], confirmation: 'never' | 'credential' | 'authority' | 'destructive' = 'never', options: CommandLeafDescriptor['options'] = kind === 'mutation' ? [plan] : undefined): CommandNodeDescriptor => ({ nodeType: 'leaf', segment, description: `${segment} provider environment authority.`, kind, arguments: arguments_, options, authorization: kind === 'mutation' ? { capability: `command.${segment}`, confirmation } : undefined, resultSchemaId: `treeseed.command.${segment}/v1`, execution: remote });
	return [
		{ nodeType: 'branch', segment: 'registration', description: 'Team provider registration operations.', children: [{ nodeType: 'branch', segment: 'code', description: 'Team provider registration-code operations.', children: [leaf('status', 'read', undefined), leaf('reveal', 'mutation', undefined, 'credential'), leaf('rotate', 'mutation', undefined, 'credential')] }] },
		{ nodeType: 'branch', segment: 'environments', description: 'Provider environment descriptor and grant operations.', children: [leaf('list', 'read', [{ name: 'provider', description: 'Provider identity.', required: true }]), leaf('show', 'read', [{ name: 'provider', description: 'Provider identity.', required: true }, { name: 'profile', description: 'Profile identity.', required: true }]), leaf('grant', 'mutation', [{ name: 'assignment', description: 'Assignment identity.', required: true }], 'authority', [plan, { name: '--input', description: 'Digest-bound environment grant document.', type: 'string', required: true }]), leaf('revoke', 'mutation', [{ name: 'assignment', description: 'Assignment identity.', required: true }], 'destructive')] },
	];
}
