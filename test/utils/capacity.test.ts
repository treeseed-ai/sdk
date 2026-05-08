import { describe, expect, it } from 'vitest';
import {
	reserveCreditsForEstimate,
	scoreCapacityLane,
	summarizeCapacityPlan,
} from '../../src/capacity.ts';

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
});
