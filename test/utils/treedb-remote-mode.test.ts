import { describe, expect, it } from 'vitest';
import { AgentSdk } from '../../src/sdk.ts';
import type { SdkModelRegistry } from '../../src/sdk-types.ts';

function registry(): SdkModelRegistry {
	return {
		knowledge: {
			name: 'knowledge',
			aliases: ['knowledge'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: { key: 'title', contentKeys: ['title'], filterable: true, sortable: true },
				slug: { key: 'slug', contentKeys: ['slug'], filterable: true },
				updated_at: { key: 'updated_at', aliases: ['updatedAt'], contentKeys: ['updated_at', 'updatedAt'], filterable: true, sortable: true },
			},
			filterableFields: ['title', 'slug', 'updated_at'],
			sortableFields: ['title', 'updated_at'],
			pickField: 'updated_at',
			contentDir: '/not/a/local/clone/src/content/knowledge',
		},
	};
}

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function remoteSdk(payloads: unknown[]) {
	const calls: Array<{ url: string; body?: unknown; authorization?: string }> = [];
	const sdk = new AgentSdk({
		modelRegistry: registry(),
		treeDb: {
			enabled: true,
			baseUrl: 'https://treedb.example.test',
			token: 'token-123',
			repoId: 'repo_1',
			contentPathMap: { knowledge: 'docs/knowledge' },
			registryRouting: true,
		},
	});
	const client = sdk.treeDb!.client as { fetchImpl?: typeof fetch };
	client.fetchImpl = (async (input, init) => {
		calls.push({
			url: String(input),
			body: init?.body ? JSON.parse(String(init.body)) : undefined,
			authorization: (init?.headers as Record<string, string> | undefined)?.authorization,
		});
		return json(payloads.shift() ?? { ok: true });
	}) as typeof fetch;
	return { sdk, calls };
}

describe('AgentSdk TreeDB remote mode', () => {
	it('constructs no-clone TreeDB mode from baseUrl token and repoId', () => {
		const { sdk } = remoteSdk([]);
		expect(sdk.treeDb?.client.baseUrl).toBe('https://treedb.example.test');
		expect(sdk.treeDb?.registry).toBeDefined();
		expect(sdk.treeDb?.federated).toBeDefined();
		expect(sdk.repoRoot).toBe(process.cwd());
	});

	it('rejects no-clone mode without explicit model metadata', () => {
		expect(() => new AgentSdk({
			treeDb: {
				enabled: true,
				baseUrl: 'https://treedb.example.test',
				token: 'token',
				repoId: 'repo_1',
			},
		})).toThrow(/models or modelRegistry/iu);
	});

	it('runs no-clone read search write graph context snapshot artifact and federated calls', async () => {
		const { sdk, calls } = remoteSdk([
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', file: { path: 'docs/knowledge/guide.md', frontmatter: { title: 'Guide', slug: 'guide' }, body: 'Read' } },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [{ path: 'docs/knowledge/guide.md', frontmatter: { title: 'Guide', slug: 'guide' }, body: 'Read' }] },
			{ ok: true, workspaceId: 'ws_1', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready', allowedPaths: ['docs/knowledge/**'] },
			{ ok: true, file: { path: 'docs/knowledge/new.md', sha: 'blake3:new' } },
			{ ok: true, repoId: 'repo_1', workspaceId: 'ws_1', branchName: 'refs/heads/agent/knowledge-new', commitSha: 'def', changedPaths: ['docs/knowledge/new.md'], status: 'committed' },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/agent/knowledge-new', resolvedRef: 'def', file: { path: 'docs/knowledge/new.md', frontmatter: { title: 'New', slug: 'new' }, body: 'Created' } },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], nodes: [], edges: [], providerId: 'treedb-graph-mvp' },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], totalTokenEstimate: 0, includedNodeIds: [], nodes: [], edges: [] },
			{ ok: true, snapshot: { snapshotId: 'snap_1', repoId: 'repo_1', ref: 'refs/heads/main', commitSha: 'abc', kind: 'repository_snapshot', includedPaths: [], fileCount: 0, totalBytes: 0, checksums: {}, createdAt: '2026-06-03T00:00:00Z' } },
			{ ok: true, artifact: { artifactId: 'art_1', snapshotId: 'snap_1', repoId: 'repo_1', format: 'tar.zst', size: 1, checksum: 'blake3:1', uri: 'treedb://artifact/art_1' } },
			{ ok: true, search: { query: 'guide', results: [], page: { limit: 20, hasMore: false, cursor: null }, diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } },
			{ ok: true, query: { type: 'text', results: [], page: { limit: 20, hasMore: false, cursor: null }, diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } },
		]);

		expect((await sdk.get({ model: 'knowledge', slug: 'guide' })).payload).toMatchObject({ slug: 'guide' });
		expect((await sdk.search({ model: 'knowledge', limit: 1 })).payload).toHaveLength(1);
		expect((await sdk.create({ model: 'knowledge', actor: 'agent', data: { slug: 'new', title: 'New', body: 'Created' } })).payload.item.slug).toBe('new');
		expect((await sdk.treeDb!.graph.queryGraph({ query: 'guide' })).providerId).toBe('treedb-graph-mvp');
		expect((await sdk.treeDb!.graph.buildContextPack({ query: 'guide' })).totalTokenEstimate).toBe(0);
		expect((await sdk.treeDb!.client.buildSnapshot()).snapshotId).toBe('snap_1');
		expect((await sdk.treeDb!.client.exportArtifact()).artifactId).toBe('art_1');
		expect((await sdk.treeDb!.federated!.federatedSearch({ repoIds: ['repo_1'], query: 'guide' })).query).toBe('guide');
		expect((await sdk.treeDb!.federated!.federatedQuery({ repoIds: ['repo_1'], type: 'text', query: 'guide' })).type).toBe('text');
		expect(calls.every((call) => call.authorization === 'Bearer token-123')).toBe(true);
		expect(calls.map((call) => call.url)).toContain('https://treedb.example.test/api/v1/repos/repo_1/files/read');
	});
});
