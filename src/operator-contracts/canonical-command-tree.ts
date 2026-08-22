import type { CommandLeafDescriptor, CommandNodeDescriptor, CommandTreeDescriptor } from './command-tree.ts';

type Execution = CommandLeafDescriptor['execution'];

const unavailable = (reason = 'This capability is not enabled until its control-plane operation is accepted.'): Execution => ({
	kind: 'unavailable',
	code: 'standards_migration_not_enabled',
	reason,
});

const protocol = (handlerId: `protocol.${string}`): Execution => ({ kind: 'protocol', handlerId });
const local = (handlerId: `local.${string}`): Execution => ({ kind: 'local', handlerId });
const field = (target: 'path' | 'query' | 'body', name: string, source: 'argument' | 'context' | 'option', sourceName = name, required = false, transform: 'identity' | 'integer' | 'csv' = 'identity') => ({ target, field: name, source, name: sourceName, required, transform });
const operation = (operationId: `${string}.${string}`, input: ReturnType<typeof field>[] = []): Execution => ({ kind: 'operation', operationId, input });

const operationBindings: Record<string, Execution> = {
	'auth login': protocol('protocol.oauth.device.login'),
	'auth logout': protocol('protocol.oauth.revoke'),
	'auth status': operation('accounts.current.show'),
	'secrets list': local('local.secrets.list'),
	'secrets status': local('local.secrets.status'),
	'secrets unlock': local('local.secrets.unlock'),
	'secrets lock': local('local.secrets.lock'),
	'secrets rotate': local('local.secrets.rotate'),
	'agents list': operation('agents.list', [field('path', 'projectId', 'context', 'project', true)]),
	'agents show': operation('agents.show', [field('path', 'projectId', 'context', 'project', true), field('path', 'agentSlug', 'argument', 'agent', true)]),
	'agents validate': local('local.agents.validate'),
	'agents diff': local('local.agents.diff'),
	'agents classes list': operation('agents.classes.list', [field('path', 'projectId', 'context', 'project', true)]),
	'agents classes show': operation('agents.classes.show', [field('path', 'projectId', 'context', 'project', true), field('path', 'classId', 'argument', 'class', true)]),
	'providers list': operation('services.providers.list'),
	'providers show': operation('services.connections.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'provider', true)]),
	'providers status': operation('services.connections.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'provider', true)]),
	'providers connect': operation('services.connections.create', [field('path', 'teamId', 'context', 'team', true), field('body', 'providerId', 'option', 'provider', true)]),
	'providers disconnect': operation('services.connections.disconnect', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'connection', true), field('body', 'reason', 'option')]),
	'providers credentials status': operation('services.credential.authorities.list', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'connection', true)]),
	'capacity status': operation('capacity.status', [field('path', 'teamId', 'context', 'team', true)]),
	'capacity usage': operation('capacity.usage', [field('path', 'teamId', 'context', 'team', true)]),
	'capacity ledger': operation('capacity.ledger', [field('path', 'teamId', 'context', 'team', true)]),
	'plans list': operation('plans.list', [field('path', 'decisionId', 'option', 'decision', true)]),
	'plans show': operation('plans.show', [field('path', 'capacityPlanId', 'argument', 'plan', true)]),
	'workdays plan': operation('workdays.plan', [field('path', 'teamId', 'context', 'team', true), field('body', 'profile', 'option'), field('body', 'projects', 'option', 'projects', false, 'csv'), field('body', 'start', 'option'), field('body', 'end', 'option'), field('body', 'duration', 'option', 'duration', false, 'integer'), field('body', 'objective', 'option')]),
	'workdays start': operation('workdays.start', [field('path', 'teamId', 'context', 'team', true), field('body', 'preflightId', 'option', 'preflight', true), field('body', 'digest', 'option', 'digest', true)]),
	'workdays list': operation('workdays.list', [field('path', 'teamId', 'context', 'team', true)]),
	'workdays show': operation('workdays.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'runId', 'argument', 'workday', true)]),
	'workdays schedules list': operation('workdays.schedules.list', [field('path', 'teamId', 'context', 'team', true)]),
	'workdays schedules start': operation('workdays.schedules.create', [field('path', 'teamId', 'context', 'team', true), field('body', 'profile', 'option'), field('body', 'projects', 'option', 'projects', false, 'csv'), field('body', 'duration', 'option', 'duration', false, 'integer')]),
	'assignments list': operation('assignments.list', [field('path', 'teamId', 'context', 'team', true)]),
	'assignments show': operation('assignments.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true)]),
	'assignments explain': operation('assignments.explain', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true)]),
	'assignments retry': operation('assignments.retry', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true), field('body', 'reason', 'option')]),
	'assignments cancel': operation('assignments.cancel', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true), field('body', 'reason', 'option')]),
	'status': operation('status.show'),
	'save': unavailable('Unified GitHub-backed save is intentionally fail-closed during this cutover.'),
	'stage': unavailable('Unified GitHub-backed stage is intentionally fail-closed during this cutover.'),
	'release': unavailable('Production release is intentionally fail-closed during this cutover.'),
};

const planOption = { name: '--plan', description: 'Return the exact proposed outcome without mutation.', type: 'boolean' as const };

function leaf(segment: string, kind: 'read' | 'mutation' = 'read', argument?: string, confirmation: 'never' | 'destructive' | 'credential' | 'authority' | 'production' | 'irreversible' = 'never'): CommandNodeDescriptor {
	const value: CommandLeafDescriptor = {
		segment,
		description: `${segment[0]!.toUpperCase()}${segment.slice(1)} the selected resource.`,
		kind,
		arguments: argument ? [{ name: argument, description: `${argument} identity or path.`, required: true }] : undefined,
		options: kind === 'mutation' ? [planOption] : undefined,
		authorization: kind === 'mutation' ? { capability: `command.${segment}`, confirmation } : undefined,
		resultSchemaId: `treeseed.command.${segment}/v1`,
		execution: unavailable(),
	};
	return { nodeType: 'leaf', ...value };
}

function branch(segment: string, children: CommandNodeDescriptor[]): CommandNodeDescriptor {
	return { nodeType: 'branch', segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} operations.`, children };
}

const commandTree: CommandTreeDescriptor = {
	schemaVersion: 'treeseed.command-tree/v1',
	executable: 'trsd',
	commands: [
		branch('auth', [leaf('login', 'mutation', undefined, 'credential'), leaf('logout', 'mutation'), leaf('status')]),
		branch('secrets', [leaf('list'), leaf('status'), leaf('unlock', 'mutation', undefined, 'credential'), leaf('lock', 'mutation'), leaf('rotate', 'mutation', undefined, 'credential')]),
		branch('agents', [
			leaf('list'), leaf('show', 'read', 'agent'), leaf('validate'), leaf('diff'), leaf('diagnose'),
			branch('classes', [leaf('list'), leaf('show', 'read', 'class')]),
			branch('bindings', [leaf('list'), leaf('show', 'read', 'binding'), leaf('explain', 'read', 'binding')]),
		]),
		branch('providers', [
			leaf('list'), leaf('show', 'read', 'provider'), leaf('status', 'read', 'provider'), leaf('diagnose', 'read', 'provider'), leaf('connect', 'mutation', undefined, 'credential'), leaf('disconnect', 'mutation', 'connection', 'destructive'),
			branch('requests', [leaf('list'), leaf('show', 'read', 'request'), leaf('approve', 'mutation', 'request', 'authority'), leaf('reject', 'mutation', 'request', 'authority')]),
			branch('credentials', [leaf('status', 'read', 'connection'), leaf('rotate', 'mutation', 'connection', 'credential'), leaf('revoke', 'mutation', 'connection', 'irreversible')]),
			branch('offers', [leaf('show', 'read', 'connection'), leaf('validate', 'read', 'file'), leaf('plan', 'read', 'file'), leaf('apply', 'mutation', 'file', 'authority')]),
		]),
		branch('capacity', [leaf('status'), leaf('explain'), leaf('usage'), leaf('ledger'), leaf('audit')]),
		branch('plans', [leaf('list'), leaf('show', 'read', 'plan'), leaf('explain', 'read', 'plan'), { nodeType: 'leaf', segment: 'diff', description: 'Compare two API-derived plans.', kind: 'read', arguments: [{ name: 'left', description: 'Left plan identity.', required: true }, { name: 'right', description: 'Right plan identity.', required: true }], resultSchemaId: 'treeseed.command.plans.diff/v1', execution: unavailable() }]),
		branch('workdays', [
			branch('profiles', [leaf('list'), leaf('show', 'read', 'profile'), leaf('validate', 'read', 'file')]),
			leaf('plan', 'mutation'), leaf('start', 'mutation', undefined, 'authority'), leaf('list'), leaf('show', 'read', 'workday'), leaf('watch', 'read', 'workday'), leaf('pause', 'mutation', 'workday', 'authority'), leaf('resume', 'mutation', 'workday', 'authority'), leaf('stop', 'mutation', 'workday', 'destructive'), leaf('cancel', 'mutation', 'workday', 'destructive'),
			branch('schedules', [leaf('list'), leaf('show', 'read', 'schedule'), leaf('plan'), leaf('start', 'mutation', undefined, 'authority'), leaf('pause', 'mutation', 'schedule', 'authority'), leaf('resume', 'mutation', 'schedule', 'authority'), leaf('retire', 'mutation', 'schedule', 'destructive')]),
		]),
		branch('assignments', [leaf('list'), leaf('show', 'read', 'assignment'), leaf('explain', 'read', 'assignment'), leaf('watch', 'read', 'assignment'), leaf('retry', 'mutation', 'assignment', 'authority'), leaf('cancel', 'mutation', 'assignment', 'destructive'), leaf('artifacts', 'read', 'assignment')]),
		leaf('save', 'mutation'), leaf('stage', 'mutation', undefined, 'authority'), leaf('release', 'mutation', undefined, 'production'), leaf('status'), leaf('diagnose'),
	],
};

function attachExecution(nodes: CommandNodeDescriptor[], parent: string[] = []): void {
	for (const node of nodes) {
		const path = [...parent, node.segment];
		if (node.nodeType === 'branch') attachExecution(node.children, path);
		else node.execution = operationBindings[path.join(' ')] ?? node.execution;
	}
}

attachExecution(commandTree.commands);
export const TREESEED_COMMAND_TREE_V1 = commandTree;

export function listCommandPaths(tree: CommandTreeDescriptor = TREESEED_COMMAND_TREE_V1): string[] {
	const paths: string[] = [];
	const visit = (nodes: CommandNodeDescriptor[], parent: string[]): void => {
		for (const node of nodes) {
			const path = [...parent, node.segment];
			if (node.nodeType === 'leaf') paths.push(path.join(' '));
			else visit(node.children, path);
		}
	};
	visit(tree.commands, []);
	return paths;
}
