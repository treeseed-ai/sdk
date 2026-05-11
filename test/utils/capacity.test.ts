import { describe, expect, it } from 'vitest';
import {
	reserveCreditsForEstimate,
	routeAndReserveCapacity,
	scoreCapacityLane,
	summarizeCapacityPlan,
} from '../../src/capacity.ts';
import type { CapacityPlan } from '../../src/sdk-types.ts';

const timestamp = '2026-05-07T00:00:00.000Z';

function createCapacityPlan(overrides: Partial<CapacityPlan> = {}): CapacityPlan {
	return {
		projectId: 'project-1',
		teamId: 'team-1',
		environment: 'staging',
		providers: [{
			id: 'provider-1',
			teamId: 'team-1',
			ownerTeamId: 'team-1',
			name: 'TreeSeed-managed helpers',
			kind: 'treeseed_managed',
			status: 'active',
			provider: 'railway',
			billingScope: 'team',
			monthlyCreditBudget: 1000,
			dailyCreditBudget: 50,
			maxConcurrentWorkdays: 1,
			maxConcurrentWorkers: 2,
			capacityModel: {},
			metadata: {},
			createdAt: timestamp,
			updatedAt: timestamp,
		}],
		lanes: [{
			id: 'lane-1',
			capacityProviderId: 'provider-1',
			name: 'Proposal drafting',
			businessModel: 'subscription_quota',
			modelFamily: 'gpt',
			modelClass: 'drafting',
			regionPolicy: 'us',
			unit: 'treeseed_credit',
			scarcityLevel: 'low',
			hardLimits: {},
			routingPolicy: {
				taskKinds: ['proposal.draft'],
				requiredCapabilities: ['agent_execution'],
				allowedEnvironments: ['staging'],
				maxCreditsPerTask: 20,
				repositoryMutationAllowed: false,
			},
			metadata: {},
			createdAt: timestamp,
			updatedAt: timestamp,
		}],
		grants: [{
			id: 'grant-1',
			capacityProviderId: 'provider-1',
			laneId: null,
			grantScope: 'project',
			teamId: 'team-1',
			projectId: 'project-1',
			environment: 'staging',
			state: 'active',
			dailyCreditLimit: 20,
			weeklyCreditLimit: null,
			monthlyCreditLimit: null,
			dailyUsdLimit: null,
			weeklyQuotaMinutes: null,
			monthlyProviderUnits: null,
			priorityWeight: 1,
			overflowPolicy: 'deny',
			metadata: {},
			createdAt: timestamp,
			updatedAt: timestamp,
		}],
		activeReservations: [],
		estimateProfiles: [],
		remaining: {
			dailyCredits: 20,
			weeklyCredits: null,
			monthlyCredits: null,
			weeklyQuotaMinutes: null,
			dailyUsd: null,
		},
		...overrides,
	};
}

describe('capacity helpers', () => {
	it('reserves p90 credits for low confidence estimates', () => {
		expect(reserveCreditsForEstimate({
			taskKind: 'code_change',
			confidence: 'low',
			estimatedCreditsP50: 40,
			estimatedCreditsP90: 120,
		})).toMatchObject({
			estimatedCreditsP50: 40,
			estimatedCreditsP90: 120,
			reservedCredits: 120,
		});
	});

	it('scores agent-preferred lanes above scarce non-preferred lanes', () => {
		const score = scoreCapacityLane({
			lane: {
				id: 'lane-1',
				capacityProviderId: 'provider-1',
				name: 'Codex',
				businessModel: 'subscription_quota',
				modelFamily: 'gpt',
				modelClass: 'coding',
				regionPolicy: 'us',
				unit: 'quota_minute',
				scarcityLevel: 'high',
				hardLimits: {},
				routingPolicy: {},
				metadata: {},
				createdAt: '2026-05-07T00:00:00.000Z',
				updatedAt: '2026-05-07T00:00:00.000Z',
			},
			grant: {
				id: 'grant-1',
				capacityProviderId: 'provider-1',
				laneId: 'lane-1',
				grantScope: 'project',
				teamId: 'team-1',
				projectId: 'project-1',
				environment: 'staging',
				state: 'active',
				dailyCreditLimit: 200,
				weeklyCreditLimit: null,
				monthlyCreditLimit: null,
				dailyUsdLimit: null,
				weeklyQuotaMinutes: 90,
				monthlyProviderUnits: null,
				priorityWeight: 2,
				overflowPolicy: 'soft_grant',
				metadata: {},
				createdAt: '2026-05-07T00:00:00.000Z',
				updatedAt: '2026-05-07T00:00:00.000Z',
			},
			agentProfile: {
				requiredCapabilities: ['code_edit'],
				preferredLanes: [{ laneId: 'lane-1', modelClass: 'coding', weight: 100 }],
				acceptableFallbacks: [],
				fallbackPolicy: 'allow_substitution',
			},
			modelClass: 'coding',
		});

		expect(score.agentFit).toBeGreaterThan(100);
		expect(score.scarcityPenalty).toBeGreaterThan(0);
		expect(score.score).toBeGreaterThan(0);
	});

	it('summarizes provider plan reservations', () => {
		const summary = summarizeCapacityPlan({
			projectId: 'project-1',
			teamId: 'team-1',
			environment: 'staging',
			providers: [],
			lanes: [],
			grants: [{
				id: 'grant-1',
				capacityProviderId: 'provider-1',
				laneId: null,
				grantScope: 'project',
				teamId: 'team-1',
				projectId: 'project-1',
				environment: 'staging',
				state: 'active',
				dailyCreditLimit: 100,
				weeklyCreditLimit: null,
				monthlyCreditLimit: null,
				dailyUsdLimit: null,
				weeklyQuotaMinutes: null,
				monthlyProviderUnits: null,
				priorityWeight: 1,
				overflowPolicy: 'soft_grant',
				metadata: {},
				createdAt: '2026-05-07T00:00:00.000Z',
				updatedAt: '2026-05-07T00:00:00.000Z',
			}],
			activeReservations: [{
				id: 'reservation-1',
				capacityProviderId: 'provider-1',
				laneId: 'lane-1',
				teamId: 'team-1',
				projectId: 'project-1',
				workDayId: 'workday-1',
				taskId: null,
				state: 'reserved',
				reservedCredits: 30,
				consumedCredits: 5,
				reservedProviderUnits: null,
				consumedProviderUnits: null,
				reservedUsd: null,
				consumedUsd: null,
				expiresAt: null,
				metadata: {},
				createdAt: '2026-05-07T00:00:00.000Z',
				updatedAt: '2026-05-07T00:00:00.000Z',
			}],
			estimateProfiles: [],
			remaining: {
				dailyCredits: 70,
				weeklyCredits: null,
				monthlyCredits: null,
				weeklyQuotaMinutes: null,
				dailyUsd: null,
			},
		});

		expect(summary).toMatchObject({
			grantedDailyCredits: 100,
			reservedCredits: 30,
			consumedCredits: 5,
			remainingDailyCredits: 65,
		});
	});

	it('routes and prepares reservation records for an eligible budgeted task', () => {
		const estimate = reserveCreditsForEstimate({
			taskSignature: 'proposal.draft',
			confidence: 'medium',
			estimatedCreditsP50: 4,
			estimatedCreditsP90: 8,
		});

		const result = routeAndReserveCapacity({
			plan: createCapacityPlan(),
			estimate,
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			source: 'test',
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.grant.id).toBe('grant-1');
		expect(result.reservation).toMatchObject({
			capacityProviderId: 'provider-1',
			laneId: 'lane-1',
			teamId: 'team-1',
			projectId: 'project-1',
			state: 'reserved',
			reservedCredits: 8,
		});
		expect(result.routingDecision).toMatchObject({
			projectId: 'project-1',
			selectedProviderId: 'provider-1',
			selectedLaneId: 'lane-1',
			decision: 'selected',
		});
		expect(result.ledgerEntry).toMatchObject({
			phase: 'reservation_created',
			credits: 8,
			source: 'test',
		});
	});

	it('blocks routing when the remaining grant budget cannot cover the reservation', () => {
		const estimate = reserveCreditsForEstimate({
			taskSignature: 'proposal.draft',
			confidence: 'medium',
			estimatedCreditsP50: 8,
			estimatedCreditsP90: 12,
		});

		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				activeReservations: [{
					id: 'reservation-1',
					capacityProviderId: 'provider-1',
					laneId: 'lane-1',
					teamId: 'team-1',
					projectId: 'project-1',
					workDayId: null,
					taskId: null,
					state: 'reserved',
					reservedCredits: 10,
					consumedCredits: 0,
					reservedProviderUnits: null,
					consumedProviderUnits: null,
					reservedUsd: null,
					consumedUsd: null,
					expiresAt: null,
					metadata: {},
					createdAt: timestamp,
					updatedAt: timestamp,
				}],
			}),
			estimate,
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({
			ok: false,
			code: 'insufficient_budget',
		});
		expect(result.candidates[0]).toMatchObject({
			eligible: false,
			reasons: ['insufficient_budget'],
			remainingCredits: 10,
		});
	});

	it('blocks repository mutation on lanes that only allow drafting work', () => {
		const estimate = reserveCreditsForEstimate({
			taskSignature: 'proposal.draft',
			confidence: 'medium',
			estimatedCreditsP50: 2,
			estimatedCreditsP90: 3,
		});

		const result = routeAndReserveCapacity({
			plan: createCapacityPlan(),
			estimate,
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			repositoryMutation: true,
		});

		expect(result).toMatchObject({
			ok: false,
			code: 'no_eligible_lane',
		});
		expect(result.candidates[0]?.reasons).toContain('repository_mutation_not_allowed');
	});
});
