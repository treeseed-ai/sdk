import { describe, expect, it } from 'vitest';
import {
	buildTaskEstimateProfileFromActuals,
	computeWorkdayBudgetEnvelope,
	decideTaskAdmission,
	estimateConfidenceFromProfile,
	estimateAttentionForTask,
	estimateLearningPercentile,
	estimateLearningVariance,
	estimateUtilityForTask,
	normalizeExecutionProfile,
	normalizeHybridExecutionPlan,
	predictReserveForCapacityPlan,
	normalizeTaskPlanProposal,
	progressivelyAdmitPlanProposal,
	reserveCreditsForEstimate,
	routeAndReserveCapacity,
	scoreCapacityLane,
	selectTaskEstimateProfile,
	shouldInterruptForCapacity,
	synthesizePlanEstimate,
	summarizeCapacityPlan,
	validateTaskPlanProposal,
} from '../../src/capacity.ts';
import type { CapacityPlan, TaskEstimateProfile, TaskUsageActual } from '../../src/sdk-types.ts';

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

	it('applies execution profile multipliers to the reservation while preserving base estimates', () => {
		const estimate = reserveCreditsForEstimate({
			taskSignature: 'architect.full_review',
			confidence: 'medium',
			estimatedCreditsP50: 20,
			estimatedCreditsP90: 20,
			executionProfile: normalizeExecutionProfile('large-reasoning-model'),
		});

		expect(estimate).toMatchObject({
			estimatedCreditsP50: 20,
			estimatedCreditsP90: 20,
			baseReservedCredits: 20,
			reservedCredits: 60,
			executionProfileId: 'large-reasoning-model',
			costMultiplier: 3,
		});
	});

	it('selects exact execution-profile estimate profiles before signature-only fallbacks', () => {
		const profiles: TaskEstimateProfile[] = [
			{
				taskSignature: 'engineer.small_fix',
				executionProfileId: 'standard-code-model',
				sampleCount: 10,
				creditsP50: 2,
				creditsP90: 4,
				inputTokensP50: null,
				inputTokensP90: null,
				outputTokensP50: null,
				outputTokensP90: null,
				quotaMinutesP50: null,
				quotaMinutesP90: null,
				filesChangedP50: null,
				filesChangedP90: null,
				updatedAt: timestamp,
			},
			{
				taskSignature: 'engineer.small_fix',
				executionProfileId: 'large-reasoning-model',
				sampleCount: 10,
				creditsP50: 7,
				creditsP90: 12,
				inputTokensP50: null,
				inputTokensP90: null,
				outputTokensP50: null,
				outputTokensP90: null,
				quotaMinutesP50: null,
				quotaMinutesP90: null,
				filesChangedP50: null,
				filesChangedP90: null,
				updatedAt: timestamp,
			},
		];

		expect(selectTaskEstimateProfile({
			profiles,
			taskSignature: 'engineer.small_fix',
			executionProfileId: 'large-reasoning-model',
		})?.creditsP90).toBe(12);
		expect(reserveCreditsForEstimate({
			taskSignature: 'engineer.small_fix',
			profiles,
			defaultCredits: 1,
			executionProfile: normalizeExecutionProfile('large-reasoning-model'),
		})).toMatchObject({
			estimatedCreditsP50: 7,
			estimatedCreditsP90: 12,
			baseReservedCredits: 12,
			reservedCredits: 36,
			executionProfileId: 'large-reasoning-model',
		});
	});

	it('computes learning percentiles, variance, and stale low-sample confidence', () => {
		expect(estimateLearningPercentile([5, 1, 3, 2, 4], 50)).toBe(3);
		expect(estimateLearningPercentile([5, 1, 3, 2, 4], 90)).toBe(5);
		expect(estimateLearningVariance([2, 4])).toBe(1);
		expect(estimateConfidenceFromProfile({
			taskSignature: 'engineer.small_fix',
			executionProfileId: 'standard-code-model',
			sampleCount: 2,
			completedSampleCount: 2,
			creditsP50: 3,
			creditsP90: 4,
			creditsVariance: 1,
			confidenceScore: null,
			inputTokensP50: null,
			inputTokensP90: null,
			outputTokensP50: null,
			outputTokensP90: null,
			quotaMinutesP50: null,
			quotaMinutesP90: null,
			filesChangedP50: null,
			filesChangedP90: null,
			lastSampleAt: '2025-01-01T00:00:00.000Z',
			updatedAt: '2025-01-01T00:00:00.000Z',
		}, '2026-05-13T00:00:00.000Z')).toBe('low');
	});

	it('builds profiles from completed actuals without treating interrupted partial work as completed cost', () => {
		const actuals: TaskUsageActual[] = [
			{
				id: 'actual-1',
				taskId: 'task-1',
				workDayId: 'workday-1',
				projectId: 'project-1',
				taskSignature: 'engineer.small_fix',
				executionProfileId: 'standard-code-model',
				capacityProviderId: null,
				laneId: null,
				businessModel: 'subscription_quota',
				modelName: null,
				inputTokens: null,
				outputTokens: null,
				cachedInputTokens: null,
				quotaMinutes: null,
				wallMinutes: 1,
				filesOpened: null,
				filesChanged: 1,
				diffLinesAdded: null,
				diffLinesRemoved: null,
				testRuns: null,
				retryCount: null,
				actualCredits: 2,
				actualUsd: null,
				metadata: {},
				createdAt: '2026-05-10T00:00:00.000Z',
			},
			{
				id: 'actual-2',
				taskId: 'task-2',
				workDayId: 'workday-1',
				projectId: 'project-1',
				taskSignature: 'engineer.small_fix',
				executionProfileId: 'standard-code-model',
				capacityProviderId: null,
				laneId: null,
				businessModel: 'subscription_quota',
				modelName: null,
				inputTokens: null,
				outputTokens: null,
				cachedInputTokens: null,
				quotaMinutes: null,
				wallMinutes: 2,
				filesOpened: null,
				filesChanged: 1,
				diffLinesAdded: null,
				diffLinesRemoved: null,
				testRuns: null,
				retryCount: null,
				actualCredits: 4,
				actualUsd: null,
				metadata: {},
				createdAt: '2026-05-11T00:00:00.000Z',
			},
			{
				id: 'actual-3',
				taskId: 'task-3',
				workDayId: 'workday-1',
				projectId: 'project-1',
				taskSignature: 'engineer.small_fix',
				executionProfileId: 'standard-code-model',
				capacityProviderId: null,
				laneId: null,
				businessModel: 'subscription_quota',
				modelName: null,
				inputTokens: null,
				outputTokens: null,
				cachedInputTokens: null,
				quotaMinutes: null,
				wallMinutes: 4,
				filesOpened: null,
				filesChanged: 2,
				diffLinesAdded: null,
				diffLinesRemoved: null,
				testRuns: null,
				retryCount: null,
				actualCredits: 20,
				actualUsd: null,
				metadata: { interrupted: true, partial: true },
				createdAt: '2026-05-12T00:00:00.000Z',
			},
		];

		expect(buildTaskEstimateProfileFromActuals({
			taskSignature: 'engineer.small_fix',
			executionProfileId: 'standard-code-model',
			actuals,
			now: timestamp,
		})).toMatchObject({
			taskSignature: 'engineer.small_fix',
			executionProfileId: 'standard-code-model',
			sampleCount: 3,
			completedSampleCount: 2,
			interruptedSampleCount: 1,
			creditsP50: 2,
			creditsP90: 4,
			partialCredits: 20,
		});
	});

	it('computes reserve-aware workday budget envelopes', () => {
		expect(computeWorkdayBudgetEnvelope({
			dailyCreditBudget: 100,
			usedCredits: 62,
			queuedCredits: 0,
			reserveBufferPercent: 15,
			recoveryBudgetCredits: 5,
		})).toMatchObject({
			remainingCredits: 38,
			reserveBufferCredits: 15,
			recoveryBudgetCredits: 5,
			activelyAllocatableCredits: 18,
		});
	});

	it('returns explicit admission outcomes for planning, approvals, and budget blocks', () => {
		const classification = {
			taskSignature: 'engineer.multi_file_refactor',
			risk: 'medium' as const,
			mutationScope: 'repository_write' as const,
			concurrencyClass: 'repository_claim' as const,
			expectedFanout: 2,
			confidence: 'low' as const,
			requiresPlanning: false,
			requiresApproval: false,
		};
		const estimate = reserveCreditsForEstimate({
			taskSignature: classification.taskSignature,
			confidence: classification.confidence,
			estimatedCreditsP50: 10,
			estimatedCreditsP90: 25,
		});

		expect(decideTaskAdmission({
			classification,
			estimate,
			budget: { dailyCreditBudget: 100, usedCredits: 0 },
			policy: { planningThresholdCredits: 20, approvalThresholdCredits: 50 },
		})).toMatchObject({
			outcome: 'planning_required',
			requiresPlanning: true,
		});

		expect(decideTaskAdmission({
			classification: { ...classification, requiresPlanning: false, confidence: 'high', expectedFanout: 0 },
			estimate: { ...estimate, reservedCredits: 80 },
			budget: { dailyCreditBudget: 100, usedCredits: 0 },
			policy: { planningThresholdCredits: 20, approvalThresholdCredits: 50 },
		})).toMatchObject({
			outcome: 'approval_required',
			requiresApproval: true,
		});

		expect(decideTaskAdmission({
			classification: { ...classification, confidence: 'high', expectedFanout: 0 },
			estimate: { ...estimate, reservedCredits: 8 },
			budget: { dailyCreditBudget: 10, usedCredits: 0, reserveBufferPercent: 50, recoveryBudgetCredits: 0 },
			policy: { planningThresholdCredits: 20, approvalThresholdCredits: 50, reserveBufferPercent: 50 },
		})).toMatchObject({
			outcome: 'budget_blocked',
		});
	});

	it('detects capacity interruption pressure before a hard limit', () => {
		expect(shouldInterruptForCapacity({
			reservedCredits: 100,
			consumedCredits: 85,
			estimatedRemainingCreditsP50: 30,
			estimatedRemainingCreditsP90: 60,
			reservationUsedPercentThreshold: 80,
		})).toMatchObject({
			interrupt: true,
			reasons: ['reservation_exhaustion_risk'],
			remainingReservationCredits: 15,
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

	it('prefers cheaper execution profiles when quality requirements are satisfied', () => {
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				lanes: [{
					...createCapacityPlan().lanes[0],
					modelClass: 'coding',
					routingPolicy: {
						taskKinds: ['proposal.draft'],
						requiredCapabilities: ['agent_execution'],
						allowedEnvironments: ['staging'],
						maxCreditsPerTask: 100,
						repositoryMutationAllowed: true,
					},
				}],
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 4,
				estimatedCreditsP90: 8,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			executionProfiles: ['small-code-model', 'standard-code-model', 'large-reasoning-model'],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.estimate.executionProfileId).toBe('small-code-model');
		expect(result.estimate.reservedCredits).toBe(4);
		expect(result.capacityMetadata.executionProfileId).toBe('small-code-model');
	});

	it('requires a higher-quality profile for risky work', () => {
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				lanes: [{
					...createCapacityPlan().lanes[0],
					modelClass: 'reasoning',
					routingPolicy: {
						taskKinds: ['proposal.draft'],
						requiredCapabilities: ['agent_execution'],
						allowedEnvironments: ['staging'],
						maxCreditsPerTask: 100,
						repositoryMutationAllowed: true,
					},
				}],
				grants: [{ ...createCapacityPlan().grants[0], dailyCreditLimit: 100 }],
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 2,
				estimatedCreditsP90: 4,
			}),
			classification: {
				taskSignature: 'proposal.draft',
				risk: 'high',
				mutationScope: 'repository_write',
				concurrencyClass: 'repository_claim',
				expectedFanout: 1,
				confidence: 'medium',
				requiresPlanning: false,
				requiresApproval: false,
			},
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			executionProfiles: ['small-code-model', 'standard-code-model', 'large-reasoning-model'],
			minimumQualityWeight: 1.4,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.estimate.executionProfileId).toBe('large-reasoning-model');
		expect(result.candidates.find((candidate) => candidate.executionProfileId === 'small-code-model')?.reasons)
			.toContain('quality_below_minimum');
	});

	it('derives conservative attention estimates from task shape and execution surface', () => {
		const readOnly = estimateAttentionForTask({
			classification: {
				taskSignature: 'agent.activation',
				risk: 'low',
				mutationScope: 'repository_read',
				concurrencyClass: 'read_only',
				expectedFanout: 0,
				confidence: 'high',
				requiresPlanning: false,
				requiresApproval: false,
			},
			executionProfile: normalizeExecutionProfile('local-runner'),
		});
		const productionHuman = estimateAttentionForTask({
			classification: {
				taskSignature: 'review.promote_request',
				risk: 'high',
				mutationScope: 'production',
				concurrencyClass: 'human_attention',
				expectedFanout: 2,
				confidence: 'low',
				requiresPlanning: false,
				requiresApproval: true,
			},
			executionProfile: normalizeExecutionProfile('human-review'),
			requiredContextTokens: 120_000,
		});

		expect(readOnly.totalAttentionWeight).toBeGreaterThan(0);
		expect(productionHuman.totalAttentionWeight).toBeGreaterThan(readOnly.totalAttentionWeight);
		expect(productionHuman.estimatedContextTokens).toBe(120_000);
	});

	it('penalizes but does not block routes under soft attention pressure', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				lanes: [{
					...base.lanes[0],
					modelClass: 'coding',
					hardLimits: { maxAttentionLoad: 10 },
					routingPolicy: { ...base.lanes[0].routingPolicy, maxCreditsPerTask: 100 },
				}],
				grants: [{ ...base.grants[0], dailyCreditLimit: 100 }],
				activeReservations: [{
					id: 'reservation-1',
					capacityProviderId: 'provider-1',
					laneId: 'lane-1',
					teamId: 'team-1',
					projectId: 'project-1',
					workDayId: null,
					taskId: null,
					state: 'reserved',
					reservedCredits: 1,
					consumedCredits: 0,
					reservedProviderUnits: null,
					consumedProviderUnits: null,
					reservedUsd: null,
					consumedUsd: null,
					expiresAt: null,
					metadata: { attentionEstimate: { totalAttentionWeight: 4, estimatedContextTokens: 1000 } },
					createdAt: timestamp,
					updatedAt: timestamp,
				}],
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 1,
				estimatedCreditsP90: 2,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			executionProfiles: ['standard-code-model'],
			attentionWeight: 2,
			coordinationWeight: 1,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.candidates[0]?.score.attentionPenalty).toBeGreaterThan(0);
		expect(result.candidates[0]?.pressure?.activeAttentionLoad).toBe(4);
		expect(result.capacityMetadata.attentionEstimate).toMatchObject({ totalAttentionWeight: 3 });
	});

	it('blocks routes when hard attention or context limits would be exceeded', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				lanes: [{
					...base.lanes[0],
					hardLimits: { maxAttentionLoad: 5, maxContextTokens: 1000 },
					routingPolicy: { ...base.lanes[0].routingPolicy, maxCreditsPerTask: 100 },
				}],
				grants: [{ ...base.grants[0], dailyCreditLimit: 100 }],
				activeReservations: [{
					id: 'reservation-1',
					capacityProviderId: 'provider-1',
					laneId: 'lane-1',
					teamId: 'team-1',
					projectId: 'project-1',
					workDayId: null,
					taskId: null,
					state: 'reserved',
					reservedCredits: 1,
					consumedCredits: 0,
					reservedProviderUnits: null,
					consumedProviderUnits: null,
					reservedUsd: null,
					consumedUsd: null,
					expiresAt: null,
					metadata: { attentionEstimate: { totalAttentionWeight: 4, estimatedContextTokens: 700 } },
					createdAt: timestamp,
					updatedAt: timestamp,
				}],
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 1,
				estimatedCreditsP90: 2,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			attentionPolicy: { reserveAttentionPercent: 0, maxContextSaturationPercent: 100 },
			attentionWeight: 2,
			estimatedContextTokens: 500,
		});

		expect(result).toMatchObject({ ok: false, code: 'no_eligible_lane' });
		expect(result.candidates[0]?.reasons).toContain('attention_load_exceeded');
		expect(result.candidates[0]?.reasons).toContain('context_saturation_exceeded');
	});

	it('blocks saturated lanes and falls back to an eligible lane', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				lanes: [
					{
						...base.lanes[0],
						id: 'lane-exhausted',
						modelClass: 'coding',
						routingPolicy: { ...base.lanes[0].routingPolicy, maxCreditsPerTask: 100 },
					},
					{
						...base.lanes[0],
						id: 'lane-fallback',
						modelClass: 'coding',
						routingPolicy: { ...base.lanes[0].routingPolicy, maxCreditsPerTask: 100 },
					},
				],
				grants: [
					{ ...base.grants[0], id: 'grant-exhausted', laneId: 'lane-exhausted', dailyCreditLimit: 4, overflowPolicy: 'fallback_lane' },
					{ ...base.grants[0], id: 'grant-fallback', laneId: 'lane-fallback', dailyCreditLimit: 20, overflowPolicy: 'deny' },
				],
				activeReservations: [{
					id: 'reservation-1',
					capacityProviderId: 'provider-1',
					laneId: 'lane-exhausted',
					teamId: 'team-1',
					projectId: 'project-1',
					workDayId: null,
					taskId: null,
					state: 'reserved',
					reservedCredits: 4,
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
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 4,
				estimatedCreditsP90: 8,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			executionProfiles: ['standard-code-model'],
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.lane.id).toBe('lane-fallback');
		expect(result.candidates.find((candidate) => candidate.laneId === 'lane-exhausted')?.spilloverReason).toBe('fallback_lane');
	});

	it('applies learned task-signature plus execution-profile estimates per route', () => {
		const profiles: TaskEstimateProfile[] = [
			{
				taskSignature: 'proposal.draft',
				executionProfileId: 'small-code-model',
				sampleCount: 4,
				creditsP50: 10,
				creditsP90: 20,
				inputTokensP50: null,
				inputTokensP90: null,
				outputTokensP50: null,
				outputTokensP90: null,
				quotaMinutesP50: null,
				quotaMinutesP90: null,
				filesChangedP50: null,
				filesChangedP90: null,
				updatedAt: timestamp,
			},
			{
				taskSignature: 'proposal.draft',
				executionProfileId: 'standard-code-model',
				sampleCount: 4,
				creditsP50: 2,
				creditsP90: 4,
				inputTokensP50: null,
				inputTokensP90: null,
				outputTokensP50: null,
				outputTokensP90: null,
				quotaMinutesP50: null,
				quotaMinutesP90: null,
				filesChangedP50: null,
				filesChangedP90: null,
				updatedAt: timestamp,
			},
		];
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				lanes: [{
					...createCapacityPlan().lanes[0],
					modelClass: 'coding',
					routingPolicy: { ...createCapacityPlan().lanes[0].routingPolicy, maxCreditsPerTask: 100 },
				}],
				grants: [{ ...createCapacityPlan().grants[0], dailyCreditLimit: 100 }],
				estimateProfiles: profiles,
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				defaultCredits: 2,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			executionProfiles: ['small-code-model', 'standard-code-model'],
			estimateProfiles: profiles,
		});

		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.reason);
		expect(result.estimate.executionProfileId).toBe('standard-code-model');
		expect(result.estimate.reservedCredits).toBe(4);
		expect(result.candidates.find((candidate) => candidate.executionProfileId === 'small-code-model')?.estimate?.reservedCredits).toBe(10);
	});

	it('blocks provider routes that are unavailable or fully congested', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				lanes: [{
					...base.lanes[0],
					hardLimits: { maxActiveReservations: 1 },
				}],
				activeReservations: [{
					id: 'reservation-1',
					capacityProviderId: 'provider-1',
					laneId: 'lane-1',
					teamId: 'team-1',
					projectId: 'project-1',
					workDayId: null,
					taskId: null,
					state: 'reserved',
					reservedCredits: 1,
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
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 1,
				estimatedCreditsP90: 2,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: false, code: 'no_eligible_lane' });
		expect(result.candidates[0]?.reasons).toContain('lane_congested');
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
			remainingCredits: 10,
		});
		expect(result.candidates[0]?.reasons).toContain('insufficient_budget');
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

	it('normalizes and validates bounded plan proposals', () => {
		const proposal = normalizeTaskPlanProposal({
			planId: 'plan-1',
			sourceTaskId: 'task-parent',
			planningDepth: 1,
			tasks: [
				{ id: 'a', type: 'docs_update', estimatedCreditsP50: 2, estimatedCreditsP90: 3 },
				{ id: 'b', type: 'review_verify', estimatedCredits: 4 },
			],
		}, { maxDownstreamTasks: 3, maxPlanningDepth: 2 });

		expect(proposal).toMatchObject({
			schemaVersion: 1,
			planId: 'plan-1',
			totalEstimatedCreditsP50: 6,
			totalEstimatedCreditsP90: 7,
		});
		expect(validateTaskPlanProposal(proposal, { maxDownstreamTasks: 3, maxPlanningDepth: 2 })).toMatchObject({
			ok: true,
		});
		expect(synthesizePlanEstimate(proposal.tasks)).toEqual({
			totalEstimatedCreditsP50: 6,
			totalEstimatedCreditsP90: 7,
		});
	});

	it('rejects plan proposals that exceed fan-out or planning depth', () => {
		const proposal = normalizeTaskPlanProposal({
			planId: 'plan-2',
			planningDepth: 3,
			tasks: [
				{ id: 'a', type: 'one', estimatedCreditsP90: 1 },
				{ id: 'b', type: 'two', estimatedCreditsP90: 1 },
			],
		}, { maxDownstreamTasks: 1, maxPlanningDepth: 1 });

		expect(validateTaskPlanProposal(proposal, { maxDownstreamTasks: 1, maxPlanningDepth: 1 })).toMatchObject({
			ok: false,
			reasons: ['planning_depth_exceeded', 'fanout_limit_exceeded'],
		});
	});

	it('progressively admits only budget-fitting planned tasks and defers the rest', () => {
		const proposal = normalizeTaskPlanProposal({
			planId: 'plan-3',
			tasks: [
				{ id: 'high', type: 'review_verify', priority: 10, estimatedCreditsP90: 5, risk: 'low', mutationScope: 'none' },
				{ id: 'large', type: 'api_refactor', priority: 9, estimatedCreditsP90: 20, risk: 'medium', mutationScope: 'repository_write' },
				{ id: 'small', type: 'dependency_refresh', priority: 1, estimatedCreditsP90: 3, risk: 'low', mutationScope: 'none' },
			],
		}, { maxDownstreamTasks: 5 });

		const result = progressivelyAdmitPlanProposal({
			proposal,
			policy: { maxDownstreamTasks: 5, maxAdmittedPlanTasksPerCycle: 3 },
			availableCredits: 8,
			remainingQueuedCredits: 8,
			remainingQueuedSlots: 2,
		});

		expect(result.admitted.map((task) => task.id)).toEqual(['high', 'small']);
		expect(result.deferred.map((task) => task.id)).toEqual(['large']);
		expect(result.admittedCreditsP90).toBe(8);
		expect(result.reasons).toContain('insufficient_plan_budget');
	});

	it('scores utility per credit and preserves predictive reserve for low-utility work', () => {
		const lowUtility = routeAndReserveCapacity({
			plan: createCapacityPlan(),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 5,
				estimatedCreditsP90: 10,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			utilityValue: 5,
			predictiveReservePolicy: {
				enabled: true,
				baseReservePercent: 80,
				maxReservePercent: 100,
			},
		});
		expect(lowUtility).toMatchObject({ ok: false, code: 'no_eligible_lane' });
		expect(lowUtility.candidates[0]?.reasons).toContain('predictive_reserve_blocked');

		const highUtility = routeAndReserveCapacity({
			plan: createCapacityPlan(),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 5,
				estimatedCreditsP90: 10,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			utilityValue: 100,
			predictiveReservePolicy: {
				enabled: true,
				baseReservePercent: 80,
				maxReservePercent: 100,
			},
		});
		expect(highUtility).toMatchObject({ ok: true });
		expect(highUtility.candidates[0]?.utilityEstimate?.utilityPerCredit).toBeGreaterThan(0);
	});

	it('chooses cooperative higher-trust routes when risk requires trust', () => {
		const base = createCapacityPlan();
		const plan = createCapacityPlan({
			providers: [
				{
					...base.providers[0],
					metadata: { trustScore: 0.4, availabilityScore: 1 },
				},
				{
					...base.providers[0],
					id: 'provider-2',
					name: 'Trusted helpers',
					metadata: { trustScore: 0.95, availabilityScore: 1 },
				},
			],
			lanes: [
				base.lanes[0],
				{
					...base.lanes[0],
					id: 'lane-2',
					capacityProviderId: 'provider-2',
				},
			],
			grants: [
				base.grants[0],
				{
					...base.grants[0],
					id: 'grant-2',
					capacityProviderId: 'provider-2',
				},
			],
		});
		const result = routeAndReserveCapacity({
			plan,
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 2,
				estimatedCreditsP90: 4,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			cooperativeRouting: true,
			trustRequirement: 0.8,
			utilityValue: 50,
		});
		expect(result).toMatchObject({ ok: true });
		if (result.ok) {
			expect(result.provider.id).toBe('provider-2');
			expect(result.capacityMetadata.utilityEstimate?.utilityScore).toBeGreaterThan(0);
		}
	});

	it('normalizes hybrid execution plans without admitting mutation phases directly', () => {
		const plan = normalizeHybridExecutionPlan({
			planId: 'hybrid-1',
			phases: [
				{ kind: 'planning', executionProfileId: 'large-reasoning-model', mutationAllowed: false },
				{ kind: 'implementation', executionProfileId: 'standard-code-model' },
				{ kind: 'review', executionProfileId: 'cheap-review-model', mutationAllowed: false },
			],
		});
		expect(plan).toMatchObject({
			schemaVersion: 1,
			planId: 'hybrid-1',
			phases: [
				expect.objectContaining({ kind: 'planning', admissionRequired: true, mutationAllowed: false }),
				expect.objectContaining({ kind: 'implementation', admissionRequired: true, mutationAllowed: true }),
				expect.objectContaining({ kind: 'review', admissionRequired: true, mutationAllowed: false }),
			],
		});
	});

	it('predictive reserve is neutral when disabled', () => {
		const neutral = predictReserveForCapacityPlan({
			plan: createCapacityPlan(),
			policy: { enabled: false, baseReservePercent: 50 },
			remainingCredits: 20,
		});
		expect(neutral).toMatchObject({
			reservePercent: 0,
			reserveCredits: 0,
			activelyAllocatableCredits: 20,
		});
		expect(estimateUtilityForTask({
			utilityValue: 20,
			estimate: { reservedCredits: 5 },
		}).utilityPerCredit).toBeGreaterThan(0);
	});
});
