import { describe, expect, it } from 'vitest';
import { TreeDxClient, TreeDxGraphAdapter } from '../../../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDX graph parity surface', () => {
	it('exposes refresh job metadata and adapter-compatible graph shapes', async () => {
		const calls: Array<{ url: string; body?: unknown }> = [];
		const payloads = [
			{
				ok: true,
				ready: true,
				repoId: 'repo_1',
				ref: 'refs/heads/main',
				resolvedRef: 'abc',
				graphVersion: 'graph_1',
				jobId: 'grjob_1',
				refreshMode: 'incremental',
				changedPathCount: 1,
				indexedPathCount: 1,
				stale: false,
			},
			{
				ok: true,
				job: {
					jobId: 'grjob_1',
					repoId: 'repo_1',
					ref: 'refs/heads/main',
					requestedPaths: ['docs/**'],
					changedPaths: ['docs/readme.md'],
					graphVersion: 'graph_1',
					refreshMode: 'incremental',
					stale: false,
					status: 'completed',
					startedAt: '2026-06-01T00:00:00Z',
					indexedPathCount: 1,
					removedPathCount: 0,
				},
			},
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', results: [{ node: { id: 'file:1', nodeType: 'File' }, score: 1, reason: 'lexical:file' }] },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], nodes: [{ node: { id: 'file:1', nodeType: 'File' }, score: 1, depth: 0, reasons: [] }], edges: [], providerId: 'treedx-graph-mvp' },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedId: 'file:1', nodes: [{ node: { id: 'file:1', nodeType: 'File' }, score: 1, depth: 0, reasons: [] }], edges: [] },
		];
		const client = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'token',
			repoId: 'repo_1',
			fetch: (async (input, init) => {
				calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
				return json(payloads.shift());
			}) as typeof fetch,
		});
		const adapter = new TreeDxGraphAdapter({ client, repoId: 'repo_1', defaultRef: 'refs/heads/main' });

		const refresh = await adapter.refresh({ incremental: true, changedPaths: ['docs/readme.md'] });
		expect(refresh).toMatchObject({ ready: true, jobId: 'grjob_1', refreshMode: 'incremental' });
		await expect(client.getGraphRefreshJob({ jobId: 'grjob_1' })).resolves.toMatchObject({ status: 'completed' });
		await expect(adapter.searchFiles('release')).resolves.toHaveLength(1);
		await expect(adapter.queryGraph({ query: 'release' })).resolves.toMatchObject({ providerId: 'treedx-graph-mvp' });
		await expect(adapter.getRelated('file:1')).resolves.toMatchObject({ seedId: 'file:1' });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos/repo_1/graph/refresh',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/refresh-jobs/grjob_1',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/search-files',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/query',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/related',
		]);
	});
});
