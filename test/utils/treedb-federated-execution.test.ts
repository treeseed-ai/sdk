import { describe, expect, it, vi } from 'vitest';
import { TreeDbApiError, TreeDbClient, TreeDbFederatedClient, TreeDbRegistryClient } from '../../src/treedb/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDB federated execution', () => {
	it('TreeDbClient calls global federated endpoints and unwraps envelopes', async () => {
		const calls: Array<{ url: string; body: unknown }> = [];
		const payloads = [
			{ ok: true, search: { query: 'release', results: [], page: { limit: 20, hasMore: false }, diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } },
			{ ok: true, query: { type: 'text', results: [], page: { limit: 20, hasMore: false }, diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } },
			{ ok: true, context: { nodes: [], edges: [], files: [], sections: [], diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } },
			{ ok: true, graph: { nodes: [], edges: [], diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [], crossRepoEdgeCount: 0 }, errors: [] } },
		];
		const client = new TreeDbClient({
			baseUrl: 'https://treedb.example.test',
			token: 'token',
			fetch: (async (input, init) => {
				calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
				return json(payloads.shift());
			}) as typeof fetch,
		});

		await expect(client.federatedSearch({ repoIds: ['repo_1'], query: 'release' })).resolves.toMatchObject({ query: 'release' });
		await expect(client.federatedQuery({ repoIds: ['repo_1'], type: 'text', query: 'release' })).resolves.toMatchObject({ type: 'text' });
		await expect(client.federatedContext({ repoIds: ['repo_1'], query: 'release' })).resolves.toMatchObject({ nodes: [] });
		await expect(client.federatedGraph({ repoIds: ['repo_1'], query: 'release' })).resolves.toMatchObject({ edges: [] });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedb.example.test/api/v1/search',
			'https://treedb.example.test/api/v1/query',
			'https://treedb.example.test/api/v1/context/build',
			'https://treedb.example.test/api/v1/graph/query',
		]);
		expect(calls[0]?.body).toMatchObject({ repoIds: ['repo_1'], query: 'release' });
	});

	it('TreeDbFederatedClient sends multi-repo query and search to the server federation endpoints', async () => {
		const calls: string[] = [];
		const registry = new TreeDbRegistryClient({
			baseUrl: 'https://registry.example.test',
			token: 'token',
			fetch: (async (input) => {
				calls.push(String(input));
				if (String(input).endsWith('/api/v1/query')) {
					return json({ ok: true, query: { type: 'text', results: [], page: { limit: 20, hasMore: false }, diagnostics: { requestedRepoCount: 2, executedRepoCount: 2, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } });
				}
				return json({ ok: true, search: { query: 'release', results: [], page: { limit: 20, hasMore: false }, diagnostics: { requestedRepoCount: 2, executedRepoCount: 2, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } });
			}) as typeof fetch,
		});
		const federated = new TreeDbFederatedClient({ registry });

		await expect(federated.query({ repoIds: ['repo_1', 'repo_2'], type: 'text', query: 'release' })).resolves.toMatchObject({ type: 'text' });
		await expect(federated.search({ repoIds: ['repo_1', 'repo_2'], query: 'release' })).resolves.toMatchObject({ query: 'release' });

		expect(calls).toEqual([
			'https://registry.example.test/api/v1/query',
			'https://registry.example.test/api/v1/search',
		]);
	});

	it('preserves global endpoint API errors as TreeDbApiError', async () => {
		const client = new TreeDbClient({
			baseUrl: 'https://treedb.example.test',
			token: 'token',
			fetch: (async () => json({ ok: false, error: { code: 'federated_scope_empty', message: 'Denied.', details: { repoIds: 1 } } }, 403)) as typeof fetch,
		});

		await expect(client.federatedSearch({ repoIds: ['repo_hidden'], query: 'secret' })).rejects.toMatchObject({
			name: 'TreeDbApiError',
			code: 'federated_scope_empty',
			status: 403,
			details: { repoIds: 1 },
		});
		await expect(client.federatedSearch({ repoIds: ['repo_hidden'], query: 'secret' })).rejects.toBeInstanceOf(TreeDbApiError);
	});
});
