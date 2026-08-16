import { CAPACITY_CONFIGURATION_DESCRIPTORS,type CapacityConfigurationFamily } from '../configuration/configuration.ts';

export type CapacityOperatorConfiguration = CapacityConfigurationFamily;
export type CapacityOperatorAccess = 'team-read' | 'team-manage' | 'project-read' | 'project-manage' | 'provider-proof' | 'provider-access-token' | 'provider-owner-local';

export interface CapacityOperatorCapability {
	id: string;
	cliAction: string;
	apiRouteIds: readonly string[];
	kind: 'read' | 'validate' | 'plan' | 'mutation' | 'export' | 'local-runtime';
	access: CapacityOperatorAccess;
	mutationMode: 'none' | 'plan-only' | 'plan-execute' | 'local-live';
	confirmation: 'none' | 'execute' | 'yes';
	uiAvailable: boolean;
	agentVisibility: 'operator' | 'assignment-scoped' | 'none';
	paginated?: boolean;
	idempotent?: boolean;
	secretConfirmation?: boolean;
	configuration?: CapacityOperatorConfiguration;
	configurationInputs?: readonly CapacityOperatorConfiguration[];
}

function capability(
	id: string,
	cliAction: string,
	kind: CapacityOperatorCapability['kind'],
	apiRouteIds: string[] = [],
	options: Omit<CapacityOperatorCapability, 'id' | 'cliAction' | 'kind' | 'apiRouteIds' | 'access'> & { access?: CapacityOperatorAccess } = {},
): CapacityOperatorCapability {
	const secretConfirmation = options.secretConfirmation === true;
	return {
		id, cliAction, kind, apiRouteIds,
		access: options.access ?? accessFor(id, kind),
		mutationMode: kind === 'mutation' ? 'plan-execute' : kind === 'plan' ? 'plan-only' : kind === 'local-runtime' ? 'local-live' : 'none',
		confirmation: secretConfirmation ? 'yes' : kind === 'mutation' ? 'execute' : 'none',
		uiAvailable: !id.startsWith('provider.identity.') && !id.startsWith('provider.runtime.'),
		agentVisibility: id.startsWith('provider.') ? 'none' : 'operator',
		...options,
	};
}

function accessFor(id: string, kind: CapacityOperatorCapability['kind']): CapacityOperatorAccess {
	if (id.startsWith('provider.')) {
		if (id === 'provider.join' || id === 'provider.registration-status' || id === 'provider.credential-exchange') return 'provider-proof';
		if (id === 'provider.identity.rotate' || id === 'provider.credential-rotate' || id === 'provider.connections.leave' || id === 'provider.offer.apply') return 'provider-access-token';
		return 'provider-owner-local';
	}
	if (id.startsWith('agent-classes.')) return kind === 'read' ? 'project-read' : 'project-manage';
	if (id.startsWith('capacity-plans.')) return kind === 'read' ? 'project-read' : 'project-manage';
	if (id === 'workdays.tick') return 'team-manage';
	if (id.startsWith('workdays.')) return kind === 'read' ? 'project-read' : 'project-manage';
	if (id.startsWith('registration-key.')) return 'team-manage';
	if (id.startsWith('registration-requests.') || id.startsWith('memberships.') || id.startsWith('credentials.')) return kind === 'read' ? 'team-read' : 'team-manage';
	if (id.startsWith('grants.') || id.startsWith('allocations.')) return kind === 'read' ? 'team-read' : 'team-manage';
	if (id.startsWith('assignments.') || id.startsWith('reservations.') || id.startsWith('usage.') || id.startsWith('ledger.') || id.startsWith('audit.')) return kind === 'read' || kind === 'export' ? 'team-read' : 'team-manage';
	return kind === 'read' || kind === 'export' ? 'team-read' : 'team-manage';
}

export const CAPACITY_OPERATOR_CAPABILITIES: readonly CapacityOperatorCapability[] = [
	capability('operator.capabilities', 'capabilities', 'read', [], { uiAvailable: false, agentVisibility: 'operator' }),
	capability('discussions.read', 'discussion-read', 'read', ['get.v1.discussions'], { access:'project-read',uiAvailable:false }),
	capability('discussions.send', 'discussion-send', 'mutation', ['post.v1.discussions'], { access:'project-read',idempotent:true,uiAvailable:false }),
	capability('invocations.list','agent-invocations','read',['get.v1.teams.teamId.agent-invocations'],{paginated:true,uiAvailable:false}),
	capability('invocations.show','agent-invocation','read',['get.v1.teams.teamId.agent-invocations.invocationId'],{uiAvailable:false}),
	capability('invocations.cancel','agent-invocation-cancel','mutation',['post.v1.teams.teamId.agent-invocations.invocationId.cancel'],{idempotent:true,uiAvailable:false}),
	capability('communication.status','communication-status','read',['get.v1.teams.teamId.communication-status'],{uiAvailable:false}),
	capability('operation-handoffs.list','operation-handoffs','read',['get.v1.teams.teamId.operation-handoffs'],{paginated:true,uiAvailable:false}),
	capability('client-actions.list','client-actions','read',['get.v1.teams.teamId.client-actions'],{paginated:true,uiAvailable:false}),
	capability('registration-key.show', 'registration-key', 'read', ['get.v1.teams.teamId.capacity-registration-key']),
	capability('registration-key.reveal', 'registration-key-reveal', 'read', ['get.v1.teams.teamId.capacity-registration-key.reveal'], { secretConfirmation: true }),
	capability('registration-key.rotate', 'registration-key-rotate', 'mutation', ['post.v1.teams.teamId.capacity-registration-key.rotate'], { idempotent: true, secretConfirmation: true }),
	capability('registration-key.enable', 'registration-key-enable', 'mutation', ['post.v1.teams.teamId.capacity-registration-key.enable'], { idempotent: true }),
	capability('registration-key.disable', 'registration-key-disable', 'mutation', ['post.v1.teams.teamId.capacity-registration-key.disable'], { idempotent: true }),
	capability('registration-requests.list', 'provider-requests', 'read', ['get.v1.teams.teamId.capacity-provider-requests'], { paginated: true }),
	capability('registration-requests.show', 'provider-request', 'read', ['get.v1.teams.teamId.capacity-provider-requests.requestId']),
	capability('registration-requests.approve', 'provider-approve', 'mutation', ['post.v1.teams.teamId.capacity-provider-requests.requestId.approve'], { idempotent: true }),
	capability('registration-requests.reject', 'provider-reject', 'mutation', ['post.v1.teams.teamId.capacity-provider-requests.requestId.reject'], { idempotent: true }),
	capability('registration-requests.cancel', 'provider-cancel', 'mutation', ['post.v1.teams.teamId.capacity-provider-requests.requestId.cancel'], { idempotent: true }),
	capability('memberships.list', 'provider-memberships', 'read', ['get.v1.teams.teamId.capacity-provider-memberships'], { paginated: true }),
	capability('memberships.show', 'provider-membership', 'read', ['get.v1.teams.teamId.capacity-provider-memberships.membershipId']),
	...(['suspend', 'resume', 'revoke'] as const).map((action) => capability(`memberships.${action}`, `provider-${action}`, 'mutation', [`post.v1.teams.teamId.capacity-provider-memberships.membershipId.${action}`], { idempotent: true })),
	capability('credentials.list', 'provider-credentials', 'read', ['get.v1.teams.teamId.capacity-provider-memberships.membershipId.credentials'], { paginated: true }),
	capability('credentials.rotate', 'provider-team-credential-rotate', 'mutation', ['post.v1.teams.teamId.capacity-provider-memberships.membershipId.credentials.rotate'], { idempotent: true }),
	capability('credentials.revoke', 'provider-credential-revoke', 'mutation', ['post.v1.teams.teamId.capacity-provider-memberships.membershipId.credentials.credentialId.revoke'], { idempotent: true }),
	capability('grants.list', 'grants', 'read', ['get.v1.teams.teamId.capacity-grants'], { paginated: true, configuration: 'capacity-grant' }),
	capability('grants.show', 'grant', 'read', ['get.v1.teams.teamId.capacity-grants.grantId']),
	capability('grants.validate', 'grant-validate', 'validate', ['post.v1.teams.teamId.capacity-grants.plan'], { configuration: 'capacity-grant' }),
	capability('grants.plan', 'grant-plan', 'plan', ['post.v1.teams.teamId.capacity-grants.plan'], { configuration: 'capacity-grant' }),
	capability('grants.apply', 'grant-apply', 'mutation', ['post.v1.teams.teamId.capacity-grants'], { idempotent: true, configuration: 'capacity-grant' }),
	...(['activate', 'pause', 'resume', 'revoke'] as const).map((action) => capability(`grants.${action}`, `grant-${action}`, 'mutation', [`post.v1.teams.teamId.capacity-grants.grantId.${action}`], { idempotent: true })),
	capability('allocations.list', 'allocation-sets', 'read', ['get.v1.teams.teamId.capacity.allocation-sets'], { paginated: true, configuration: 'allocation-set' }),
	capability('allocations.show', 'allocation', 'read', ['get.v1.teams.teamId.capacity.allocation-sets.allocationSetId']),
	capability('allocations.validate', 'allocation-validate', 'validate', ['post.v1.teams.teamId.capacity.allocation-sets.plan'], { configuration: 'allocation-set' }),
	capability('allocations.plan', 'allocation-plan', 'plan', ['post.v1.teams.teamId.capacity.allocation-sets.plan'], { configuration: 'allocation-set' }),
	capability('allocations.create', 'allocation-create', 'mutation', ['post.v1.teams.teamId.capacity.allocation-sets'], { idempotent: true, configuration: 'allocation-set' }),
	capability('allocations.activate', 'allocation-activate', 'mutation', ['post.v1.teams.teamId.capacity.allocation-sets.allocationSetId.activate'], { idempotent: true }),
	capability('allocations.supersede', 'allocation-supersede', 'mutation', ['post.v1.teams.teamId.capacity.allocation-sets.allocationSetId.supersede'], { idempotent: true }),
	capability('allocations.archive', 'allocation-archive', 'mutation', ['post.v1.teams.teamId.capacity.allocation-sets.allocationSetId.archive'], { idempotent: true }),
	capability('allocations.explain', 'allocation-explain', 'read', ['post.v1.teams.teamId.capacity.allocation-sets.allocationSetId.explain']),
	capability('agent-classes.list', 'agent-classes', 'read', ['get.v1.projects.projectId.agent-classes'], { paginated: true, configuration: 'project-agent-class' }),
	capability('agent-classes.show', 'agent-class', 'read', ['get.v1.projects.projectId.agent-classes.classId']),
	capability('agent-classes.sync', 'agent-classes-sync', 'mutation', ['post.v1.projects.projectId.agent-classes', 'patch.v1.projects.projectId.agent-classes.classId'], { idempotent: true, configuration: 'project-agent-class', configurationInputs: ['project-agent-class', 'activity-profile'] }),
	capability('agents.author', 'agent-author', 'mutation', ['post.v1.teams.teamId.agent-lab.surfaces.build.authoring'], { idempotent: true }),
	capability('agents.definitions-author', 'agent-definitions-author', 'mutation', ['post.v1.teams.teamId.agent-lab.surfaces.build.authoring-bundle'], { idempotent: true }),
	capability('context-queries.test', 'context-query-test', 'mutation', ['post.v1.teams.teamId.projects.projectId.context-query-checks'], { access:'project-read',idempotent:true,uiAvailable:false }),
	capability('context-queries.readiness', 'context-query-checks', 'read', ['get.v1.teams.teamId.projects.projectId.context-query-checks'], { access:'project-read',uiAvailable:false }),
	capability('agents.simulate', 'agent-simulation-run', 'mutation', ['post.v1.teams.teamId.agent-lab.simulations'], { idempotent: true }),
	capability('agents.deploy', 'agent-deploy', 'mutation', ['post.v1.teams.teamId.agent-deployments.plan','post.v1.teams.teamId.agent-deployments.execute'], { idempotent:true,uiAvailable:false }),
	capability('agents.deployment', 'agent-deployment', 'read', ['get.v1.teams.teamId.agent-deployments.deploymentId'], { uiAvailable:false }),
	capability('agents.deployment-activate', 'agent-deployment-activate', 'mutation', ['post.v1.teams.teamId.agent-deployments.deploymentId.activate'], { idempotent:true,uiAvailable:false }),
	capability('agents.deployment-upgrade', 'agent-deployment-upgrade', 'mutation', ['post.v1.teams.teamId.agent-deployments.deploymentId.upgrade'], { idempotent:true,uiAvailable:false }),
	capability('capacity-plans.list', 'capacity-plans', 'read', ['get.v1.decisions.decisionId.capacity-plans'], { paginated: true }),
	capability('capacity-plans.show', 'capacity-plan', 'read', ['get.v1.capacity-plans.capacityPlanId']),
	capability('capacity-plans.create', 'capacity-plan-create', 'mutation', ['post.v1.decisions.decisionId.capacity-plans'], { idempotent: true, uiAvailable: false }),
	capability('capacity-plans.accept', 'capacity-plan-accept', 'mutation', ['post.v1.capacity-plans.capacityPlanId.accept'], { idempotent: true, uiAvailable: false }),
	capability('capacity-plans.request-revision', 'capacity-plan-request-revision', 'mutation', ['post.v1.capacity-plans.capacityPlanId.request-revision'], { idempotent: true, uiAvailable: false }),
	capability('capacity-plans.schedule', 'capacity-plan-schedule', 'mutation', ['post.v1.capacity-plans.capacityPlanId.schedule'], { idempotent: true, uiAvailable: false }),
	capability('capacity-plans.supersede', 'capacity-plan-supersede', 'mutation', ['post.v1.capacity-plans.capacityPlanId.supersede'], { idempotent: true, uiAvailable: false }),
	capability('workdays.create', 'workday-create', 'mutation', ['post.v1.workdays'], { idempotent: true }),
	...(['start', 'pause', 'resume', 'complete', 'cancel'] as const).map((action) => capability(`workdays.${action}`, `workday-${action}`, 'mutation', [`post.v1.workdays.workdayId.${action}`], { idempotent: true })),
	capability('workdays.tick', 'workday-tick', 'mutation', ['post.v1.teams.teamId.workday-runs.runId.tick'], { idempotent: true }),
	capability('workdays.status', 'workday-status', 'read', ['get.v1.workdays.workdayId']),
	capability('workdays.summary', 'workday-summary', 'read', ['get.v1.workdays.workdayId.summary'], { paginated: true }),
	capability('workdays.watch', 'workday-watch', 'read', ['get.v1.workdays.workdayId.summary'], { uiAvailable:false }),
	capability('workday-runs.list', 'workday-runs', 'read', ['get.v1.teams.teamId.workday-runs'], { paginated: true }),
	capability('workday-runs.show', 'workday', 'read', ['get.v1.teams.teamId.workday-runs.runId']),
	capability('workday-runs.preflight', 'workday-run', 'plan', ['post.v1.teams.teamId.workday-runs.preflight']),
	capability('workday-runs.create', 'workday-run', 'mutation', ['post.v1.teams.teamId.workday-runs'], { idempotent: true }),
	capability('workday-runs.cancel', 'workday-run-cancel', 'mutation', ['patch.v1.teams.teamId.workday-runs.runId'], { idempotent: true }),
	capability('workday-runs.complete', 'workday-run-complete', 'mutation', ['patch.v1.teams.teamId.workday-runs.runId'], { idempotent: true }),
	capability('workday-runs.close-admission', 'workday-close-admission', 'mutation', ['post.v1.teams.teamId.workday-runs.runId.close-admission'], { idempotent: true, uiAvailable: false }),
	capability('workday-schedules.list', 'workday-schedules', 'read', ['get.v1.teams.teamId.workday-schedules'], { paginated: true, uiAvailable: false }),
	capability('workday-schedules.show', 'workday-schedule', 'read', ['get.v1.teams.teamId.workday-schedules.scheduleId'], { uiAvailable: false }),
	capability('workday-schedules.create', 'workday-schedule-create', 'mutation', ['post.v1.teams.teamId.workday-schedules'], { idempotent: true, uiAvailable: false }),
	capability('workday-schedules.update', 'workday-schedule-update', 'mutation', ['patch.v1.teams.teamId.workday-schedules.scheduleId'], { idempotent: true, uiAvailable: false }),
	capability('workday-schedules.tick', 'workday-schedule-tick', 'mutation', ['post.v1.teams.teamId.workday-schedules.scheduleId.tick'], { idempotent: true, uiAvailable: false }),
	capability('assignments.list', 'assignments', 'read', ['get.v1.teams.teamId.capacity.assignments'], { paginated: true }),
	capability('assignments.show', 'assignment', 'read', ['get.v1.teams.teamId.capacity.assignments.assignmentId']),
	capability('assignments.authority-probe','assignment-authority-probe','read',['get.v1.teams.teamId.capacity.assignments.assignmentId.authority-probe'],{ uiAvailable:false }),
	capability('assignments.explain', 'assignment-explanation', 'read', ['get.v1.teams.teamId.capacity.assignments.assignmentId.explanation']),
	capability('assignments.mode-runs', 'mode-runs', 'read', ['get.v1.projects.projectId.agent-mode-runs'], { paginated:true,uiAvailable:false }),
	capability('assignments.execution-runs', 'execution-runs', 'read', ['get.v1.teams.teamId.capacity.execution-runs'], { paginated:true,uiAvailable:false }),
	capability('assignments.treedx-audit', 'treedx-proxy-audit', 'read', ['get.v1.projects.projectId.treedx-proxy-audit'], { paginated:true,uiAvailable:false }),
	capability('assignments.artifacts', 'assignment-artifacts', 'read', ['get.v1.teams.teamId.capacity.assignments.assignmentId'], { uiAvailable:false }),
	capability('assignments.artifacts-verify', 'assignment-artifacts-verify', 'read', ['get.v1.teams.teamId.capacity.assignments.assignmentId'], { uiAvailable:false }),
	capability('assignments.cancel', 'assignment-cancel', 'mutation', ['post.v1.teams.teamId.capacity.assignments.assignmentId.cancel'], { idempotent: true, uiAvailable: false }),
	capability('assignments.requeue', 'assignment-requeue', 'mutation', ['post.v1.teams.teamId.capacity.assignments.assignmentId.requeue'], { idempotent: true, uiAvailable: false }),
	capability('assignments.content-abandon', 'content-abandon', 'mutation', ['post.v1.teams.teamId.capacity.assignments.assignmentId.content-abandonment'], { idempotent: true, uiAvailable: false }),
	capability('assignments.content-integrate', 'content-integrate', 'mutation', ['post.v1.teams.teamId.capacity.assignments.assignmentId.content-integration'], { idempotent: true, uiAvailable: false }),
	capability('assignments.checkpoint-integrate', 'checkpoint-integrate', 'mutation', [], { idempotent: true, uiAvailable: false }),
	capability('reservations.list', 'reservations', 'read', ['get.v1.teams.teamId.capacity.reservations'], { paginated: true }),
	capability('reservations.explain', 'reservation-explanation', 'read', ['get.v1.teams.teamId.capacity.reservations.reservationId.explanation']),
	capability('usage.show', 'usage', 'read', ['get.v1.teams.teamId.capacity.usage'], { paginated: true }),
	capability('usage.export', 'usage-export', 'export', ['get.v1.teams.teamId.capacity.usage'], { paginated: true }),
	capability('ledger.show', 'ledger', 'read', ['get.v1.teams.teamId.capacity.ledger'], { paginated: true }),
	capability('ledger.export', 'ledger-export', 'export', ['get.v1.teams.teamId.capacity.ledger'], { paginated: true }),
	capability('audit.list', 'audit-events', 'read', ['get.v1.teams.teamId.capacity-audit-events'], { paginated: true }),
	capability('audit.export', 'audit-export', 'export', ['get.v1.teams.teamId.capacity-audit-events'], { paginated: true }),
	capability('provider.identity.init', 'provider-identity-init', 'mutation', [], { configuration: 'provider-manifest' }),
	capability('provider.identity.show', 'provider-identity-show', 'read'),
	capability('provider.identity.rotate', 'provider-identity-rotate', 'mutation', ['post.v1.provider.identity.rotate'], { idempotent: true }),
	capability('provider.manifest.init', 'provider-manifest-init', 'mutation', [], { configuration: 'provider-manifest' }),
	capability('provider.join', 'provider-join', 'mutation', ['post.v1.provider-registrations'], { idempotent: true, configuration: 'provider-offer' }),
	capability('provider.registration-status', 'provider-registration-status', 'read', ['get.v1.provider-registrations.requestId']),
	capability('provider.credential-exchange', 'provider-credential-exchange', 'mutation', ['post.v1.provider-registrations.requestId.credential'], { idempotent: true }),
	capability('provider.credential-rotate', 'provider-credential-rotate', 'mutation', ['post.v1.provider.credential-rotation'], { idempotent: true }),
	capability('provider.connections.list', 'provider-connections', 'read', [], { configuration: 'provider-manifest' }),
	capability('provider.connections.show', 'provider-connection', 'read'),
	capability('provider.connections.leave', 'provider-leave', 'mutation', ['post.v1.provider.membership.leave'], { idempotent: true }),
	capability('provider.offer.validate', 'provider-offer-validate', 'validate', [], { configuration: 'provider-offer' }),
	capability('provider.offer.plan', 'provider-offer-plan', 'plan', [], { configuration: 'provider-offer' }),
	capability('provider.offer.apply', 'provider-offer-apply', 'mutation', ['post.v1.provider.availability-sessions'], { configuration: 'provider-offer' }),
	...(['build', 'up', 'status', 'logs', 'down', 'test-local'] as const).map((action) => capability(`provider.runtime.${action}`, action, 'local-runtime')),
] as const;

export function validateCapacityOperatorCapabilityMatrix() {
	const diagnostics: string[] = [];
	const ids = new Set<string>();
	const actions = new Set<string>();
	for (const capability of CAPACITY_OPERATOR_CAPABILITIES) {
		if (ids.has(capability.id)) diagnostics.push(`Duplicate capability id: ${capability.id}`);
		if (actions.has(capability.cliAction) && capability.cliAction !== 'workday-run') diagnostics.push(`Duplicate CLI action owner: ${capability.cliAction}`);
		ids.add(capability.id);
		actions.add(capability.cliAction);
		if (capability.kind === 'mutation' && capability.apiRouteIds.length > 0 && capability.idempotent !== true && !capability.id.startsWith('provider.offer')) {
			diagnostics.push(`API mutation is not declared idempotent: ${capability.id}`);
		}
	}
	return { ok: diagnostics.length === 0, diagnostics };
}

export function renderCapacityOperatorCapabilityMarkdown() {
	const lines = [
		'# Agent Capacity Operator Parity',
		'',
		'> Generated from `CAPACITY_OPERATOR_CAPABILITIES`. Do not hand-edit this file.',
		'',
		'| Capability | CLI action | API route descriptors | Kind | Access | Mutation | Confirmation | UI | Agent | Pagination | Configuration |',
		'| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const capability of CAPACITY_OPERATOR_CAPABILITIES) {
		lines.push(`| \`${capability.id}\` | \`trsd capacity ${capability.cliAction}\` | ${capability.apiRouteIds.map((route) => `\`${route}\``).join('<br>') || 'local'} | ${capability.kind} | ${capability.access} | ${capability.mutationMode} | ${capability.confirmation} | ${capability.uiAvailable ? 'yes' : 'no'} | ${capability.agentVisibility} | ${capability.paginated ? 'bounded cursor' : '—'} | ${(capability.configurationInputs ?? (capability.configuration ? [capability.configuration] : [])).join('<br>') || '—'} |`);
	}
	lines.push('', '## Declarative configuration inventory', '', '| Family | Schema | Validator | Format | Runtime owner | Example |', '| --- | --- | --- | --- | --- | --- |');
	for (const descriptor of CAPACITY_CONFIGURATION_DESCRIPTORS) {
		lines.push(`| \`${descriptor.id}\` | \`${descriptor.schemaId}\` | \`${descriptor.validator}\` | ${descriptor.format} | \`${descriptor.runtimeOwner}\` | \`${descriptor.examplePath}\` |`);
	}
	return `${lines.join('\n')}\n`;
}
