import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ensureGitHubActionsEnvironmentMock = vi.fn();
const listGitHubEnvironmentSecretNamesMock = vi.fn();
const listGitHubEnvironmentVariableNamesMock = vi.fn();
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
  marketBaseUrl: https://api.treeseed.ai
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
		setConfigValue(tenantRoot, scope, 'GH_TOKEN', 'github-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'CODEX_API_KEY', 'codex-test-key-1234567890', 'secret', 'scoped');
		setConfigValue(tenantRoot, scope, 'CLOUDFLARE_API_TOKEN', 'cloudflare-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'RAILWAY_API_TOKEN', 'railway-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_RAILWAY_WORKSPACE', 'acme-workspace');
		setConfigValue(tenantRoot, scope, 'CLOUDFLARE_ACCOUNT_ID', 'account-123');
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

describe('config GitHub environment sync', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-config-github-home-')));
		maybeResolveGitHubRepositorySlugMock.mockClear();
		ensureGitHubBootstrapRepositoryMock.mockReset().mockResolvedValue({ repository: 'owner/repo', created: false });
		ensureGitHubActionsEnvironmentMock.mockReset().mockResolvedValue({});
		listGitHubEnvironmentSecretNamesMock.mockReset().mockResolvedValue(new Set());
		listGitHubEnvironmentVariableNamesMock.mockReset().mockResolvedValue(new Set());
		upsertGitHubEnvironmentSecretMock.mockReset().mockResolvedValue(undefined);
		upsertGitHubEnvironmentVariableMock.mockReset().mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('syncs a Treeseed scope into the matching GitHub Actions environment', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);
		setConfigValue(tenantRoot, 'staging', 'TREESEED_RAILWAY_PROJECT_ID', 'railway-project-id', 'plain', 'scoped');

		const result = await syncTreeseedGitHubEnvironment({ tenantRoot, scope: 'staging' });

		expect(result).toMatchObject({
			repository: 'owner/repo',
			scope: 'staging',
			environment: 'staging',
		});
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'staging', expect.objectContaining({
			branchName: 'staging',
		}));
		if (hasConfigEntry(tenantRoot, 'RAILWAY_API_TOKEN')) {
			expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalledWith(
				'owner/repo',
				'staging',
				'RAILWAY_API_TOKEN',
				'railway-token-value',
				expect.any(Object),
			);
		}
		expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'CLOUDFLARE_ACCOUNT_ID',
			'account-123',
			expect.any(Object),
		);
		expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME',
			'test-site',
			expect.any(Object),
		);
		if (hasConfigEntry(tenantRoot, 'TREESEED_RAILWAY_WORKSPACE')) {
			expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
				'owner/repo',
				'staging',
				'TREESEED_RAILWAY_WORKSPACE',
				'acme-workspace',
				expect.any(Object),
			);
		}
		if (hasConfigEntry(tenantRoot, 'TREESEED_RAILWAY_PROJECT_ID')) {
			expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
				'owner/repo',
				'staging',
				'TREESEED_RAILWAY_PROJECT_ID',
				'railway-project-id',
				expect.any(Object),
			);
		}
		expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'GH_TOKEN',
			'github-token-value',
			expect.any(Object),
		);
	});

	it('uses transient values overlays for GitHub environment sync without machine config writes', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);

		const result = await syncTreeseedGitHubEnvironment({
			tenantRoot,
			scope: 'staging',
			valuesOverlay: {
				CLOUDFLARE_API_TOKEN: 'unlocked-cloudflare-token',
				CLOUDFLARE_ACCOUNT_ID: 'unlocked-account',
				TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME: 'unlocked-pages',
			},
		});

		expect(result.scope).toBe('staging');
		expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'CLOUDFLARE_API_TOKEN',
			'unlocked-cloudflare-token',
			expect.any(Object),
		);
		expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'CLOUDFLARE_ACCOUNT_ID',
			'unlocked-account',
			expect.any(Object),
		);
		expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME',
			'unlocked-pages',
			expect.any(Object),
		);
	});

	it('does not sync TreeSeed-managed provider secrets into hosted project GitHub environments', async () => {
		const tenantRoot = createManagedHostedTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);
		setConfigValue(tenantRoot, 'staging', 'TREESEED_PROJECT_ID', 'docs');

		const result = await syncTreeseedGitHubEnvironment({
			tenantRoot,
			scope: 'staging',
			valuesOverlay: {
				CLOUDFLARE_API_TOKEN: 'unlocked-cloudflare-token',
				RAILWAY_API_TOKEN: 'unlocked-railway-token',
				TREESEED_SMTP_PASSWORD: 'unlocked-smtp-password',
				TREESEED_PROJECT_ID: 'docs',
			},
		});

		expect(result.scope).toBe('staging');
		const secretNames = upsertGitHubEnvironmentSecretMock.mock.calls.map((call) => call[2]);
		const variableNames = upsertGitHubEnvironmentVariableMock.mock.calls.map((call) => call[2]);
		expect(secretNames).not.toContain('GH_TOKEN');
		expect(secretNames).not.toContain('CLOUDFLARE_API_TOKEN');
		expect(secretNames).not.toContain('RAILWAY_API_TOKEN');
		expect(secretNames).not.toContain('TREESEED_SMTP_PASSWORD');
		expect(variableNames).not.toContain('CLOUDFLARE_ACCOUNT_ID');
		expect(variableNames).not.toContain('TREESEED_RAILWAY_WORKSPACE');
		expect(variableNames).toContain('TREESEED_PROJECT_ID');
	});

	it('explains repository-scoped credential requirements when fallback GitHub tokens cannot manage environments', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);
		listGitHubEnvironmentSecretNamesMock.mockRejectedValueOnce(new Error('Unable to list GitHub environment secrets: GitHub authentication failed.'));

		await expect(syncTreeseedGitHubEnvironment({
			tenantRoot,
			scope: 'staging',
			repository: 'treeseed-ai/api',
		})).rejects.toThrow(/Configure TREESEED_GITHUB_TOKEN_TREESEED_AI_API/u);
	});

	it('reports GitHub environment sync progress while syncing items', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);
		const progress = vi.fn();

		await syncTreeseedGitHubEnvironment({ tenantRoot, scope: 'staging', onProgress: progress, execution: 'sequential' });

		expect(progress).toHaveBeenCalledWith(expect.stringContaining('[staging][github][sync] Syncing GitHub environment staging: 0/'), 'stdout');
		if (hasConfigEntry(tenantRoot, 'RAILWAY_API_TOKEN')) {
			expect(progress).toHaveBeenCalledWith(expect.stringContaining('[staging][github][secret] created RAILWAY_API_TOKEN'), 'stdout');
		}
		expect(progress).toHaveBeenCalledWith(expect.stringContaining('[staging][github][variable] created CLOUDFLARE_ACCOUNT_ID'), 'stdout');
		expect(progress).toHaveBeenCalledWith(expect.stringContaining('[staging][github][sync] Complete:'), 'stdout');
	});

	it('finalizes GitHub sync for every non-local scope', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);

		const result = await finalizeTreeseedConfig({
			tenantRoot,
			scopes: ['staging', 'prod'],
			sync: 'github',
			checkConnections: false,
			initializePersistent: false,
		});

		expect(result.synced.github).toMatchObject({
			repository: 'owner/repo',
			scopes: [
				expect.objectContaining({ scope: 'staging', environment: 'staging' }),
				expect.objectContaining({ scope: 'prod', environment: 'production' }),
			],
		});
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'staging', expect.objectContaining({
			branchName: 'staging',
		}));
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'production', expect.objectContaining({
			branchName: 'main',
			tagName: '*.*.*',
		}));
		if (hasConfigEntry(tenantRoot, 'RAILWAY_API_TOKEN')) {
			expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalledWith(
				'owner/repo',
				'production',
				'RAILWAY_API_TOKEN',
				'railway-token-value',
				expect.any(Object),
			);
		}
	});

	it('syncs GitHub environments for package-owned hosted app repositories', async () => {
		const tenantRoot = createTenantFixture();
		addPackageApiApplication(tenantRoot);
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);
		setConfigValue(tenantRoot, 'staging', 'TREESEED_RAILWAY_PROJECT_ID', 'railway-project-id', 'plain', 'scoped');

		const result = await finalizeTreeseedConfig({
			tenantRoot,
			scopes: ['staging'],
			sync: 'github',
			checkConnections: false,
			initializePersistent: false,
		});

		expect(result.synced.github).toMatchObject({
			repositories: ['owner/repo', 'treeseed-ai/api'],
			scopes: [
				expect.objectContaining({ repository: 'owner/repo', scope: 'staging', environment: 'staging' }),
				expect.objectContaining({ repository: 'treeseed-ai/api', scope: 'staging', environment: 'staging' }),
			],
		});
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'staging', expect.objectContaining({
			branchName: 'staging',
		}));
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('treeseed-ai/api', 'staging', expect.objectContaining({
			branchName: 'staging',
		}));
		if (hasConfigEntry(tenantRoot, 'RAILWAY_API_TOKEN')) {
			expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalledWith(
				'treeseed-ai/api',
				'staging',
				'RAILWAY_API_TOKEN',
				'railway-token-value',
				expect.any(Object),
			);
		}
		if (hasConfigEntry(tenantRoot, 'TREESEED_RAILWAY_WORKSPACE')) {
			expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
				'treeseed-ai/api',
				'staging',
				'TREESEED_RAILWAY_WORKSPACE',
				'acme-workspace',
				expect.any(Object),
			);
		}
		if (hasConfigEntry(tenantRoot, 'TREESEED_RAILWAY_PROJECT_ID')) {
			expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
				'treeseed-ai/api',
				'staging',
				'TREESEED_RAILWAY_PROJECT_ID',
				'railway-project-id',
				expect.any(Object),
			);
		}
	});

	it('runs hosted GitHub environment sync scopes concurrently in parallel bootstrap mode', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);
		let active = 0;
		let maxActive = 0;
		ensureGitHubActionsEnvironmentMock.mockImplementation(async () => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => setTimeout(resolve, 10));
			active -= 1;
		});

		await finalizeTreeseedConfig({
			tenantRoot,
			scopes: ['staging', 'prod'],
			sync: 'github',
			checkConnections: false,
			initializePersistent: false,
			bootstrapExecution: 'parallel',
		});

		expect(maxActive).toBe(2);
	});

	it('does not require Cloudflare readiness for GitHub-only bootstrap', async () => {
		const tenantRoot = createTenantFixtureWithPlaceholderCloudflareAccount();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		setConfigValue(tenantRoot, 'staging', 'CODEX_API_KEY', 'codex-test-key-1234567890', 'secret', 'scoped');
		setConfigValue(tenantRoot, 'staging', 'GH_TOKEN', 'github-token-value', 'secret');

		const result = await finalizeTreeseedConfig({
			tenantRoot,
			scopes: ['staging'],
			sync: 'github',
			checkConnections: false,
			initializePersistent: true,
			systems: ['github'],
		});

		expect(result.reconciled).toEqual([]);
		expect(result.bootstrapSystemsByScope.staging.runnable).toEqual(['github']);
		expect(result.readinessByScope.staging.checks.reconcile).toBe('deferred');
		expect(result.validationByScope.staging.ok).toBe(true);
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'staging', expect.objectContaining({
			branchName: 'staging',
		}));
	});
});
