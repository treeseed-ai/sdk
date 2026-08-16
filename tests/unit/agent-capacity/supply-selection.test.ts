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

	it('uses the provider default when team policy does not prefer another eligible provider', () => {
		const result = selectCapacitySupply({
			policy: { ...policy, preferredExecutionProviderIds: undefined },
			requiredCapabilities: ['agent-execution'],
			candidates: [candidate('codex-key'), candidate('codex-sub', { preferred: true })],
		});
		expect(result.selected?.executionProviderId).toBe('codex-sub');
	});

	it('lets explicit team policy override the provider default', () => {
		const result = selectCapacitySupply({
			policy: { ...policy, preferredExecutionProviderIds: ['codex-key'] },
			requiredCapabilities: ['agent-execution'],
			candidates: [candidate('codex-sub', { preferred: true }), candidate('codex-key')],
		});
		expect(result.selected?.executionProviderId).toBe('codex-key');
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

	it('rejects an execution provider when the assignment window is shorter than its declared minimum', () => {
		const result = selectCapacitySupply({
			policy,
			requiredCapabilities: ['agent-execution'],
			assignmentWindow: { startedAt: '2026-08-14T12:00:00.000Z', durationSeconds: 599 },
			candidates: [candidate('codex', { minimumAssignmentDuration: { amount: 600, unit: 'seconds' } })],
		});
		expect(result.selected).toBeNull();
		expect(result.rejected[0]?.reasons).toContain('assignment_duration_below_provider_minimum');
	});

	it('evaluates business-day minimums against the actual start date', () => {
		const result = selectCapacitySupply({
			policy,
			requiredCapabilities: ['agent-execution'],
			assignmentWindow: { startedAt: '2026-08-14T12:00:00.000Z', durationSeconds: 5 * 86_400 },
			candidates: [candidate('human-queue', { minimumAssignmentDuration: {
				amount: 5, unit: 'business-days', calendar: { timeZone: 'America/New_York' },
			} })],
		});
		expect(result.selected).toBeNull();
		expect(result.rejected[0]?.reasons).toContain('assignment_duration_below_provider_minimum');
	});
});
