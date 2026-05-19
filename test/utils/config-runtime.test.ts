import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	collectTreeseedConfigContext,
	createDefaultTreeseedMachineConfig,
	ensureTreeseedRailwayIgnoreEntries,
	ensureTreeseedSecretSessionForConfig,
	getTreeseedMachineConfigPaths,
	inspectTreeseedKeyAgentStatus,
	loadTreeseedMachineConfig,
	applyTreeseedEnvironmentToProcess,
	resolveTreeseedLaunchEnvironment,
	resolveTreeseedMachineEnvironmentValues,
	applyTreeseedConfigValues,
	setTreeseedMachineEnvironmentValue,
	syncTreeseedRailwayEnvironment,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
	validateTreeseedCommandEnvironment,
	warnDeprecatedTreeseedLocalEnvFiles,
	writeTreeseedMachineConfig,
} from '../../src/operations/services/config-runtime.ts';

const railwayRegistryFixtureEntries = `
  RAILWAY_API_TOKEN:
    label: Railway API token
    group: auth
    description: Railway API token.
    howToGet: Set a Railway token.
    sensitivity: secret
    targets:
      - github-secret
    scopes:
      - staging
      - prod
    storage: shared
    requirement: conditional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
      minLength: 8
    sourcePriority:
      - machine-config
      - process-env
    relevanceRef: railwayManagedEnabled
    requiredWhenRef: railwayManagedEnabled
  TREESEED_RAILWAY_PROJECT_ID:
    label: Railway project ID
    group: hosting
    visibility: system
    description: Railway project identifier.
    howToGet: Set the Railway project ID.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
  TREESEED_RAILWAY_ENVIRONMENT_ID:
    label: Railway environment ID
    group: hosting
    visibility: system
    description: Railway environment identifier.
    howToGet: Set the Railway environment ID.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
  TREESEED_RAILWAY_WORKER_SERVICE_ID:
    label: Railway worker service ID
    group: hosting
    visibility: system
    description: Railway worker service identifier.
    howToGet: Set the Railway worker service ID.
    sensitivity: plain
    targets:
      - github-variable
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
    sourcePriority:
      - machine-config
      - process-env
`;

const codexRegistryFixtureEntries = `
  TREESEED_CODEX_AUTH_JSON_B64:
    label: Codex auth JSON bootstrap secret
    group: auth
    description: Base64-encoded Codex login auth.json.
    howToGet: Store a base64-encoded Codex auth.json.
    sensitivity: secret
    targets:
      - railway-secret
      - github-secret
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - bootstrap
      - config
    validation:
      kind: nonempty
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_APPROVAL_POLICY:
    label: Codex approval policy
    group: auth
    description: Codex approval policy.
    howToGet: Set the approval policy.
    sensitivity: plain
    targets:
      - railway-var
      - github-variable
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - config
    validation:
      kind: enum
      values:
        - never
        - on_request
        - always
    relevanceRef: codexExecutionSelected
  TREESEED_CODEX_AUTH_OVERWRITE:
    label: Overwrite Codex auth file
    group: auth
    description: Codex auth overwrite flag.
    howToGet: Set only during auth rotation.
    sensitivity: plain
    targets:
      - railway-var
      - local-runtime
    scopes:
      - staging
      - prod
    storage: scoped
    requirement: optional
    purposes:
      - agent-execution
      - bootstrap
      - config
    validation:
      kind: boolean
    relevanceRef: codexExecutionSelected
`;

function createTenantFixture(extraEnvEntries = '') {
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
${extraEnvEntries}
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

	it('includes market control plane hosted repository entries when hub and runtime planes are explicit', () => {
		const tenantRoot = createTenantFixture(`
  TREESEED_HOSTED_HUBS_GITHUB_OWNER:
    label: Hosted repository owner
    group: github
    description: GitHub owner for hosted hub repositories.
    howToGet: Set a GitHub organization or owner.
    sensitivity: plain
    targets:
      - local-runtime
    scopes:
      - staging
      - prod
    storage: shared
    requirement: conditional
    relevanceRef: marketControlPlaneEnabled
    requiredWhenRef: marketControlPlaneEnabled
    purposes:
      - config
    validation:
      kind: nonempty
  TREESEED_HOSTED_HUBS_GITHUB_TOKEN:
    label: Hosted repository access token
    group: github
    description: GitHub token for hosted hub repositories.
    howToGet: Set a GitHub token with repository permissions.
    sensitivity: secret
    targets:
      - local-runtime
    scopes:
      - staging
      - prod
    storage: shared
    requirement: conditional
    relevanceRef: marketControlPlaneEnabled
    requiredWhenRef: marketControlPlaneEnabled
    purposes:
      - config
    validation:
      kind: nonempty
      minLength: 8
`);
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Market
slug: test-market
siteUrl: https://market.example.com
contactEmail: hello@example.com
hosting:
  kind: market_control_plane
  teamId: treeseed
  projectId: market
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
  registration: none
cloudflare:
  accountId: account-123
`);

		const context = collectTreeseedConfigContext({
			tenantRoot,
			scopes: ['staging'],
			env: {},
		});
		const entries = context.entriesByScope.staging.filter((entry) => entry.id.startsWith('TREESEED_HOSTED_HUBS_GITHUB_'));

		expect(entries.map((entry) => [entry.id, entry.required]).sort()).toEqual([
			['TREESEED_HOSTED_HUBS_GITHUB_OWNER', true],
			['TREESEED_HOSTED_HUBS_GITHUB_TOKEN', true],
		]);
	});

	it('does not require processing-only hosted repository entries for web deploy validation', () => {
		const tenantRoot = createTenantFixture(`
  TREESEED_HOSTED_HUBS_GITHUB_OWNER:
    label: Hosted repository owner
    group: github
    description: GitHub owner for hosted hub repositories.
    howToGet: Set a GitHub organization or owner.
    sensitivity: plain
    targets:
      - local-runtime
      - railway-var
    scopes:
      - staging
      - prod
    storage: shared
    requirement: conditional
    relevanceRef: marketControlPlaneEnabled
    requiredWhenRef: marketControlPlaneEnabled
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
  TREESEED_HOSTED_HUBS_GITHUB_TOKEN:
    label: Hosted repository access token
    group: github
    description: GitHub token for hosted hub repositories.
    howToGet: Set a GitHub token with repository permissions.
    sensitivity: secret
    targets:
      - local-runtime
      - railway-secret
    scopes:
      - staging
      - prod
    storage: shared
    requirement: conditional
    relevanceRef: marketControlPlaneEnabled
    requiredWhenRef: marketControlPlaneEnabled
    purposes:
      - deploy
      - config
    validation:
      kind: nonempty
      minLength: 8
`);
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Market
slug: test-market
siteUrl: https://market.example.com
contactEmail: hello@example.com
hosting:
  kind: market_control_plane
  teamId: treeseed
  projectId: market
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
  registration: none
cloudflare:
  accountId: account-123
`);

		vi.stubEnv('TREESEED_WORKFLOW_PLANE', 'web');
		const webValidation = validateTreeseedCommandEnvironment({
			tenantRoot,
			scope: 'staging',
			purpose: 'deploy',
		}).validation;
		expect(webValidation.required.map((entry) => entry.id)).not.toContain('TREESEED_HOSTED_HUBS_GITHUB_OWNER');
		expect(webValidation.required.map((entry) => entry.id)).not.toContain('TREESEED_HOSTED_HUBS_GITHUB_TOKEN');

		vi.stubEnv('TREESEED_WORKFLOW_PLANE', 'processing');
		const processingValidation = validateTreeseedCommandEnvironment({
			tenantRoot,
			scope: 'staging',
			purpose: 'deploy',
		}).validation;
		expect(processingValidation.required.map((entry) => entry.id)).toEqual(expect.arrayContaining([
			'TREESEED_HOSTED_HUBS_GITHUB_OWNER',
			'TREESEED_HOSTED_HUBS_GITHUB_TOKEN',
		]));
	});

	it('includes Codex auth bootstrap secrets and policy variables in Railway sync plans', () => {
		const tenantRoot = createTenantFixture(codexRegistryFixtureEntries);
		writeTreeseedMachineConfig(tenantRoot, createDefaultTreeseedMachineConfig({
			tenantRoot,
			deployConfig: {
				name: 'Test Site',
				slug: 'test-site',
				siteUrl: 'https://market.example.com',
				contactEmail: 'hello@example.com',
				cloudflare: { accountId: 'account-123' },
				providers: { agents: { execution: 'codex' } },
				services: { api: { provider: 'railway', enabled: true } },
			} as any,
			tenantConfig: { id: 'test-site' } as any,
		}));
		unlockSecrets(tenantRoot);
		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'TREESEED_CODEX_AUTH_JSON_B64',
			sensitivity: 'secret',
			storage: 'scoped',
		} as any, 'eyJPUEVOQUlfQ09ERVhfTE9HSU4iOiJ0ZXN0In0=');
		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'TREESEED_CODEX_APPROVAL_POLICY',
			sensitivity: 'plain',
			storage: 'scoped',
		} as any, 'never');
		setTreeseedMachineEnvironmentValue(tenantRoot, 'staging', {
			id: 'TREESEED_CODEX_AUTH_OVERWRITE',
			sensitivity: 'plain',
			storage: 'scoped',
		} as any, '0');

		const plan = syncTreeseedRailwayEnvironment({ tenantRoot, scope: 'staging', dryRun: true });
		const apiService = plan.services.find((service) => service.service === 'api');
		const context = collectTreeseedConfigContext({ tenantRoot, scopes: ['staging'], env: {} });
		const configEntryIds = context.entriesByScope.staging.map((entry) => entry.id);

		expect(configEntryIds).toEqual(expect.arrayContaining([
			'TREESEED_CODEX_AUTH_JSON_B64',
			'TREESEED_CODEX_APPROVAL_POLICY',
			'TREESEED_CODEX_AUTH_OVERWRITE',
		]));
		expect(apiService?.secrets).toContain('TREESEED_CODEX_AUTH_JSON_B64');
		expect(apiService?.variables).toEqual(expect.arrayContaining([
			'TREESEED_CODEX_APPROVAL_POLICY',
			'TREESEED_CODEX_AUTH_OVERWRITE',
		]));
	});

	it('ensures Railway deploy ignore entries for local workspace artifacts', () => {
		const tenantRoot = createTenantFixture();
		writeFileSync(join(tenantRoot, '.railwayignore'), 'dist/\n**/dist/\npackages/*/dist/\n', 'utf8');

		const railwayIgnorePath = ensureTreeseedRailwayIgnoreEntries(tenantRoot);
		const contents = readFileSync(railwayIgnorePath, 'utf8');

		expect(contents).toContain('node_modules/');
		expect(contents).toContain('packages/*/node_modules/');
		expect(contents).not.toContain('\ndist/\n');
		expect(contents).not.toContain('**/dist/');
		expect(contents).not.toContain('packages/*/dist/');
		expect(contents).toContain('public/books/*.json');
	});

	it('builds launch env from machine config without recreating deprecated env files', () => {
		const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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

	it('keeps hosted process environment values ahead of machine config values', () => {
		const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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
			sensitivity: 'plain',
			storage: 'shared',
		} as any, 'from-machine');

		expect(
			resolveTreeseedLaunchEnvironment({
				tenantRoot,
				scope: 'staging',
				baseEnv: { SHARED_VALUE: 'from-env' } as any,
			}).SHARED_VALUE,
		).toBe('from-env');
	});

	it('keeps machine config values when hosted process environment values are empty', () => {
			const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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
		} as any, 'from-machine');

		expect(
			resolveTreeseedLaunchEnvironment({
				tenantRoot,
				scope: 'staging',
				baseEnv: { GH_TOKEN: '' } as any,
			}).GH_TOKEN,
		).toBe('from-machine');
	});

	it('builds launch env from process values when no wrapped machine key exists', () => {
			const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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

		expect(
			resolveTreeseedLaunchEnvironment({
				tenantRoot,
				scope: 'staging',
				baseEnv: {
					CLOUDFLARE_API_TOKEN: 'cf-token',
					CLOUDFLARE_ACCOUNT_ID: 'account-123',
					RAILWAY_API_TOKEN: 'railway-token',
				} as any,
			}),
		).toMatchObject({
			CLOUDFLARE_API_TOKEN: 'cf-token',
			CLOUDFLARE_ACCOUNT_ID: 'account-123',
			RAILWAY_API_TOKEN: 'railway-token',
		});
	});

	it('uses non-secret deploy defaults in hosted launch env without generating secrets', () => {
			const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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

		const env = resolveTreeseedLaunchEnvironment({
			tenantRoot,
			scope: 'staging',
			baseEnv: {
				CLOUDFLARE_API_TOKEN: 'cf-token',
				CLOUDFLARE_ACCOUNT_ID: 'account-123',
				RAILWAY_API_TOKEN: 'railway-token',
			} as any,
		});

		expect(env.TREESEED_HOSTING_KIND).toBe('self_hosted_project');
		expect(env.TREESEED_HOSTING_REGISTRATION).toBe('none');
		expect(env.TREESEED_CONTENT_BUCKET_BINDING).toBe('TREESEED_CONTENT_BUCKET');
		expect(env.TREESEED_EDITORIAL_PREVIEW_SECRET).toBeUndefined();
	});

	it('does not overwrite hosted process env values when applying config', () => {
			const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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
			sensitivity: 'plain',
			storage: 'shared',
		} as any, 'from-machine');
		vi.stubEnv('SHARED_VALUE', 'from-env');

		applyTreeseedEnvironmentToProcess({ tenantRoot, scope: 'staging', override: true });

		expect(process.env.SHARED_VALUE).toBe('from-env');
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
			const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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
			const tenantRoot = createTenantFixture(railwayRegistryFixtureEntries);
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
