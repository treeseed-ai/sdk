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
it('suggests local GitHub repository metadata from origin when present', async () => {
		const tenantRoot = await createTenantFixture(coreFormsRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		spawnSync('git', ['init', '-b', 'main'], { cwd: tenantRoot, stdio: 'ignore' });
		spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:knowledge-coop/market.git'], { cwd: tenantRoot, stdio: 'ignore' });
		const deployConfig = {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			cloudflare: { accountId: 'account-123' },
			__tenantRoot: tenantRoot,
		} as any;

		const suggested = getEnvironmentSuggestedValues({
			scope: 'local',
			purpose: 'config',
			deployConfig,
			plugins: [],
			values: {},
		});

		expect(suggested.TREESEED_GITHUB_OWNER).toBe('knowledge-coop');
		expect(suggested.TREESEED_GITHUB_REPOSITORY_NAME).toBe('market');
		expect(suggested.TREESEED_GITHUB_REPOSITORY_VISIBILITY).toBe('private');
	});
});
