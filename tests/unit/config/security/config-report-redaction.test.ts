import { describe, expect, it } from 'vitest';
import type { CollectedConfigContext } from '../../../../src/operations/services/config-runtime/accounts/ensure-secret-session-for-config.ts';
import { redactConfigContextForReport } from '../../../../src/operations/services/config-runtime/support/collect-print-env-report.ts';

describe('configuration report redaction', () => {
	it('removes secret values and the executable registry from serialized reports', () => {
		const secret = 'config-secret-canary';
		const entry = {
			id: 'TREESEED_TEST_TOKEN', label: 'Token', group: 'test', cluster: 'test:token', startupProfile: 'advanced' as const,
			requirement: 'optional' as const, description: 'Test token.', howToGet: 'Fixture.', sensitivity: 'secret' as const,
			targets: [], purposes: [], storage: 'scoped' as const, scope: 'local' as const, sharedScopes: ['local' as const],
			required: false, currentValue: secret, suggestedValue: secret, effectiveValue: secret,
		};
		const context = {
			tenantRoot: '/fixture', scopes: ['local'], project: { name: 'Fixture', slug: 'fixture', siteUrl: 'https://example.test' },
			configPath: '/fixture/config', keyPath: '/fixture/key', entriesByScope: { local: [entry], staging: [], prod: [] },
			valuesByScope: { local: { TREESEED_TEST_TOKEN: secret }, staging: {}, prod: {} },
			suggestedValuesByScope: { local: { TREESEED_TEST_TOKEN: secret }, staging: {}, prod: {} },
			configReadinessByScope: { local: {}, staging: {}, prod: {} }, validationByScope: { local: [], staging: [], prod: [] },
			sharedStorageMigrations: [], registry: { secret },
		} as unknown as CollectedConfigContext;

		const serialized = JSON.stringify(redactConfigContextForReport(context));
		expect(serialized).not.toContain(secret);
		expect(serialized).not.toContain('registry');
		expect(serialized).toContain('<redacted>');
	});
});
