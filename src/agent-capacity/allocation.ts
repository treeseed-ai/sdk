export type CapacityAllocationSetStatus = 'draft' | 'validated' | 'active' | 'superseded' | 'archived';
export type CapacityAllocationScope = 'project' | 'agent-class' | 'mode';
export type CapacityAllocationOverflow = 'deny' | 'approval-required' | 'borrow';
export type CapacityGrantStatus = 'planned' | 'active' | 'paused' | 'revoked' | 'expired';

export interface CapacityAllocationSlicePolicy {
	targetPercent: number;
	minPercent: number;
	maxPercent: number;
	hardCapPercent: number;
}

export interface CapacityAllocationSlice {
	id: string;
	scope: CapacityAllocationScope;
	targetId: string;
	parentSliceId?: string | null;
	policy: CapacityAllocationSlicePolicy;
	metadata?: Record<string, unknown>;
}

export interface CapacityReservePolicy {
	percent: number;
	overflow: CapacityAllocationOverflow;
}

export interface CapacityBorrowingRule {
	id: string;
	fromSliceId: string;
	toSliceId: string;
	maxPercent: number;
	requiresApproval: boolean;
	allocationPriorityBand: 'minimum' | 'target' | 'normal' | 'overflow';
	allocationPriorityScore: number;
}

export interface CapacityAllocationSetV2 {
	schemaVersion: 2;
	id: string;
	teamId: string;
	version: number;
	status: CapacityAllocationSetStatus;
	effectiveFrom: string;
	effectiveUntil?: string | null;
	reservePolicy: CapacityReservePolicy;
	slices: CapacityAllocationSlice[];
	borrowingRules: CapacityBorrowingRule[];
	createdById?: string | null;
	activatedAt?: string | null;
	supersededById?: string | null;
	metadata?: Record<string, unknown>;
	createdAt?: string;
	updatedAt?: string;
}

export interface CapacityGrantV2 {
	schemaVersion: 2;
	id: string;
	membershipId: string;
	teamId: string;
	providerId: string;
	projectId: string;
	environment: string;
	status: CapacityGrantStatus;
	executionProviderIds: string[];
	laneIds: string[];
	capabilities: string[];
	allowedModes: Array<'planning' | 'acting'>;
	dailyCreditLimit?: number | null;
	monthlyCreditLimit?: number | null;
	maxConcurrentAssignments?: number | null;
	unmetered?: boolean;
	expiresAt?: string | null;
	metadata?: Record<string, unknown>;
}

export type CapacityAdmissionReasonCode =
	| 'allowed'
	| 'membership_not_approved'
	| 'membership_id_mismatch'
	| 'membership_suspended'
	| 'membership_revoked'
	| 'membership_team_mismatch'
	| 'membership_provider_mismatch'
	| 'availability_session_not_open'
	| 'outside_availability_window'
	| 'missing_active_grant'
	| 'grant_membership_mismatch'
	| 'grant_team_mismatch'
	| 'grant_provider_mismatch'
	| 'grant_expired'
	| 'grant_project_mismatch'
	| 'grant_environment_mismatch'
	| 'grant_mode_denied'
	| 'grant_capability_missing'
	| 'grant_execution_provider_denied'
	| 'grant_lane_denied'
	| 'grant_credit_exhausted'
	| 'grant_concurrency_exhausted'
	| 'workday_not_active'
	| 'workday_budget_exhausted'
	| 'allocation_set_not_active'
	| 'allocation_set_not_effective'
	| 'allocation_team_mismatch'
	| 'allocation_slice_missing'
	| 'allocation_hard_cap_exhausted'
	| 'allocation_borrowing_approval_required'
	| 'allocation_borrowing_denied'
	| 'provider_capacity_exhausted'
	| 'provider_capability_missing'
	| 'provider_local_limit_exhausted'
	| 'acting_decision_not_approved'
	| 'acting_readiness_not_ready'
	| 'acting_capacity_plan_not_accepted'
	| 'requested_credits_invalid';

export interface CapacityAdmissionInput {
	now: string;
	request: {
		teamId: string;
		providerId: string;
		membershipId: string;
		projectId: string;
		environment: string;
		agentClassId: string;
		mode: 'planning' | 'acting';
		executionProviderId?: string | null;
		laneId?: string | null;
		requiredCapabilities: string[];
		requestedCredits: number;
	};
	membership: {
		id: string;
		teamId: string;
		providerId: string;
		status: 'approved' | 'suspended' | 'revoked';
	};
	availability: {
		status: 'open' | 'draining' | 'closed' | 'expired';
		availableFrom: string;
		availableUntil?: string | null;
	};
	grant?: CapacityGrantV2 | null;
	workday: {
		id: string;
		status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
		totalCredits: number;
		committedCredits: number;
	};
	allocationSet?: CapacityAllocationSetV2 | null;
	allocationSliceIds: string[];
	committedCreditsBySlice: Record<string, number>;
	committedBorrowedCreditsByRule?: Record<string, number>;
	reserveCommittedCredits?: number;
	approvedBorrowingRuleIds?: string[];
	providerCapacity: {
		availableCredits: number;
		availableConcurrentAssignments: number;
		capabilities?: string[];
	};
	providerLocalLimits: {
		availableCredits: number;
		availableConcurrentAssignments: number;
	};
	grantCommitted: {
		dailyCredits: number;
		monthlyCredits: number;
		activeAssignments: number;
	};
	acting?: {
		decisionApproved: boolean;
		readinessReady: boolean;
		capacityPlanAccepted: boolean;
	};
}

export interface CapacityAdmissionDecision {
	allowed: boolean;
	reasonCode: CapacityAdmissionReasonCode;
	reasonCodes: CapacityAdmissionReasonCode[];
	maxReservableCredits: number;
	requiresApproval: boolean;
	grantId?: string | null;
	allocationSetId?: string | null;
	allocationVersion?: number | null;
	counterClaims: CapacityAdmissionCounterClaim[];
	policySnapshot: Record<string, unknown>;
	explanation: Array<{ gate: string; allowed: boolean; remaining?: number; detail?: string }>;
}

export interface CapacityAdmissionCounterClaim {
	id: string;
	scope: 'grant-daily' | 'grant-monthly' | 'grant-concurrency' | 'workday' | 'allocation-slice' | 'allocation-overflow' | 'allocation-reserve' | 'allocation-borrow';
	scopeId: string;
	periodKey: string;
	hardLimit: number;
	amount: number;
	release: 'settlement-difference' | 'assignment-terminal';
}

export { validateCapacityAllocationSetV2, validateCapacityGrantV2 } from './validation/allocation.ts';
export type { CapacityAllocationDiagnostic, CapacityAllocationValidation } from './validation/allocation.ts';

function timestamp(value: string | null | undefined) {
	const parsed = value ? Date.parse(value) : Number.NaN;
	return Number.isFinite(parsed) ? parsed : null;
}

function firstReason(reasons: CapacityAdmissionReasonCode[]): CapacityAdmissionReasonCode {
	return reasons[0] ?? 'allowed';
}

export function evaluateCapacityAdmission(input: CapacityAdmissionInput): CapacityAdmissionDecision {
	const reasons: CapacityAdmissionReasonCode[] = [];
	const explanation: CapacityAdmissionDecision['explanation'] = [];
	let remaining = Number.POSITIVE_INFINITY;
	let requiresApproval = false;
	let allocationCalculations: Record<string, unknown> = {};
	let allocationPriorityBand: CapacityAdmissionDecision['allocationPriorityBand'] = 'overflow';
	let allocationPriorityScore = 0;
	const counterClaims: CapacityAdmissionCounterClaim[] = [];
	const deny = (gate: string, code: CapacityAdmissionReasonCode, detail?: string) => {
		reasons.push(code);
		explanation.push({ gate, allowed: false, detail });
	};
	const allow = (gate: string, gateRemaining?: number, detail?: string) => {
		if (gateRemaining !== undefined) remaining = Math.min(remaining, Math.max(0, gateRemaining));
		explanation.push({ gate, allowed: true, remaining: gateRemaining, detail });
	};
	const now = timestamp(input.now) ?? Date.now();
	const request = input.request;
	if (!Number.isFinite(request.requestedCredits) || request.requestedCredits <= 0) deny('request', 'requested_credits_invalid');
	if (input.membership.status !== 'approved') deny('membership', input.membership.status === 'suspended' ? 'membership_suspended' : input.membership.status === 'revoked' ? 'membership_revoked' : 'membership_not_approved');
	else allow('membership');
	if (input.membership.id !== request.membershipId) deny('membership-id', 'membership_id_mismatch'); else allow('membership-id');
	if (input.membership.teamId !== request.teamId) deny('membership-team', 'membership_team_mismatch'); else allow('membership-team');
	if (input.membership.providerId !== request.providerId) deny('membership-provider', 'membership_provider_mismatch'); else allow('membership-provider');
	if (input.availability.status !== 'open') deny('availability', 'availability_session_not_open');
	else if ((timestamp(input.availability.availableFrom) ?? Number.POSITIVE_INFINITY) > now || (input.availability.availableUntil && (timestamp(input.availability.availableUntil) ?? 0) <= now)) deny('availability', 'outside_availability_window');
	else allow('availability');
	const grant = input.grant;
	if (!grant || grant.status !== 'active') deny('grant', 'missing_active_grant');
	else {
		if (grant.membershipId !== request.membershipId) deny('grant-membership', 'grant_membership_mismatch'); else allow('grant-membership');
		if (grant.teamId !== request.teamId) deny('grant-team', 'grant_team_mismatch'); else allow('grant-team');
		if (grant.providerId !== request.providerId) deny('grant-provider', 'grant_provider_mismatch'); else allow('grant-provider');
		if (grant.expiresAt && (timestamp(grant.expiresAt) ?? 0) <= now) deny('grant-expiry', 'grant_expired'); else allow('grant-expiry');
		if (grant.projectId !== request.projectId) deny('grant-project', 'grant_project_mismatch'); else allow('grant-project');
		if (grant.environment !== request.environment) deny('grant-environment', 'grant_environment_mismatch'); else allow('grant-environment');
		if (!grant.allowedModes.includes(request.mode)) deny('grant-mode', 'grant_mode_denied'); else allow('grant-mode');
		const missing = request.requiredCapabilities.filter((capability) => !grant.capabilities.includes(capability));
		if (missing.length) deny('grant-capabilities', 'grant_capability_missing', missing.join(', ')); else allow('grant-capabilities');
		if (request.executionProviderId && grant.executionProviderIds.length && !grant.executionProviderIds.includes(request.executionProviderId)) deny('grant-execution-provider', 'grant_execution_provider_denied'); else allow('grant-execution-provider');
		if (request.laneId && grant.laneIds.length && !grant.laneIds.includes(request.laneId)) deny('grant-lane', 'grant_lane_denied'); else allow('grant-lane');
		if (!grant.unmetered && grant.dailyCreditLimit == null && grant.monthlyCreditLimit == null) deny('grant-credits', 'grant_credit_exhausted', 'Grant must declare positive limits or explicit unmetered capacity.');
		if (grant.dailyCreditLimit != null) {
			const available = grant.dailyCreditLimit - input.grantCommitted.dailyCredits;
			if (available <= 0) deny('grant-daily', 'grant_credit_exhausted'); else allow('grant-daily', available);
			counterClaims.push({ id: `grant-daily:${grant.id}:${input.now.slice(0, 10)}`, scope: 'grant-daily', scopeId: grant.id, periodKey: input.now.slice(0, 10), hardLimit: grant.dailyCreditLimit, amount: request.requestedCredits, release: 'settlement-difference' });
		}
		if (grant.monthlyCreditLimit != null) {
			const available = grant.monthlyCreditLimit - input.grantCommitted.monthlyCredits;
			if (available <= 0) deny('grant-monthly', 'grant_credit_exhausted'); else allow('grant-monthly', available);
			counterClaims.push({ id: `grant-monthly:${grant.id}:${input.now.slice(0, 7)}`, scope: 'grant-monthly', scopeId: grant.id, periodKey: input.now.slice(0, 7), hardLimit: grant.monthlyCreditLimit, amount: request.requestedCredits, release: 'settlement-difference' });
		}
		if (grant.maxConcurrentAssignments != null) {
			const available = grant.maxConcurrentAssignments - input.grantCommitted.activeAssignments;
			if (available < 1) deny('grant-concurrency', 'grant_concurrency_exhausted'); else allow('grant-concurrency');
			counterClaims.push({ id: `grant-concurrency:${grant.id}:active`, scope: 'grant-concurrency', scopeId: grant.id, periodKey: 'active', hardLimit: grant.maxConcurrentAssignments, amount: 1, release: 'assignment-terminal' });
		}
	}
	if (input.workday.status !== 'active') deny('workday', 'workday_not_active');
	else {
		const available = input.workday.totalCredits - input.workday.committedCredits;
		if (available <= 0) deny('workday-budget', 'workday_budget_exhausted'); else allow('workday-budget', available);
		counterClaims.push({ id: `workday:${input.workday.id}:lifetime`, scope: 'workday', scopeId: input.workday.id, periodKey: 'lifetime', hardLimit: input.workday.totalCredits, amount: request.requestedCredits, release: 'settlement-difference' });
	}
	const allocation = input.allocationSet;
	if (!allocation || allocation.status !== 'active') deny('allocation', 'allocation_set_not_active');
	else if (allocation.teamId !== request.teamId) deny('allocation', 'allocation_team_mismatch');
	else if ((timestamp(allocation.effectiveFrom) ?? Number.POSITIVE_INFINITY) > now || (allocation.effectiveUntil && (timestamp(allocation.effectiveUntil) ?? 0) <= now)) deny('allocation', 'allocation_set_not_effective');
	else {
		allow('allocation');
		const hierarchy = evaluateAllocationHierarchy({
			allocation,
			workdayId: input.workday.id,
			totalCredits: input.workday.totalCredits,
			requestedCredits: request.requestedCredits,
			selectedSliceIds: input.allocationSliceIds,
			committedBySlice: input.committedCreditsBySlice,
			committedBorrowedByRule: input.committedBorrowedCreditsByRule,
			reserveCommittedCredits: input.reserveCommittedCredits,
			approvedBorrowingRuleIds: input.approvedBorrowingRuleIds,
		});
		reasons.push(...hierarchy.reasons);
		explanation.push(...hierarchy.explanation);
		counterClaims.push(...hierarchy.counterClaims);
		remaining = Math.min(remaining, hierarchy.maxReservableCredits);
		requiresApproval ||= hierarchy.requiresApproval;
		allocationCalculations = hierarchy.calculations;
		allocationPriorityBand = hierarchy.priorityBand;
		allocationPriorityScore = hierarchy.priorityScore;
	}
	if (input.providerCapacity.availableConcurrentAssignments < 1 || input.providerCapacity.availableCredits <= 0) deny('provider-capacity', 'provider_capacity_exhausted');
	else allow('provider-capacity', input.providerCapacity.availableCredits);
	const advertisedCapabilities = input.providerCapacity.capabilities;
	if (advertisedCapabilities) {
		const missing = request.requiredCapabilities.filter((capability) => !advertisedCapabilities.includes(capability));
		if (missing.length) deny('provider-capabilities', 'provider_capability_missing', missing.join(', ')); else allow('provider-capabilities');
	}
	if (input.providerLocalLimits.availableConcurrentAssignments < 1 || input.providerLocalLimits.availableCredits <= 0) deny('provider-local', 'provider_local_limit_exhausted');
	else allow('provider-local', input.providerLocalLimits.availableCredits);
	if (request.mode === 'acting') {
		if (!input.acting?.decisionApproved) deny('acting-decision', 'acting_decision_not_approved'); else allow('acting-decision');
		if (!input.acting?.readinessReady) deny('acting-readiness', 'acting_readiness_not_ready'); else allow('acting-readiness');
		if (!input.acting?.capacityPlanAccepted) deny('acting-capacity-plan', 'acting_capacity_plan_not_accepted'); else allow('acting-capacity-plan');
	}
	if (remaining <= 0 && !reasons.includes('grant_credit_exhausted') && !reasons.includes('workday_budget_exhausted') && !reasons.includes('allocation_hard_cap_exhausted')) reasons.push('allocation_hard_cap_exhausted');
	const maxReservableCredits = Number.isFinite(remaining) ? Math.max(0, remaining) : 0;
	const allowed = reasons.length === 0 && maxReservableCredits >= request.requestedCredits;
	if (!allowed && reasons.length === 0) reasons.push('allocation_hard_cap_exhausted');
	return {
		allowed,
		reasonCode: firstReason(reasons),
		reasonCodes: reasons,
		maxReservableCredits,
		requiresApproval,
		allocationPriorityBand,
		allocationPriorityScore,
		grantId: grant?.id ?? null,
		allocationSetId: allocation?.id ?? null,
		allocationVersion: allocation?.version ?? null,
		counterClaims,
		policySnapshot: {
			allocationSetId: allocation?.id ?? null,
			allocationVersion: allocation?.version ?? null,
			grantId: grant?.id ?? null,
			allocationSliceIds: [...input.allocationSliceIds],
			requestedCredits: request.requestedCredits,
			laneId: request.laneId ?? null,
			counterClaims,
			calculations: allocationCalculations,
			allocationPriorityBand,
			allocationPriorityScore,
		},
		explanation,
	};
}
import { evaluateAllocationHierarchy } from './policy/allocation-hierarchy.ts';
