import { describe, expect, it } from 'vitest';
import {
	CAPACITY_SUPPLY_POLICY_CONTRACT,
	selectCapacitySupply,
	type CapacitySupplyCandidate,
} from '../../../src/agent-capacity/index.ts';

const candidate = (executionProviderId: string, overrides: Partial<CapacitySupplyCandidate> = {}): CapacitySupplyCandidate => ({
	capacityProviderId: 'capacity:one', membershipId: 'membership:one', providerSessionId: 'session:one', grantId: 'grant:one',
	executionProviderId, status: 'available', capabilities: ['agent-execution'], reliability: 1,
	pressure: 'normal', availableConcurrency: 1, estimatedCost: null, ...overrides,
});

const policy = {
	contract: CAPACITY_SUPPLY_POLICY_CONTRACT,
	generation: 1,
	reliabilityFloor: 0.8,
	maxFailovers: 2,
	allowPlanningFailover: true,
	allowActingFailover: false,
	preferredExecutionProviderIds: ['preferred'],
};

describe('capacity supply selection', () => {
	it('matches capability first and ranks reliability before team preference', () => {
		const result = selectCapacitySupply({
			policy,
			requiredCapabilities: ['agent-execution'],
			candidates: [candidate('preferred', { reliability: 0.9 }), candidate('reliable', { reliability: 0.99 })],
		});
		expect(result.selected?.executionProviderId).toBe('reliable');
	});

	it('uses team preference only to break equally reliable eligible supply', () => {
		const result = selectCapacitySupply({
			policy,
			requiredCapabilities: ['agent-execution'],
			candidates: [candidate('other'), candidate('preferred')],
		});
		expect(result.selected?.executionProviderId).toBe('preferred');
	});

	it('reports unavailable, exhausted, unreliable, and incapable supply', () => {
		const result = selectCapacitySupply({
			policy,
			requiredCapabilities: ['repository-write'],
			candidates: [candidate('blocked', { reliability: 0.5, pressure: 'exhausted' })],
		});
		expect(result.selected).toBeNull();
		expect(result.rejected[0]?.reasons).toEqual(expect.arrayContaining([
			'pressure:exhausted', 'reliability_below_floor', 'missing_capability:repository-write',
		]));
	});
});
