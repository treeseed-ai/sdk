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
it('gates local web, api, and forms entries on enabled surfaces', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_WEB_ONLY:
    label: Web only
    group: auth
    description: Web surface entry.
    howToGet: Enable the web surface.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    requirement: optional
    purposes:
      - config
    validation:
      kind: nonempty
    relevanceRef: webSurfaceEnabled
  TREESEED_API_ONLY:
    label: API only
    group: auth
    description: API surface entry.
    howToGet: Enable the API surface and service.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - local
      - staging
      - prod
    requirement: optional
    purposes:
      - config
    validation:
      kind: nonempty
    relevanceRef: apiSurfaceEnabled
`);
		tempRoots.add(tenantRoot);

		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			providers: { forms: 'store_only' },
			surfaces: { web: { enabled: false }, api: { enabled: false } },
			services: { api: { provider: 'railway', enabled: false } },
			__tenantRoot: tenantRoot,
		} as any;

		const disabledRegistry = resolveEnvironmentRegistry({ deployConfig, plugins: [] });
		const webEntry = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_WEB_ONLY');
		const apiEntry = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_API_ONLY');
		const formTokenSecret = disabledRegistry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET');
		expect(isEnvironmentEntryRelevant(webEntry!, disabledRegistry.context, 'local', 'config')).toBe(false);
		expect(isEnvironmentEntryRelevant(apiEntry!, disabledRegistry.context, 'local', 'config')).toBe(false);
		if (formTokenSecret) {
			expect(isEnvironmentEntryRelevant(formTokenSecret, disabledRegistry.context, 'local', 'config')).toBe(false);
		}

		const enabledRegistry = resolveEnvironmentRegistry({
			deployConfig: {
				...deployConfig,
				surfaces: { web: { enabled: true }, api: { enabled: true } },
				services: { api: { provider: 'railway', enabled: true } },
			},
			plugins: [],
		});
		const enabledWebEntry = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_WEB_ONLY');
		const enabledApiEntry = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_API_ONLY');
		const enabledFormTokenSecret = enabledRegistry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET');
		expect(isEnvironmentEntryRelevant(enabledWebEntry!, enabledRegistry.context, 'local', 'config')).toBe(true);
		expect(isEnvironmentEntryRelevant(enabledApiEntry!, enabledRegistry.context, 'local', 'config')).toBe(true);
		if (enabledFormTokenSecret) {
			expect(isEnvironmentEntryRelevant(enabledFormTokenSecret, enabledRegistry.context, 'local', 'config')).toBe(true);
		}
	});
});
