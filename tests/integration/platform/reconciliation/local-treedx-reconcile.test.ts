import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalTreeDxReconciliationClient } from '../../../../src/reconcile/builtin-adapters/projects/knowledge/verify-local-tree-dx-project-content.ts';
import { refreshLocalTreeDxProjectIndexes, syncLocalTreeDxProjectContent } from '../../../../src/reconcile/builtin-adapters/capacity/providers/build-capacity-provider-adapter.ts';

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
			refreshSearchIndex: vi.fn().mockResolvedValue({ resolvedRef: 'stale-commit', indexVersion: 'search-1', stale: false }),
		};
		await expect(refreshLocalTreeDxProjectIndexes(client as any, {
			slug: 'admin', repositoryName: 'treeseed-admin', repositoryId: 'repo-1', localRoot: '/tmp/admin',
			contentPath: 'docs/src/content', defaultRef: 'refs/heads/main',
		}, 'repo-1', 'commit-1')).rejects.toThrow('did not resolve the reconciled commit');
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
