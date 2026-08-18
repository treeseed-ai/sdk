import { describe, expect, it } from 'vitest';
import { resolveGitHubCredentialForRepository } from '../../../../src/operations/services/configuration/github-credentials.ts';

describe('GitHub credential resolution', () => {
	it('uses only the central token for first-party repositories', () => {
		const credential = resolveGitHubCredentialForRepository('treeseed-ai/admin', {
			values: {
				TREESEED_GITHUB_TOKEN: 'central',
				TREESEED_GITHUB_TOKEN_TREESEED_AI_ADMIN: 'obsolete-scoped',
			},
			env: {},
		});

		expect(credential).toMatchObject({
			envName: 'TREESEED_GITHUB_TOKEN',
			token: 'central',
			configured: true,
			fallbackUsed: false,
		});
	});

	it('preserves repository overrides for imported third-party projects', () => {
		const credential = resolveGitHubCredentialForRepository('example/external', {
			values: {
				TREESEED_GITHUB_TOKEN: 'central',
				TREESEED_GITHUB_TOKEN_EXAMPLE_EXTERNAL: 'imported',
			},
			env: {},
		});

		expect(credential).toMatchObject({
			envName: 'TREESEED_GITHUB_TOKEN_EXAMPLE_EXTERNAL',
			token: 'imported',
			source: 'repository',
		});
	});

	it('does not accept an obsolete scoped token without the first-party central token', () => {
		const credential = resolveGitHubCredentialForRepository('treeseed-ai/sdk', {
			values: { TREESEED_GITHUB_TOKEN_TREESEED_AI_SDK: 'obsolete-scoped' },
			env: {},
		});

		expect(credential).toMatchObject({
			envName: 'TREESEED_GITHUB_TOKEN',
			configured: false,
			token: null,
		});
	});
});
