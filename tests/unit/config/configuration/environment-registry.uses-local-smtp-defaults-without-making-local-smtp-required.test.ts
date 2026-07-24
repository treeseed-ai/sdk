import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
	getEnvironmentSuggestedValues,
	isEnvironmentEntryRequired,
	isEnvironmentEntryRelevant,
	resolveEnvironmentRegistry,
} from '../../../../src/platform/configuration/environment.ts';
afterEach(async () => {
	for (const tenantRoot of tempRoots) {
		await rm(tenantRoot, { recursive: true, force: true });
	}
	tempRoots.clear();
});
import { tempRoots, agentProcessingRegistryFixtureYaml, codexRegistryFixtureYaml, coreFormsRegistryFixtureYaml, createTenantFixture, findRegistryEntry } from './environment-registry.support.ts';
describe('environment registry overlays', () => {
it('uses local smtp defaults without making local smtp required', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			smtp: { enabled: true },
			turnstile: { enabled: true },
			__tenantRoot: tenantRoot,
		} as any;

		const registry = resolveEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		const smtpHost = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_HOST');
		const smtpPort = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_PORT');
		const smtpFrom = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_FROM');
		const smtpReplyTo = registry.entries.find((entry) => entry.id === 'TREESEED_SMTP_REPLY_TO');

		expect(smtpHost).toBeTruthy();
		expect(smtpPort).toBeTruthy();
		expect(smtpFrom).toBeTruthy();
		expect(smtpReplyTo).toBeTruthy();
		expect(smtpHost?.storage).toBe('shared');
		expect(smtpPort?.storage).toBe('shared');
		expect(smtpFrom?.storage).toBe('shared');
		expect(smtpReplyTo?.storage).toBe('shared');
		expect(isEnvironmentEntryRequired(smtpHost!, registry.context, 'local', 'config')).toBe(false);
		expect(isEnvironmentEntryRequired(smtpHost!, registry.context, 'staging', 'config')).toBe(true);
		expect(isEnvironmentEntryRequired(smtpPort!, registry.context, 'local', 'config')).toBe(false);
		expect(isEnvironmentEntryRequired(smtpFrom!, registry.context, 'local', 'config')).toBe(false);
		expect(isEnvironmentEntryRequired(smtpReplyTo!, registry.context, 'local', 'config')).toBe(false);

		const suggested = getEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		});
		expect(suggested.TREESEED_SMTP_HOST).toBe('127.0.0.1');
		expect(suggested.TREESEED_SMTP_PORT).toBe('1025');
		expect(suggested.TREESEED_SMTP_FROM).toBe('hello@example.com');
		expect(suggested.TREESEED_SMTP_REPLY_TO).toBe('hello@example.com');
	});
});
