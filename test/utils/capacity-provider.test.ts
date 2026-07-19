import { describe, expect, it } from 'vitest';
import {
	CAPACITY_PROVIDER_ENDPOINTS,
	CAPACITY_PROVIDER_ENV_KEYS,
	ProviderProtocolClient,
	buildCapacityProviderAuthHeaders,
	redactCapacityProviderEnv,
} from '../../src/capacity-provider.ts';

describe('capacity provider membership protocol', () => {
	it('exposes only membership-scoped assignment and availability endpoints', () => {
		expect(CAPACITY_PROVIDER_ENDPOINTS.sessions).toBe('/v1/provider/availability-sessions');
		expect(CAPACITY_PROVIDER_ENDPOINTS.sessionRefresh('session 1')).toBe('/v1/provider/availability-sessions/session%201');
		expect(CAPACITY_PROVIDER_ENDPOINTS.assignmentSettle('assignment 1')).toBe('/v1/provider/assignments/assignment%201/settle');
		expect(CAPACITY_PROVIDER_ENDPOINTS.assignmentUsage('assignment 1')).toBe('/v1/provider/assignments/assignment%201/usage');
		expect(JSON.stringify(CAPACITY_PROVIDER_ENDPOINTS)).not.toContain('heartbeat');
		expect(CAPACITY_PROVIDER_ENV_KEYS).toContain('TREESEED_CAPACITY_PROVIDER_MANIFEST');
		expect(CAPACITY_PROVIDER_ENV_KEYS).not.toContain('TREESEED_CAPACITY_PROVIDER_API_KEY');
	});

	it('refreshes an availability session with the canonical PUT operation', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const client = new ProviderProtocolClient({
			marketUrl: 'https://market.test', accessToken: 'short-lived-token',
			fetchImpl: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response(JSON.stringify({ ok: true, payload: { id: 'session-a', membershipId: 'membership-a', teamId: 'team-a', providerId: 'provider-a', status: 'open', sequence: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
			},
		});
		await client.refreshAvailabilitySession('session-a', { expectedSequence: 1 });
		expect(calls[0]).toMatchObject({ url: 'https://market.test/v1/provider/availability-sessions/session-a', init: { method: 'PUT' } });
	});

	it('requires short-lived membership access authority and redacts secret-shaped values', () => {
		expect(buildCapacityProviderAuthHeaders('access-token')).toEqual({ authorization: 'Bearer access-token' });
		expect(() => buildCapacityProviderAuthHeaders('')).toThrow(/membership access token/u);
		const redacted = redactCapacityProviderEnv({
			TREESEED_CAPACITY_PROVIDER_MANIFEST: '/config/treeseed.capacity-provider.yaml',
			TREESEED_TREEDX_TOKEN: 'secret-token-value',
			TREESEED_CODEX_AUTH_JSON_B64: 'encoded-secret-value',
		});
		expect(redacted.TREESEED_CAPACITY_PROVIDER_MANIFEST).toBe('/config/treeseed.capacity-provider.yaml');
		expect(redacted.TREESEED_TREEDX_TOKEN).not.toContain('secret-token-value');
		expect(redacted.TREESEED_CODEX_AUTH_JSON_B64).not.toContain('encoded-secret-value');
	});

	it('sends access-token auth and settlement idempotency through the canonical client', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const client = new ProviderProtocolClient({
			marketUrl: 'https://market.test/',
			accessToken: 'short-lived-token',
			fetchImpl: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response(JSON.stringify({ ok: true, payload: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
			},
		});
		await client.reportAssignmentUsage('assignment-a', { usageDimension: 'tokens' }, 'usage-a');
		await client.settleAssignment('assignment-a', { actualCredits: 2 }, 'settlement-a');
		expect(calls[0]?.url).toBe('https://market.test/v1/provider/assignments/assignment-a/usage');
		expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer short-lived-token', 'idempotency-key': 'usage-a' });
		expect(calls[1]?.url).toBe('https://market.test/v1/provider/assignments/assignment-a/settle');
		expect(calls[1]?.init?.headers).toMatchObject({ authorization: 'Bearer short-lived-token', 'idempotency-key': 'settlement-a' });
	});

	it('uses the same canonical transport for unauthenticated onboarding and membership credential auth', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const client = new ProviderProtocolClient({
			marketUrl: 'https://market.test',
			fetchImpl: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response(JSON.stringify({ payload: { id: 'registration-a' } }), { status: 200, headers: { 'content-type': 'application/json' } });
			},
		});
		await client.register('broadcast-key', {
			schemaVersion: 1,
			displayName: 'Provider',
			publicJwk: { kty: 'OKP', crv: 'Ed25519', x: 'public-key' },
			proof: { protected: 'header', payload: 'payload', signature: 'signature' },
			capabilitySummary: ['research'],
			supplyOffer: { capabilities: ['research'] },
		}, 'registration-a');
		expect(calls[0]?.url).toBe('https://market.test/v1/provider-registrations');
		expect(calls[0]?.init?.headers).toMatchObject({
			authorization: 'Treeseed-Registration broadcast-key',
			'idempotency-key': 'registration-a',
		});
	});

	it('requires access authority when an approved runtime method is called', async () => {
		const client = new ProviderProtocolClient({ marketUrl: 'https://market.test' });
		await expect(client.nextAssignment()).rejects.toThrow(/membership access token/u);
	});

	it('fails closed when a successful HTTP response is not a valid protocol envelope', async () => {
		const client = new ProviderProtocolClient({
			marketUrl: 'https://market.test',
			accessToken: 'short-lived-token',
			fetchImpl: async () => new Response(JSON.stringify({ payload: {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
		});
		await expect(client.settleAssignment('assignment-a', { actualCredits: 2 }, 'settlement-a')).rejects.toThrow(/ok response envelope/u);
	});

	it('keeps the request timeout active while the response body is being consumed', async () => {
		const client = new ProviderProtocolClient({
			marketUrl: 'https://market.test',
			accessToken: 'short-lived-token',
			requestTimeoutMs: 1_000,
			fetchImpl: async (_input, init) => {
				const signal = init?.signal;
				return new Response(new ReadableStream({
					start(controller) {
						signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')), { once: true });
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			},
		});
		await expect(client.nextAssignment()).rejects.toThrow(/timed out after 1000ms/u);
	});
});
