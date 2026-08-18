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
import { tempRoots, agentProcessingRegistryFixtureYaml, codexRegistryFixtureYaml, coreFormsRegistryFixtureYaml, createTenantFixture, findRegistryEntry } from '../configuration/environment-registry.support.ts';
describe('environment registry overlays', () => {
it('loads market auth entries from the tenant overlay', async () => {
		const tenantRoot = await createTenantFixture(`entries:
  TREESEED_API_BASE_URL:
    label: Treeseed API base URL
    group: auth
    description: Tenant auth overlay entry.
    howToGet: Set the API origin.
    sensitivity: plain
    targets:
      - local-runtime
      - railway-var
    scopes:
      - local
      - staging
      - prod
    requirement: required
    purposes:
      - dev
      - deploy
      - config
    validation:
      kind: nonempty
`);
		tempRoots.add(tenantRoot);

		const registry = resolveEnvironmentRegistry({
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

		expect(registry.entries.find((entry) => entry.id === 'TREESEED_API_BASE_URL')).toMatchObject({
			group: 'auth',
			description: 'Tenant auth overlay entry.',
		});
		const formTokenSecret = findRegistryEntry(registry, 'TREESEED_FORM_TOKEN_SECRET');
		if (formTokenSecret) {
			expect(formTokenSecret.group).toBe('forms');
		}
	});
});
