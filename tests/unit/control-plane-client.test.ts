import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CONTROL_PLANE_SERVER_SESSIONS_PATH, ControlPlaneClient, ControlPlaneClientError, resolveControlPlaneServerSession, setControlPlaneServerSession } from '../../src/entrypoints/clients/control-plane-client.ts';

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

	it('stores server sessions encrypted and never writes tokens in plaintext', () => {
		const root = mkdtempSync(join(tmpdir(), 'treeseed-server-session-'));
		const custody = { loadKey: () => randomBytes(32) };
		const key = randomBytes(32);
		custody.loadKey = () => key;
		const profile = { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' };
		setControlPlaneServerSession(root, { serverId: 'local', audience: profile.baseUrl, accessToken: 'access-secret', refreshToken: 'refresh-secret' }, custody);
		expect(resolveControlPlaneServerSession(root, profile, custody)).toMatchObject({ serverId: 'local', audience: profile.baseUrl, accessToken: 'access-secret' });
		const stored = readFileSync(join(root, CONTROL_PLANE_SERVER_SESSIONS_PATH), 'utf8');
		expect(stored).not.toContain('access-secret');
		expect(stored).not.toContain('refresh-secret');
		expect(() => resolveControlPlaneServerSession(root, { ...profile, baseUrl: 'https://other.example' }, custody)).toThrow(/audience/u);
	});

	it('uses RFC 8628 form encoding for device authorization', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ device_code: 'device', user_code: 'ABCD', verification_uri: 'http://local/activate', expires_in: 600, interval: 5 }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.authorizeDevice('trsd', ['treeseed:read'])).resolves.toMatchObject({ deviceCode: 'device', userCode: 'ABCD' });
		expect(String(fetchImpl.mock.calls[0]![1]!.body)).toContain('client_id=trsd');
		expect(new Headers(fetchImpl.mock.calls[0]![1]!.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
	});
});
