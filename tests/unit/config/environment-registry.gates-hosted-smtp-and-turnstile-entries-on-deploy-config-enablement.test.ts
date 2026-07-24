import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getTreeseedEnvironmentSuggestedValues,
	isTreeseedEnvironmentEntryRequired,
	isTreeseedEnvironmentEntryRelevant,
	resolveTreeseedEnvironmentRegistry,
} from '../../../src/platform/environment.ts';
afterEach(async () => {
	for (const tenantRoot of tempRoots) {
		await rm(tenantRoot, { recursive: true, force: true });
	}
	tempRoots.clear();
});
import { tempRoots, agentProcessingRegistryFixtureYaml, codexRegistryFixtureYaml, coreFormsRegistryFixtureYaml, createTenantFixture, findRegistryEntry } from './environment-registry.support.ts';
describe('environment registry overlays', () => {
it('gates hosted smtp and turnstile entries on deploy config enablement', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			smtp: { enabled: false },
			turnstile: { enabled: false },
			__tenantRoot: tenantRoot,
		} as any;

		const disabledRegistry = resolveTreeseedEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		const smtpHost = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_SMTP_HOST');
		const turnstileSecret = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_TURNSTILE_SECRET_KEY');
		expect(isTreeseedEnvironmentEntryRelevant(smtpHost!, disabledRegistry.context, 'staging', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRelevant(turnstileSecret!, disabledRegistry.context, 'prod', 'config')).toBe(false);

		const enabledRegistry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				...deployConfig,
				smtp: { enabled: true },
				turnstile: { enabled: true },
			},
			plugins: [],
		});
		const enabledSmtpHost = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_SMTP_HOST');
		const enabledTurnstileSecret = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_TURNSTILE_SECRET_KEY');
		const formTokenSecret = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET');
		expect(isTreeseedEnvironmentEntryRelevant(enabledSmtpHost!, enabledRegistry.context, 'staging', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRelevant(enabledTurnstileSecret!, enabledRegistry.context, 'prod', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRelevant(enabledTurnstileSecret!, enabledRegistry.context, 'prod', 'deploy')).toBe(true);
		expect(enabledSmtpHost?.storage).toBe('shared');
		expect(enabledTurnstileSecret?.storage).toBe('shared');
		expect(enabledTurnstileSecret?.visibility).toBe('system');
		expect(enabledTurnstileSecret?.requirement).toBe('generated');
		expect(formTokenSecret?.storage).toBe('shared');
		expect(enabledTurnstileSecret?.scopes).toEqual(['staging', 'prod']);
		expect(isTreeseedEnvironmentEntryRelevant(enabledTurnstileSecret!, enabledRegistry.context, 'local', 'config')).toBe(false);
		expect(isTreeseedEnvironmentEntryRequired(enabledTurnstileSecret!, enabledRegistry.context, 'staging', 'config')).toBe(false);
		expect(enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_PUBLIC_FORMS_LOCAL_BYPASS_TURNSTILE')).toBeUndefined();
	});
});
