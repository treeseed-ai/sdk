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
it('keeps the SDK-owned GitHub token visible when the API overlay adds deployment targets', async () => {
		const tenantRoot = await createTenantFixture('entries: {}\n');
		tempRoots.add(tenantRoot);

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		expect(findRegistryEntry(registry, 'TREESEED_GITHUB_TOKEN')).toMatchObject({
			group: 'auth',
			visibility: 'user',
			requirement: 'required',
			storage: 'shared',
		});
		expect(findRegistryEntry(registry, 'TREESEED_GITHUB_TOKEN')?.targets).toEqual(expect.arrayContaining([
			'local-runtime',
			'railway-secret',
			'github-secret',
		]));
		expect(findRegistryEntry(registry, 'TREESEED_GITHUB_TOKEN')?.purposes).toEqual(expect.arrayContaining([
			'save',
			'deploy',
			'config',
		]));
	});
});
