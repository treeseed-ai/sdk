import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneClient, ControlPlaneClientError } from '../../src/entrypoints/clients/control-plane-client.ts';

describe('ControlPlaneClient', () => {
	it('sends authority and concurrency headers and accepts standard envelopes', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'project_1' } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002/' }, accessToken: 'test-token', fetchImpl });
		await expect(client.call<{ id: string }>({ path: '/v1/projects/project_1', method: 'PATCH', input: { name: 'Example' }, idempotencyKey: 'request_1', ifMatch: '"generation_1"' }))
			.resolves.toEqual({ data: { id: 'project_1' } });
		const request = fetchImpl.mock.calls[0]![1]!;
		const headers = new Headers(request.headers);
		expect(headers.get('authorization')).toBe('Bearer test-token');
		expect(headers.get('idempotency-key')).toBe('request_1');
		expect(headers.get('if-match')).toBe('"generation_1"');
	});

	it('projects RFC 9457 failures as typed errors', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
			type: 'https://treeseed.dev/problems/denied', title: 'Denied', status: 403, code: 'authorization_denied',
		}), { status: 403, headers: { 'content-type': 'application/problem+json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.call({ path: '/v1/projects' })).rejects.toMatchObject<Partial<ControlPlaneClientError>>({ status: 403, problem: { code: 'authorization_denied' } });
	});
});
