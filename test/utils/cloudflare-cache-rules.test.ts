import { describe, expect, it } from 'vitest';

import { buildTreeseedManagedCloudflareCacheRules } from '../../src/operations/services/deploy.ts';

describe('Cloudflare cache rule expressions', () => {
	it('omits optional path predicates instead of emitting boolean literals', () => {
		const rules = buildTreeseedManagedCloudflareCacheRules({
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
		for (const rule of rules) {
			expect(rule.expression).not.toContain('(true)');
			expect(rule.expression).not.toContain('(false)');
		}
	});

	it('omits the source-page rule when no source paths are configured', () => {
		const rules = buildTreeseedManagedCloudflareCacheRules({
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

		expect(rules.map((rule) => rule.description)).not.toContain('treeseed-managed: cache source html routes');
		for (const rule of rules) {
			expect(rule.expression).not.toContain('(true)');
			expect(rule.expression).not.toContain('(false)');
		}
	});
});
