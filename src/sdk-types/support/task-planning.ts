export type CapacityScarcityLevel = 'low' | 'medium' | 'high';

export type CapacityEstimatePhase = 'intent' | 'discovery' | 'plan' | 'execution' | 'actual';

export type CapacityEstimateConfidence = 'low' | 'medium' | 'high';

export type CapacityApprovalState =
	| 'pending'
	| 'approved'
	| 'changes_requested'
	| 'deferred'
	| 'rejected'
	| 'expired'
	| 'superseded';

export type TaskRiskClass = 'low' | 'medium' | 'high';

export type TaskMutationScope = 'none' | 'repository_read' | 'repository_write' | 'production';

export type TaskConcurrencyClass = 'read_only' | 'repository_claim' | 'exclusive_project' | 'human_attention';

export type TaskAdmissionOutcome =
	| 'admitted'
	| 'planning_required'
	| 'approval_required'
	| 'budget_blocked'
	| 'deferred'
	| 'rejected';

export type CanonicalTaskState =
	| 'pending'
	| 'queued'
	| 'claimed'
	| 'running'
	| 'completed'
	| 'failed'
	| 'waiting'
	| 'paused_for_approval'
	| 'checkpointing'
	| 'checkpointed'
	| 'continuation_required'
	| 'rollback_required'
	| 'rollback_complete'
	| 'provider_exhausted'
	| 'reservation_exhausted';

export type RepositoryWorkState =
	| 'clean'
	| 'claimed_dirty'
	| 'checkpointed_dirty'
	| 'parked_dirty'
	| 'rollback_required';

export interface TaskClassification {
	taskSignature: string;
	risk: TaskRiskClass;
	mutationScope: TaskMutationScope;
	concurrencyClass: TaskConcurrencyClass;
	expectedFanout: number;
	confidence: CapacityEstimateConfidence;
	requiresPlanning: boolean;
	requiresApproval: boolean;
	features?: Record<string, unknown>;
}

export interface AttentionEstimate {
	attentionWeight: number;
	coordinationWeight: number;
	totalAttentionWeight: number;
	estimatedContextTokens: number;
	requiredContextTokens: number;
	source: string;
	metadata?: Record<string, unknown>;
}

export interface AttentionPolicy {
	maxAttentionLoad: number | null;
	reserveAttentionPercent: number;
	maxContextTokens: number | null;
	maxContextSaturationPercent: number;
	coordinationOverheadFactor: number;
}

export interface UtilityEstimate {
	utilityValue: number;
	maintenanceValue: number;
	deadlinePressure: number;
	successProbability: number;
	qualityScore: number;
	riskPenalty: number;
	utilityScore: number;
	utilityPerAgentSecond: number;
	source: string;
	metadata?: Record<string, unknown>;
}

export interface UtilityPolicy {
	minimumUtilityScore: number | null;
	minimumUtilityPerAgentSecond: number | null;
	riskPenaltyFactor: number;
	deadlineWindowHours: number;
	maintenanceWeight: number;
	priorityWeight: number;
}

export interface PredictiveReservePolicy {
	enabled: boolean;
	baseReservePercent: number;
	maxReservePercent: number;
	incidentReservePercent: number;
	triggerBurstReservePercent: number;
	deploymentWindowReservePercent: number;
	providerDegradationReservePercent: number;
	quotaPressureReservePercent: number;
}

export interface ReservePrediction {
	reservePercent: number;
	reserveSeconds: number;
	activelyAllocatableSeconds: number;
	reasons: string[];
	signals: Record<string, unknown>;
}

export interface HybridExecutionPhase {
	id: string;
	kind: 'planning' | 'implementation' | 'review' | 'human_escalation' | string;
	executionProfileId: string;
	taskSignature?: string | null;
	required: boolean;
	admissionRequired: boolean;
	mutationAllowed: boolean;
	metadata?: Record<string, unknown>;
}

export interface HybridExecutionPlan {
	schemaVersion: 1;
	planId: string;
	phases: HybridExecutionPhase[];
	escalationPolicy?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
}

export interface WorkdayBudgetEnvelope {
	dailyAgentSeconds: number;
	usedSeconds: number;
	queuedSeconds: number;
	reserveBufferSeconds: number;
	recoverySeconds: number;
	activelyAllocatableSeconds: number;
	remainingSeconds: number;
}

export interface TaskAdmissionPolicy {
	planningThresholdSeconds: number;
	approvalThresholdSeconds: number;
	reserveBufferPercent: number;
	recoverySeconds: number;
	maxDownstreamTasks: number;
	maxPlanningDepth: number;
	maxAdmittedPlanTasksPerCycle: number;
	planningTaskSignature: string;
	allowBackfill?: boolean;
	maxAttentionLoad?: number | null;
	reserveAttentionPercent?: number | null;
	maxContextTokens?: number | null;
	maxContextSaturationPercent?: number | null;
	coordinationOverheadFactor?: number | null;
	predictiveReservePolicy?: Partial<PredictiveReservePolicy> | null;
	utilityPolicy?: Partial<UtilityPolicy> | null;
}

export interface TaskAdmissionDecision {
	outcome: TaskAdmissionOutcome;
	taskSignature: string;
	estimatedSecondsP50: number;
	estimatedSecondsP90: number;
	reservedSeconds: number;
	baseReservedSeconds?: number;
	executionProfileId?: string | null;
	costMultiplier?: number | null;
	reasons: string[];
	requiresApproval: boolean;
	requiresPlanning: boolean;
	budget: WorkdayBudgetEnvelope;
	policySnapshot: TaskAdmissionPolicy;
	metadata?: Record<string, unknown>;
}

export interface TaskCheckpointArtifact {
	id?: string;
	taskId: string;
	checkpointId?: string;
	branch?: string | null;
	baseCommit?: string | null;
	currentCommit?: string | null;
	currentGoal?: string | null;
	currentPhase?: string | null;
	filesChanged: string[];
	commandsRun: string[];
	testStatus?: 'not_run' | 'passing' | 'failing' | 'unknown' | string;
	knownFailures: string[];
	completedWork: string[];
	remainingWorkEstimate?: { p50: number; p90: number } | null;
	rollbackStrategy?: string | null;
	continuationStrategy?: string | null;
	repositoryState: RepositoryWorkState;
	createdAt: string;
	metadata?: Record<string, unknown>;
}

export interface PlannedTaskNode {
	id?: string;
	type: string;
	agentId?: string | null;
	title?: string | null;
	priority?: number | null;
	taskSignature?: string | null;
	payload?: Record<string, unknown>;
	estimatedSecondsP50?: number | null;
	estimatedSecondsP90?: number | null;
	risk?: TaskRiskClass | null;
	mutationScope?: TaskMutationScope | null;
	confidence?: CapacityEstimateConfidence | null;
	expectedFanout?: number | null;
	requiresApproval?: boolean | null;
	requiresPlanning?: boolean | null;
	dependsOn?: string[];
	metadata?: Record<string, unknown>;
}

export interface TaskPlanProposal {
	schemaVersion: 1;
	planId: string;
	sourceTaskId?: string | null;
	parentTaskId?: string | null;
	planningDepth: number;
	tasks: PlannedTaskNode[];
	totalEstimatedSecondsP50: number;
	totalEstimatedSecondsP90: number;
	createdAt?: string | null;
	metadata?: Record<string, unknown>;
}
