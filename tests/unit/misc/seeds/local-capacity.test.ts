import { describe, expect, it } from 'vitest';
import { seedAllocationActivationKey, seedAllocationRevisionId } from '../../../../src/seeds/runtime/local-capacity.ts';

describe('local seed capacity reconciliation', () => {
	it('binds allocation activation idempotency to the expected active allocation', () => {
		expect(seedAllocationActivationKey('allocation-1', null)).toBe('seed-runtime:allocation-1:activate:none');
		expect(seedAllocationActivationKey('allocation-1', 'prior-1')).toBe('seed-runtime:allocation-1:activate:prior-1');
		expect(seedAllocationActivationKey('allocation-1', 'prior-2')).not.toBe(seedAllocationActivationKey('allocation-1', 'prior-1'));
	});

	it('creates a deterministic new allocation identity instead of reactivating terminal policy', () => {
		expect(seedAllocationRevisionId('provider-1', 'active-1')).toBe(seedAllocationRevisionId('provider-1', 'active-1'));
		expect(seedAllocationRevisionId('provider-1', 'active-2')).not.toBe(seedAllocationRevisionId('provider-1', 'active-1'));
	});
});
