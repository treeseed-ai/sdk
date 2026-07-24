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
it('requires clean local GitHub metadata and does not advertise legacy env names', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			__tenantRoot: tenantRoot,
		} as any;
		const registry = resolveEnvironmentRegistry({ deployConfig, plugins: [] });
		const owner = registry.entries.find((entry) => entry.id === 'TREESEED_GITHUB_OWNER');
		const repositoryName = registry.entries.find((entry) => entry.id === 'TREESEED_GITHUB_REPOSITORY_NAME');

		expect(owner?.scopes).toEqual(['local']);
		expect(repositoryName?.scopes).toEqual(['local']);
		expect(isEnvironmentEntryRequired(owner!, registry.context, 'local', 'config')).toBe(true);
		expect(isEnvironmentEntryRequired(repositoryName!, registry.context, 'local', 'config')).toBe(true);
		expect(getEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		})).toMatchObject({
			TREESEED_GITHUB_REPOSITORY_NAME: 'test-site',
			TREESEED_GITHUB_REPOSITORY_VISIBILITY: 'private',
		});
		expect(registry.entries.find((entry) => entry.id === `TREESEED_${'KNOWLEDGE'}_${'COOP'}_GITHUB_OWNER`)).toBeUndefined();
		expect(registry.entries.find((entry) => entry.id === 'RAILWAY_API_KEY')).toBeUndefined();
		const railwayApiToken = findRegistryEntry(registry, 'TREESEED_RAILWAY_API_TOKEN');
		if (railwayApiToken) {
			expect(railwayApiToken.howToGet).not.toMatch(/legacy alias|RAILWAY_API_KEY/u);
		}
	});
});
