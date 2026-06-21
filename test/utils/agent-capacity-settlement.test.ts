import { describe, expect, it } from 'vitest';
import { validateCapacitySettlementInvariant, type ProviderAssignment } from '../../src/agent-capacity.ts';

const assignment: ProviderAssignment = {
	id: 'assignment-1',
	teamId: 'team-1',
	projectId: 'project-1',
	capacityProviderId: 'provider-1',
	projectAgentClassId: 'implementation',
	reservationId: 'reservation-1',
	mode: 'planning',
	status: 'completed',
	leaseState: 'released',
	capacityEnvelope: {},
	decisionInput: {},
};

describe('capacity settlement invariants', () => {
	it('passes a single completion and release settlement', () => {
		const result = validateCapacitySettlementInvariant({
			assignment: {
				...assignment,
				lifecycleOutput: { modeRunId: 'mode-run-1' },
			},
			reservation: {
				id: 'reservation-1',
				capacityProviderId: 'provider-1',
				laneId: 'provider-1:agent-capacity',
				teamId: 'team-1',
				projectId: 'project-1',
				workDayId: null,
				taskId: null,
				state: 'consumed',
				reservedCredits: 10,
				consumedCredits: 7,
				reservedProviderUnits: null,
				consumedProviderUnits: null,
				reservedUsd: null,
				consumedUsd: null,
				expiresAt: null,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:00:00.000Z',
			},
			ledgerEntries: [
				{ id: 'ledger-1', capacityProviderId: 'provider-1', laneId: null, reservationId: 'reservation-1', assignmentId: 'assignment-1', modeRunId: 'mode-run-1', teamId: 'team-1', projectId: 'project-1', workDayId: null, taskId: null, phase: 'task_completed_actual_settlement', credits: 7, providerUnits: null, usd: null, source: 'test', createdAt: '2026-01-01T00:00:00.000Z' },
				{ id: 'ledger-2', capacityProviderId: 'provider-1', laneId: null, reservationId: 'reservation-1', assignmentId: 'assignment-1', modeRunId: null, teamId: 'team-1', projectId: 'project-1', workDayId: null, taskId: null, phase: 'reservation_released', credits: 3, providerUnits: null, usd: null, source: 'test', createdAt: '2026-01-01T00:00:00.000Z' },
			],
		});
		expect(result.status).toBe('pass');
	});

	it('fails duplicate completion settlement', () => {
		const result = validateCapacitySettlementInvariant({
			assignment,
			ledgerEntries: [
				{ id: 'ledger-1', capacityProviderId: 'provider-1', laneId: null, reservationId: 'reservation-1', assignmentId: 'assignment-1', teamId: 'team-1', projectId: 'project-1', workDayId: null, taskId: null, phase: 'task_completed_actual_settlement', credits: 4, providerUnits: null, usd: null, source: 'test', createdAt: '2026-01-01T00:00:00.000Z' },
				{ id: 'ledger-2', capacityProviderId: 'provider-1', laneId: null, reservationId: 'reservation-1', assignmentId: 'assignment-1', teamId: 'team-1', projectId: 'project-1', workDayId: null, taskId: null, phase: 'task_completed_actual_settlement', credits: 4, providerUnits: null, usd: null, source: 'test', createdAt: '2026-01-01T00:00:00.000Z' },
			],
		});
		expect(result.ok).toBe(false);
		expect(result.violations.map((violation) => violation.code)).toContain('duplicate_completion_settlement');
	});
});
