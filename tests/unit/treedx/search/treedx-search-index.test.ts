import { describe, expect, it } from 'vitest';
import { TreeDxClient } from '../../../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

describe('TreeDX search index client', () => {
	it('calls refresh, status, and compact endpoints and unwraps payloads', async () => {
		const calls: Array<{ url: string; body?: unknown }> = [];
		const payloads = [
			{ ok: true, index: { repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', indexVersion: 'sidx_1', segmentIds: ['sseg_1'], indexedPathCount: 2, stale: false } },
			{ ok: true, index: { repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', ready: true, indexVersion: 'sidx_1', segmentIds: ['sseg_1'], indexedPathCount: 2, segmentCount: 1, stale: false } },
			{ ok: true, compact: { repoId: 'repo_1', ref: 'refs/heads/main', planOnly: true, segmentsBefore: 2, segmentsAfter: 1, compacted: false } },
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

		await expect(client.refreshSearchIndex({ paths: ['docs/**'] })).resolves.toMatchObject({ indexVersion: 'sidx_1' });
		await expect(client.getSearchIndexStatus({ ref: 'refs/heads/main' })).resolves.toMatchObject({ ready: true });
		await expect(client.compactSearchIndex({ planOnly: true })).resolves.toMatchObject({ segmentsAfter: 1 });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos/repo_1/search/index/refresh',
			'https://treedx.example.test/api/v1/repos/repo_1/search/index/status?ref=refs%2Fheads%2Fmain',
			'https://treedx.example.test/api/v1/repos/repo_1/search/index/compact',
		]);
		expect(calls[0]?.body).toEqual({ paths: ['docs/**'] });
		expect(calls[2]?.body).toEqual({ planOnly: true });
	});
});
