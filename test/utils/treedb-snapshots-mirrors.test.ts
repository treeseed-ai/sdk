import { describe, expect, it, vi } from 'vitest';
import { TreeDbApiError, TreeDbClient } from '../../src/treedb/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function binary(bytes: Uint8Array) {
	return new Response(bytes, {
		status: 200,
		headers: {
			'content-type': 'application/zstd',
			'content-disposition': 'attachment; filename="treedb-repo_1-snap_1.tar.zst"',
			'x-treedb-snapshot-id': 'snap_1',
			'x-treedb-artifact-checksum': 'blake3:abc',
		},
	});
}

describe('TreeDB snapshots, mirrors, and migrations client methods', () => {
	it('maps TreeDB snapshot, mirror, and migration endpoints and sends bearer auth', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, init: init ?? {} });

			if (url.endsWith('/snapshots/build')) {
				return json({ ok: true, snapshot: { snapshotId: 'snap_1', repoId: 'repo_1', ref: 'refs/heads/main', commitSha: 'abc', kind: 'repository_snapshot', includedPaths: ['docs/**'], fileCount: 1, totalBytes: 12, checksums: {}, createdAt: '2026-06-01T00:00:00Z' } });
			}
			if (url.endsWith('/snapshots/snap_1')) {
				return json({ ok: true, snapshot: { snapshotId: 'snap_1', repoId: 'repo_1', ref: 'refs/heads/main', commitSha: 'abc', kind: 'repository_snapshot', includedPaths: ['docs/**'], fileCount: 1, totalBytes: 12, checksums: {}, createdAt: '2026-06-01T00:00:00Z' } });
			}
			if (url.endsWith('/artifacts/export')) {
				return json({ ok: true, artifact: { artifactId: 'artifact_1', snapshotId: 'snap_1', repoId: 'repo_1', format: 'tar.zst', size: 42, checksum: 'blake3:abc', uri: 'treedb://artifact/snap_1' } });
			}
			if (url.endsWith('/mirrors/mirror_1/sync')) {
				return json({ ok: true, mirror: { id: 'mirror_1', sourceNodeId: 'node_a', targetNodeId: 'node_b', mode: 'read_replica', status: 'synced' }, sync: { id: 'msync_1', status: 'synced' } });
			}
			if (url.endsWith('/migrations')) {
				return json({ ok: true, migration: { id: 'mig_1', repositoryId: 'repo_1', sourceNodeId: 'node_a', targetNodeId: 'node_b', mode: 'primary_transfer', status: 'planned', dryRun: true, requireMirrorSynced: false, createdAt: '2026-06-01T00:00:00Z' } });
			}
			if (url.endsWith('/migrations/mig_1')) {
				return json({ ok: true, migration: { id: 'mig_1', repositoryId: 'repo_1', sourceNodeId: 'node_a', targetNodeId: 'node_b', mode: 'primary_transfer', status: 'planned', dryRun: true, requireMirrorSynced: false, createdAt: '2026-06-01T00:00:00Z' } });
			}
			return json({ ok: true });
		});
		const client = new TreeDbClient({ baseUrl: 'https://treedb.example.test', token: 'token', repoId: 'repo_1', fetch: fetchMock as typeof fetch });

		await expect(client.buildSnapshot({ paths: ['docs/**'] })).resolves.toMatchObject({ snapshotId: 'snap_1' });
		await expect(client.getSnapshot({ snapshotId: 'snap_1' })).resolves.toMatchObject({ snapshotId: 'snap_1' });
		await expect(client.exportArtifact({ snapshotId: 'snap_1' })).resolves.toMatchObject({ artifactId: 'artifact_1' });
		await expect(client.syncMirror({ mirrorId: 'mirror_1', dryRun: true })).resolves.toMatchObject({ sync: { status: 'synced' } });
		await expect(client.createMigration({ targetNodeId: 'node_b', dryRun: true, requireMirrorSynced: false })).resolves.toMatchObject({ migration: { id: 'mig_1' } });
		await expect(client.getMigration({ migrationId: 'mig_1' })).resolves.toMatchObject({ id: 'mig_1' });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedb.example.test/api/v1/repos/repo_1/snapshots/build',
			'https://treedb.example.test/api/v1/repos/repo_1/snapshots/snap_1',
			'https://treedb.example.test/api/v1/repos/repo_1/artifacts/export',
			'https://treedb.example.test/api/v1/repos/repo_1/mirrors/mirror_1/sync',
			'https://treedb.example.test/api/v1/repos/repo_1/migrations',
			'https://treedb.example.test/api/v1/repos/repo_1/migrations/mig_1',
		]);
		expect(calls.every((call) => (call.init.headers as Record<string, string>).authorization === 'Bearer token')).toBe(true);
	});

	it('downloads artifact bytes with metadata headers', async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push({ url: String(input), init: init ?? {} });
			return binary(new Uint8Array([1, 2, 3]));
		});
		const client = new TreeDbClient({ baseUrl: 'https://treedb.example.test', token: 'token', repoId: 'repo_1', fetch: fetchMock as typeof fetch });

		const download = await client.downloadArtifact({ snapshotId: 'snap_1' });

		expect(calls[0]?.url).toBe('https://treedb.example.test/api/v1/repos/repo_1/artifacts/export?download=true');
		expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ snapshotId: 'snap_1' });
		expect(download.content.byteLength).toBe(3);
		expect(download.contentType).toBe('application/zstd');
		expect(download.filename).toBe('treedb-repo_1-snap_1.tar.zst');
		expect(download.checksum).toBe('blake3:abc');
		expect(download.snapshotId).toBe('snap_1');
	});

	it('throws TreeDbApiError for binary download error envelopes', async () => {
		const client = new TreeDbClient({
			baseUrl: 'https://treedb.example.test',
			token: 'token',
			repoId: 'repo_1',
			fetch: (async () => json({ ok: false, error: { code: 'artifact_not_found', message: 'Artifact not found.' } }, 404)) as typeof fetch,
		});

		await expect(client.downloadArtifact({ snapshotId: 'missing' })).rejects.toMatchObject<TreeDbApiError>({
			status: 404,
			code: 'artifact_not_found',
		});
	});
});
