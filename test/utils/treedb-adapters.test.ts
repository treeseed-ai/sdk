import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { AgentSdk } from '../../src/sdk.ts';
import type { SdkModelRegistry } from '../../src/sdk-types.ts';
import {
	TreeDbApiError,
	TreeDbClient,
	TreeDbGraphAdapter,
	TreeDbRepositoryAdapter,
	resolveContentDir,
} from '../../src/treedb/index.ts';

function registry(root = 'src/content'): SdkModelRegistry {
	return {
		knowledge: {
			name: 'knowledge',
			aliases: ['knowledge'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: { key: 'title', contentKeys: ['title'], filterable: true, sortable: true },
				status: { key: 'status', contentKeys: ['status'], filterable: true },
				updated_at: { key: 'updated_at', aliases: ['updatedAt'], contentKeys: ['updated_at', 'updatedAt'], filterable: true, sortable: true },
				created_at: { key: 'created_at', aliases: ['createdAt'], contentKeys: ['created_at', 'createdAt'] },
				slug: { key: 'slug', contentKeys: ['slug'], filterable: true },
			},
			filterableFields: ['title', 'status', 'updated_at', 'slug'],
			sortableFields: ['title', 'updated_at'],
			pickField: 'updated_at',
			contentDir: `${root}/knowledge`,
		},
	};
}

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function clientWith(payloads: unknown[]) {
	const calls: Array<{ url: string; body?: unknown }> = [];
	const client = new TreeDbClient({
		baseUrl: 'https://treedb.example.test',
		token: 'token',
		repoId: 'repo_1',
		fetch: (async (input, init) => {
			calls.push({
				url: String(input),
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			return json(payloads.shift() ?? { ok: true });
		}) as typeof fetch,
	});
	return { client, calls };
}

describe('TreeDB SDK adapters', () => {
	it('maps content paths and read results to SDK entries', async () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'treedb-sdk-adapter-'));
		const models = registry(resolve(repoRoot, 'src/content'));
		const definition = models.knowledge!;
		expect(resolveContentDir(definition, { repoRoot })).toBe('src/content/knowledge');

		const { client } = clientWith([
			{
				ok: true,
				repoId: 'repo_1',
				ref: 'refs/heads/main',
				resolvedRef: 'abc',
				file: {
					path: 'src/content/knowledge/readme.md',
					frontmatter: { title: 'Read Me', status: 'published', updated_at: '2026-06-01T00:00:00Z' },
					body: 'Body',
				},
			},
		]);
		const adapter = new TreeDbRepositoryAdapter({ client, models, repoRoot });
		const entry = await adapter.get({ model: 'knowledge', slug: 'readme' });
		expect(entry).toMatchObject({
			id: 'readme',
			model: 'knowledge',
			title: 'Read Me',
			body: 'Body',
			updatedAt: '2026-06-01T00:00:00Z',
		});
	});

	it('maps search filters and sorts to generic TreeDB fields', async () => {
		const { client, calls } = clientWith([
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] },
		]);
		const adapter = new TreeDbRepositoryAdapter({ client, models: registry(), contentPathMap: { knowledge: 'docs' } });
		await adapter.search({
			model: 'knowledge',
			filters: [{ field: 'status', op: 'eq', value: 'published' }],
			sort: [{ field: 'updatedAt', direction: 'desc' }],
			limit: 10,
		});
		expect(calls[0]?.url).toBe('https://treedb.example.test/api/v1/repos/repo_1/files/search');
		expect(calls[0]?.body).toMatchObject({
			paths: ['docs/**'],
			filters: [{ field: 'frontmatter.status', op: 'eq', value: 'published' }],
			sort: [{ field: 'frontmatter.updated_at', direction: 'desc' }],
			limit: 10,
		});
	});

	it('creates and updates content through TreeDB workspaces', async () => {
		const { client, calls } = clientWith([
			{ ok: true, workspaceId: 'ws_create', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready', allowedPaths: ['docs/**'] },
			{ ok: true, file: { path: 'docs/new.md', sha: 'blake3:new' } },
			{ ok: true, repoId: 'repo_1', workspaceId: 'ws_create', branchName: 'refs/heads/agent/knowledge-new', commitSha: 'def', changedPaths: ['docs/new.md'], status: 'committed' },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/agent/knowledge-new', resolvedRef: 'def', file: { path: 'docs/new.md', frontmatter: { title: 'New', slug: 'new' }, body: 'Body' } },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', file: { path: 'docs/new.md', frontmatter: { title: 'New', slug: 'new' }, body: 'Body' } },
			{ ok: true, workspaceId: 'ws_update', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready', allowedPaths: ['docs/**'] },
			{ ok: true, file: { path: 'docs/new.md', sha: 'blake3:update' } },
			{ ok: true, repoId: 'repo_1', workspaceId: 'ws_update', branchName: 'refs/heads/agent/knowledge-new', commitSha: 'fed', changedPaths: ['docs/new.md'], status: 'committed' },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/agent/knowledge-new', resolvedRef: 'fed', file: { path: 'docs/new.md', frontmatter: { title: 'Updated', slug: 'new' }, body: 'Updated body' } },
		]);
		const adapter = new TreeDbRepositoryAdapter({ client, models: registry(), contentPathMap: { knowledge: 'docs' } });
		const created = await adapter.create({
			model: 'knowledge',
			actor: 'agent',
			data: { slug: 'new', title: 'New', body: 'Body' },
		});
		expect(created.item.title).toBe('New');
		const updated = await adapter.update({
			model: 'knowledge',
			actor: 'agent',
			slug: 'new',
			expectedVersion: 'blake3:new',
			data: { title: 'Updated', body: 'Updated body' },
		});
		expect(updated.item.title).toBe('Updated');
		expect(calls.some((call) => call.url.endsWith('/workspaces/ws_create/files?path=docs%2Fnew.md'))).toBe(true);
		expect(calls.some((call) => call.body && (call.body as { expectedSha?: string }).expectedSha === 'blake3:new')).toBe(true);
	});

	it('throws not implemented for TreeDB pick leases', async () => {
		const { client } = clientWith([]);
		const adapter = new TreeDbRepositoryAdapter({ client, models: registry(), contentPathMap: { knowledge: 'docs' } });
		await expect(adapter.pick({
			model: 'knowledge',
			strategy: 'latest',
			leaseSeconds: 60,
			workerId: 'worker',
		})).rejects.toMatchObject({ code: 'not_implemented', status: 501 });
	});

	it('maps graph adapter calls to SDK graph shapes', async () => {
		const { client, calls } = clientWith([
			{ ok: true, ready: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', graphVersion: 'graph_1', snapshotRoot: 'treedb://graph/repo_1/graph_1', changed: {}, metrics: {} },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', results: [{ node: { id: 'file:1', nodeType: 'File' }, score: 1, reason: 'lexical:file' }] },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], nodes: [], edges: [], providerId: 'treedb-graph-mvp' },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], totalTokenEstimate: 0, includedNodeIds: [], nodes: [], edges: [] },
			{ ok: true, query: null, errors: ['bad ctx'] },
		]);
		const graph = new TreeDbGraphAdapter({ client, repoId: 'repo_1', defaultRef: 'refs/heads/main' });
		expect((await graph.refresh()).ready).toBe(true);
		expect(await graph.searchFiles('release')).toHaveLength(1);
		expect((await graph.queryGraph({ query: 'release' })).providerId).toBe('treedb-graph-mvp');
		expect((await graph.buildContextPack({ query: 'release' })).totalTokenEstimate).toBe(0);
		expect((await graph.parseGraphDsl('bad')).errors).toEqual(['bad ctx']);
		expect(calls.map((call) => call.url)).toEqual([
			'https://treedb.example.test/api/v1/repos/repo_1/graph/refresh',
			'https://treedb.example.test/api/v1/repos/repo_1/graph/search-files',
			'https://treedb.example.test/api/v1/repos/repo_1/graph/query',
			'https://treedb.example.test/api/v1/repos/repo_1/context/build',
			'https://treedb.example.test/api/v1/repos/repo_1/context/parse-ctx',
		]);
	});

	it('keeps AgentSdk local mode unchanged and delegates TreeDB mode explicitly', async () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'treedb-agent-sdk-'));
		const local = new AgentSdk({
			repoRoot,
			modelRegistry: registry(resolve(repoRoot, 'src/content')),
			database: new MemoryAgentDatabase(),
		});
		expect(local.treeDb).toBeUndefined();

		const { client } = clientWith([
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] },
		]);
		const remote = new AgentSdk({
			repoRoot,
			modelRegistry: registry(resolve(repoRoot, 'src/content')),
			treeDb: {
				enabled: true,
				client,
				repoId: 'repo_1',
				contentPathMap: { knowledge: 'docs' },
			},
		});
		expect(remote.treeDb?.client).toBe(client);
		const response = await remote.search({ model: 'knowledge', limit: 5 });
		expect(response.payload).toEqual([]);
	});

	it('rejects absolute contentDir without repoRoot or contentPathMap', () => {
		const models = registry('/abs/other');
		const definition = models.knowledge!;
		expect(() => resolveContentDir(definition, {})).toThrow(TreeDbApiError);
	});
});
