import { describe,expect,it,vi } from 'vitest';
import { R2ApiTokenPublicationClient } from '../../../src/platform/published-content/r2-api-token-publication-client.ts';

describe('R2 API-token publication client', () => {
	it('derives the documented S3 identity from one verified active token', async () => {
		const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).includes('/tokens/verify')
			? Response.json({ success: true, result: { id: 'token-identifier', status: 'active' } })
			: new Response('', { status: 404 }));
		const client = new R2ApiTokenPublicationClient({ authMode: 'api-token', accountId: 'account', bucket: 'content', apiToken: 'secret-canary' }, fetchImpl as typeof fetch);
		expect(await client.exists('teams/team/object')).toBe(false);
		expect(await client.exists('teams/team/other')).toBe(false);
		expect(fetchImpl.mock.calls.filter(([url]) => String(url).includes('/tokens/verify'))).toHaveLength(1);
		const [, request] = fetchImpl.mock.calls.find(([url]) => String(url).includes('r2.cloudflarestorage.com'))!;
		expect(request?.headers).toMatchObject({ authorization: expect.stringContaining('Credential=token-identifier/') });
		expect(JSON.stringify(request)).not.toContain('secret-canary');
	});

	it('fails closed when neither account nor user verification returns an active identity', async () => {
		const fetchImpl = vi.fn(async () => Response.json({ success: true, result: { id: 'token-identifier', status: 'disabled' } }));
		const client = new R2ApiTokenPublicationClient({ authMode: 'api-token', accountId: 'account', bucket: 'content', apiToken: 'token' }, fetchImpl as typeof fetch);
		await expect(client.exists('object')).rejects.toThrow('active token identifier');
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it('retries a transient R2 transport failure with a newly signed request', async () => {
		let objectAttempts = 0;
		const fetchImpl = vi.fn(async (url: string | URL | Request) => {
			if (String(url).includes('/tokens/verify')) return Response.json({ success: true, result: { id: 'token-identifier', status: 'active' } });
			objectAttempts += 1;
			if (objectAttempts === 1) throw new TypeError('fetch failed', { cause: new Error('socket closed') });
			return new Response('', { status: 404 });
		});
		const client = new R2ApiTokenPublicationClient({ authMode: 'api-token', accountId: 'account', bucket: 'content', apiToken: 'token' }, fetchImpl as typeof fetch);
		expect(await client.exists('object')).toBe(false);
		expect(objectAttempts).toBe(2);
	});

	it('recovers a conditional replay when read-back already has the exact body', async () => {
		const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
			if (String(url).includes('/tokens/verify')) return Response.json({ success: true, result: { id: 'token-identifier', status: 'active' } });
			if (init?.method === 'PUT') return new Response('', { status: 412 });
			return new Response('exact body', { status: 200, headers: { etag: 'etag' } });
		});
		const client = new R2ApiTokenPublicationClient({ authMode: 'api-token', accountId: 'account', bucket: 'content', apiToken: 'token' }, fetchImpl as typeof fetch);
		await expect(client.put('object', 'exact body', { contentType: 'text/plain', ifNoneMatch: '*' })).resolves.toBeUndefined();
	});
});
