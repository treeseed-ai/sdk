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
	dailyAgentSecondsLimit?: number | null;
	monthlyAgentSecondsLimit?: number | null;
	maxConcurrentAssignments?: number | null;
	budgetLimits?: {
		tokens?: number | null;
		cost?: { amount: number; currency: string } | null;
		native?: Array<{ unit: string; amount: number }>;
	} | null;
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
	| 'grant_time_exhausted'
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
	| 'requested_seconds_invalid'
	| 'requested_budget_invalid'
	| 'grant_token_exhausted'
	| 'grant_cost_exhausted'
	| 'grant_native_exhausted'
	| 'provider_budget_exhausted';

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
		requestedSeconds: number;
		budget?: import('./contracts/support/time-capacity.ts').CapacityBudgetV2 | null;
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
		totalSeconds: number;
		committedSeconds: number;
	};
	allocationSet?: CapacityAllocationSetV2 | null;
	allocationSliceIds: string[];
	committedSecondsBySlice: Record<string, number>;
	committedBorrowedSecondsByRule?: Record<string, number>;
	reserveCommittedSeconds?: number;
	approvedBorrowingRuleIds?: string[];
	providerCapacity: {
		availableAgentSeconds: number;
		availableConcurrentAssignments: number;
		capabilities?: string[];
		availableTokens?: number | null;
		availableCost?: number | null;
		availableNative?: Record<string, number>;
	};
	providerLocalLimits: {
		availableAgentSeconds: number;
		availableConcurrentAssignments: number;
		availableTokens?: number | null;
		availableCost?: number | null;
		availableNative?: Record<string, number>;
	};
	grantCommitted: {
		dailyAgentSeconds: number;
		monthlyAgentSeconds: number;
		activeAssignments: number;
		tokens?: number;
		cost?: number;
		native?: Record<string, number>;
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
	maxReservableSeconds: number;
	requiresApproval: boolean;
	allocationPriorityBand: 'minimum' | 'target' | 'normal' | 'overflow';
	allocationPriorityScore: number;
	grantId?: string | null;
	allocationSetId?: string | null;
	allocationVersion?: number | null;
	counterClaims: CapacityAdmissionCounterClaim[];
	policySnapshot: Record<string, unknown>;
	explanation: Array<{ gate: string; allowed: boolean; remaining?: number; detail?: string }>;
}

export interface CapacityAdmissionCounterClaim {
	id: string;
	scope: 'grant-daily' | 'grant-monthly' | 'grant-concurrency' | 'grant-token' | 'grant-cost' | 'grant-native' | 'provider-time' | 'provider-concurrency' | 'provider-token' | 'provider-cost' | 'provider-native' | 'provider-local-time' | 'provider-local-concurrency' | 'provider-local-token' | 'provider-local-cost' | 'provider-local-native' | 'workday' | 'allocation-slice' | 'allocation-overflow' | 'allocation-reserve' | 'allocation-borrow';
	scopeId: string;
	periodKey: string;
	hardLimit: number;
	amount: number;
	release: 'settlement-difference' | 'assignment-terminal';
	dimension?: 'time' | 'concurrency' | 'tokens' | 'cost' | 'native';
	unit?: string | null;
}

export { validateCapacityAllocationSetV2,validateCapacityGrantV2 } from './validation/allocation.ts';
export type { CapacityAllocationDiagnostic,CapacityAllocationValidation } from './validation/allocation.ts';
