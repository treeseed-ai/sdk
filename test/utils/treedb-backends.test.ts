import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ContentStore } from '../../src/content-store.ts';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { ContentGraphRuntime } from '../../src/graph.ts';
import { AgentSdk } from '../../src/sdk.ts';
import { TreeDbApiError, TreeDbClient, type Transport, type TreeDbRequest, type TreeDbResponse } from '../../src/treedb-client.ts';
import {
	LocalContentBackend,
	TreeDbContentBackend,
	TreeDbExecBackend,
	TreeDbGraphBackend,
	TreeDbPortfolioResolver,
} from '../../src/treedb-backends.ts';
import { TreeDbRepositoryAdapter } from '../../src/treedb/index.ts';
import { buildScopedModelRegistry } from '../../src/model-registry.ts';
import { sdkFixtureRoot } from '../test-fixture.ts';

class RecordingTransport implements Transport {
	readonly requests: TreeDbRequest[] = [];

	constructor(private readonly handler: (request: TreeDbRequest) => unknown) {}

	async request<T = unknown>(request: TreeDbRequest): Promise<TreeDbResponse<T>> {
		this.requests.push(request);
		const data = this.handler(request);
		if (data instanceof TreeDbApiError) {
			throw data;
		}
		return {
			status: 200,
			headers: { 'content-type': 'application/json' },
			data: data as T,
		};
	}
}

function makeTreeDbClient(transport: RecordingTransport) {
	return new TreeDbClient({
		baseUrl: 'http://treedb.test',
		transport,
	});
}

function makeLocalContentStore(repoRoot = sdkFixtureRoot) {
	return new ContentStore(repoRoot, new MemoryAgentDatabase(), buildScopedModelRegistry(repoRoot));
}

function makeBackend(options: {
	transport: RecordingTransport;
	repoRoot?: string;
	workspaceId?: string;
	contentPathMap?: Record<string, string>;
}) {
	const repoRoot = options.repoRoot ?? sdkFixtureRoot;
	const client = makeTreeDbClient(options.transport);
	const resolver = new TreeDbPortfolioResolver({
		client,
		ref: 'refs/heads/main',
	});
	return new TreeDbContentBackend({
		client,
		repoRoot,
		models: buildScopedModelRegistry(repoRoot),
		resolver,
		ref: 'refs/heads/main',
		workspaceId: options.workspaceId,
		contentPathMap: options.contentPathMap,
		localLeaseStore: makeLocalContentStore(repoRoot),
	});
}

function contentHandler(request: TreeDbRequest) {
	if (request.method === 'GET' && request.path === '/api/v1/repos') {
		return {
			items: [
				{ id: 'repo-a', name: 'content-a', metadata: { purpose: 'project_content' } },
				{ id: 'repo-b', name: 'content-b', metadata: { purpose: 'project_content' } },
			],
		};
	}
	if (request.method === 'POST' && request.path.endsWith('/paths/list')) {
		const repo = request.path.includes('/repo-a/') ? 'a' : 'b';
		return {
			paths: [`src/content/pages/${repo}-page.mdx`],
		};
	}
	if (request.method === 'POST' && request.path.endsWith('/files/read')) {
		const body = request.body as { path?: string };
		const slug = body.path?.includes('a-page') ? 'a-page' : 'b-page';
		return {
			content: `---
title: ${slug}
slug: ${slug}
updated_at: 2026-06-01T00:00:00.000Z
---
${slug} body
`,
		};
	}
	return {};
}

describe('TreeDB-backed TreeSeed content repository', () => {
	it('keeps AgentSdk local by default when TreeDB mode is not explicitly enabled', () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			treeDb: { enabled: false, baseUrl: 'http://treedb.test' },
		});

		expect(sdk.content).toBeInstanceOf(LocalContentBackend);
		expect(sdk.treeDb).toBeUndefined();
	});

	it('fails clearly when TreeDB content is selected without TreeDB config', () => {
		expect(() => new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
			contentRepository: { adapter: 'treedb' },
		})).toThrow(/requires treeDb configuration/iu);
	});

	it('keeps AgentSdk.createLocal on local content', () => {
		const repoRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-local-'));
		mkdirSync(resolve(repoRoot, 'src', 'content'), { recursive: true });
		const sdk = AgentSdk.createLocal({ repoRoot, persistTo: ':memory:' });

		expect(sdk.content).toBeInstanceOf(LocalContentBackend);
	});

	it('keeps explicit local content selection local', () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			contentRepository: { adapter: 'local' },
		});

		expect(sdk.content).toBeInstanceOf(LocalContentBackend);
	});

	it('uses TreeDB content adapters when TreeDB mode is explicitly configured', () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			treeDb: {
				enabled: true,
				baseUrl: 'http://treedb.test',
				repoId: 'repo-a',
				defaultRef: 'refs/heads/main',
			},
		});

		expect(sdk.content).toBeInstanceOf(TreeDbRepositoryAdapter);
		expect(sdk.treeDb?.repoId).toBe('repo-a');
	});

	it('discovers repositories through the portfolio before repo-scoped reads', async () => {
		const transport = new RecordingTransport(contentHandler);
		const backend = makeBackend({
			transport,
			contentPathMap: { page: 'src/content/pages/**' },
		});

		const items = await backend.list('page');

		expect(items.map((item) => item.slug).sort()).toEqual(['a-page', 'b-page']);
		expect(transport.requests[0]).toMatchObject({ method: 'GET', path: '/api/v1/repos' });
		expect(transport.requests.some((request) => request.path === '/api/v1/repos/repo-a/paths/list')).toBe(true);
		expect(transport.requests.some((request) => request.path === '/api/v1/repos/repo-a/files/read')).toBe(true);
	});

	it('aggregates search across multiple repository candidates', async () => {
		const transport = new RecordingTransport(contentHandler);
		const backend = makeBackend({
			transport,
			contentPathMap: { page: 'src/content/pages/**' },
		});

		const items = await backend.search({
			model: 'page',
			filters: [{ field: 'title', op: 'contains', value: 'page' }],
		});

		expect(items).toHaveLength(2);
		expect(new Set(items.map((item) => item.path))).toEqual(new Set([
			'src/content/pages/a-page.mdx',
			'src/content/pages/b-page.mdx',
		]));
	});

	it('fails ambiguous writes before requiring callers to choose a single repository or workspace', async () => {
		const transport = new RecordingTransport(contentHandler);
		const backend = makeBackend({
			transport,
			contentPathMap: { page: 'src/content/pages/**' },
		});

		await expect(backend.create({
			model: 'page',
			actor: 'tester',
			data: { slug: 'new-page', title: 'New page' },
		})).rejects.toThrow(/Ambiguous TreeDB repository candidates/u);
	});

	it('uses workspace file endpoints for writes when workspace id is configured', async () => {
		const transport = new RecordingTransport((request) => {
			if (request.method === 'GET' && request.path === '/api/v1/repos') {
				return { items: [{ id: 'repo-a', name: 'content-a' }] };
			}
			return {};
		});
		const backend = makeBackend({
			transport,
			workspaceId: 'workspace-1',
			contentPathMap: { page: 'src/content/pages/**' },
		});

		await backend.create({
			model: 'page',
			actor: 'tester',
			data: { slug: 'new-page', title: 'New page', body: 'body' },
		});

		expect(transport.requests.some((request) =>
			request.method === 'PUT' && request.path === '/api/v1/workspaces/workspace-1/files',
		)).toBe(true);
	});

	it('preserves TreeDbApiError failures from the local TreeDB client', async () => {
		const error = new TreeDbApiError({
			status: 403,
			code: 'permission_denied',
			message: 'Denied',
			payload: { error: { code: 'permission_denied', message: 'Denied' } },
		});
		const transport = new RecordingTransport((request) => {
			if (request.method === 'GET' && request.path === '/api/v1/repos') return error;
			return {};
		});
		const backend = makeBackend({ transport });

		await expect(backend.list('page')).rejects.toBe(error);
	});

	it('routes primary graph and exec operations through generic TreeDB adapters', async () => {
		const transport = new RecordingTransport((request) => {
			if (request.method === 'GET' && request.path === '/api/v1/repos') {
				return { items: [{ id: 'repo-a', name: 'content-a' }] };
			}
			return {};
		});
		const client = makeTreeDbClient(transport);
		const resolver = new TreeDbPortfolioResolver({ client });
		const graph = new TreeDbGraphBackend({
			client,
			resolver,
			localRuntime: new ContentGraphRuntime(sdkFixtureRoot, buildScopedModelRegistry(sdkFixtureRoot)),
		});
		const exec = new TreeDbExecBackend(client, 'workspace-1');

		await graph.refresh();
		await graph.queryGraph({ query: 'hello' });
		await graph.buildContextPack({ query: 'hello' });
		await exec.run({ command: 'true' });

		expect(transport.requests.some((request) => request.path === '/api/v1/repos/repo-a/graph/refresh')).toBe(true);
		expect(transport.requests.some((request) => request.path === '/api/v1/graph/query')).toBe(true);
		expect(transport.requests.some((request) => request.path === '/api/v1/context/build')).toBe(true);
		expect(transport.requests.some((request) => request.path === '/api/v1/workspaces/workspace-1/exec')).toBe(true);
	});

	it('keeps site and optional repository operations free of TreeDB SDK imports', async () => {
		const { readFileSync } = await import('node:fs');
		const source = readFileSync(resolve(process.cwd(), 'src', 'operations', 'repository-operations.ts'), 'utf8');
		const forbiddenImport = ['@treedb', 'ts-sdk'].join('/');

		expect(source).not.toContain(forbiddenImport);
	});
});
