import { describe, expect, it, vi } from 'vitest';
import { TreeDxApiError, TreeDxClient } from '../../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function mockClient(payloads: unknown[] = []) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		return json(payloads.shift() ?? { ok: true });
	});
	const client = new TreeDxClient({
		baseUrl: 'https://treedx.example.test/',
		token: 'token-123',
		repoId: 'repo_1',
		fetch: fetchImpl as typeof fetch,
	});
	return { client, calls, fetchImpl };
}

describe('TreeDxClient', () => {
	it('normalizes base URLs and sends bearer auth', async () => {
		const { client, calls } = mockClient([{ ok: true, status: 'ok', service: 'treedx-api' }]);
		expect(client.baseUrl).toBe('https://treedx.example.test');
		await client.health();
		expect(calls[0]?.url).toBe('https://treedx.example.test/api/v1/health');
		expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe('Bearer token-123');
	});

	it('maps core endpoint methods', async () => {
		const { client, calls } = mockClient([
			{ ok: true, authenticated: false, principal: null },
			{ ok: true, actorId: 'actor_demo', tenantIds: ['tenant_demo'], capabilities: [], refs: [], paths: [] },
			{ ok: true, node: { id: 'node_local', baseUrl: 'http://localhost:4000', role: 'primary', health: 'healthy' } },
			{ ok: true, placement: { primaryNodeId: 'node_local', mirrorNodeIds: [], readPolicy: 'primary', writePolicy: 'primary', migrationState: 'stable' } },
		]);

		await client.whoami();
		await client.effectiveScope({ repoId: 'repo_1' });
		await client.getNode();
		await client.getPlacement('repo_1');

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/auth/whoami',
			'https://treedx.example.test/api/v1/policy/effective-scope?repoId=repo_1',
			'https://treedx.example.test/api/v1/node',
			'https://treedx.example.test/api/v1/registry/repos/repo_1/placement',
		]);
	});

	it('constructs workspace, repository query, graph, and context routes', async () => {
		const { client, calls } = mockClient([
			{ ok: true, workspaceId: 'ws_1', repoId: 'repo_1', baseRef: 'refs/heads/main', baseCommitSha: 'abc', mode: 'writable', status: 'ready', allowedPaths: ['docs/**'] },
			{ ok: true, entries: [] },
			{ ok: true, path: 'docs/readme.md', encoding: 'utf8', content: 'hello', sha: 'sha', source: 'base' },
			{ ok: true, file: { path: 'docs/readme.md', sha: 'blake3:1' } },
			{ ok: true, repoId: 'repo_1', ref: 'refs/heads/main', resolvedRef: 'abc', results: [] },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], nodes: [], edges: [] },
			{ ok: true, repoId: 'repo_1', graphVersion: 'graph_1', seedIds: [], totalTokenEstimate: 0, includedNodeIds: [], includedPaths: [], nodes: [], edges: [] },
			{ ok: true, query: null, errors: [] },
		]);

		await client.createWorkspace({ branchName: 'refs/heads/agent/test' });
		await client.listTree({ workspaceId: 'ws_1', path: 'docs' });
		await client.readFile({ workspaceId: 'ws_1', path: 'docs/readme.md' });
		await client.writeFile({ workspaceId: 'ws_1', path: 'docs/readme.md', content: 'hello' });
		await client.queryRepository({ type: 'text', query: 'hello' });
		await client.queryGraph({ query: 'hello' });
		await client.buildContext({ query: 'hello' });
		await client.parseContextDsl({ source: 'ctx "hello"' });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos/repo_1/workspaces',
			'https://treedx.example.test/api/v1/workspaces/ws_1/tree?path=docs',
			'https://treedx.example.test/api/v1/workspaces/ws_1/files?path=docs%2Freadme.md',
			'https://treedx.example.test/api/v1/workspaces/ws_1/files?path=docs%2Freadme.md',
			'https://treedx.example.test/api/v1/repos/repo_1/query',
			'https://treedx.example.test/api/v1/repos/repo_1/graph/query',
			'https://treedx.example.test/api/v1/repos/repo_1/context/build',
			'https://treedx.example.test/api/v1/repos/repo_1/context/parse-ctx',
		]);
		expect(JSON.parse(String(calls[3]?.init.body))).toMatchObject({ content: 'hello' });
	});

	it('lists, registers, and batch-reads repositories through the canonical client', async () => {
		const repository = {
			repoId: 'repo_1',
			name: 'treeseed-market',
			repositoryName: 'treeseed-market',
			defaultRef: 'refs/heads/main',
			status: 'ready',
		};
		const { client, calls } = mockClient([
			{ ok: true, repos: [repository] },
			{ ok: true, repo: repository },
			{
				ok: true,
				repoId: 'repo_1',
				ref: 'refs/heads/main',
				resolvedRef: 'abc',
				files: [
					{ path: 'src/content/agents/engineer.mdx', content: 'engineer' },
					{ path: 'src/content/agents/researcher.mdx', content: 'researcher' },
				],
			},
		]);

		await expect(client.listRepositories()).resolves.toEqual([repository]);
		await expect(client.registerRepository({
			name: 'treeseed-market',
			repositoryName: 'treeseed-market',
			createIfMissing: true,
			defaultRef: 'refs/heads/main',
		})).resolves.toEqual(repository);
		await expect(client.readRepositoryFiles({
			repoId: 'repo_1',
			ref: 'refs/heads/main',
			paths: [
				'src/content/agents/engineer.mdx',
				'src/content/agents/researcher.mdx',
			],
		})).resolves.toMatchObject({ files: expect.any(Array) });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos',
			'https://treedx.example.test/api/v1/repos/register',
			'https://treedx.example.test/api/v1/repos/repo_1/files/read',
		]);
		expect(JSON.parse(String(calls[2]?.init.body))).toMatchObject({
			ref: 'refs/heads/main',
			paths: [
				'src/content/agents/engineer.mdx',
				'src/content/agents/researcher.mdx',
			],
		});
	});

	it('throws TreeDxApiError for API, non-json, network, and missing repo errors', async () => {
		const apiClient = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'token',
			repoId: 'repo_1',
			fetch: (async () => json({ ok: false, error: { code: 'permission_denied', message: 'Denied.', details: { reason: 'test' } } }, 403)) as typeof fetch,
		});
		await expect(apiClient.health()).rejects.toMatchObject({
			name: 'TreeDxApiError',
			status: 403,
			code: 'permission_denied',
		});

		const badJsonClient = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'token',
			repoId: 'repo_1',
			fetch: (async () => new Response('not-json', { status: 200 })) as typeof fetch,
		});
		await expect(badJsonClient.health()).rejects.toMatchObject({ code: 'invalid_response' });

		const networkClient = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'token',
			repoId: 'repo_1',
			fetch: (async () => {
				throw new Error('boom');
			}) as typeof fetch,
		});
		await expect(networkClient.health()).rejects.toMatchObject({ code: 'network_error', status: 0 });

		const missingRepo = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'token',
			fetch: (async () => json({ ok: true })) as typeof fetch,
		});
		expect(() => missingRepo.getRepository()).toThrow(TreeDxApiError);
		expect(() => missingRepo.getRepository()).toThrow(/repository ID/iu);
	});

	it('maps aborted requests to timeout errors', async () => {
		const client = new TreeDxClient({
			baseUrl: 'https://treedx.example.test',
			token: 'token',
			repoId: 'repo_1',
			timeoutMs: 1,
			fetch: ((_, init) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					reject(new DOMException('aborted', 'AbortError'));
				});
			})) as typeof fetch,
		});

		await expect(client.health()).rejects.toMatchObject({
			code: 'timeout',
			status: 0,
			details: { timeoutMs: 1 },
		});
	});
});
