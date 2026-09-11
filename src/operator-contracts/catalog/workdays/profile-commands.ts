import type { CommandLeafDescriptor } from '../../command-tree.ts';
type Execution = CommandLeafDescriptor['execution'];
const team = { target: 'path', field: 'teamId', source: 'context', name: 'team', required: true, transform: 'identity' } as const;
export const WORKDAY_PROFILE_COMMAND_BINDINGS: Record<string, Execution> = {
	'workdays profiles list': { kind: 'operation', operationId: 'workdays.profiles.list', input: [team,
		{ target: 'query', field: 'limit', source: 'option', name: 'limit', transform: 'integer' },
		{ target: 'query', field: 'cursor', source: 'option', name: 'cursor', transform: 'identity' },
		{ target: 'query', field: 'status', source: 'option', name: 'status', transform: 'identity' }] },
	'workdays profiles show': { kind: 'operation', operationId: 'workdays.profiles.show', input: [team,
		{ target: 'path', field: 'profileId', source: 'argument', name: 'profile', required: true, transform: 'identity' }] },
	'workdays profiles reconcile': { kind: 'operation', operationId: 'workdays.profiles.reconcile', input: [team,
		{ target: 'path', field: 'projectId', source: 'argument', name: 'project', required: true, transform: 'identity' }] },
};
