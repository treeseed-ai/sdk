import { describe, expect, it } from 'vitest';
import { TREESEED_OAUTH_CLIENT_IDS, type OAuthAuthorizationPresentation } from '../../../src/operator-contracts/oauth.ts';

describe('OAuth browser presentation contracts', () => {
	it('keeps CLI and Admin as distinct first-party clients', () => {
		expect(TREESEED_OAUTH_CLIENT_IDS).toEqual({ cli: 'trsd', admin: 'treeseed-admin' });
	});

	it('describes validated consent without credential or token fields', () => {
		const presentation: OAuthAuthorizationPresentation = {
			schemaVersion: 'treeseed.oauth.authorization-presentation/v1', clientId: 'treeseed-admin', clientName: 'TreeSeed Admin',
			redirectUri: 'https://admin.treeseed.localhost/auth/callback/treeseed', redirectOrigin: 'https://admin.treeseed.localhost',
			responseType: 'code', codeChallenge: 'a'.repeat(43), codeChallengeMethod: 'S256', scopes: ['treeseed:read'], state: 'state',
		};
		expect(presentation).not.toHaveProperty('password');
		expect(presentation).not.toHaveProperty('accessToken');
	});
});
