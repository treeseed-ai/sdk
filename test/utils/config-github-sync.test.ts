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

vi.mock('../../src/operations/services/github-automation.ts', () => ({
	ensureGitHubBootstrapRepository: ensureGitHubBootstrapRepositoryMock,
	maybeResolveGitHubRepositorySlug: vi.fn(() => 'owner/repo'),
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
    previewProjectName: test-site-staging
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
    previewProjectName: test-site-staging
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
				pages: { projectName: 'test-site', previewProjectName: 'test-site-staging' },
				r2: { bucketName: 'test-site-content', binding: 'TREESEED_CONTENT_BUCKET' },
			},
			services: { api: { provider: 'railway', enabled: true } },
		} as any,
		tenantConfig: { id: 'test-site' } as any,
	}));
}

function setConfigValue(tenantRoot: string, scope: 'local' | 'staging' | 'prod', id: string, value: string, sensitivity: 'plain' | 'secret' = 'plain') {
	setTreeseedMachineEnvironmentValue(tenantRoot, scope, {
		id,
		sensitivity,
		storage: id === 'TREESEED_PROJECT_RUNNER_TOKEN' ? 'scoped' : 'shared',
	} as any, value);
}

function seedHostedValues(tenantRoot: string) {
	for (const scope of ['staging', 'prod'] as const) {
		setConfigValue(tenantRoot, scope, 'GH_TOKEN', 'github-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'CLOUDFLARE_API_TOKEN', 'cloudflare-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'RAILWAY_API_TOKEN', 'railway-token-value', 'secret');
		setConfigValue(tenantRoot, scope, 'TREESEED_RAILWAY_WORKSPACE', 'acme-workspace');
		setConfigValue(tenantRoot, scope, 'CLOUDFLARE_ACCOUNT_ID', 'account-123');
		setConfigValue(tenantRoot, scope, 'TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME', 'test-site');
		setConfigValue(tenantRoot, scope, 'TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME', 'test-site-staging');
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

describe('config GitHub environment sync', () => {
	beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-config-github-home-')));
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

		const result = await syncTreeseedGitHubEnvironment({ tenantRoot, scope: 'staging' });

		expect(result).toMatchObject({
			repository: 'owner/repo',
			scope: 'staging',
			environment: 'staging',
		});
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'staging', expect.any(Object));
		expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'RAILWAY_API_TOKEN',
			'railway-token-value',
			expect.any(Object),
		);
		expect(upsertGitHubEnvironmentVariableMock).toHaveBeenCalledWith(
			'owner/repo',
			'staging',
			'CLOUDFLARE_ACCOUNT_ID',
			'account-123',
			expect.any(Object),
		);
	});

	it('reports GitHub environment sync progress while syncing items', async () => {
		const tenantRoot = createTenantFixture();
		writeDefaultMachineConfig(tenantRoot);
		unlockSecrets(tenantRoot);
		seedHostedValues(tenantRoot);
		const progress = vi.fn();

		await syncTreeseedGitHubEnvironment({ tenantRoot, scope: 'staging', onProgress: progress, execution: 'sequential' });

		expect(progress).toHaveBeenCalledWith(expect.stringContaining('[staging][github][sync] Syncing GitHub environment staging: 0/'), 'stdout');
		expect(progress).toHaveBeenCalledWith(expect.stringContaining('[staging][github][secret] created RAILWAY_API_TOKEN'), 'stdout');
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
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'staging', expect.any(Object));
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'production', expect.any(Object));
		expect(upsertGitHubEnvironmentSecretMock).toHaveBeenCalledWith(
			'owner/repo',
			'production',
			'RAILWAY_API_TOKEN',
			'railway-token-value',
			expect.any(Object),
		);
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
		expect(ensureGitHubActionsEnvironmentMock).toHaveBeenCalledWith('owner/repo', 'staging', expect.any(Object));
	});
});
