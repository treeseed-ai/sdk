import { describe, expect, it, vi } from 'vitest';
import { listSeedCapacityAllocationSets, listSeedCapacityGrants, seedAllocationActivationKey, seedAllocationDesiredId, seedAllocationMatchesProjects, seedAllocationRevisionId, selectSeedExecutionProviders } from '../../../../src/seeds/runtime/local-capacity.ts';

describe('local seed capacity reconciliation', () => {
	it('reads every grant and allocation history page before reconciling', async () => {
		const page = (kind: 'grant' | 'allocation') => vi.fn(async (_teamId: string, input: { cursor?: string }) => ({ payload: {
			items: [{ id: `${kind}-${input.cursor ?? 'first'}` }],
			page: input.cursor ? { hasMore: false, nextCursor: null } : { hasMore: true, nextCursor: 'second' },
		} }));
		const capacityGrants = page('grant');
		const capacityAllocationSets = page('allocation');
		const client = { capacityGrants, capacityAllocationSets } as any;

		expect(await listSeedCapacityGrants(client, 'team-a')).toEqual([{ id: 'grant-first' }, { id: 'grant-second' }]);
		expect(await listSeedCapacityAllocationSets(client, 'team-a')).toEqual([{ id: 'allocation-first' }, { id: 'allocation-second' }]);
		expect(capacityGrants).toHaveBeenCalledTimes(2);
		expect(capacityAllocationSets).toHaveBeenCalledTimes(2);
	});
	it('binds allocation activation idempotency to the expected active allocation', () => {
		expect(seedAllocationActivationKey('allocation-1', null)).toBe('seed-runtime:allocation-1:activate:none');
		expect(seedAllocationActivationKey('allocation-1', 'prior-1')).toBe('seed-runtime:allocation-1:activate:prior-1');
		expect(seedAllocationActivationKey('allocation-1', 'prior-2')).not.toBe(seedAllocationActivationKey('allocation-1', 'prior-1'));
	});

	it('creates a deterministic new allocation identity instead of reactivating terminal policy', () => {
		expect(seedAllocationRevisionId('provider-1', 'active-1')).toBe(seedAllocationRevisionId('provider-1', 'active-1'));
		expect(seedAllocationRevisionId('provider-1', 'active-2')).not.toBe(seedAllocationRevisionId('provider-1', 'active-1'));
	});

	it('shares exact team project allocation state across capacity providers', () => {
		expect(seedAllocationDesiredId('team-a', ['project-b', 'project-a'])).toBe(seedAllocationDesiredId('team-a', ['project-a', 'project-b']));
		expect(seedAllocationMatchesProjects({
			status: 'active', reservePolicy: { percent: 0, overflow: 'deny' }, slices: ['project-a', 'project-b'].map((targetId) => ({
				targetId, policy: { minPercent: 0, targetPercent: 50, maxPercent: 100, hardCapPercent: 100 },
			})),
		}, ['project-b', 'project-a'])).toBe(true);
	});

	it('rejects seed execution-provider ids absent from the provider manifest', () => {
		const provider = { key: 'capacity-provider:team/agents', manifest: 'agents.yaml', executionProviderIds: ['codex-sub', 'legacy-codex'] };
		const manifest = { executionProviders: [{ id: 'codex-sub' }] };
		expect(() => selectSeedExecutionProviders(provider as never, manifest as never))
			.toThrow('references execution providers absent from agents.yaml: legacy-codex');
	});

	it('enriches selected runtime providers without mutating source manifest identity', () => {
		const provider = { key: 'capacity-provider:team/agents', manifest: 'agents.yaml', executionProviderIds: ['codex-sub'] };
		const manifest = { executionProviders: [{ id: 'codex-sub', capabilities: ['base'] }] };
		const selected = selectSeedExecutionProviders(provider as never, manifest as never);
		selected[0]!.capabilities.push('discovered');
		expect(manifest.executionProviders[0]!.capabilities).toEqual(['base']);
	});
});
