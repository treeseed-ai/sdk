import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	collectTreeseedConfigContext,
	createDefaultTreeseedMachineConfig,
	ensureTreeseedSecretSessionForConfig,
	getTreeseedMachineConfigPaths,
	inspectTreeseedKeyAgentStatus,
	loadTreeseedMachineConfig,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedMachineEnvironmentValues,
	applyTreeseedConfigValues,
	setTreeseedMachineEnvironmentValue,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
	warnDeprecatedTreeseedLocalEnvFiles,
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
      - local-runtime
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

function unlockSecrets(tenantRoot: string) {
	vi.stubEnv(TREESEED_MACHINE_KEY_PASSPHRASE_ENV, 'test-passphrase');
	unlockTreeseedSecretSessionFromEnv(tenantRoot);
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
		unlockSecrets(tenantRoot);

		expect(resolveTreeseedMachineEnvironmentValues(tenantRoot, 'prod').SHARED_VALUE).toBe('legacy-local');

		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'SHARED_VALUE',
			sensitivity: 'plain',
			storage: 'shared',
		} as any, 'shared-value');

		expect(resolveTreeseedMachineEnvironmentValues(tenantRoot, 'local').SHARED_VALUE).toBe('shared-value');
		expect(resolveTreeseedMachineEnvironmentValues(tenantRoot, 'prod').SHARED_VALUE).toBe('shared-value');
	});

	it('builds launch env from machine config without recreating deprecated env files', () => {
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
		writeTreeseedMachineConfig(tenantRoot, config);
		unlockSecrets(tenantRoot);
		setTreeseedMachineEnvironmentValue(tenantRoot, 'local', {
			id: 'SHARED_VALUE',
			sensitivity: 'plain',
			storage: 'shared',
		} as any, 'from-machine');
		writeFileSync(resolve(tenantRoot, '.env.local'), 'SHARED_VALUE=legacy-file\n', 'utf8');

		const warnings: string[] = [];
		const originalWarn = console.warn;
		console.warn = (line: string) => warnings.push(line);
		expect(
			resolveTreeseedLaunchEnvironment({
				tenantRoot,
				scope: 'local',
				baseEnv: { SHARED_VALUE: 'from-shell', EXTRA_VALUE: 'kept' },
				overrides: { EXPLICIT_VALUE: 'from-override' },
			}),
		).toMatchObject({
			SHARED_VALUE: 'from-machine',
			EXTRA_VALUE: 'kept',
			EXPLICIT_VALUE: 'from-override',
		});

		warnDeprecatedTreeseedLocalEnvFiles(tenantRoot, (line) => warnings.push(line));
		expect(warnings[0]).toContain('.env.local');
		expect(existsSync(resolve(tenantRoot, '.dev.vars'))).toBe(false);
		console.warn = originalWarn;
	});

	it('creates a wrapped machine key and unlocks the in-memory secret session', () => {
		const tenantRoot = createTenantFixture();
		writeTreeseedMachineConfig(tenantRoot, createDefaultTreeseedMachineConfig({
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
		}));

		unlockSecrets(tenantRoot);
		const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
		const status = inspectTreeseedKeyAgentStatus(tenantRoot);

		expect(status.unlocked).toBe(true);
		expect(status.wrappedKeyPresent).toBe(true);
		expect(readFileSync(keyPath, 'utf8')).toContain('"kind": "treeseed-wrapped-machine-key"');
	});

	it('migrates a legacy plaintext machine key when unlocking from env', () => {
		const tenantRoot = createTenantFixture();
		writeTreeseedMachineConfig(tenantRoot, createDefaultTreeseedMachineConfig({
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
		}));

		const { keyPath } = getTreeseedMachineConfigPaths(tenantRoot);
		mkdirSync(dirname(keyPath), { recursive: true });
		writeFileSync(keyPath, Buffer.alloc(32, 7).toString('base64'), { mode: 0o600 });

		unlockSecrets(tenantRoot);
		const status = inspectTreeseedKeyAgentStatus(tenantRoot);

		expect(status.unlocked).toBe(true);
		expect(status.migrationRequired).toBe(false);
		expect(readFileSync(keyPath, 'utf8')).toContain('"kind": "treeseed-wrapped-machine-key"');
	});

	it('bootstraps an interactive wrapped key for config before saving secrets', async () => {
		const tenantRoot = createTenantFixture();
		delete process.env[TREESEED_MACHINE_KEY_PASSPHRASE_ENV];
		writeTreeseedMachineConfig(tenantRoot, createDefaultTreeseedMachineConfig({
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
		}));

		const bootstrap = await ensureTreeseedSecretSessionForConfig({
			tenantRoot,
			interactive: true,
			promptForNewPassphrase: () => 'test-passphrase',
		});

		expect(bootstrap.status.unlocked).toBe(true);
		expect(bootstrap.createdWrappedKey).toBe(true);
		expect(bootstrap.unlockSource).toBe('interactive');
	});

	it('reports provider token readiness separately from tool availability', () => {
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
		writeTreeseedMachineConfig(tenantRoot, config);
		unlockSecrets(tenantRoot);
		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'GH_TOKEN',
			sensitivity: 'secret',
			storage: 'shared',
		} as any, 'gh_test_value');
		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'CLOUDFLARE_API_TOKEN',
			sensitivity: 'secret',
			storage: 'shared',
		} as any, 'cf_test_value');
		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'CLOUDFLARE_ACCOUNT_ID',
			sensitivity: 'plain',
			storage: 'shared',
		} as any, 'account-123');

		const context = collectTreeseedConfigContext({
			tenantRoot,
			scopes: ['staging'],
			env: {},
		});

		expect(context.configReadinessByScope.staging.github.configured).toBe(true);
		expect(context.configReadinessByScope.staging.cloudflare.configured).toBe(true);
		expect(context.configReadinessByScope.staging.railway.configured).toBe(false);
	});

	it('ignores legacy Railway API token aliases', () => {
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
		writeTreeseedMachineConfig(tenantRoot, config);
		unlockSecrets(tenantRoot);

		const context = collectTreeseedConfigContext({
			tenantRoot,
			scopes: ['staging'],
			env: { RAILWAY_API_KEY: 'legacy-railway-key' } as any,
		});

		expect(context.valuesByScope.staging.RAILWAY_API_TOKEN).toBeUndefined();
		expect(context.configReadinessByScope.staging.railway.configured).toBe(false);
	});

	it('hides system-managed Railway topology IDs from the config editor', () => {
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
		writeTreeseedMachineConfig(tenantRoot, config);
		unlockSecrets(tenantRoot);
		for (const id of [
			'TREESEED_RAILWAY_PROJECT_ID',
			'TREESEED_RAILWAY_ENVIRONMENT_ID',
			'TREESEED_RAILWAY_WORKER_SERVICE_ID',
		]) {
			setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
				id,
				sensitivity: 'plain',
				storage: 'scoped',
			} as any, `${id.toLowerCase()}-value`);
		}

		const context = collectTreeseedConfigContext({
			tenantRoot,
			scopes: ['staging'],
			env: {},
		});
		const visibleIds = context.entriesByScope.staging.map((entry) => entry.id);

		expect(visibleIds).not.toContain('TREESEED_RAILWAY_PROJECT_ID');
		expect(visibleIds).not.toContain('TREESEED_RAILWAY_ENVIRONMENT_ID');
		expect(visibleIds).not.toContain('TREESEED_RAILWAY_WORKER_SERVICE_ID');
		expect(context.valuesByScope.staging.TREESEED_RAILWAY_PROJECT_ID).toBe('treeseed_railway_project_id-value');
		expect(context.valuesByScope.staging.TREESEED_RAILWAY_ENVIRONMENT_ID).toBe('treeseed_railway_environment_id-value');
		expect(context.valuesByScope.staging.TREESEED_RAILWAY_WORKER_SERVICE_ID).toBe('treeseed_railway_worker_service_id-value');
	});

	it('does not treat one-character Railway token values as configured', () => {
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
		writeTreeseedMachineConfig(tenantRoot, config);
		unlockSecrets(tenantRoot);
		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'RAILWAY_API_TOKEN',
			sensitivity: 'secret',
			storage: 'shared',
		} as any, '0');

		const context = collectTreeseedConfigContext({
			tenantRoot,
			scopes: ['staging'],
			env: {},
		});

		expect(context.valuesByScope.staging.RAILWAY_API_TOKEN).toBe('0');
		expect(context.validationByScope.staging.invalid).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: 'RAILWAY_API_TOKEN' }),
			]),
		);
		expect(context.configReadinessByScope.staging.railway.configured).toBe(false);
	});

	it('promotes newly shared hosted config from staging into shared storage and reports conflicts', () => {
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
		writeTreeseedMachineConfig(tenantRoot, config);
		unlockSecrets(tenantRoot);

		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'SHARED_VALUE',
			label: 'Shared value',
			sensitivity: 'plain',
			storage: 'scoped',
		} as any, 'staging-value');
		setTreeseedMachineEnvironmentValue(tenantRoot, 'prod', {
			id: 'SHARED_VALUE',
			label: 'Shared value',
			sensitivity: 'plain',
			storage: 'scoped',
		} as any, 'prod-value');

		const result = applyTreeseedConfigValues({
			tenantRoot,
			updates: [],
			applyLocalEnvironment: false,
		});

		expect(result.sharedStorageMigrations).toEqual([
			expect.objectContaining({
				entryId: 'SHARED_VALUE',
				promotedFrom: 'staging',
				consolidatedScopes: ['staging', 'prod'],
				hadConflicts: true,
			}),
		]);
		expect(resolveTreeseedMachineEnvironmentValues(tenantRoot, 'prod').SHARED_VALUE).toBe('staging-value');
		const persisted = loadTreeseedMachineConfig(tenantRoot);
		expect(persisted.shared.values.SHARED_VALUE).toBe('staging-value');
		expect(persisted.environments.staging.values.SHARED_VALUE).toBeUndefined();
		expect(persisted.environments.prod.values.SHARED_VALUE).toBeUndefined();
	});
});
