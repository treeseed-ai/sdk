import { CAPACITY_CONFIGURATION_DESCRIPTORS, type CapacityConfigurationFamily } from './configuration.ts';

export type CapacityOperatorConfiguration = CapacityConfigurationFamily;
export type CapacityOperatorAccess = 'team-read' | 'team-manage' | 'project-read' | 'project-manage' | 'provider-proof' | 'provider-access-token' | 'provider-owner-local';

export interface CapacityOperatorCapability {
	id: string;
	cliAction: string;
	apiRouteIds: readonly string[];
	kind: 'read' | 'validate' | 'plan' | 'mutation' | 'export' | 'local-runtime';
	access: CapacityOperatorAccess;
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
	return { id, cliAction, kind, apiRouteIds, access: options.access ?? accessFor(id, kind), ...options };
}

function accessFor(id: string, kind: CapacityOperatorCapability['kind']): CapacityOperatorAccess {
	if (id.startsWith('provider.')) {
		if (id === 'provider.join' || id === 'provider.registration-status' || id === 'provider.credential-exchange') return 'provider-proof';
		if (id === 'provider.identity.rotate' || id === 'provider.credential-rotate' || id === 'provider.connections.leave' || id === 'provider.offer.apply') return 'provider-access-token';
		return 'provider-owner-local';
	}
	if (id.startsWith('agent-classes.')) return kind === 'read' ? 'project-read' : 'project-manage';
	if (id === 'workdays.tick') return 'team-manage';
	if (id.startsWith('workdays.')) return kind === 'read' ? 'project-read' : 'project-manage';
	if (id.startsWith('registration-key.')) return 'team-manage';
	if (id.startsWith('registration-requests.') || id.startsWith('memberships.') || id.startsWith('credentials.')) return kind === 'read' ? 'team-read' : 'team-manage';
	if (id.startsWith('grants.') || id.startsWith('allocations.')) return kind === 'read' ? 'team-read' : 'team-manage';
	if (id.startsWith('assignments.') || id.startsWith('reservations.') || id.startsWith('usage.') || id.startsWith('ledger.') || id.startsWith('audit.')) return kind === 'read' || kind === 'export' ? 'team-read' : 'team-manage';
	return kind === 'read' || kind === 'export' ? 'team-read' : 'team-manage';
}

export const CAPACITY_OPERATOR_CAPABILITIES: readonly CapacityOperatorCapability[] = [
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
	capability('workdays.create', 'workday-create', 'mutation', ['post.v1.workdays'], { idempotent: true }),
	...(['start', 'pause', 'resume', 'complete', 'cancel'] as const).map((action) => capability(`workdays.${action}`, `workday-${action}`, 'mutation', [`post.v1.workdays.workdayId.${action}`], { idempotent: true })),
	capability('workdays.tick', 'workday-tick', 'mutation', ['post.v1.teams.teamId.workday-runs.runId.tick'], { idempotent: true }),
	capability('workdays.status', 'workday-status', 'read', ['get.v1.workdays.workdayId']),
	capability('workdays.summary', 'workday-summary', 'read', ['get.v1.workdays.workdayId.summary'], { paginated: true }),
	capability('assignments.list', 'assignments', 'read', ['get.v1.teams.teamId.capacity.assignments'], { paginated: true }),
	capability('assignments.show', 'assignment', 'read', ['get.v1.teams.teamId.capacity.assignments.assignmentId']),
	capability('assignments.explain', 'assignment-explanation', 'read', ['get.v1.teams.teamId.capacity.assignments.assignmentId.explanation']),
	capability('assignments.cancel', 'assignment-cancel', 'mutation', ['post.v1.teams.teamId.capacity.assignments.assignmentId.cancel'], { idempotent: true }),
	capability('assignments.requeue', 'assignment-requeue', 'mutation', ['post.v1.teams.teamId.capacity.assignments.assignmentId.requeue'], { idempotent: true }),
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
		if (actions.has(capability.cliAction)) diagnostics.push(`Duplicate CLI action owner: ${capability.cliAction}`);
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
		'| Capability | CLI action | API route descriptors | Kind | Access | Pagination | Configuration |',
		'| --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const capability of CAPACITY_OPERATOR_CAPABILITIES) {
		lines.push(`| \`${capability.id}\` | \`trsd capacity ${capability.cliAction}\` | ${capability.apiRouteIds.map((route) => `\`${route}\``).join('<br>') || 'local'} | ${capability.kind} | ${capability.access} | ${capability.paginated ? 'bounded cursor' : '—'} | ${(capability.configurationInputs ?? (capability.configuration ? [capability.configuration] : [])).join('<br>') || '—'} |`);
	}
	lines.push('', '## Declarative configuration inventory', '', '| Family | Schema | Validator | Format | Runtime owner | Example |', '| --- | --- | --- | --- | --- | --- |');
	for (const descriptor of CAPACITY_CONFIGURATION_DESCRIPTORS) {
		lines.push(`| \`${descriptor.id}\` | \`${descriptor.schemaId}\` | \`${descriptor.validator}\` | ${descriptor.format} | \`${descriptor.runtimeOwner}\` | \`${descriptor.examplePath}\` |`);
	}
	return `${lines.join('\n')}\n`;
}
