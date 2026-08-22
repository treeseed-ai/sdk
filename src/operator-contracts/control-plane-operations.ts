import { z } from 'zod';
import {
	CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
	type ControlPlaneOperationBinding,
	type ControlPlaneOperationDescriptor,
} from './control-plane-operation.ts';

const empty = z.object({}).strict();
const none = z.undefined();
const record = z.record(z.unknown());
const payload = record;

type Definition = Omit<ControlPlaneOperationDescriptor, 'schemaVersion' | 'schemas' | 'idempotency' | 'concurrency' | 'audited' | 'receipt' | 'redactedPaths'> & {
	parameters?: string;
	redactedPaths?: string[];
	idempotencyRequired?: boolean;
	concurrencyRequired?: boolean;
};

function define<TPath, TQuery, TBody, TOutput>(
	definition: Definition,
	schema: ControlPlaneOperationBinding<TPath, TQuery, TBody, TOutput>['schema'],
): ControlPlaneOperationBinding<TPath, TQuery, TBody, TOutput> {
	const { parameters, redactedPaths = [], idempotencyRequired, concurrencyRequired, ...descriptor } = definition;
	const mutation = definition.kind === 'mutation';
	return {
		descriptor: {
			...descriptor,
			schemaVersion: CONTROL_PLANE_OPERATION_SCHEMA_VERSION,
			schemas: {
				input: `treeseed.${definition.operationId}.input/v1`,
				output: `treeseed.${definition.operationId}.output/v1`,
				errors: 'treeseed.problem/v1',
				...(parameters ? { parameters } : {}),
			},
			idempotency: { required: idempotencyRequired ?? mutation, header: 'Idempotency-Key' },
			concurrency: { required: concurrencyRequired ?? false, readHeader: 'ETag', writeHeader: 'If-Match' },
			audited: definition.surfaces.some((surface) => surface !== 'internal'),
			receipt: mutation,
			redactedPaths,
		},
		schema,
	};
}

function read(operationId: `${string}.${string}`, path: `/v1/${string}`, capability: string, surfaces: ControlPlaneOperationDescriptor['surfaces'] = ['rest']) {
	return define({
		operationId, description: `Read ${operationId}.`, rest: { method: 'GET', path }, capability,
		oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never',
		surfaces, cacheScope: 'principal', pagination: 'none',
	}, { path: empty, query: empty, body: none, output: payload });
}

function providerPath<T extends z.ZodRawShape>(
	operationId: `${string}.${string}`,
	method: 'GET' | 'POST' | 'PUT',
	path: `/v1/${string}`,
	pathShape: T,
	options: { read?: boolean; redactedPaths?: string[] } = {},
) {
	const kind = options.read ? 'read' : 'mutation';
	return define({
		operationId, description: `${kind === 'read' ? 'Read' : 'Apply'} ${operationId}.`, rest: { method, path },
		parameters: `treeseed.${operationId}.parameters/v1`, capability: 'providers.execute', oauthScopes: ['treeseed:execution'],
		kind, riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none',
		redactedPaths: options.redactedPaths,
	}, { path: z.object(pathShape).strict(), query: empty, body: method === 'GET' ? none : record, output: payload });
}

const noPathProvider = (operationId: `${string}.${string}`, method: 'GET' | 'POST' | 'PUT', path: `/v1/${string}`, options: { read?: boolean; redactedPaths?: string[] } = {}) =>
	define({
		operationId, description: `${options.read ? 'Read' : 'Apply'} ${operationId}.`, rest: { method, path },
		capability: 'providers.execute', oauthScopes: ['treeseed:execution'], kind: options.read ? 'read' : 'mutation',
		riskClass: 'ordinary', confirmation: 'never', surfaces: ['rest'], cacheScope: 'none', pagination: 'none',
		redactedPaths: options.redactedPaths,
	}, { path: empty, query: empty, body: method === 'GET' ? none : record, output: payload });

function resource<T extends z.ZodRawShape>(
	operationId: `${string}.${string}`,
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST' | 'PUT',
	path: `/v1/${string}`,
	pathShape: T,
	options: {
		capability: string;
		scopes?: ControlPlaneOperationDescriptor['oauthScopes'];
		surfaces?: ControlPlaneOperationDescriptor['surfaces'];
		risk?: ControlPlaneOperationDescriptor['riskClass'];
		concurrency?: boolean;
		pagination?: ControlPlaneOperationDescriptor['pagination'];
		redactedPaths?: string[];
	} = { capability: 'control-plane.use' },
) {
	const kind = method === 'GET' ? 'read' : 'mutation';
	const riskClass = options.risk ?? 'ordinary';
	return define({
		operationId, description: `${kind === 'read' ? 'Read' : 'Apply'} ${operationId}.`, rest: { method, path },
		...(Object.keys(pathShape).length ? { parameters: `treeseed.${operationId}.parameters/v1` } : {}),
		capability: options.capability, oauthScopes: options.scopes ?? (kind === 'read' ? ['treeseed:read'] : ['treeseed:projects:write']),
		kind, riskClass, confirmation: riskClass === 'ordinary' ? 'never' : 'input_required',
		surfaces: options.surfaces ?? ['rest'], cacheScope: kind === 'read' ? 'principal' : 'none',
		pagination: options.pagination ?? 'none', concurrencyRequired: options.concurrency, redactedPaths: options.redactedPaths,
	}, { path: z.object(pathShape).strict(), query: kind === 'read' ? record : empty, body: kind === 'read' ? none : record, output: payload });
}

export const CONTROL_PLANE_OPERATIONS = {
	status: {
		show: read('status.show', '/v1/status', 'status.read', ['rest', 'cli', 'mcp_tool', 'mcp_resource']),
	},
	health: {
		ready: resource('health.ready', 'GET', '/v1/health/ready', {}, { capability: 'health.read', scopes: [] }),
		deep: resource('health.deep', 'GET', '/v1/health/deep', {}, { capability: 'health.read', scopes: [] }),
	},
	projects: {
		list: define({
			operationId: 'projects.list', description: 'List projects visible to the principal.', rest: { method: 'GET', path: '/v1/projects' },
			capability: 'projects.read', oauthScopes: ['treeseed:read'], kind: 'read', riskClass: 'ordinary', confirmation: 'never',
			surfaces: ['rest', 'cli', 'mcp_tool'], cacheScope: 'principal', pagination: 'cursor',
		}, { path: empty, query: z.object({ teamId: z.string().min(1).optional(), limit: z.number().int().positive().max(200).optional(), cursor: z.string().min(1).optional() }).strict(), body: none, output: payload }),
		show: resource('projects.show', 'GET', '/v1/projects/{projectId}', { projectId: z.string().min(1) }, { capability: 'projects.read', surfaces: ['rest', 'cli', 'mcp_tool', 'mcp_resource'] }),
		create: resource('projects.create', 'POST', '/v1/teams/{teamId}/projects', { teamId: z.string().min(1) }, { capability: 'projects.write', surfaces: ['rest', 'cli', 'mcp_tool'] }),
		update: resource('projects.update', 'PUT', '/v1/projects/{projectId}', { projectId: z.string().min(1) }, { capability: 'projects.write', surfaces: ['rest', 'cli', 'mcp_tool'], concurrency: true }),
		archive: resource('projects.archive', 'POST', '/v1/projects/{projectId}/archive', { projectId: z.string().min(1) }, { capability: 'projects.write', surfaces: ['rest', 'cli', 'mcp_tool'], risk: 'destructive', concurrency: true }),
		restore: resource('projects.restore', 'POST', '/v1/projects/{projectId}/restore', { projectId: z.string().min(1) }, { capability: 'projects.write', surfaces: ['rest', 'cli', 'mcp_tool'], concurrency: true }),
		deletionBlockers: resource('projects.deletion.blockers', 'GET', '/v1/projects/{projectId}/deletion-blockers', { projectId: z.string().min(1) }, { capability: 'projects.read' }),
		remove: resource('projects.delete', 'DELETE', '/v1/projects/{projectId}', { projectId: z.string().min(1) }, { capability: 'projects.delete', risk: 'irreversible', concurrency: true }),
		access: resource('projects.access.show', 'GET', '/v1/projects/{projectId}/access', { projectId: z.string().min(1) }, { capability: 'projects.read' }),
		summary: resource('projects.summary.show', 'GET', '/v1/projects/{projectId}/summary', { projectId: z.string().min(1) }, { capability: 'projects.read', surfaces: ['rest', 'mcp_resource'] }),
		repositoryTopology: resource('projects.repository.topology', 'GET', '/v1/projects/{projectId}/repository-topology', { projectId: z.string().min(1) }, { capability: 'repositories.read' }),
		repositoryTopologyStatus: resource('projects.repository.status', 'GET', '/v1/projects/{projectId}/repository-topology/status', { projectId: z.string().min(1) }, { capability: 'repositories.read' }),
		updateRepositoryTopology: resource('projects.repository.update', 'PUT', '/v1/projects/{projectId}/repository-topology', { projectId: z.string().min(1) }, { capability: 'repositories.write', concurrency: true }),
	},
	accounts: {
		current: resource('accounts.current.show', 'GET', '/v1/me', {}, { capability: 'accounts.read', surfaces: ['rest', 'cli', 'mcp_resource'] }),
		register: resource('accounts.register', 'POST', '/v1/auth/web/sign-up', {}, { capability: 'accounts.register', scopes: [], redactedPaths: ['body.password'] }),
		confirmEmail: resource('accounts.email.confirm', 'POST', '/v1/auth/web/confirm-email', {}, { capability: 'accounts.register', scopes: [], redactedPaths: ['body.token'] }),
		requestPasswordReset: resource('accounts.password.reset.request', 'POST', '/v1/auth/web/password-reset/request', {}, { capability: 'accounts.register', scopes: [] }),
		completePasswordReset: resource('accounts.password.reset.complete', 'POST', '/v1/auth/web/password-reset/complete', {}, { capability: 'accounts.register', scopes: [], redactedPaths: ['body.token', 'body.password'] }),
		identity: resource('accounts.identity.show', 'GET', '/v1/auth/web/account/identity', {}, { capability: 'accounts.read' }),
		updateProfile: resource('accounts.profile.update', 'PATCH', '/v1/auth/web/profile', {}, { capability: 'accounts.write', concurrency: true }),
		updatePassword: resource('accounts.password.update', 'PATCH', '/v1/auth/web/password', {}, { capability: 'accounts.write', risk: 'credential', redactedPaths: ['body.currentPassword', 'body.password'] }),
		emails: resource('accounts.emails.list', 'GET', '/v1/auth/web/emails', {}, { capability: 'accounts.read', pagination: 'cursor' }),
		addEmail: resource('accounts.emails.create', 'POST', '/v1/auth/web/emails', {}, { capability: 'accounts.write' }),
		verifyEmail: resource('accounts.emails.verify', 'POST', '/v1/auth/web/emails/{emailId}/verify', { emailId: z.string().min(1) }, { capability: 'accounts.write' }),
		makePrimaryEmail: resource('accounts.emails.primary', 'POST', '/v1/auth/web/emails/{emailId}/primary', { emailId: z.string().min(1) }, { capability: 'accounts.write', concurrency: true }),
		removeEmail: resource('accounts.emails.delete', 'DELETE', '/v1/auth/web/emails/{emailId}', { emailId: z.string().min(1) }, { capability: 'accounts.write', risk: 'destructive', concurrency: true }),
		sessions: resource('accounts.sessions.list', 'GET', '/v1/auth/web/sessions', {}, { capability: 'accounts.read', pagination: 'cursor' }),
		revokeSession: resource('accounts.sessions.revoke', 'POST', '/v1/auth/web/sessions/{sessionId}/revoke', { sessionId: z.string().min(1) }, { capability: 'accounts.write', risk: 'credential' }),
		deletionBlockers: resource('accounts.deletion.blockers', 'GET', '/v1/auth/web/account/deletion-blockers', {}, { capability: 'accounts.read' }),
		remove: resource('accounts.delete', 'DELETE', '/v1/auth/web/account', {}, { capability: 'accounts.delete', risk: 'irreversible', concurrency: true }),
		preferences: resource('accounts.preferences.show', 'GET', '/v1/auth/web/preferences', {}, { capability: 'accounts.read' }),
		updatePreferences: resource('accounts.preferences.update', 'PATCH', '/v1/auth/web/preferences', {}, { capability: 'accounts.write', concurrency: true }),
		notifications: resource('accounts.notifications.list', 'GET', '/v1/auth/web/notifications', {}, { capability: 'accounts.read', pagination: 'cursor' }),
		readNotification: resource('accounts.notifications.read', 'POST', '/v1/auth/web/notifications/{notificationId}/read', { notificationId: z.string().min(1) }, { capability: 'accounts.write' }),
	},
	teams: {
		list: resource('teams.list', 'GET', '/v1/teams', {}, { capability: 'teams.read', surfaces: ['rest', 'cli', 'mcp_tool'], pagination: 'cursor' }),
		create: resource('teams.create', 'POST', '/v1/teams', {}, { capability: 'teams.write', surfaces: ['rest', 'cli', 'mcp_tool'] }),
		profile: resource('teams.profile.show', 'GET', '/v1/teams/by-name/{name}/profile', { name: z.string().min(1) }, { capability: 'teams.read', surfaces: ['rest', 'mcp_resource'] }),
		update: resource('teams.update', 'PATCH', '/v1/teams/{teamId}', { teamId: z.string().min(1) }, { capability: 'teams.write', concurrency: true }),
		access: resource('teams.access.show', 'GET', '/v1/teams/{teamId}/access', { teamId: z.string().min(1) }, { capability: 'teams.read' }),
		members: resource('teams.members.list', 'GET', '/v1/teams/{teamId}/members', { teamId: z.string().min(1) }, { capability: 'teams.read', pagination: 'cursor' }),
		invite: resource('teams.invites.create', 'POST', '/v1/teams/{teamId}/invites', { teamId: z.string().min(1) }, { capability: 'teams.write' }),
		invites: resource('teams.invites.list', 'GET', '/v1/teams/{teamId}/invites', { teamId: z.string().min(1) }, { capability: 'teams.read', pagination: 'cursor' }),
		inviteShow: resource('teams.invites.show', 'GET', '/v1/team-invites/{token}', { token: z.string().min(1) }, { capability: 'teams.join', scopes: [], redactedPaths: ['path.token'] }),
		inviteAccept: resource('teams.invites.accept', 'POST', '/v1/team-invites/{token}/accept', { token: z.string().min(1) }, { capability: 'teams.join', redactedPaths: ['path.token'] }),
		updateMember: resource('teams.members.update', 'PATCH', '/v1/teams/{teamId}/members/{membershipId}', { teamId: z.string().min(1), membershipId: z.string().min(1) }, { capability: 'teams.write', concurrency: true }),
		removeMember: resource('teams.members.delete', 'DELETE', '/v1/teams/{teamId}/members/{membershipId}', { teamId: z.string().min(1), membershipId: z.string().min(1) }, { capability: 'teams.write', risk: 'destructive', concurrency: true }),
		archive: resource('teams.archive', 'POST', '/v1/teams/{teamId}/archive', { teamId: z.string().min(1) }, { capability: 'teams.write', risk: 'destructive', concurrency: true }),
		restore: resource('teams.restore', 'POST', '/v1/teams/{teamId}/restore', { teamId: z.string().min(1) }, { capability: 'teams.write', concurrency: true }),
		deletionReadiness: resource('teams.deletion.readiness', 'GET', '/v1/teams/{teamId}/deletion-readiness', { teamId: z.string().min(1) }, { capability: 'teams.read' }),
		transferOwnership: resource('teams.ownership.transfer', 'POST', '/v1/teams/{teamId}/ownership-transfer', { teamId: z.string().min(1) }, { capability: 'teams.admin', risk: 'authority', concurrency: true }),
		leave: resource('teams.leave', 'POST', '/v1/teams/{teamId}/leave', { teamId: z.string().min(1) }, { capability: 'teams.write', risk: 'destructive' }),
	},
	discussions: {
		list: resource('discussions.list', 'GET', '/v1/discussions', {}, { capability: 'discussions.read', surfaces: ['rest', 'mcp_tool', 'mcp_resource'], pagination: 'cursor' }),
		create: resource('discussions.create', 'POST', '/v1/discussions', {}, { capability: 'discussions.write', scopes: ['treeseed:knowledge:write'], surfaces: ['rest', 'mcp_tool'] }),
		updateStatus: resource('discussions.status.update', 'POST', '/v1/discussions/{discussionId}/status', { discussionId: z.string().min(1) }, { capability: 'discussions.write', scopes: ['treeseed:knowledge:write'], concurrency: true }),
	},
	knowledge: {
		library: resource('knowledge.library.list', 'GET', '/v1/knowledge/library', {}, { capability: 'knowledge.read', surfaces: ['rest', 'mcp_tool', 'mcp_resource'], pagination: 'cursor' }),
		reader: resource('knowledge.reader.show', 'GET', '/v1/knowledge/reader', {}, { capability: 'knowledge.read', surfaces: ['rest', 'mcp_resource'] }),
		context: resource('knowledge.context.show', 'GET', '/v1/knowledge/context', {}, { capability: 'knowledge.read', surfaces: ['rest', 'mcp_tool'] }),
		page: resource('knowledge.pages.show', 'GET', '/v1/knowledge/pages/{pageId}', { pageId: z.string().min(1) }, { capability: 'knowledge.read', surfaces: ['rest', 'mcp_resource'] }),
		search: resource('knowledge.search', 'GET', '/v1/knowledge/search', {}, { capability: 'knowledge.read', surfaces: ['rest', 'mcp_tool'], pagination: 'cursor' }),
		teamCatalog: resource('knowledge.catalog.team', 'GET', '/v1/teams/{teamId}/knowledge/catalog', { teamId: z.string().min(1) }, { capability: 'knowledge.read', pagination: 'cursor' }),
		projectCatalog: resource('knowledge.catalog.project', 'GET', '/v1/projects/{projectId}/knowledge/catalog', { projectId: z.string().min(1) }, { capability: 'knowledge.read', pagination: 'cursor' }),
		createWorkspace: resource('knowledge.workspaces.create', 'POST', '/v1/projects/{projectId}/knowledge/workspaces', { projectId: z.string().min(1) }, { capability: 'knowledge.write', scopes: ['treeseed:knowledge:write'] }),
		workspace: resource('knowledge.workspaces.show', 'GET', '/v1/knowledge/workspaces/{workspaceId}', { workspaceId: z.string().min(1) }, { capability: 'knowledge.read' }),
		workspaceContent: resource('knowledge.workspaces.content.show', 'GET', '/v1/knowledge/workspaces/{workspaceId}/content', { workspaceId: z.string().min(1) }, { capability: 'knowledge.read' }),
		updateWorkspaceContent: resource('knowledge.workspaces.content.update', 'PUT', '/v1/knowledge/workspaces/{workspaceId}/content', { workspaceId: z.string().min(1) }, { capability: 'knowledge.write', scopes: ['treeseed:knowledge:write'], concurrency: true }),
		workspaceDiff: resource('knowledge.workspaces.diff', 'GET', '/v1/knowledge/workspaces/{workspaceId}/diff', { workspaceId: z.string().min(1) }, { capability: 'knowledge.read' }),
		abandonWorkspace: resource('knowledge.workspaces.abandon', 'POST', '/v1/knowledge/workspaces/{workspaceId}/abandon', { workspaceId: z.string().min(1) }, { capability: 'knowledge.write', scopes: ['treeseed:knowledge:write'], risk: 'destructive', concurrency: true }),
		submitWorkspace: resource('knowledge.workspaces.submit', 'POST', '/v1/knowledge/workspaces/{workspaceId}/submit', { workspaceId: z.string().min(1) }, { capability: 'knowledge.write', scopes: ['treeseed:knowledge:write'], concurrency: true }),
		reviews: resource('knowledge.reviews.list', 'GET', '/v1/teams/{teamId}/knowledge/reviews', { teamId: z.string().min(1) }, { capability: 'knowledge.review', pagination: 'cursor' }),
		commentReview: resource('knowledge.reviews.comments.create', 'POST', '/v1/knowledge/reviews/{reviewId}/comments', { reviewId: z.string().min(1) }, { capability: 'knowledge.review', scopes: ['treeseed:knowledge:write'] }),
		decideReview: resource('knowledge.reviews.decide', 'POST', '/v1/knowledge/reviews/{reviewId}/decision', { reviewId: z.string().min(1) }, { capability: 'knowledge.review', scopes: ['treeseed:knowledge:write'], concurrency: true }),
		publishReview: resource('knowledge.reviews.publish', 'POST', '/v1/knowledge/reviews/{reviewId}/publish', { reviewId: z.string().min(1) }, { capability: 'knowledge.publish', scopes: ['treeseed:knowledge:write'], concurrency: true }),
	},
	governance: {
		proposals: resource('governance.proposals.list', 'GET', '/v1/projects/{projectId}/proposals', { projectId: z.string().min(1) }, { capability: 'governance.read', surfaces: ['rest', 'mcp_tool', 'mcp_resource'], pagination: 'cursor' }),
		createProposal: resource('governance.proposals.create', 'POST', '/v1/projects/{projectId}/proposals', { projectId: z.string().min(1) }, { capability: 'governance.write', scopes: ['treeseed:governance:write'], surfaces: ['rest', 'mcp_tool'] }),
		proposal: resource('governance.proposals.show', 'GET', '/v1/projects/{projectId}/proposals/{proposalId}', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.read', surfaces: ['rest', 'mcp_resource'] }),
		updateProposal: resource('governance.proposals.update', 'PATCH', '/v1/projects/{projectId}/proposals/{proposalId}', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.write', scopes: ['treeseed:governance:write'], concurrency: true }),
		openProposal: resource('governance.proposals.open', 'POST', '/v1/projects/{projectId}/proposals/{proposalId}/open', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.write', scopes: ['treeseed:governance:write'], concurrency: true }),
		startVoting: resource('governance.proposals.voting.start', 'POST', '/v1/projects/{projectId}/proposals/{proposalId}/start-voting', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.write', scopes: ['treeseed:governance:write'], concurrency: true }),
		vote: resource('governance.proposals.vote', 'POST', '/v1/projects/{projectId}/proposals/{proposalId}/vote', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.write', scopes: ['treeseed:governance:write'] }),
		evaluate: resource('governance.proposals.evaluate', 'POST', '/v1/projects/{projectId}/proposals/{proposalId}/evaluate', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.decide', scopes: ['treeseed:governance:write'], concurrency: true }),
		withdraw: resource('governance.proposals.withdraw', 'POST', '/v1/projects/{projectId}/proposals/{proposalId}/withdraw', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.write', scopes: ['treeseed:governance:write'], risk: 'destructive', concurrency: true }),
		supersede: resource('governance.proposals.supersede', 'POST', '/v1/projects/{projectId}/proposals/{proposalId}/supersede', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.write', scopes: ['treeseed:governance:write'], concurrency: true }),
		proposalEvents: resource('governance.proposals.events', 'GET', '/v1/projects/{projectId}/proposals/{proposalId}/events', { projectId: z.string().min(1), proposalId: z.string().min(1) }, { capability: 'governance.read', pagination: 'cursor' }),
		decisions: resource('governance.decisions.list', 'GET', '/v1/projects/{projectId}/decisions', { projectId: z.string().min(1) }, { capability: 'governance.read', surfaces: ['rest', 'mcp_tool', 'mcp_resource'], pagination: 'cursor' }),
		decision: resource('governance.decisions.show', 'GET', '/v1/projects/{projectId}/decisions/{decisionId}', { projectId: z.string().min(1), decisionId: z.string().min(1) }, { capability: 'governance.read', surfaces: ['rest', 'mcp_resource'] }),
		decisionEvents: resource('governance.decisions.events', 'GET', '/v1/projects/{projectId}/decisions/{decisionId}/events', { projectId: z.string().min(1), decisionId: z.string().min(1) }, { capability: 'governance.read', pagination: 'cursor' }),
		approvals: resource('governance.approvals.list', 'GET', '/v1/projects/{projectId}/approvals', { projectId: z.string().min(1) }, { capability: 'governance.read', pagination: 'cursor' }),
		approval: resource('governance.approvals.show', 'GET', '/v1/projects/{projectId}/approvals/{approvalId}', { projectId: z.string().min(1), approvalId: z.string().min(1) }, { capability: 'governance.read' }),
		decideApproval: resource('governance.approvals.decide', 'POST', '/v1/projects/{projectId}/approvals/{approvalId}/decision', { projectId: z.string().min(1), approvalId: z.string().min(1) }, { capability: 'governance.decide', scopes: ['treeseed:governance:write'], risk: 'authority', concurrency: true }),
	},
	repositories: {
		githubSetup: resource('repositories.github.setup', 'POST', '/v1/provider-connectors/github/{kind}/setup', { kind: z.string().min(1) }, { capability: 'repositories.connect', scopes: ['treeseed:projects:write'], risk: 'authority' }),
		githubCallback: resource('repositories.github.callback', 'GET', '/v1/provider-connectors/github/{kind}/callback', { kind: z.string().min(1) }, { capability: 'repositories.connect', scopes: [] }),
		githubWebhook: resource('repositories.github.webhook', 'POST', '/v1/provider-webhooks/github/{kind}', { kind: z.string().min(1) }, { capability: 'repositories.webhook', scopes: [], redactedPaths: ['body'] }),
		workflowOperations: resource('repositories.workflows.list', 'GET', '/v1/projects/{projectId}/workflow-operations', { projectId: z.string().min(1) }, { capability: 'workflows.read', pagination: 'cursor' }),
		workflowRuns: resource('repositories.workflow.runs.list', 'GET', '/v1/projects/{projectId}/workflow-operation-runs', { projectId: z.string().min(1) }, { capability: 'workflows.read', pagination: 'cursor' }),
		updateWorkflow: resource('repositories.workflows.update', 'PUT', '/v1/projects/{projectId}/workflow-operations/{operationId}', { projectId: z.string().min(1), operationId: z.string().min(1) }, { capability: 'workflows.write', concurrency: true }),
		dispatchWorkflow: resource('repositories.workflows.dispatch', 'POST', '/v1/projects/{projectId}/workflow-operations/{operationId}/dispatch', { projectId: z.string().min(1), operationId: z.string().min(1) }, { capability: 'workflows.execute' }),
		workflowRun: resource('repositories.workflow.runs.show', 'GET', '/v1/workflow-operation-runs/{runId}', { runId: z.string().min(1) }, { capability: 'workflows.read' }),
		cancelWorkflowRun: resource('repositories.workflow.runs.cancel', 'POST', '/v1/workflow-operation-runs/{runId}/cancel', { runId: z.string().min(1) }, { capability: 'workflows.execute', risk: 'destructive' }),
		workflowArtifacts: resource('repositories.workflow.artifacts.list', 'GET', '/v1/workflow-operation-runs/{runId}/artifacts', { runId: z.string().min(1) }, { capability: 'workflows.read', pagination: 'cursor' }),
		workflowPublicKey: resource('repositories.workflow.configuration.key', 'GET', '/v1/projects/{projectId}/workflow-configuration/secrets/public-key', { projectId: z.string().min(1) }, { capability: 'workflows.read' }),
		workflowSecrets: resource('repositories.workflow.secrets.list', 'GET', '/v1/projects/{projectId}/workflow-configuration/secrets', { projectId: z.string().min(1) }, { capability: 'secrets.read', pagination: 'cursor' }),
		putWorkflowSecret: resource('repositories.workflow.secrets.put', 'PUT', '/v1/projects/{projectId}/workflow-configuration/secrets/{name}', { projectId: z.string().min(1), name: z.string().min(1) }, { capability: 'secrets.write', risk: 'credential', redactedPaths: ['body'] }),
		deleteWorkflowSecret: resource('repositories.workflow.secrets.delete', 'DELETE', '/v1/projects/{projectId}/workflow-configuration/secrets/{name}', { projectId: z.string().min(1), name: z.string().min(1) }, { capability: 'secrets.write', risk: 'credential' }),
		workflowVariables: resource('repositories.workflow.variables.list', 'GET', '/v1/projects/{projectId}/workflow-configuration/variables', { projectId: z.string().min(1) }, { capability: 'workflows.read', pagination: 'cursor' }),
		putWorkflowVariable: resource('repositories.workflow.variables.put', 'PUT', '/v1/projects/{projectId}/workflow-configuration/variables/{name}', { projectId: z.string().min(1), name: z.string().min(1) }, { capability: 'workflows.write', concurrency: true }),
		deleteWorkflowVariable: resource('repositories.workflow.variables.delete', 'DELETE', '/v1/projects/{projectId}/workflow-configuration/variables/{name}', { projectId: z.string().min(1), name: z.string().min(1) }, { capability: 'workflows.write', risk: 'destructive', concurrency: true }),
	},
	services: {
		providers: resource('services.providers.list', 'GET', '/v1/service-providers', {}, { capability: 'services.read', surfaces: ['rest', 'cli', 'mcp_tool'] }),
		connections: resource('services.connections.list', 'GET', '/v1/teams/{teamId}/services', { teamId: z.string().min(1) }, { capability: 'services.read', surfaces: ['rest', 'cli', 'mcp_tool'], pagination: 'cursor' }),
		connection: resource('services.connections.show', 'GET', '/v1/teams/{teamId}/services/{connectionId}', { teamId: z.string().min(1), connectionId: z.string().min(1) }, { capability: 'services.read', surfaces: ['rest', 'cli', 'mcp_resource'] }),
		createConnection: resource('services.connections.create', 'POST', '/v1/teams/{teamId}/services', { teamId: z.string().min(1) }, { capability: 'services.write', surfaces: ['rest', 'cli', 'mcp_tool'] }),
		updateConnection: resource('services.connections.update', 'PUT', '/v1/teams/{teamId}/services/{connectionId}', { teamId: z.string().min(1), connectionId: z.string().min(1) }, { capability: 'services.write', surfaces: ['rest', 'cli', 'mcp_tool'], concurrency: true }),
		disconnect: resource('services.connections.disconnect', 'DELETE', '/v1/teams/{teamId}/services/{connectionId}', { teamId: z.string().min(1), connectionId: z.string().min(1) }, { capability: 'services.write', surfaces: ['rest', 'cli', 'mcp_tool'], risk: 'destructive', concurrency: true }),
		authorities: resource('services.credential.authorities.list', 'GET', '/v1/teams/{teamId}/services/{connectionId}/credential-authorities', { teamId: z.string().min(1), connectionId: z.string().min(1) }, { capability: 'secrets.read', surfaces: ['rest', 'cli'], pagination: 'cursor' }),
		putAuthority: resource('services.credential.authorities.put', 'PUT', '/v1/teams/{teamId}/services/{connectionId}/credential-authorities/{profileId}', { teamId: z.string().min(1), connectionId: z.string().min(1), profileId: z.string().min(1) }, { capability: 'secrets.write', surfaces: ['rest', 'cli'], risk: 'credential', concurrency: true, redactedPaths: ['body'] }),
	},
	agents: {
		list: resource('agents.list', 'GET', '/v1/projects/{projectId}/agents', { projectId: z.string().min(1) }, { capability: 'agents.read', surfaces: ['rest', 'cli', 'mcp_tool'], pagination: 'cursor' }),
		show: resource('agents.show', 'GET', '/v1/projects/{projectId}/agents/{agentSlug}', { projectId: z.string().min(1), agentSlug: z.string().min(1) }, { capability: 'agents.read', surfaces: ['rest', 'cli', 'mcp_resource'] }),
		classes: resource('agents.classes.list', 'GET', '/v1/projects/{projectId}/agent-classes', { projectId: z.string().min(1) }, { capability: 'agents.read', surfaces: ['rest', 'cli'], pagination: 'cursor' }),
		classShow: resource('agents.classes.show', 'GET', '/v1/projects/{projectId}/agent-classes/{classId}', { projectId: z.string().min(1), classId: z.string().min(1) }, { capability: 'agents.read', surfaces: ['rest', 'cli'] }),
		artifacts: resource('agents.artifacts.list', 'GET', '/v1/projects/{projectId}/agent-artifacts', { projectId: z.string().min(1) }, { capability: 'agents.read', pagination: 'cursor' }),
		artifact: resource('agents.artifacts.show', 'GET', '/v1/projects/{projectId}/agent-artifacts/{artifactId}', { projectId: z.string().min(1), artifactId: z.string().min(1) }, { capability: 'agents.read' }),
	},
	capacity: {
		availability: resource('capacity.status', 'GET', '/v1/teams/{teamId}/capacity/availability-sessions', { teamId: z.string().min(1) }, { capability: 'capacity.read', surfaces: ['rest', 'cli', 'mcp_tool'], pagination: 'cursor' }),
		usage: resource('capacity.usage', 'GET', '/v1/teams/{teamId}/capacity/usage', { teamId: z.string().min(1) }, { capability: 'capacity.read', surfaces: ['rest', 'cli', 'mcp_tool'] }),
		ledger: resource('capacity.ledger', 'GET', '/v1/teams/{teamId}/capacity/ledger', { teamId: z.string().min(1) }, { capability: 'capacity.read', surfaces: ['rest', 'cli'], pagination: 'cursor' }),
		grants: resource('capacity.grants.list', 'GET', '/v1/teams/{teamId}/capacity-grants', { teamId: z.string().min(1) }, { capability: 'capacity.read', pagination: 'cursor' }),
		grant: resource('capacity.grants.show', 'GET', '/v1/teams/{teamId}/capacity-grants/{grantId}', { teamId: z.string().min(1), grantId: z.string().min(1) }, { capability: 'capacity.read' }),
	},
	plans: {
		list: resource('plans.list', 'GET', '/v1/decisions/{decisionId}/capacity-plans', { decisionId: z.string().min(1) }, { capability: 'plans.read', surfaces: ['rest', 'cli', 'mcp_tool'], pagination: 'cursor' }),
		show: resource('plans.show', 'GET', '/v1/capacity-plans/{capacityPlanId}', { capacityPlanId: z.string().min(1) }, { capability: 'plans.read', surfaces: ['rest', 'cli', 'mcp_resource'] }),
	},
	workdays: {
		list: resource('workdays.list', 'GET', '/v1/teams/{teamId}/workday-runs', { teamId: z.string().min(1) }, { capability: 'workdays.read', surfaces: ['rest', 'cli', 'mcp_tool'], pagination: 'cursor' }),
		preflight: resource('workdays.plan', 'POST', '/v1/teams/{teamId}/workday-runs/preflight', { teamId: z.string().min(1) }, { capability: 'workdays.execute', scopes: ['treeseed:execution'], surfaces: ['rest', 'cli', 'mcp_tool'] }),
		start: resource('workdays.start', 'POST', '/v1/teams/{teamId}/workday-runs', { teamId: z.string().min(1) }, { capability: 'workdays.execute', scopes: ['treeseed:execution'], surfaces: ['rest', 'cli', 'mcp_tool'] }),
		show: resource('workdays.show', 'GET', '/v1/teams/{teamId}/workday-runs/{runId}', { teamId: z.string().min(1), runId: z.string().min(1) }, { capability: 'workdays.read', surfaces: ['rest', 'cli', 'mcp_resource'] }),
		events: resource('workdays.events.list', 'GET', '/v1/teams/{teamId}/workday-runs/{runId}/events', { teamId: z.string().min(1), runId: z.string().min(1) }, { capability: 'workdays.read', pagination: 'cursor' }),
		schedules: resource('workdays.schedules.list', 'GET', '/v1/teams/{teamId}/workday-schedules', { teamId: z.string().min(1) }, { capability: 'workdays.read', surfaces: ['rest', 'cli'], pagination: 'cursor' }),
		createSchedule: resource('workdays.schedules.create', 'POST', '/v1/teams/{teamId}/workday-schedules', { teamId: z.string().min(1) }, { capability: 'workdays.execute', scopes: ['treeseed:execution'], surfaces: ['rest', 'cli'] }),
		updateSchedule: resource('workdays.schedules.update', 'PATCH', '/v1/teams/{teamId}/workday-schedules/{scheduleId}', { teamId: z.string().min(1), scheduleId: z.string().min(1) }, { capability: 'workdays.execute', scopes: ['treeseed:execution'], surfaces: ['rest', 'cli'], concurrency: true }),
	},
	assignments: {
		list: resource('assignments.list', 'GET', '/v1/teams/{teamId}/capacity/assignments', { teamId: z.string().min(1) }, { capability: 'assignments.read', surfaces: ['rest', 'cli', 'mcp_tool'], pagination: 'cursor' }),
		show: resource('assignments.show', 'GET', '/v1/teams/{teamId}/capacity/assignments/{assignmentId}', { teamId: z.string().min(1), assignmentId: z.string().min(1) }, { capability: 'assignments.read', surfaces: ['rest', 'cli', 'mcp_resource'] }),
		explain: resource('assignments.explain', 'GET', '/v1/teams/{teamId}/capacity/assignments/{assignmentId}/explanation', { teamId: z.string().min(1), assignmentId: z.string().min(1) }, { capability: 'assignments.read', surfaces: ['rest', 'cli', 'mcp_tool'] }),
		cancel: resource('assignments.cancel', 'POST', '/v1/teams/{teamId}/capacity/assignments/{assignmentId}/cancel', { teamId: z.string().min(1), assignmentId: z.string().min(1) }, { capability: 'assignments.execute', scopes: ['treeseed:execution'], surfaces: ['rest', 'cli', 'mcp_tool'], risk: 'destructive' }),
		retry: resource('assignments.retry', 'POST', '/v1/teams/{teamId}/capacity/assignments/{assignmentId}/requeue', { teamId: z.string().min(1), assignmentId: z.string().min(1) }, { capability: 'assignments.execute', scopes: ['treeseed:execution'], surfaces: ['rest', 'cli', 'mcp_tool'] }),
	},
	operations: {
		list: resource('operations.list', 'GET', '/v1/platform/operations', {}, { capability: 'operations.read', surfaces: ['rest', 'mcp_tool'], pagination: 'cursor' }),
		create: resource('operations.create', 'POST', '/v1/platform/operations', {}, { capability: 'operations.execute', scopes: ['treeseed:execution'] }),
		show: resource('operations.show', 'GET', '/v1/platform/operations/{operationId}', { operationId: z.string().min(1) }, { capability: 'operations.read', surfaces: ['rest', 'mcp_resource'] }),
		events: resource('operations.events.list', 'GET', '/v1/platform/operations/{operationId}/events', { operationId: z.string().min(1) }, { capability: 'operations.read', pagination: 'cursor' }),
		cancel: resource('operations.cancel', 'POST', '/v1/platform/operations/{operationId}/cancel', { operationId: z.string().min(1) }, { capability: 'operations.execute', scopes: ['treeseed:execution'], risk: 'destructive' }),
		retry: resource('operations.retry', 'POST', '/v1/platform/operations/{operationId}/retry', { operationId: z.string().min(1) }, { capability: 'operations.execute', scopes: ['treeseed:execution'] }),
	},
	seeds: {
		runs: resource('seeds.runs.list', 'GET', '/v1/seeds/runs', {}, { capability: 'seeds.read', pagination: 'cursor' }),
		run: resource('seeds.runs.show', 'GET', '/v1/seeds/runs/{runId}', { runId: z.string().min(1) }, { capability: 'seeds.read' }),
		plan: resource('seeds.plan', 'POST', '/v1/seeds/{name}/plan', { name: z.string().min(1) }, { capability: 'seeds.write', scopes: ['treeseed:admin'] }),
		apply: resource('seeds.apply', 'POST', '/v1/seeds/{name}/apply', { name: z.string().min(1) }, { capability: 'seeds.write', scopes: ['treeseed:admin'], risk: 'authority' }),
		resolveResources: resource('seeds.resources.resolve', 'POST', '/v1/seeds/resources/resolve', {}, { capability: 'seeds.read', scopes: ['treeseed:admin'] }),
	},
	feedback: {
		create: resource('feedback.create', 'POST', '/v1/feedback', {}, { capability: 'feedback.write', scopes: [], surfaces: ['rest', 'mcp_tool'] }),
		list: resource('feedback.list', 'GET', '/v1/admin/feedback', {}, { capability: 'feedback.admin', scopes: ['treeseed:admin'], pagination: 'cursor' }),
		show: resource('feedback.show', 'GET', '/v1/admin/feedback/{feedbackId}', { feedbackId: z.string().min(1) }, { capability: 'feedback.admin', scopes: ['treeseed:admin'] }),
		updateStatus: resource('feedback.status.update', 'PATCH', '/v1/admin/feedback/{feedbackId}/status', { feedbackId: z.string().min(1) }, { capability: 'feedback.admin', scopes: ['treeseed:admin'], concurrency: true }),
	},
	realtime: {
		events: resource('realtime.events.list', 'GET', '/v1/session/events', {}, { capability: 'realtime.read', pagination: 'cursor' }),
		createSession: resource('realtime.sessions.create', 'POST', '/v1/client-sessions', {}, { capability: 'realtime.write' }),
		heartbeat: resource('realtime.sessions.heartbeat', 'POST', '/v1/client-sessions/{sessionId}/heartbeat', { sessionId: z.string().min(1) }, { capability: 'realtime.write' }),
		actions: resource('realtime.actions.list', 'GET', '/v1/client-sessions/{sessionId}/actions', { sessionId: z.string().min(1) }, { capability: 'realtime.read', pagination: 'cursor' }),
		actionResult: resource('realtime.actions.result', 'POST', '/v1/client-sessions/{sessionId}/actions/{actionId}/result', { sessionId: z.string().min(1), actionId: z.string().min(1) }, { capability: 'realtime.write' }),
	},
	providers: {
		register: noPathProvider('providers.register', 'POST', '/v1/provider-registrations', { redactedPaths: ['body.registrationKey'] }),
		registration: providerPath('providers.registration.show', 'GET', '/v1/provider-registrations/{requestId}', { requestId: z.string().min(1) }, { read: true }),
		exchangeCredential: providerPath('providers.registration.credential', 'POST', '/v1/provider-registrations/{requestId}/credential', { requestId: z.string().min(1) }, { redactedPaths: ['body.proof'] }),
		issueAccessToken: noPathProvider('providers.token.issue', 'POST', '/v1/provider/access-tokens', { redactedPaths: ['body.credential', 'body.proof'] }),
		leaveMembership: noPathProvider('providers.membership.leave', 'POST', '/v1/provider/membership/leave'),
		rotateIdentity: noPathProvider('providers.identity.rotate', 'POST', '/v1/provider/identity/rotate', { redactedPaths: ['body.oldProof', 'body.newProof'] }),
		rotateCredential: noPathProvider('providers.credential.rotate', 'POST', '/v1/provider/credential-rotation'),
		createAvailability: noPathProvider('providers.availability.create', 'POST', '/v1/provider/availability-sessions'),
		refreshAvailability: providerPath('providers.availability.refresh', 'PUT', '/v1/provider/availability-sessions/{sessionId}', { sessionId: z.string().min(1) }),
		closeAvailability: providerPath('providers.availability.close', 'POST', '/v1/provider/availability-sessions/{sessionId}/close', { sessionId: z.string().min(1) }),
		nextAssignment: noPathProvider('providers.assignments.next', 'POST', '/v1/provider/assignments/next'),
		assignment: providerPath('providers.assignments.show', 'GET', '/v1/provider/assignments/{assignmentId}', { assignmentId: z.string().min(1) }, { read: true }),
		assignmentExplanation: providerPath('providers.assignments.explain', 'GET', '/v1/provider/assignments/{assignmentId}/explanation', { assignmentId: z.string().min(1) }, { read: true }),
		renewAssignment: providerPath('providers.assignments.renew', 'POST', '/v1/provider/assignments/{assignmentId}/renew', { assignmentId: z.string().min(1) }),
		startExecution: providerPath('providers.assignments.execution.start', 'POST', '/v1/provider/assignments/{assignmentId}/execution-start', { assignmentId: z.string().min(1) }),
		startCloseout: providerPath('providers.assignments.closeout.start', 'POST', '/v1/provider/assignments/{assignmentId}/closeout-start', { assignmentId: z.string().min(1) }),
		completionPreflight: providerPath('providers.assignments.completion.preflight', 'POST', '/v1/provider/assignments/{assignmentId}/completion-preflight', { assignmentId: z.string().min(1) }),
		returnAssignment: providerPath('providers.assignments.return', 'POST', '/v1/provider/assignments/{assignmentId}/return', { assignmentId: z.string().min(1) }),
		completeAssignment: providerPath('providers.assignments.complete', 'POST', '/v1/provider/assignments/{assignmentId}/complete', { assignmentId: z.string().min(1) }),
		failAssignment: providerPath('providers.assignments.fail', 'POST', '/v1/provider/assignments/{assignmentId}/fail', { assignmentId: z.string().min(1) }),
		reportUsage: providerPath('providers.assignments.usage', 'POST', '/v1/provider/assignments/{assignmentId}/usage', { assignmentId: z.string().min(1) }),
		settleAssignment: providerPath('providers.assignments.settle', 'POST', '/v1/provider/assignments/{assignmentId}/settle', { assignmentId: z.string().min(1) }),
		createModeRun: providerPath('providers.assignments.mode.run', 'POST', '/v1/provider/assignments/{assignmentId}/mode-runs', { assignmentId: z.string().min(1) }),
		createEvent: providerPath('providers.assignments.event.create', 'POST', '/v1/provider/assignments/{assignmentId}/events', { assignmentId: z.string().min(1) }),
		publishSignal: providerPath('providers.assignments.signal.publish', 'POST', '/v1/provider/assignments/{assignmentId}/signals', { assignmentId: z.string().min(1) }),
		dispatchWorkflow: providerPath('providers.assignments.workflow.dispatch', 'POST', '/v1/provider/assignments/{assignmentId}/workflow-operations/{operationId}/dispatch', { assignmentId: z.string().min(1), operationId: z.string().min(1) }),
		workflowRun: providerPath('providers.assignments.workflow.show', 'GET', '/v1/provider/assignments/{assignmentId}/workflow-runs/{runId}', { assignmentId: z.string().min(1), runId: z.string().min(1) }, { read: true }),
	},
} as const;

function flatten(value: unknown, output: ControlPlaneOperationBinding<any, any, any, any>[] = []) {
	if (value && typeof value === 'object' && 'descriptor' in value && 'schema' in value) output.push(value as ControlPlaneOperationBinding<any, any, any, any>);
	else if (value && typeof value === 'object') for (const child of Object.values(value)) flatten(child, output);
	return output;
}

export const CONTROL_PLANE_OPERATION_LIST = Object.freeze(flatten(CONTROL_PLANE_OPERATIONS));
export const CONTROL_PLANE_CATALOG = Object.freeze({
	schemaVersion: 'treeseed.control-plane-catalog/v1' as const,
	operations: CONTROL_PLANE_OPERATION_LIST.map((operation) => operation.descriptor),
});

export function controlPlaneOperation(operationId: string) {
	const operation = CONTROL_PLANE_OPERATION_LIST.find((candidate) => candidate.descriptor.operationId === operationId);
	if (!operation) throw new Error(`Unknown control-plane operation ${operationId}.`);
	return operation;
}
