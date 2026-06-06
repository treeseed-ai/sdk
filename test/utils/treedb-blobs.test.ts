import { describe, expect, it, vi } from 'vitest';
import { TreeDbApiError, TreeDbClient } from '../../src/treedb/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function binary(payload: Uint8Array, headers: Record<string, string> = {}) {
	return new Response(payload, {
		status: 200,
		headers: {
			'content-type': 'application/octet-stream',
			...headers,
		},
	});
}

function mockClient(payloads: Response[]) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		const response = payloads.shift();
		if (!response) {
			throw new Error('missing mocked response');
		}
		return response;
	});

	const client = new TreeDbClient({
		baseUrl: 'https://treedb.example.test/',
		token: 'token-123',
		repoId: 'repo_1',
		fetch: fetchImpl as typeof fetch,
	});

	return { client, calls };
}

describe('TreeDbClient blob helpers', () => {
	it('reads and writes JSON blob envelopes', async () => {
		const { client, calls } = mockClient([
			json({
				ok: true,
				blob: {
					path: 'assets/logo.bin',
					encoding: 'base64',
					contentBase64: 'AQID',
					contentHash: 'blake3:hash',
					byteLength: 3,
					contentType: 'application/octet-stream',
					source: 'base',
				},
			}),
			json({
				ok: true,
				result: {
					workspaceId: 'ws_1',
					path: 'assets/logo.bin',
					op: 'put',
					contentHash: 'blake3:hash',
					byteLength: 3,
					contentType: 'application/octet-stream',
				},
			}),
			json({ ok: true, result: { workspaceId: 'ws_1', path: 'assets/logo.bin', op: 'delete' } }),
		]);

		await expect(client.readBlob({ path: 'assets/logo.bin' })).resolves.toMatchObject({
			contentBase64: 'AQID',
			contentHash: 'blake3:hash',
		});
		await expect(
			client.writeBlob({
				workspaceId: 'ws_1',
				path: 'assets/logo.bin',
				contentBase64: 'AQID',
				contentType: 'application/octet-stream',
			}),
		).resolves.toMatchObject({ op: 'put' });
		await expect(client.deleteBlob({ workspaceId: 'ws_1', path: 'assets/logo.bin' })).resolves.toMatchObject({
			op: 'delete',
		});

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedb.example.test/api/v1/repos/repo_1/blobs/read',
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/write',
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/delete',
		]);
		expect(JSON.parse(String(calls[1]?.init.body))).toMatchObject({
			path: 'assets/logo.bin',
			encoding: 'base64',
			contentBase64: 'AQID',
		});
	});

	it('downloads and uploads raw blob bytes', async () => {
		const { client, calls } = mockClient([
			binary(new Uint8Array([1, 2, 3]), {
				'x-treedb-content-hash': 'blake3:hash',
				'x-treedb-object-id': 'abc123',
				'x-treedb-source': 'workspace',
			}),
			json({
				ok: true,
				result: {
					workspaceId: 'ws_1',
					path: 'assets/upload.bin',
					op: 'put',
					contentHash: 'blake3:upload',
					byteLength: 2,
				},
			}),
		]);

		const downloaded = await client.downloadBlob({ workspaceId: 'ws_1', path: 'assets/logo.bin' });
		expect(new Uint8Array(downloaded.content)).toEqual(new Uint8Array([1, 2, 3]));
		expect(downloaded.contentHash).toBe('blake3:hash');
		expect(downloaded.objectId).toBe('abc123');
		expect(downloaded.source).toBe('workspace');

		await expect(
			client.uploadBlob({
				workspaceId: 'ws_1',
				path: 'assets/upload.bin',
				content: new Uint8Array([4, 5]),
				contentType: 'application/octet-stream',
				expectedContentHash: 'blake3:expected',
			}),
		).resolves.toMatchObject({ op: 'put', contentHash: 'blake3:upload' });

		expect(calls[0]?.url).toBe(
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/download?path=assets%2Flogo.bin',
		);
		expect(calls[1]?.url).toBe(
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/upload?path=assets%2Fupload.bin',
		);
		expect((calls[1]?.init.headers as Record<string, string>)['x-treedb-expected-content-hash']).toBe(
			'blake3:expected',
		);
		expect(calls[1]?.init.body).toBeInstanceOf(Uint8Array);
	});

	it('maps blob error envelopes to TreeDbApiError', async () => {
		const { client } = mockClient([
			json({ ok: false, error: { code: 'workspace_revoked', message: 'Workspace policy has been revoked.' } }, 409),
		]);

		const error = await client
			.downloadBlob({ workspaceId: 'ws_1', path: 'assets/logo.bin' })
			.then(() => undefined, (caught: unknown) => caught);
		expect(error).toBeInstanceOf(TreeDbApiError);
		expect(error).toMatchObject({ code: 'workspace_revoked', status: 409 });
	});

	it('calls multipart upload and artifact lifecycle endpoints', async () => {
		const { client, calls } = mockClient([
			json({ ok: true, upload: { uploadId: 'upload_1', workspaceId: 'ws_1', path: 'assets/large.bin', createdAt: 'now', expiresAt: 'later', status: 'open' } }),
			json({ ok: true, part: { uploadId: 'upload_1', workspaceId: 'ws_1', partNumber: 1, byteLength: 2, contentHash: 'blake3:part', createdAt: 'now' } }),
			json({ ok: true, result: { workspaceId: 'ws_1', path: 'assets/large.bin', op: 'put', byteLength: 2 }, upload: { uploadId: 'upload_1', status: 'completed' } }),
			json({ ok: true, upload: { uploadId: 'upload_2', workspaceId: 'ws_1', path: 'assets/abort.bin', createdAt: 'now', expiresAt: 'later', status: 'aborted' } }),
			json({ ok: true, artifacts: [{ artifactId: 'artifact_1', snapshotId: 'snap_1', repoId: 'repo_1', format: 'tar.zst', size: 1, checksum: 'blake3:a', uri: 'treedb://artifact/snap_1' }] }),
			json({ ok: true, artifact: { artifactId: 'artifact_1', snapshotId: 'snap_1', repoId: 'repo_1', format: 'tar.zst', size: 1, checksum: 'blake3:a', uri: 'treedb://artifact/snap_1' } }),
			json({ ok: true, artifact: { artifactId: 'artifact_1', snapshotId: 'snap_1', repoId: 'repo_1', format: 'tar.zst', size: 1, checksum: 'blake3:a', uri: 'treedb://artifact/snap_1', status: 'deleted' } }),
			json({ ok: true, cleanup: { deletedCount: 1, retentionDays: 30 } }),
		]);

		await expect(client.createBlobUpload({ workspaceId: 'ws_1', path: 'assets/large.bin' })).resolves.toMatchObject({ uploadId: 'upload_1' });
		await expect(client.uploadBlobPart({ workspaceId: 'ws_1', uploadId: 'upload_1', partNumber: 1, content: new Uint8Array([1, 2]) })).resolves.toMatchObject({ partNumber: 1 });
		await expect(client.completeBlobUpload({ workspaceId: 'ws_1', uploadId: 'upload_1' })).resolves.toMatchObject({ op: 'put' });
		await expect(client.abortBlobUpload({ workspaceId: 'ws_1', uploadId: 'upload_2' })).resolves.toMatchObject({ status: 'aborted' });
		await expect(client.listArtifacts()).resolves.toHaveLength(1);
		await expect(client.getArtifact({ artifactId: 'artifact_1' })).resolves.toMatchObject({ artifactId: 'artifact_1' });
		await expect(client.deleteArtifact({ artifactId: 'artifact_1' })).resolves.toMatchObject({ status: 'deleted' });
		await expect(client.cleanupArtifacts({ retentionDays: 30 })).resolves.toMatchObject({ deletedCount: 1 });

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/uploads',
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/uploads/upload_1/parts/1',
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/uploads/upload_1/complete',
			'https://treedb.example.test/api/v1/workspaces/ws_1/blobs/uploads/upload_2',
			'https://treedb.example.test/api/v1/repos/repo_1/artifacts',
			'https://treedb.example.test/api/v1/repos/repo_1/artifacts/artifact_1',
			'https://treedb.example.test/api/v1/repos/repo_1/artifacts/artifact_1',
			'https://treedb.example.test/api/v1/admin/artifacts/cleanup',
		]);
		expect(calls[1]?.init.method).toBe('PUT');
		expect(calls[1]?.init.body).toBeInstanceOf(Uint8Array);
		expect(calls[3]?.init.method).toBe('DELETE');
	});
});
