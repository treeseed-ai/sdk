import { describe, expect, it, vi } from 'vitest';
import { TreeDxApiError, TreeDxClient } from '../../src/treedx/index.ts';

function json(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

function mockClient(payloads: Response[]) {
	const calls: Array<{ url: string; init: RequestInit }> = [];
	const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		calls.push({ url: String(input), init: init ?? {} });
		const response = payloads.shift();
		if (!response) throw new Error('missing mocked response');
		return response;
	});
	const client = new TreeDxClient({
		baseUrl: 'https://treedx.example.test',
		token: 'token',
		repoId: 'repo_1',
		fetch: fetchImpl as typeof fetch,
	});
	return { client, calls };
}

describe('TreeDxClient git remote and storage helpers', () => {
	it('pushes, fetches, checks mirror health, promotes mirror, compacts, and backs up storage', async () => {
		const { client, calls } = mockClient([
			json({
				ok: true,
				push: {
					repoId: 'repo_1',
					remoteName: 'origin',
					remoteUrl: 'file://redacted',
					refspecs: ['refs/heads/main:refs/heads/main'],
					backend: 'gix',
					status: 'dry_run',
					updatedRefs: ['refs/heads/main'],
					rejectedRefs: [],
				},
			}),
			json({ ok: true, fetch: { remoteName: 'origin', refspecs: [], updatedRefs: [], status: 'synced' } }),
			json({ ok: true, health: { mirrorId: 'mirror_1', repoId: 'repo_1', status: 'healthy' } }),
			json({ ok: true, promotion: { mirrorId: 'mirror_1', repoId: 'repo_1', dryRun: true, status: 'planned' } }),
			json({ ok: true, compact: { status: 'ok', dryRun: true, backupId: null, files: [] } }),
			json({
				ok: true,
				backup: {
					backupId: 'backup_1',
					format: 'tar.zst',
					uri: 'treedx://backup/backup_1',
					checksum: 'blake3:abc',
					byteLength: 12,
					verified: true,
				},
			}),
		]);

		await expect(
			client.push({ refspecs: ['refs/heads/main:refs/heads/main'], dryRun: true }),
		).resolves.toMatchObject({ backend: 'gix', status: 'dry_run' });
		await expect(client.fetchRemote({ dryRun: false })).resolves.toMatchObject({ fetch: { status: 'synced' } });
		await expect(client.checkMirrorHealth({ mirrorId: 'mirror_1' })).resolves.toMatchObject({
			health: { status: 'healthy' },
		});
		await expect(client.promoteMirror({ mirrorId: 'mirror_1', dryRun: true })).resolves.toMatchObject({
			promotion: { status: 'planned' },
		});
		await expect(client.compactStorage({ dryRun: true })).resolves.toMatchObject({ compact: { status: 'ok' } });
		await expect(client.backupStorage({ include: ['catalog'], verify: true })).resolves.toMatchObject({
			backup: { backupId: 'backup_1' },
		});

		expect(calls.map((call) => call.url)).toEqual([
			'https://treedx.example.test/api/v1/repos/repo_1/push',
			'https://treedx.example.test/api/v1/repos/repo_1/sync',
			'https://treedx.example.test/api/v1/repos/repo_1/mirrors/mirror_1/health',
			'https://treedx.example.test/api/v1/repos/repo_1/mirrors/mirror_1/promote',
			'https://treedx.example.test/api/v1/admin/storage/compact',
			'https://treedx.example.test/api/v1/admin/storage/backup',
		]);
		expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
			refspecs: ['refs/heads/main:refs/heads/main'],
			dryRun: true,
		});
		expect(calls.every((call) => (call.init.headers as Record<string, string>).authorization === 'Bearer token')).toBe(true);
	});

	it('maps Git remote error envelopes to TreeDxApiError', async () => {
		const { client } = mockClient([
			json(
				{
					ok: false,
					error: {
						code: 'unsupported_transport',
						message: 'unsupported transport',
						details: { remoteName: 'origin' },
					},
				},
				422,
			),
		]);

		const error = await client
			.push({ refspecs: ['refs/heads/main:refs/heads/main'], dryRun: false })
			.then(() => undefined, (caught: unknown) => caught);
		expect(error).toBeInstanceOf(TreeDxApiError);
		expect(error).toMatchObject({ code: 'unsupported_transport', status: 422, details: { remoteName: 'origin' } });
	});
});
