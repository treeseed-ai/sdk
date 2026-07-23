import { describe, expect, it } from 'vitest';
import {
	ACTUAL_CREDIT_FORMULA_VERSION,
	buildCreditConversionProfileFromActuals,
	calculateActualCredits,
	deriveAvailableCredits,
	nativeUsageAmount,
	nativeUsageUnit,
	resolveNativeAccountingWindow,
	selectCreditConversionProfile,
} from '../../../src/capacity-usage.ts';
import type { CapacityReservation, CapacityUsageActual } from '../../../src/agent-capacity/contracts/financial-records.ts';
import type { CapacityExecutionProvider } from '../../../src/capacity-provider/contracts/index.ts';

const timestamp = '2026-07-17T04:00:00.000Z';

function actual(id: string, credits: number, wallMinutes: number, metadata: Record<string, unknown> = {}): CapacityUsageActual {
	return {
		id, taskId: null, workDayId: null, projectId: 'project-a', taskSignature: 'research', executionProfileId: 'standard-code-model',
		assignmentId: null, modeRunId: null, mode: 'planning',
		capacityProviderId: 'provider-a', executionProviderId: 'codex-a', businessModel: 'subscription', modelName: 'codex',
		laneId: null,
		inputTokens: null, outputTokens: null, cachedInputTokens: null, quotaMinutes: null, wallMinutes,
		filesOpened: null, filesChanged: null, diffLinesAdded: null, diffLinesRemoved: null, testRuns: null, retryCount: null,
		actualCredits: credits, actualUsd: null, creditFormulaVersion: ACTUAL_CREDIT_FORMULA_VERSION,
		actualCreditSource: 'central_calculator', nativeUsage: { nativeUnit: 'wall_minute', wallMinutes }, metadata, createdAt: timestamp,
	};
}

function executionProvider(): CapacityExecutionProvider {
	return {
		schemaVersion: 1, id: 'codex-a', providerId: 'provider-a', displayName: 'Codex', adapter: 'codex', status: 'active',
		capabilities: ['engineering'], nativeUnit: 'wall_minute', quotaVisibility: 'exact', maxConcurrentRunners: 2, nativeLimits: [], metadata: {},
		createdAt: timestamp, updatedAt: timestamp,
	};
}

function reservation(id: string, state: CapacityReservation['state'], nativeAmount: number, updatedAt: string): CapacityReservation {
	return {
		id, idempotencyKey: `idempotency-${id}`, membershipId: 'membership-a', grantId: 'grant-a',
		capacityProviderId: 'provider-a', executionProviderId: 'codex-a', laneId: null,
		allocationSetId: 'allocation-a', allocationVersion: 1, allocationSliceIds: [], policySnapshot: {},
		projectAgentClassId: 'research', assignmentId: `assignment-${id}`, mode: 'planning', teamId: 'team-a', projectId: 'project-a',
		workDayId: null, taskId: null, state, reservedCredits: 2, consumedCredits: state === 'consumed' ? 2 : 0,
		nativeUnit: 'wall_minute', reservedNativeAmount: state === 'reserved' ? nativeAmount : null,
		consumedNativeAmount: state === 'consumed' ? nativeAmount : null, reservedProviderUnits: null,
		consumedProviderUnits: null, reservedUsd: null, consumedUsd: null, expiresAt: null, metadata: {}, createdAt: updatedAt, updatedAt,
	};
}

describe('capacity usage primitives', () => {
	it('normalizes provider-native usage without lane routing', () => {
		expect(nativeUsageUnit({ inputTokens: 100, outputTokens: 50 })).toBe('token');
		expect(nativeUsageAmount({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 25 }, 'token')).toBe(125);
	});

	it('learns a conversion profile from completed actuals and excludes interrupted work', () => {
		const profile = buildCreditConversionProfileFromActuals({
			taskSignature: 'research', executionProviderKind: 'codex', nativeUnit: 'wall_minute',
			actuals: [actual('a', 2, 10), actual('b', 4, 20), actual('c', 1, 5, { interrupted: true })], now: timestamp,
		});
		expect(profile).toMatchObject({ sampleCount: 3, completedSampleCount: 2, interruptedSampleCount: 1, nativeUnitsPerCreditP50: 5 });
		expect(selectCreditConversionProfile({ profiles: [profile], taskSignature: 'research', executionProviderKind: 'codex', nativeUnit: 'wall_minute' })).toBe(profile);
	});

	it('derives credits from observed native capacity after reservations and reserve buffer', () => {
		const result = deriveAvailableCredits({
			executionProvider: executionProvider(),
			nativeLimit: { id: 'limit', executionProviderId: 'codex-a', scope: 'daily', nativeUnit: 'wall_minute', limitAmount: 100, reserveBufferPercent: 10, resetCadence: 'daily', resetAt: null, confidence: 'exact', source: 'configured', createdAt: timestamp, updatedAt: timestamp },
			latestObservation: { id: 'observation', executionProviderId: 'codex-a', observedAt: timestamp, health: 'available', activeRunners: 0, queuedAssignments: 0, throttleState: null, nativeRemaining: { wallMinutes: 80 }, resetAt: null, confidence: 'exact', createdAt: timestamp },
			activeReservations: [reservation('reservation', 'reserved', 10, timestamp)],
			conversionProfile: buildCreditConversionProfileFromActuals({ taskSignature: 'research', executionProviderKind: 'codex', nativeUnit: 'wall_minute', actuals: [actual('a', 2, 10)], now: timestamp }),
		});
		expect(result).toMatchObject({ observedNativeRemaining: 80, activeReservedNativeAmount: 10, reserveBufferNativeAmount: 10, availableNativeAmount: 60, derivedAvailableCredits: 12 });
	});

	it('debits configured capacity only for terminal usage in the current reset window', () => {
		const input = {
			executionProvider: executionProvider(),
			nativeLimit: { id: 'limit', executionProviderId: 'codex-a', scope: 'daily', nativeUnit: 'wall_minute', limitAmount: 100, reserveBufferPercent: 0, resetCadence: 'daily', resetAt: null, confidence: 'exact', source: 'configured', createdAt: timestamp, updatedAt: timestamp },
			activeReservations: [
				reservation('yesterday', 'consumed', 40, '2026-07-16T23:59:00.000Z'),
				reservation('today', 'consumed', 15, '2026-07-17T02:00:00.000Z'),
				reservation('reserved', 'reserved', 10, '2026-07-17T03:00:00.000Z'),
			],
			conversionProfile: buildCreditConversionProfileFromActuals({ taskSignature: 'research', executionProviderKind: 'codex', nativeUnit: 'wall_minute', actuals: [actual('a', 2, 10)], now: timestamp }),
			now: timestamp,
		};
		expect(resolveNativeAccountingWindow(input)).toMatchObject({
			startAt: '2026-07-17T00:00:00.000Z', endAt: '2026-07-18T00:00:00.000Z', source: 'configured_reset', known: true,
		});
		expect(deriveAvailableCredits(input)).toMatchObject({
			activeReservedNativeAmount: 10,
			activeConsumedNativeAmount: 15,
			availableNativeAmount: 75,
			derivedAvailableCredits: 15,
			accountingWindowSource: 'configured_reset',
		});
	});

	it('uses an observation boundary and fails closed when configured reset policy is unknown', () => {
		const profile = buildCreditConversionProfileFromActuals({ taskSignature: 'research', executionProviderKind: 'codex', nativeUnit: 'wall_minute', actuals: [actual('a', 2, 10)], now: timestamp });
		const observed = deriveAvailableCredits({
			executionProvider: executionProvider(),
			latestObservation: { id: 'observation', executionProviderId: 'codex-a', observedAt: '2026-07-17T02:00:00.000Z', health: 'available', activeWorkers: 0, queuedTasks: 0, throttleState: null, nativeRemaining: { wallMinutes: 80 }, resetAt: null, confidence: 'exact', createdAt: timestamp },
			activeReservations: [
				reservation('before-observation', 'consumed', 30, '2026-07-17T01:00:00.000Z'),
				reservation('after-observation', 'consumed', 5, '2026-07-17T03:00:00.000Z'),
			],
			conversionProfile: profile,
			now: timestamp,
		});
		expect(observed).toMatchObject({ activeConsumedNativeAmount: 5, availableNativeAmount: 75, accountingWindowSource: 'observation' });

		const unknown = deriveAvailableCredits({
			executionProvider: { ...executionProvider(), resetCadence: 'opaque' },
			nativeLimit: { id: 'opaque', executionProviderId: 'codex-a', scope: 'session', nativeUnit: 'wall_minute', limitAmount: 100, reserveBufferPercent: 0, resetCadence: 'opaque', resetAt: null, confidence: 'opaque', source: 'configured', createdAt: timestamp, updatedAt: timestamp },
			conversionProfile: profile,
			now: timestamp,
		});
		expect(unknown).toMatchObject({ availableNativeAmount: 0, derivedAvailableCredits: null, accountingWindowSource: 'unknown', confidence: 'low' });
		expect(unknown.reasons).toContain('native_accounting_window_unknown');
	});

	it('accepts explicit session and rolling-window boundaries', () => {
		const window = resolveNativeAccountingWindow({
			executionProvider: { ...executionProvider(), resetCadence: 'session' },
			nativeLimit: {
				id: 'session', executionProviderId: 'codex-a', scope: 'session', nativeUnit: 'wall_minute', limitAmount: 100,
				reserveBufferPercent: 0, resetCadence: 'session', resetAt: '2026-07-17T08:00:00.000Z', confidence: 'exact',
				source: 'configured', metadata: { windowStartAt: '2026-07-17T00:30:00.000Z' }, createdAt: timestamp, updatedAt: timestamp,
			},
			now: timestamp,
		});
		expect(window).toEqual({
			startAt: '2026-07-17T00:30:00.000Z',
			endAt: '2026-07-17T08:00:00.000Z',
			source: 'configured_reset',
			known: true,
		});
	});

	it('calculates actual credits centrally and preserves the formula version', () => {
		const calculated = calculateActualCredits({ wallMinutes: 11, filesChanged: 2, testRuns: 1 });
		expect(calculated).toMatchObject({ actualCredits: 8, source: 'central_calculator', formulaVersion: ACTUAL_CREDIT_FORMULA_VERSION });
	});
});
