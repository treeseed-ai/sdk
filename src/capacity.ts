import type {
	CapacityEstimateConfidence,
	CapacityGrant,
	CapacityPlan,
	CapacityProviderLane,
	CapacityReservation,
	CapacityScarcityLevel,
	TaskEstimateProfile,
} from './sdk-types.ts';
import type { AgentProviderProfile } from './types/agents.ts';

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

function finiteNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function scarcityPenalty(level: CapacityScarcityLevel) {
	if (level === 'high') return 35;
	if (level === 'medium') return 15;
	return 0;
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
		.filter((reservation) => reservation.state === 'reserved')
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
