import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ContentStore } from '../../../src/content-store.ts';
import { MemoryAgentDatabase } from '../../../src/d1-store.ts';
import { ContentGraphRuntime } from '../../../src/graph.ts';
import { AgentSdk } from '../../../src/sdk.ts';
import { TreeDxApiError, TreeDxClient } from '../../../src/treedx/index.ts';
import {
	LocalContentBackend,
	TreeDxContentBackend,
	TreeDxContentRepositoryConfigError,
	TreeDxExecBackend,
	TreeDxGraphBackend,
	TreeDxPortfolioResolver,
	resolveTreeDxOptions,
} from '../../../src/treedx-backends.ts';
import { buildScopedModelRegistry } from '../../../src/model-registry.ts';
import { sdkFixtureRoot } from '../../support/test-fixture.ts';

interface RecordedTreeDxRequest {
	method: string;
	path: string;
	query: Record<string, string>;
	body?: unknown;
}

class RecordingTransport {
	readonly requests: RecordedTreeDxRequest[] = [];

	constructor(private readonly handler: (request: RecordedTreeDxRequest) => unknown) {}

	readonly fetch = async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
		const request: RecordedTreeDxRequest = {
			method: init?.method ?? 'GET',
			path: url.pathname,
			query: Object.fromEntries(url.searchParams.entries()),
			...(typeof init?.body === 'string' ? { body: JSON.parse(init.body) } : {}),
		};
		this.requests.push(request);
		const data = this.handler(request);
		if (data instanceof TreeDxApiError) {
			return new Response(JSON.stringify({
				error: { code: data.code, message: data.message, details: data.details },
			}), {
				status: data.status,
				headers: { 'content-type': 'application/json' },
			});
		}
		return new Response(JSON.stringify(data), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	};
}

function makeTreeDxClient(transport: RecordingTransport) {
	return new TreeDxClient({
		baseUrl: 'http://treedx.test',
		token: 'test-token',
		fetch: transport.fetch as typeof fetch,
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
	const client = makeTreeDxClient(options.transport);
	const resolver = new TreeDxPortfolioResolver({
		client,
		ref: 'refs/heads/main',
	});
	return new TreeDxContentBackend({
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

function contentHandler(request: RecordedTreeDxRequest) {
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

describe('TreeDX-backed TreeSeed content repository', () => {
	it('selects TreeDX content by default when TreeDX service config is present', () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			treeDx: { baseUrl: 'http://treedx.test' },
		});

		expect(sdk.content).toBeInstanceOf(TreeDxContentBackend);
	});

	it('fails clearly on default content access when TreeDX service config is absent', async () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		await expect(sdk.search({ model: 'knowledge', limit: 1 }))
			.rejects
			.toBeInstanceOf(TreeDxContentRepositoryConfigError);
	});

	it('keeps AgentSdk.createLocal TreeDX-required by default', async () => {
		const repoRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-local-'));
		mkdirSync(resolve(repoRoot, 'src', 'content'), { recursive: true });
		const sdk = AgentSdk.createLocal({ repoRoot, persistTo: ':memory:' });

		await expect(sdk.search({ model: 'knowledge', limit: 1 }))
			.rejects
			.toBeInstanceOf(TreeDxContentRepositoryConfigError);
	});

	it('keeps explicit AgentSdk.createLocal filesystem content selection local', () => {
		const repoRoot = mkdtempSync(resolve(tmpdir(), 'treeseed-sdk-local-'));
		mkdirSync(resolve(repoRoot, 'src', 'content'), { recursive: true });
		const sdk = AgentSdk.createLocal({
			repoRoot,
			persistTo: ':memory:',
			contentRepository: { adapter: 'local' },
		});

		expect(sdk.content).toBeInstanceOf(LocalContentBackend);
	});

	it('keeps explicit local content selection local', () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			contentRepository: { adapter: 'local' },
		});

		expect(sdk.content).toBeInstanceOf(LocalContentBackend);
	});

	it('accepts TREESEED_TREEDX_URL as a local TreeDX base URL', () => {
		const previousBaseUrl = process.env.TREESEED_TREEDX_BASE_URL;
		const previousUrl = process.env.TREESEED_TREEDX_URL;
		try {
			delete process.env.TREESEED_TREEDX_BASE_URL;
			process.env.TREESEED_TREEDX_URL = 'http://local-treedx.test';

			expect(resolveTreeDxOptions()?.baseUrl).toBe('http://local-treedx.test');
		} finally {
			if (previousBaseUrl === undefined) delete process.env.TREESEED_TREEDX_BASE_URL;
			else process.env.TREESEED_TREEDX_BASE_URL = previousBaseUrl;
			if (previousUrl === undefined) delete process.env.TREESEED_TREEDX_URL;
			else process.env.TREESEED_TREEDX_URL = previousUrl;
		}
	});

	it('prefers TREESEED_TREEDX_BASE_URL over TREESEED_TREEDX_URL', () => {
		const previousBaseUrl = process.env.TREESEED_TREEDX_BASE_URL;
		const previousUrl = process.env.TREESEED_TREEDX_URL;
		try {
			process.env.TREESEED_TREEDX_BASE_URL = 'http://base-treedx.test';
			process.env.TREESEED_TREEDX_URL = 'http://local-treedx.test';

			expect(resolveTreeDxOptions()?.baseUrl).toBe('http://base-treedx.test');
		} finally {
			if (previousBaseUrl === undefined) delete process.env.TREESEED_TREEDX_BASE_URL;
			else process.env.TREESEED_TREEDX_BASE_URL = previousBaseUrl;
			if (previousUrl === undefined) delete process.env.TREESEED_TREEDX_URL;
			else process.env.TREESEED_TREEDX_URL = previousUrl;
		}
	});

	it('does not require a repo id in TreeDX config', () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			treeDx: {
				baseUrl: 'http://treedx.test',
				ref: 'refs/heads/main',
			},
		});

		expect(sdk.content).toBeInstanceOf(TreeDxContentBackend);
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
		})).rejects.toThrow(/Ambiguous TreeDX repository candidates/u);
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

	it('preserves TreeDxApiError failures from the local TreeDX client', async () => {
		const error = new TreeDxApiError('Denied', {
			status: 403,
			code: 'permission_denied',
			payload: { error: { code: 'permission_denied', message: 'Denied' } },
		});
		const transport = new RecordingTransport((request) => {
			if (request.method === 'GET' && request.path === '/api/v1/repos') return error;
			return {};
		});
		const backend = makeBackend({ transport });

		await expect(backend.list('page')).rejects.toMatchObject({
			name: 'TreeDxApiError',
			status: 403,
			code: 'permission_denied',
			message: 'Denied',
		});
	});

	it('routes primary graph and exec operations through generic TreeDX adapters', async () => {
		const transport = new RecordingTransport((request) => {
			if (request.method === 'GET' && request.path === '/api/v1/repos') {
				return { items: [{ id: 'repo-a', name: 'content-a' }] };
			}
			return {};
		});
		const client = makeTreeDxClient(transport);
		const resolver = new TreeDxPortfolioResolver({ client });
		const graph = new TreeDxGraphBackend({
			client,
			resolver,
			localRuntime: new ContentGraphRuntime(sdkFixtureRoot, buildScopedModelRegistry(sdkFixtureRoot)),
		});
		const exec = new TreeDxExecBackend(client, 'workspace-1');

		await graph.refresh();
		await graph.queryGraph({ query: 'hello' });
		await graph.buildContextPack({ query: 'hello' });
		await exec.run({ command: 'true' });

		expect(transport.requests.some((request) => request.path === '/api/v1/repos/repo-a/graph/refresh')).toBe(true);
		expect(transport.requests.some((request) => request.path === '/api/v1/graph/query')).toBe(true);
		expect(transport.requests.some((request) => request.path === '/api/v1/context/build')).toBe(true);
		expect(transport.requests.some((request) => request.path === '/api/v1/workspaces/workspace-1/exec')).toBe(true);
	});

	it('uses repo-scoped graph endpoints when TreeDX config binds a repository', async () => {
		const transport = new RecordingTransport(() => ({}));
		const client = makeTreeDxClient(transport);
		const resolver = new TreeDxPortfolioResolver({ client, repoId: 'repo-scoped' });
		const graph = new TreeDxGraphBackend({
			client,
			resolver,
			directRepoId: 'repo-scoped',
			ref: 'refs/heads/main',
			localRuntime: new ContentGraphRuntime(sdkFixtureRoot, buildScopedModelRegistry(sdkFixtureRoot)),
		});

		await graph.queryGraph({ query: 'planning' });
		await graph.buildContextPack({ query: 'planning' });

		expect(transport.requests).toEqual([
			expect.objectContaining({
				method: 'POST',
				path: '/api/v1/repos/repo-scoped/graph/query',
				body: expect.objectContaining({ query: 'planning', ref: 'refs/heads/main' }),
			}),
			expect.objectContaining({
				method: 'POST',
				path: '/api/v1/repos/repo-scoped/context/build',
				body: expect.objectContaining({ query: 'planning', ref: 'refs/heads/main' }),
			}),
		]);
		expect(transport.requests.some((request) => request.path === '/api/v1/context/build')).toBe(false);
		expect(transport.requests.some((request) => request.path === '/api/v1/graph/query')).toBe(false);
	});

	it('refreshes and retries a repo-scoped context build when the graph is not ready', async () => {
		let contextAttempts = 0;
		const transport = new RecordingTransport((request) => {
			if (request.path === '/api/v1/repos/repo-scoped/context/build') {
				contextAttempts += 1;
				if (contextAttempts === 1) {
					return new TreeDxApiError('Graph is not ready.', {
						status: 404,
						code: 'graph_not_ready',
					});
				}
			}
			return {};
		});
		const client = makeTreeDxClient(transport);
		const resolver = new TreeDxPortfolioResolver({ client, repoId: 'repo-scoped' });
		const graph = new TreeDxGraphBackend({
			client,
			resolver,
			directRepoId: 'repo-scoped',
			ref: 'refs/heads/main',
			localRuntime: new ContentGraphRuntime(sdkFixtureRoot, buildScopedModelRegistry(sdkFixtureRoot)),
		});

		await graph.buildContextPack({ query: 'planning' });

		expect(transport.requests.map((request) => request.path)).toEqual([
			'/api/v1/repos/repo-scoped/context/build',
			'/api/v1/repos/repo-scoped/graph/refresh',
			'/api/v1/repos/repo-scoped/context/build',
		]);
	});

	it('keeps site and optional repository operations free of TreeDX SDK imports', async () => {
		const { readFileSync } = await import('node:fs');
		const source = readFileSync(resolve(process.cwd(), 'src', 'operations', 'repository-operations.ts'), 'utf8');

		expect(source).not.toContain(['@treedx', 'ts-sdk'].join('/'));
		expect(source).not.toContain(['@treeseed', 'treedx'].join('/'));
	});
});
