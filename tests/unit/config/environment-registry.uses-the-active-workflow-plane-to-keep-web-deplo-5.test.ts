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
it('uses the active workflow plane to keep web deploy validation free of processing entries', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		const previousPlane = process.env.TREESEED_WORKFLOW_PLANE;
		process.env.TREESEED_WORKFLOW_PLANE = 'web';
		try {
			const registry = resolveTreeseedEnvironmentRegistry({
				deployConfig: {
					name: 'Test Site',
					slug: 'test-site',
					siteUrl: 'https://example.com',
					contactEmail: 'hello@example.com',
					cloudflare: { accountId: 'account-123' },
					surfaces: { web: { enabled: true }, api: { enabled: true } },
					services: { api: { provider: 'railway', enabled: true } },
					__tenantRoot: tenantRoot,
				} as any,
				plugins: [],
			});

			const railwayApiToken = findRegistryEntry(registry, 'TREESEED_RAILWAY_API_TOKEN');
			if (railwayApiToken) {
				expect(isTreeseedEnvironmentEntryRelevant(railwayApiToken, registry.context, 'staging', 'config')).toBe(false);
			}
			expect(findRegistryEntry(registry, 'TREESEED_API_WEB_SERVICE_SECRET')).toBeUndefined();
			expect(findRegistryEntry(registry, 'TREESEED_CAPACITY_PROVIDER_ID')).toBeUndefined();
		} finally {
			if (previousPlane === undefined) {
				delete process.env.TREESEED_WORKFLOW_PLANE;
			} else {
				process.env.TREESEED_WORKFLOW_PLANE = previousPlane;
			}
		}
	});
});
