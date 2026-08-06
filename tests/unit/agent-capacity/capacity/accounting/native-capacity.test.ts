import { describe,expect,it } from 'vitest';
import { deriveNativeCapacity,nativeUsageAmount,nativeUsageUnit,resolveNativeAccountingWindow } from '../../../../../src/capacity/accounting/native-capacity.ts';
import type { CapacityExecutionProvider } from '../../../../../src/capacity-provider/contracts/index.ts';

const timestamp = '2026-07-17T04:00:00.000Z';

function provider(): CapacityExecutionProvider {
	return {
		schemaVersion: 1, id: 'codex-a', providerId: 'provider-a', capacityProviderId: 'provider-a', displayName: 'Codex', kind: 'codex', adapter: 'codex', status: 'active',
		capabilities: ['engineering'], nativeUnit: 'wall_minute', quotaVisibility: 'exact', maxConcurrentRunners: 2, nativeLimits: [], metadata: {}, createdAt: timestamp, updatedAt: timestamp,
	} as CapacityExecutionProvider;
}

function input() {
	return {
		executionProvider: provider(),
		nativeLimit: { id: 'daily', executionProviderId: 'codex-a', scope: 'daily', nativeUnit: 'wall_minute', limitAmount: 100, reserveBufferPercent: 10, resetCadence: 'daily', resetAt: null, confidence: 'exact', source: 'configured', createdAt: timestamp, updatedAt: timestamp },
		latestObservation: { id: 'observation', executionProviderId: 'codex-a', observedAt: timestamp, health: 'available', activeRunners: 0, queuedAssignments: 0, throttleState: null, nativeRemaining: { wallMinutes: 80 }, resetAt: null, confidence: 'exact', createdAt: timestamp },
		reservationDebits: { activeReservedNativeAmount: 10, activeConsumedNativeAmount: 5 },
		now: timestamp,
	};
}

describe('native capacity accounting', () => {
	it('keeps tokens and provider-native units dimensional', () => {
		expect(nativeUsageUnit({ inputTokens: 100, outputTokens: 50 })).toBe('token');
		expect(nativeUsageAmount({ inputTokens: 100, outputTokens: 50, cachedInputTokens: 25 }, 'token')).toBe(125);
	});

	it('subtracts native reservations, settled usage, and the provider reserve without producing seconds', () => {
		const result = deriveNativeCapacity(input());
		expect(result).toMatchObject({ observedNativeRemaining: 80, activeReservedNativeAmount: 10, activeConsumedNativeAmount: 5, reserveBufferNativeAmount: 10, availableNativeAmount: 55 });
		expect(result).not.toHaveProperty('derivedAvailableSeconds');
	});

	it('uses explicit accounting windows and fails closed when a provider reset is opaque', () => {
		expect(resolveNativeAccountingWindow(input())).toMatchObject({ startAt: timestamp, source: 'observation', known: true });
		const result = deriveNativeCapacity({ executionProvider: { ...provider(), resetCadence: 'opaque' }, nativeLimit: { ...input().nativeLimit, scope: 'session', resetCadence: 'opaque', confidence: 'opaque' }, latestObservation: null, now: timestamp });
		expect(result).toMatchObject({ availableNativeAmount: 0, accountingWindowSource: 'unknown', confidence: 'low' });
		expect(result.reasons).toContain('native_accounting_window_unknown');
	});
});
