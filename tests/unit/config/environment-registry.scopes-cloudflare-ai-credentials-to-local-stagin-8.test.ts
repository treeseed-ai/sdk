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
it('scopes Cloudflare AI credentials to local, staging, and prod config', async () => {
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
		const cloudflareToken = registry.entries.find((entry) => entry.id === 'TREESEED_CLOUDFLARE_API_TOKEN');

		expect(cloudflareToken?.scopes).toEqual(['local', 'staging', 'prod']);
		expect(isTreeseedEnvironmentEntryRelevant(cloudflareToken!, registry.context, 'local', 'config')).toBe(true);
		expect(isTreeseedEnvironmentEntryRequired(cloudflareToken!, registry.context, 'local', 'config')).toBe(true);
		expect(findRegistryEntry(registry, 'TREESEED_RAILWAY_API_TOKEN')?.scopes).toEqual(
			findRegistryEntry(registry, 'TREESEED_RAILWAY_API_TOKEN') ? ['local', 'staging', 'prod'] : undefined,
		);
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_CLOUDFLARE_ACCOUNT_ID')?.scopes).toEqual(['local', 'staging', 'prod']);
		expect(findRegistryEntry(registry, 'TREESEED_RAILWAY_WORKSPACE')?.scopes).toEqual(
			findRegistryEntry(registry, 'TREESEED_RAILWAY_WORKSPACE') ? ['staging', 'prod'] : undefined,
		);
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_HOSTING_KIND')?.scopes).toEqual(['staging', 'prod']);
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_PROJECT_RUNNER_TOKEN')?.scopes).toEqual(['staging', 'prod']);
		expect(findRegistryEntry(registry, 'TREESEED_RAILWAY_PROJECT_ID')?.scopes).toEqual(
			findRegistryEntry(registry, 'TREESEED_RAILWAY_PROJECT_ID') ? ['staging', 'prod'] : undefined,
		);
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_GITHUB_TOKEN')?.scopes).toEqual(['local', 'staging', 'prod']);
	});
});
