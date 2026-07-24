import { describe, expect, it } from 'vitest';
import { validateAgentModeRun, validateProviderAssignment } from '../../../../../src/agent-capacity/validation/assignment-records.ts';

function assignment(overrides: Record<string, unknown> = {}) {
	return {
		id: 'assignment-a', membershipId: 'membership-a', stateVersion: 1, teamId: 'team-a', projectId: 'project-a',
		capacityProviderId: 'provider-a', providerSessionId: null, executionProviderId: null, laneId: null,
		allocationSetId: 'allocation-a', projectAgentClassId: 'class-a', reservationId: 'reservation-a',
		workDayId: 'workday-a', taskId: 'task-a', mode: 'planning', status: 'pending', leaseState: 'unleased',
		leaseExpiresAt: null, leaseToken: null, leaseRenewedAt: null, runnerId: null, agentId: 'agent-a', handlerId: 'writer',
		capacityEnvelope: { teamId: 'team-a', projectId: 'project-a', mode: 'planning' },
		decisionInput: { teamId: 'team-a', projectId: 'project-a', projectAgentClassId: 'class-a', mode: 'planning', input: {} },
		workspaceContext: {}, allowedOutputs: {}, explanation: {}, attemptCount: 0,
		assignedAt: null, claimedAt: null, completedAt: null, returnedAt: null, failedAt: null, lifecycleReason: null,
		lifecycleCode: null, lifecycleOutput: {}, synthesizedFrom: 'workday_demand', synthesisKey: 'synthesis-a', decisionId: null,
		proposalId: null, fallbackOutputId: null, treedxProxyHandle: null, capabilityHandles: null, metadata: {},
		createdAt: '2026-07-18T00:00:00.000Z', updatedAt: '2026-07-18T00:00:00.000Z', ...overrides,
	};
}

function modeRun(overrides: Record<string, unknown> = {}) {
	return {
		id: 'mode-run-a', teamId: 'team-a', projectId: 'project-a', providerAssignmentId: 'assignment-a',
		capacityProviderId: 'provider-a', executionProviderId: null, projectAgentClassId: 'class-a', agentId: 'agent-a',
		handlerId: 'writer', mode: 'planning', status: 'running', selectedInput: {},
		capacityEnvelope: { teamId: 'team-a', projectId: 'project-a', mode: 'planning' }, outputs: {},
		traceRefs: {}, usageActual: {}, validation: {}, fallbackReason: null, startedAt: '2026-07-18T00:00:00.000Z',
		completedAt: null, failedAt: null, metadata: {}, createdAt: '2026-07-18T00:00:00.000Z',
		updatedAt: '2026-07-18T00:00:00.000Z', ...overrides,
	};
}

describe('assignment and mode-run record validation', () => {
	it('accepts complete canonical durable records', () => {
		expect(validateProviderAssignment(assignment())).toEqual({ ok: true, diagnostics: [] });
		expect(validateAgentModeRun(modeRun())).toEqual({ ok: true, diagnostics: [] });
	});

	it('rejects widened statuses, missing governance provenance, and invalid timestamps', () => {
		expect(validateProviderAssignment(assignment({ membershipId: '', status: 'abandoned', stateVersion: 0 })).diagnostics.map((entry) => entry.code))
			.toEqual(expect.arrayContaining(['provider_assignment_field_invalid', 'provider_assignment_status_invalid', 'provider_assignment_state_version_invalid']));
		expect(validateAgentModeRun(modeRun({ mode: 'observe', status: 'complete', createdAt: 'later' })).diagnostics.map((entry) => entry.code))
			.toEqual(expect.arrayContaining(['agent_mode_run_mode_invalid', 'agent_mode_run_status_invalid', 'agent_mode_run_timestamp_invalid']));
	});
});
