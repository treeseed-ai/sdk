import {
	createHash,
	createPrivateKey,
	generateKeyPairSync,
	randomUUID,
	sign,
} from 'node:crypto';
import type {
	CapacityProviderProofPayload,
	CapacityProviderPublicJwk,
	CapacityProviderSignedProof,
} from '../contracts/index.ts';
import { capacityProviderSecurityDefaults } from '../validation.ts';

export interface CapacityProviderPrivateJwk extends CapacityProviderPublicJwk {
	d: string;
}

function canonicalValue(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([, entry]) => entry !== undefined)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([key, entry]) => [key, canonicalValue(entry)]));
}

export function capacityProviderSha256(value: string | Uint8Array) {
	return createHash('sha256').update(value).digest('base64url');
}

export function canonicalCapacityProviderJson(value: unknown) {
	return JSON.stringify(canonicalValue(value));
}

export function capacityProviderFingerprint(publicJwk: CapacityProviderPublicJwk) {
	const canonicalPublic = canonicalCapacityProviderJson({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x });
	return `sha256:${capacityProviderSha256(canonicalPublic)}`;
}

export function generateCapacityProviderIdentity(): CapacityProviderPrivateJwk {
	const pair = generateKeyPairSync('ed25519');
	return pair.privateKey.export({ format: 'jwk' }) as CapacityProviderPrivateJwk;
}

export function capacityProviderPublicIdentity(privateJwk: CapacityProviderPrivateJwk): CapacityProviderPublicJwk {
	if (privateJwk.kty !== 'OKP' || privateJwk.crv !== 'Ed25519' || !privateJwk.x || !privateJwk.d) {
		throw new Error('Capacity provider identity must be an Ed25519 private JWK.');
	}
	return { kty: 'OKP', crv: 'Ed25519', x: privateJwk.x, alg: 'EdDSA' };
}

export async function signCapacityProviderProof(input: {
	privateJwk: CapacityProviderPrivateJwk;
	publicJwk: CapacityProviderPublicJwk;
	method: string;
	path: string;
	audience: string;
	body: unknown;
	jti?: string;
	identityVersion?: number;
	now?: Date;
}): Promise<CapacityProviderSignedProof> {
	const now = input.now ?? new Date();
	const payload: CapacityProviderProofPayload = {
		schemaVersion: 1,
		algorithm: 'Ed25519',
		providerFingerprint: capacityProviderFingerprint(input.publicJwk),
		identityVersion: input.identityVersion ?? 1,
		method: input.method.toUpperCase(),
		path: input.path,
		bodySha256: capacityProviderSha256(canonicalCapacityProviderJson(input.body)),
		audience: input.audience.replace(/\/$/u, ''),
		issuedAt: new Date(now.getTime() - 1_000).toISOString(),
		expiresAt: new Date(now.getTime() + capacityProviderSecurityDefaults().proofTtlSeconds * 1_000 - 1_000).toISOString(),
		jti: input.jti ?? randomUUID(),
	};
	const protectedValue = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JOSE' })).toString('base64url');
	const payloadValue = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const signature = sign(
		null,
		Buffer.from(`${protectedValue}.${payloadValue}`),
		createPrivateKey({ key: input.privateJwk as unknown as import('node:crypto').JsonWebKey, format: 'jwk' }),
	).toString('base64url');
	return { protected: protectedValue, payload: payloadValue, signature };
}
