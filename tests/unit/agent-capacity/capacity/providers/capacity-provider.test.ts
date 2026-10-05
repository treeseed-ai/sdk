import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import { ProviderProtocolClient, CapacityProviderApiError } from '../../../../../src/capacity/providers/capacity-provider.ts';
import { createServer } from 'node:http';
import { CONTROL_PLANE_OPERATIONS } from '../../../../../src/operator-contracts/index.ts';
import { sandboxEnvironmentCatalogDigest, sandboxEnvironmentCatalogSchema, sandboxEnvironmentCatalogSigningBytes, verifySandboxEnvironmentCatalog } from '../../../../../src/capacity-provider/environment-catalog.ts';
import { validateProviderSupplyOffer } from '../../../../../src/capacity-provider/validation.ts';

type LifecycleBody = NonNullable<Parameters<ProviderProtocolClient['renewAssignment']>[1]> & Record<string, unknown>;
type EventBody = Parameters<ProviderProtocolClient['createAssignmentEvent']>[1] & Record<string, unknown>;
function protectedEventBodies() {
	const publicBody: EventBody = { id: 'original-event', eventType: 'provider.execution.completed', component: 'execution-provider', status: 'completed',
		message: 'Original event.', createdAt: '2026-10-04T17:00:00.000Z', context: { sandboxId: 'original-sandbox' } };
	const privateBody: EventBody = Object.assign({}, publicBody, { leaseToken: 'isolated-lease', runnerId: 'original-runner', sequence: 0,
		protectedPayload: { providerEvents: [{ type: 'original-private-action' }] } });
	const invalid: EventBody[] = [undefined, null, '', false, 0, [], {}].map(protectedPayload => Object.assign({}, privateBody, { protectedPayload }));
	for (const field of ['runnerId', 'leaseToken']) for (const value of [undefined, null, '', ' ', false, 0, [], {}]) invalid.push(Object.assign({}, privateBody, { [field]: value }));
	for (const sequence of [undefined, null, '0', false, -1, 0.5, NaN, Infinity]) invalid.push(Object.assign({}, privateBody, { sequence }));
	return { publicBody, privateBody, invalid };
}
function retirementRequests(client: ProviderProtocolClient) {
	const lifecycle: LifecycleBody = { runnerId: 'original-runner', leaseToken: 'isolated-lease-input' };
	const measured: LifecycleBody = { assignmentAttempt: 1, usageDimension: 'aggregate', activeSeconds: 2, elapsedSeconds: 3 };
	return [
		{ operation: CONTROL_PLANE_OPERATIONS.providers.renewAssignment, body: lifecycle, invoke: (body: LifecycleBody) => client.renewAssignment('assignment-a', body) },
		{ operation: CONTROL_PLANE_OPERATIONS.providers.returnAssignment, body: lifecycle, invoke: (body: LifecycleBody) => client.returnAssignment('assignment-a', body) },
		{ operation: CONTROL_PLANE_OPERATIONS.providers.completeAssignment, body: lifecycle, invoke: (body: LifecycleBody) => client.completeAssignment('assignment-a', body) },
		{ operation: CONTROL_PLANE_OPERATIONS.providers.failAssignment, body: lifecycle, invoke: (body: LifecycleBody) => client.failAssignment('assignment-a', body) },
		{ operation: CONTROL_PLANE_OPERATIONS.providers.reportUsage, body: measured, invoke: (body: LifecycleBody) => client.reportAssignmentUsage('assignment-a', body, 'original-usage-key') },
		{ operation: CONTROL_PLANE_OPERATIONS.providers.settleAssignment, body: measured, invoke: (body: LifecycleBody) => client.settleAssignment('assignment-a', body, 'original-settlement-key') },
	];
}

describe('capacity provider membership protocol', () => {
	it('validates missing malformed and numeric supply offers without throwing coercing or changing the original registration inputs', () => {
		const valid = { capabilities: ['renamed.execution'], weight: 1, maxConcurrentRunners: 1 };
		const values: unknown[] = [undefined, null, '', 'offer', false, true, 0, 1, [], {}, { capabilities: null }, { capabilities: 'renamed.execution' }];
		for (const capabilities of [[null], [1], [''], [' '], [{}]]) values.push({ ...valid, capabilities });
		for (const field of ['weight', 'sharePercent', 'maxConcurrentRunners']) for (const value of [null, '', '1', false, 0, -1, NaN, Infinity]) values.push({ ...valid, [field]: value });
		const outcomes: boolean[] = [];
		for (const value of values) { const before = structuredClone(value);
			outcomes.push(validateProviderSupplyOffer(value).ok);
			expect(value).toEqual(before);
		}
		expect(outcomes).toEqual(values.map(() => false));
		for (const offer of [valid, { capabilities: ['renamed.execution'], sharePercent: 100, maxConcurrentRunners: 2 }]) {
			const before = structuredClone(offer); expect(validateProviderSupplyOffer(offer)).toEqual({ ok: true, diagnostics: [] }); expect(offer).toEqual(before);
		}
	});
	it('validates protected ordinary event authority before JSON serialization while preserving exact private and public requests without caller mutation', async () => {
		const calls: string[] = [], values = protectedEventBodies();
		const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://server.test', accessToken: 'isolated-provider-input',
			fetchImpl: async (_url, init) => { calls.push(String(init?.body)); return Response.json({ data: { accepted: true } }); } });
		const outcomes: Array<{ denied: boolean; calls: number }> = [];
		for (const body of values.invalid) {
			const before = structuredClone(body), offset = calls.length; let cause: unknown;
			try { await client.createAssignmentEvent('assignment-a', body); } catch (error) { cause = error; }
			outcomes.push({ denied: cause instanceof CapacityProviderApiError && cause.status === 0, calls: calls.length - offset }); expect(body).toEqual(before);
		}
		const offset = calls.length;
		for (const body of [values.privateBody, values.publicBody]) { const before = structuredClone(body);
			expect(await client.createAssignmentEvent('assignment-a', body)).toEqual({ accepted: true }); expect(body).toEqual(before); }
		expect(outcomes).toEqual(values.invalid.map(() => ({ denied: true, calls: 0 })));
		expect(calls.slice(offset)).toEqual([JSON.stringify(values.privateBody), JSON.stringify(values.publicBody)]);
	});
	it('native original event transport rejects malformed protected authority without HTTP and retries exact private then public bytes through the original catalog route', async () => {
		const calls: Array<{ path: string | undefined; method: string | undefined; body: string }> = [], values = protectedEventBodies();
		const server = createServer((request, response) => {
			let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += String(chunk); });
			request.on('end', () => { calls.push({ path: request.url, method: request.method, body }); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: { accepted: true } })); });
		});
		try {
			await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); accept(); }); });
			const address = server.address(); if (!address || typeof address === 'string') throw new Error('Original native event address required');
			const client = new ProviderProtocolClient({ controlPlaneUrl: `http://127.0.0.1:${address.port}`, accessToken: 'isolated-provider-input', requestTimeoutMs: 1_000 });
			const outcomes: Array<{ denied: boolean; calls: number }> = [];
			for (const body of values.invalid) { const before = structuredClone(body), offset = calls.length; let cause: unknown;
				try { await client.createAssignmentEvent('assignment-a', body); } catch (error) { cause = error; }
				outcomes.push({ denied: cause instanceof CapacityProviderApiError && cause.status === 0, calls: calls.length - offset }); expect(body).toEqual(before); }
			const offset = calls.length;
			for (const body of [values.privateBody, values.publicBody]) { const before = structuredClone(body);
				expect(await client.createAssignmentEvent('assignment-a', body)).toEqual({ accepted: true }); expect(body).toEqual(before); }
			expect(outcomes).toEqual(values.invalid.map(() => ({ denied: true, calls: 0 })));
			const operation = CONTROL_PLANE_OPERATIONS.providers.createEvent;
			expect(calls.slice(offset)).toEqual([values.privateBody, values.publicBody].map(body => ({
				path: operation.descriptor.rest!.path.replace('{assignmentId}', 'assignment-a'), method: operation.descriptor.rest!.method, body: JSON.stringify(body) })));
		} finally { server.closeAllConnections(); if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); expect(server.listening).toBe(false); }
	});
	it('rejects every own retired mode-run value before serialization through all six original provider mutation bindings without hiding undefined or changing a valid retry', async () => {
		const calls: Array<{ path: string; method: string | undefined; body: string }> = [];
		const client = new ProviderProtocolClient({ controlPlaneUrl: 'https://server.test', accessToken: 'isolated-provider-input',
			fetchImpl: async (url, init) => { calls.push({ path: new URL(String(url)).pathname, method: init?.method, body: String(init?.body) }); return Response.json({ data: { accepted: true } }); } });
		const requests = retirementRequests(client), before = requests.map(value => structuredClone(value.body));
		const outcomes: Array<{ localFailure: boolean; requests: number }> = [];
		for (const value of [undefined, null, '', 'retired-run', false, 0, {}, []]) for (const request of requests) {
			const body = Object.assign({}, request.body, { modeRunId: value }), original = structuredClone(body), offset = calls.length;
			let failure: unknown;
			try { await request.invoke(body); } catch (error) { failure = error; }
			outcomes.push({ localFailure: failure instanceof CapacityProviderApiError && failure.status === 0, requests: calls.length - offset });
			expect(body).toEqual(original); expect(Object.hasOwn(body, 'modeRunId')).toBe(true);
		}
		const retryOffset = calls.length;
		for (const request of requests) expect(await request.invoke({ ...request.body })).toEqual({ accepted: true });
		expect(outcomes).toEqual(Array.from({ length: 48 }, () => ({ localFailure: true, requests: 0 })));
		expect(calls.slice(retryOffset)).toEqual(requests.map(request => ({ path: request.operation.descriptor.rest!.path.replace('{assignmentId}', 'assignment-a'),
			method: request.operation.descriptor.rest!.method, body: JSON.stringify(request.body) })));
		expect(requests.map(value => value.body)).toEqual(before);
	});
	it('native original provider transport denies retired identities before any HTTP request and preserves exact six current requests after all denials', async () => {
		const calls: Array<{ path: string | undefined; method: string | undefined; body: string }> = [];
		const server = createServer((request, response) => {
			let body = ''; request.setEncoding('utf8'); request.on('data', chunk => { body += String(chunk); });
			request.on('end', () => { calls.push({ path: request.url, method: request.method, body }); response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ data: { accepted: true } })); });
		});
		try {
			await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); accept(); }); });
			const address = server.address(); if (!address || typeof address === 'string') throw new Error('Native provider test address unavailable');
			const client = new ProviderProtocolClient({ controlPlaneUrl: `http://127.0.0.1:${address.port}`, accessToken: 'isolated-provider-input', requestTimeoutMs: 1_000 });
			const requests = retirementRequests(client), before = requests.map(value => structuredClone(value.body));
			const outcomes: Array<{ localFailure: boolean; requests: number }> = [];
			for (const value of [undefined, null, '', 'retired-run', false, 0, {}, []]) for (const request of requests) {
				const body = Object.assign({}, request.body, { modeRunId: value }), original = structuredClone(body), offset = calls.length;
				let failure: unknown;
				try { await request.invoke(body); } catch (error) { failure = error; }
				outcomes.push({ localFailure: failure instanceof CapacityProviderApiError && failure.status === 0, requests: calls.length - offset });
				expect(body).toEqual(original); expect(Object.hasOwn(body, 'modeRunId')).toBe(true);
			}
			const retryOffset = calls.length;
			for (const request of requests) expect(await request.invoke({ ...request.body })).toEqual({ accepted: true });
			expect(outcomes).toEqual(Array.from({ length: 48 }, () => ({ localFailure: true, requests: 0 })));
			expect(calls.slice(retryOffset)).toEqual(requests.map(request => ({ path: request.operation.descriptor.rest!.path.replace('{assignmentId}', 'assignment-a'),
				method: request.operation.descriptor.rest!.method, body: JSON.stringify(request.body) })));
			expect(requests.map(value => value.body)).toEqual(before);
		} finally {
			server.closeAllConnections();
			if (server.listening) await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
			expect(server.listening).toBe(false);
		}
	});
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
