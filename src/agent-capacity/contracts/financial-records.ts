export type CapacityBusinessModel =
	| 'subscription_quota'
	| 'token_metered'
	| 'hybrid_usage_based'
	| 'infrastructure_runtime'
	| 'custom';

export type CapacityLaneUnit =
	| 'treeseed_credit'
	| 'quota_minute'
	| 'token_usd'
	| 'github_ai_credit'
	| 'worker_second'
	| 'request'
	| 'custom';

export type CapacityReservationState =
	| 'reserved'
	| 'consuming'
	| 'consumed'
	| 'released'
	| 'expired'
	| 'failed'
	| 'overran_pending_approval'
	| 'continuation_required';

export interface CapacityReservation {
	id: string;
	idempotencyKey: string;
	membershipId: string;
	grantId: string;
	capacityProviderId: string;
	executionProviderId: string | null;
	laneId: string | null;
	allocationSetId: string;
	allocationVersion: number;
	allocationSliceIds: string[];
	policySnapshot: Record<string, unknown>;
	projectAgentClassId: string;
	assignmentId: string | null;
	mode: 'planning' | 'acting';
	teamId: string;
	projectId: string;
	workDayId: string | null;
	taskId: string | null;
	state: CapacityReservationState;
	reservedCredits: number;
	consumedCredits: number;
	nativeUnit: string | null;
	reservedNativeAmount: number | null;
	consumedNativeAmount: number | null;
	reservedProviderUnits: number | null;
	consumedProviderUnits: number | null;
	reservedUsd: number | null;
	consumedUsd: number | null;
	expiresAt: string | null;
	metadata: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
}

export type CapacityLedgerPhase =
	| 'task_completed_actual_settlement'
	| 'reservation_released'
	| 'task_failed_refund'
	| 'overrun_hold';

export interface CapacityLedgerEntry {
	id: string;
	settlementKey: string;
	membershipId: string;
	capacityProviderId: string;
	reservationId: string | null;
	assignmentId: string | null;
	modeRunId: string | null;
	mode: 'planning' | 'acting' | null;
	teamId: string;
	projectId: string | null;
	workDayId: string | null;
	taskId: string | null;
	phase: CapacityLedgerPhase;
	credits: number;
	providerUnits: number | null;
	usd: number | null;
	source: string;
	metadata: Record<string, unknown>;
	createdAt: string;
}

export interface NativeUsageObservation {
	nativeUnit?: string | null;
	amount?: number | null;
	wallMinutes?: number | null;
	quotaMinutes?: number | null;
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedInputTokens?: number | null;
	usd?: number | null;
	filesOpened?: number | null;
	filesChanged?: number | null;
	diffLinesAdded?: number | null;
	diffLinesRemoved?: number | null;
	testRuns?: number | null;
	retryCount?: number | null;
	partial?: boolean | null;
	interrupted?: boolean | null;
	source?: string | null;
	observedAt?: string | null;
	metadata?: Record<string, unknown> | null;
	[key: string]: unknown;
}

export interface CapacityUsageActual {
	id: string;
	idempotencyKey: string;
	taskId: string | null;
	workDayId: string | null;
	projectId: string;
	taskSignature: string;
	executionProfileId: string;
	assignmentId: string | null;
	assignmentAttempt: number;
	usageDimension: string;
	accountingMode: 'informational' | 'incremental' | 'aggregate';
	modeRunId: string | null;
	mode: 'planning' | 'acting' | null;
	capacityProviderId: string | null;
	executionProviderId: string | null;
	laneId: string | null;
	businessModel: CapacityBusinessModel | string;
	modelName: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedInputTokens: number | null;
	quotaMinutes: number | null;
	wallMinutes: number | null;
	filesOpened: number | null;
	filesChanged: number | null;
	diffLinesAdded: number | null;
	diffLinesRemoved: number | null;
	testRuns: number | null;
	retryCount: number | null;
	actualCredits: number;
	actualUsd: number | null;
	creditFormulaVersion: string;
	actualCreditSource: string;
	nativeUsage: NativeUsageObservation | Record<string, unknown>;
	metadata: Record<string, unknown>;
	createdAt: string;
}
