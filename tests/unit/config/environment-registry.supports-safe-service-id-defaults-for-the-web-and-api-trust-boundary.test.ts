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
it('supports safe service-id defaults for the web and api trust boundary', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_WEB_SERVICE_ID:
    label: Web service ID
    group: auth
    description: Shared web service ID.
    howToGet: Use web.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: required
    purposes:
      - config
    validation:
      kind: nonempty
    defaultValueRef: webServiceIdDefault
  TREESEED_API_WEB_SERVICE_ID:
    label: API trusted web service ID
    group: auth
    description: API-side trusted web service ID.
    howToGet: Match the web service ID.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    requirement: required
    purposes:
      - config
    validation:
      kind: nonempty
    defaultValueRef: apiWebServiceIdDefault
`);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://market.example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			services: { api: { provider: 'railway', enabled: true } },
			__tenantRoot: tenantRoot,
		} as any;

		const suggested = getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		});
		expect(suggested.TREESEED_WEB_SERVICE_ID).toBe('web');
		expect(suggested.TREESEED_API_WEB_SERVICE_ID).toBe('web');

		const linkedSuggested = getTreeseedEnvironmentSuggestedValues({
			scope: 'prod',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {
				TREESEED_WEB_SERVICE_ID: 'edge-web',
			},
		});
		expect(linkedSuggested.TREESEED_API_WEB_SERVICE_ID).toBe('edge-web');
	});
});
