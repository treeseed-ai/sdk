import { describe, expect, it } from 'vitest';
import { validateProviderAssignment } from '../../../../../src/agent-capacity/validation/assignment-records.ts';
import { assignmentAttemptSchema } from '../../../../../src/agent-capacity/contracts/capacity/assignments/agent-execution.ts';

function assignment(overrides: Record<string, unknown> = {}) {
	const at = '2026-07-18T00:00:00.000Z', ref = { store: 'treedx', model: 'agent', id: 'configured-builder',
		repository: 'team-library', commit: 'a'.repeat(40), path: 'agents/configured-builder.yaml' };
	const attempt = assignmentAttemptSchema.parse({ schemaVersion: 'treeseed.assignment-attempt/v1', id: 'assignment-a',
		idempotencyKey: 'assignment-a', teamId: 'team-a', projectId: 'project-a', workdayId: 'workday-a', nodeId: 'node-a',
		nodeRevision: 1, graphRevision: 1, agentClass: 'configured-builder', sourceRef: ref, authorityRefs: [ref],
		effectiveProfile: { profileRef: ref, activity: 'planning', handler: 'writer', handlerOrigin: 'agent-package',
			prompt: { system: 'Plan only the supplied authorized work.' }, permissionCeiling: { content: { read: ['agent'], write: [] }, tools: [] } },
		requiredCapabilities: [], grant: { contentRead: [ref], contentWrite: [], sourceRead: [], sourceWrite: [], tools: [] },
		provider: { providerId: 'provider-a', offerId: 'offer-a', offerRevision: 1, executionProviderId: 'executor-a',
			modelConfigurationId: 'model-a', executionCapabilityId: 'capability-a', runtimeBuild: `sha256:${'b'.repeat(64)}` },
		contextRefs: [ref], predecessorResultIds: [], workspace: { mode: 'read-only' }, estimate: { expectedSeconds: 1, maximumSeconds: 2 },
		limits: { maximumSeconds: 2, maximumContextBytes: 1024, maximumContextItems: 1 }, deadline: '2026-07-18T00:00:02.000Z',
		leaseId: 'lease-a', reservationId: 'reservation-a', attempt: 1, status: 'created', createdAt: at });
	return {
		id: 'assignment-a', membershipId: 'membership-a', stateVersion: 1, teamId: 'team-a', projectId: 'project-a',
		capacityProviderId: 'provider-a', providerSessionId: null, executionProviderId: 'executor-a', laneId: null,
		projectAgentClassId: 'class-a', reservationId: 'reservation-a',
		workDayId: 'workday-a', taskId: 'task-a', mode: 'planning', status: 'pending', leaseState: 'unleased',
		leaseExpiresAt: null, leaseToken: null, leaseRenewedAt: null, runnerId: null, agentId: 'agent-a', handlerId: 'writer',
		capacityEnvelope: { teamId: 'team-a', projectId: 'project-a', mode: 'planning', workDayId: 'workday-a',
			projectAgentClassId: 'class-a', capacityProviderId: 'provider-a', executionProviderId: 'executor-a', reservationId: 'reservation-a' },
		workspaceContext: {}, allowedOutputs: {}, explanation: {}, attemptCount: 1, assignmentAttempt: attempt,
		executionNodeId: attempt.nodeId, executionNodeRevision: attempt.nodeRevision, graphRevision: attempt.graphRevision,
		assignedAt: null, claimedAt: null, completedAt: null, returnedAt: null, failedAt: null, lifecycleReason: null,
		lifecycleCode: null, lifecycleOutput: {}, synthesizedFrom: 'living_execution_graph', synthesisKey: 'synthesis-a', decisionId: null,
		proposalId: null, fallbackOutputId: null, treedxProxyHandle: null, capabilityHandles: null, metadata: {},
		createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', ...overrides,
	};
}

describe('assignment record validation', () => {
	it('accepts complete canonical durable records', () => {
		expect(validateProviderAssignment(assignment())).toEqual({ ok: true, diagnostics: [] });
		expect(validateProviderAssignment(assignment({ assignmentAttempt: null })).ok).toBe(false);
		expect(validateProviderAssignment(assignment({ decisionInput: {} })).diagnostics.map((entry) => entry.code))
			.toContain('provider_assignment_retired_input');
		expect(validateProviderAssignment(assignment({ synthesizedFrom: 'living_execution_graph' }))).toEqual({ ok: true, diagnostics: [] });
	});

	it('rejects widened statuses, missing governance provenance, and invalid timestamps', () => {
		for (const retired of ['approved_decision', 'planning_input_request', 'capacity_plan', 'workday_demand', 'verification_failure', 'fallback_queue']) {
			expect(validateProviderAssignment(assignment({ synthesizedFrom: retired })).diagnostics.map((entry) => entry.code))
				.toContain('provider_assignment_synthesis_source_invalid');
		}
		expect(validateProviderAssignment(assignment({ membershipId: '', status: 'abandoned', stateVersion: 0 })).diagnostics.map((entry) => entry.code))
			.toEqual(expect.arrayContaining(['provider_assignment_field_invalid', 'provider_assignment_status_invalid', 'provider_assignment_state_version_invalid']));
	});

	it('rejects retired allocation-set provenance', () => {
		expect(validateProviderAssignment(assignment({ allocationSetId: 'retired' })).diagnostics)
			.toEqual(expect.arrayContaining([expect.objectContaining({ code: 'provider_assignment_retired_allocation' })]));
	});
});
