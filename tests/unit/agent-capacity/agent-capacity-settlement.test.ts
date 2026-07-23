import { describe, expect, it } from 'vitest';
import { classifyCapacityFailure, validateCapacitySettlementInvariant, type ProviderAssignment } from '../../../src/agent-capacity.ts';

const assignment: ProviderAssignment = {
	id: 'assignment-1',
	membershipId: 'membership-1',
	stateVersion: 1,
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

const reservation = {
	id: 'reservation-1', idempotencyKey: 'reservation-key-1', membershipId: 'membership-1', grantId: 'grant-1',
	capacityProviderId: 'provider-1', executionProviderId: null, laneId: null, allocationSetId: 'allocation-1',
	allocationVersion: 1, allocationSliceIds: [], policySnapshot: {}, projectAgentClassId: 'implementation',
	assignmentId: 'assignment-1', mode: 'planning' as const, teamId: 'team-1', projectId: 'project-1', workDayId: null,
	taskId: null, state: 'consumed' as const, reservedCredits: 10, consumedCredits: 7, nativeUnit: null,
	reservedNativeAmount: null, consumedNativeAmount: null, reservedProviderUnits: null, consumedProviderUnits: null,
	reservedUsd: null, consumedUsd: null, expiresAt: null, metadata: {}, createdAt: '2026-01-01T00:00:00.000Z',
	updatedAt: '2026-01-01T00:00:00.000Z',
};

function ledger(id: string, phase: 'task_completed_actual_settlement' | 'reservation_released', credits: number, modeRunId: string | null = null) {
	return {
		id, settlementKey: `settlement-${id}`, membershipId: 'membership-1', capacityProviderId: 'provider-1',
		reservationId: 'reservation-1', assignmentId: 'assignment-1', modeRunId, mode: 'planning' as const,
		teamId: 'team-1', projectId: 'project-1', workDayId: null, taskId: null, phase, credits,
		providerUnits: null, usd: null, source: 'test', metadata: {}, createdAt: '2026-01-01T00:00:00.000Z',
	};
}

describe('capacity settlement invariants', () => {
	it('passes a single completion and release settlement', () => {
		const result = validateCapacitySettlementInvariant({
			assignment: {
				...assignment,
				lifecycleOutput: { modeRunId: 'mode-run-1' },
			},
			reservation,
			ledgerEntries: [
				ledger('ledger-1', 'task_completed_actual_settlement', 7, 'mode-run-1'),
				ledger('ledger-2', 'reservation_released', 3),
			],
		});
		expect(result.status).toBe('pass');
	});

	it('fails duplicate completion settlement', () => {
		const result = validateCapacitySettlementInvariant({
			assignment,
			ledgerEntries: [
				ledger('ledger-1', 'task_completed_actual_settlement', 4),
				ledger('ledger-2', 'task_completed_actual_settlement', 4),
			],
		});
		expect(result.ok).toBe(false);
		expect(result.violations.map((violation) => violation.code)).toContain('duplicate_completion_settlement');
	});

	it('classifies retryable, terminal, and operator-action failures with stable semantics', () => {
		expect(classifyCapacityFailure({ code: 'execution_provider_rate_limited' })).toMatchObject({ disposition: 'retryable', retryable: true, requiresOperatorAction: false });
		expect(classifyCapacityFailure({ code: 'output_contract_invalid' })).toMatchObject({ disposition: 'terminal', retryable: false, requiresOperatorAction: false });
		expect(classifyCapacityFailure({ code: 'capacity_settlement_overrun_requires_approval', retryable: true })).toMatchObject({ disposition: 'operator-action', retryable: false, requiresOperatorAction: true });
	});
});
