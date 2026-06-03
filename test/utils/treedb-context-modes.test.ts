import { describe, expect, it } from 'vitest';
import { TreeDbClient } from '../../src/treedb/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDB context modes', () => {
	it('sends context mode and preserves budget diagnostics on low-level client', async () => {
		const calls: Array<{ url: string; body?: unknown }> = [];
		const client = new TreeDbClient({
			baseUrl: 'https://treedb.example.test',
			token: 'token',
			repoId: 'repo_1',
			fetch: (async (input, init) => {
				calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
				return json({
					ok: true,
					repoId: 'repo_1',
					graphVersion: 'graph_1',
					mode: 'citations',
					seedIds: [],
					totalTokenEstimate: 12,
					includedNodeIds: [],
					nodes: [],
					edges: [],
					diagnostics: {
						mode: 'citations',
						budget: {
							requestedMaxNodes: 2,
							usedNodes: 1,
							requestedMaxTokens: 80,
							estimatedTokens: 12,
							truncated: false,
						},
						provenancePaths: ['docs/readme.md'],
					},
				});
			}) as typeof fetch,
		});

		const result = await client.buildContext({
			mode: 'citations',
			query: 'release',
			budget: { maxNodes: 2, maxTokens: 80 },
		});

		expect(calls[0]?.url).toBe('https://treedb.example.test/api/v1/repos/repo_1/context/build');
		expect(calls[0]?.body).toMatchObject({ mode: 'citations', budget: { maxNodes: 2, maxTokens: 80 } });
		expect(result.diagnostics?.budget?.estimatedTokens).toBe(12);
		expect(result.diagnostics?.provenancePaths).toEqual(['docs/readme.md']);
	});
});
