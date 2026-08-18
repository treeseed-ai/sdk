import { describe, expect, it, vi } from 'vitest';
import { TreeDxFederatedClient, TreeDxRegistryClient } from '../../../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => payload,
	} as Response;
}

describe('TreeDX federation planning', () => {
	it('uses the registry/control client and does not fan out to nodes', async () => {
		const calls: string[] = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith('/federation/query/plan')) {
				return json({
					ok: true,
					requestedScope: {},
					effectiveScope: { repos: [{ repoId: 'repo_a' }] },
					rejected: [],
					executable: false,
					reason: 'planner_only_mvp',
				});
			}
			throw new Error(`unexpected request: ${url}`);
		});
		const registry = new TreeDxRegistryClient({
			baseUrl: 'https://registry.example.test',
			token: 'token',
			fetch: fetchMock,
		});
		const federated = new TreeDxFederatedClient({
			registry,
			nodeBaseUrls: { node_a: 'https://node-a.example.test' },
		});

		const plan = await federated.planQuery({ repoIds: ['repo_a'], capabilities: ['files:search'] });
		expect(plan.effectiveScope).toMatchObject({ repos: [{ repoId: 'repo_a' }] });
		expect(calls).toEqual(['https://registry.example.test/api/v1/federation/query/plan']);
	});
});
