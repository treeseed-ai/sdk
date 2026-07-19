import type {
	CapacityAdmissionCounterClaim,
	CapacityAdmissionReasonCode,
	CapacityAllocationSetV2,
	CapacityAllocationSlice,
} from '../allocation.ts';

interface AllocationHierarchyInput {
	allocation: CapacityAllocationSetV2;
	workdayId: string;
	totalCredits: number;
	requestedCredits: number;
	selectedSliceIds: string[];
	committedBySlice: Record<string, number>;
	committedBorrowedByRule?: Record<string, number>;
	reserveCommittedCredits?: number;
	approvedBorrowingRuleIds?: string[];
}

export interface AllocationHierarchyDecision {
	reasons: CapacityAdmissionReasonCode[];
	explanation: Array<{ gate: string; allowed: boolean; remaining?: number; detail?: string }>;
	counterClaims: CapacityAdmissionCounterClaim[];
	maxReservableCredits: number;
	requiresApproval: boolean;
	calculations: Record<string, unknown>;
	priorityBand: 'minimum' | 'target' | 'normal' | 'overflow';
	priorityScore: number;
}

function sliceLimits(allocation: CapacityAllocationSetV2, totalCredits: number, slice: CapacityAllocationSlice, cache = new Map<string, Record<string, number>>()): Record<string, number> {
	const cached = cache.get(slice.id);
	if (cached) return cached;
	const parent = slice.parentSliceId ? allocation.slices.find((candidate) => candidate.id === slice.parentSliceId) : null;
	const basis = parent ? sliceLimits(allocation, totalCredits, parent, cache).target : totalCredits;
	const limits = {
		min: basis * slice.policy.minPercent / 100,
		target: basis * slice.policy.targetPercent / 100,
		max: basis * slice.policy.maxPercent / 100,
		hard: basis * slice.policy.hardCapPercent / 100,
	};
	cache.set(slice.id, limits);
	return limits;
}

function claim(id: string, scope: CapacityAdmissionCounterClaim['scope'], scopeId: string, periodKey: string, hardLimit: number, amount: number): CapacityAdmissionCounterClaim | null {
	return amount > 0 ? { id, scope, scopeId, periodKey, hardLimit, amount, release: 'settlement-difference' } : null;
}

export function evaluateAllocationHierarchy(input: AllocationHierarchyInput): AllocationHierarchyDecision {
	const reasons: CapacityAdmissionReasonCode[] = [];
	const explanation: AllocationHierarchyDecision['explanation'] = [];
	const counterClaims: CapacityAdmissionCounterClaim[] = [];
	const calculations: Record<string, unknown> = {};
	const approved = new Set(input.approvedBorrowingRuleIds ?? []);
	const cache = new Map<string, Record<string, number>>();
	let remaining = Number.POSITIVE_INFINITY;
	let requiresApproval = false;
	let priorityScore = 4;
	for (const sliceId of input.selectedSliceIds) {
		const slice = input.allocation.slices.find((candidate) => candidate.id === sliceId);
		if (!slice) {
			reasons.push('allocation_slice_missing');
			explanation.push({ gate: `allocation:${sliceId}`, allowed: false, detail: 'selected slice does not exist' });
			continue;
		}
		const limits = sliceLimits(input.allocation, input.totalCredits, slice, cache);
		const committed = input.committedBySlice[sliceId] ?? 0;
		const normalAvailable = Math.max(0, limits.max - committed);
		const overflowAvailable = Math.max(0, limits.hard - Math.max(committed, limits.max));
		let available = normalAvailable;
		let overflowSource = 'none';
		let overflowRuleId: string | null = null;
		let overflowSourceAvailable = 0;
		if (overflowAvailable > 0) {
			const rule = input.allocation.borrowingRules.find((candidate) => candidate.toSliceId === sliceId);
			if (rule) {
				const donor = input.allocation.slices.find((candidate) => candidate.id === rule.fromSliceId);
				if (donor) {
					const donorLimits = sliceLimits(input.allocation, input.totalCredits, donor, cache);
					const donorCommitted = input.committedBySlice[donor.id] ?? 0;
					const donorAvailable = Math.max(0, donorLimits.target - Math.max(donorCommitted, donorLimits.min));
					const ruleLimit = donorLimits.target * rule.maxPercent / 100;
					const ruleAvailable = Math.max(0, ruleLimit - (input.committedBorrowedByRule?.[rule.id] ?? 0));
					overflowSource = 'borrowing-rule';
					overflowRuleId = rule.id;
					overflowSourceAvailable = Math.min(donorAvailable, ruleAvailable);
				}
			} else if (!slice.parentSliceId) {
				overflowSource = 'reserve';
				overflowSourceAvailable = Math.max(0, input.totalCredits * input.allocation.reservePolicy.percent / 100 - (input.reserveCommittedCredits ?? 0));
			}
		}
		const usableOverflow = Math.min(overflowAvailable, overflowSourceAvailable);
		if (input.allocation.reservePolicy.overflow === 'borrow') available += usableOverflow;
		else if (input.requestedCredits > normalAvailable && input.allocation.reservePolicy.overflow === 'approval-required') {
			requiresApproval = true;
			reasons.push('allocation_borrowing_approval_required');
		}
		if (overflowRuleId) {
			const rule = input.allocation.borrowingRules.find((candidate) => candidate.id === overflowRuleId)!;
			if (rule.requiresApproval && !approved.has(rule.id) && input.requestedCredits > normalAvailable) {
				requiresApproval = true;
				reasons.push('allocation_borrowing_approval_required');
				available = normalAvailable;
			}
		}
		if (input.requestedCredits > available && !reasons.includes('allocation_borrowing_approval_required')) {
			reasons.push(input.allocation.reservePolicy.overflow === 'deny' ? 'allocation_borrowing_denied' : 'allocation_hard_cap_exhausted');
		}
		remaining = Math.min(remaining, available);
		const ownAmount = Math.min(input.requestedCredits, normalAvailable);
		const overflowAmount = Math.max(0, input.requestedCredits - ownAmount);
		const ownClaim = claim(`allocation-slice:${input.allocation.id}:${slice.id}:${input.workdayId}`, 'allocation-slice', `${input.allocation.id}:${slice.id}`, input.workdayId, limits.max, ownAmount);
		if (ownClaim) counterClaims.push(ownClaim);
		if (overflowAmount > 0 && overflowAmount <= usableOverflow && input.allocation.reservePolicy.overflow === 'borrow') {
			const overflowClaim = claim(`allocation-overflow:${input.allocation.id}:${slice.id}:${input.workdayId}`, 'allocation-overflow', `${input.allocation.id}:${slice.id}`, input.workdayId, Math.max(0, limits.hard - limits.max), overflowAmount);
			if (overflowClaim) counterClaims.push(overflowClaim);
			if (overflowSource === 'reserve') {
				const reserveClaim = claim(`allocation-reserve:${input.allocation.id}:${input.workdayId}`, 'allocation-reserve', input.allocation.id, input.workdayId, input.totalCredits * input.allocation.reservePolicy.percent / 100, overflowAmount);
				if (reserveClaim) counterClaims.push(reserveClaim);
			} else if (overflowRuleId) {
				const rule = input.allocation.borrowingRules.find((candidate) => candidate.id === overflowRuleId)!;
				const donor = input.allocation.slices.find((candidate) => candidate.id === rule.fromSliceId)!;
				const donorLimits = sliceLimits(input.allocation, input.totalCredits, donor, cache);
				const donorClaim = claim(`allocation-slice:${input.allocation.id}:${donor.id}:${input.workdayId}`, 'allocation-slice', `${input.allocation.id}:${donor.id}`, input.workdayId, donorLimits.target, overflowAmount);
				const ruleClaim = claim(`allocation-borrow:${input.allocation.id}:${rule.id}:${input.workdayId}`, 'allocation-borrow', `${input.allocation.id}:${rule.id}`, input.workdayId, donorLimits.target * rule.maxPercent / 100, overflowAmount);
				if (donorClaim) counterClaims.push(donorClaim);
				if (ruleClaim) counterClaims.push(ruleClaim);
			}
		}
		const position = committed < limits.min ? 'below-minimum' : committed < limits.target ? 'below-target' : committed < limits.max ? 'above-target' : 'overflow';
		priorityScore = Math.min(priorityScore, position === 'below-minimum' ? 4 : position === 'below-target' ? 3 : position === 'above-target' ? 2 : 1);
		calculations[sliceId] = { committed, ...limits, normalAvailable, overflowAvailable, overflowSource, overflowSourceAvailable, usableOverflow, position };
		explanation.push({ gate: `allocation:${sliceId}`, allowed: input.requestedCredits <= available, remaining: available, detail: JSON.stringify(calculations[sliceId]) });
	}
	const priorityBand = priorityScore === 4 ? 'minimum' : priorityScore === 3 ? 'target' : priorityScore === 2 ? 'normal' : 'overflow';
	return { reasons: [...new Set(reasons)], explanation, counterClaims, maxReservableCredits: Number.isFinite(remaining) ? Math.max(0, remaining) : 0, requiresApproval, calculations, priorityBand, priorityScore };
}
