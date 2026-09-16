/** Pure allocation arithmetic. Admission must reserve the returned amount atomically. */
import { workdayPhase, type AppliedWorkday } from './workday-allocation.ts';

export interface AllocationShare {
	id: string;
	weight: number;
	committedSeconds: number;
	maximumAdditionalSeconds: number;
}

function nonnegative(value: number): number {
	if (!Number.isFinite(value) || value < 0) throw new Error('allocation_amount_invalid');
	return value;
}

/** Redistributable shares; existing reservations/consumption retain their entitlement. */
export function distributeAllocationSeconds(remainingSeconds: number, shares: AllocationShare[]): Record<string, number> {
	nonnegative(remainingSeconds);
	if (new Set(shares.map((share) => share.id)).size !== shares.length) throw new Error('allocation_share_duplicate');
	const ordered = [...shares].sort((a, b) => a.id.localeCompare(b.id));
	for (const share of ordered) {
		if (!Number.isFinite(share.weight) || share.weight <= 0) throw new Error('allocation_weight_invalid');
		nonnegative(share.committedSeconds); nonnegative(share.maximumAdditionalSeconds);
	}
	const result = Object.fromEntries(ordered.map((share) => [share.id, 0]));
	const capacity = Math.min(remainingSeconds, ordered.reduce((sum, share) => sum + share.maximumAdditionalSeconds, 0));
	if (!capacity) return result;
	// Weighted water filling allocates to underserved work first, respecting demand caps.
	let low = 0;
	let high = Math.max(...ordered.map((share) => (share.committedSeconds + capacity) / share.weight));
	for (let iteration = 0; iteration < 80; iteration += 1) {
		const level = (low + high) / 2;
		const amount = ordered.reduce((sum, share) => sum + Math.min(share.maximumAdditionalSeconds,
			Math.max(0, level * share.weight - share.committedSeconds)), 0);
		if (amount > capacity) high = level; else low = level;
	}
	for (const share of ordered) result[share.id] = Math.floor(Math.min(share.maximumAdditionalSeconds,
		Math.max(0, low * share.weight - share.committedSeconds)) + 1e-9);
	let residual = Math.floor(capacity) - Object.values(result).reduce((sum, amount) => sum + amount, 0);
	for (const share of [...ordered].sort((a, b) =>
		(a.committedSeconds + result[a.id]!) / a.weight - (b.committedSeconds + result[b.id]!) / b.weight || a.id.localeCompare(b.id))) {
		if (residual > 0 && result[share.id]! + 1 <= share.maximumAdditionalSeconds) {
			result[share.id]! += 1; residual -= 1;
		}
	}
	return result;
}

/** Resolve each live workday's phase opportunity from the same shared hard supply.
 * maximumAdditionalSeconds is graph-ready demand, bounded by supply windows/concurrency.
 * Existing commitments are never resized; execution mode does not alter entitlement.
 */
export function allocateWorkdayCapacity(input: {
	remainingSeconds: number;
	now: string;
	workdays: Array<{ plan: AppliedWorkday; committedSeconds: number; planningCommittedSeconds: number;
		maximumAdditionalSeconds: number }>;
}) {
	if (!Number.isFinite(Date.parse(input.now))) throw new Error('allocation_time_invalid');
	const shares = input.workdays.map(({ plan, committedSeconds, planningCommittedSeconds, maximumAdditionalSeconds }) => {
		nonnegative(planningCommittedSeconds);
		if (planningCommittedSeconds > committedSeconds) throw new Error('allocation_planning_commitment_invalid');
		const eligible = plan.state === 'active' && Date.parse(input.now) >= Date.parse(plan.startsAt)
			&& workdayPhase(plan, input.now) !== 'ended';
		return { id: plan.id, weight: plan.policySnapshot.allocationWeight, committedSeconds,
			maximumAdditionalSeconds: eligible ? maximumAdditionalSeconds : 0 };
	});
	const opportunities = distributeAllocationSeconds(input.remainingSeconds, shares);
	return Object.fromEntries(input.workdays.map(({ plan, committedSeconds, planningCommittedSeconds }) => {
		const shareSeconds = opportunities[plan.id]!;
		const phase = workdayPhase(plan, input.now);
		// At the boundary all remaining entitlement is available to acting/review.
		const phaseRemainingSeconds = phase === 'planning'
			? Math.max(0, Math.floor((committedSeconds + shareSeconds) * plan.policySnapshot.planningPercent / 100)
				- planningCommittedSeconds) : shareSeconds;
		return [plan.id, { shareSeconds, phase, phaseRemainingSeconds,
			availableSeconds: Math.min(shareSeconds, phaseRemainingSeconds) }];
	}));
}

export interface AllocationMeasurement {
	id: string;
	completedAt: string;
	expectedSeconds: number;
	allocatedSeconds: number;
	activeSeconds: number;
	outcome: 'completed' | 'expired' | 'cancelled' | 'credential-failure' | 'infrastructure-failure' | 'invalid-result';
}

/** Caller scopes history to exact provider/model, capability, class, and activity. */
export function calibrateAssignmentSeconds(estimate: { expectedSeconds: number; maximumSeconds: number },
	measurements: AllocationMeasurement[]) {
	if (!Number.isFinite(estimate.expectedSeconds) || estimate.expectedSeconds <= 0
		|| !Number.isFinite(estimate.maximumSeconds) || estimate.maximumSeconds < estimate.expectedSeconds) throw new Error('allocation_estimate_invalid');
	const eligible = measurements.filter((entry) => entry.outcome === 'completed' || entry.outcome === 'expired')
		.sort((a, b) => Date.parse(a.completedAt) - Date.parse(b.completedAt) || a.id.localeCompare(b.id)).slice(-20);
	let multiplier = estimate.maximumSeconds / estimate.expectedSeconds;
	for (const entry of eligible) {
		if (!Number.isFinite(Date.parse(entry.completedAt)) || !Number.isFinite(entry.expectedSeconds) || entry.expectedSeconds <= 0
			|| !Number.isFinite(entry.allocatedSeconds) || entry.allocatedSeconds <= 0) throw new Error('allocation_measurement_invalid');
		nonnegative(entry.activeSeconds);
		const ratio = entry.activeSeconds / entry.expectedSeconds;
		multiplier = entry.outcome === 'expired'
			? Math.max(multiplier * 1.25, entry.allocatedSeconds / entry.expectedSeconds * 1.25, ratio * 1.25)
			: Math.max(multiplier * .9, ratio * 1.25);
	}
	return { seconds: Math.ceil(estimate.expectedSeconds * multiplier), multiplier, measurementIds: eligible.map((entry) => entry.id) };
}

export interface AssignmentAllocationConstraint { id: string; remainingSeconds: number }

export function calculateAssignmentAllocation(input: {
	estimate: { minimumSeconds: number; expectedSeconds: number; maximumSeconds: number };
	measurements: AllocationMeasurement[];
	constraints: AssignmentAllocationConstraint[];
	providerMinimumSeconds?: number;
	providerMaximumSeconds?: number;
	profileMaximumSeconds?: number;
	planningTurnMaximumSeconds?: number;
}) {
	const calibration = calibrateAssignmentSeconds(input.estimate, input.measurements);
	const minimumSeconds = Math.max(1, nonnegative(input.estimate.minimumSeconds), nonnegative(input.providerMinimumSeconds ?? 1));
	const constraints = [...input.constraints];
	for (const [id, value] of [['provider-maximum', input.providerMaximumSeconds], ['profile-maximum', input.profileMaximumSeconds],
		['planning-turn', input.planningTurnMaximumSeconds]] as const) if (value !== undefined) constraints.push({ id, remainingSeconds: nonnegative(value) });
	if (!constraints.length) throw new Error('allocation_constraints_required');
	for (const entry of constraints) nonnegative(entry.remainingSeconds);
	constraints.sort((a, b) => a.remainingSeconds - b.remainingSeconds || a.id.localeCompare(b.id));
	const availableSeconds = Math.floor(constraints[0]!.remainingSeconds);
	const desiredSeconds = input.planningTurnMaximumSeconds ?? calibration.seconds;
	const allocatedSeconds = Math.min(Math.max(minimumSeconds, desiredSeconds), availableSeconds);
	return { admitted: availableSeconds >= minimumSeconds, allocatedSeconds: availableSeconds >= minimumSeconds ? allocatedSeconds : 0,
		minimumSeconds, desiredSeconds, calibration,
		limitingConstraint: availableSeconds < Math.max(minimumSeconds, desiredSeconds) ? constraints[0]!.id : 'task-duration', constraints };
}
