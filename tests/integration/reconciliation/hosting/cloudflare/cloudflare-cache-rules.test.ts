import { describe, expect, it } from 'vitest';

import { buildManagedCloudflareCacheRules } from '../../../../../src/operations/services/hosting/deployment/deploy.ts';

describe('Cloudflare cache rule expressions', () => {
	it('omits optional path predicates instead of emitting boolean literals', () => {
		const rules = buildManagedCloudflareCacheRules({
			surfaces: {
				web: {
					cache: {
						sourcePages: {
							paths: ['/'],
						},
					},
				},
			},
		} as any, { host: 'treeseed.ai' }, 'web');

		expect(rules.length).toBeGreaterThan(0);
		const sourceRule = rules.find((rule) => rule.description === 'treeseed-managed: bypass source html routes');
		expect(sourceRule?.action_parameters).toEqual({ cache: false });
		for (const rule of rules) {
			expect(rule.expression).not.toContain('(true)');
			expect(rule.expression).not.toContain('(false)');
		}
	});

	it('omits the source-page rule when no source paths are configured', () => {
		const rules = buildManagedCloudflareCacheRules({
			surfaces: {
				web: {
					cache: {
						sourcePages: {
							paths: [],
						},
					},
				},
			},
		} as any, { host: 'treeseed.ai' }, 'web');

		expect(rules.map((rule) => rule.description)).not.toContain('treeseed-managed: bypass source html routes');
		for (const rule of rules) {
			expect(rule.expression).not.toContain('(true)');
			expect(rule.expression).not.toContain('(false)');
		}
	});
});
