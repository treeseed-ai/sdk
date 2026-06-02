import { describe, expect, it, vi } from 'vitest';
import { TreeDbApiError, TreeDbFederatedClient, TreeDbRegistryClient } from '../../src/treedb/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDB registry and federated clients', () => {
	it('lists nodes and resolves repository placements', async () => {
		const calls: string[] = [];
		const registry = new TreeDbRegistryClient({
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
		const registry = new TreeDbRegistryClient({
			baseUrl: 'https://registry.example.test',
			token: 'registry-token',
			fetch: (async () => json({ ok: true, placement: { repoId: 'repo_1', primaryNodeId: 'node_a', mirrorNodeIds: [], readPolicy: 'primary', writePolicy: 'primary', migrationState: 'stable' } })) as typeof fetch,
		});
		const federated = new TreeDbFederatedClient({
			registry,
			token: 'node-token',
			nodeBaseUrls: { node_a: 'https://node-a.example.test' },
			fetch: (async (input) => {
				calls.push(String(input));
				return json({ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] });
			}) as typeof fetch,
		});

		const result = await federated.query({ repoId: 'repo_1', type: 'text', query: 'release' });
		expect(result.results[0]?.repoId).toBe('repo_1');
		expect(calls).toEqual(['https://node-a.example.test/api/v1/repos/repo_1/query']);
	});

	it('throws for unknown nodes and multi-repo fan-out in Phase 7', async () => {
		const registry = new TreeDbRegistryClient({
			baseUrl: 'https://registry.example.test',
			token: 'token',
			fetch: (async (input) => {
				if (String(input).endsWith('/registry/nodes')) {
					return json({ ok: true, nodes: [] });
				}
				return json({ ok: true, placement: { repoId: 'repo_1', primaryNodeId: 'missing', mirrorNodeIds: [], readPolicy: 'primary', writePolicy: 'primary', migrationState: 'stable' } });
			}) as typeof fetch,
		});
		const federated = new TreeDbFederatedClient({ registry });
		await expect(federated.resolveRepository('repo_1')).rejects.toMatchObject({ code: 'node_not_configured' });
		await expect(federated.query({ repoIds: ['repo_1', 'repo_2'], type: 'text' })).rejects.toMatchObject({
			code: 'federated_query_not_implemented',
			status: 501,
		});
		await expect(federated.search({ repoIds: ['repo_1', 'repo_2'], query: 'release' })).rejects.toBeInstanceOf(TreeDbApiError);
	});
});
