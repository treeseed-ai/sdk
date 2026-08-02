import { type ProviderAssignment } from '../../../contracts/capacity/assignments/assignment-records.ts';
import type { CapacitySettlementInvariantResult,CapacitySettlementInvariantViolation } from '../../../contracts/runtime/runtime-observability.ts';
import type { CapacityLedgerEntry,CapacityReservation } from '../../../contracts/support/financial-records.ts';
import { hasAcceptedCapacityPlanProvenance } from '../../support/planning.ts';

export function validateCapacitySettlementInvariant(input: {
	assignment: ProviderAssignment;
	reservation?: CapacityReservation | null;
	ledgerEntries: CapacityLedgerEntry[];
}): CapacitySettlementInvariantResult {
	const violations: CapacitySettlementInvariantViolation[] = [];
	const assignmentEntries = input.ledgerEntries.filter((entry) => !entry.assignmentId || entry.assignmentId === input.assignment.id);
	const byPhase = new Map<string, CapacityLedgerEntry[]>();
	for (const entry of assignmentEntries) {
		byPhase.set(String(entry.phase), [...(byPhase.get(String(entry.phase)) ?? []), entry]);
		if (Number(entry.credits ?? 0) < 0) {
			violations.push({ code: 'negative_consumed_credits', message: `Ledger entry ${entry.id} has negative credits.`, severity: 'error' });
		}
	}
	const completion = byPhase.get('task_completed_actual_settlement') ?? [];
	if (completion.length > 1) {
		violations.push({ code: 'duplicate_completion_settlement', message: `Assignment ${input.assignment.id} has ${completion.length} completion settlement entries.`, severity: 'error' });
	}
	const releases = byPhase.get('reservation_released') ?? [];
	if (input.reservation && releases.length) {
		const consumed = Math.max(...completion.map((entry) => Number(entry.credits ?? 0)), Number(input.reservation.consumedCredits ?? 0), 0);
		const reserved = Number(input.reservation.reservedCredits ?? 0);
		const released = releases.reduce((sum, entry) => sum + Number(entry.credits ?? 0), 0);
		if (released > Math.max(0, reserved - consumed) + 0.000001) {
			violations.push({ code: 'reservation_release_exceeds_unused', message: `Released ${released} credits exceeds unused reservation ${Math.max(0, reserved - consumed)}.`, severity: 'error' });
		}
	}
	const refunds = byPhase.get('task_failed_refund') ?? [];
	if (input.reservation && refunds.reduce((sum, entry) => sum + Number(entry.credits ?? 0), 0) > Number(input.reservation.reservedCredits ?? 0) + 0.000001) {
		violations.push({ code: 'refund_exceeds_reserved', message: 'Failure refund exceeds reserved credits.', severity: 'error' });
	}
	if (input.assignment.status === 'completed' && completion.length === 0 && input.assignment.reservationId) {
		violations.push({ code: 'completed_assignment_missing_settlement', message: 'Completed assignment with a reservation has no completion settlement.', severity: 'error' });
	}
	if (input.assignment.status === 'completed') {
		const hasModeRun = Boolean(input.assignment.lifecycleOutput?.modeRunId ?? input.assignment.lifecycleOutput?.usageActualId ?? completion.some((entry) => entry.modeRunId));
		if (!hasModeRun) {
			violations.push({ code: 'completed_assignment_missing_mode_run_or_usage', message: 'Completed assignment does not link a mode run or usage actual.', severity: 'warning' });
		}
	}
	if (input.assignment.mode === 'acting' && !hasAcceptedCapacityPlanProvenance({ assignment: input.assignment })) {
		violations.push({ code: 'acting_assignment_missing_capacity_plan_provenance', message: 'Acting assignment lacks accepted, scheduled, or active capacity-plan provenance.', severity: 'error' });
	}
	const hasErrors = violations.some((violation) => violation.severity === 'error');
	return {
		ok: violations.length === 0,
		status: hasErrors ? 'fail' : violations.length ? 'warning' : 'pass',
		violations,
	};
}
