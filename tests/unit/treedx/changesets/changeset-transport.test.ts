import { gunzipSync } from 'node:zlib';
import { describe,expect,it } from 'vitest';
import { TreeDxClient } from '../../../../src/treedx/support/client.ts';

describe('TreeDX changeset transport', () => {
	it('uses bounded standard HTTP gzip for large changeset requests', async () => {
		let request: RequestInit | undefined;
		const client = new TreeDxClient({
			baseUrl: 'https://treedx.example', token: 'token',
			fetch: async (_url, init) => {
				request = init;
				return new Response(JSON.stringify({ ok: true, contract: 'treedx.changeset/v1' }), {
					status: 200, headers: { 'content-type': 'application/json' },
				});
			},
		});
		await client.applyChangeset({
			workspaceId: 'workspace-a', contract: 'treedx.changeset/v1', baseCommitSha: 'a'.repeat(40),
			baseRef: 'refs/heads/main', patch: 'x'.repeat(4_096), patchSha256: 'b'.repeat(64),
			idempotencyKey: 'changeset-transport-a', expectedDestinationRefHead: 'a'.repeat(40),
		});
		expect(new Headers(request?.headers).get('content-encoding')).toBe('gzip');
		const body = gunzipSync(request?.body as Uint8Array).toString('utf8');
		expect(JSON.parse(body).patch).toHaveLength(4_096);
	});
});
