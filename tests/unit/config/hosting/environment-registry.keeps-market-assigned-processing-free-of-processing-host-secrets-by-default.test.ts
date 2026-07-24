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
it('keeps market-assigned processing free of processing-host secrets by default', async () => {
		const tenantRoot = await createTenantFixture(agentProcessingRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const registry = resolveEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				processing: { mode: 'market-assigned' },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		for (const id of ['TREESEED_RAILWAY_API_TOKEN', 'TREESEED_API_WEB_SERVICE_SECRET', 'TREESEED_CAPACITY_PROVIDER_ID']) {
			const entry = findRegistryEntry(registry, id);
			if (entry) {
				expect(isEnvironmentEntryRelevant(entry, registry.context, 'staging', 'config')).toBe(false);
			}
		}
	});
});
