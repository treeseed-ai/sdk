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
it('targets Railway API token to GitHub deploy workflows and the operations runner service', async () => {
		const tenantRoot = await createTenantFixture('entries: {}\n');
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

		const railwayApiToken = findRegistryEntry(registry, 'TREESEED_RAILWAY_API_TOKEN');
		if (railwayApiToken) {
			expect(railwayApiToken.targets).toEqual(expect.arrayContaining(['github-secret']));
			expect(railwayApiToken.targets).toEqual(expect.arrayContaining(['railway-secret']));
			expect(railwayApiToken.serviceTargets).toEqual(expect.arrayContaining(['operationsRunner']));
		}
		const railwayProjectToken = findRegistryEntry(registry, 'TREESEED_RAILWAY_TOKEN');
		if (railwayProjectToken) {
			expect(railwayProjectToken.targets).toEqual(expect.arrayContaining(['github-secret']));
			expect(railwayProjectToken.requirement).toBe('optional');
		}
	});
});
