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
it('surfaces hosted Codex auth bootstrap and policy entries from the agent registry', async () => {
		const tenantRoot = await createTenantFixture(codexRegistryFixtureYaml);
		tempRoots.add(tenantRoot);

		const registry = resolveEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				providers: { agents: { execution: 'codex' } },
				services: { api: { provider: 'railway', enabled: true } },
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		const authBootstrap = findRegistryEntry(registry, 'TREESEED_CODEX_AUTH_JSON_B64');
		expect(authBootstrap).toMatchObject({
			sensitivity: 'secret',
			storage: 'scoped',
		});
		expect(authBootstrap?.targets).toEqual(expect.arrayContaining(['railway-secret', 'github-secret']));
		expect(authBootstrap?.scopes).toEqual(expect.arrayContaining(['staging', 'prod']));

		const overwrite = findRegistryEntry(registry, 'TREESEED_CODEX_AUTH_OVERWRITE');
		expect(overwrite?.sensitivity).toBe('plain');
		expect(overwrite?.targets).toEqual(expect.arrayContaining(['railway-var', 'local-runtime']));
		expect(overwrite?.targets).not.toContain('railway-secret');

		for (const id of [
			'TREESEED_CODEX_SUBSCRIPTION_PLAN',
			'TREESEED_CODEX_DEFAULT_MODEL',
			'TREESEED_CODEX_APPROVAL_POLICY',
			'TREESEED_CODEX_SANDBOX_MODE',
			'TREESEED_CODEX_TIMEOUT_MS',
			'TREESEED_CODEX_REQUIRE_RELEASE_DECISION',
			'TREESEED_CODEX_ALLOW_FEATURE_BRANCH_MUTATION',
			'TREESEED_CODEX_ALLOW_AUTOMATIC_STAGING_MERGE',
			'TREESEED_CODEX_REQUIRE_ALLOWED_PATHS',
			'TREESEED_CODEX_RECORD_THREAD_IDS',
		]) {
			const entry = findRegistryEntry(registry, id);
			expect(entry, id).toBeDefined();
			expect(entry?.targets).toEqual(expect.arrayContaining(['railway-var', 'github-variable']));
			expect(entry?.sensitivity).toBe('plain');
			expect(isEnvironmentEntryRelevant(entry!, registry.context, 'staging', 'config')).toBe(true);
		}
	});
});
