import { describe, expect, it } from 'vitest';
import type { SdkModelRegistry } from '../../src/sdk-types.ts';
import {
	TreeDxApiError,
	TreeDxClient,
	TreeDxGraphAdapter,
	TreeDxRepositoryAdapter,
} from '../../src/treedx/index.ts';

function registry(): SdkModelRegistry {
	return {
		knowledge: {
			name: 'knowledge',
			aliases: ['knowledge'],
			storage: 'content',
			operations: ['get', 'read', 'search', 'follow', 'pick', 'create', 'update'],
			fields: {
				title: { key: 'title', contentKeys: ['title'], filterable: true, sortable: true },
				status: { key: 'status', contentKeys: ['status'], filterable: true },
				slug: { key: 'slug', contentKeys: ['slug'], filterable: true },
				updated_at: { key: 'updated_at', aliases: ['updatedAt'], contentKeys: ['updated_at', 'updatedAt'], filterable: true, sortable: true },
			},
			filterableFields: ['title', 'status', 'slug', 'updated_at'],
			sortableFields: ['title', 'updated_at'],
			pickField: 'updated_at',
			contentDir: '/not/used/by/remote/mode',
		},
	};
}

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function clientWith(payloads: Array<unknown | Response>) {
	const calls: Array<{ url: string; method?: string; headers: Headers; body?: unknown }> = [];
	const client = new TreeDxClient({
		baseUrl: 'https://treedx.example.test/',
		token: 'mvp-token',
		repoId: 'repo_1',
		fetch: (async (input, init) => {
			calls.push({
				url: String(input),
				method: init?.method,
				headers: new Headers(init?.headers),
				body: init?.body ? JSON.parse(String(init.body)) : undefined,
			});
			const payload = payloads.shift() ?? { ok: true };
			return payload instanceof Response ? payload : json(payload);
		}) as typeof fetch,
	});
	return { client, calls };
}

describe('TreeDX end-to-end SDK contract', () => {
	it('drives the unified TreeDX route sequence with bearer auth', async () => {
		const { client, calls } = clientWith([
			{ ok: true, authenticated: true, principal: { actorId: 'actor_demo', tenantId: 'tenant_demo' } },
			{ ok: true, effectiveScope: { actorId: 'actor_demo', capabilities: ['files:read'], refs: ['*'], paths: ['**'] } },
			{ ok: true, placement: { repositoryId: 'repo_1', primaryNodeId: 'node_local', mirrorNodeIds: [], readPolicy: 'primary_or_mirror', writePolicy: 'primary_only', migrationState: 'stable' } },
			{ ok: true, workspaceId: 'ws_1', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready', allowedPaths: ['docs/**'] },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [{ path: 'docs/readme.md', snippet: 'mvp provenance' }] },
			{ ok: true, ready: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', graphVersion: 'graph_1', snapshotRoot: 'treedx://graph/repo_1/graph_1', changed: {}, metrics: {} },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], totalTokenEstimate: 0, includedNodeIds: [], includedPaths: [], nodes: [], edges: [] },
			{ ok: true, requestedScope: {}, effectiveScope: { repos: [] }, rejected: [], executable: false, reason: 'planner_only_mvp' },
			{ ok: true, file: { path: 'docs/readme.md', sha: 'sha_new', source: 'overlay' } },
			{ ok: true, exitCode: 0, stdout: '', stderr: '', elapsedMs: 1, truncated: false, changedPaths: [] },
			{ ok: true, workspaceId: 'ws_1', status: 'ready', changes: [{ path: 'docs/readme.md' }] },
			{ ok: true, workspaceId: 'ws_1', diff: 'diff', changedPaths: ['docs/readme.md'] },
			{ ok: true, repoId: 'repo_1', workspaceId: 'ws_1', branchName: 'refs/heads/agent/mvp', commitSha: 'def', changedPaths: ['docs/readme.md'], status: 'committed' },
			{ ok: true, snapshot: { snapshotId: 'snap_1', repoId: 'repo_1', ref: 'refs/heads/agent/mvp', commitSha: 'def', kind: 'repository_snapshot', includedPaths: ['docs/**'], fileCount: 1, totalBytes: 10, checksums: {}, createdAt: '2026-06-02T00:00:00Z', artifact: { artifactId: 'artifact_1', snapshotId: 'snap_1', repoId: 'repo_1', format: 'tar.zst', size: 100, checksum: 'blake3:abc', uri: 'treedx://artifact/snap_1' } } },
			{ ok: true, artifact: { artifactId: 'artifact_1', snapshotId: 'snap_1', repoId: 'repo_1', format: 'tar.zst', size: 100, checksum: 'blake3:abc', uri: 'treedx://artifact/snap_1' } },
			{ ok: true, migration: { id: 'mig_1', repositoryId: 'repo_1', sourceNodeId: 'node_local', targetNodeId: 'node_mirror', mode: 'primary_transfer', status: 'planned', dryRun: true, requireMirrorSynced: false, createdAt: '2026-06-02T00:00:00Z' }, placement: { repositoryId: 'repo_1', primaryNodeId: 'node_local' } },
			{ ok: true, events: [], page: { limit: 200, hasMore: false } },
		]);

		await client.whoami();
		await client.effectiveScope({ repoId: 'repo_1' });
		await client.getPlacement('repo_1');
		await client.createWorkspace({ repoId: 'repo_1', baseRef: 'refs/heads/main', mode: 'writable' });
		await client.searchRepositoryFiles({ repoId: 'repo_1', query: 'mvp provenance', paths: ['docs/**'] });
		await client.refreshGraph({ repoId: 'repo_1', ref: 'refs/heads/main' });
		await client.buildContext({ repoId: 'repo_1', query: 'mvp provenance' });
		await client.planFederatedQuery({ repoIds: ['repo_1'], capabilities: ['files:search'] });
		await client.writeFile({ workspaceId: 'ws_1', path: 'docs/readme.md', content: 'updated' });
		await client.exec({ workspaceId: 'ws_1', mode: 'read_only', cmd: 'rg mvp docs' });
		await client.status({ workspaceId: 'ws_1' });
		await client.diff({ workspaceId: 'ws_1' });
		await client.commit({ workspaceId: 'ws_1', message: 'MVP update', author: { name: 'TreeDX Agent', email: 'agent@example.invalid' } });
		await client.buildSnapshot({ repoId: 'repo_1', ref: 'refs/heads/agent/mvp', paths: ['docs/**'] });
		await client.exportArtifact({ repoId: 'repo_1', snapshotId: 'snap_1' });
		await client.createMigration({ repoId: 'repo_1', targetNodeId: 'node_mirror', dryRun: true, requireMirrorSynced: false });
		await client.listAuditEvents({ repoId: 'repo_1', limit: 200 });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/auth/whoami',
			'https://treedx.example.test/api/v1/policy/effective-scope?repoId=repo_1',
			'https://treedx.example.test/api/v1/registry/repos/repo_1/placement',
			'https://treedx.example.test/api/v1/repos/repo_1/workspaces',
			'https://treedx.example.test/api/v1/repos/repo_1/files/search',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/refresh',
			'https://treedx.example.test/api/v1/repos/repo_1/context/build',
			'https://treedx.example.test/api/v1/federation/query/plan',
			'https://treedx.example.test/api/v1/workspaces/ws_1/files?path=docs%2Freadme.md',
			'https://treedx.example.test/api/v1/workspaces/ws_1/exec',
			'https://treedx.example.test/api/v1/workspaces/ws_1/status',
			'https://treedx.example.test/api/v1/workspaces/ws_1/diff',
			'https://treedx.example.test/api/v1/workspaces/ws_1/commit',
			'https://treedx.example.test/api/v1/repos/repo_1/snapshots/build',
			'https://treedx.example.test/api/v1/repos/repo_1/artifacts/export',
			'https://treedx.example.test/api/v1/repos/repo_1/migrations',
			'https://treedx.example.test/api/v1/audit/events?repoId=repo_1&limit=200',
		]);
		expect(calls.every((call) => call.headers.get('authorization') === 'Bearer mvp-token')).toBe(true);
		expect(JSON.stringify(calls.map((call) => call.body))).not.toContain('TreeSeed');
	});

	it('maps content operations through TreeDX without a local repo root', async () => {
		const { client, calls } = clientWith([
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [{ path: 'docs/readme.md', frontmatter: { title: 'Read Me', status: 'published' }, body: 'Body' }] },
			{ ok: true, workspaceId: 'ws_1', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready', allowedPaths: ['docs/**'] },
			{ ok: true, file: { path: 'docs/new.md', sha: 'sha_new' } },
			{ ok: true, repoId: 'repo_1', workspaceId: 'ws_1', branchName: 'refs/heads/agent/knowledge-new', commitSha: 'def', changedPaths: ['docs/new.md'], status: 'committed' },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/agent/knowledge-new', resolvedRef: 'def', file: { path: 'docs/new.md', frontmatter: { title: 'New', slug: 'new' }, body: 'Body' } },
		]);
		const adapter = new TreeDxRepositoryAdapter({
			client,
			models: registry(),
			contentPathMap: { knowledge: 'docs' },
		});

		const results = await adapter.search({ model: 'knowledge', query: 'Read', limit: 10 });
		expect(results[0]?.path).toBe('docs/readme.md');
		const created = await adapter.create({ model: 'knowledge', actor: 'agent', data: { slug: 'new', title: 'New', body: 'Body' } });
		expect(created.item.id).toBe('new');
		expect(calls.some((call) => call.url.endsWith('/repos/repo_1/files/search'))).toBe(true);
		expect(calls.some((call) => call.url.endsWith('/repos/repo_1/workspaces'))).toBe(true);
		expect(calls.some((call) => call.url.endsWith('/workspaces/ws_1/files?path=docs%2Fnew.md'))).toBe(true);
	});

	it('maps graph adapter calls to remote graph and context APIs', async () => {
		const { client, calls } = clientWith([
			{ ok: true, ready: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', graphVersion: 'graph_1', snapshotRoot: 'treedx://graph/repo_1/graph_1', changed: {}, metrics: {} },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', results: [{ node: { id: 'section:1', nodeType: 'Section' }, score: 1, reason: 'lexical:section' }] },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], nodes: [], edges: [], providerId: 'treedx-graph-mvp', diagnostics: {} },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], totalTokenEstimate: 0, includedNodeIds: [], nodes: [], edges: [] },
		]);
		const graph = new TreeDxGraphAdapter({ client, repoId: 'repo_1', defaultRef: 'refs/heads/main' });
		expect((await graph.refresh()).ready).toBe(true);
		expect(await graph.searchSections('release')).toHaveLength(1);
		expect((await graph.queryGraph({ query: 'mvp' })).providerId).toBe('treedx-graph-mvp');
		expect((await graph.buildContextPack({ query: 'mvp' })).totalTokenEstimate).toBe(0);
		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos/repo_1/graph/refresh',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/search-sections',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/query',
			'https://treedx.example.test/api/v1/repos/repo_1/context/build',
		]);
	});

	it('preserves TreeDX authorization errors and maps hidden graph nodes to null', async () => {
		const { client } = clientWith([
			{ ok: false, error: { code: 'permission_denied', message: 'Permission denied.' } },
		]);
		await expect(client.searchRepositoryFiles({ query: 'secret', paths: ['private/**'] }))
			.rejects.toMatchObject({ code: 'permission_denied', status: 200 });

		const graphClient = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'mvp-token',
			repoId: 'repo_1',
			fetch: (async () => json({ ok: false, error: { code: 'not_found', message: 'Not found.' } }, 404)) as typeof fetch,
		});
		const graph = new TreeDxGraphAdapter({ client: graphClient, repoId: 'repo_1' });
		await expect(graph.getNode('file:hidden')).resolves.toBeNull();
	});
});
