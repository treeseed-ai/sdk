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
} from '../../../../../src/platform/configuration/environment.ts';
afterEach(async () => {
	for (const tenantRoot of tempRoots) {
		await rm(tenantRoot, { recursive: true, force: true });
	}
	tempRoots.clear();
});
import { tempRoots, agentProcessingRegistryFixtureYaml, codexRegistryFixtureYaml, coreFormsRegistryFixtureYaml, createTenantFixture, findRegistryEntry } from '../../configuration/environment-registry.support.ts';
describe('environment registry overlays', () => {
it('registers staging and production market defaults for primary and integrated catalog markets', async () => {
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

		const centralApiBaseUrl = findRegistryEntry(registry, 'TREESEED_CENTRAL_MARKET_API_BASE_URL');
		if (!centralApiBaseUrl) {
			expect(findRegistryEntry(registry, 'TREESEED_API_BASE_URL')).toBeUndefined();
			return;
		}

		expect(centralApiBaseUrl).toMatchObject({
			scopes: ['staging', 'prod'],
			requirement: 'optional',
		});
		expect([
			['staging', 'prod'],
			['local', 'staging', 'prod'],
		]).toContainEqual(findRegistryEntry(registry, 'TREESEED_API_BASE_URL')?.scopes);
		expect(findRegistryEntry(registry, 'TREESEED_CATALOG_MARKET_API_BASE_URLS')).toMatchObject({
			scopes: ['staging', 'prod'],
			requirement: 'optional',
		});
		expect(getEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		}).TREESEED_CENTRAL_MARKET_API_BASE_URL).toBe('https://api.treeseed.dev');
		expect([
			'https://staging-market.example.com',
			'https://api.example.com',
		]).toContain(getEnvironmentSuggestedValues({
			scope: 'staging',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {
				TREESEED_CENTRAL_MARKET_API_BASE_URL: 'https://staging-market.example.com',
			},
		}).TREESEED_CATALOG_MARKET_API_BASE_URLS);
	});
});
