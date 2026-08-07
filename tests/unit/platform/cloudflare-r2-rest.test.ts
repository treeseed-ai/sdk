import { describe, expect, it, vi } from 'vitest';
import { CloudflareR2RestClient } from '../../../src/platform/published-content/cloudflare-r2-rest-client.ts';

describe('Cloudflare R2 REST publication client', () => {
	it('uses bearer auth, preserves conditional writes, and returns no credential material', async () => {
		const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response('body', {
			status: 200, headers: { etag: 'revision-1', 'content-type': 'text/plain' },
		}));
		const client = new CloudflareR2RestClient({ authMode: 'api-token', accountId: 'account', bucket: 'content', apiToken: 'secret-canary' }, fetchImpl as typeof fetch);
		await client.put('teams/team/objects/value', 'body', { contentType: 'text/plain', ifMatch: 'revision-0' });
		const [url, init] = fetchImpl.mock.calls[0]!;
		expect(String(url)).toContain('/accounts/account/r2/buckets/content/objects/teams/team/objects/value');
		expect(init?.headers).toMatchObject({ authorization: 'Bearer secret-canary', 'if-match': 'revision-0' });
		expect(JSON.stringify(await client.get('teams/team/objects/value'))).not.toContain('secret-canary');
	});

	it('treats conditional conflicts as failed reconciliation', async () => {
		const client = new CloudflareR2RestClient({ authMode: 'api-token', accountId: 'account', bucket: 'content', apiToken: 'token' },
			vi.fn(async () => new Response('', { status: 412 })) as typeof fetch);
		await expect(client.put('pointer.json', '{}', { contentType: 'application/json', ifNoneMatch: '*' })).rejects.toThrow(/conflict/u);
	});
});
