import { describe, expect, it, vi } from 'vitest';
import { createAdminPassthroughHandler } from '../../../src/gateway/admin-passthrough.ts';

describe('Admin API passthrough transport', () => {
	it('preserves method, path, query, body, cookies, identifiers, status, and streaming responses', async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => new Response('event: ready\n\n', {
			status: 202,
			headers: { 'content-type': 'text/event-stream', 'set-cookie': 'session=next; Path=/; Secure', 'x-request-id': 'response-id' },
		}));
		const handler = createAdminPassthroughHandler({ adminBaseUrl: 'http://admin.internal', fetchImpl: fetchMock, serviceAssertion: () => 'signed' });
		const response = await handler(new Request('https://api.treeseed.dev/v1/projects/p1?view=full', {
			method: 'POST',
			headers: { cookie: 'session=current', 'idempotency-key': 'idem-1', 'x-request-id': 'request-id', connection: 'keep-alive', 'x-treeseed-market-service-secret': 'never-forward' },
			body: JSON.stringify({ name: 'Project' }),
		}));

		const [url, init] = fetchMock.mock.calls[0]!;
		expect(String(url)).toBe('http://admin.internal/v1/projects/p1?view=full');
		expect(init?.method).toBe('POST');
		expect(new Headers(init?.headers).get('cookie')).toBe('session=current');
		expect(new Headers(init?.headers).get('idempotency-key')).toBe('idem-1');
		expect(new Headers(init?.headers).get('x-request-id')).toBe('request-id');
		expect(new Headers(init?.headers).get('connection')).toBeNull();
		expect(new Headers(init?.headers).get('x-treeseed-market-service-secret')).toBeNull();
		expect(new Headers(init?.headers).get('x-treeseed-service-assertion')).toBe('signed');
		expect(response.status).toBe(202);
		expect(response.headers.get('set-cookie')).toContain('session=next');
		expect(await response.text()).toBe('event: ready\n\n');
	});

	it('never proxies the private Market namespace', async () => {
		const fetchMock = vi.fn();
		const handler = createAdminPassthroughHandler({ adminBaseUrl: 'http://admin.internal', fetchImpl: fetchMock });
		const response = await handler(new Request('https://api.treeseed.dev/v1/market/catalog'));
		expect(response.status).toBe(404);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rejects declared oversized requests before contacting Admin', async () => {
		const fetchMock = vi.fn();
		const handler = createAdminPassthroughHandler({ adminBaseUrl: 'http://admin.internal', fetchImpl: fetchMock, maxRequestBytes: 4 });
		const response = await handler(new Request('https://api.treeseed.dev/v1/projects', { method: 'POST', headers: { 'content-length': '5' }, body: '12345' }));
		expect(response.status).toBe(413);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('bounds chunked request bodies while streaming them upstream', async () => {
		const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
			await new Response(init?.body).arrayBuffer();
			return new Response('unexpected');
		});
		const handler = createAdminPassthroughHandler({ adminBaseUrl: 'http://admin.internal', fetchImpl: fetchMock, maxRequestBytes: 4 });
		const response = await handler(new Request('https://api.treeseed.dev/v1/projects', { method: 'POST', body: '12345' }));

		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ error: 'request-too-large' });
	});

	it('delegates WebSocket upgrades to the hosting adapter without exposing internal headers', async () => {
		const upgrade = vi.fn(async () => new Response(null, { status: 204 }));
		const handler = createAdminPassthroughHandler({ adminBaseUrl: 'http://admin.internal', webSocketUpgrade: upgrade });
		const response = await handler(new Request('https://api.treeseed.dev/v1/session/events?transport=websocket', {
			headers: { upgrade: 'websocket', connection: 'Upgrade', 'x-treeseed-internal-secret': 'never-forward' },
		}));

		expect(response.status).toBe(204);
		expect(upgrade).toHaveBeenCalledWith(expect.objectContaining({ upstreamUrl: 'http://admin.internal/v1/session/events?transport=websocket' }));
		const forwarded = upgrade.mock.calls[0]![0].headers;
		expect(forwarded.get('connection')).toBeNull();
		expect(forwarded.get('upgrade')).toBeNull();
		expect(forwarded.get('x-treeseed-internal-secret')).toBeNull();
	});
});
