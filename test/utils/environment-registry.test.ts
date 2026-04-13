import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTreeseedEnvironmentRegistry } from '../../src/platform/environment.ts';

const tempRoots = new Set<string>();

async function createTenantFixture(envYaml: string) {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-env-registry-'));
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n',
	);
	await writeFile(
		join(tenantRoot, 'treeseed.site.yaml'),
		'name: Test Site\nslug: test-site\nsiteUrl: https://example.com\ncontactEmail: hello@example.com\ncloudflare:\n  accountId: account-123\nservices:\n  api:\n    provider: railway\n    enabled: true\n',
	);
	await writeFile(join(tenantRoot, 'src/env.yaml'), envYaml);
	return tenantRoot;
}

afterEach(async () => {
	for (const tenantRoot of tempRoots) {
		await rm(tenantRoot, { recursive: true, force: true });
	}
	tempRoots.clear();
});

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
      - local-file
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

		expect(registry.entries.find((entry) => entry.id === 'TREESEED_API_BASE_URL')).toMatchObject({
			group: 'auth',
			description: 'Tenant auth overlay entry.',
		});
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET')).toBeTruthy();
	});

	it('does not surface market auth entries for tenants without the overlay', async () => {
		const tenantRoot = await createTenantFixture('entries: {}\n');
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

		expect(registry.entries.find((entry) => entry.id === 'TREESEED_API_BASE_URL')).toBeUndefined();
		expect(registry.entries.find((entry) => entry.id === 'TREESEED_FORM_TOKEN_SECRET')).toBeTruthy();
	});
});
