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
it('surfaces agent API entries when the API processing plane is enabled', async () => {
		const tenantRoot = await createTenantFixture(agentProcessingRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		await writeFile(join(tenantRoot, 'package.json'), '{"name":"test-site","private":true,"workspaces":["packages/*"]}\n');

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

		const apiBaseUrl = findRegistryEntry(registry, 'TREESEED_API_BASE_URL');
		if (apiBaseUrl) {
			expect(apiBaseUrl.targets).toContain('railway-var');
		} else {
			expect(findRegistryEntry(registry, 'TREESEED_FORM_TOKEN_SECRET')).toBeUndefined();
		}
	});

	it('surfaces Agent-owned authentication entries when an API package application is discovered', async () => {
		const tenantRoot = await createTenantFixture(agentProcessingRegistryFixtureYaml);
		tempRoots.add(tenantRoot);
		await writeFile(join(tenantRoot, 'package.json'), '{"name":"test-site","private":true,"workspaces":["packages/*"]}\n');
		await writeFile(join(tenantRoot, 'treeseed.site.yaml'), 'name: Test Site\nslug: test-site\nsiteUrl: https://example.com\ncontactEmail: hello@example.com\n');
		await mkdir(join(tenantRoot, 'packages/api'), { recursive: true });
		await writeFile(join(tenantRoot, 'packages/api/package.json'), '{"name":"@test/api","private":true}\n');
		await writeFile(join(tenantRoot, 'packages/api/treeseed.site.yaml'), 'name: Test API\nslug: test-api\nsiteUrl: http://127.0.0.1:3000\ncontactEmail: hello@example.com\nhosting:\n  kind: treeseed_control_plane\n  registration: none\nsurfaces:\n  api:\n    enabled: true\n    provider: local\nservices:\n  api:\n    enabled: true\n    provider: local\n');

		const registry = resolveEnvironmentRegistry({
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://example.com',
				contactEmail: 'hello@example.com',
				__tenantRoot: tenantRoot,
			} as any,
			plugins: [],
		});

		expect(findRegistryEntry(registry, 'TREESEED_API_BOOTSTRAP_ADMIN_ALLOWLIST')).toBeDefined();
	});
});
