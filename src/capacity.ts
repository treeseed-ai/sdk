import type {
	AttentionEstimate,
	AttentionPolicy,
	CapacityEstimateConfidence,
	CapacityGrant,
	CapacityPlan,
	CapacityProvider,
	CapacityProviderLane,
	CapacityReservation,
	CapacityScarcityLevel,
	CreateCapacityReservationRequest,
	CreateCapacityRoutingDecisionRequest,
	ExecutionProfile,
	HybridExecutionPlan,
	PlannedTaskNode,
	PlanningAdmissionResult,
	PlanningPolicy,
	PredictiveReservePolicy,
	RecordCapacityUsageRequest,
	ReservePrediction,
	TaskAdmissionDecision,
	TaskAdmissionPolicy,
	TaskClassification,
	TaskEstimateProfile,
	TaskPlanProposal,
	TaskMutationScope,
	TaskUsageActual,
	UtilityEstimate,
	UtilityPolicy,
	WorkdayBudgetEnvelope,
} from './sdk-types.ts';
import type { AgentProviderProfile } from './types/agents.ts';

export type ProcessingEnvironment = 'local' | 'staging' | 'prod';

export interface CapacityProviderRegistration {
	id: string;
	teamId: string;
	providerKind: 'processing-host';
	serviceBaseUrl: string;
	environments: ProcessingEnvironment[];
	capabilities: string[];
	status: 'pending' | 'active' | 'degraded' | 'disabled';
	heartbeatAt: string;
	limits: {
		maxWorkers: number;
		dailyTaskCreditBudget: number;
		maxQueuedTasks: number;
	};
}

export interface CapacityProviderHeartbeat {
	providerId: string;
	status: CapacityProviderRegistration['status'];
	heartbeatAt: string;
	queueDepth?: number | null;
	activeWorkers?: number | null;
	draining?: boolean;
}

export interface CapacityProviderHealth {
	ok: boolean;
	status: CapacityProviderRegistration['status'];
	capabilities: string[];
	queueDepth: number;
	activeWorkers: number;
	draining: boolean;
	checkedAt: string;
}

export interface CapacityEstimateInput {
	taskSignature?: string | null;
	taskKind?: string | null;
	confidence?: CapacityEstimateConfidence | null;
	estimatedCreditsP50?: number | null;
	estimatedCreditsP90?: number | null;
	profile?: TaskEstimateProfile | null;
	profiles?: TaskEstimateProfile[] | null;
	defaultCredits?: number | null;
	executionProfile?: ExecutionProfile | null;
	executionProfileId?: string | null;
	costMultiplier?: number | null;
}

export interface CapacityLaneCandidate {
	lane: CapacityProviderLane;
	grant?: CapacityGrant | null;
	remainingCredits?: number | null;
	agentProfile?: AgentProviderProfile | null;
	taskKind?: string | null;
	requiredCapabilities?: string[];
	modelClass?: string | null;
	region?: string | null;
}

export interface CapacityLaneScore {
	laneId: string;
	capacityProviderId: string;
	score: number;
	agentFit: number;
	scarcityPenalty: number;
	fairnessScore: number;
	costPenalty: number;
	qualityFit?: number;
	latencyPenalty?: number;
	quotaPressure?: number;
	congestionPenalty?: number;
	attentionPenalty?: number;
	contextPenalty?: number;
	utilityScore?: number;
	utilityPerCredit?: number;
	predictedReserveImpact?: number;
	trustScore?: number | null;
	successProbability?: number | null;
	executionProfileId?: string | null;
	reservedCredits?: number | null;
	attentionEstimate?: AttentionEstimate | null;
	utilityEstimate?: UtilityEstimate | null;
	reservePrediction?: ReservePrediction | null;
	spilloverReason?: string | null;
	trustScore?: number | null;
	successProbability?: number | null;
	reasons: string[];
}

export interface CapacityTaskEstimate {
	taskSignature: string;
	confidence: CapacityEstimateConfidence;
	estimatedCreditsP50: number;
	estimatedCreditsP90: number;
	reservedCredits: number;
	baseReservedCredits?: number;
	executionProfileId?: string | null;
	costMultiplier?: number | null;
}

export interface AdmissionEstimateInput extends CapacityEstimateInput {
	classification?: TaskClassification | null;
}

export interface WorkdayBudgetEnvelopeInput {
	dailyCreditBudget: number;
	usedCredits?: number | null;
	queuedCredits?: number | null;
	reserveBufferPercent?: number | null;
	recoveryBudgetCredits?: number | null;
}

export interface TaskAdmissionInput {
	classification: TaskClassification;
	estimate: CapacityTaskEstimate;
	budget: WorkdayBudgetEnvelopeInput;
	policy?: Partial<TaskAdmissionPolicy> | null;
	source?: string | null;
	metadata?: Record<string, unknown>;
}

export interface CapacityInterruptionInput {
	reservedCredits?: number | null;
	consumedCredits?: number | null;
	estimatedRemainingCreditsP50?: number | null;
	estimatedRemainingCreditsP90?: number | null;
	reservationUsedPercentThreshold?: number | null;
	recoveryBudgetRemainingCredits?: number | null;
	recoveryBudgetMinimumCredits?: number | null;
	providerAvailable?: boolean | null;
}

export interface TeamCapacitySummary {
	teamId: string;
	monthlyCredits: number | null;
	monthlyUsedCredits: number;
	monthlyRemainingCredits: number | null;
	dailyCredits: number | null;
	dailyUsedCredits: number;
	dailyReservedCredits: number;
	dailyRemainingCredits: number | null;
	providerCount: number;
	activeProviderCount: number;
	degradedProviderCount: number;
	grantCount: number;
	blockedTaskCount: number;
	approvalRequiredCount: number;
}

export interface ProjectCapacitySummary extends TeamCapacitySummary {
	projectId: string;
	environment: ProcessingEnvironment;
	readiness:
		| 'ready'
		| 'waiting_for_budget'
		| 'waiting_for_provider'
		| 'paused_by_policy'
		| 'needs_approval';
	reasons: string[];
}

export interface RouteAndReserveInput {
	plan: CapacityPlan;
	estimate: CapacityTaskEstimate;
	classification?: TaskClassification | null;
	taskId?: string | null;
	workDayId?: string | null;
	taskKind?: string | null;
	requiredCapabilities?: string[];
	modelClass?: string | null;
	priorityClass?: string | null;
	allowDegradedProviders?: boolean;
	repositoryMutation?: boolean;
	production?: boolean;
	selectedModel?: string | null;
	executionProfile?: ExecutionProfile | string | null;
	executionProfiles?: Array<ExecutionProfile | string> | null;
	estimateProfiles?: TaskEstimateProfile[] | null;
	minimumQualityWeight?: number | null;
	requiredContextTokens?: number | null;
	estimatedContextTokens?: number | null;
	attentionWeight?: number | null;
	coordinationWeight?: number | null;
	minimumAttentionAvailable?: number | null;
	attentionPolicy?: Partial<AttentionPolicy> | null;
	attentionEstimate?: AttentionEstimate | null;
	utilityPolicy?: Partial<UtilityPolicy> | null;
	utilityEstimate?: UtilityEstimate | null;
	utilityValue?: number | null;
	maintenanceValue?: number | null;
	deadlineAt?: string | null;
	successProbability?: number | null;
	trustRequirement?: number | null;
	cooperativeRouting?: boolean | null;
	predictiveReservePolicy?: Partial<PredictiveReservePolicy> | null;
	hybridExecutionPlan?: HybridExecutionPlan | Record<string, unknown> | null;
	preferredExecutionProfiles?: string[] | null;
	disallowedExecutionProfiles?: string[] | null;
	source?: string;
	metadata?: Record<string, unknown>;
}

export type RouteAndReserveBlockCode =
	| 'no_capacity_provider'
	| 'no_capacity_grant'
	| 'no_eligible_lane'
	| 'insufficient_budget'
	| 'approval_required';

export interface RouteAndReserveCandidate {
	providerId: string;
	laneId: string;
	grantId: string;
	executionProfileId?: string | null;
	remainingCredits: number | null;
	score: CapacityLaneScore;
	eligible: boolean;
	reasons: string[];
	estimate?: CapacityTaskEstimate;
	pressure?: CapacityRoutePressure;
	qualityFit?: number;
	attentionEstimate?: AttentionEstimate;
	utilityEstimate?: UtilityEstimate;
	reservePrediction?: ReservePrediction | null;
	trustScore?: number | null;
	successProbability?: number | null;
	spilloverReason?: string | null;
}

export interface CapacityRoutePressure {
	activeReservations: number;
	maxActiveReservations: number | null;
	congestionRatio: number;
	quotaRemainingPercent: number | null;
	sessionRemainingMinutes: number | null;
	subscriptionSaturationPercent: number | null;
	providerUnavailable: boolean;
	activeAttentionLoad: number;
	maxAttentionLoad: number | null;
	attentionSaturationPercent: number | null;
	activeContextTokens: number;
	maxContextTokens: number | null;
	contextSaturationPercent: number | null;
}

export type RouteAndReserveResult =
	| {
		ok: true;
		provider: CapacityProvider;
		lane: CapacityProviderLane;
		grant: CapacityGrant;
		estimate: CapacityTaskEstimate;
		remainingCreditsBefore: number | null;
		reservation: CreateCapacityReservationRequest;
		routingDecision: CreateCapacityRoutingDecisionRequest;
		ledgerEntry: RecordCapacityUsageRequest;
		capacityMetadata: {
			providerId: string;
			laneId: string;
			grantId: string;
			reservationId: string | null;
			routingDecisionId: string | null;
			estimatedCreditsP50: number;
			estimatedCreditsP90: number;
			reservedCredits: number;
			executionProfileId?: string | null;
			costMultiplier?: number | null;
			score?: number | null;
			attentionEstimate?: AttentionEstimate | null;
			utilityEstimate?: UtilityEstimate | null;
			reservePrediction?: ReservePrediction | null;
			hybridExecutionPlan?: HybridExecutionPlan | null;
			candidates?: Record<string, unknown>[];
		};
		candidates: RouteAndReserveCandidate[];
	}
	| {
		ok: false;
		code: RouteAndReserveBlockCode;
		reason: string;
		estimate: CapacityTaskEstimate;
		candidates: RouteAndReserveCandidate[];
	};

export interface CapacitySettlementInput {
	reservation: CapacityReservation;
	actualCredits: number;
	actualProviderUnits?: number | null;
	actualUsd?: number | null;
	teamId?: string | null;
	projectId?: string | null;
	workDayId?: string | null;
	taskId?: string | null;
	source?: string;
	metadata?: Record<string, unknown>;
}

export interface CapacitySettlement {
	reservationId: string;
	state: 'consumed' | 'overran_pending_approval';
	consumeEntry: RecordCapacityUsageRequest;
	releaseEntry: RecordCapacityUsageRequest | null;
	overrunEntry: RecordCapacityUsageRequest | null;
	consumedCredits: number;
	releasedCredits: number;
	overrunCredits: number;
}

export const DEFAULT_EXECUTION_PROFILE_ID = 'standard-code-model';

function finiteNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteOrParsedNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	if (typeof value === 'string' && value.trim()) {
		const parsed = Number.parseFloat(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function positiveNumber(value: unknown, fallback: number) {
	const parsed = finiteNumber(value);
	return parsed !== null && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number) {
	const parsed = finiteNumber(value);
	return parsed !== null && parsed >= 0 ? parsed : fallback;
}

function scarcityPenalty(level: CapacityScarcityLevel) {
	if (level === 'high') return 35;
	if (level === 'medium') return 15;
	return 0;
}

function metadataStatus(value: Record<string, unknown> | undefined) {
	const status = value?.status;
	return typeof status === 'string' ? status : null;
}

function stringArray(value: unknown) {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function booleanValue(value: unknown) {
	return typeof value === 'boolean' ? value : null;
}

function numberValue(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function profileIdFrom(input?: ExecutionProfile | string | null) {
	if (!input) return DEFAULT_EXECUTION_PROFILE_ID;
	if (typeof input === 'string') return input.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	return input.id?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
}

function metadataFlag(metadata: Record<string, unknown> | null | undefined, key: string) {
	return metadata?.[key] === true || metadata?.[key] === 'true';
}

function numericActuals(values: Array<number | null | undefined>) {
	return values
		.map((value) => finiteOrParsedNumber(value))
		.filter((value): value is number => value !== null && value >= 0)
		.sort((left, right) => left - right);
}

export function estimateLearningPercentile(values: Array<number | null | undefined>, percentile: number) {
	const sorted = numericActuals(values);
	if (sorted.length === 0) return null;
	const bounded = Math.min(100, Math.max(0, percentile));
	const index = Math.ceil((bounded / 100) * sorted.length) - 1;
	return sorted[Math.min(sorted.length - 1, Math.max(0, index))] ?? null;
}

export function estimateLearningVariance(values: Array<number | null | undefined>) {
	const samples = numericActuals(values);
	if (samples.length <= 1) return 0;
	const mean = samples.reduce((total, value) => total + value, 0) / samples.length;
	return samples.reduce((total, value) => total + ((value - mean) ** 2), 0) / samples.length;
}

export function isInterruptedUsageActual(actual: Pick<TaskUsageActual, 'metadata'> | { metadata?: Record<string, unknown> | null }) {
	const metadata = actual.metadata ?? {};
	return metadataFlag(metadata, 'interrupted') || metadataFlag(metadata, 'partial');
}

export function estimateProfileConfidenceScore(input: {
	sampleCount?: number | null;
	creditsVariance?: number | null;
	creditsP50?: number | null;
	lastSampleAt?: string | null;
	now?: Date | string | null;
}) {
	const sampleCount = Math.max(0, Math.floor(finiteOrParsedNumber(input.sampleCount) ?? 0));
	const sampleScore = Math.min(1, sampleCount / 20);
	const p50 = Math.max(1, finiteOrParsedNumber(input.creditsP50) ?? 1);
	const variance = Math.max(0, finiteOrParsedNumber(input.creditsVariance) ?? 0);
	const varianceScore = 1 / (1 + (Math.sqrt(variance) / p50));
	let ageScore = 1;
	if (input.lastSampleAt) {
		const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
		const last = new Date(input.lastSampleAt);
		if (Number.isFinite(last.valueOf()) && Number.isFinite(now.valueOf())) {
			const days = Math.max(0, (now.valueOf() - last.valueOf()) / 86_400_000);
			ageScore = days > 90 ? 0.35 : days > 30 ? 0.7 : 1;
		}
	}
	return Math.max(0, Math.min(1, sampleScore * varianceScore * ageScore));
}

export function estimateConfidenceFromProfile(profile: TaskEstimateProfile | null | undefined, now?: Date | string | null): CapacityEstimateConfidence {
	if (!profile) return 'medium';
	const confidenceScore = finiteOrParsedNumber(profile.confidenceScore)
		?? estimateProfileConfidenceScore({
			sampleCount: profile.completedSampleCount ?? profile.sampleCount,
			creditsVariance: profile.creditsVariance,
			creditsP50: profile.creditsP50,
			lastSampleAt: profile.lastSampleAt ?? profile.updatedAt,
			now,
		});
	if (confidenceScore >= 0.75) return 'high';
	if (confidenceScore >= 0.35) return 'medium';
	return 'low';
}

export function selectTaskEstimateProfile(input: {
	profiles?: TaskEstimateProfile[] | null;
	taskSignature?: string | null;
	executionProfile?: ExecutionProfile | string | null;
	executionProfileId?: string | null;
}) {
	const taskSignature = input.taskSignature?.trim();
	if (!taskSignature) return null;
	const executionProfileId = input.executionProfileId?.trim() || profileIdFrom(input.executionProfile);
	const profiles = input.profiles ?? [];
	return profiles.find((profile) =>
		profile.taskSignature === taskSignature
		&& (profile.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === executionProfileId
	)
		?? profiles.find((profile) =>
			profile.taskSignature === taskSignature
			&& (profile.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === DEFAULT_EXECUTION_PROFILE_ID
		)
		?? null;
}

export function buildTaskEstimateProfileFromActuals(input: {
	taskSignature: string;
	executionProfileId?: string | null;
	actuals: TaskUsageActual[];
	now?: Date | string | null;
}): TaskEstimateProfile {
	const taskSignature = input.taskSignature;
	const executionProfileId = input.executionProfileId?.trim() || DEFAULT_EXECUTION_PROFILE_ID;
	const matching = input.actuals.filter((actual) =>
		actual.taskSignature === taskSignature
		&& (actual.executionProfileId || DEFAULT_EXECUTION_PROFILE_ID) === executionProfileId
	);
	const completed = matching.filter((actual) => !isInterruptedUsageActual(actual));
	const interrupted = matching.filter((actual) => isInterruptedUsageActual(actual));
	const credits = completed.map((actual) => actual.actualCredits);
	const creditsP50 = estimateLearningPercentile(credits, 50);
	const creditsP90 = estimateLearningPercentile(credits, 90);
	const creditsVariance = estimateLearningVariance(credits);
	const outlierLimit = creditsP90 === null ? null : Math.max(creditsP90 * 1.5, (creditsP50 ?? creditsP90) + Math.sqrt(creditsVariance));
	const lastCreatedAt = matching
		.map((actual) => actual.createdAt)
		.filter((value): value is string => typeof value === 'string' && value.length > 0)
		.sort();
	const partialCredits = interrupted.reduce((total, actual) => total + Math.max(0, finiteOrParsedNumber(actual.actualCredits) ?? 0), 0);
	const updatedAt = input.now instanceof Date ? input.now.toISOString() : typeof input.now === 'string' ? input.now : new Date().toISOString();
	return {
		taskSignature,
		executionProfileId,
		sampleCount: matching.length,
		completedSampleCount: completed.length,
		interruptedSampleCount: interrupted.length,
		inputTokensP50: estimateLearningPercentile(completed.map((actual) => actual.inputTokens), 50),
		inputTokensP90: estimateLearningPercentile(completed.map((actual) => actual.inputTokens), 90),
		outputTokensP50: estimateLearningPercentile(completed.map((actual) => actual.outputTokens), 50),
		outputTokensP90: estimateLearningPercentile(completed.map((actual) => actual.outputTokens), 90),
		quotaMinutesP50: estimateLearningPercentile(completed.map((actual) => actual.quotaMinutes), 50),
		quotaMinutesP90: estimateLearningPercentile(completed.map((actual) => actual.quotaMinutes), 90),
		filesChangedP50: estimateLearningPercentile(completed.map((actual) => actual.filesChanged), 50),
		filesChangedP90: estimateLearningPercentile(completed.map((actual) => actual.filesChanged), 90),
		creditsP50,
		creditsP90,
		creditsVariance,
		confidenceScore: estimateProfileConfidenceScore({
			sampleCount: completed.length,
			creditsVariance,
			creditsP50,
			lastSampleAt: lastCreatedAt.at(-1) ?? null,
			now: input.now,
		}),
		outlierCount: outlierLimit === null ? 0 : credits.filter((value) => value > outlierLimit).length,
		partialCredits,
		firstSampleAt: lastCreatedAt[0] ?? null,
		lastSampleAt: lastCreatedAt.at(-1) ?? null,
		updatedAt,
	};
}

export const DEFAULT_EXECUTION_PROFILES: Record<string, ExecutionProfile> = {
	'local-runner': {
		id: 'local-runner',
		modelClass: 'local',
		qualityWeight: 1,
		costMultiplier: 1,
		latencyClass: 'low',
		concurrencyClass: 'read_only',
		quotaBehavior: 'compute_bound',
	},
	'local-fast-model': {
		id: 'local-fast-model',
		modelClass: 'local',
		qualityWeight: 0.65,
		costMultiplier: 0.35,
		latencyClass: 'low',
		concurrencyClass: 'read_only',
		quotaBehavior: 'compute_bound',
	},
	'small-code-model': {
		id: 'small-code-model',
		modelClass: 'coding',
		qualityWeight: 0.75,
		costMultiplier: 0.5,
		latencyClass: 'low',
		concurrencyClass: 'repository_claim',
		quotaBehavior: 'api_metered',
	},
	'standard-code-model': {
		id: 'standard-code-model',
		modelClass: 'coding',
		qualityWeight: 1,
		costMultiplier: 1,
		latencyClass: 'medium',
		concurrencyClass: 'repository_claim',
		quotaBehavior: 'api_metered',
	},
	'large-reasoning-model': {
		id: 'large-reasoning-model',
		modelClass: 'reasoning',
		qualityWeight: 1.5,
		costMultiplier: 3,
		latencyClass: 'high',
		concurrencyClass: 'exclusive_project',
		quotaBehavior: 'api_metered',
	},
	'long-context-architect': {
		id: 'long-context-architect',
		modelClass: 'reasoning',
		contextWindowTokens: 200_000,
		qualityWeight: 1.75,
		costMultiplier: 4,
		latencyClass: 'high',
		concurrencyClass: 'exclusive_project',
		quotaBehavior: 'api_metered',
	},
	'cheap-review-model': {
		id: 'cheap-review-model',
		modelClass: 'review',
		qualityWeight: 0.8,
		costMultiplier: 0.6,
		latencyClass: 'low',
		concurrencyClass: 'read_only',
		quotaBehavior: 'api_metered',
	},
	'human-review': {
		id: 'human-review',
		modelClass: 'human',
		qualityWeight: 2,
		costMultiplier: 10,
		latencyClass: 'high',
		concurrencyClass: 'human_attention',
		quotaBehavior: 'attention_bound',
	},
};

export const DEFAULT_TASK_ADMISSION_POLICY: TaskAdmissionPolicy = {
	planningThresholdCredits: 20,
	approvalThresholdCredits: 50,
	reserveBufferPercent: 15,
	recoveryBudgetCredits: 0,
	maxDownstreamTasks: 4,
	maxPlanningDepth: 2,
	maxAdmittedPlanTasksPerCycle: 4,
	planningTaskSignature: 'planner.dag_proposal',
	allowBackfill: true,
	maxAttentionLoad: null,
	reserveAttentionPercent: 0,
	maxContextTokens: null,
	maxContextSaturationPercent: 100,
	coordinationOverheadFactor: 1,
	predictiveReservePolicy: null,
	utilityPolicy: null,
};

export function normalizeExecutionProfile(input?: ExecutionProfile | string | null) {
	if (!input) return DEFAULT_EXECUTION_PROFILES['standard-code-model'];
	if (typeof input === 'string') {
		return DEFAULT_EXECUTION_PROFILES[input] ?? {
			id: input,
			qualityWeight: 1,
			costMultiplier: 1,
			latencyClass: 'medium',
			metadata: { source: 'ad_hoc' },
		};
	}
	return {
		...input,
		qualityWeight: positiveNumber(input.qualityWeight, 1),
		costMultiplier: positiveNumber(input.costMultiplier, 1),
		latencyClass: input.latencyClass || 'medium',
	};
}

export function normalizeTaskAdmissionPolicy(input: Partial<TaskAdmissionPolicy> | null | undefined = {}) {
	const reserveBufferPercent = nonNegativeNumber(input?.reserveBufferPercent, DEFAULT_TASK_ADMISSION_POLICY.reserveBufferPercent);
	return {
		...DEFAULT_TASK_ADMISSION_POLICY,
		...(input ?? {}),
		planningThresholdCredits: positiveNumber(input?.planningThresholdCredits, DEFAULT_TASK_ADMISSION_POLICY.planningThresholdCredits),
		approvalThresholdCredits: positiveNumber(input?.approvalThresholdCredits, DEFAULT_TASK_ADMISSION_POLICY.approvalThresholdCredits),
		reserveBufferPercent: Math.min(100, reserveBufferPercent),
		recoveryBudgetCredits: nonNegativeNumber(input?.recoveryBudgetCredits, DEFAULT_TASK_ADMISSION_POLICY.recoveryBudgetCredits),
		maxDownstreamTasks: Math.max(0, Math.floor(nonNegativeNumber(input?.maxDownstreamTasks, DEFAULT_TASK_ADMISSION_POLICY.maxDownstreamTasks))),
		maxPlanningDepth: Math.max(0, Math.floor(nonNegativeNumber(input?.maxPlanningDepth, DEFAULT_TASK_ADMISSION_POLICY.maxPlanningDepth))),
		maxAdmittedPlanTasksPerCycle: Math.max(1, Math.floor(nonNegativeNumber(input?.maxAdmittedPlanTasksPerCycle, DEFAULT_TASK_ADMISSION_POLICY.maxAdmittedPlanTasksPerCycle))),
		planningTaskSignature: typeof input?.planningTaskSignature === 'string' && input.planningTaskSignature.trim()
			? input.planningTaskSignature.trim()
			: DEFAULT_TASK_ADMISSION_POLICY.planningTaskSignature,
		allowBackfill: input?.allowBackfill ?? DEFAULT_TASK_ADMISSION_POLICY.allowBackfill,
		maxAttentionLoad: finiteOrParsedNumber(input?.maxAttentionLoad) ?? DEFAULT_TASK_ADMISSION_POLICY.maxAttentionLoad,
		reserveAttentionPercent: Math.min(100, nonNegativeNumber(input?.reserveAttentionPercent, DEFAULT_TASK_ADMISSION_POLICY.reserveAttentionPercent ?? 0)),
		maxContextTokens: finiteOrParsedNumber(input?.maxContextTokens) ?? DEFAULT_TASK_ADMISSION_POLICY.maxContextTokens,
		maxContextSaturationPercent: Math.min(100, positiveNumber(input?.maxContextSaturationPercent, DEFAULT_TASK_ADMISSION_POLICY.maxContextSaturationPercent ?? 100)),
		coordinationOverheadFactor: nonNegativeNumber(input?.coordinationOverheadFactor, DEFAULT_TASK_ADMISSION_POLICY.coordinationOverheadFactor ?? 1),
	};
}

export function normalizeAttentionPolicy(input: Partial<AttentionPolicy | TaskAdmissionPolicy> | null | undefined = {}): AttentionPolicy {
	return {
		maxAttentionLoad: finiteOrParsedNumber(input?.maxAttentionLoad) ?? null,
		reserveAttentionPercent: Math.min(100, nonNegativeNumber(input?.reserveAttentionPercent, 0)),
		maxContextTokens: finiteOrParsedNumber(input?.maxContextTokens) ?? null,
		maxContextSaturationPercent: Math.min(100, positiveNumber(input?.maxContextSaturationPercent, 100)),
		coordinationOverheadFactor: nonNegativeNumber(input?.coordinationOverheadFactor, 1),
	};
}

export function normalizeUtilityPolicy(input: Partial<UtilityPolicy> | null | undefined = {}): UtilityPolicy {
	return {
		minimumUtilityScore: finiteOrParsedNumber(input?.minimumUtilityScore) ?? null,
		minimumUtilityPerCredit: finiteOrParsedNumber(input?.minimumUtilityPerCredit) ?? null,
		riskPenaltyFactor: nonNegativeNumber(input?.riskPenaltyFactor, 1),
		deadlineWindowHours: positiveNumber(input?.deadlineWindowHours, 72),
		maintenanceWeight: nonNegativeNumber(input?.maintenanceWeight, 1),
		priorityWeight: nonNegativeNumber(input?.priorityWeight, 1),
	};
}

export function normalizePredictiveReservePolicy(input: Partial<PredictiveReservePolicy> | null | undefined = {}): PredictiveReservePolicy {
	const raw = readRecord(input);
	return {
		enabled: raw.enabled === true || raw.enabled === 'true',
		baseReservePercent: Math.min(100, nonNegativeNumber(input?.baseReservePercent, 0)),
		maxReservePercent: Math.min(100, positiveNumber(input?.maxReservePercent, 50)),
		incidentReservePercent: Math.min(100, nonNegativeNumber(input?.incidentReservePercent, 15)),
		triggerBurstReservePercent: Math.min(100, nonNegativeNumber(input?.triggerBurstReservePercent, 10)),
		deploymentWindowReservePercent: Math.min(100, nonNegativeNumber(input?.deploymentWindowReservePercent, 10)),
		providerDegradationReservePercent: Math.min(100, nonNegativeNumber(input?.providerDegradationReservePercent, 10)),
		quotaPressureReservePercent: Math.min(100, nonNegativeNumber(input?.quotaPressureReservePercent, 10)),
	};
}

function isoHoursUntil(value: unknown, now: Date) {
	if (typeof value !== 'string' || !value.trim()) return null;
	const target = new Date(value);
	if (!Number.isFinite(target.valueOf())) return null;
	return (target.valueOf() - now.valueOf()) / 3_600_000;
}

function riskPenalty(classification: TaskClassification | null | undefined, policy: UtilityPolicy) {
	if (classification?.risk === 'high') return 20 * policy.riskPenaltyFactor;
	if (classification?.risk === 'medium') return 8 * policy.riskPenaltyFactor;
	return 0;
}

function qualityScoreFromProfile(profile: ExecutionProfile, confidence?: CapacityEstimateConfidence | null) {
	const confidenceWeight = confidence === 'high' ? 1.1 : confidence === 'low' ? 0.75 : 1;
	return Math.max(0, profile.qualityWeight * confidenceWeight);
}

export function estimateUtilityForTask(input: {
	classification?: TaskClassification | null;
	executionProfile?: ExecutionProfile | string | null;
	estimate?: Pick<CapacityTaskEstimate, 'reservedCredits'> | null;
	utilityPolicy?: Partial<UtilityPolicy> | null;
	utilityValue?: number | null;
	maintenanceValue?: number | null;
	priority?: number | null;
	deadlineAt?: string | null;
	successProbability?: number | null;
	metadata?: Record<string, unknown> | null;
	source?: string | null;
	now?: Date | string | null;
}): UtilityEstimate {
	const policy = normalizeUtilityPolicy(input.utilityPolicy);
	const profile = normalizeExecutionProfile(input.executionProfile);
	const metadata = readRecord(input.metadata);
	const priority = Math.max(0, finiteOrParsedNumber(input.priority) ?? finiteOrParsedNumber(metadata.priority) ?? 0);
	const explicitUtility = finiteOrParsedNumber(input.utilityValue) ?? finiteOrParsedNumber(metadata.utilityValue);
	const maintenanceValue = Math.max(0, finiteOrParsedNumber(input.maintenanceValue) ?? finiteOrParsedNumber(metadata.maintenanceValue) ?? 0);
	const now = input.now instanceof Date ? input.now : new Date(input.now ?? Date.now());
	const hoursUntilDeadline = isoHoursUntil(input.deadlineAt ?? metadata.deadlineAt, now);
	const deadlinePressure = hoursUntilDeadline === null
		? 0
		: Math.max(0, Math.min(30, ((policy.deadlineWindowHours - hoursUntilDeadline) / Math.max(1, policy.deadlineWindowHours)) * 30));
	const successProbability = Math.max(0, Math.min(1, finiteOrParsedNumber(input.successProbability) ?? finiteOrParsedNumber(metadata.successProbability) ?? 1));
	const qualityScore = qualityScoreFromProfile(profile, input.classification?.confidence);
	const baseUtility = explicitUtility ?? ((priority * policy.priorityWeight) + (maintenanceValue * policy.maintenanceWeight));
	const risk = riskPenalty(input.classification, policy);
	const utilityScore = Math.max(0, ((baseUtility + deadlinePressure) * successProbability * Math.max(0.1, qualityScore)) - risk);
	const reservedCredits = Math.max(1, finiteOrParsedNumber(input.estimate?.reservedCredits) ?? 1);
	return {
		utilityValue: Math.max(0, baseUtility),
		maintenanceValue,
		deadlinePressure,
		successProbability,
		qualityScore,
		riskPenalty: risk,
		utilityScore,
		utilityPerCredit: utilityScore / reservedCredits,
		source: input.source ?? 'capacity_utility_estimator',
		metadata,
	};
}

function reserveSignalFlag(metadata: Record<string, unknown>, ...keys: string[]) {
	return keys.some((key) => metadata[key] === true || metadata[key] === 'true');
}

export function predictReserveForCapacityPlan(input: {
	plan?: CapacityPlan | null;
	policy?: Partial<PredictiveReservePolicy> | null;
	dailyCreditBudget?: number | null;
	remainingCredits?: number | null;
	metadata?: Record<string, unknown> | null;
}): ReservePrediction {
	const policy = normalizePredictiveReservePolicy(input.policy);
	const metadata = readRecord(input.metadata);
	const reasons: string[] = [];
	const signals: Record<string, unknown> = {};
	let reservePercent = policy.enabled ? policy.baseReservePercent : 0;
	const providerDegraded = input.plan?.providers.some((provider) => provider.status === 'degraded' || metadataStatus(provider.metadata) === 'degraded') ?? false;
	const quotaPressure = input.plan?.providers.some((provider) => {
		const pressure = readRecord(provider.metadata?.pressure);
		const quota = finiteOrParsedNumber(pressure.quotaRemainingPercent) ?? finiteOrParsedNumber(provider.metadata?.quotaRemainingPercent);
		return quota !== null && quota < 20;
	}) ?? false;
	if (policy.enabled && reserveSignalFlag(metadata, 'incidentLikely', 'likelyIncident')) {
		reservePercent += policy.incidentReservePercent;
		reasons.push('incident_reserve');
		signals.incidentLikely = true;
	}
	if (policy.enabled && reserveSignalFlag(metadata, 'triggerBurstLikely', 'expectedTriggerBurst')) {
		reservePercent += policy.triggerBurstReservePercent;
		reasons.push('trigger_burst_reserve');
		signals.triggerBurstLikely = true;
	}
	if (policy.enabled && reserveSignalFlag(metadata, 'deploymentWindow', 'deploymentWindowActive')) {
		reservePercent += policy.deploymentWindowReservePercent;
		reasons.push('deployment_window_reserve');
		signals.deploymentWindow = true;
	}
	if (policy.enabled && providerDegraded) {
		reservePercent += policy.providerDegradationReservePercent;
		reasons.push('provider_degradation_reserve');
		signals.providerDegraded = true;
	}
	if (policy.enabled && quotaPressure) {
		reservePercent += policy.quotaPressureReservePercent;
		reasons.push('quota_pressure_reserve');
		signals.quotaPressure = true;
	}
	const boundedPercent = Math.min(policy.maxReservePercent, Math.max(0, reservePercent));
	const budget = Math.max(0, finiteOrParsedNumber(input.dailyCreditBudget) ?? finiteOrParsedNumber(input.remainingCredits) ?? input.plan?.remaining.dailyCredits ?? 0);
	const reserveCredits = Math.ceil((budget * boundedPercent) / 100);
	const remaining = Math.max(0, finiteOrParsedNumber(input.remainingCredits) ?? input.plan?.remaining.dailyCredits ?? budget);
	return {
		reservePercent: boundedPercent,
		reserveCredits,
		activelyAllocatableCredits: Math.max(0, remaining - reserveCredits),
		reasons,
		signals,
	};
}

export function normalizeHybridExecutionPlan(input: HybridExecutionPlan | Record<string, unknown> | null | undefined): HybridExecutionPlan | null {
	const record = readRecord(input);
	const rawPhases = Array.isArray(record.phases) ? record.phases : [];
	const phases = rawPhases.map((phase, index) => {
		const entry = readRecord(phase);
		const kind = typeof entry.kind === 'string' && entry.kind.trim() ? entry.kind.trim() : `phase_${index + 1}`;
		const executionProfileId = typeof entry.executionProfileId === 'string' && entry.executionProfileId.trim()
			? entry.executionProfileId.trim()
			: typeof entry.executionProfile === 'string' && entry.executionProfile.trim()
				? entry.executionProfile.trim()
				: DEFAULT_EXECUTION_PROFILE_ID;
		const mutationAllowed = entry.mutationAllowed === true || (kind === 'implementation' && entry.mutationAllowed !== false);
		return {
			id: typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : kind,
			kind,
			executionProfileId,
			taskSignature: typeof entry.taskSignature === 'string' && entry.taskSignature.trim() ? entry.taskSignature.trim() : null,
			required: entry.required !== false,
			admissionRequired: entry.admissionRequired !== false,
			mutationAllowed,
			metadata: readRecord(entry.metadata),
		};
	});
	if (phases.length === 0) return null;
	return {
		schemaVersion: 1,
		planId: typeof record.planId === 'string' && record.planId.trim() ? record.planId.trim() : 'hybrid-execution-plan',
		phases,
		escalationPolicy: readRecord(record.escalationPolicy),
		metadata: readRecord(record.metadata),
	};
}

export function normalizePlanningPolicy(input: Partial<PlanningPolicy | TaskAdmissionPolicy> | null | undefined = {}): PlanningPolicy {
	const admissionPolicy = normalizeTaskAdmissionPolicy(input);
	return {
		maxDownstreamTasks: admissionPolicy.maxDownstreamTasks,
		maxPlanningDepth: admissionPolicy.maxPlanningDepth,
		maxAdmittedPlanTasksPerCycle: admissionPolicy.maxAdmittedPlanTasksPerCycle,
		planningTaskSignature: admissionPolicy.planningTaskSignature,
	};
}

function stablePlanId(input: Record<string, unknown>) {
	const source = typeof input.sourceTaskId === 'string' && input.sourceTaskId.trim()
		? input.sourceTaskId.trim()
		: typeof input.parentTaskId === 'string' && input.parentTaskId.trim()
			? input.parentTaskId.trim()
			: 'plan';
	return `${source}:proposal`;
}

function readRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readPlanString(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizePlannedTaskNode(value: unknown, index: number): PlannedTaskNode | null {
	const input = readRecord(value);
	const payload = readRecord(input.payload);
	const type = readPlanString(input.type) || readPlanString(payload.type);
	if (!type) return null;
	const id = readPlanString(input.id) || `node-${index + 1}`;
	const p50 = finiteNumber(input.estimatedCreditsP50) ?? finiteNumber(payload.estimatedCreditsP50) ?? finiteNumber(input.estimatedCredits) ?? finiteNumber(payload.estimatedCredits) ?? null;
	const p90 = finiteNumber(input.estimatedCreditsP90) ?? finiteNumber(payload.estimatedCreditsP90) ?? p50;
	return {
		id,
		type,
		agentId: readPlanString(input.agentId) || readPlanString(payload.agentId) || null,
		title: readPlanString(input.title) || null,
		priority: finiteNumber(input.priority) ?? finiteNumber(payload.priority),
		taskSignature: readPlanString(input.taskSignature) || readPlanString(payload.taskSignature) || null,
		payload,
		estimatedCreditsP50: p50,
		estimatedCreditsP90: p90,
		risk: input.risk === 'low' || input.risk === 'medium' || input.risk === 'high' ? input.risk : null,
		mutationScope: input.mutationScope === 'none' || input.mutationScope === 'repository_read' || input.mutationScope === 'repository_write' || input.mutationScope === 'production'
			? input.mutationScope
			: null,
		confidence: input.confidence === 'low' || input.confidence === 'medium' || input.confidence === 'high' ? input.confidence : null,
		expectedFanout: finiteNumber(input.expectedFanout) ?? finiteNumber(payload.expectedFanout),
		requiresApproval: typeof input.requiresApproval === 'boolean' ? input.requiresApproval : null,
		requiresPlanning: typeof input.requiresPlanning === 'boolean' ? input.requiresPlanning : null,
		dependsOn: Array.isArray(input.dependsOn) ? input.dependsOn.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [],
		metadata: readRecord(input.metadata),
	};
}

export function synthesizePlanEstimate(tasks: PlannedTaskNode[]) {
	const totalEstimatedCreditsP50 = tasks.reduce((total, task) => total + Math.max(0, Math.ceil(finiteNumber(task.estimatedCreditsP50) ?? finiteNumber(task.estimatedCreditsP90) ?? 1)), 0);
	const totalEstimatedCreditsP90 = tasks.reduce((total, task) => {
		const p50 = Math.max(1, Math.ceil(finiteNumber(task.estimatedCreditsP50) ?? 1));
		return total + Math.max(p50, Math.ceil(finiteNumber(task.estimatedCreditsP90) ?? p50));
	}, 0);
	return {
		totalEstimatedCreditsP50,
		totalEstimatedCreditsP90,
	};
}

export function rankPlannedTaskNodes(tasks: PlannedTaskNode[]) {
	const boundedness = (task: PlannedTaskNode) => {
		const fanout = Math.max(0, Math.floor(finiteNumber(task.expectedFanout) ?? 0));
		const riskPenalty = task.risk === 'high' ? 3 : task.risk === 'medium' ? 1 : 0;
		const mutationPenalty = task.mutationScope === 'production' ? 4 : task.mutationScope === 'repository_write' ? 2 : 0;
		return fanout + riskPenalty + mutationPenalty;
	};
	return [...tasks].sort((left, right) => {
		const priorityDelta = (finiteNumber(right.priority) ?? 0) - (finiteNumber(left.priority) ?? 0);
		if (priorityDelta !== 0) return priorityDelta;
		const boundedDelta = boundedness(left) - boundedness(right);
		if (boundedDelta !== 0) return boundedDelta;
		return String(left.id ?? left.type).localeCompare(String(right.id ?? right.type));
	});
}

export function normalizeTaskPlanProposal(input: unknown, policyInput?: Partial<PlanningPolicy | TaskAdmissionPolicy> | null): TaskPlanProposal {
	const policy = normalizePlanningPolicy(policyInput);
	const record = readRecord(input);
	const tasks = (Array.isArray(record.tasks) ? record.tasks : [])
		.map((entry, index) => normalizePlannedTaskNode(entry, index))
		.filter((entry): entry is PlannedTaskNode => Boolean(entry));
	const estimate = synthesizePlanEstimate(tasks);
	const planningDepth = Math.max(0, Math.floor(finiteNumber(record.planningDepth) ?? 0));
	return {
		schemaVersion: 1,
		planId: readPlanString(record.planId) || stablePlanId(record),
		sourceTaskId: readPlanString(record.sourceTaskId) || null,
		parentTaskId: readPlanString(record.parentTaskId) || null,
		planningDepth,
		tasks,
		totalEstimatedCreditsP50: Math.max(0, Math.ceil(finiteNumber(record.totalEstimatedCreditsP50) ?? estimate.totalEstimatedCreditsP50)),
		totalEstimatedCreditsP90: Math.max(0, Math.ceil(finiteNumber(record.totalEstimatedCreditsP90) ?? estimate.totalEstimatedCreditsP90)),
		createdAt: readPlanString(record.createdAt) || null,
		metadata: readRecord(record.metadata),
	};
}

export function validateTaskPlanProposal(input: TaskPlanProposal, policyInput?: Partial<PlanningPolicy | TaskAdmissionPolicy> | null) {
	const policy = normalizePlanningPolicy(policyInput);
	const reasons: string[] = [];
	if (input.planningDepth > policy.maxPlanningDepth) {
		reasons.push('planning_depth_exceeded');
	}
	if (input.tasks.length > policy.maxDownstreamTasks) {
		reasons.push('fanout_limit_exceeded');
	}
	const rejected = input.tasks
		.map((node) => {
			const nodeReasons: string[] = [];
			if (!node.type) nodeReasons.push('missing_type');
			if (Math.max(0, Math.floor(finiteNumber(node.expectedFanout) ?? 0)) > policy.maxDownstreamTasks) {
				nodeReasons.push('node_fanout_limit_exceeded');
			}
			return nodeReasons.length > 0 ? { node, reasons: nodeReasons } : null;
		})
		.filter((entry): entry is { node: PlannedTaskNode; reasons: string[] } => Boolean(entry));
	return {
		ok: reasons.length === 0 && rejected.length === 0,
		reasons,
		rejected,
	};
}

export function progressivelyAdmitPlanProposal(input: {
	proposal: TaskPlanProposal;
	policy?: Partial<PlanningPolicy | TaskAdmissionPolicy> | null;
	availableCredits?: number | null;
	remainingQueuedCredits?: number | null;
	remainingQueuedSlots?: number | null;
}): PlanningAdmissionResult {
	const policy = normalizePlanningPolicy(input.policy);
	const proposal = normalizeTaskPlanProposal(input.proposal, policy);
	const validation = validateTaskPlanProposal(proposal, policy);
	const reasons = [...validation.reasons];
	const admitted: PlannedTaskNode[] = [];
	const deferred: PlannedTaskNode[] = [];
	const rejected = [...validation.rejected];
	if (!validation.ok) {
		return {
			proposal,
			admitted,
			deferred: proposal.tasks.filter((node) => !rejected.some((entry) => entry.node.id === node.id)),
			rejected,
			totalEstimatedCreditsP50: proposal.totalEstimatedCreditsP50,
			totalEstimatedCreditsP90: proposal.totalEstimatedCreditsP90,
			admittedCreditsP90: 0,
			reasons,
		};
	}
	let availableCredits = Math.max(0, Math.floor(nonNegativeNumber(input.availableCredits, Number.POSITIVE_INFINITY)));
	let remainingQueuedCredits = Math.max(0, Math.floor(nonNegativeNumber(input.remainingQueuedCredits, Number.POSITIVE_INFINITY)));
	let remainingQueuedSlots = Math.max(0, Math.floor(nonNegativeNumber(input.remainingQueuedSlots, policy.maxAdmittedPlanTasksPerCycle)));
	let admittedCreditsP90 = 0;
	for (const task of rankPlannedTaskNodes(proposal.tasks)) {
		if (admitted.length >= policy.maxAdmittedPlanTasksPerCycle || remainingQueuedSlots <= 0) {
			deferred.push(task);
			reasons.push('plan_cycle_limit_reached');
			continue;
		}
		const p50 = Math.max(1, Math.ceil(finiteNumber(task.estimatedCreditsP50) ?? 1));
		const p90 = Math.max(p50, Math.ceil(finiteNumber(task.estimatedCreditsP90) ?? p50));
		if (p90 > availableCredits || p90 > remainingQueuedCredits) {
			deferred.push(task);
			reasons.push('insufficient_plan_budget');
			continue;
		}
		admitted.push(task);
		admittedCreditsP90 += p90;
		availableCredits -= p90;
		remainingQueuedCredits -= p90;
		remainingQueuedSlots -= 1;
	}
	return {
		proposal,
		admitted,
		deferred,
		rejected,
		totalEstimatedCreditsP50: proposal.totalEstimatedCreditsP50,
		totalEstimatedCreditsP90: proposal.totalEstimatedCreditsP90,
		admittedCreditsP90,
		reasons: [...new Set(reasons)],
	};
}

export function computeWorkdayBudgetEnvelope(input: WorkdayBudgetEnvelopeInput): WorkdayBudgetEnvelope {
	const dailyCreditBudget = Math.max(0, Math.floor(nonNegativeNumber(input.dailyCreditBudget, 0)));
	const usedCredits = Math.max(0, Math.ceil(nonNegativeNumber(input.usedCredits, 0)));
	const queuedCredits = Math.max(0, Math.ceil(nonNegativeNumber(input.queuedCredits, 0)));
	const reservePercent = Math.min(100, Math.max(0, nonNegativeNumber(input.reserveBufferPercent, DEFAULT_TASK_ADMISSION_POLICY.reserveBufferPercent)));
	const reserveBufferCredits = Math.ceil((dailyCreditBudget * reservePercent) / 100);
	const recoveryBudgetCredits = Math.ceil(nonNegativeNumber(input.recoveryBudgetCredits, DEFAULT_TASK_ADMISSION_POLICY.recoveryBudgetCredits));
	const remainingCredits = Math.max(0, dailyCreditBudget - usedCredits - queuedCredits);
	const activelyAllocatableCredits = Math.max(0, dailyCreditBudget - usedCredits - queuedCredits - reserveBufferCredits - recoveryBudgetCredits);
	return {
		dailyCreditBudget,
		usedCredits,
		queuedCredits,
		reserveBufferCredits,
		recoveryBudgetCredits,
		activelyAllocatableCredits,
		remainingCredits,
	};
}

export function mutationRequiresRepositoryClaim(scope: TaskMutationScope | null | undefined) {
	return scope === 'repository_write' || scope === 'production';
}

function reservationDebit(reservation: CapacityReservation) {
	if (reservation.state === 'released' || reservation.state === 'expired' || reservation.state === 'cancelled') {
		return 0;
	}
	if (reservation.state === 'consumed' || reservation.state === 'failed') {
		return Math.max(0, reservation.consumedCredits);
	}
	return Math.max(reservation.reservedCredits, reservation.consumedCredits, 0);
}

function activeReservationDebit(reservation: CapacityReservation) {
	if (reservation.state === 'reserved' || reservation.state === 'consuming') {
		return Math.max(reservation.reservedCredits, reservation.consumedCredits, 0);
	}
	if (reservation.state === 'consumed' || reservation.state === 'failed') {
		return Math.max(reservation.consumedCredits, 0);
	}
	return 0;
}

function grantMatchesReservation(grant: CapacityGrant, reservation: CapacityReservation) {
	if (grant.teamId !== reservation.teamId) return false;
	if (grant.capacityProviderId !== reservation.capacityProviderId) return false;
	if (grant.laneId && grant.laneId !== reservation.laneId) return false;
	if (grant.projectId && grant.projectId !== reservation.projectId) return false;
	return true;
}

function grantRemainingCredits(plan: CapacityPlan, grant: CapacityGrant) {
	const limit = grant.dailyCreditLimit ?? grant.monthlyCreditLimit;
	if (limit === null || limit === undefined) return null;
	const debits = plan.activeReservations
		.filter((reservation) => grantMatchesReservation(grant, reservation))
		.reduce((total, reservation) => total + reservationDebit(reservation), 0);
	return Math.max(0, Number(limit) - debits);
}

function providerIsEligible(provider: CapacityProvider, input: RouteAndReserveInput) {
	if (provider.status === 'active') return true;
	if (provider.status === 'degraded' && input.allowDegradedProviders) return true;
	return false;
}

function grantIsEligible(grant: CapacityGrant, input: RouteAndReserveInput) {
	if (grant.state !== 'active') return false;
	if (grant.teamId !== input.plan.teamId) return false;
	if (grant.environment && grant.environment !== input.plan.environment) return false;
	if (grant.projectId && grant.projectId !== input.plan.projectId) return false;
	return true;
}

function lanePolicyReasons(lane: CapacityProviderLane, input: RouteAndReserveInput) {
	const reasons: string[] = [];
	const laneStatus = metadataStatus(lane.metadata);
	if (laneStatus && laneStatus !== 'active') reasons.push(`lane_status:${laneStatus}`);

	const policy = lane.routingPolicy ?? {};
	const taskKinds = stringArray(policy.taskKinds);
	const taskKind = input.taskKind ?? input.estimate.taskSignature;
	if (taskKinds.length > 0 && !taskKinds.includes(taskKind)) reasons.push('task_kind_mismatch');

	const requiredCapabilities = stringArray(policy.requiredCapabilities);
	const missingCapabilities = (input.requiredCapabilities ?? [])
		.filter((capability) => !requiredCapabilities.includes(capability));
	if (requiredCapabilities.length > 0 && missingCapabilities.length > 0) {
		reasons.push('capability_mismatch');
	}

	const allowedEnvironments = stringArray(policy.allowedEnvironments);
	if (allowedEnvironments.length > 0 && !allowedEnvironments.includes(input.plan.environment)) {
		reasons.push('environment_mismatch');
	}

	const maxCreditsPerTask = numberValue(policy.maxCreditsPerTask);
	if (maxCreditsPerTask !== null && input.estimate.reservedCredits > maxCreditsPerTask) {
		reasons.push('task_credit_limit_exceeded');
	}

	const approvalThreshold = numberValue(policy.requiresApprovalAboveCredits);
	if (approvalThreshold !== null && input.estimate.reservedCredits > approvalThreshold) {
		reasons.push('approval_required');
	}

	const repositoryMutationAllowed = booleanValue(policy.repositoryMutationAllowed);
	if (input.repositoryMutation && repositoryMutationAllowed === false) {
		reasons.push('repository_mutation_not_allowed');
	}

	const productionAllowed = booleanValue(policy.productionAllowed);
	if (input.production && productionAllowed === false) {
		reasons.push('production_not_allowed');
	}

	return reasons;
}

export function reserveCreditsForEstimate(input: CapacityEstimateInput) {
	const executionProfile = input.executionProfile
		? normalizeExecutionProfile(input.executionProfile)
		: input.executionProfileId
			? normalizeExecutionProfile(input.executionProfileId)
			: null;
	const selectedProfile = input.profile ?? selectTaskEstimateProfile({
		profiles: input.profiles,
		taskSignature: input.taskSignature ?? input.taskKind,
		executionProfile,
		executionProfileId: input.executionProfileId,
	});
	const profileP50 = finiteNumber(selectedProfile?.creditsP50);
	const profileP90 = finiteNumber(selectedProfile?.creditsP90);
	const costMultiplier = positiveNumber(input.costMultiplier ?? executionProfile?.costMultiplier ?? 1, 1);
	const p50 = Math.max(1, Math.ceil(
		finiteNumber(input.estimatedCreditsP50)
		?? profileP50
		?? finiteNumber(input.defaultCredits)
		?? 1,
	));
	const p90 = Math.max(p50, Math.ceil(
		finiteNumber(input.estimatedCreditsP90)
		?? profileP90
		?? (p50 * 2),
	));
	const profileConfidence = selectedProfile ? estimateConfidenceFromProfile(selectedProfile) : null;
	const confidence = input.confidence ?? profileConfidence ?? 'medium';
	const baseReserved = confidence === 'high'
		? Math.max(p50, Math.ceil((p50 + p90) * 0.75))
		: p90;
	const reserved = Math.max(1, Math.ceil(baseReserved * costMultiplier));
	return {
		taskSignature: input.taskSignature ?? input.taskKind ?? 'unknown',
		confidence,
		estimatedCreditsP50: p50,
		estimatedCreditsP90: p90,
		reservedCredits: reserved,
		baseReservedCredits: baseReserved,
		executionProfileId: executionProfile?.id ?? input.executionProfileId ?? selectedProfile?.executionProfileId ?? null,
		costMultiplier,
	};
}

export function estimateForClassification(input: AdmissionEstimateInput): CapacityTaskEstimate {
	const classification = input.classification ?? null;
	return reserveCreditsForEstimate({
		...input,
		taskSignature: input.taskSignature ?? classification?.taskSignature,
		confidence: input.confidence ?? classification?.confidence,
	});
}

export function decideTaskAdmission(input: TaskAdmissionInput): TaskAdmissionDecision {
	const policy = normalizeTaskAdmissionPolicy(input.policy);
	const budget = computeWorkdayBudgetEnvelope({
		...input.budget,
		reserveBufferPercent: policy.reserveBufferPercent,
		recoveryBudgetCredits: policy.recoveryBudgetCredits,
	});
	const reasons: string[] = [];
	const reservedCredits = Math.max(1, Math.ceil(input.estimate.reservedCredits));
	const fanout = Math.max(0, Math.floor(input.classification.expectedFanout ?? 0));
	const highRisk = input.classification.risk === 'high' || input.classification.mutationScope === 'production';
	const requiresPlanning =
		input.classification.requiresPlanning
		|| fanout > policy.maxDownstreamTasks
		|| (reservedCredits >= policy.planningThresholdCredits && (input.classification.confidence === 'low' || fanout > 1 || highRisk));
	const requiresApproval =
		input.classification.requiresApproval
		|| highRisk
		|| reservedCredits >= policy.approvalThresholdCredits;

	let outcome: TaskAdmissionDecision['outcome'] = 'admitted';
	if (!input.classification.taskSignature || input.classification.taskSignature === 'unknown') {
		outcome = 'rejected';
		reasons.push('unknown_task_signature');
	}
	if (fanout > policy.maxDownstreamTasks) {
		reasons.push('fanout_limit_exceeded');
	}
	if (requiresPlanning) {
		outcome = 'planning_required';
		reasons.push('planning_required');
	}
	if (requiresApproval) {
		outcome = 'approval_required';
		reasons.push('approval_required');
	}
	if (outcome === 'admitted' && reservedCredits > budget.activelyAllocatableCredits) {
		outcome = 'budget_blocked';
		reasons.push('insufficient_allocatable_budget');
	}

	return {
		outcome,
		taskSignature: input.classification.taskSignature,
		estimatedCreditsP50: input.estimate.estimatedCreditsP50,
		estimatedCreditsP90: input.estimate.estimatedCreditsP90,
		reservedCredits,
		baseReservedCredits: input.estimate.baseReservedCredits,
		executionProfileId: input.estimate.executionProfileId ?? null,
		costMultiplier: input.estimate.costMultiplier ?? null,
		reasons: [...new Set(reasons)],
		requiresApproval,
		requiresPlanning,
		budget,
		policySnapshot: policy,
		metadata: {
			...(input.metadata ?? {}),
			source: input.source ?? null,
			classification: input.classification,
		},
	};
}

export function shouldInterruptForCapacity(input: CapacityInterruptionInput) {
	const reservedCredits = nonNegativeNumber(input.reservedCredits, 0);
	const consumedCredits = nonNegativeNumber(input.consumedCredits, 0);
	const threshold = Math.min(100, Math.max(1, nonNegativeNumber(input.reservationUsedPercentThreshold, 80)));
	const usedPercent = reservedCredits > 0 ? (consumedCredits / reservedCredits) * 100 : 0;
	const estimatedRemainingP50 = nonNegativeNumber(input.estimatedRemainingCreditsP50, 0);
	const estimatedRemainingP90 = nonNegativeNumber(input.estimatedRemainingCreditsP90, estimatedRemainingP50);
	const recoveryBudgetRemaining = input.recoveryBudgetRemainingCredits === undefined || input.recoveryBudgetRemainingCredits === null
		? null
		: nonNegativeNumber(input.recoveryBudgetRemainingCredits, 0);
	const recoveryMinimum = nonNegativeNumber(input.recoveryBudgetMinimumCredits, 3);
	const reasons: string[] = [];
	if (input.providerAvailable === false) {
		reasons.push('provider_unavailable');
	}
	if (reservedCredits > 0 && usedPercent >= threshold && estimatedRemainingP50 > Math.max(0, reservedCredits - consumedCredits)) {
		reasons.push('reservation_exhaustion_risk');
	}
	if (recoveryBudgetRemaining !== null && recoveryBudgetRemaining < recoveryMinimum) {
		reasons.push('recovery_budget_low');
	}
	return {
		interrupt: reasons.length > 0,
		reasons,
		usedPercent,
		estimatedRemainingP50,
		estimatedRemainingP90,
		remainingReservationCredits: Math.max(0, reservedCredits - consumedCredits),
	};
}

export function summarizeCapacityPlan(plan: CapacityPlan) {
	const reservedCredits = plan.activeReservations
		.filter((reservation) => reservation.state === 'reserved' || reservation.state === 'consuming')
		.reduce((total, reservation) => total + reservation.reservedCredits, 0);
	const consumedCredits = plan.activeReservations
		.reduce((total, reservation) => total + reservation.consumedCredits, 0);
	const grantedDailyCredits = plan.grants
		.filter((grant) => grant.state === 'active')
		.reduce((total, grant) => total + (grant.dailyCreditLimit ?? 0), 0);
	return {
		grantedDailyCredits,
		reservedCredits,
		consumedCredits,
		remainingDailyCredits: grantedDailyCredits > 0
			? Math.max(0, grantedDailyCredits - reservedCredits - consumedCredits)
			: null,
		providerCount: plan.providers.length,
		laneCount: plan.lanes.length,
		grantCount: plan.grants.length,
	};
}

export function summarizeTeamCapacityPlan(plan: CapacityPlan): TeamCapacitySummary {
	const dailyCredits = plan.grants
		.filter((grant) => grant.state === 'active')
		.reduce((total, grant) => total + (grant.dailyCreditLimit ?? 0), 0);
	const monthlyCredits = plan.grants
		.filter((grant) => grant.state === 'active')
		.reduce((total, grant) => total + (grant.monthlyCreditLimit ?? 0), 0);
	const dailyReservedCredits = plan.activeReservations
		.reduce((total, reservation) => total + activeReservationDebit(reservation), 0);
	const dailyUsedCredits = plan.activeReservations
		.reduce((total, reservation) => total + Math.max(0, reservation.consumedCredits), 0);
	return {
		teamId: plan.teamId,
		monthlyCredits: monthlyCredits > 0 ? monthlyCredits : null,
		monthlyUsedCredits: dailyUsedCredits,
		monthlyRemainingCredits: monthlyCredits > 0 ? Math.max(0, monthlyCredits - dailyUsedCredits) : null,
		dailyCredits: dailyCredits > 0 ? dailyCredits : null,
		dailyUsedCredits,
		dailyReservedCredits,
		dailyRemainingCredits: dailyCredits > 0 ? Math.max(0, dailyCredits - dailyReservedCredits - dailyUsedCredits) : null,
		providerCount: plan.providers.length,
		activeProviderCount: plan.providers.filter((provider) => provider.status === 'active').length,
		degradedProviderCount: plan.providers.filter((provider) => provider.status === 'degraded').length,
		grantCount: plan.grants.length,
		blockedTaskCount: 0,
		approvalRequiredCount: 0,
	};
}

export function summarizeProjectCapacityPlan(
	plan: CapacityPlan,
	options: { workPolicyEnabled?: boolean | null; approvalRequiredCount?: number; blockedTaskCount?: number } = {},
): ProjectCapacitySummary {
	const summary = summarizeTeamCapacityPlan(plan);
	const reasons: string[] = [];
	let readiness: ProjectCapacitySummary['readiness'] = 'ready';
	if (options.workPolicyEnabled === false) {
		readiness = 'paused_by_policy';
		reasons.push('work_policy_disabled');
	} else if (summary.activeProviderCount <= 0) {
		readiness = 'waiting_for_provider';
		reasons.push('no_active_provider');
	} else if (summary.dailyRemainingCredits !== null && summary.dailyRemainingCredits <= 0) {
		readiness = 'waiting_for_budget';
		reasons.push('daily_budget_exhausted');
	} else if ((options.approvalRequiredCount ?? 0) > 0) {
		readiness = 'needs_approval';
		reasons.push('approval_required');
	}
	return {
		...summary,
		projectId: plan.projectId,
		environment: plan.environment,
		readiness,
		reasons,
		blockedTaskCount: options.blockedTaskCount ?? summary.blockedTaskCount,
		approvalRequiredCount: options.approvalRequiredCount ?? summary.approvalRequiredCount,
	};
}

export function scoreCapacityLane(input: CapacityLaneCandidate): CapacityLaneScore {
	const reasons: string[] = [];
	let agentFit = 0;
	const profile = input.agentProfile;
	if (profile) {
		const preferred = profile.preferredLanes.find((preference) =>
			preference.laneId === input.lane.id
			|| preference.providerId === input.lane.capacityProviderId
			|| (preference.modelClass && preference.modelClass === input.lane.modelClass)
			|| (preference.provider && preference.provider === input.lane.capacityProviderId)
		);
		if (preferred) {
			agentFit += Math.max(0, preferred.weight);
			reasons.push('agent_preference');
		}
		if (profile.disallowedProviders?.includes(input.lane.capacityProviderId)) {
			agentFit -= 1000;
			reasons.push('agent_disallowed_provider');
		}
		if (input.region && profile.disallowedRegions?.includes(input.region)) {
			agentFit -= 1000;
			reasons.push('agent_disallowed_region');
		}
	}

	if (input.modelClass && input.lane.modelClass === input.modelClass) {
		agentFit += 20;
		reasons.push('model_class_match');
	}

	const fairnessScore = Math.max(0, (input.grant?.priorityWeight ?? 1) * 10);
	const scarcity = scarcityPenalty(input.lane.scarcityLevel);
	const remaining = input.remainingCredits;
	const costPenalty = remaining !== null && remaining !== undefined && remaining <= 0 ? 500 : 0;
	if (scarcity > 0) reasons.push(`scarcity:${input.lane.scarcityLevel}`);
	if (costPenalty > 0) reasons.push('capacity_exhausted');
	return {
		laneId: input.lane.id,
		capacityProviderId: input.lane.capacityProviderId,
		score: agentFit + fairnessScore - scarcity - costPenalty,
		agentFit,
		scarcityPenalty: scarcity,
		fairnessScore,
		costPenalty,
		reasons,
	};
}

export function selectBestCapacityLane(candidates: CapacityLaneCandidate[]) {
	const scored = candidates
		.map(scoreCapacityLane)
		.sort((left, right) => right.score - left.score || left.laneId.localeCompare(right.laneId));
	return {
		selected: scored[0] ?? null,
		scores: scored,
	};
}

export function reservationHasCapacity(reservation: CapacityReservation) {
	return reservation.state === 'reserved'
		&& reservation.reservedCredits > reservation.consumedCredits;
}

export function createReservationReleaseEntry(input: {
	reservation: CapacityReservation;
	credits?: number | null;
	source?: string;
	metadata?: Record<string, unknown>;
}): RecordCapacityUsageRequest {
	const credits = Math.max(0, Number(input.credits ?? (input.reservation.reservedCredits - input.reservation.consumedCredits)));
	return {
		capacityProviderId: input.reservation.capacityProviderId,
		laneId: input.reservation.laneId,
		reservationId: input.reservation.id,
		teamId: input.reservation.teamId,
		projectId: input.reservation.projectId,
		workDayId: input.reservation.workDayId,
		taskId: input.reservation.taskId,
		phase: 'reservation_released',
		credits: -credits,
		source: input.source ?? 'capacity_coordinator',
		metadata: input.metadata ?? {},
	};
}

export function settleCapacityActuals(input: CapacitySettlementInput): CapacitySettlement {
	const consumedCredits = Math.max(0, Number(input.actualCredits ?? 0));
	const releasedCredits = Math.max(0, input.reservation.reservedCredits - consumedCredits);
	const overrunCredits = Math.max(0, consumedCredits - input.reservation.reservedCredits);
	const base = {
		capacityProviderId: input.reservation.capacityProviderId,
		laneId: input.reservation.laneId,
		reservationId: input.reservation.id,
		teamId: input.teamId ?? input.reservation.teamId,
		projectId: input.projectId ?? input.reservation.projectId,
		workDayId: input.workDayId ?? input.reservation.workDayId,
		taskId: input.taskId ?? input.reservation.taskId,
		source: input.source ?? 'capacity_coordinator',
		metadata: input.metadata ?? {},
	};
	const consumeEntry: RecordCapacityUsageRequest = {
		...base,
		phase: 'task_completed_actual_settlement',
		credits: consumedCredits,
		providerUnits: input.actualProviderUnits ?? null,
		usd: input.actualUsd ?? null,
	};
	const releaseEntry = releasedCredits > 0
		? {
			...base,
			phase: 'reservation_released' as const,
			credits: -releasedCredits,
		}
		: null;
	const overrunEntry = overrunCredits > 0
		? {
			...base,
			phase: 'overrun_hold' as const,
			credits: overrunCredits,
		}
		: null;
	return {
		reservationId: input.reservation.id,
		state: overrunCredits > 0 ? 'overran_pending_approval' : 'consumed',
		consumeEntry,
		releaseEntry,
		overrunEntry,
		consumedCredits,
		releasedCredits,
		overrunCredits,
	};
}

function distinctProfiles(profiles: ExecutionProfile[]) {
	const seen = new Set<string>();
	return profiles.filter((profile) => {
		if (seen.has(profile.id)) return false;
		seen.add(profile.id);
		return true;
	});
}

function executionProfilesForRoute(input: RouteAndReserveInput) {
	const explicitProfiles = Array.isArray(input.executionProfiles) && input.executionProfiles.length > 0
		? input.executionProfiles
		: null;
	const preferred = stringArray(input.preferredExecutionProfiles);
	const disallowed = new Set(stringArray(input.disallowedExecutionProfiles));
	const rawProfiles = explicitProfiles
		?? (preferred.length > 0
			? preferred
			: input.executionProfile
				? [input.executionProfile]
				: input.estimate.executionProfileId
					? [input.estimate.executionProfileId]
					: [DEFAULT_EXECUTION_PROFILE_ID]);
	const profiles = distinctProfiles(rawProfiles.map((profile) => normalizeExecutionProfile(profile)))
		.filter((profile) => !disallowed.has(profile.id));
	return profiles.length > 0 ? profiles : [normalizeExecutionProfile(DEFAULT_EXECUTION_PROFILE_ID)];
}

function estimateForRouteProfile(input: RouteAndReserveInput, profile: ExecutionProfile): CapacityTaskEstimate {
	const selectedProfile = selectTaskEstimateProfile({
		profiles: input.estimateProfiles ?? input.plan.estimateProfiles ?? null,
		taskSignature: input.estimate.taskSignature,
		executionProfile: profile,
		executionProfileId: profile.id,
	});
	return reserveCreditsForEstimate({
		taskSignature: input.estimate.taskSignature,
		taskKind: input.taskKind ?? input.estimate.taskSignature,
		confidence: input.estimate.confidence ?? input.classification?.confidence ?? 'medium',
		estimatedCreditsP50: selectedProfile ? undefined : input.estimate.estimatedCreditsP50,
		estimatedCreditsP90: selectedProfile ? undefined : input.estimate.estimatedCreditsP90,
		defaultCredits: input.estimate.estimatedCreditsP50,
		profiles: input.estimateProfiles ?? input.plan.estimateProfiles ?? null,
		profile: selectedProfile,
		executionProfile: profile,
		executionProfileId: profile.id,
	});
}

function routeMinimumQuality(input: RouteAndReserveInput) {
	const explicit = finiteOrParsedNumber(input.minimumQualityWeight);
	if (explicit !== null) return Math.max(0, explicit);
	if (input.production || input.classification?.mutationScope === 'production') return 1.5;
	if (input.classification?.risk === 'high' || input.classification?.requiresApproval) return 1.25;
	if (input.classification?.confidence === 'low') return 1.1;
	return 0;
}

function routeRequiredContext(input: RouteAndReserveInput) {
	return Math.max(0, finiteOrParsedNumber(input.requiredContextTokens) ?? 0);
}

function reservationMetadata(reservation: CapacityReservation) {
	return readRecord(reservation.metadata);
}

function attentionValueFromMetadata(metadata: Record<string, unknown>, ...keys: string[]) {
	const estimate = readRecord(metadata.attentionEstimate);
	for (const key of keys) {
		const value = finiteOrParsedNumber(metadata[key]) ?? finiteOrParsedNumber(estimate[key]);
		if (value !== null) return value;
	}
	return null;
}

function activeLaneReservations(plan: CapacityPlan, provider: CapacityProvider, lane?: CapacityProviderLane | null) {
	return plan.activeReservations.filter((reservation) =>
		reservation.capacityProviderId === provider.id
		&& (!lane || reservation.laneId === lane.id)
		&& (reservation.state === 'reserved' || reservation.state === 'consuming')
	);
}

function attentionLimitNumber(lane: CapacityProviderLane, provider: CapacityProvider, key: string) {
	return finiteOrParsedNumber(lane.hardLimits?.[key])
		?? finiteOrParsedNumber(lane.routingPolicy?.[key])
		?? finiteOrParsedNumber(lane.metadata?.[key])
		?? finiteOrParsedNumber(readRecord(lane.metadata?.pressure)[key])
		?? finiteOrParsedNumber(provider.capacityModel?.[key])
		?? finiteOrParsedNumber(provider.metadata?.[key])
		?? finiteOrParsedNumber(readRecord(provider.metadata?.pressure)[key]);
}

function deriveAttentionWeight(classification: TaskClassification | null | undefined, profile: ExecutionProfile, contextTokens: number) {
	let weight = 1;
	const mutationScope = classification?.mutationScope ?? 'repository_read';
	if (mutationScope === 'repository_read') weight = 1.5;
	if (mutationScope === 'repository_write') weight = 3;
	if (mutationScope === 'production') weight = 6;
	if (classification?.risk === 'medium') weight += 1;
	if (classification?.risk === 'high') weight += 3;
	if (classification?.confidence === 'low') weight += 1;
	weight += Math.max(0, classification?.expectedFanout ?? 0) * 0.5;
	if (profile.concurrencyClass === 'human_attention' || profile.quotaBehavior === 'attention_bound') weight += 5;
	if (profile.concurrencyClass === 'exclusive_project') weight += 3;
	if (contextTokens >= 100_000) weight += 4;
	else if (contextTokens >= 32_000) weight += 2;
	return Math.max(0, weight);
}

export function estimateAttentionForTask(input: {
	classification?: TaskClassification | null;
	executionProfile?: ExecutionProfile | string | null;
	attentionPolicy?: Partial<AttentionPolicy | TaskAdmissionPolicy> | null;
	attentionWeight?: number | null;
	coordinationWeight?: number | null;
	estimatedContextTokens?: number | null;
	requiredContextTokens?: number | null;
	source?: string | null;
	metadata?: Record<string, unknown>;
}): AttentionEstimate {
	const profile = normalizeExecutionProfile(input.executionProfile);
	const policy = normalizeAttentionPolicy(input.attentionPolicy);
	const requiredContextTokens = Math.max(0, finiteOrParsedNumber(input.requiredContextTokens) ?? 0);
	const estimatedContextTokens = Math.max(requiredContextTokens, finiteOrParsedNumber(input.estimatedContextTokens) ?? requiredContextTokens);
	const baseAttention = finiteOrParsedNumber(input.attentionWeight)
		?? deriveAttentionWeight(input.classification, profile, estimatedContextTokens);
	const coordinationWeight = finiteOrParsedNumber(input.coordinationWeight)
		?? (Math.max(0, input.classification?.expectedFanout ?? 0) * policy.coordinationOverheadFactor);
	return {
		attentionWeight: Math.max(0, Math.ceil(baseAttention * 100) / 100),
		coordinationWeight: Math.max(0, Math.ceil(coordinationWeight * 100) / 100),
		totalAttentionWeight: Math.max(0, Math.ceil((baseAttention + coordinationWeight) * 100) / 100),
		estimatedContextTokens,
		requiredContextTokens,
		source: input.source ?? 'capacity_attention_estimator',
		metadata: input.metadata ?? {},
	};
}

function attentionEstimateForRoute(input: RouteAndReserveInput, profile: ExecutionProfile) {
	if (input.attentionEstimate) return input.attentionEstimate;
	return estimateAttentionForTask({
		classification: input.classification,
		executionProfile: profile,
		attentionPolicy: input.attentionPolicy,
		attentionWeight: input.attentionWeight,
		coordinationWeight: input.coordinationWeight,
		estimatedContextTokens: input.estimatedContextTokens,
		requiredContextTokens: input.requiredContextTokens,
		source: input.source ?? 'capacity_router',
	});
}

function readPressureNumber(provider: CapacityProvider, lane: CapacityProviderLane, key: string) {
	const laneValue = finiteOrParsedNumber(lane.metadata?.[key]);
	if (laneValue !== null) return laneValue;
	const providerValue = finiteOrParsedNumber(provider.metadata?.[key]);
	if (providerValue !== null) return providerValue;
	const lanePressure = readRecord(lane.metadata?.pressure);
	const providerPressure = readRecord(provider.metadata?.pressure);
	return finiteOrParsedNumber(lanePressure[key]) ?? finiteOrParsedNumber(providerPressure[key]);
}

function readPressureBoolean(provider: CapacityProvider, lane: CapacityProviderLane, key: string) {
	const values = [
		lane.metadata?.[key],
		provider.metadata?.[key],
		readRecord(lane.metadata?.pressure)[key],
		readRecord(provider.metadata?.pressure)[key],
	];
	return values.some((value) => value === true || value === 'true');
}

function hardLimitNumber(lane: CapacityProviderLane, provider: CapacityProvider, ...keys: string[]) {
	for (const key of keys) {
		const value = finiteOrParsedNumber(lane.hardLimits?.[key])
			?? finiteOrParsedNumber(lane.routingPolicy?.[key])
			?? finiteOrParsedNumber(provider.capacityModel?.[key])
			?? finiteOrParsedNumber(provider.metadata?.[key]);
		if (value !== null && value >= 0) return value;
	}
	return null;
}

export function capacityRoutePressure(plan: CapacityPlan, provider: CapacityProvider, lane: CapacityProviderLane): CapacityRoutePressure {
	const reservations = activeLaneReservations(plan, provider, lane);
	const activeReservations = reservations.length;
	const maxActiveReservations = hardLimitNumber(
		lane,
		provider,
		'maxActiveReservations',
		'maxConcurrentTasks',
		'maxConcurrentWorkers',
	) ?? (provider.maxConcurrentWorkers > 0 ? provider.maxConcurrentWorkers : null);
	const congestionRatio = maxActiveReservations && maxActiveReservations > 0
		? activeReservations / maxActiveReservations
		: 0;
	const activeAttentionLoad = reservations.reduce((total, reservation) => {
		const metadata = reservationMetadata(reservation);
		return total + Math.max(0, attentionValueFromMetadata(metadata, 'totalAttentionWeight', 'attentionWeight') ?? 0);
	}, 0);
	const maxAttentionLoad = attentionLimitNumber(lane, provider, 'maxAttentionLoad');
	const activeContextTokens = reservations.reduce((total, reservation) => {
		const metadata = reservationMetadata(reservation);
		return total + Math.max(0, attentionValueFromMetadata(metadata, 'estimatedContextTokens', 'contextTokens', 'requiredContextTokens') ?? 0);
	}, 0);
	const maxContextTokens = attentionLimitNumber(lane, provider, 'maxContextTokens');
	return {
		activeReservations,
		maxActiveReservations,
		congestionRatio,
		quotaRemainingPercent: readPressureNumber(provider, lane, 'quotaRemainingPercent'),
		sessionRemainingMinutes: readPressureNumber(provider, lane, 'sessionRemainingMinutes'),
		subscriptionSaturationPercent: readPressureNumber(provider, lane, 'subscriptionSaturationPercent'),
		providerUnavailable: readPressureBoolean(provider, lane, 'providerUnavailable'),
		activeAttentionLoad,
		maxAttentionLoad,
		attentionSaturationPercent: maxAttentionLoad && maxAttentionLoad > 0 ? (activeAttentionLoad / maxAttentionLoad) * 100 : null,
		activeContextTokens,
		maxContextTokens,
		contextSaturationPercent: maxContextTokens && maxContextTokens > 0 ? (activeContextTokens / maxContextTokens) * 100 : null,
	};
}

function latencyPenalty(profile: ExecutionProfile) {
	if (profile.latencyClass === 'high') return 12;
	if (profile.latencyClass === 'medium') return 5;
	return 0;
}

function quotaPressurePenalty(pressure: CapacityRoutePressure) {
	let penalty = 0;
	if (pressure.quotaRemainingPercent !== null) {
		penalty += Math.max(0, 100 - pressure.quotaRemainingPercent) * 0.25;
	}
	if (pressure.subscriptionSaturationPercent !== null) {
		penalty += Math.max(0, pressure.subscriptionSaturationPercent) * 0.35;
	}
	if (pressure.sessionRemainingMinutes !== null && pressure.sessionRemainingMinutes < 20) {
		penalty += (20 - pressure.sessionRemainingMinutes) * 1.5;
	}
	return penalty;
}

function attentionPressurePenalty(pressure: CapacityRoutePressure, estimate: AttentionEstimate, policy: AttentionPolicy) {
	if (!pressure.maxAttentionLoad || pressure.maxAttentionLoad <= 0) return 0;
	const allocatableLoad = Math.max(0, pressure.maxAttentionLoad * (1 - (policy.reserveAttentionPercent / 100)));
	const projected = pressure.activeAttentionLoad + estimate.totalAttentionWeight;
	const saturation = allocatableLoad > 0 ? projected / allocatableLoad : 1;
	return Math.max(0, saturation) * 35;
}

function contextPressurePenalty(pressure: CapacityRoutePressure, estimate: AttentionEstimate, policy: AttentionPolicy) {
	const maxContextTokens = pressure.maxContextTokens ?? policy.maxContextTokens;
	if (!maxContextTokens || maxContextTokens <= 0) return 0;
	const projected = pressure.activeContextTokens + estimate.estimatedContextTokens;
	const saturationPercent = (projected / maxContextTokens) * 100;
	return Math.max(0, saturationPercent - 50) * 0.6;
}

function laneSupportsExecutionProfile(lane: CapacityProviderLane, profile: ExecutionProfile) {
	const allowedProfiles = stringArray(lane.routingPolicy?.executionProfiles);
	if (allowedProfiles.length > 0 && !allowedProfiles.includes(profile.id)) return false;
	const allowedModelClasses = stringArray(lane.routingPolicy?.modelClasses);
	if (allowedModelClasses.length > 0 && profile.modelClass && !allowedModelClasses.includes(profile.modelClass)) return false;
	return true;
}

function routeTrustScore(provider: CapacityProvider, lane: CapacityProviderLane, profile: ExecutionProfile) {
	const laneMetadata = readRecord(lane.metadata);
	const providerMetadata = readRecord(provider.metadata);
	const profileMetadata = readRecord(profile.metadata);
	const trust = finiteOrParsedNumber(laneMetadata.trustScore)
		?? finiteOrParsedNumber(providerMetadata.trustScore)
		?? finiteOrParsedNumber(profileMetadata.trustScore)
		?? 1;
	const availability = finiteOrParsedNumber(laneMetadata.availabilityScore)
		?? finiteOrParsedNumber(providerMetadata.availabilityScore)
		?? 1;
	return Math.max(0, Math.min(1, trust)) * Math.max(0, Math.min(1, availability));
}

function routeSuccessProbability(input: {
	provider: CapacityProvider;
	lane: CapacityProviderLane;
	profile: ExecutionProfile;
	explicit?: number | null;
	utilityEstimate: UtilityEstimate;
}) {
	const laneMetadata = readRecord(input.lane.metadata);
	const providerMetadata = readRecord(input.provider.metadata);
	const profileMetadata = readRecord(input.profile.metadata);
	const success = finiteOrParsedNumber(input.explicit)
		?? finiteOrParsedNumber(laneMetadata.successProbability)
		?? finiteOrParsedNumber(providerMetadata.successProbability)
		?? finiteOrParsedNumber(profileMetadata.successProbability)
		?? input.utilityEstimate.successProbability
		?? 1;
	return Math.max(0, Math.min(1, success));
}

function routePriceMultiplier(provider: CapacityProvider, lane: CapacityProviderLane, profile: ExecutionProfile) {
	const laneMetadata = readRecord(lane.metadata);
	const providerMetadata = readRecord(provider.metadata);
	const profileMetadata = readRecord(profile.metadata);
	return Math.max(0.1, finiteOrParsedNumber(laneMetadata.priceMultiplier)
		?? finiteOrParsedNumber(providerMetadata.priceMultiplier)
		?? finiteOrParsedNumber(profileMetadata.priceMultiplier)
		?? 1);
}

function routeScore(input: {
	provider: CapacityProvider;
	lane: CapacityProviderLane;
	grant: CapacityGrant;
	estimate: CapacityTaskEstimate;
	profile: ExecutionProfile;
	remainingCredits: number | null;
	pressure: CapacityRoutePressure;
	minimumQualityWeight: number;
	attentionEstimate: AttentionEstimate;
	attentionPolicy: AttentionPolicy;
	utilityEstimate: UtilityEstimate;
	reservePrediction: ReservePrediction | null;
	trustScore: number;
	successProbability: number;
	cooperativeRouting: boolean;
	baseScore: CapacityLaneScore;
}) {
	const reasons = [...input.baseScore.reasons];
	const qualityFit = input.minimumQualityWeight > 0
		? input.profile.qualityWeight / input.minimumQualityWeight
		: input.profile.qualityWeight;
	const qualityBonus = Math.min(50, Math.max(0, input.profile.qualityWeight * 20));
	const costPenalty = Math.max(0, input.estimate.reservedCredits);
	const latency = latencyPenalty(input.profile);
	const congestion = input.pressure.congestionRatio * 45;
	const quota = quotaPressurePenalty(input.pressure);
	const attention = attentionPressurePenalty(input.pressure, input.attentionEstimate, input.attentionPolicy);
	const context = contextPressurePenalty(input.pressure, input.attentionEstimate, input.attentionPolicy);
	const priceMultiplier = routePriceMultiplier(input.provider, input.lane, input.profile);
	const utilityBonus = input.utilityEstimate.utilityScore > 0
		? Math.min(100, input.utilityEstimate.utilityPerCredit * 18 * Math.max(0.1, input.trustScore) * Math.max(0.1, input.successProbability))
		: 0;
	const cooperativeBonus = input.cooperativeRouting
		? ((input.trustScore * 20) + (input.successProbability * 15))
		: 0;
	const predictedReserveImpact = input.reservePrediction?.reserveCredits ?? 0;
	const laneModelFit = input.profile.modelClass && input.lane.modelClass === input.profile.modelClass ? 15 : 0;
	const riskBonus = input.minimumQualityWeight >= 1.25 && input.profile.qualityWeight >= input.minimumQualityWeight ? 10 : 0;
	const score = input.baseScore.score
		+ qualityBonus
		+ laneModelFit
		+ riskBonus
		+ utilityBonus
		+ cooperativeBonus
		- costPenalty
		- latency
		- congestion
		- quota
		- attention
		- context
		- Math.max(0, priceMultiplier - 1) * 8
		- (input.reservePrediction && input.reservePrediction.reservePercent > 0 ? Math.min(20, predictedReserveImpact * 0.25) : 0);
	if (laneModelFit > 0) reasons.push('execution_profile_model_class_match');
	if (congestion > 0) reasons.push('lane_congestion_pressure');
	if (quota > 0) reasons.push('quota_pressure');
	if (attention > 0) reasons.push('attention_pressure');
	if (context > 0) reasons.push('context_pressure');
	if (utilityBonus > 0) reasons.push('utility_scored');
	if (cooperativeBonus > 0) reasons.push('cooperative_route_scored');
	if (predictedReserveImpact > 0) reasons.push('predictive_reserve_applied');
	return {
		...input.baseScore,
		score,
		qualityFit,
		latencyPenalty: latency,
		quotaPressure: quota,
		congestionPenalty: congestion,
		attentionPenalty: attention,
		contextPenalty: context,
		utilityScore: input.utilityEstimate.utilityScore,
		utilityPerCredit: input.utilityEstimate.utilityPerCredit,
		predictedReserveImpact,
		trustScore: input.trustScore,
		successProbability: input.successProbability,
		costPenalty,
		executionProfileId: input.profile.id,
		reservedCredits: input.estimate.reservedCredits,
		attentionEstimate: input.attentionEstimate,
		reasons: [...new Set(reasons)],
	};
}

function routeCandidateKey(candidate: RouteAndReserveCandidate) {
	return `${candidate.providerId}:${candidate.laneId}:${candidate.grantId}:${candidate.executionProfileId ?? DEFAULT_EXECUTION_PROFILE_ID}`;
}

export function routeAndReserveCapacity(input: RouteAndReserveInput): RouteAndReserveResult {
	const providers = input.plan.providers.filter((provider) => providerIsEligible(provider, input));
	const grants = input.plan.grants.filter((grant) => grantIsEligible(grant, input));
	const candidates: RouteAndReserveCandidate[] = [];
	const executionProfiles = executionProfilesForRoute(input);
	const minimumQualityWeight = routeMinimumQuality(input);
	const requiredContextTokens = routeRequiredContext(input);
	const attentionPolicy = normalizeAttentionPolicy(input.attentionPolicy);
	const utilityPolicy = normalizeUtilityPolicy(input.utilityPolicy);
	const predictiveReservePolicy = normalizePredictiveReservePolicy(input.predictiveReservePolicy);
	const hybridExecutionPlan = normalizeHybridExecutionPlan(input.hybridExecutionPlan ?? readRecord(input.metadata).hybridExecutionPlan);
	const preferredProfiles = new Set(stringArray(input.preferredExecutionProfiles));
	const disallowedProfiles = new Set(stringArray(input.disallowedExecutionProfiles));
	const cooperativeRouting = input.cooperativeRouting === true || readRecord(input.metadata).cooperativeRouting === true;
	const trustRequirement = finiteOrParsedNumber(input.trustRequirement);

	for (const grant of grants) {
		const provider = providers.find((candidate) => candidate.id === grant.capacityProviderId);
		if (!provider) continue;
		const lanes = input.plan.lanes.filter((lane) =>
			lane.capacityProviderId === provider.id
			&& (!grant.laneId || grant.laneId === lane.id)
		);
		for (const lane of lanes) {
			const remainingCredits = grantRemainingCredits(input.plan, grant);
			const pressure = capacityRoutePressure(input.plan, provider, lane);
			for (const profile of executionProfiles) {
				const estimate = estimateForRouteProfile(input, profile);
				const attentionEstimate = attentionEstimateForRoute(input, profile);
				const utilityEstimate = input.utilityEstimate ?? estimateUtilityForTask({
					classification: input.classification,
					executionProfile: profile,
					estimate,
					utilityPolicy,
					utilityValue: input.utilityValue,
					maintenanceValue: input.maintenanceValue,
					priority: finiteOrParsedNumber(readRecord(input.metadata).priority),
					deadlineAt: input.deadlineAt ?? (typeof readRecord(input.metadata).deadlineAt === 'string' ? readRecord(input.metadata).deadlineAt as string : null),
					successProbability: input.successProbability,
					metadata: input.metadata,
					source: input.source ?? 'capacity_router',
				});
				const reservePrediction = predictReserveForCapacityPlan({
					plan: input.plan,
					policy: predictiveReservePolicy,
					remainingCredits,
					metadata: input.metadata,
				});
				const trustScore = routeTrustScore(provider, lane, profile);
				const successProbability = routeSuccessProbability({
					provider,
					lane,
					profile,
					explicit: input.successProbability,
					utilityEstimate,
				});
				const estimateInput = { ...input, estimate };
				const reasons = lanePolicyReasons(lane, estimateInput);
				let spilloverReason: string | null = null;
				if (trustRequirement !== null && trustScore < trustRequirement) reasons.push('trust_below_requirement');
				if (utilityPolicy.minimumUtilityScore !== null && utilityEstimate.utilityScore < utilityPolicy.minimumUtilityScore) reasons.push('utility_below_minimum');
				if (utilityPolicy.minimumUtilityPerCredit !== null && utilityEstimate.utilityPerCredit < utilityPolicy.minimumUtilityPerCredit) reasons.push('utility_per_credit_below_minimum');
				if (
					predictiveReservePolicy.enabled
					&& reservePrediction.reserveCredits > 0
					&& reservePrediction.activelyAllocatableCredits < estimate.reservedCredits
					&& utilityEstimate.utilityScore < 50
				) {
					reasons.push('predictive_reserve_blocked');
				}
				const routeMaxAttentionLoad = attentionPolicy.maxAttentionLoad ?? pressure.maxAttentionLoad;
				if (routeMaxAttentionLoad !== null && routeMaxAttentionLoad > 0) {
					const allocatableAttention = Math.max(0, routeMaxAttentionLoad * (1 - (attentionPolicy.reserveAttentionPercent / 100)));
					const projectedAttention = pressure.activeAttentionLoad + attentionEstimate.totalAttentionWeight;
					if (projectedAttention > allocatableAttention) reasons.push('attention_load_exceeded');
					const availableAttention = Math.max(0, allocatableAttention - pressure.activeAttentionLoad);
					const minimumAttentionAvailable = finiteOrParsedNumber(input.minimumAttentionAvailable);
					if (minimumAttentionAvailable !== null && availableAttention < minimumAttentionAvailable) reasons.push('minimum_attention_unavailable');
				}
				const routeMaxContextTokens = attentionPolicy.maxContextTokens ?? pressure.maxContextTokens;
				if (routeMaxContextTokens !== null && routeMaxContextTokens > 0) {
					const projectedContextTokens = pressure.activeContextTokens + attentionEstimate.estimatedContextTokens;
					const projectedSaturation = (projectedContextTokens / routeMaxContextTokens) * 100;
					if (projectedContextTokens > routeMaxContextTokens || projectedSaturation > attentionPolicy.maxContextSaturationPercent) {
						reasons.push('context_saturation_exceeded');
					}
				}
				if (disallowedProfiles.has(profile.id)) reasons.push('execution_profile_disallowed');
				if (preferredProfiles.size > 0 && !preferredProfiles.has(profile.id)) reasons.push('execution_profile_not_preferred');
				if (!laneSupportsExecutionProfile(lane, profile)) reasons.push('execution_profile_not_supported');
				if (minimumQualityWeight > 0 && profile.qualityWeight < minimumQualityWeight) reasons.push('quality_below_minimum');
				if (
					requiredContextTokens > 0
					&& profile.contextWindowTokens !== null
					&& profile.contextWindowTokens !== undefined
					&& profile.contextWindowTokens < requiredContextTokens
				) {
					reasons.push('context_window_too_small');
				}
				if (pressure.providerUnavailable) reasons.push('provider_unavailable');
				if (pressure.maxActiveReservations !== null && pressure.congestionRatio >= 1) reasons.push('lane_congested');
				if (pressure.quotaRemainingPercent !== null && pressure.quotaRemainingPercent <= 0) reasons.push('quota_exhausted');
				if (pressure.sessionRemainingMinutes !== null && pressure.sessionRemainingMinutes <= 0) reasons.push('session_exhausted');
				if (remainingCredits !== null && remainingCredits < estimate.reservedCredits) {
					if (grant.overflowPolicy === 'approval_required') {
						reasons.push('approval_required');
					} else if (grant.overflowPolicy === 'fallback_lane') {
						spilloverReason = 'fallback_lane';
						reasons.push('fallback_lane_exhausted');
					} else if (grant.overflowPolicy === 'deny' || grant.overflowPolicy === 'hard_grant') {
						reasons.push('insufficient_budget');
					} else {
						reasons.push('soft_budget_pressure');
					}
				}
				const baseScore = scoreCapacityLane({
					lane,
					grant,
					remainingCredits,
					taskKind: input.taskKind ?? estimate.taskSignature,
					requiredCapabilities: input.requiredCapabilities,
					modelClass: input.modelClass ?? profile.modelClass ?? null,
				});
				const score = routeScore({
					provider,
					lane,
					grant,
					estimate,
					profile,
					remainingCredits,
					pressure,
					minimumQualityWeight,
					attentionEstimate,
					attentionPolicy,
					utilityEstimate,
					reservePrediction,
					trustScore,
					successProbability,
					cooperativeRouting,
					baseScore,
				});
				candidates.push({
					providerId: provider.id,
					laneId: lane.id,
					grantId: grant.id,
					executionProfileId: profile.id,
					remainingCredits,
					score,
					eligible: reasons.filter((reason) =>
						reason !== 'soft_budget_pressure'
						&& reason !== 'execution_profile_not_preferred'
					).length === 0,
					reasons: [...new Set([...reasons, ...score.reasons])],
					estimate,
					pressure,
					qualityFit: score.qualityFit,
					attentionEstimate,
					utilityEstimate,
					reservePrediction,
					trustScore,
					successProbability,
					spilloverReason,
				});
			}
		}
	}

	if (input.plan.providers.length === 0 || providers.length === 0) {
		return {
			ok: false,
			code: 'no_capacity_provider',
			reason: 'No active helper capacity provider is available.',
			estimate: input.estimate,
			candidates,
		};
	}
	if (grants.length === 0) {
		return {
			ok: false,
			code: 'no_capacity_grant',
			reason: 'No active capacity grant is available for this team, project, and environment.',
			estimate: input.estimate,
			candidates,
		};
	}

	const eligible = candidates
		.filter((candidate) => candidate.eligible)
		.sort((left, right) =>
			right.score.score - left.score.score
			|| (left.estimate?.reservedCredits ?? Number.MAX_SAFE_INTEGER) - (right.estimate?.reservedCredits ?? Number.MAX_SAFE_INTEGER)
			|| routeCandidateKey(left).localeCompare(routeCandidateKey(right))
		);
	const selected = eligible[0] ?? null;
	if (!selected) {
		const hasApprovalBlock = candidates.some((candidate) => candidate.reasons.includes('approval_required'));
		const hasBudgetBlock = candidates.some((candidate) => candidate.reasons.includes('insufficient_budget'));
		return {
			ok: false,
			code: hasApprovalBlock ? 'approval_required' : hasBudgetBlock ? 'insufficient_budget' : 'no_eligible_lane',
			reason: hasApprovalBlock
				? 'The requested helper task needs approval before capacity can be reserved.'
				: hasBudgetBlock
					? 'The requested helper task is above the remaining approved budget.'
					: 'No provider lane matches the task policy and capability requirements.',
			estimate: input.estimate,
			candidates,
		};
	}

	const provider = providers.find((candidate) => candidate.id === selected.providerId);
	const lane = input.plan.lanes.find((candidate) => candidate.id === selected.laneId);
	const grant = grants.find((candidate) => candidate.id === selected.grantId);
	const selectedEstimate = selected.estimate ?? input.estimate;
	if (!provider || !lane || !grant) {
		return {
			ok: false,
			code: 'no_eligible_lane',
			reason: 'The selected capacity lane could not be resolved.',
			estimate: input.estimate,
			candidates,
		};
	}

	const candidatePayload = candidates.map((candidate) => ({
		providerId: candidate.providerId,
		laneId: candidate.laneId,
		grantId: candidate.grantId,
		executionProfileId: candidate.executionProfileId ?? null,
		remainingCredits: candidate.remainingCredits,
		eligible: candidate.eligible,
		reasons: candidate.reasons,
		score: candidate.score.score,
		reservedCredits: candidate.estimate?.reservedCredits ?? null,
		qualityFit: candidate.qualityFit ?? null,
		attentionEstimate: candidate.attentionEstimate ?? null,
		utilityEstimate: candidate.utilityEstimate ?? null,
		reservePrediction: candidate.reservePrediction ?? null,
		trustScore: candidate.trustScore ?? null,
		successProbability: candidate.successProbability ?? null,
		pressure: candidate.pressure ?? null,
		spilloverReason: candidate.spilloverReason ?? null,
	}));
	const scorePayload = Object.fromEntries(candidates.map((candidate) => [routeCandidateKey(candidate), candidate.score]));
	const reservation: CreateCapacityReservationRequest = {
		capacityProviderId: provider.id,
		laneId: lane.id,
		teamId: input.plan.teamId,
		projectId: input.plan.projectId,
		workDayId: input.workDayId ?? null,
		taskId: input.taskId ?? null,
		state: 'reserved',
		reservedCredits: selectedEstimate.reservedCredits,
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			taskSignature: selectedEstimate.taskSignature,
			estimatedCreditsP50: selectedEstimate.estimatedCreditsP50,
			estimatedCreditsP90: selectedEstimate.estimatedCreditsP90,
			routingScore: selected.score.score,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
			routingCandidates: candidatePayload,
		},
	};
	const routingDecision: CreateCapacityRoutingDecisionRequest = {
		taskId: input.taskId ?? null,
		workDayId: input.workDayId ?? null,
		projectId: input.plan.projectId,
		selectedProviderId: provider.id,
		selectedLaneId: lane.id,
		selectedModel: input.selectedModel ?? selected.executionProfileId ?? null,
		decision: 'selected',
		reason: selected.score.reasons.length > 0 ? selected.score.reasons.join(',') : 'best_eligible_lane',
		candidates: candidatePayload,
		scores: scorePayload,
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			remainingCreditsBefore: selected.remainingCredits,
			reservedCredits: selectedEstimate.reservedCredits,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
			escalationPath: candidatePayload
				.filter((candidate) => candidate.eligible)
				.sort((left, right) => Number(left.reservedCredits ?? 0) - Number(right.reservedCredits ?? 0))
				.map((candidate) => candidate.executionProfileId)
				.filter((value, index, array) => typeof value === 'string' && value && array.indexOf(value) === index),
		},
	};
	const ledgerEntry: RecordCapacityUsageRequest = {
		capacityProviderId: provider.id,
		laneId: lane.id,
		teamId: input.plan.teamId,
		projectId: input.plan.projectId,
		workDayId: input.workDayId ?? null,
		taskId: input.taskId ?? null,
		phase: 'reservation_created',
		credits: selectedEstimate.reservedCredits,
		source: input.source ?? 'capacity_coordinator',
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			taskSignature: selectedEstimate.taskSignature,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
		},
	};

	return {
		ok: true,
		provider,
		lane,
		grant,
		estimate: selectedEstimate,
		remainingCreditsBefore: selected.remainingCredits,
		reservation,
		routingDecision,
		ledgerEntry,
		capacityMetadata: {
			providerId: provider.id,
			laneId: lane.id,
			grantId: grant.id,
			reservationId: reservation.id ?? null,
			routingDecisionId: routingDecision.id ?? null,
			estimatedCreditsP50: selectedEstimate.estimatedCreditsP50,
			estimatedCreditsP90: selectedEstimate.estimatedCreditsP90,
			reservedCredits: selectedEstimate.reservedCredits,
			executionProfileId: selected.executionProfileId ?? selectedEstimate.executionProfileId ?? null,
			costMultiplier: selectedEstimate.costMultiplier ?? null,
			score: selected.score.score,
			attentionEstimate: selected.attentionEstimate ?? null,
			utilityEstimate: selected.utilityEstimate ?? null,
			reservePrediction: selected.reservePrediction ?? null,
			hybridExecutionPlan,
			candidates: candidatePayload,
		},
		candidates,
	};
}
