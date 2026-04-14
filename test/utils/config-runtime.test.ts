import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	createDefaultTreeseedMachineConfig,
	resolveTreeseedMachineEnvironmentValues,
	setTreeseedMachineEnvironmentValue,
	writeTreeseedMachineConfig,
} from '../../src/operations/services/config-runtime.ts';

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-config-runtime-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://market.example.com
contactEmail: hello@example.com
cloudflare:
  accountId: account-123
services:
  api:
    provider: railway
    enabled: true
`);
	writeFileSync(resolve(tenantRoot, 'src', 'env.yaml'), `entries:
  SHARED_VALUE:
    label: Shared value
    group: auth
    description: Shared test value.
    howToGet: Set any value.
    sensitivity: plain
    targets:
      - local-file
    scopes:
      - local
      - staging
      - prod
    storage: shared
    requirement: optional
    purposes:
      - config
    validation:
      kind: nonempty
`);
	return tenantRoot;
}

describe('config runtime shared environment values', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-config-home-')));
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('resolves shared entries across scopes and persists them in shared storage', () => {
		const tenantRoot = createTenantFixture();
		const config = createDefaultTreeseedMachineConfig({
			tenantRoot,
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://market.example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				services: { api: { provider: 'railway', enabled: true } },
			} as any,
			tenantConfig: { id: 'test-site' } as any,
		});
		config.environments.local.values.SHARED_VALUE = 'legacy-local';
		writeTreeseedMachineConfig(tenantRoot, config);

		expect(resolveTreeseedMachineEnvironmentValues(tenantRoot, 'prod').SHARED_VALUE).toBe('legacy-local');

		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'SHARED_VALUE',
			sensitivity: 'plain',
			storage: 'shared',
		} as any, 'shared-value');

		expect(resolveTreeseedMachineEnvironmentValues(tenantRoot, 'local').SHARED_VALUE).toBe('shared-value');
		expect(resolveTreeseedMachineEnvironmentValues(tenantRoot, 'prod').SHARED_VALUE).toBe('shared-value');
	});
});
