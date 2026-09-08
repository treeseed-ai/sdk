import { describe, expect, it } from 'vitest';
import { externalIdentitySchema, federationRelationshipSchema, identityEndpointSchema,
	identityPrincipalSchema, resourceTokenRequestSchema } from '../../../src/identity/index.ts';

const issuer = 'https://identity.example/realms/local';
const identity = { issuer, subject: 'subject-1' };
const relationship = {
	id: 'trust-1', version: 1, localIssuer: issuer, trustedIssuer: 'https://private.example/realms/local',
	status: 'active', permittedClientIds: ['market'], releasedClaims: ['name'],
	transitive: false, accountLinking: 'authenticated-proof',
};

describe('identity public contracts', () => {
	it('keeps exact issuer/subject identity and does not accept email-based linking', () => {
		expect(externalIdentitySchema.parse(identity)).toEqual(identity);
		expect(externalIdentitySchema.safeParse({ email: 'person@example.org' }).success).toBe(false);
		expect(externalIdentitySchema.safeParse({ ...identity, email: 'person@example.org' }).success).toBe(false);
	});
	it.each(['http://identity.example', 'https://user:secret@identity.example',
		'https://identity.example#fragment', 'https://identity.example?token=secret'])('rejects unsafe descriptor %s', (endpoint) => {
		expect(identityEndpointSchema.safeParse(endpoint).success).toBe(false);
	});
	it('requires a resource-specific request without embedded credentials', () => {
		const request = { resource: 'https://market.example', scopes: ['market:read'] };
		expect(resourceTokenRequestSchema.parse(request)).toEqual(request);
		for (const invalid of [{ scopes: [] }, { ...request, refreshToken: 'secret' },
			{ ...request, scopes: ['market:read', 'market:read'] }, { ...request, scopes: ['two scopes'] }]) {
			expect(resourceTokenRequestSchema.safeParse(invalid).success).toBe(false);
		}
	});
	it('describes authentication without granting team authority', () => {
		const principal = { principalId: 'existing-id', kind: 'human', identity,
			audience: 'https://api.example', scopes: [] };
		expect(identityPrincipalSchema.parse(principal).principalId).toBe('existing-id');
		for (const extra of [{ roles: ['owner'] }, { teamId: 'arbitrary-team' }, { accessToken: 'secret' }]) {
			expect(identityPrincipalSchema.safeParse({ ...principal, ...extra }).success).toBe(false);
		}
	});
	it('allows explicit directional relationships only', () => {
		expect(federationRelationshipSchema.parse(relationship)).toEqual(relationship);
		for (const override of [{ transitive: true }, { accountLinking: 'email' },
			{ permittedClientIds: [] }, { trustedIssuer: issuer }, { version: 0 },
			{ permittedClientIds: ['market', 'market'] }, { releasedClaims: ['team_roles'] }]) {
			expect(federationRelationshipSchema.safeParse({ ...relationship, ...override }).success).toBe(false);
		}
	});
});
