import { describe, expect, it } from 'vitest';
import {
	buildCreditConversionProfileFromActuals,
	buildTaskEstimateProfileFromActuals,
	calculateActualCredits,
	computeWorkdayBudgetEnvelope,
	decideTaskAdmission,
	deriveAvailableCredits,
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
	selectCreditConversionProfile,
	selectTaskEstimateProfile,
	shouldInterruptForCapacity,
	synthesizePlanEstimate,
	summarizeCapacityPlan,
	validateTaskPlanProposal,
} from '../../src/capacity.ts';
import type { CapacityPlan, CreditConversionProfile, DerivedCapacityAvailability, ExecutionProvider, TaskEstimateProfile, TaskUsageActual } from '../../src/sdk-types.ts';

const timestamp = '2026-05-07T00:00:00.000Z';

function usageActual(overrides: Partial<TaskUsageActual> = {}): TaskUsageActual {
	return {
		id: 'actual',
		taskId: null,
		workDayId: null,
		projectId: 'project-1',
		taskSignature: 'engineer.small_fix',
		executionProfileId: 'standard-code-model',
		capacityProviderId: 'provider-1',
		executionProviderId: 'execution-provider-1',
		laneId: null,
		businessModel: 'subscription_quota',
		modelName: null,
		inputTokens: null,
		outputTokens: null,
		cachedInputTokens: null,
		quotaMinutes: null,
		wallMinutes: null,
		filesOpened: null,
		filesChanged: null,
		diffLinesAdded: null,
		diffLinesRemoved: null,
		testRuns: null,
		retryCount: null,
		actualCredits: 1,
		actualUsd: null,
		nativeUsage: null,
		metadata: {},
		createdAt: timestamp,
		...overrides,
	};
}

function executionProvider(overrides: Partial<ExecutionProvider> = {}): ExecutionProvider {
	return {
		id: 'execution-provider-1',
		teamId: 'team-1',
		capacityProviderId: 'provider-1',
		name: 'Codex seat',
		kind: 'codex_subscription',
		status: 'active',
		nativeUnit: 'wall_minute',
		quotaVisibility: 'opaque',
		maxConcurrentWorkers: 1,
		resetCadence: 'daily',
		config: {},
		metadata: {},
		nativeLimits: [],
		latestObservation: null,
		createdAt: timestamp,
		updatedAt: timestamp,
		...overrides,
	};
}

function conversionProfile(overrides: Partial<CreditConversionProfile> = {}): CreditConversionProfile {
	return {
		id: 'conversion-profile-1',
		taskSignature: 'engineer.small_fix',
		executionProfileId: 'standard-code-model',
		executionProviderKind: 'codex_subscription',
		nativeUnit: 'wall_minute',
		sampleCount: 20,
		completedSampleCount: 20,
		interruptedSampleCount: 0,
		nativeUnitsPerCreditP50: 4,
		nativeUnitsPerCreditP90: 5,
		creditsPerNativeUnitP50: 0.25,
		creditsPerNativeUnitP90: 0.2,
		actualCreditsP50: 2,
		actualCreditsP90: 4,
		confidence: 'high',
		formulaVersion: 'treeseed.actual-credits.v1',
		metadata: {},
		createdAt: timestamp,
		updatedAt: timestamp,
		...overrides,
	};
}

function derivedCapacityEntry(overrides: Partial<DerivedCapacityAvailability> = {}): DerivedCapacityAvailability {
	return {
		executionProviderId: 'codex-seat-1',
		capacityProviderId: 'provider-1',
		executionProviderKind: 'codex_subscription',
		nativeUnit: 'wall_minute',
		scope: 'daily',
		configuredNativeLimit: 240,
		observedNativeRemaining: null,
		nativeRemainingSource: 'configured_limit',
		activeReservedNativeAmount: 0,
		activeConsumedNativeAmount: 0,
		reserveBufferPercent: 25,
		reserveBufferNativeAmount: 60,
		availableNativeAmount: 180,
		nativeUnitsPerCredit: 5,
		conversionProfileId: 'conversion-profile-1',
		conversionTaskSignature: 'proposal.draft',
		conversionConfidence: 'high',
		derivedAvailableCredits: 36,
		confidence: 'high',
		resetAt: null,
		reasons: ['configured_limit', 'reserve_buffer', 'p90_conversion_profile'],
		metadata: {},
		...overrides,
	};
}

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
			creditBudgetMode: 'static',
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

	it('builds credit conversion profiles from native usage while separating interrupted samples', () => {
		const actuals = [
			usageActual({ id: 'a1', actualCredits: 2, nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 10 }, createdAt: '2026-05-01T00:00:00.000Z' }),
			usageActual({ id: 'a2', actualCredits: 4, nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 20 }, createdAt: '2026-05-02T00:00:00.000Z' }),
			usageActual({ id: 'a3', actualCredits: 20, nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 15 }, metadata: { interrupted: true, partial: true }, createdAt: '2026-05-03T00:00:00.000Z' }),
		];

		expect(buildCreditConversionProfileFromActuals({
			taskSignature: 'engineer.small_fix',
			executionProfileId: 'standard-code-model',
			executionProviderKind: 'codex_subscription',
			nativeUnit: 'wall_minute',
			actuals,
			now: timestamp,
		})).toMatchObject({
			taskSignature: 'engineer.small_fix',
			executionProviderKind: 'codex_subscription',
			nativeUnit: 'wall_minute',
			sampleCount: 3,
			completedSampleCount: 2,
			interruptedSampleCount: 1,
			nativeUnitsPerCreditP50: 5,
			nativeUnitsPerCreditP90: 5,
			creditsPerNativeUnitP50: 0.2,
			actualCreditsP90: 4,
			confidence: 'low',
			metadata: expect.objectContaining({
				partialCredits: 20,
				partialNativeAmount: 15,
			}),
		});
	});

	it('learns USD and token conversion ratios from native usage facts', () => {
		const usdProfile = buildCreditConversionProfileFromActuals({
			taskSignature: 'engineer.small_fix',
			executionProviderKind: 'token_metered_api',
			nativeUnit: 'usd',
			actuals: [
				usageActual({ id: 'usd-1', actualCredits: 3, nativeUsage: { nativeUnit: 'usd', usd: 0.09 } }),
				usageActual({ id: 'usd-2', actualCredits: 6, nativeUsage: { nativeUnit: 'usd', usd: 0.18 } }),
			],
			now: timestamp,
		});
		const tokenProfile = buildCreditConversionProfileFromActuals({
			taskSignature: 'engineer.small_fix',
			executionProviderKind: 'token_metered_api',
			nativeUnit: 'token',
			actuals: [
				usageActual({ id: 'token-1', actualCredits: 2, nativeUsage: { nativeUnit: 'token', inputTokens: 8000, outputTokens: 2000 } }),
				usageActual({ id: 'token-2', actualCredits: 4, nativeUsage: { nativeUnit: 'token', inputTokens: 18000, outputTokens: 2000 } }),
			],
			now: timestamp,
		});

		expect(usdProfile).toMatchObject({
			nativeUnitsPerCreditP50: 0.03,
			creditsPerNativeUnitP50: 33.333333333333336,
		});
		expect(tokenProfile).toMatchObject({
			nativeUnitsPerCreditP50: 5000,
			nativeUnitsPerCreditP90: 5000,
		});
	});

	it('selects matching conversion profiles and uses high-confidence profiles for actual credits', () => {
		const actuals = Array.from({ length: 20 }, (_, index) => usageActual({
			id: `high-${index}`,
			actualCredits: 2,
			nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 10 },
			createdAt: `2026-05-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
		}));
		const profile = buildCreditConversionProfileFromActuals({
			taskSignature: 'engineer.small_fix',
			executionProviderKind: 'codex_subscription',
			nativeUnit: 'wall_minute',
			actuals,
			now: timestamp,
		});
		const selected = selectCreditConversionProfile({
			profiles: [profile],
			taskSignature: 'engineer.small_fix',
			executionProfileId: 'standard-code-model',
			executionProviderKind: 'codex_subscription',
			nativeUnit: 'wall_minute',
		});
		const calculated = calculateActualCredits({
			nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 20, filesChanged: 10 },
			conversionProfile: selected,
		});

		expect(profile.confidence).toBe('high');
		expect(calculated).toMatchObject({
			actualCredits: 4,
			source: 'conversion_profile',
			conversionConfidence: 'high',
		});
	});

	it('blends medium-confidence profiles and falls back for low-confidence profiles', () => {
		const mediumProfile = buildCreditConversionProfileFromActuals({
			taskSignature: 'engineer.small_fix',
			executionProviderKind: 'codex_subscription',
			nativeUnit: 'wall_minute',
			actuals: Array.from({ length: 5 }, (_, index) => usageActual({
				id: `medium-${index}`,
				actualCredits: 2,
				nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 10 },
			})),
			now: timestamp,
		});
		const lowProfile = buildCreditConversionProfileFromActuals({
			taskSignature: 'engineer.small_fix',
			executionProviderKind: 'codex_subscription',
			nativeUnit: 'wall_minute',
			actuals: Array.from({ length: 4 }, (_, index) => usageActual({
				id: `low-${index}`,
				actualCredits: 2,
				nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 10 },
			})),
			now: timestamp,
		});

		expect(calculateActualCredits({
			nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 20, filesChanged: 10 },
			conversionProfile: mediumProfile,
		})).toMatchObject({
			actualCredits: 14,
			source: 'blended_conversion_profile',
		});
		expect(calculateActualCredits({
			nativeUsage: { nativeUnit: 'wall_minute', wallMinutes: 20, filesChanged: 10 },
			conversionProfile: lowProfile,
		})).toMatchObject({
			actualCredits: 24,
			source: 'central_calculator',
		});
	});

	it('derives Codex wall-minute availability from limits, buffers, reservations, and learned conversion', () => {
		const result = deriveAvailableCredits({
			executionProvider: executionProvider(),
			nativeLimit: {
				id: 'limit-1',
				executionProviderId: 'execution-provider-1',
				scope: 'daily',
				nativeUnit: 'wall_minute',
				limitAmount: 100,
				reserveBufferPercent: 10,
				resetCadence: 'daily',
				resetAt: null,
				confidence: 'estimated',
				source: 'configured',
				metadata: {},
				createdAt: timestamp,
				updatedAt: timestamp,
			},
			activeReservations: [{
				id: 'reservation-1',
				capacityProviderId: 'provider-1',
				executionProviderId: 'execution-provider-1',
				laneId: 'lane-1',
				teamId: 'team-1',
				projectId: 'project-1',
				workDayId: null,
				taskId: null,
				state: 'reserved',
				reservedCredits: 5,
				consumedCredits: 0,
				nativeUnit: 'wall_minute',
				reservedNativeAmount: 15,
				consumedNativeAmount: null,
				reservedProviderUnits: null,
				consumedProviderUnits: null,
				reservedUsd: null,
				consumedUsd: null,
				expiresAt: null,
				metadata: {},
				createdAt: timestamp,
				updatedAt: timestamp,
			}],
			conversionProfile: conversionProfile(),
		});

		expect(result).toMatchObject({
			configuredNativeLimit: 100,
			nativeRemainingSource: 'configured_limit',
			activeReservedNativeAmount: 15,
			reserveBufferNativeAmount: 10,
			availableNativeAmount: 75,
			nativeUnitsPerCredit: 5,
			derivedAvailableCredits: 15,
			confidence: 'high',
			reasons: expect.arrayContaining(['opaque_limit_fallback', 'active_native_reservations', 'reserve_buffer', 'p90_conversion_profile']),
		});
	});

	it('derives USD/token availability from observed remaining native facts', () => {
		const result = deriveAvailableCredits({
			executionProvider: executionProvider({
				kind: 'token_metered_api',
				nativeUnit: 'usd',
				quotaVisibility: 'reported',
			}),
			nativeLimit: {
				id: 'limit-usd',
				executionProviderId: 'execution-provider-1',
				scope: 'daily',
				nativeUnit: 'usd',
				limitAmount: 1,
				reserveBufferPercent: 10,
				resetCadence: 'daily',
				resetAt: null,
				confidence: 'configured',
				source: 'configured',
				metadata: {},
				createdAt: timestamp,
				updatedAt: timestamp,
			},
			latestObservation: {
				id: 'observation-1',
				executionProviderId: 'execution-provider-1',
				observedAt: timestamp,
				health: 'healthy',
				activeWorkers: 0,
				queuedTasks: 0,
				throttleState: null,
				nativeRemaining: { usd: 0.4 },
				resetAt: null,
				confidence: 'reported',
				metadata: {},
				createdAt: timestamp,
			},
			conversionProfile: conversionProfile({
				executionProviderKind: 'token_metered_api',
				nativeUnit: 'usd',
				nativeUnitsPerCreditP50: 0.03,
				nativeUnitsPerCreditP90: 0.05,
				confidence: 'medium',
			}),
		});

		expect(result).toMatchObject({
			observedNativeRemaining: 0.4,
			nativeRemainingSource: 'observation',
			reserveBufferNativeAmount: 0.1,
			availableNativeAmount: 0.30000000000000004,
			nativeUnitsPerCredit: 0.05,
			derivedAvailableCredits: 6,
			confidence: 'medium',
			reasons: expect.arrayContaining(['observation_remaining', 'p90_conversion_profile']),
		});
	});

	it('exposes native availability while learning when conversion is missing', () => {
		const result = deriveAvailableCredits({
			executionProvider: executionProvider(),
			nativeLimit: {
				id: 'limit-1',
				executionProviderId: 'execution-provider-1',
				scope: 'daily',
				nativeUnit: 'wall_minute',
				limitAmount: 60,
				reserveBufferPercent: 0,
				resetCadence: 'daily',
				resetAt: null,
				confidence: 'estimated',
				source: 'configured',
				metadata: {},
				createdAt: timestamp,
				updatedAt: timestamp,
			},
			conversionProfile: null,
		});

		expect(result).toMatchObject({
			availableNativeAmount: 60,
			nativeUnitsPerCredit: null,
			derivedAvailableCredits: null,
			confidence: 'low',
			reasons: expect.arrayContaining(['missing_conversion_profile']),
		});
	});

	it('keeps native-to-credit availability monotonic as buffers and reservations grow', () => {
		const nativeLimit = {
			id: 'limit-1',
			executionProviderId: 'execution-provider-1',
			scope: 'daily',
			nativeUnit: 'wall_minute',
			limitAmount: 100,
			reserveBufferPercent: 0,
			resetCadence: 'daily',
			resetAt: null,
			confidence: 'estimated',
			source: 'configured',
			metadata: {},
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		const base = deriveAvailableCredits({
			executionProvider: executionProvider(),
			nativeLimit,
			conversionProfile: conversionProfile(),
		});
		const buffered = deriveAvailableCredits({
			executionProvider: executionProvider(),
			nativeLimit: { ...nativeLimit, reserveBufferPercent: 25 },
			conversionProfile: conversionProfile(),
		});
		const reserved = deriveAvailableCredits({
			executionProvider: executionProvider(),
			nativeLimit: { ...nativeLimit, reserveBufferPercent: 25 },
			activeReservations: [{
				id: 'reservation-1',
				capacityProviderId: 'provider-1',
				executionProviderId: 'execution-provider-1',
				laneId: 'lane-1',
				teamId: 'team-1',
				projectId: 'project-1',
				workDayId: null,
				taskId: null,
				state: 'reserved',
				reservedCredits: 5,
				consumedCredits: 0,
				nativeUnit: 'wall_minute',
				reservedNativeAmount: 90,
				consumedNativeAmount: null,
				reservedProviderUnits: null,
				consumedProviderUnits: null,
				reservedUsd: null,
				consumedUsd: null,
				expiresAt: null,
				metadata: {},
				createdAt: timestamp,
				updatedAt: timestamp,
			}],
			conversionProfile: conversionProfile(),
		});

		expect(buffered.availableNativeAmount).toBeLessThanOrEqual(base.availableNativeAmount);
		expect(buffered.derivedAvailableCredits).toBeLessThanOrEqual(base.derivedAvailableCredits ?? Number.POSITIVE_INFINITY);
		expect(reserved.availableNativeAmount).toBe(0);
		expect(reserved.derivedAvailableCredits).toBe(0);
		expect(reserved.availableNativeAmount).toBeGreaterThanOrEqual(0);
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

	it('routes derived-mode providers against medium-confidence native-derived availability', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [{ ...base.providers[0], creditBudgetMode: 'derived', dailyCreditBudget: 0, monthlyCreditBudget: 0 }],
				grants: [{ ...base.grants[0], dailyCreditLimit: null }],
				derivedCapacity: { entries: [derivedCapacityEntry({ confidence: 'medium', derivedAvailableCredits: 36 })] },
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 6,
				estimatedCreditsP90: 8,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error(result.reason);
		expect(result.remainingCreditsBefore).toBe(36);
		expect(result.reservation).toMatchObject({
			executionProviderId: 'codex-seat-1',
			nativeUnit: 'wall_minute',
			reservedNativeAmount: 40,
		});
		expect(result.capacityMetadata).toMatchObject({
			derivedCapacityMode: 'derived',
			derivedAvailableCredits: 36,
			nativePressure: expect.objectContaining({
				executionProviderId: 'codex-seat-1',
				nativeUnit: 'wall_minute',
			}),
		});
		expect(result.candidates[0]?.reasons).toEqual(expect.arrayContaining([
			'derived_capacity_available',
			'native_capacity_pressure',
		]));
	});

	it('blocks derived-mode providers when native-derived availability is exhausted', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [{ ...base.providers[0], creditBudgetMode: 'derived', dailyCreditBudget: 0, monthlyCreditBudget: 0 }],
				grants: [{ ...base.grants[0], dailyCreditLimit: null }],
				derivedCapacity: { entries: [derivedCapacityEntry({ availableNativeAmount: 10, derivedAvailableCredits: 2 })] },
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 6,
				estimatedCreditsP90: 8,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: false, code: 'insufficient_budget' });
		expect(result.candidates[0]).toMatchObject({
			eligible: false,
			remainingCredits: 2,
			derivedAvailableCredits: 2,
		});
		expect(result.candidates[0]?.reasons).toEqual(expect.arrayContaining([
			'derived_capacity_exhausted',
			'insufficient_budget',
		]));
	});

	it('keeps low-confidence derived capacity in learning mode and does not admit derived routes', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [{ ...base.providers[0], creditBudgetMode: 'derived', dailyCreditBudget: 0, monthlyCreditBudget: 0 }],
				grants: [{ ...base.grants[0], dailyCreditLimit: null }],
				derivedCapacity: { entries: [derivedCapacityEntry({ confidence: 'low', conversionConfidence: 'low', derivedAvailableCredits: 36 })] },
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 6,
				estimatedCreditsP90: 8,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: false, code: 'insufficient_budget' });
		expect(result.candidates[0]).toMatchObject({
			eligible: false,
			remainingCredits: 36,
			reservedNativeAmount: null,
		});
		expect(result.candidates[0]?.reasons).toEqual(expect.arrayContaining([
			'derived_capacity_learning',
			'insufficient_budget',
		]));
	});

	it('treats missing credit budget mode as derived instead of inferring static from legacy budgets', () => {
		const base = createCapacityPlan();
		const { creditBudgetMode: _mode, ...providerWithoutMode } = base.providers[0];
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [providerWithoutMode],
				grants: [{ ...base.grants[0], dailyCreditLimit: null }],
				derivedCapacity: { entries: [derivedCapacityEntry({ confidence: 'low', conversionConfidence: 'low', derivedAvailableCredits: 36 })] },
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 6,
				estimatedCreditsP90: 8,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: false, code: 'insufficient_budget' });
		expect(result.candidates[0]).toMatchObject({
			derivedCapacityMode: 'derived',
			staticRemainingCredits: null,
		});
		expect(result.candidates[0]?.reasons).toEqual(expect.arrayContaining([
			'derived_capacity_learning',
			'insufficient_budget',
		]));
	});

	it('applies both derived availability and grant caps in hybrid mode', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [{ ...base.providers[0], creditBudgetMode: 'hybrid' }],
				grants: [{ ...base.grants[0], dailyCreditLimit: 10 }],
				derivedCapacity: { entries: [derivedCapacityEntry({ derivedAvailableCredits: 36 })] },
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 11,
				estimatedCreditsP90: 12,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: false, code: 'insufficient_budget' });
		expect(result.candidates[0]).toMatchObject({
			remainingCredits: 10,
			staticRemainingCredits: 10,
			derivedAvailableCredits: 36,
		});
		expect(result.candidates[0]?.reasons).toEqual(expect.arrayContaining([
			'hybrid_derived_capacity_applied',
			'hybrid_static_cap_applied',
			'insufficient_budget',
		]));
	});

	it('caps derived routes by portfolio allocation percentage and reserve pool', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [{ ...base.providers[0], creditBudgetMode: 'derived', dailyCreditBudget: 0, monthlyCreditBudget: 0 }],
				grants: [{
					...base.grants[0],
					dailyCreditLimit: null,
					portfolioAllocationPercent: 50,
					reservePoolPercent: 20,
					metadata: { portfolioAllocationPercent: 50, reservePoolPercent: 20 },
				}],
				derivedCapacity: { entries: [derivedCapacityEntry({ derivedAvailableCredits: 40 })] },
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 16,
				estimatedCreditsP90: 17,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: false, code: 'insufficient_budget' });
		expect(result.candidates[0]).toMatchObject({
			remainingCredits: 16,
			staticRemainingCredits: 16,
			derivedAvailableCredits: 40,
		});
		expect(result.candidates[0]?.reasons).toEqual(expect.arrayContaining([
			'portfolio_allocation_applied',
			'portfolio_allocation_exhausted',
			'insufficient_budget',
		]));
	});

	it('allows explicit emergency override to borrow from the grant reserve pool', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [{ ...base.providers[0], creditBudgetMode: 'derived', dailyCreditBudget: 0, monthlyCreditBudget: 0 }],
				grants: [{
					...base.grants[0],
					dailyCreditLimit: null,
					portfolioAllocationPercent: 50,
					reservePoolPercent: 20,
					emergencyOverride: true,
					metadata: { portfolioAllocationPercent: 50, reservePoolPercent: 20, emergencyOverride: true },
				}],
				derivedCapacity: { entries: [derivedCapacityEntry({ derivedAvailableCredits: 40 })] },
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 16,
				estimatedCreditsP90: 17,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
			metadata: { emergencyOverride: true },
		});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error(result.reason);
		expect(result.remainingCreditsBefore).toBe(20);
		expect(result.capacityMetadata.candidates?.[0]).toMatchObject({
			remainingCredits: 20,
			staticRemainingCredits: 20,
			derivedCapacityMode: 'derived',
		});
	});

	it('falls back to another provider when one native-derived unit is exhausted', () => {
		const base = createCapacityPlan();
		const result = routeAndReserveCapacity({
			plan: createCapacityPlan({
				providers: [
					{ ...base.providers[0], creditBudgetMode: 'derived', dailyCreditBudget: 0, monthlyCreditBudget: 0 },
					{ ...base.providers[0], id: 'provider-2', name: 'OpenRouter budget', creditBudgetMode: 'derived', dailyCreditBudget: 0, monthlyCreditBudget: 0 },
				],
				lanes: [
					base.lanes[0],
					{ ...base.lanes[0], id: 'lane-2', capacityProviderId: 'provider-2', metadata: { nativeUnit: 'usd' } },
				],
				grants: [
					{ ...base.grants[0], id: 'grant-exhausted', dailyCreditLimit: null, overflowPolicy: 'fallback_lane' },
					{ ...base.grants[0], id: 'grant-fallback', capacityProviderId: 'provider-2', dailyCreditLimit: null },
				],
				derivedCapacity: {
					entries: [
						derivedCapacityEntry({ availableNativeAmount: 10, derivedAvailableCredits: 2 }),
						derivedCapacityEntry({
							executionProviderId: 'openrouter-budget-1',
							capacityProviderId: 'provider-2',
							executionProviderKind: 'token_metered_api',
							nativeUnit: 'usd',
							configuredNativeLimit: 3,
							availableNativeAmount: 3,
							nativeUnitsPerCredit: 0.03,
							derivedAvailableCredits: 100,
						}),
					],
				},
			}),
			estimate: reserveCreditsForEstimate({
				taskSignature: 'proposal.draft',
				confidence: 'medium',
				estimatedCreditsP50: 6,
				estimatedCreditsP90: 8,
			}),
			taskKind: 'proposal.draft',
			requiredCapabilities: ['agent_execution'],
		});

		expect(result).toMatchObject({ ok: true });
		if (!result.ok) throw new Error(result.reason);
		expect(result.provider.id).toBe('provider-2');
		expect(result.reservation).toMatchObject({
			executionProviderId: 'openrouter-budget-1',
			nativeUnit: 'usd',
			reservedNativeAmount: 0.24,
		});
		expect(result.candidates.find((candidate) => candidate.providerId === 'provider-1')?.reasons)
			.toEqual(expect.arrayContaining(['derived_capacity_exhausted', 'fallback_lane_exhausted']));
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
