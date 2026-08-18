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
import { tempRoots, agentProcessingRegistryFixtureYaml, codexRegistryFixtureYaml, coreFormsRegistryFixtureYaml, createTenantFixture, findRegistryEntry } from '../configuration/environment-registry.support.ts';
describe('environment registry overlays', () => {
it('keeps Cloudflare account ID as required shared environment config in every environment', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			__tenantRoot: tenantRoot,
		} as any;
		const registry = resolveEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		const entry = registry.entries.find((candidate) => candidate.id === 'TREESEED_CLOUDFLARE_ACCOUNT_ID');

		expect(entry).toMatchObject({
			requirement: 'required',
			storage: 'shared',
			startupProfile: 'core',
		});
		expect(entry?.scopes).toEqual(['local', 'staging', 'prod']);
		expect(entry?.targets).toContain('local-runtime');
		expect(isEnvironmentEntryRelevant(entry!, registry.context, 'local', 'config')).toBe(true);
		expect(isEnvironmentEntryRequired(entry!, registry.context, 'local', 'config')).toBe(true);
		expect(isEnvironmentEntryRequired(entry!, registry.context, 'prod', 'config')).toBe(true);
		expect(getEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		}).TREESEED_CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
		expect(getEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig: {
				...deployConfig,
				cloudflare: { accountId: 'replace-with-cloudflare-account-id' },
			},
			plugins: [],
			values: {
				TREESEED_CLOUDFLARE_ACCOUNT_ID: 'account-from-machine-config',
			},
		}).TREESEED_CLOUDFLARE_ACCOUNT_ID).toBeUndefined();
	});
});
