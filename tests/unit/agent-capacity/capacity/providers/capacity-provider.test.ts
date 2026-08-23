import { describe, expect, it } from 'vitest';
import { ProviderProtocolClient } from '../../../../../src/capacity/providers/capacity-provider.ts';
import { CONTROL_PLANE_OPERATIONS } from '../../../../../src/operator-contracts/index.ts';
import type { CapacityProviderManifestV3 } from '../../../../../src/capacity-provider/contracts/governance.ts';
import { validateCapacityProviderManifestV3 } from '../../../../../src/capacity-provider/validation.ts';

function batteryManifest(): CapacityProviderManifestV3 {
	return {
		schemaVersion: 3, ownership: { type: 'team', teamId: 'team:treeseed' }, configuration: { generation: 'generation-1' },
		identity: { privateKeyRef: 'secret://provider-identity', displayName: 'Local TreeSeed capacity' },
		capacity: { maxConcurrentWorkers: 4, cpuCores: 4, memoryBytes: 8_589_934_592 },
		credentialProfiles: [{ id: 'platform', source: 'service-vault', reference: 'secret://platform', required: true }],
		lanes: [
			{ id: 'communication', purpose: 'communication', priority: 400, reservedConcurrentWorkers: 1, maxConcurrentWorkers: 4, borrowWhenIdle: true, lendWhenIdle: true, reclaimPolicy: 'admission', queueLimit: 32, timeoutSeconds: 300 },
			{ id: 'platform', purpose: 'platform', priority: 200, reservedConcurrentWorkers: 0, maxConcurrentWorkers: 3, borrowWhenIdle: true, lendWhenIdle: true, reclaimPolicy: 'admission', queueLimit: 16, timeoutSeconds: 900 },
			{ id: 'workday', purpose: 'workday', priority: 100, reservedConcurrentWorkers: 0, maxConcurrentWorkers: 3, borrowWhenIdle: true, lendWhenIdle: true, reclaimPolicy: 'admission', queueLimit: 64, timeoutSeconds: 3_600 },
		],
		adapters: [
			{ id: 'agent', adapter: 'module:agent', isolation: 'worker', laneIds: ['communication', 'workday'], maxConcurrentWorkers: 3, nativeLimits: {}, capabilities: ['agent-execution'] },
			{ id: 'platform', adapter: 'builtin:platform', isolation: 'process', laneIds: ['platform'], maxConcurrentWorkers: 1, credentialProfiles: ['platform'], nativeLimits: {}, capabilities: ['platform-operation'] },
		],
		connections: [],
	};
}

describe('capacity provider membership protocol', () => {
	it('accepts one shared battery with reserved communication and isolated platform execution', () => {
		expect(validateCapacityProviderManifestV3(batteryManifest())).toEqual({ ok: true, diagnostics: [] });
	});

	it('rejects legacy classes, unsafe platform adapters, and communication starvation', () => {
		const value = batteryManifest() as CapacityProviderManifestV3 & { providerClass?: string };
		value.providerClass = 'agent';
		value.adapters[1]!.isolation = 'worker';
		value.lanes[0]!.reservedConcurrentWorkers = 0;
		expect(validateCapacityProviderManifestV3(value).diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'provider_manifest_legacy_class_forbidden', 'provider_platform_adapter_isolation_required', 'provider_communication_reservation_required',
		]));
	});
	it('uses the authoritative operation catalog instead of a parallel endpoint table', () => {
		expect(CONTROL_PLANE_OPERATIONS.providers.createAvailability.descriptor.rest?.path).toBe('/v1/provider/availability-sessions');
		expect(CONTROL_PLANE_OPERATIONS.providers.refreshAvailability.descriptor.rest?.path).toBe('/v1/provider/availability-sessions/{sessionId}');
		expect(CONTROL_PLANE_OPERATIONS.providers.settleAssignment.descriptor.rest?.path).toBe('/v1/provider/assignments/{assignmentId}/settle');
		expect(JSON.stringify(CONTROL_PLANE_OPERATIONS.providers)).not.toContain('heartbeat');
	});

	it('refreshes an availability session with the canonical PUT operation', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const client = new ProviderProtocolClient({
			controlPlaneUrl: 'https://server.test', accessToken: 'short-lived-token',
			fetchImpl: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response(JSON.stringify({ data: { id: 'session-a', membershipId: 'membership-a', teamId: 'team-a', providerId: 'provider-a', status: 'open', sequence: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
			},
		});
		await client.refreshAvailabilitySession('session-a', { expectedSequence: 1 });
		expect(calls[0]).toMatchObject({ url: 'https://server.test/v1/provider/availability-sessions/session-a', init: { method: 'PUT' } });
		expect(new Headers(calls[0]?.init?.headers).get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/u);
	});

	it('sends access-token auth and settlement idempotency through the canonical client', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const client = new ProviderProtocolClient({
			controlPlaneUrl: 'https://server.test/',
			accessToken: 'short-lived-token',
			fetchImpl: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
			},
		});
		await client.reportAssignmentUsage('assignment-a', { usageDimension: 'tokens' }, 'usage-a');
		await client.settleAssignment('assignment-a', { activeSeconds: 2 }, 'settlement-a');
		expect(calls[0]?.url).toBe('https://server.test/v1/provider/assignments/assignment-a/usage');
		expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Bearer short-lived-token');
		expect(new Headers(calls[0]?.init?.headers).get('idempotency-key')).toBe('usage-a');
		expect(calls[1]?.url).toBe('https://server.test/v1/provider/assignments/assignment-a/settle');
		expect(new Headers(calls[1]?.init?.headers).get('authorization')).toBe('Bearer short-lived-token');
		expect(new Headers(calls[1]?.init?.headers).get('idempotency-key')).toBe('settlement-a');
	});

	it('resolves fresh access authority for every long-running provider request', async () => {
		const authorizations: string[] = [];
		let generation = 0;
		const client = new ProviderProtocolClient({
			controlPlaneUrl: 'https://server.test',
			accessTokenProvider: async () => `refreshed-token-${++generation}`,
			fetchImpl: async (_input, init) => {
				authorizations.push(String(new Headers(init?.headers).get('authorization')));
				return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
			},
		});
		await client.reportAssignmentUsage('assignment-a', { usageDimension: 'tokens' }, 'usage-a');
		await client.settleAssignment('assignment-a', { activeSeconds: 2 }, 'settlement-a');
		expect(authorizations).toEqual(['Bearer refreshed-token-1', 'Bearer refreshed-token-2']);
	});

	it('uses the same canonical transport for unauthenticated onboarding and membership credential auth', async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		const client = new ProviderProtocolClient({
			controlPlaneUrl: 'https://server.test',
			fetchImpl: async (input, init) => {
				calls.push({ url: String(input), init });
				return new Response(JSON.stringify({ data: { id: 'registration-a' } }), { status: 200, headers: { 'content-type': 'application/json' } });
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
		expect(calls[0]?.url).toBe('https://server.test/v1/provider-registrations');
		expect(new Headers(calls[0]?.init?.headers).get('authorization')).toBe('Treeseed-Registration broadcast-key');
		expect(new Headers(calls[0]?.init?.headers).get('idempotency-key')).toBe('registration-a');
	});

	it('requires access authority when an approved runtime method is called', async () => {
		const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://server.test' });
		await expect(client.nextAssignment()).rejects.toThrow(/membership access token/u);
	});

	it('carries the requested assignment-authority lifetime in the signed access-token request', async () => {
		let requestBody: Record<string, unknown> = {};
		const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://server.test', fetchImpl: async (_input, init) => {
			requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(JSON.stringify({ data: { id: 'token-a' } }), { status: 201, headers: { 'content-type': 'application/json' } });
		} });
		await client.issueAccessToken('credential-secret', 'credential-a', { protected: 'header', payload: 'payload', signature: 'signature' }, 'access-a', 1_861);
		expect(requestBody).toMatchObject({ credentialId: 'credential-a', requestedValiditySeconds: 1_861 });
	});

	it('fails closed when a successful HTTP response is not a valid protocol envelope', async () => {
		const client = new ProviderProtocolClient({
			controlPlaneUrl: 'https://server.test',
			accessToken: 'short-lived-token',
			fetchImpl: async () => new Response(JSON.stringify({ payload: {} }), { status: 200, headers: { 'content-type': 'application/json' } }),
		});
		await expect(client.settleAssignment('assignment-a', { activeSeconds: 2 }, 'settlement-a')).rejects.toThrow(/invalid success envelope/u);
	});

	it('keeps the request timeout active while the response body is being consumed', async () => {
		const client = new ProviderProtocolClient({
			controlPlaneUrl: 'https://server.test',
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
