import { describe, expect, it } from 'vitest';
import { createPublicKey, verify } from 'node:crypto';
import {
	canonicalCapacityProviderJson,
	capacityProviderFingerprint,
	capacityProviderPublicIdentity,
	capacityProviderSecurityDefaults,
	capacityProviderSha256,
	generateCapacityProviderIdentity,
	signCapacityProviderProof,
	validateCapacityProviderManifestV2,
	validateCapacityProviderProofPayload,
	validateCapacityProviderPublicJwk,
	type CapacityProviderManifestV2,
} from '../../../src/capacity-provider.ts';

function validationInput() {
	return {
		schemaVersion: 1 as const, algorithm: 'Ed25519' as const, providerFingerprint: 'sha256:provider', identityVersion: 1,
		method: 'POST', path: '/v1/provider-registrations', bodySha256: 'sha256:body', audience: 'https://api.treeseed.test',
		issuedAt: '2026-07-16T16:00:00.000Z', expiresAt: '2026-07-16T16:05:00.000Z', jti: 'proof-1',
	};
}

describe('capacity provider governance contracts', () => {
	it('owns canonical provider identity, fingerprint, digest, and proof signing primitives', async () => {
		const privateJwk = generateCapacityProviderIdentity();
		const publicJwk = capacityProviderPublicIdentity(privateJwk);
		const body = { z: 2, a: { y: undefined, x: 1 } };
		const proof = await signCapacityProviderProof({
			privateJwk, publicJwk, method: 'post', path: '/v1/provider-registrations',
			audience: 'https://api.treeseed.test/', body, jti: 'portable-proof',
			now: new Date('2026-07-16T16:01:00.000Z'),
		});
		const payload = JSON.parse(Buffer.from(proof.payload, 'base64url').toString('utf8')) as Record<string, unknown>;
		expect(canonicalCapacityProviderJson(body)).toBe('{"a":{"x":1},"z":2}');
		expect(payload).toMatchObject({
			providerFingerprint: capacityProviderFingerprint(publicJwk),
			bodySha256: capacityProviderSha256(canonicalCapacityProviderJson(body)),
			method: 'POST', audience: 'https://api.treeseed.test', jti: 'portable-proof',
		});
		expect(verify(
			null,
			Buffer.from(`${proof.protected}.${proof.payload}`),
			createPublicKey({ key: publicJwk, format: 'jwk' }),
			Buffer.from(proof.signature, 'base64url'),
		)).toBe(true);
	});

	it('accepts only canonical Ed25519 provider identities', () => {
		expect(validateCapacityProviderPublicJwk({ kty: 'OKP', crv: 'Ed25519', x: 'public-key', alg: 'EdDSA' }).ok).toBe(true);
		expect(validateCapacityProviderPublicJwk({ kty: 'OKP', crv: 'Ed25519', x: '', alg: 'EdDSA' }).diagnostics.map((entry) => entry.code)).toContain('provider_jwk_x_required');
	});

	it('bounds signed proof time, method, path, and audience', () => {
		const validation = validateCapacityProviderProofPayload({
			schemaVersion: 1,
			algorithm: 'Ed25519',
			providerFingerprint: 'sha256:provider',
			identityVersion: 1,
			method: 'POST',
			path: '/v1/provider-registrations',
			bodySha256: 'sha256:body',
			audience: 'https://api.treeseed.test',
			issuedAt: '2026-07-16T16:00:00.000Z',
			expiresAt: '2026-07-16T16:05:00.000Z',
			jti: 'proof-1',
		}, {
			now: new Date('2026-07-16T16:01:00.000Z'),
			expectedMethod: 'POST',
			expectedPath: '/v1/provider-registrations',
			expectedAudience: 'https://api.treeseed.test',
		});
		expect(validation).toEqual({ ok: true, diagnostics: [] });
		const expired = validateCapacityProviderProofPayload({
			...validationInput(), issuedAt: '2026-07-16T15:50:00.000Z', expiresAt: '2026-07-16T15:55:00.000Z',
		}, { now: new Date('2026-07-16T16:01:00.000Z') });
		expect(expired.diagnostics.map((entry) => entry.code)).toContain('provider_proof_expired');
		const future = validateCapacityProviderProofPayload({
			...validationInput(), issuedAt: '2026-07-16T16:02:01.000Z', expiresAt: '2026-07-16T16:05:00.000Z',
		}, { now: new Date('2026-07-16T16:01:00.000Z') });
		expect(future.diagnostics.map((entry) => entry.code)).toContain('provider_proof_issued_in_future');
		expect(capacityProviderSecurityDefaults()).toEqual({ proofTtlSeconds: 300, accessTokenTtlSeconds: 900, accessTokenRefreshSeconds: 300 });
	});

	it('validates multi-team connection distribution and secret references', () => {
		const manifest: CapacityProviderManifestV2 = {
			schemaVersion: 2,
			identity: { privateKeyRef: 'secret://capacity/provider-identity', displayName: 'Shared provider' },
			executionProviders: [{
				id: 'codex', adapter: 'codex', nativeLimits: { maxConcurrentRunners: 4 },
				researchSourcePolicy: { schemaVersion: 1, allowedDomains: ['example.test'], requestTimeoutMs: 10_000, maxResponseBytes: 100_000, maxRedirects: 2, allowedContentTypes: ['text/*'] },
			}],
			connections: [
				{ id: 'team-a', marketProfile: 'staging', teamId: 'team-a', providerId: 'provider', membershipId: 'membership-a', membershipCredentialRef: 'secret://capacity/team-a', membershipCredentialId: 'credential-a', offer: { sharePercent: 60, capabilities: ['engineering'] } },
				{ id: 'team-b', marketUrl: 'https://example.test', teamId: 'team-b', providerId: 'provider', membershipId: 'membership-b', membershipCredentialRef: 'secret://capacity/team-b', membershipCredentialId: 'credential-b', offer: { sharePercent: 40, capabilities: ['research'] } },
			],
		};
		expect(validateCapacityProviderManifestV2(manifest)).toEqual({ ok: true, diagnostics: [] });
		manifest.executionProviders[0]!.researchSourcePolicy!.allowedDomains = [];
		expect(validateCapacityProviderManifestV2(manifest).diagnostics.map((entry) => entry.code)).toContain('research_source_policy_domains_invalid');
		manifest.executionProviders[0]!.researchSourcePolicy!.allowedDomains = ['example.test'];
		manifest.connections[1]!.offer.sharePercent = 50;
		expect(validateCapacityProviderManifestV2(manifest).diagnostics.map((entry) => entry.code)).toContain('provider_connection_share_exceeded');
		manifest.connections[1]!.offer.sharePercent = 40;
		manifest.connections[1]!.providerId = 'different-provider';
		expect(validateCapacityProviderManifestV2(manifest).diagnostics.map((entry) => entry.code)).toContain('provider_connection_identity_mismatch');
	});

	it('keeps broadcast registration keys out of durable runtime connections', () => {
		const manifest: CapacityProviderManifestV2 = {
			schemaVersion: 2,
			identity: { privateKeyRef: 'secret://capacity/provider-identity', displayName: 'Join-ready provider' },
			executionProviders: [{ id: 'codex', adapter: 'codex', nativeLimits: { maxConcurrentRunners: 1 } }],
			connections: [],
		};
		expect(validateCapacityProviderManifestV2(manifest)).toEqual({ ok: true, diagnostics: [] });
		const legacy = {
			...manifest,
			connections: [{ id: 'team-a', marketProfile: 'local', registrationKeyRef: 'env://TEAM_KEY', offer: { capabilities: ['engineering'] } }],
		};
		expect(validateCapacityProviderManifestV2(legacy as CapacityProviderManifestV2).diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'provider_connection_registration_key_forbidden',
			'provider_connection_credential_ref_invalid',
			'provider_connection_team_required',
			'provider_connection_membership_required',
		]));
	});
});
