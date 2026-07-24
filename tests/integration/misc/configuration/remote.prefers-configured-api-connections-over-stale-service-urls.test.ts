import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readSourceModule } from '../../../support/workspace-test-root.ts';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	RemoteAuthClient,
	RemoteClient,
	REMOTE_CONTRACT_HEADER,
	REMOTE_CONTRACT_VERSION,
} from '../../../../src/entrypoints/clients/remote.ts';

import {
	MarketClient,
	addMarketProfile,
	listIntegratedMarketCatalog,
	loadMarketRegistryState,
	resolveDefaultCentralMarketBaseUrl,
	resolveMarketProfile,
} from '../../../../src/entrypoints/clients/market-client.ts';

import { AgentSdk } from '../../../../src/entrypoints/models/sdk.ts';

import { findDispatchCapability } from '../../../../src/entrypoints/dispatch/dispatch.ts';

import {
	resolveRemoteConfig,
	setRemoteSession,
	MACHINE_KEY_PASSPHRASE_ENV,
	unlockSecretSessionFromEnv,
} from '../../../../src/operations/services/configuration/config-runtime.ts';

import {
	buildSecretMap,
	buildWranglerConfigContents,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
	resolveConfiguredSurfaceBaseUrl,
} from '../../../../src/operations/services/hosting/deployment/deploy.ts';

import { loadCliDeployConfig } from '../../../../src/operations/services/agents/runtime-tools.ts';

import { MemoryAgentDatabase } from '../../../../src/persistence/d1-store.ts';

import { sdkFixtureRoot } from '../../../support/test-fixture.ts';

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-remote-test-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	mkdirSync(resolve(tenantRoot, '.treeseed', 'config'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  notes: ./src/content/notes\n  questions: ./src/content/questions\n  objectives: ./src/content/objectives\n  proposals: ./src/content/proposals\n  decisions: ./src/content/decisions\n  people: ./src/content/people\n  agents: ./src/content/agents\n  books: ./src/content/books\n  docs: ./src/content/knowledge\nfeatures:\n  docs: true\n  proposals: true\n  decisions: true\n');
	writeFileSync(resolve(tenantRoot, '.treeseed', 'config', 'machine.yaml'), 'version: 1\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
hosting:
  kind: hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
  pages:
    productionBranch: main
    stagingBranch: staging
  r2:
    binding: TREESEED_CONTENT_BUCKET
    manifestKeyTemplate: teams/{teamId}/published/common.json
    previewRootTemplate: teams/{teamId}/previews
    previewTtlHours: 168
services:
  workdayManager:
    enabled: true
    provider: railway
    railway:
      projectName: acme-docs
      serviceName: acme-docs-workday-manager
      rootDir: .
      schedule:
        - "0 9 * * 1-5"
  workerRunner:
    enabled: true
    provider: railway
    railway:
      projectName: acme-docs
      rootDir: .
  api:
    enabled: true
    provider: railway
    railway:
      projectName: acme-docs
      serviceName: acme-docs-api
      rootDir: .
    environments:
      staging:
        baseUrl: https://staging-api.example.com
        railwayEnvironment: staging
      prod:
        baseUrl: https://api.example.com
        railwayEnvironment: production
providers:
  forms: store_only
  agents:
    execution: codex
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: cloudflare
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
`, 'utf8');
	return tenantRoot;
}
describe('remote Treeseed support', () => {
beforeEach(() => {
		vi.stubEnv('HOME', mkdtempSync(join(tmpdir(), 'treeseed-remote-home-')));
	});

afterEach(() => {
		vi.unstubAllEnvs();
	});

it('prefers configured API connections over stale service URLs', () => {
		const baseConfig = loadCliDeployConfig(createTenantFixture());
		const deployConfig = {
			...baseConfig,
			connections: {
				...(baseConfig.connections ?? {}),
				api: {
					...(baseConfig.connections?.api ?? {}),
					environments: {
						...(baseConfig.connections?.api?.environments ?? {}),
						staging: { baseUrl: 'https://connected-api.example.com' },
					},
				},
			},
			services: {
				...(baseConfig.services ?? {}),
				api: {
					...baseConfig.services?.api,
					environments: {
						...(baseConfig.services?.api?.environments ?? {}),
						staging: {
							...(baseConfig.services?.api?.environments?.staging ?? {}),
							baseUrl: 'https://stale-service-api.example.com',
						},
					},
				},
			},
		};

		expect(resolveConfiguredSurfaceBaseUrl(
			deployConfig,
			createPersistentDeployTarget('staging'),
			'api',
		)).toBe('https://connected-api.example.com');
	});

it('loads persistent deploy state from the primary checkout inside managed worktrees', () => {
		const tenantRoot = createTenantFixture();
		const worktreeRoot = mkdtempSync(join(tmpdir(), 'treeseed-managed-worktree-'));
		mkdirSync(resolve(worktreeRoot, '.treeseed'), { recursive: true });
		writeFileSync(resolve(worktreeRoot, 'treeseed.site.yaml'), readFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), 'utf8'), 'utf8');
		writeFileSync(resolve(worktreeRoot, '.treeseed', 'worktree.json'), JSON.stringify({
			schemaVersion: 1,
			kind: 'treeseed.workflow.worktree',
			branch: 'feature/demo',
			worktreePath: worktreeRoot,
			primaryRoot: tenantRoot,
		}, null, 2), 'utf8');
		mkdirSync(resolve(tenantRoot, '.treeseed', 'state', 'environments', 'staging'), { recursive: true });
		writeFileSync(resolve(tenantRoot, '.treeseed', 'state', 'environments', 'staging', 'deploy.json'), JSON.stringify({
			readiness: {
				initialized: true,
				configured: true,
				provisioned: true,
				deployable: true,
			},
			lastDeploymentTimestamp: '2026-05-02T00:00:00.000Z',
		}, null, 2), 'utf8');

		const deployConfig = loadCliDeployConfig(worktreeRoot);
		const state = loadDeployState(worktreeRoot, deployConfig, { scope: 'staging' });

		expect(state.readiness.initialized).toBe(true);
		expect(state.readiness.deployable).toBe(true);
		expect(state.lastDeploymentTimestamp).toBe('2026-05-02T00:00:00.000Z');
	});

it('points preview, staging, and prod deployments at the team production manifest', () => {
		const tenantRoot = createTenantFixture();
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const prodState = loadDeployState(tenantRoot, deployConfig, { scope: 'prod' });
		const stagingState = loadDeployState(tenantRoot, deployConfig, { scope: 'staging' });
		const previewTarget = createBranchPreviewDeployTarget('feature/r2-runtime');
		const previewState = loadDeployState(tenantRoot, deployConfig, { target: previewTarget });

		expect(prodState.content.manifestKey).toBe('teams/acme/published/common.json');
		expect(stagingState.content.manifestKey).toBe('teams/acme/published/common.json');
		expect(previewState.content.manifestKey).toBe('teams/acme/published/common.json');

		expect(prodState.pages.projectName).toBe('acme-docs');
		expect(stagingState.pages.projectName).toBe('acme-docs');
		expect(previewState.pages.projectName).toBe('acme-docs');
		expect(prodState.d1Databases.SITE_DATA_DB.databaseName).toBe('acme-docs-site-data-prod');
		expect(stagingState.d1Databases.SITE_DATA_DB.databaseName).toBe('acme-docs-site-data-staging');
		expect(previewState.d1Databases.SITE_DATA_DB.databaseName).toBe('acme-docs-site-data-feature-r2-runtime');
			expect(prodState.queues).toEqual({});
			expect(stagingState.queues).toEqual({});
			expect(previewState.queues).toEqual({});

		const previewWrangler = buildWranglerConfigContents(tenantRoot, deployConfig, previewState, { target: previewTarget });
		expect(previewWrangler).toContain('TREESEED_CONTENT_MANIFEST_KEY = "teams/acme/published/common.json"');
		expect(previewWrangler).toContain('TREESEED_CONTENT_MANIFEST_KEY_TEMPLATE = "teams/{teamId}/published/common.json"');
		expect(previewWrangler).toContain('TREESEED_CONTENT_PREVIEW_ROOT_TEMPLATE = "teams/{teamId}/previews"');
		const stagingWrangler = buildWranglerConfigContents(tenantRoot, deployConfig, stagingState, { target: createPersistentDeployTarget('staging') });
		expect(stagingWrangler).toContain('TREESEED_CONTENT_SERVING_MODE = "published_runtime"');
		const localState = loadDeployState(tenantRoot, deployConfig, { target: createPersistentDeployTarget('local') });
		const localWrangler = buildWranglerConfigContents(tenantRoot, deployConfig, localState, { target: createPersistentDeployTarget('local') });
		expect(localWrangler).toContain('TREESEED_CONTENT_SERVING_MODE = "local_collections"');
		expect(previewWrangler).toContain('[[r2_buckets]]');
		expect(previewWrangler).toContain('binding = "TREESEED_CONTENT_BUCKET"');
	});

it('passes local auth runtime values into generated Wrangler config', () => {
		const tenantRoot = createTenantFixture();
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const target = createPersistentDeployTarget('local');
		const state = loadDeployState(tenantRoot, deployConfig, { target });

		const wrangler = buildWranglerConfigContents(tenantRoot, deployConfig, state, {
			target,
			env: {
				TREESEED_API_BOOTSTRAP_ADMIN_ALLOWLIST: 'admin@example.com,github:123',
				TREESEED_API_WEB_SERVICE_ID: 'web',
				TREESEED_API_WEB_SERVICE_SECRET: 'web-secret',
				TREESEED_PLATFORM_RUNNER_SECRET: 'runner-secret',
				TREESEED_AUTH_MODE: 'internal-first',
				TREESEED_AUTH_GITHUB_CLIENT_ID: 'github-client',
				TREESEED_AUTH_GITHUB_CLIENT_SECRET: 'github-secret',
			},
		});

		expect(wrangler).toContain('TREESEED_API_BOOTSTRAP_ADMIN_ALLOWLIST = "admin@example.com,github:123"');
		expect(wrangler).toContain('TREESEED_API_WEB_SERVICE_ID = "web"');
		expect(wrangler).toContain('TREESEED_API_WEB_SERVICE_SECRET = "web-secret"');
		expect(wrangler).toContain('TREESEED_PLATFORM_RUNNER_SECRET = "runner-secret"');
		expect(wrangler).toContain('TREESEED_AUTH_MODE = "internal-first"');
		expect(wrangler).toContain('TREESEED_AUTH_GITHUB_CLIENT_ID = "github-client"');
		expect(wrangler).toContain('TREESEED_AUTH_GITHUB_CLIENT_SECRET = "github-secret"');
	});

it('passes hosted SMTP runtime values into generated Wrangler config', () => {
		vi.stubEnv('TREESEED_SMTP_HOST', 'smtp.example.com');
		vi.stubEnv('TREESEED_SMTP_PORT', '587');
		vi.stubEnv('TREESEED_SMTP_USERNAME', 'smtp-user');
		vi.stubEnv('TREESEED_SMTP_PASSWORD', 'smtp-password');
		vi.stubEnv('TREESEED_SMTP_FROM', 'TreeSeed <auth@example.com>');
		vi.stubEnv('TREESEED_SMTP_REPLY_TO', 'support@example.com');
		vi.stubEnv('TREESEED_SMTP_SECURE', 'starttls');
		const tenantRoot = createTenantFixture();
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const target = createPersistentDeployTarget('prod');
		const state = loadDeployState(tenantRoot, deployConfig, { target });

		const wrangler = buildWranglerConfigContents(tenantRoot, deployConfig, state, { target });
		const secrets = buildSecretMap(deployConfig, state);

		expect(wrangler).toContain('TREESEED_SMTP_HOST = "smtp.example.com"');
		expect(wrangler).toContain('TREESEED_SMTP_PORT = "587"');
		expect(wrangler).toContain('TREESEED_SMTP_USERNAME = "smtp-user"');
		expect(wrangler).toContain('TREESEED_SMTP_FROM = "TreeSeed <auth@example.com>"');
		expect(wrangler).toContain('TREESEED_SMTP_REPLY_TO = "support@example.com"');
		expect(wrangler).toContain('TREESEED_SMTP_SECURE = "starttls"');
		expect(wrangler).not.toContain('smtp-password');
		expect(secrets.TREESEED_SMTP_PASSWORD).toBe('smtp-password');
	});

it('syncs Cloudflare Pages secrets during hosted web deploy preparation', () => {
		const source = readSourceModule(new URL('../../../../src/operations/services/projects/projects-core/project-platform.ts', import.meta.url));
		expect(source).toContain("syncCloudflareSecrets(tenantRoot, { target, planOnly })");
	});

it('keeps dispatch local-first when no remote config is supplied', async () => {
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
		});

		const result = await sdk.dispatch({
			operation: 'read',
			input: {
				model: 'knowledge',
				slug: 'research/inquiry/questions-as-records',
			},
		});

		expect(result.mode).toBe('inline');
		expect(result.target).toBe('local');
		expect((result.payload as { payload?: { slug?: string } }).payload?.slug).toBe('research/inquiry/questions-as-records');
	});
});
