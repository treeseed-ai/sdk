import type {
	CapacityEstimateConfidence,
	CapacityGrant,
	CapacityPlan,
	CapacityProvider,
	CapacityProviderLane,
	CapacityReservation,
	CapacityScarcityLevel,
	CreateCapacityReservationRequest,
	CreateCapacityRoutingDecisionRequest,
	RecordCapacityUsageRequest,
	TaskEstimateProfile,
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
	defaultCredits?: number | null;
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
	reasons: string[];
}

export interface CapacityTaskEstimate {
	taskSignature: string;
	confidence: CapacityEstimateConfidence;
	estimatedCreditsP50: number;
	estimatedCreditsP90: number;
	reservedCredits: number;
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
	remainingCredits: number | null;
	score: CapacityLaneScore;
	eligible: boolean;
	reasons: string[];
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

function finiteNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
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
	const profileP50 = finiteNumber(input.profile?.creditsP50);
	const profileP90 = finiteNumber(input.profile?.creditsP90);
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
	const confidence = input.confidence ?? 'medium';
	const reserved = confidence === 'high'
		? Math.max(p50, Math.ceil((p50 + p90) * 0.75))
		: p90;
	return {
		taskSignature: input.taskSignature ?? input.taskKind ?? 'unknown',
		confidence,
		estimatedCreditsP50: p50,
		estimatedCreditsP90: p90,
		reservedCredits: reserved,
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

export function routeAndReserveCapacity(input: RouteAndReserveInput): RouteAndReserveResult {
	const providers = input.plan.providers.filter((provider) => providerIsEligible(provider, input));
	const grants = input.plan.grants.filter((grant) => grantIsEligible(grant, input));
	const candidates: RouteAndReserveCandidate[] = [];

	for (const grant of grants) {
		const provider = providers.find((candidate) => candidate.id === grant.capacityProviderId);
		if (!provider) continue;
		const lanes = input.plan.lanes.filter((lane) =>
			lane.capacityProviderId === provider.id
			&& (!grant.laneId || grant.laneId === lane.id)
		);
		for (const lane of lanes) {
			const reasons = lanePolicyReasons(lane, input);
			const remainingCredits = grantRemainingCredits(input.plan, grant);
			if (
				remainingCredits !== null
				&& remainingCredits < input.estimate.reservedCredits
				&& (grant.overflowPolicy === 'deny' || grant.overflowPolicy === 'hard_grant')
			) {
				reasons.push('insufficient_budget');
			}
			if (
				remainingCredits !== null
				&& remainingCredits < input.estimate.reservedCredits
				&& grant.overflowPolicy === 'approval_required'
			) {
				reasons.push('approval_required');
			}
			const score = scoreCapacityLane({
				lane,
				grant,
				remainingCredits,
				taskKind: input.taskKind ?? input.estimate.taskSignature,
				requiredCapabilities: input.requiredCapabilities,
				modelClass: input.modelClass ?? null,
			});
			candidates.push({
				providerId: provider.id,
				laneId: lane.id,
				grantId: grant.id,
				remainingCredits,
				score,
				eligible: reasons.length === 0,
				reasons,
			});
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
		.sort((left, right) => right.score.score - left.score.score || left.laneId.localeCompare(right.laneId));
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
		remainingCredits: candidate.remainingCredits,
		eligible: candidate.eligible,
		reasons: candidate.reasons,
		score: candidate.score.score,
	}));
	const scorePayload = Object.fromEntries(candidates.map((candidate) => [candidate.laneId, candidate.score]));
	const reservation: CreateCapacityReservationRequest = {
		capacityProviderId: provider.id,
		laneId: lane.id,
		teamId: input.plan.teamId,
		projectId: input.plan.projectId,
		workDayId: input.workDayId ?? null,
		taskId: input.taskId ?? null,
		state: 'reserved',
		reservedCredits: input.estimate.reservedCredits,
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			taskSignature: input.estimate.taskSignature,
			estimatedCreditsP50: input.estimate.estimatedCreditsP50,
			estimatedCreditsP90: input.estimate.estimatedCreditsP90,
		},
	};
	const routingDecision: CreateCapacityRoutingDecisionRequest = {
		taskId: input.taskId ?? null,
		workDayId: input.workDayId ?? null,
		projectId: input.plan.projectId,
		selectedProviderId: provider.id,
		selectedLaneId: lane.id,
		selectedModel: input.selectedModel ?? null,
		decision: 'selected',
		reason: selected.score.reasons.length > 0 ? selected.score.reasons.join(',') : 'best_eligible_lane',
		candidates: candidatePayload,
		scores: scorePayload,
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			remainingCreditsBefore: selected.remainingCredits,
			reservedCredits: input.estimate.reservedCredits,
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
		credits: input.estimate.reservedCredits,
		source: input.source ?? 'capacity_coordinator',
		metadata: {
			...(input.metadata ?? {}),
			grantId: grant.id,
			taskSignature: input.estimate.taskSignature,
		},
	};

	return {
		ok: true,
		provider,
		lane,
		grant,
		estimate: input.estimate,
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
			estimatedCreditsP50: input.estimate.estimatedCreditsP50,
			estimatedCreditsP90: input.estimate.estimatedCreditsP90,
			reservedCredits: input.estimate.reservedCredits,
		},
		candidates,
	};
}
