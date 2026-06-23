import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { AgentSdk } from '../../src/sdk.ts';
import type { SdkModelRegistry } from '../../src/sdk-types.ts';
import {
	TreeDxApiError,
	TreeDxArtifactPort,
	TreeDxClient,
	TreeDxExecPort,
	TreeDxFederatedClient,
	TreeDxFederatedPort,
	TreeDxGraphAdapter,
	TreeDxGraphPort,
	LocalGraphPort,
	LocalRepositoryPort,
	LocalRepositoryQueryPort,
	TreeDxRegistryClient,
	TreeDxRepositoryAdapter,
	TreeDxRepositoryPort,
	TreeDxRepositoryQueryPort,
	resolveContentDir,
} from '../../src/treedx/index.ts';

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
	const client = new TreeDxClient({
		baseUrl: 'https://treedx.example.test',
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

describe('TreeDX SDK adapters', () => {
	it('maps content paths and read results to SDK entries', async () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'treedx-sdk-adapter-'));
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
		const adapter = new TreeDxRepositoryAdapter({ client, models, repoRoot });
		const entry = await adapter.get({ model: 'knowledge', slug: 'readme' });
		expect(entry).toMatchObject({
			id: 'readme',
			model: 'knowledge',
			title: 'Read Me',
			body: 'Body',
			updatedAt: '2026-06-01T00:00:00Z',
		});
	});

	it('parses raw TreeDX document content before typed frontmatter payloads', async () => {
		const { client } = clientWith([
			{
				ok: true,
				repoId: 'repo_1',
				ref: 'refs/heads/main',
				resolvedRef: 'abc',
				file: {
					path: 'src/content/knowledge/readme.md',
					frontmatter: { title: 'Read Me', enabled: 'true' },
					content: '---\ntitle: Read Me\nenabled: true\n---\n\nBody',
				},
			},
		]);
		const adapter = new TreeDxRepositoryAdapter({ client, models: registry() });
		const entry = await adapter.get({ model: 'knowledge', slug: 'readme' });
		expect(entry?.frontmatter.enabled).toBe(true);
		expect(entry?.body.trim()).toBe('Body');
	});

	it('maps search filters and sorts to generic TreeDX fields', async () => {
		const { client, calls } = clientWith([
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] },
		]);
		const adapter = new TreeDxRepositoryAdapter({ client, models: registry(), contentPathMap: { knowledge: 'docs' } });
		await adapter.search({
			model: 'knowledge',
			filters: [{ field: 'status', op: 'eq', value: 'published' }],
			sort: [{ field: 'updatedAt', direction: 'desc' }],
			limit: 10,
		});
		expect(calls[0]?.url).toBe('https://treedx.example.test/api/v1/repos/repo_1/files/search');
		expect(calls[0]?.body).toMatchObject({
			paths: ['docs/**'],
			filters: [{ field: 'frontmatter.status', op: 'eq', value: 'published' }],
			sort: [{ field: 'frontmatter.updated_at', direction: 'desc' }],
			limit: 10,
		});
	});

	it('creates and updates content through TreeDX workspaces', async () => {
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
		const adapter = new TreeDxRepositoryAdapter({ client, models: registry(), contentPathMap: { knowledge: 'docs' } });
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

	it('throws not implemented for TreeDX pick leases', async () => {
		const { client } = clientWith([]);
		const adapter = new TreeDxRepositoryAdapter({ client, models: registry(), contentPathMap: { knowledge: 'docs' } });
		await expect(adapter.pick({
			model: 'knowledge',
			strategy: 'latest',
			leaseSeconds: 60,
			workerId: 'worker',
		})).rejects.toMatchObject({ code: 'not_implemented', status: 501 });
	});

	it('maps graph adapter calls to SDK graph shapes', async () => {
		const { client, calls } = clientWith([
			{ ok: true, ready: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', graphVersion: 'graph_1', snapshotRoot: 'treedx://graph/repo_1/graph_1', changed: {}, metrics: {} },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', results: [{ node: { id: 'file:1', nodeType: 'File' }, score: 1, reason: 'lexical:file' }] },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], nodes: [], edges: [], providerId: 'treedx-graph-mvp' },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], totalTokenEstimate: 0, includedNodeIds: [], nodes: [], edges: [] },
			{ ok: true, query: null, errors: ['bad ctx'] },
		]);
		const graph = new TreeDxGraphAdapter({ client, repoId: 'repo_1', defaultRef: 'refs/heads/main' });
		expect((await graph.refresh()).ready).toBe(true);
		expect(await graph.searchFiles('release')).toHaveLength(1);
		expect((await graph.queryGraph({ query: 'release' })).providerId).toBe('treedx-graph-mvp');
		expect((await graph.buildContextPack({ query: 'release' })).totalTokenEstimate).toBe(0);
		expect((await graph.parseGraphDsl('bad')).errors).toEqual(['bad ctx']);
		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos/repo_1/graph/refresh',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/search-files',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/query',
			'https://treedx.example.test/api/v1/repos/repo_1/context/build',
			'https://treedx.example.test/api/v1/repos/repo_1/context/parse-ctx',
		]);
	});

	it('keeps AgentSdk local mode unchanged and delegates TreeDX mode explicitly', async () => {
		const repoRoot = mkdtempSync(join(tmpdir(), 'treedx-agent-sdk-'));
		const local = new AgentSdk({
			repoRoot,
			modelRegistry: registry(resolve(repoRoot, 'src/content')),
			database: new MemoryAgentDatabase(),
			contentRepository: { adapter: 'local' },
		});
		expect(local.treeDx).toBeUndefined();
		expect(local.ports.repository).toBeInstanceOf(LocalRepositoryPort);
		expect(local.ports.query).toBeInstanceOf(LocalRepositoryQueryPort);
		expect(local.ports.graph).toBeInstanceOf(LocalGraphPort);

		const { client } = clientWith([
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] },
		]);
		const remote = new AgentSdk({
			repoRoot,
			modelRegistry: registry(resolve(repoRoot, 'src/content')),
			treeDx: {
				enabled: true,
				client,
				repoId: 'repo_1',
				contentPathMap: { knowledge: 'docs' },
			},
		});
		expect(remote.treeDx?.client).toBe(client);
		expect(remote.ports.repository).toBeInstanceOf(TreeDxRepositoryPort);
		expect(remote.ports.query).toBeInstanceOf(TreeDxRepositoryQueryPort);
		expect(remote.ports.graph).toBeInstanceOf(TreeDxGraphPort);
		const response = await remote.ports.query.search({ repoId: 'repo_1', ref: 'refs/heads/main', query: { model: 'knowledge', limit: 5 } });
		expect(response.results).toEqual([]);
	});

	it('rejects absolute contentDir without repoRoot or contentPathMap', () => {
		const models = registry('/abs/other');
		const definition = models.knowledge!;
		expect(() => resolveContentDir(definition, {})).toThrow(TreeDxApiError);
	});

	it('exposes TreeDX-backed transport ports as thin client adapters', async () => {
		const { client, calls } = clientWith([
			{ ok: true, workspaceId: 'ws_1', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready', allowedPaths: ['docs/**'] },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] },
			{ ok: true, exitCode: 0, stdout: '', stderr: '', elapsedMs: 1, truncated: false, changedPaths: [] },
			{ ok: true, snapshot: { snapshotId: 'snap_1', repoId: 'repo_1', ref: 'refs/heads/main', commitSha: 'abc', kind: 'repository_snapshot', includedPaths: [], fileCount: 0, totalBytes: 0, checksums: {}, createdAt: '2026-06-03T00:00:00Z' } },
		]);
		const repository = new TreeDxRepositoryPort(client);
		const query = new TreeDxRepositoryQueryPort(client);
		const exec = new TreeDxExecPort(client);
		const artifact = new TreeDxArtifactPort(client);

		await repository.createWorkspace({ mode: 'writable' });
		await query.search({ query: 'release' });
		await exec.exec({ workspaceId: 'ws_1', cmd: 'true' });
		await artifact.buildSnapshot();

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos/repo_1/workspaces',
			'https://treedx.example.test/api/v1/repos/repo_1/files/search',
			'https://treedx.example.test/api/v1/workspaces/ws_1/exec',
			'https://treedx.example.test/api/v1/repos/repo_1/snapshots/build',
		]);
	});

	it('exposes graph and federated ports', async () => {
		const { client, calls } = clientWith([
			{ ok: true, ready: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', graphVersion: 'graph_1', snapshotRoot: 'treedx://graph/repo_1/graph_1', changed: {}, metrics: {} },
			{ ok: true, search: { query: 'release', results: [], page: { limit: 20, hasMore: false, cursor: null }, diagnostics: { requestedRepoCount: 1, executedRepoCount: 1, rejectedRepoCount: 0, partialFailureCount: 0, routing: [] }, errors: [] } },
		]);
		const graph = new TreeDxGraphPort(new TreeDxGraphAdapter({ client, repoId: 'repo_1' }));
		const federated = new TreeDxFederatedPort(new TreeDxFederatedClient({ registry: new TreeDxRegistryClient(client) }));
		await graph.refresh();
		await federated.search({ repoIds: ['repo_1'], query: 'release' });
		expect(calls[0]?.url).toBe('https://treedx.example.test/api/v1/repos/repo_1/graph/refresh');
		expect(calls[1]?.url).toBe('https://treedx.example.test/api/v1/search');
	});
});
