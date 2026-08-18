import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildLocalTreeDxAdapter, createLocalTreeDxReconciliationClient } from '../../../../src/reconcile/builtin-adapters/projects/knowledge/verify-local-tree-dx-project-content.ts';
import { refreshLocalTreeDxProjectIndexes, syncLocalTreeDxProjectContent } from '../../../../src/reconcile/builtin-adapters/capacity/providers/build-capacity-provider-adapter.ts';
import { observeUnpublishedTreeDxAuthoring,syncRemoteTreeDxProjectContent } from '../../../../src/reconcile/builtin-adapters/projects/knowledge/reconcile-remote-tree-dx-content.ts';

function healthResponse() {
	return new Response(JSON.stringify({
		ok: true,
		status: 'ok',
		service: 'treedx-api',
	}), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

describe('local TreeDX reconciliation transport', () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it('allows a cold repository operation to continue beyond the generic 30-second boundary', async () => {
		vi.useFakeTimers();
		let resolveRequest: ((response: Response) => void) | undefined;
		let aborted = false;
		const client = createLocalTreeDxReconciliationClient(
			'http://treedx.example.test',
			'token',
			((_, init) => new Promise<Response>((resolve, reject) => {
				resolveRequest = resolve;
				init?.signal?.addEventListener('abort', () => {
					aborted = true;
					reject(new DOMException('aborted', 'AbortError'));
				});
			})) as typeof fetch,
		);

		const request = client.health();
		await vi.advanceTimersByTimeAsync(30_001);

		expect(aborted).toBe(false);
		resolveRequest?.(healthResponse());
		await expect(request).resolves.toMatchObject({ status: 'ok' });
	});

	it('remains bounded when TreeDX never responds', async () => {
		vi.useFakeTimers();
		const client = createLocalTreeDxReconciliationClient(
			'http://treedx.example.test',
			'token',
			((_, init) => new Promise<Response>((_resolve, reject) => {
				init?.signal?.addEventListener('abort', () => {
					reject(new DOMException('aborted', 'AbortError'));
				});
			})) as typeof fetch,
		);

		const request = client.health();
		const expectation = expect(request).rejects.toMatchObject({
			code: 'timeout',
			status: 0,
			details: { timeoutMs: 120_000 },
		});
		await vi.advanceTimersByTimeAsync(120_000);
		await expectation;
	});

	it('waits for graph completion and proves search parity with the reconciled commit', async () => {
		const client = {
			refreshGraph: vi.fn().mockResolvedValue({ jobId: 'job-1', resolvedRef: 'commit-1', stale: false }),
			getGraphRefreshJob: vi.fn().mockResolvedValue({ status: 'completed', graphVersion: 'graph-1', stale: false }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ resolvedRef: 'commit-1', sourceCommit: 'commit-1', indexVersion: 'search-1', stale: false }),
		};
		const result = await refreshLocalTreeDxProjectIndexes(client as any, {
			slug: 'admin', repositoryName: 'treeseed-admin', repositoryId: 'repo-1', localRoot: '/tmp/admin',
			contentPath: 'docs/src/content', defaultRef: 'refs/heads/main', seedPaths: ['docs/src/content'],
		}, 'repo-1', 'commit-1');

		expect(client.refreshGraph).toHaveBeenCalledWith(expect.objectContaining({ ref: 'refs/heads/main', forceFull: true }));
		expect(client.getGraphRefreshJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'job-1' }));
		expect(client.refreshSearchIndex).toHaveBeenCalledWith(expect.objectContaining({ paths: ['docs/src/content/**'] }));
		expect(result.searchIndex).toMatchObject({ indexVersion: 'search-1' });
	});

	it('fails closed when search resolves a different commit', async () => {
		const client = {
			refreshGraph: vi.fn().mockResolvedValue({ resolvedRef: 'commit-1', graphVersion: 'graph-1', stale: false }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ resolvedRef: 'commit-1', sourceCommit: 'stale-commit', indexVersion: 'search-1', stale: false }),
		};
		await expect(refreshLocalTreeDxProjectIndexes(client as any, {
			slug: 'admin', repositoryName: 'treeseed-admin', repositoryId: 'repo-1', localRoot: '/tmp/admin',
			contentPath: 'docs/src/content', defaultRef: 'refs/heads/main',
		}, 'repo-1', 'commit-1')).rejects.toThrow('did not resolve the reconciled commit');
	});

	it('plans recovery for a local repository when its search index is stale', () => {
		const sha = 'a'.repeat(40);
		const adapter = buildLocalTreeDxAdapter();
		const diff = adapter.diff({
			unit: { spec: { projects: [{ slug: 'market', repositoryName: 'market', repositoryId: 'market',
				localRoot: '/unused', contentPath: 'src/content' }] } },
			observed: { status: 'ready', warnings: [], live: { registeredRepositoryNames: ['market'], repositoryObservations: [{
				project: 'market', remoteHead: sha, localHead: sha, searchReady: true, searchStale: true,
				searchResolvedHead: sha, searchSourceHead: 'b'.repeat(40),
			}] } },
			persistedState: { lastReconciledAt: '2026-08-12T00:00:00.000Z', desiredSpecHash: 'unchanged' },
		} as any);

		expect(diff).toMatchObject({ action: 'update' });
		expect(diff.reasons).toContain('TreeDX graph/search indexes differ from content refs: market');
	});

	it('blocks reconciliation when the exact divergent TreeDX head is journaled as unpublished', () => {
		const remote = 'a'.repeat(40);
		const local = 'b'.repeat(40);
		const adapter = buildLocalTreeDxAdapter();
		const diff = adapter.diff({
			unit:{ spec:{ projects:[{ slug:'market',repositoryName:'market',repositoryId:'market',localRoot:'/unused',contentPath:'src/content',remoteUrl:'https://github.com/treeseed-ai/market-content.git' }] } },
			observed:{ status:'ready',warnings:[],live:{ registeredRepositoryNames:['market'],repositoryObservations:[{
				project:'market',remoteHead:remote,localHead:local,unpublished:[{ commitSha:local }],
				searchReady:true,searchStale:false,searchResolvedHead:local,searchSourceHead:local,
			}] } },persistedState:{ lastReconciledAt:'2026-08-12T00:00:00.000Z',desiredSpecHash:'unchanged' },
		} as any);
		expect(diff).toMatchObject({ action:'blocked' });
		expect(diff.reasons.join('\n')).toContain('journaled unpublished authoring state: market');
	});

	it('observes unpublished authoring through the authenticated control-plane journal', async () => {
		const commitSha='c'.repeat(40);
		const fetchImpl=vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok:true,payload:{ unpublished:[{ commitSha }] } }),{ status:200,headers:{ 'content-type':'application/json' } }));
		await expect(observeUnpublishedTreeDxAuthoring({
			teamSlug:'treeseed',slug:'market',repositoryName:'market',repositoryId:'market',localRoot:'/unused',contentPath:'src/content',
		},{ TREESEED_API_BASE_URL:'http://127.0.0.1:3000',TREESEED_PLATFORM_RUNNER_SECRET:'runner-secret' } as NodeJS.ProcessEnv,fetchImpl)).resolves.toEqual([{ commitSha }]);
		expect(fetchImpl).toHaveBeenCalledWith(expect.objectContaining({ pathname:'/v1/internal/treedx/authoring-journal/status',search:expect.stringContaining('projectSlug=market') }),expect.objectContaining({ headers:expect.objectContaining({ authorization:'Bearer runner-secret' }) }));
	});

	it('fetches the exact live GitHub staging ref before indexing remote content', async () => {
		const sha = 'a'.repeat(40);
		const client = {
			listRepositories: vi.fn().mockResolvedValue([{ repoId: 'repo-admin', repositoryName: 'treeseed-admin' }]),
			fetchRemote: vi.fn().mockResolvedValue({ fetch: { status: 'synced' } }),
			listRepositoryRefs: vi.fn().mockResolvedValue([{ name: 'refs/heads/staging', target: sha }]),
			refreshGraph: vi.fn().mockResolvedValue({ graphVersion: 'graph-1', resolvedRef: sha }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ indexVersion: 'search-1', resolvedRef: sha, stale: false }),
		};
		const fetchImpl = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ object: { sha } }), {
			status: 200, headers: { 'content-type': 'application/json' },
		}));
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchImpl as typeof fetch;
		try {
			const result = await syncRemoteTreeDxProjectContent({
				client: client as any,
				project: {
					slug: 'admin', repositoryName: 'treeseed-admin', repositoryId: 'treeseed-admin', localRoot: '/unused',
					contentPath: 'src/content', defaultRef: 'refs/heads/staging', sourceBranch: 'staging',
					remoteUrl: 'https://github.com/treeseed-ai/admin-content.git', remoteOwner: 'treeseed-ai', remoteName: 'admin-content',
				},
				expectedRemoteHead: sha,
				env: {},
			});
			expect(client.fetchRemote).toHaveBeenCalledWith({
				repoId: 'repo-admin', remoteName: 'origin',
				remoteUrl: 'https://github.com/treeseed-ai/admin-content.git',
				refspecs: ['+refs/heads/staging:refs/heads/staging'],
			});
			expect(result).toMatchObject({ fetched: true, commitSha: sha, ref: 'refs/heads/staging' });
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('brokers a one-use credential id for a private content repository without forwarding the GitHub token', async () => {
		const sha = 'b'.repeat(40);
		const client = {
			listRepositories: vi.fn().mockResolvedValue([{ repoId: 'repo-market-api', repositoryName: 'treeseed-market-api' }]),
			getPlacement: vi.fn().mockResolvedValue({ primaryNodeId: 'node-local' }),
			fetchRemote: vi.fn().mockResolvedValue({ fetch: { status: 'synced' } }),
			listRepositoryRefs: vi.fn().mockResolvedValue([{ name: 'refs/heads/staging', target: sha }]),
			refreshGraph: vi.fn().mockResolvedValue({ graphVersion: 'graph-1', resolvedRef: sha }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ indexVersion: 'search-1', resolvedRef: sha, stale: false }),
		};
		const requests: Array<{ url: string; init?: RequestInit }> = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
			requests.push({ url, init });
			if (url.includes('/v1/internal/treedx/credential-deliveries/prepare')) {
				return new Response(JSON.stringify({ ok: true, payload: { deliveryId: 'opaque-delivery' } }), {
					status: 200, headers: { 'content-type': 'application/json' },
				});
			}
			return new Response(JSON.stringify({ object: { sha } }), {
				status: 200, headers: { 'content-type': 'application/json' },
			});
		}) as typeof fetch;
		try {
			await syncRemoteTreeDxProjectContent({
				client: client as any,
				project: {
					projectKey: 'project:treeseed/market-api', teamSlug: 'treeseed', slug: 'market-api',
					repositoryName: 'treeseed-market-api', repositoryId: 'treeseed-market-api', localRoot: '/unused',
					contentPath: 'src/content', defaultRef: 'refs/heads/staging', sourceBranch: 'staging',
					remoteUrl: 'https://github.com/treeseed-ai/market-api-content.git', remoteOwner: 'treeseed-ai',
					remoteName: 'market-api-content', remoteVisibility: 'private',
				},
				expectedRemoteHead: sha,
				env: { TREESEED_API_BASE_URL: 'http://127.0.0.1:3000', TREESEED_PLATFORM_RUNNER_SECRET: 'runner-secret', TREESEED_GITHUB_TOKEN: 'never-forward' },
			});
			const preparation = requests.find((request) => request.url.includes('/credential-deliveries/prepare'))!;
			expect(preparation.init?.headers).toMatchObject({ authorization: 'Bearer runner-secret' });
			expect(preparation.init?.body).not.toContain('never-forward');
			expect(client.fetchRemote).toHaveBeenCalledWith(expect.objectContaining({ credentialId: 'opaque-delivery' }));
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it('writes only changed seed files and removes stale managed files', async () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-delta-'));
		mkdirSync(join(root, 'docs'), { recursive: true });
		writeFileSync(join(root, 'docs', 'same.md'), 'same');
		writeFileSync(join(root, 'docs', 'changed.md'), 'new');
		const client = {
			listRepositories: vi.fn().mockResolvedValue([{ repoId: 'repo-1', repositoryName: 'example' }]),
			listRepositoryPaths: vi.fn().mockResolvedValue({
				resolvedRef: 'base-sha', entries: [{ path: 'docs/same.md' }, { path: 'docs/changed.md' }, { path: 'docs/stale.md' }],
				page: { hasMore: false },
			}),
			readRepositoryFiles: vi.fn().mockResolvedValue({ resolvedRef: 'base-sha', files: [
				{ path: 'docs/same.md', content: 'same' }, { path: 'docs/changed.md', content: 'old' }, { path: 'docs/stale.md', content: 'stale' },
			] }),
			listRepositoryRefs: vi.fn().mockResolvedValue([]),
			createWorkspace: vi.fn().mockResolvedValue({ workspaceId: 'workspace-1' }),
			writeFiles: vi.fn().mockResolvedValue({ files: [] }), deleteFile: vi.fn().mockResolvedValue({}),
			commit: vi.fn().mockResolvedValue({ commitSha: 'commit-1' }), closeWorkspace: vi.fn().mockResolvedValue(undefined),
			promoteRef: vi.fn().mockResolvedValue({ afterHead: 'commit-1' }), retireRef: vi.fn().mockResolvedValue({ status: 'retired' }),
			refreshGraph: vi.fn().mockResolvedValue({ graphVersion: 'graph-1', resolvedRef: 'commit-1' }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ indexVersion: 'search-1', resolvedRef: 'commit-1', stale: false }),
		};
		try {
			const result = await syncLocalTreeDxProjectContent(client as any, {
				slug: 'example', repositoryName: 'example', repositoryId: 'repo-1', localRoot: root,
				contentPath: 'docs', seedPaths: ['docs'], defaultRef: 'refs/heads/main',
			});
			expect(client.writeFiles).toHaveBeenCalledWith({ workspaceId: 'workspace-1', files: [
				expect.objectContaining({ path: 'docs/changed.md', content: 'new' }),
			] });
			expect(client.deleteFile).toHaveBeenCalledWith({ workspaceId: 'workspace-1', path: 'docs/stale.md' });
			expect(client.promoteRef).toHaveBeenCalledWith(expect.objectContaining({
				destinationRef: 'refs/heads/main', expectedDestinationHead: 'base-sha',
			}));
			expect(client.retireRef).toHaveBeenCalledWith(expect.objectContaining({ expectedHead: 'commit-1' }));
			expect(result).toMatchObject({ changedFiles: 1, removedFiles: 1, commitSha: 'commit-1' });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('repairs graph and search indexes when seed content is already exact', async () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-index-recovery-'));
		mkdirSync(join(root, 'docs'), { recursive: true });
		writeFileSync(join(root, 'docs', 'same.md'), 'same');
		const client = {
			listRepositories: vi.fn().mockResolvedValue([{ repoId: 'repo-1', repositoryName: 'example' }]),
			listRepositoryPaths: vi.fn().mockResolvedValue({ resolvedRef: 'current-sha', entries: [{ path: 'docs/same.md' }], page: { hasMore: false } }),
			readRepositoryFiles: vi.fn().mockResolvedValue({ resolvedRef: 'current-sha', files: [{ path: 'docs/same.md', content: 'same' }] }),
			refreshGraph: vi.fn().mockResolvedValue({ graphVersion: 'graph-current', resolvedRef: 'current-sha' }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ indexVersion: 'search-current', resolvedRef: 'current-sha', stale: false }),
			createWorkspace: vi.fn(),
		};
		try {
			const result = await syncLocalTreeDxProjectContent(client as any, {
				slug: 'example', repositoryName: 'example', repositoryId: 'repo-1', localRoot: root,
				contentPath: 'docs', seedPaths: ['docs'], defaultRef: 'refs/heads/main',
			});
			expect(client.createWorkspace).not.toHaveBeenCalled();
			expect(client.refreshGraph).toHaveBeenCalledWith(expect.objectContaining({ ref: 'refs/heads/main', forceFull: true }));
			expect(client.refreshSearchIndex).toHaveBeenCalledWith(expect.objectContaining({ ref: 'refs/heads/main' }));
			expect(result).toMatchObject({
				committed: false,
				commitSha: 'current-sha',
				graphRefresh: { graphVersion: 'graph-current' },
				searchIndex: { indexVersion: 'search-current' },
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('scopes deterministic seed workspaces to their repository', async () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-project-identity-'));
		mkdirSync(join(root, 'docs'), { recursive: true });
		writeFileSync(join(root, 'docs', 'page.md'), 'shared');
		const client = {
			listRepositories: vi.fn().mockResolvedValue([
				{ repoId: 'repo-platform', repositoryName: 'treeseed-platform' },
				{ repoId: 'repo-template-research', repositoryName: 'treeseed-template-research' },
			]),
			listRepositoryPaths: vi.fn().mockResolvedValue({ resolvedRef: 'base-sha', entries: [], page: { hasMore: false } }),
			listRepositoryRefs: vi.fn().mockResolvedValue([]),
			createWorkspace: vi.fn().mockImplementation(async (input) => ({ workspaceId: input.workspaceId })),
			writeFiles: vi.fn().mockResolvedValue({ files: [] }), commit: vi.fn().mockResolvedValue({ commitSha: 'commit-1' }),
			closeWorkspace: vi.fn().mockResolvedValue(undefined), promoteRef: vi.fn().mockResolvedValue({ afterHead: 'commit-1' }),
			retireRef: vi.fn().mockResolvedValue({ status: 'retired' }),
			refreshGraph: vi.fn().mockResolvedValue({ graphVersion: 'graph-1', resolvedRef: 'commit-1' }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ indexVersion: 'search-1', resolvedRef: 'commit-1', stale: false }),
		};
		try {
			for (const repositoryName of ['treeseed-platform', 'treeseed-template-research']) {
				await syncLocalTreeDxProjectContent(client as any, {
					slug: repositoryName, repositoryName, repositoryId: repositoryName, localRoot: root,
					contentPath: 'docs', seedPaths: ['docs'], defaultRef: 'refs/heads/main',
				});
			}
			const workspaceIds = client.createWorkspace.mock.calls.map(([input]) => input.workspaceId);
			expect(workspaceIds).toHaveLength(2);
			expect(new Set(workspaceIds)).toHaveLength(2);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('writes large seed deltas in bounded TreeDX batches', async () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-write-batches-'));
		mkdirSync(join(root, 'docs'), { recursive: true });
		for (let index = 0; index < 501; index += 1) {
			writeFileSync(join(root, 'docs', `page-${String(index).padStart(3, '0')}.md`), `page ${index}`);
		}
		const client = {
			listRepositories: vi.fn().mockResolvedValue([{ repoId: 'repo-large', repositoryName: 'large' }]),
			listRepositoryPaths: vi.fn().mockResolvedValue({ resolvedRef: 'base-sha', entries: [], page: { hasMore: false } }),
			listRepositoryRefs: vi.fn().mockResolvedValue([]),
			createWorkspace: vi.fn().mockImplementation(async (input) => ({ workspaceId: input.workspaceId })),
			writeFiles: vi.fn().mockResolvedValue({ files: [] }), commit: vi.fn().mockResolvedValue({ commitSha: 'commit-1' }),
			closeWorkspace: vi.fn().mockResolvedValue(undefined), promoteRef: vi.fn().mockResolvedValue({ afterHead: 'commit-1' }),
			retireRef: vi.fn().mockResolvedValue({ status: 'retired' }),
			refreshGraph: vi.fn().mockResolvedValue({ graphVersion: 'graph-1', resolvedRef: 'commit-1' }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ indexVersion: 'search-1', resolvedRef: 'commit-1', stale: false }),
		};
		try {
			await syncLocalTreeDxProjectContent(client as any, {
				slug: 'large', repositoryName: 'large', repositoryId: 'repo-large', localRoot: root,
				contentPath: 'docs', seedPaths: ['docs'], defaultRef: 'refs/heads/main',
			});
			expect(client.writeFiles.mock.calls.map(([input]) => input.files.length)).toEqual([500, 1]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('resumes a committed seed ref and promotes it without recreating the workspace', async () => {
		const root = mkdtempSync(join(tmpdir(), 'local-treedx-resume-'));
		mkdirSync(join(root, 'docs'), { recursive: true });
		writeFileSync(join(root, 'docs', 'page.md'), 'desired');
		const digest = createHash('sha256').update('docs/page.md\0desired\0').digest('hex');
		const branchName = `refs/heads/treeseed-seed-${digest.slice(0, 24)}`;
		const client = {
			listRepositories: vi.fn().mockResolvedValue([{ repoId: 'repo-1', repositoryName: 'example' }]),
			listRepositoryPaths: vi.fn().mockResolvedValue({ resolvedRef: 'base-sha', entries: [{ path: 'docs/page.md' }], page: { hasMore: false } }),
			readRepositoryFiles: vi.fn()
				.mockResolvedValueOnce({ resolvedRef: 'base-sha', files: [{ path: 'docs/page.md', content: 'old' }] })
				.mockResolvedValueOnce({ resolvedRef: 'commit-1', files: [{ path: 'docs/page.md', content: 'desired' }] }),
			listRepositoryRefs: vi.fn().mockResolvedValue([
				{ name: 'refs/heads/main', target: 'base-sha' }, { name: branchName, target: 'commit-1' },
			]),
			promoteRef: vi.fn().mockResolvedValue({ afterHead: 'commit-1' }), retireRef: vi.fn().mockResolvedValue({ status: 'retired' }),
			closeWorkspace: vi.fn().mockResolvedValue(undefined), createWorkspace: vi.fn(),
			refreshGraph: vi.fn().mockResolvedValue({ graphVersion: 'graph-1', resolvedRef: 'commit-1' }),
			refreshSearchIndex: vi.fn().mockResolvedValue({ indexVersion: 'search-1', resolvedRef: 'commit-1', stale: false }),
		};
		try {
			const result = await syncLocalTreeDxProjectContent(client as any, {
				slug: 'example', repositoryName: 'example', repositoryId: 'repo-1', localRoot: root,
				contentPath: 'docs', seedPaths: ['docs'], defaultRef: 'refs/heads/main',
			});
			expect(client.createWorkspace).not.toHaveBeenCalled();
			expect(client.promoteRef).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: branchName, expectedDestinationHead: 'base-sha' }));
			expect(result).toMatchObject({ resumed: true, commitSha: 'commit-1' });
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
