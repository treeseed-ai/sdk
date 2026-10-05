import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ProviderProtocolClient } from '../../../../../src/capacity/providers/capacity-provider.ts';
import { CONTROL_PLANE_OPERATIONS } from '../../../../../src/operator-contracts/index.ts';
import { sandboxEnvironmentCatalogDigest, sandboxEnvironmentCatalogSchema, sandboxEnvironmentCatalogSigningBytes, verifySandboxEnvironmentCatalog } from '../../../../../src/capacity-provider/environment-catalog.ts';

describe('capacity provider membership protocol', () => {
	it('models environment kinds as signed catalog data rather than SDK enums', () => {
		const hash = (value: string) => `sha256:${value.repeat(64)}`;
		const base = { id: 'ubuntu-base', version: '24.04.0', kind: 'base', status: 'active', createdAt: '2026-08-29T00:00:00.000Z', contract: { id: 'base-contract', version: '1.0.0', digest: hash('3'), capabilities: [] },
			image: { reference: 'registry.example/ubuntu', digest: hash('d'), architectures: ['amd64'], operatingSystem: 'linux' }, derivedFrom: null,
			provenance: { sourceRepository: 'https://example.test/base', sourceRevision: 'd'.repeat(40), buildRecipeDigest: hash('4'), sbomDigest: hash('5'), signature: { keyId: 'build-key', algorithm: 'cosign', value: 'signature' } },
			qualification: { suiteId: 'base-suite', suiteVersion: '1.0.0', evidenceDigest: hash('6'), status: 'passed', completedAt: '2026-08-29T00:00:00.000Z' } };
		const catalog = sandboxEnvironmentCatalogSchema.parse({ schemaVersion: 'treeseed.sandbox-environment-catalog/v1', generation: 1, catalogDigest: hash('a'), rootPolicy: { allowedBaseImageDigests: [hash('d')] }, createdAt: '2026-08-29T00:00:00.000Z', signature: { keyId: 'catalog-key', algorithm: 'Ed25519', value: 'signature' }, entries: [base, {
			id: 'customer-specialized-runtime', version: '1.0.0', kind: 'extension', status: 'active', createdAt: '2026-08-29T00:00:00.000Z',
			contract: { id: 'customer-security-contract', version: '1.0.0', digest: hash('b'), capabilities: ['custom-scanning'] },
			image: { reference: 'registry.example/customer/runtime', digest: hash('c'), architectures: ['amd64'], operatingSystem: 'linux' },
			derivedFrom: [{ entryId: 'ubuntu-base', version: '24.04.0', imageDigest: hash('d') }],
			provenance: { sourceRepository: 'https://example.test/runtime', sourceRevision: 'e'.repeat(40), buildRecipeDigest: hash('f'), sbomDigest: hash('1'), signature: { keyId: 'build-key', algorithm: 'cosign', value: 'signature' } },
			qualification: { suiteId: 'customer-suite', suiteVersion: '1.0.0', evidenceDigest: hash('2'), status: 'passed', completedAt: '2026-08-29T00:00:00.000Z' },
		}] });
		expect(catalog.entries[1]?.contract.id).toBe('customer-security-contract');
	});
	it('authenticates the exact canonical environment catalog', () => {
		const { privateKey, publicKey } = generateKeyPairSync('ed25519');
		const material = { schemaVersion: 'treeseed.sandbox-environment-catalog/v1' as const, generation: 1, rootPolicy: { allowedBaseImageDigests: [`sha256:${'a'.repeat(64)}`] }, entries: [], createdAt: '2026-08-29T00:00:00.000Z' };
		const unsigned = sandboxEnvironmentCatalogSchema.parse({ ...material, catalogDigest: sandboxEnvironmentCatalogDigest(material), signature: { keyId: 'catalog-key', algorithm: 'Ed25519', value: 'pending' } });
		const catalog = { ...unsigned, signature: { ...unsigned.signature, value: sign(null, sandboxEnvironmentCatalogSigningBytes(unsigned), privateKey).toString('base64url') } };
		expect(verifySandboxEnvironmentCatalog(catalog, publicKey.export({ format: 'jwk' })).generation).toBe(1);
		expect(() => verifySandboxEnvironmentCatalog({ ...catalog, generation: 2 }, publicKey.export({ format: 'jwk' }))).toThrow(/digest/u);
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
