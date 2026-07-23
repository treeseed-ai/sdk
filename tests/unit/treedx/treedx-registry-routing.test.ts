import { describe, expect, it, vi } from 'vitest';
import { TreeDxFederatedClient, TreeDxRegistryClient } from '../../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDX registry and federated clients', () => {
	it('lists nodes and resolves repository placements', async () => {
		const calls: string[] = [];
		const registry = new TreeDxRegistryClient({
			baseUrl: 'https://registry.example.test',
			token: 'token',
			fetch: (async (input) => {
				calls.push(String(input));
				if (String(input).endsWith('/registry/nodes')) {
					return json({ ok: true, nodes: [{ id: 'node_a', baseUrl: 'https://node-a.example.test', role: 'primary', health: 'healthy' }] });
				}
				return json({ ok: true, placement: { repoId: 'repo_1', primaryNodeId: 'node_a', mirrorNodeIds: [], readPolicy: 'primary', writePolicy: 'primary', migrationState: 'stable' } });
			}) as typeof fetch,
		});

		expect(await registry.listNodes()).toHaveLength(1);
		expect(await registry.resolveRepository('repo_1')).toMatchObject({ primaryNodeId: 'node_a' });
		expect(await registry.resolveRepositories(['repo_1', 'repo_2'])).toHaveLength(2);
		expect(calls).toContain('https://registry.example.test/api/v1/registry/nodes');
	});

	it('routes single-repository federated reads to the primary node', async () => {
		const calls: string[] = [];
		const registry = new TreeDxRegistryClient({
			baseUrl: 'https://registry.example.test',
			token: 'registry-token',
			fetch: (async () => json({ ok: true, placement: { repoId: 'repo_1', primaryNodeId: 'node_a', mirrorNodeIds: [], readPolicy: 'primary', writePolicy: 'primary', migrationState: 'stable' } })) as typeof fetch,
		});
		const federated = new TreeDxFederatedClient({
			registry,
			token: 'node-token',
			nodeBaseUrls: { node_a: 'https://node-a.example.test' },
			fetch: (async (input) => {
				calls.push(String(input));
				return json({ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] });
			}) as typeof fetch,
		});

		const result = await federated.query({ repoId: 'repo_1', type: 'text', query: 'release' });
		expect(result.diagnostics).toMatchObject({ requestedRepoCount: 1, executedRepoCount: 1 });
		expect(calls).toEqual(['https://node-a.example.test/api/v1/repos/repo_1/query']);
	});

	it('throws for unknown nodes and routes multi-repo fan-out through server federation', async () => {
		const calls: string[] = [];
		const registry = new TreeDxRegistryClient({
			baseUrl: 'https://registry.example.test',
			token: 'token',
			fetch: (async (input) => {
				calls.push(String(input));
				if (String(input).endsWith('/registry/nodes')) {
					return json({ ok: true, nodes: [] });
				}
				if (String(input).endsWith('/api/v1/query')) {
					return json({ ok: true, query: { type: 'text', results: [], page: { limit: 20, hasMore: false }, diagnostics: { requestedRepoCount: 2, executedRepoCount: 0, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } });
				}
				if (String(input).endsWith('/api/v1/search')) {
					return json({ ok: true, search: { query: 'release', results: [], page: { limit: 20, hasMore: false }, diagnostics: { requestedRepoCount: 2, executedRepoCount: 0, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } });
				}
				return json({ ok: true, placement: { repoId: 'repo_1', primaryNodeId: 'missing', mirrorNodeIds: [], readPolicy: 'primary', writePolicy: 'primary', migrationState: 'stable' } });
			}) as typeof fetch,
		});
		const federated = new TreeDxFederatedClient({ registry });
		await expect(federated.resolveRepository('repo_1')).rejects.toMatchObject({ code: 'node_not_configured' });
		await expect(federated.query({ repoIds: ['repo_1', 'repo_2'], type: 'text' })).resolves.toMatchObject({ type: 'text' });
		await expect(federated.search({ repoIds: ['repo_1', 'repo_2'], query: 'release' })).resolves.toMatchObject({ query: 'release' });
		expect(calls).toContain('https://registry.example.test/api/v1/query');
		expect(calls).toContain('https://registry.example.test/api/v1/search');
	});
});
