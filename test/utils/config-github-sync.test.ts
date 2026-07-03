import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureGitHubActionsEnvironmentMock = vi.fn();
const listGitHubEnvironmentSecretNamesMock = vi.fn();
const listGitHubEnvironmentVariableNamesMock = vi.fn();
const listGitHubEnvironmentVariablesMock = vi.fn();
const upsertGitHubEnvironmentSecretMock = vi.fn();
const upsertGitHubEnvironmentVariableMock = vi.fn();
const ensureGitHubBootstrapRepositoryMock = vi.fn();
const maybeResolveGitHubRepositorySlugMock = vi.fn((root: string) => root.includes('/packages/api') ? 'treeseed-ai/api' : 'owner/repo');

vi.mock('../../src/operations/services/github-automation.ts', () => ({
	ensureGitHubBootstrapRepository: ensureGitHubBootstrapRepositoryMock,
	maybeResolveGitHubRepositorySlug: maybeResolveGitHubRepositorySlugMock,
}));

vi.mock('../../src/operations/services/github-api.ts', () => ({
	createGitHubApiClient: vi.fn(() => ({ id: 'github-client' })),
	ensureGitHubActionsEnvironment: ensureGitHubActionsEnvironmentMock,
	ensureGitHubBranchFromBase: vi.fn(),
	listGitHubEnvironmentSecretNames: listGitHubEnvironmentSecretNamesMock,
	listGitHubEnvironmentVariableNames: listGitHubEnvironmentVariableNamesMock,
	listGitHubEnvironmentVariables: listGitHubEnvironmentVariablesMock,
	upsertGitHubEnvironmentSecret: upsertGitHubEnvironmentSecretMock,
	upsertGitHubEnvironmentVariable: upsertGitHubEnvironmentVariableMock,
}));

const {
	collectTreeseedConfigContext,
	createDefaultTreeseedMachineConfig,
	finalizeTreeseedConfig,
	setTreeseedMachineEnvironmentValue,
	syncTreeseedGitHubEnvironment,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
	writeTreeseedMachineConfig,
} = await import('../../src/operations/services/config-runtime.ts');

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-config-github-sync-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
	writeFileSync(resolve(tenantRoot, 'src', 'env.yaml'), `entries:
  TREESEED_GITHUB_TOKEN:
    label: GitHub token
    group: github
    description: GitHub token.
    howToGet: Set a GitHub token.
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
`);
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: self_hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
  pages:
    projectName: test-site
    previewProjectName: test-site
  r2:
    bucketName: test-site-content
    binding: TREESEED_CONTENT_BUCKET
services:
  api:
    provider: railway
    enabled: true
`);
	return tenantRoot;
}

function addPackageApiApplication(tenantRoot: string) {
	mkdirSync(resolve(tenantRoot, 'packages', 'api'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'package.json'), JSON.stringify({
		name: 'workspace',
		workspaces: ['packages/*'],
	}, null, 2));
	writeFileSync(resolve(tenantRoot, 'packages', 'api', 'package.json'), JSON.stringify({
		name: '@treeseed/api',
		repository: {
			type: 'git',
			url: 'git+ssh://git@github.com/treeseed-ai/api.git',
		},
	}, null, 2));
	writeFileSync(resolve(tenantRoot, 'packages', 'api', 'treeseed.site.yaml'), `name: TreeSeed API
slug: treeseed-api
siteUrl: https://api.example.com
contactEmail: hello@example.com
hosting:
  kind: treeseed_control_plane
  registration: none
runtime:
  mode: treeseed_managed
surfaces:
  api:
    enabled: true
    provider: railway
services:
  api:
    enabled: true
    provider: railway
`);
}

function createTenantFixtureWithPlaceholderCloudflareAccount() {
	const tenantRoot = createTenantFixture();
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: self_hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: replace-with-cloudflare-account-id
  pages:
    projectName: test-site
    previewProjectName: test-site
  r2:
    bucketName: test-site-content
    binding: TREESEED_CONTENT_BUCKET
services:
  api:
    provider: railway
    enabled: true
`);
	return tenantRoot;
}

function createManagedHostedTenantFixture() {
	const tenantRoot = createTenantFixture();
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: hosted_project
  registration: optional
  marketBaseUrl: https://api.treeseed.dev
  teamId: acme
  projectId: docs
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
cloudflare:
  accountId: account-123
  pages:
    projectName: test-site
    previewProjectName: test-site
  r2:
    bucketName: test-site-content
    binding: TREESEED_CONTENT_BUCKET
services:
  api:
    provider: railway
    enabled: true
`);
	return tenantRoot;
}

function unlockSecrets(tenantRoot: string) {
	vi.stubEnv(TREESEED_MACHINE_KEY_PASSPHRASE_ENV, 'test-passphrase');
	unlockTreeseedSecretSessionFromEnv(tenantRoot);
}

function writeDefaultMachineConfig(tenantRoot: string) {
	writeTreeseedMachineConfig(tenantRoot, createDefaultTreeseedMachineConfig({
		tenantRoot,
		deployConfig: {
			name: 'Test Site',
			slug: 'test-site',
			siteUrl: 'https://example.com',
			contactEmail: 'hello@example.com',
			hosting: { kind: 'self_hosted_project', teamId: 'acme', projectId: 'docs' },
			cloudflare: {
				accountId: 'account-123',
				pages: { projectName: 'test-site', previewProjectName: 'test-site' },
				r2: { bucketName: 'test-site-content', binding: 'TREESEED_CONTENT_BUCKET' },
			},
			services: { api: { provider: 'railway', enabled: true } },
		} as any,
		tenantConfig: { id: 'test-site' } as any,
	}));
}

function setConfigValue(
	tenantRoot: string,
	scope: 'local' | 'staging' | 'prod',
	id: string,
	value: string,
	sensitivity: 'plain' | 'secret' = 'plain',
	storage?: 'shared' | 'scoped',
) {
	setTreeseedMachineEnvironmentValue(tenantRoot, scope, {
		id,
		sensitivity,
		storage: storage ?? (id === 'TREESEED_PROJECT_RUNNER_TOKEN' ? 'scoped' : 'shared'),
	} as any, value);
}

function seedHostedValues(tenantRoot: string) {
	for (const scope of ['staging', 'prod'] as const) {
		setConfigValue(tenantRoot, scope, 'TREESEED_GITHUB_TOKEN', 'github-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_CODEX_API_KEY', 'codex-test-key-1234567890', 'secret', 'scoped');
		setConfigValue(tenantRoot, scope, 'TREESEED_CLOUDFLARE_API_TOKEN', 'cloudflare-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_RAILWAY_API_TOKEN', 'railway-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_RAILWAY_WORKSPACE', 'acme-workspace');
		setConfigValue(tenantRoot, scope, 'TREESEED_CLOUDFLARE_ACCOUNT_ID', 'account-123');
		setConfigValue(tenantRoot, scope, 'TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME', 'test-site');
		setConfigValue(tenantRoot, scope, 'TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME', 'test-site');
		setConfigValue(tenantRoot, scope, 'TREESEED_CONTENT_BUCKET_NAME', 'test-site-content');
		setConfigValue(tenantRoot, scope, 'TREESEED_CONTENT_BUCKET_BINDING', 'TREESEED_CONTENT_BUCKET');
		setConfigValue(tenantRoot, scope, 'TREESEED_FORM_TOKEN_SECRET', 'form-secret-value', 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_EDITORIAL_PREVIEW_SECRET', 'preview-secret-value', 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_PROJECT_RUNNER_TOKEN', `runner-token-${scope}`, 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_WORKER_POOL_SCALER', 'railway');
		setConfigValue(tenantRoot, scope, 'TREESEED_AGENT_POOL_MIN_WORKERS', '0');
		setConfigValue(tenantRoot, scope, 'TREESEED_AGENT_POOL_MAX_WORKERS', '2');
		setConfigValue(tenantRoot, scope, 'TREESEED_AGENT_POOL_TARGET_QUEUE_DEPTH', '1');
		setConfigValue(tenantRoot, scope, 'TREESEED_AGENT_POOL_COOLDOWN_SECONDS', '60');
		setConfigValue(tenantRoot, scope, 'TREESEED_WORKDAY_TIMEZONE', 'America/New_York');
		setConfigValue(tenantRoot, scope, 'TREESEED_WORKDAY_WINDOWS_JSON', '[]');
		setConfigValue(tenantRoot, scope, 'TREESEED_WORKDAY_TASK_CREDIT_BUDGET', '20');
		setConfigValue(tenantRoot, scope, 'TREESEED_MANAGER_MAX_QUEUED_TASKS', '5');
		setConfigValue(tenantRoot, scope, 'TREESEED_MANAGER_MAX_QUEUED_CREDITS', '20');
		setConfigValue(tenantRoot, scope, 'TREESEED_MANAGER_PRIORITY_MODELS', 'objective,question,note,page,book,knowledge');
		setConfigValue(tenantRoot, scope, 'TREESEED_TASK_CREDIT_WEIGHTS_JSON', '[]');
	}
}

function hasConfigEntry(tenantRoot: string, id: string) {
	return collectTreeseedConfigContext({ tenantRoot, scopes: ['staging'], env: {} })
		.registry.entries.some((entry) => entry.id === id);
}

describe('config GitHub environment sync reconciliation', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-config-github-home-')));
		const secretNames = new Set<string>();
		const variableNames = new Set<string>();
		maybeResolveGitHubRepositorySlugMock.mockClear();
		ensureGitHubBootstrapRepositoryMock.mockReset().mockResolvedValue({ repository: 'owner/repo', created: false });
		ensureGitHubActionsEnvironmentMock.mockReset().mockResolvedValue({});
		listGitHubEnvironmentSecretNamesMock.mockReset().mockImplementation(async () => new Set(secretNames));
		listGitHubEnvironmentVariableNamesMock.mockReset().mockImplementation(async () => new Set(variableNames));
		listGitHubEnvironmentVariablesMock.mockReset().mockImplementation(async () => new Map([...variableNames].map((name) => [name, `${name}-value`] as const)));
		upsertGitHubEnvironmentSecretMock.mockReset().mockImplementation(async (_repository: string, _environment: string, name: string) => {
			secretNames.add(name);
		});
		upsertGitHubEnvironmentVariableMock.mockReset().mockImplementation(async (_repository: string, _environment: string, name: string) => {
			variableNames.add(name);
		});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('syncs GitHub environment values through reconciler-owned binding units', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);

		const result = await syncTreeseedGitHubEnvironment({ tenantRoot, scope: 'staging', entryIds: ['TREESEED_GITHUB_TOKEN'] });

		expect(result).toMatchObject({
			repository: 'owner/repo',
			scope: 'staging',
			environment: 'staging',
		});
		expect(result.secrets.length + result.variables.length).toBeGreaterThan(0);
		expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalled();
	});

	it('keeps GitHub environment dry-run reporting non-mutating', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);

		const result = await syncTreeseedGitHubEnvironment({ tenantRoot, scope: 'staging', dryRun: true });

		expect(result).toMatchObject({
			repository: 'owner/repo',
			scope: 'staging',
			environment: 'staging',
		});
		expect(result.secrets.length + result.variables.length).toBeGreaterThan(0);
		expect(ensureGitHubActionsEnvironmentMock).not.toHaveBeenCalled();
		expect(upsertGitHubEnvironmentSecretMock).not.toHaveBeenCalled();
		expect(upsertGitHubEnvironmentVariableMock).not.toHaveBeenCalled();
	});

	it('finalize github sync applies provider values through reconciliation', async () => {
		const tenantRoot = createTenantFixtureWithPlaceholderCloudflareAccount();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		setConfigValue(tenantRoot, 'staging', 'TREESEED_CODEX_API_KEY', 'codex-test-key-1234567890', 'secret', 'scoped');
		setConfigValue(tenantRoot, 'staging', 'TREESEED_GITHUB_TOKEN', 'github-token-value', 'secret');

		const result = await finalizeTreeseedConfig({
			tenantRoot,
			scopes: ['staging'],
			sync: 'github',
			checkConnections: false,
			initializePersistent: true,
			systems: ['github'],
		});

		expect(result.synced.github).toBeTruthy();
		expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalled();
	}, 15_000);

});
