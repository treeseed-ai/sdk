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
const aiNode = () => field('path', 'nodeId', 'context', 'node', true);

const operationBindings: Record<string, Execution> = {
	'auth login': protocol('protocol.oauth.device.login'),
	'auth logout': protocol('protocol.oauth.revoke'),
	'auth status': operation('accounts.current.show'),
	'users create': protocol('protocol.accounts.create'),
	'send': operation('communications.send', [field('path', 'teamId', 'context', 'team', true), field('path', 'channel', 'argument', 'channel'), field('body', 'message', 'argument', 'message'), field('body', 'recipients', 'option', 'to'), field('body', 'timeoutSeconds', 'option', 'timeout', false, 'integer')]),
	'topics list': operation('communications.topics.list', [field('path', 'teamId', 'context', 'team', true), ...page()]),
	'topics show': operation('communications.topics.show', [field('path', 'teamId', 'context', 'team', true), field('path', 'channel', 'argument', 'topic', true)]),
	'topics subscribe': operation('communications.topics.subscriptions.put', [field('path', 'teamId', 'context', 'team', true), field('path', 'channel', 'argument', 'topic', true), field('body', 'agent', 'argument', 'agent', true)]),
	'topics unsubscribe': operation('communications.topics.subscriptions.delete', [field('path', 'teamId', 'context', 'team', true), field('path', 'channel', 'argument', 'topic', true), field('body', 'agent', 'argument', 'agent', true)]),
	'capabilities list': operation('capabilities.list', [field('query', 'status', 'option'), field('query', 'family', 'option'), field('query', 'namespace', 'option'), field('query', 'limit', 'option', 'limit', false, 'integer'), field('query', 'cursor', 'option')]),
	'capabilities show': operation('capabilities.show', [field('path', 'capabilityId', 'argument', 'capability', true), field('query', 'version', 'option')]),
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
	'host storage status': local('local.host.storage.status'),
	'host storage connect': local('local.host.storage.connect'),
	'host storage reconcile': local('local.host.storage.reconcile'),
	'host storage rotate': local('local.host.storage.rotate'),
	'host security plan': local('local.host.security.plan'),
	'host security initialize': local('local.host.security.initialize'),
	'host security status': local('local.host.security.status'),
	'host security verify': local('local.host.security.verify'),
	'host security rotate': local('local.host.security.rotate'),
	'host security recovery verify': local('local.host.security.recovery.verify'),
	'host sandbox status': local('local.host.sandbox.status'),
	'host sandbox doctor': local('local.host.sandbox.doctor'),
	'host fleet status': local('local.host.fleet.status'),
	'host recovery status': local('local.host.recovery.status'),
	'host recovery retry': local('local.host.recovery.retry'),
	'host recovery restore': local('local.host.recovery.restore'),
	'host bootstrap status': local('local.host.bootstrap.status'),
	'host bootstrap enroll': local('local.host.bootstrap.enroll'),
	'host reset': local('local.host.reset'),
	'dev session start': local('local.dev.session.start'),
	'dev session stop': local('local.dev.session.stop'),
	'dev use': local('local.dev.use'),
	'dev rebuild': local('local.dev.rebuild'),
	'dev status': local('local.dev.status'),
	'dev logs': local('local.dev.logs'),
	'dev plan': local('local.dev.plan'),
	'dev freeze': local('local.dev.freeze'),
	'dev verify': local('local.dev.verify'),
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
	'workdays plan': operation('workdays.plan', [field('path', 'teamId', 'context', 'team', true), field('body', 'profileId', 'option', 'profile'), field('body', 'projects', 'option', 'projects', false, 'csv'), field('body', 'startsAt', 'option', 'start'), field('body', 'endsAt', 'option', 'end'), field('body', 'durationSeconds', 'option', 'duration', false, 'integer'), field('body', 'objectiveFilters', 'option', 'objective', false, 'csv')]),
	'workdays start': operation('workdays.start', [field('path', 'teamId', 'context', 'team', true), field('body', 'preflightId', 'option', 'preflight', true), field('body', 'preflightDigest', 'option', 'digest', true)]),
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
	'ai status': operation('treeai.qualification.get.status', [aiNode()]),
	'ai mode show': local('local.host.ai.mode.show'),
	'ai mode set': local('local.host.ai.mode.set'),
	'ai inference models': operation('treeai.inference.get.models', [aiNode()]),
	'ai inference jobs': operation('treeai.inference.get.jobs', [aiNode()]),
	'ai inference rollback': operation('treeai.inference.post.deployments.rollback', [aiNode()]),
	'ai training libraries': operation('treeai.training.get.libraries', [aiNode()]),
	'ai training jobs': operation('treeai.training.get.jobs', [aiNode()]),
	'ai training runs': operation('treeai.training.get.library.runs', [aiNode()]),
	'ai lab status': operation('treeai.lab.get.status', [aiNode()]),
	'ai lab agents': operation('treeai.lab.get.agents', [aiNode()]),
	'ai lab libraries': operation('treeai.lab.get.libraries', [aiNode()]),
	'ai qualify status': operation('treeai.qualification.get.qualification.profile', [aiNode()]),
	'ai qualify run': operation('treeai.qualification.post.qualification.campaigns', [aiNode()]),
	'ai qualify campaigns': operation('treeai.qualification.get.qualification.campaigns', [aiNode()]),
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
	const value = leaf('adopt', 'mutation', 'file', 'destructive');
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

function hostSecurityInitialize(): CommandNodeDescriptor {
	const value = leaf('initialize', 'mutation', undefined, 'credential');
	if (value.nodeType !== 'leaf') throw new Error('Host security initialization must be a leaf command.');
	value.description = 'Initialize the encrypted provider volume, application keys, and offline recovery bundle.';
	value.options = [...(value.options ?? []), { name: '--recovery-bundle', description: 'Absolute path for the new encrypted offline recovery bundle.', type: 'string', required: true }, { name: '--confirm', description: 'Confirm provider-state migration and volume formatting.', type: 'boolean', required: true }];
	return value;
}

function hostSecurityRotate(): CommandNodeDescriptor {
	const value = leaf('rotate', 'mutation', 'target', 'credential');
	if (value.nodeType !== 'leaf') throw new Error('Host security rotation must be a leaf command.');
	value.options = [...(value.options ?? []),
		{ name: '--recovery-bundle', description: 'Absolute path to the currently authenticated recovery bundle.', type: 'string', required: true },
		{ name: '--new-recovery-bundle', description: 'Absolute non-existing path for the replacement recovery bundle.', type: 'string', required: true },
		{ name: '--confirm', description: 'Confirm creation and activation of a new key generation.', type: 'boolean', required: true }];
	return value;
}

function hostRecoveryVerify(): CommandNodeDescriptor {
	return { nodeType: 'leaf', segment: 'verify', description: 'Authenticate and inventory an offline recovery bundle without revealing secrets.', kind: 'read',
		options: [{ name: '--bundle', description: 'Absolute recovery bundle path.', type: 'string', required: true }], resultSchemaId: 'treeseed.host-recovery-verification/v1', execution: unavailable() };
}

function aiModeSet(): CommandNodeDescriptor {
	const value = leaf('set', 'mutation', 'mode', 'authority');
	if (value.nodeType !== 'leaf') throw new Error('AI mode set must be a leaf command.');
	value.description = 'Transition the exclusive AI GPU resource to awake or sleep.';
	value.options = [...(value.options ?? []),
		{ name: '--idempotency-key', description: 'Replay-safe transition identity.', type: 'string' },
		{ name: '--drain-timeout', description: 'Maximum drain wait in seconds.', type: 'number' },
	];
	value.authorization = { capability: 'host.ai.mode', confirmation: 'authority' };
	value.resultSchemaId = 'treeseed.ai-mode-transition-receipt/v1';
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

function developmentCommand(segment: string, kind: 'read' | 'mutation', argument?: string, options: NonNullable<CommandLeafDescriptor['options']> = []): CommandNodeDescriptor {
	return {
		nodeType: 'leaf', segment, description: `${segment[0]!.toUpperCase()}${segment.slice(1)} a local development session.`, kind,
		arguments: argument ? [{ name: argument, description: `${argument} value.`, required: true }] : undefined,
		options: [...(kind === 'mutation' ? [planOption] : []), ...options],
		authorization: kind === 'mutation' ? { capability: `development.${segment}`, confirmation: 'never' } : undefined,
		resultSchemaId: `treeseed.command.dev.${segment}/v1`, execution: local(`local.dev.${segment}`),
	};
}

const commandTree: CommandTreeDescriptor = {
	schemaVersion: 'treeseed.command-tree/v1',
	executable: 'trsd',
	commands: [
		{ nodeType: 'leaf', segment: 'inbox', description: 'Open the active team governance inbox.', kind: 'read', options: [{ name: '--project', description: 'Initial project filter.', type: 'string' }, { name: '--type', description: 'Initial proposal, question, or all filter.', type: 'string' }, { name: '--all', description: 'Include completed and decided items.', type: 'boolean' }], resultSchemaId: 'treeseed.inbox-session/v1', execution: local('local.inbox') },
		{ nodeType: 'leaf', segment: 'send', description: 'Send a message or open the interactive team topic browser.', kind: 'mutation', arguments: [{ name: 'channel', description: 'Optional team discussion topic to preselect.', required: false }, { name: 'message', description: 'Markdown message containing agent addresses.', required: false }], options: [planOption, { name: '--team', description: 'One-command team override.', type: 'string' }, { name: '--to', description: 'Deprecated validation-only address list.', type: 'string[]' }, { name: '--timeout', description: 'Optional maximum seconds to listen for the complete response chain.', type: 'number' }, { name: '--no-wait', description: 'Return immediately after durable admission.', type: 'boolean' }, { name: '--wait', description: 'Deprecated wait duration in seconds.', type: 'number' }, { name: '--json-stream', description: 'Emit ordered communication events as NDJSON.', type: 'boolean' }, { name: '--diagnostics', description: 'Diagnostic detail: metadata or full.', type: 'string' }], authorization: { capability: 'agents.execute', confirmation: 'never' }, resultSchemaId: 'treeseed.communication-send-receipt/v4', execution: unavailable() },
		branch('topics', [
			{ nodeType: 'leaf', segment: 'list', description: 'List discussion topics and active listeners.', kind: 'read', options: [{ name: '--status', description: 'Topic status.', type: 'string' }, { name: '--limit', description: 'Maximum topics.', type: 'number' }, { name: '--cursor', description: 'Pagination cursor.', type: 'string' }], resultSchemaId: 'treeseed.communication-topic-page/v1', execution: unavailable() },
			{ nodeType: 'leaf', segment: 'show', description: 'Show a discussion topic and its listeners.', kind: 'read', arguments: [{ name: 'topic', description: 'Discussion topic.', required: true }], resultSchemaId: 'treeseed.communication-topic/v1', execution: unavailable() },
			{ nodeType: 'leaf', segment: 'subscribe', description: 'Subscribe an agent to a discussion topic.', kind: 'mutation', arguments: [{ name: 'topic', description: 'Discussion topic.', required: true }, { name: 'agent', description: '@project/agent handle.', required: true }], options: [planOption], authorization: { capability: 'agents.execute', confirmation: 'never' }, resultSchemaId: 'treeseed.communication-topic-subscription-receipt/v1', execution: unavailable() },
			{ nodeType: 'leaf', segment: 'unsubscribe', description: 'Remove an agent subscription from a discussion topic.', kind: 'mutation', arguments: [{ name: 'topic', description: 'Discussion topic.', required: true }, { name: 'agent', description: '@project/agent handle.', required: true }], options: [planOption], authorization: { capability: 'agents.execute', confirmation: 'never' }, resultSchemaId: 'treeseed.communication-topic-subscription-receipt/v1', execution: unavailable() },
		]),
		branch('capabilities', [
			{ nodeType: 'leaf', segment: 'list', description: 'List standardized services in the active capability ontology.', kind: 'read', options: [{ name: '--family', description: 'Capability family filter.', type: 'string' }, { name: '--namespace', description: 'Namespace filter.', type: 'string' }, { name: '--status', description: 'Definition status.', type: 'string' }, { name: '--limit', description: 'Maximum definitions.', type: 'number' }, { name: '--cursor', description: 'Pagination cursor.', type: 'string' }], resultSchemaId: 'treeseed.capability-page/v1', execution: unavailable() },
			{ nodeType: 'leaf', segment: 'show', description: 'Show one standardized capability definition.', kind: 'read', arguments: [{ name: 'capability', description: 'Namespaced capability ID.', required: true }], options: [{ name: '--version', description: 'Exact semantic version.', type: 'string' }], resultSchemaId: 'treeseed.capability-definition/v1', execution: unavailable() },
		]),
		branch('auth', [authLogin(), leaf('logout', 'mutation'), leaf('status')]),
		branch('users', [userCreate()]),
		branch('teams', [leaf('list'), { nodeType: 'leaf', segment: 'current', description: 'Show the active team for this authenticated server session.', kind: 'read', resultSchemaId: 'treeseed.command.teams.current/v1', execution: unavailable() }, { nodeType: 'leaf', segment: 'use', description: 'Select the active team for this authenticated server session.', kind: 'mutation', arguments: [{ name: 'team', description: 'Team UUID or unambiguous slug.', required: true }], options: [planOption], authorization: { capability: 'teams.read', confirmation: 'never' }, resultSchemaId: 'treeseed.command.teams.use/v1', execution: unavailable() }]),
		branch('secrets', [leaf('list'), leaf('status'), leaf('unlock', 'mutation', undefined, 'credential'), leaf('lock', 'mutation'), leaf('rotate', 'mutation', undefined, 'credential')]),
		branch('dev', [
			branch('session', [
				developmentCommand('start', 'mutation', 'manifest', [{ name: '--actor', description: 'Audited development-session actor.', type: 'string' }, { name: '--lease-seconds', description: 'Requested bounded lease duration.', type: 'number' }]),
				developmentCommand('stop', 'mutation', undefined, [{ name: '--session', description: 'Development session identity.', type: 'string' }, { name: '--restore', description: 'Restore released routes and targets.', type: 'boolean' }]),
			]),
			developmentCommand('use', 'mutation', 'selection', [{ name: '--session', description: 'Development session identity.', type: 'string' }, { name: '--target', description: 'Additional project.target=mode selections.', type: 'string[]' }]),
			developmentCommand('rebuild', 'mutation', 'target', [{ name: '--session', description: 'Development session identity.', type: 'string' }]),
			developmentCommand('status', 'read', undefined, [{ name: '--session', description: 'Development session identity.', type: 'string' }, { name: '--all', description: 'Include stopped and expired sessions.', type: 'boolean' }]),
			developmentCommand('logs', 'read', undefined, [{ name: '--session', description: 'Development session identity.', type: 'string' }, { name: '--target', description: 'Development target identity.', type: 'string' }, { name: '--follow', description: 'Follow target logs.', type: 'boolean' }]),
			developmentCommand('plan', 'read', undefined, [{ name: '--session', description: 'Development session identity.', type: 'string' }, { name: '--affected', description: 'Show the smallest affected closure.', type: 'boolean' }]),
			developmentCommand('freeze', 'mutation', undefined, [{ name: '--session', description: 'Development session identity.', type: 'string' }, { name: '--allow-dirty', description: 'Create a non-promotable dirty-source candidate.', type: 'boolean' }]),
			developmentCommand('verify', 'mutation', undefined, [{ name: '--session', description: 'Development session identity.', type: 'string' }, { name: '--candidate', description: 'Candidate identity.', type: 'string' }]),
		]),
		branch('host', [
			leaf('status'), leaf('doctor'), leaf('plan'), leaf('apply', 'mutation', undefined, 'authority'), leaf('reconcile', 'mutation', undefined, 'authority'), leaf('events'),
			branch('config', [leaf('show'), leaf('plan', 'read', 'file'), leaf('apply', 'mutation', 'file', 'authority'), configurationAdopt()]),
			leaf('topology'), leaf('connections'), branch('provider', [leaf('status')]),
			branch('storage', [
				leaf('status'),
				addOptions(leaf('connect', 'mutation', 'backend', 'credential'), [{ name: '--account-id', description: 'Optional Cloudflare account ID when the bootstrap authority reaches multiple accounts.', type: 'string' }]),
				leaf('reconcile', 'mutation', undefined, 'authority'),
				leaf('rotate', 'mutation', 'backend', 'credential'),
			]),
			branch('security', [leaf('plan'), hostSecurityInitialize(), leaf('status'), leaf('verify'), hostSecurityRotate(), branch('recovery', [hostRecoveryVerify()])]),
			branch('sandbox', [leaf('status'), leaf('doctor')]),
			branch('fleet', [leaf('status')]),
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
		branch('ai', [
			leaf('status'), branch('mode', [leaf('show'), aiModeSet()]),
			branch('inference', [leaf('models'), leaf('jobs'), leaf('rollback', 'mutation', undefined, 'destructive')]),
			branch('training', [leaf('libraries'), leaf('jobs'), leaf('runs')]),
			branch('lab', [leaf('status'), leaf('agents'), leaf('libraries')]),
			branch('qualify', [leaf('status'), leaf('run', 'mutation', undefined, 'authority'), leaf('campaigns')]),
		]),
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
