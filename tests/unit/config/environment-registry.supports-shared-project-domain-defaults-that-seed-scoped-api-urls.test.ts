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
it('supports shared project-domain defaults that seed scoped api urls', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_PROJECT_DOMAINS:
    label: Project custom domains
    group: auth
    description: Shared project domains.
    howToGet: Set custom domains.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - config
    validation:
      kind: nonempty
    defaultValueRef: projectDomainsDefault
  TREESEED_API_BASE_URL:
    label: Treeseed API base URL
    group: auth
    description: API base URL.
    howToGet: Set API URL.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    storage: scoped
    requirement: required
    purposes:
      - dev
      - deploy
      - config
    validation:
      kind: nonempty
    defaultValueRef: apiBaseUrlDefault
`);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://market.example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: {
				api: {
					provider: 'railway',
					enabled: true,
					environments: {
						local: { baseUrl: 'http://127.0.0.1:3000' },
					},
				},
			},
			__tenantRoot: tenantRoot,
		} as any;

		const registry = resolveTreeseedEnvironmentRegistry({
			deployConfig,
			plugins: [],
		});
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_PROJECT_DOMAINS')?.storage).toBe('scoped');
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_API_BASE_URL')?.storage).toBe('scoped');

		const localSuggestedApiUrl = getTreeseedEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		}).TREESEED_API_BASE_URL;
		expect(localSuggestedApiUrl === undefined || localSuggestedApiUrl === 'http://127.0.0.1:3000').toBe(true);

		const prodSuggestedApiUrl = getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {
				TREESEED_PROJECT_DOMAINS: 'market.example.com',
			},
		}).TREESEED_API_BASE_URL;
		expect(prodSuggestedApiUrl === undefined || prodSuggestedApiUrl === 'https://api.example.com').toBe(true);
	});
});
