import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneClient, ControlPlaneClientError, normalizeControlPlaneServerRegistry, resolveControlPlaneServer } from '../../src/entrypoints/clients/control-plane-client.ts';
import { CONTROL_PLANE_OPERATIONS, encodeConfirmationState } from '../../src/operator-contracts/index.ts';

describe('ControlPlaneClient', () => {
	it('sends authority and concurrency headers and accepts standard envelopes', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { id: 'project_1' } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002/' }, accessToken: 'test-token', fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.providers.reportUsage, {
			path: { assignmentId: 'assignment 1' }, query: {}, body: { name: 'Example' },
		}, { idempotencyKey: 'request_1', ifMatch: '"generation_1"' }))
			.resolves.toEqual({ data: { id: 'project_1' } });
		expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1:3002/v1/provider/assignments/assignment%201/usage');
		const request = fetchImpl.mock.calls[0]![1]!;
		const headers = new Headers(request.headers);
		expect(headers.get('authorization')).toBe('Bearer test-token');
		expect(headers.get('idempotency-key')).toBe('request_1');
		expect(headers.get('if-match')).toBe('"generation_1"');
	});

	it('preserves only exact concurrency and contract response evidence in metadata', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ data: { items: [] }, meta: { cursor: 'next' } }), {
			status: 200, headers: { 'content-type': 'application/json', etag: '"revision-7"', 'x-treeseed-contract-digest': `sha256:${'b'.repeat(64)}`, 'set-cookie': 'secret=value' },
		}));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.projects.list, { path: {}, query: {}, body: undefined })).resolves.toEqual({
			data: { items: [] }, meta: { cursor: 'next', etag: '"revision-7"', contractDigest: `sha256:${'b'.repeat(64)}` },
		});
	});

	it('projects RFC 9457 failures as typed errors', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
			type: 'https://treeseed.dev/problems/denied', title: 'Denied', status: 403, code: 'authorization_denied',
		}), { status: 403, headers: { 'content-type': 'application/problem+json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.projects.list, {
			path: {}, query: { teamId: 'team 1', limit: 20 }, body: undefined,
		})).rejects.toMatchObject<Partial<ControlPlaneClientError>>({ status: 403, problem: { code: 'authorization_denied' } });
		expect(String(fetchImpl.mock.calls[0]![0])).toBe('http://127.0.0.1:3002/v1/projects?teamId=team+1&limit=20');
	});

	it('rejects caller-constructed endpoint bindings before network access', async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		const forged = { ...CONTROL_PLANE_OPERATIONS.projects.list };
		await expect(client.invoke(forged, { path: {}, query: {}, body: undefined })).rejects.toThrow(/authoritative catalog binding/u);
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('normalizes caller-owned server profiles without performing local persistence', () => {
		const registry = normalizeControlPlaneServerRegistry({
			version: 1,
			activeServerId: 'missing',
			servers: [{ serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002/' }],
		});
		expect(registry.activeServerId).toBe('local');
		expect(resolveControlPlaneServer(undefined, registry)).toEqual({ serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' });
	});

	it('uses RFC 8628 form encoding for device authorization', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ device_code: 'device', user_code: 'ABCD', verification_uri: 'http://local/activate', expires_in: 600, interval: 5 }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.authorizeDevice('trsd', ['treeseed:read'])).resolves.toMatchObject({ deviceCode: 'device', userCode: 'ABCD' });
		expect(String(fetchImpl.mock.calls[0]![1]!.body)).toContain('client_id=trsd');
		expect(new Headers(fetchImpl.mock.calls[0]![1]!.headers).get('content-type')).toBe('application/x-www-form-urlencoded');
	});

	it('preserves OAuth protocol error codes for device polling', async () => {
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ error: 'authorization_pending', error_description: 'Authorization is pending.' }), { status: 400, headers: { 'content-type': 'application/json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.exchangeDeviceCode('trsd', 'device')).rejects.toMatchObject<Partial<ControlPlaneClientError>>({ status: 400, problem: { code: 'authorization_pending', detail: 'Authorization is pending.' } });
	});

	it('preserves signed input-required state for an exact confirmation retry', async () => {
		const confirmation = { schemaVersion: 'treeseed.confirmation-state/v1' as const, principalId: 'user_1', clientId: 'trsd', operationId: 'workdays.start', argumentsDigest: `sha256:${'a'.repeat(64)}` as const, expiresAt: '2030-01-01T00:00:00.000Z', nonce: 'nonce', signature: 'signature' };
		const inputRequired = { type: 'input_required', requestId: 'request_1', prompt: 'Confirm exact input.', confirmation };
		const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ type: 'about:blank', title: 'Confirmation required', status: 409, code: 'confirmation_required', inputRequired }), { status: 409, headers: { 'content-type': 'application/problem+json' } }));
		const client = new ControlPlaneClient({ profile: { serverId: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:3002' }, fetchImpl });
		await expect(client.invoke(CONTROL_PLANE_OPERATIONS.workdays.start, { path: { teamId: 'team_1' }, query: {}, body: {} }, { idempotencyKey: 'idempotency_1' })).rejects.toMatchObject<Partial<ControlPlaneClientError>>({ problem: { code: 'confirmation_required', inputRequired } });
		expect(JSON.parse(Buffer.from(encodeConfirmationState(confirmation), 'base64url').toString('utf8'))).toEqual(confirmation);
	});
});
