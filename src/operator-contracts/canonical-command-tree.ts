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
const page = () => [field('query', 'status', 'option'), field('query', 'limit', 'option', 'limit', false, 'integer'), field('query', 'cursor', 'option')];

const operationBindings: Record<string, Execution> = {
	'auth login': protocol('protocol.oauth.device.login'),
	'auth logout': protocol('protocol.oauth.revoke'),
	'auth status': operation('accounts.current.show'),
	'users create': protocol('protocol.accounts.create'),
	'send': operation('communications.send', [field('path', 'teamId', 'context', 'team', true), field('path', 'channel', 'argument', 'channel', true), field('body', 'message', 'argument', 'message', true), field('body', 'projectId', 'context', 'project', true), field('body', 'recipients', 'option', 'to'), field('body', 'timeoutSeconds', 'option', 'timeout', false, 'integer')]),
	'teams list': operation('teams.list', page()),
	'teams current': local('local.teams.current'),
	'teams use': local('local.teams.use'),
	'secrets list': local('local.secrets.list'),
	'secrets status': local('local.secrets.status'),
	'secrets unlock': local('local.secrets.unlock'),
	'secrets lock': local('local.secrets.lock'),
	'secrets rotate': local('local.secrets.rotate'),
	'host status': local('local.host.status'),
	'host doctor': local('local.host.doctor'),
	'host plan': local('local.host.plan'),
	'host apply': local('local.host.apply'),
	'host reconcile': local('local.host.reconcile'),
	'host events': local('local.host.events'),
	'host update status': local('local.host.update.status'),
	'host update check': local('local.host.update.check'),
	'host update apply': local('local.host.update.apply'),
	'host update channel': local('local.host.update.channel'),
	'host update pause': local('local.host.update.pause'),
	'host update resume': local('local.host.update.resume'),
	'host component list': local('local.host.component.list'),
	'host component status': local('local.host.component.status'),
	'host component enable': local('local.host.component.enable'),
	'host component disable': local('local.host.component.disable'),
	'host aliases list': local('local.host.aliases.list'),
	'host config show': local('local.host.config.show'),
	'host config plan': local('local.host.config.plan'),
	'host config apply': local('local.host.config.apply'),
	'host config adopt': local('local.host.config.adopt'),
	'host topology': local('local.host.topology'),
	'host connections': local('local.host.connections'),
	'host provider status': local('local.host.provider.status'),
	'host fleet status': local('local.host.fleet.status'),
	'host recovery status': local('local.host.recovery.status'),
	'host recovery retry': local('local.host.recovery.retry'),
	'host recovery restore': local('local.host.recovery.restore'),
	'host bootstrap status': local('local.host.bootstrap.status'),
	'host bootstrap enroll': local('local.host.bootstrap.enroll'),
	'host reset': local('local.host.reset'),
	'agents list': operation('agents.list', [field('path', 'projectId', 'context', 'project', true), ...page()]),
	'agents show': operation('agents.show', [field('path', 'projectId', 'context', 'project', true), field('path', 'agentSlug', 'argument', 'agent', true)]),
	'agents classes list': operation('agents.classes.list', [field('path', 'projectId', 'context', 'project', true)]),
	'agents classes show': operation('agents.classes.show', [field('path', 'projectId', 'context', 'project', true), field('path', 'classId', 'argument', 'class', true)]),
	'providers list': operation('providers.list', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'providers show': operation('providers.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'providerId', 'argument', 'provider', true)]),
	'providers status': operation('providers.status', [field('path', 'teamId', 'context', 'team', true), field('path', 'providerId', 'argument', 'provider', true)]),
	'providers diagnose': operation('providers.diagnose', [field('path', 'teamId', 'context', 'team', true), field('path', 'providerId', 'argument', 'provider', true)]),
	'providers connect': operation('providers.connect', [field('path', 'teamId', 'context', 'team', true)]),
	'providers disconnect': operation('providers.disconnect', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'connection', true), field('body', 'reason', 'option')]),
	'providers requests list': operation('providers.requests.list', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'providers requests show': operation('providers.requests.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'requestId', 'argument', 'request', true)]),
	'providers requests approve': operation('providers.requests.approve', [field('path', 'teamId', 'context', 'team', true), field('path', 'requestId', 'argument', 'request', true)]),
	'providers requests reject': operation('providers.requests.reject', [field('path', 'teamId', 'context', 'team', true), field('path', 'requestId', 'argument', 'request', true)]),
	'providers credentials status': operation('providers.credentials.status', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'connection', true)]),
	'providers credentials rotate': operation('providers.credentials.rotate', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'connection', true)]),
	'providers credentials revoke': operation('providers.credentials.revoke', [field('path', 'teamId', 'context', 'team', true), field('path', 'connectionId', 'argument', 'connection', true)]),
	'capacity status': operation('capacity.status', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'capacity explain': operation('capacity.explain', [field('path', 'teamId', 'context', 'team', true)]),
	'capacity usage': operation('capacity.usage', [field('path', 'teamId', 'context', 'team', true)]),
	'capacity ledger': operation('capacity.ledger', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'capacity audit': operation('capacity.audit', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'seeds validate': operation('seeds.validate', [field('body', 'file', 'argument', 'file', true)]),
	'seeds plan': operation('seeds.plan', [field('path', 'name', 'context', 'seed', true), field('body', 'file', 'argument', 'file', true)]),
	'seeds apply': operation('seeds.apply', [field('path', 'name', 'context', 'seed', true), field('body', 'file', 'argument', 'file', true)]),
	'seeds show': operation('seeds.show', [field('path', 'name', 'argument', 'seed', true)]),
	'seeds verify': operation('seeds.verify', [field('path', 'name', 'argument', 'seed', true)]),
	'plans list': operation('plans.list', [field('path', 'decisionId', 'option', 'decision', true), ...page()]),
	'plans show': operation('plans.show', [field('path', 'capacityPlanId', 'argument', 'plan', true)]),
	'workdays plan': operation('workdays.plan', [field('path', 'teamId', 'context', 'team', true), field('body', 'profile', 'option'), field('body', 'projects', 'option', 'projects', false, 'csv'), field('body', 'start', 'option'), field('body', 'end', 'option'), field('body', 'duration', 'option', 'duration', false, 'integer'), field('body', 'objective', 'option')]),
	'workdays start': operation('workdays.start', [field('path', 'teamId', 'context', 'team', true), field('body', 'preflightId', 'option', 'preflight', true), field('body', 'digest', 'option', 'digest', true)]),
	'workdays list': operation('workdays.list', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'workdays show': operation('workdays.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'runId', 'argument', 'workday', true)]),
	'workdays schedules list': operation('workdays.schedules.list', [field('path', 'teamId', 'context', 'team', true)]),
	'workdays schedules start': operation('workdays.schedules.create', [field('path', 'teamId', 'context', 'team', true), field('body', 'profile', 'option'), field('body', 'projects', 'option', 'projects', false, 'csv'), field('body', 'duration', 'option', 'duration', false, 'integer')]),
	'assignments list': operation('assignments.list', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'assignments show': operation('assignments.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true)]),
	'assignments explain': operation('assignments.explain', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true)]),
	'assignments retry': operation('assignments.retry', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true), field('body', 'reason', 'option')]),
	'assignments cancel': operation('assignments.cancel', [field('path', 'teamId', 'context', 'team', true), field('path', 'assignmentId', 'argument', 'assignment', true), field('body', 'reason', 'option')]),
	'projects treedx show': operation('treedx.library.show', [field('path', 'projectId', 'argument', 'project', true)]),
	'projects treedx bind': operation('treedx.library.bind', [field('path', 'projectId', 'argument', 'project', true), field('body', 'connectionId', 'option', 'connection', true)]),
	'projects treedx status': operation('treedx.health.show', [field('path', 'projectId', 'argument', 'project', true)]),
	'projects treedx diagnose': operation('treedx.service.contract', [field('path', 'projectId', 'argument', 'project', true)]),
	'projects treedx capabilities': operation('treedx.capabilities.list', [field('path', 'projectId', 'argument', 'project', true)]),
	'projects treedx workspaces list': operation('treedx.workspaces.list', [field('path', 'projectId', 'argument', 'project', true), ...page()]),
	'projects treedx workspaces show': operation('treedx.workspaces.show', [field('path', 'projectId', 'context', 'project', true), field('path', 'workspaceId', 'argument', 'workspace', true)]),
	'projects treedx workspaces abandon': operation('treedx.workspaces.abandon', [field('path', 'projectId', 'context', 'project', true), field('path', 'workspaceId', 'argument', 'workspace', true)]),
	'library show': local('local.library.show'),
	'library status': local('local.library.status'),
	'library paths': local('local.library.paths'),
	'library read': local('local.library.read'),
	'library search': local('local.library.search'),
	'library query': local('local.library.query'),
	'library context': local('local.library.context'),
	'library workspace create': operation('knowledge.workspaces.create', [field('path', 'projectId', 'argument', 'project', true), field('body', 'requestId', 'option', 'request')]),
	'library workspace show': operation('knowledge.workspaces.show', [field('path', 'workspaceId', 'argument', 'workspace', true)]),
	'library workspace read': operation('knowledge.workspaces.content.show', [field('path', 'workspaceId', 'argument', 'workspace', true), field('query', 'path', 'argument', 'path', true)]),
	'library workspace diff': operation('knowledge.workspaces.diff', [field('path', 'workspaceId', 'argument', 'workspace', true)]),
	'library workspace write': operation('knowledge.workspaces.content.update', [field('path', 'workspaceId', 'argument', 'workspace', true), field('body', 'file', 'option', 'input', true)]),
	'library workspace submit': operation('knowledge.workspaces.submit', [field('path', 'workspaceId', 'argument', 'workspace', true), field('body', 'version', 'option', 'version', true, 'integer'), field('body', 'message', 'option'), field('body', 'notes', 'option'), field('body', 'contextDigest', 'option', 'contextDigest')]),
	'library workspace abandon': operation('knowledge.workspaces.abandon', [field('path', 'workspaceId', 'argument', 'workspace', true), field('body', 'version', 'option', 'version', true, 'integer')]),
	'library reviews list': operation('knowledge.reviews.list', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'library reviews decide': operation('knowledge.reviews.decide', [field('path', 'reviewId', 'argument', 'review', true), field('body', 'file', 'option', 'input', true)]),
	'library reviews publish': operation('knowledge.reviews.publish', [field('path', 'reviewId', 'argument', 'review', true), field('body', 'file', 'option', 'input')]),
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

function configurationAdopt(): CommandNodeDescriptor {
	const value = leaf('adopt', 'mutation', 'file', 'authority');
	if (value.nodeType !== 'leaf') throw new Error('Configuration adoption must be a leaf command.');
	value.options = [...(value.options ?? []), { name: '--confirm', description: 'Confirm replacement of the installed configuration identity.', type: 'boolean' }];
	return value;
}

function hostReset(): CommandNodeDescriptor {
	const value = leaf('reset', 'mutation', undefined, 'irreversible');
	if (value.nodeType !== 'leaf') throw new Error('Host reset must be a leaf command.');
	value.description = 'Stop managed components, erase their state, and reconcile a fresh unseeded platform.';
	value.options = [...(value.options ?? []), { name: '--confirm', description: 'Confirm deletion of all manager-owned component data and receipts.', type: 'boolean' }];
	return value;
}

function userCreate(): CommandNodeDescriptor {
	const value = leaf('create', 'mutation');
	if (value.nodeType !== 'leaf') throw new Error('User creation must be a leaf command.');
	value.description = 'Create a local TreeSeed user with a securely prompted password.';
	value.options = [
		...(value.options ?? []),
		{ name: '--email', description: 'Email address for the new user.', type: 'string' },
		{ name: '--username', description: 'Unique username for the new user.', type: 'string' },
		{ name: '--display-name', description: 'Human-readable display name.', type: 'string' },
		{ name: '--timeout', description: 'Maximum seconds to wait for registration.', type: 'number' },
	];
	return value;
}

function authLogin(): CommandNodeDescriptor {
	const value = leaf('login', 'mutation');
	if (value.nodeType !== 'leaf') throw new Error('Authentication login must be a leaf command.');
	value.options = [
		...(value.options ?? []),
		{ name: '--timeout', description: 'Maximum seconds to wait for device authorization.', type: 'number' },
	];
	return value;
}

function libraryRead(segment: string, extraArguments: string[] = [], extraOptions: CommandLeafDescriptor['options'] = []): CommandNodeDescriptor {
	return {
		nodeType: 'leaf', segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} project library knowledge.`, kind: 'read',
		arguments: ['project', ...extraArguments].map((name) => ({ name, description: `${name} value.`, required: true })),
		options: [{ name: '--ref', description: 'Exact commit or protected library ref.', type: 'string' }, ...extraOptions],
		resultSchemaId: `treeseed.command.library.${segment}/v1`, execution: local(`local.library.${segment}`),
	};
}

function addOptions(node: CommandNodeDescriptor, options: NonNullable<CommandLeafDescriptor['options']>): CommandNodeDescriptor {
	if (node.nodeType === 'leaf') node.options = [...(node.options ?? []), ...options];
	return node;
}

const commandTree: CommandTreeDescriptor = {
	schemaVersion: 'treeseed.command-tree/v1',
	executable: 'trsd',
	commands: [
		{ nodeType: 'leaf', segment: 'send', description: 'Send a message to addressed project agents in a team discussion topic.', kind: 'mutation', arguments: [{ name: 'channel', description: 'Team discussion-topic channel.', required: true }, { name: 'message', description: 'Markdown message containing agent addresses.', required: true }], options: [planOption, { name: '--team', description: 'One-command team override.', type: 'string' }, { name: '--project', description: 'Project for agent resolution and the topic stream.', type: 'string', required: true }, { name: '--to', description: 'Deprecated validation-only address list.', type: 'string[]' }, { name: '--timeout', description: 'Maximum seconds to wait for the complete response chain.', type: 'number', defaultValue: 1800 }, { name: '--no-wait', description: 'Return immediately after durable admission.', type: 'boolean' }, { name: '--wait', description: 'Deprecated wait duration in seconds.', type: 'number' }], authorization: { capability: 'agents.execute', confirmation: 'never' }, resultSchemaId: 'treeseed.communication-send-receipt/v2', execution: unavailable() },
		branch('auth', [authLogin(), leaf('logout', 'mutation'), leaf('status')]),
		branch('users', [userCreate()]),
		branch('teams', [leaf('list'), { nodeType: 'leaf', segment: 'current', description: 'Show the active team for this authenticated server session.', kind: 'read', resultSchemaId: 'treeseed.command.teams.current/v1', execution: unavailable() }, { nodeType: 'leaf', segment: 'use', description: 'Select the active team for this authenticated server session.', kind: 'mutation', arguments: [{ name: 'team', description: 'Team UUID or unambiguous slug.', required: true }], options: [planOption], authorization: { capability: 'teams.read', confirmation: 'never' }, resultSchemaId: 'treeseed.command.teams.use/v1', execution: unavailable() }]),
		branch('secrets', [leaf('list'), leaf('status'), leaf('unlock', 'mutation', undefined, 'credential'), leaf('lock', 'mutation'), leaf('rotate', 'mutation', undefined, 'credential')]),
		branch('host', [
			leaf('status'), leaf('doctor'), leaf('plan'), leaf('apply', 'mutation', undefined, 'authority'), leaf('reconcile', 'mutation', undefined, 'authority'), leaf('events'),
			branch('config', [leaf('show'), leaf('plan', 'read', 'file'), leaf('apply', 'mutation', 'file', 'authority'), configurationAdopt()]),
			leaf('topology'), leaf('connections'), branch('provider', [leaf('status')]), branch('fleet', [leaf('status')]),
			branch('update', [leaf('status'), leaf('check', 'mutation'), leaf('apply', 'mutation', undefined, 'authority'), leaf('channel', 'mutation', 'track', 'authority'), leaf('pause', 'mutation', undefined, 'authority'), leaf('resume', 'mutation', undefined, 'authority')]),
			branch('component', [leaf('list'), leaf('status', 'read', 'component'), leaf('enable', 'mutation', 'component', 'authority'), leaf('disable', 'mutation', 'component', 'destructive')]),
			branch('aliases', [leaf('list')]),
			branch('recovery', [leaf('status'), leaf('retry', 'mutation', undefined, 'authority'), leaf('restore', 'mutation', 'generation', 'destructive')]),
			branch('bootstrap', [leaf('status'), leaf('enroll', 'mutation', undefined, 'credential')]),
			hostReset(),
		]),
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
		branch('seeds', [leaf('validate', 'read', 'file'), leaf('plan', 'read', 'file'), leaf('apply', 'mutation', 'file', 'authority'), leaf('show', 'read', 'seed'), leaf('verify', 'read', 'seed')]),
		branch('capacity', [leaf('status'), leaf('explain'), leaf('usage'), leaf('ledger'), leaf('audit')]),
		branch('plans', [leaf('list'), leaf('show', 'read', 'plan'), leaf('explain', 'read', 'plan'), { nodeType: 'leaf', segment: 'diff', description: 'Compare two API-derived plans.', kind: 'read', arguments: [{ name: 'left', description: 'Left plan identity.', required: true }, { name: 'right', description: 'Right plan identity.', required: true }], resultSchemaId: 'treeseed.command.plans.diff/v1', execution: unavailable() }]),
		branch('workdays', [
			branch('profiles', [leaf('list'), leaf('show', 'read', 'profile'), leaf('validate', 'read', 'file')]),
			leaf('plan', 'mutation'), leaf('start', 'mutation', undefined, 'authority'), leaf('list'), leaf('show', 'read', 'workday'), leaf('watch', 'read', 'workday'), leaf('pause', 'mutation', 'workday', 'authority'), leaf('resume', 'mutation', 'workday', 'authority'), leaf('stop', 'mutation', 'workday', 'destructive'), leaf('cancel', 'mutation', 'workday', 'destructive'),
			branch('schedules', [leaf('list'), leaf('show', 'read', 'schedule'), leaf('plan'), leaf('start', 'mutation', undefined, 'authority'), leaf('pause', 'mutation', 'schedule', 'authority'), leaf('resume', 'mutation', 'schedule', 'authority'), leaf('retire', 'mutation', 'schedule', 'destructive')]),
		]),
		branch('assignments', [leaf('list'), leaf('show', 'read', 'assignment'), leaf('explain', 'read', 'assignment'), leaf('watch', 'read', 'assignment'), leaf('retry', 'mutation', 'assignment', 'authority'), leaf('cancel', 'mutation', 'assignment', 'destructive'), leaf('artifacts', 'read', 'assignment')]),
		branch('projects', [branch('treedx', [
			leaf('show', 'read', 'project'), leaf('bind', 'mutation', 'project'), leaf('status', 'read', 'project'),
			leaf('diagnose', 'read', 'project'), leaf('capabilities', 'read', 'project'),
			branch('workspaces', [leaf('list', 'read', 'project'), leaf('show', 'read', 'workspace'), leaf('abandon', 'mutation', 'workspace', 'destructive')]),
		])]),
		branch('library', [
			libraryRead('show'), libraryRead('status'),
			libraryRead('paths', [], [{ name: '--prefix', description: 'Repository-relative path prefix.', type: 'string' }, { name: '--limit', description: 'Page size.', type: 'number' }, { name: '--cursor', description: 'Opaque page cursor.', type: 'string' }]),
			libraryRead('read', ['path']),
			libraryRead('search', ['query'], [{ name: '--path', description: 'Restrict search to a repository-relative path.', type: 'string' }, { name: '--limit', description: 'Page size.', type: 'number' }, { name: '--cursor', description: 'Opaque page cursor.', type: 'string' }]),
			libraryRead('query', ['query'], [{ name: '--model', description: 'TreeDX content model.', type: 'string' }, { name: '--input', description: 'YAML or JSON query body.', type: 'string' }]),
			libraryRead('context', ['query'], [{ name: '--max-items', description: 'Maximum context items.', type: 'number' }, { name: '--max-tokens', description: 'Maximum context tokens.', type: 'number' }]),
			branch('workspace', [
				addOptions(leaf('create', 'mutation', 'project'), [{ name: '--request', description: 'Replay-safe UUID request identity.', type: 'string' }]),
				leaf('show', 'read', 'workspace'), { nodeType: 'leaf', segment: 'read', description: 'Read a file from a governed library workspace.', kind: 'read', arguments: [{ name: 'workspace', description: 'Workspace identity.', required: true }, { name: 'path', description: 'Repository-relative path.', required: true }], resultSchemaId: 'treeseed.command.library.workspace.read/v1', execution: unavailable() }, leaf('diff', 'read', 'workspace'),
				addOptions(leaf('write', 'mutation', 'workspace'), [{ name: '--input', description: 'YAML or JSON draft body.', type: 'string', required: true }]),
				addOptions(leaf('submit', 'mutation', 'workspace'), [{ name: '--version', description: 'Expected workspace version.', type: 'number', required: true }, { name: '--message', description: 'Commit message.', type: 'string' }, { name: '--notes', description: 'Review notes.', type: 'string' }, { name: '--context-digest', description: 'Verified editorial context digest.', type: 'string' }]),
				addOptions(leaf('abandon', 'mutation', 'workspace', 'destructive'), [{ name: '--version', description: 'Expected workspace version.', type: 'number', required: true }]),
			]),
			branch('reviews', [leaf('list'), addOptions(leaf('decide', 'mutation', 'review'), [{ name: '--input', description: 'YAML or JSON review decision.', type: 'string', required: true }]), addOptions(leaf('publish', 'mutation', 'review'), [{ name: '--input', description: 'Optional YAML or JSON publication body.', type: 'string' }])]),
		]),
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
