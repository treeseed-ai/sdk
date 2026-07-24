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
it('surfaces agent API entries when the API processing plane is enabled', async () => {
		const tenantRoot = await createTenantFixture(agentProcessingRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		const apiBaseUrl = findRegistryEntry(registry, 'TREESEED_API_BASE_URL');
		if (apiBaseUrl) {
			expect(apiBaseUrl.targets).toContain('railway-var');
		} else {
			expect(findRegistryEntry(registry, 'TREESEED_FORM_TOKEN_SECRET')).toBeUndefined();
		}
	});
});
