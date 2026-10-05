import { describe, expect, it } from 'vitest';
import { OAUTH_CLIENT_IDS, type OAuthAuthorizationPresentation, type OAuthDeviceApprovalPresentation } from '../../../src/operator-contracts/oauth.ts';

describe('OAuth browser presentation contracts', () => {
	it('keeps CLI and Admin as distinct first-party clients', () => {
		expect(OAUTH_CLIENT_IDS).toEqual({ cli: 'trsd', admin: 'treeseed-admin' });
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

	it('presents a pending device grant without the device credential', () => {
		const presentation: OAuthDeviceApprovalPresentation = {
			schemaVersion: 'treeseed.oauth.device-approval-presentation/v1', clientId: 'trsd', clientName: 'TreeSeed CLI',
			userCode: 'ABCD-EFGH', scopes: ['treeseed:read'], expiresAt: '2026-08-27T12:00:00.000Z', status: 'pending',
		};
		expect(presentation).not.toHaveProperty('deviceCode');
		expect(presentation.status).toBe('pending');
	});
});
