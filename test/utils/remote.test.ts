import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	RemoteTreeseedAuthClient,
	RemoteTreeseedClient,
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from '../../src/remote.ts';
import {
	MarketClient,
	addMarketProfile,
	listIntegratedMarketCatalog,
	loadMarketRegistryState,
	resolveDefaultCentralMarketBaseUrl,
	resolveMarketProfile,
} from '../../src/market-client.ts';
import { AgentSdk } from '../../src/sdk.ts';
import { findDispatchCapability } from '../../src/dispatch.ts';
import {
	resolveTreeseedRemoteConfig,
	setTreeseedRemoteSession,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
} from '../../src/operations/services/config-runtime.ts';
import {
	buildSecretMap,
	buildWranglerConfigContents,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
	resolveConfiguredSurfaceBaseUrl,
} from '../../src/operations/services/deploy.ts';
import { loadCliDeployConfig } from '../../src/operations/services/runtime-tools.ts';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { sdkFixtureRoot } from '../test-fixture.ts';

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-remote-test-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  notes: ./src/content/notes\n  questions: ./src/content/questions\n  objectives: ./src/content/objectives\n  proposals: ./src/content/proposals\n  decisions: ./src/content/decisions\n  people: ./src/content/people\n  agents: ./src/content/agents\n  books: ./src/content/books\n  docs: ./src/content/knowledge\nfeatures:\n  docs: true\n  proposals: true\n  decisions: true\n');
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

	it('sends the remote contract header and bearer auth', async () => {
		const calls: Array<{ url: string; headers: Record<string, string> }> = [];
		const client = new RemoteTreeseedClient({
			hosts: [{ id: 'official', baseUrl: 'https://api.example.com' }],
			activeHostId: 'official',
			auth: { accessToken: 'token-123' },
		}, {
			fetchImpl: async (input, init) => {
				calls.push({
					url: String(input),
					headers: Object.fromEntries(new Headers(init?.headers).entries()),
				});
				return new Response(JSON.stringify({ ok: true, payload: { id: 'user-1', scopes: ['sdk'], roles: ['member'], permissions: ['sdk:execute:global'] } }), {
					status: 200,
					headers: {
						'content-type': 'application/json',
						[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
					},
				});
			},
		});

		const authClient = new RemoteTreeseedAuthClient(client);
		const response = await authClient.whoAmI();

		expect(response.payload.id).toBe('user-1');
		expect(calls[0]?.url).toBe('https://api.example.com/auth/me');
		expect(calls[0]?.headers.authorization).toBe('Bearer token-123');
		expect(calls[0]?.headers[TREESEED_REMOTE_CONTRACT_HEADER]).toBe(String(TREESEED_REMOTE_CONTRACT_VERSION));
	});

	it('persists encrypted remote auth state and resolves configured hosts', () => {
		const tenantRoot = createTenantFixture();
		vi.stubEnv(TREESEED_MACHINE_KEY_PASSPHRASE_ENV, 'test-passphrase');
		unlockTreeseedSecretSessionFromEnv(tenantRoot);
		setTreeseedRemoteSession(tenantRoot, {
			hostId: 'official',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: '2030-01-01T00:00:00.000Z',
			principal: {
				id: 'user-1',
				scopes: ['sdk'],
				roles: ['member'],
				permissions: ['sdk:execute:global'],
			},
		});

		const config = resolveTreeseedRemoteConfig(tenantRoot, {});
		expect(config.activeHostId).toBe('official');
		expect(config.auth?.accessToken).toBe('access-token');
		expect(config.hosts[0]?.baseUrl).toBe('https://api.example.com');

		const authPath = resolve(tenantRoot, '.treeseed', 'config', 'remote-auth.json');
		expect(readFileSync(authPath, 'utf8')).not.toContain('access-token');
	});

	it('stores market profiles and calls market-owned v1 endpoints as a client', async () => {
		const calls: Array<{ url: string; headers: Record<string, string> }> = [];
		expect(resolveDefaultCentralMarketBaseUrl({})).toBe('https://api.treeseed.ai');
		expect(resolveDefaultCentralMarketBaseUrl({ TREESEED_API_BASE_URL: 'http://127.0.0.1:3000' }))
			.toBe('https://api.treeseed.ai');
		expect(resolveDefaultCentralMarketBaseUrl({ TREESEED_CENTRAL_MARKET_API_BASE_URL: 'https://central.example.com/' }))
			.toBe('https://central.example.com');
		addMarketProfile({
			id: 'enterprise',
			label: 'Enterprise',
			baseUrl: 'https://enterprise.example.com/',
			kind: 'specialized',
			teamId: 'team-1',
		});
		const state = loadMarketRegistryState();
		expect(state.profiles.map((profile) => profile.id)).toContain('central');
		expect(resolveMarketProfile('enterprise').baseUrl).toBe('https://enterprise.example.com');
		expect(resolveMarketProfile('local')).toMatchObject({
			id: 'local',
			baseUrl: 'http://127.0.0.1:3000',
			kind: 'specialized',
		});

		const client = new MarketClient({
			profile: resolveMarketProfile('enterprise'),
			accessToken: 'market-token',
			fetchImpl: async (input, init) => {
				calls.push({
					url: String(input),
					headers: Object.fromEntries(new Headers(init?.headers).entries()),
				});
				return new Response(JSON.stringify({
					ok: true,
					payload: {
						principal: { id: 'user-1', scopes: ['market'], roles: ['member'], permissions: [] },
						teams: [],
					},
				}), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			},
		});
		const response = await client.me();

		expect(response.payload.principal.id).toBe('user-1');
		expect(calls[0]?.url).toBe('https://enterprise.example.com/v1/me');
		expect(calls[0]?.headers.authorization).toBe('Bearer market-token');
			expect(calls[0]?.headers[TREESEED_REMOTE_CONTRACT_HEADER]).toBe(String(TREESEED_REMOTE_CONTRACT_VERSION));
		});

		it('builds an integrated catalog across configured markets and labels item sources', async () => {
			addMarketProfile({
				id: 'enterprise',
				label: 'Enterprise',
				baseUrl: 'https://enterprise.example.com',
				kind: 'specialized',
				teamId: 'team-1',
			});
			const calls: string[] = [];
			const response = await listIntegratedMarketCatalog({
				kind: 'template',
				fetchImpl: async (input) => {
					const url = String(input);
					calls.push(url);
					const isEnterprise = url.startsWith('https://enterprise.example.com');
					return new Response(JSON.stringify({
						ok: true,
						payload: [{
							id: isEnterprise ? 'enterprise-template' : 'central-template',
							title: isEnterprise ? 'Enterprise Template' : 'Central Template',
						}],
					}), {
						status: 200,
						headers: { 'content-type': 'application/json' },
					});
				},
			});

			expect(calls).toContain('https://api.treeseed.ai/v1/catalog?kind=template');
			expect(calls).toContain('https://enterprise.example.com/v1/catalog?kind=template');
			expect(response.errors).toEqual([]);
			expect(response.payload.map((item) => [item.id, item.sourceMarket.id])).toEqual([
				['central-template', 'central'],
				['enterprise-template', 'enterprise'],
			]);
		});

	it('tracks the managed API service state in deploy state', () => {
		const tenantRoot = createTenantFixture();
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const state = loadDeployState(tenantRoot, deployConfig, { scope: 'staging' });

			expect(state.identity.deploymentKey).toBe('acme-docs');
		expect(deployConfig.cloudflare.r2?.manifestKeyTemplate).toBe('teams/{teamId}/published/common.json');
		expect(state.services.api.enabled).toBe(true);
		expect(state.services.api.serviceName).toBe('acme-docs-api');
		expect(state.services.api.publicBaseUrl).toBe(resolveConfiguredSurfaceBaseUrl(deployConfig, { kind: 'persistent', scope: 'staging' }, 'api'));
		expect(state.services.workdayManager).toBeUndefined();
		expect(state.services.workerRunner).toBeUndefined();
			expect(state.queues).toEqual({});
		expect(state.content.manifestKey).toBe('teams/acme/published/common.json');
		expect(state.content.previewRootTemplate).toBe('teams/{teamId}/previews');
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
		const source = readFileSync(new URL('../../src/operations/services/project-platform.ts', import.meta.url), 'utf8');
		expect(source).toContain("syncCloudflareSecrets(tenantRoot, { target, dryRun })");
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

	it('resolves remote inline dispatch through the market v1 contract', async () => {
		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			expect(String(input)).toBe('https://market.example.com/v1/projects/project-1/dispatch');
			const headers = Object.fromEntries(new Headers(init?.headers).entries());
			expect(headers.authorization).toBe('Bearer dispatch-token');
			expect(JSON.parse(String(init?.body))).toMatchObject({
				namespace: 'sdk',
				operation: 'read',
				preferredMode: 'prefer_remote',
			});
			return new Response(JSON.stringify({
				ok: true,
				mode: 'inline',
				namespace: 'sdk',
				operation: 'read',
				target: 'project_api',
				capability: findDispatchCapability('sdk', 'read'),
				payload: {
					ok: true,
					model: 'knowledge',
					operation: 'read',
					payload: { slug: 'remote-knowledge' },
				},
			}), {
				status: 200,
				headers: {
					'content-type': 'application/json',
					[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
				},
			});
		});
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
			dispatch: {
				projectId: 'project-1',
				marketBaseUrl: 'https://market.example.com',
				policy: 'prefer_remote',
				credentialSource: {
					type: 'bearer',
					token: 'dispatch-token',
				},
				fetchImpl: fetchMock,
			},
		});

		const result = await sdk.dispatch({
			operation: 'read',
			input: {
				model: 'knowledge',
				slug: 'research/inquiry/questions-as-records',
			},
		});

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			ok: true,
			mode: 'inline',
			target: 'project_api',
		});
	});

	it('returns queued remote jobs for long-running dispatch operations', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			ok: true,
			mode: 'job',
			namespace: 'sdk',
			operation: 'refreshGraph',
			target: 'project_runner',
			capability: findDispatchCapability('sdk', 'refreshGraph'),
			job: {
				id: 'job-1',
				projectId: 'project-1',
				namespace: 'sdk',
				operation: 'refreshGraph',
				status: 'pending',
				preferredMode: 'prefer_remote',
				selectedTarget: 'project_runner',
				input: {},
				output: null,
				error: null,
				requestedByType: 'user',
				requestedById: 'user-1',
				assignedRunnerId: null,
				idempotencyKey: null,
				capability: findDispatchCapability('sdk', 'refreshGraph'),
				createdAt: '2026-04-15T00:00:00.000Z',
				updatedAt: '2026-04-15T00:00:00.000Z',
				startedAt: null,
				finishedAt: null,
				cancelledAt: null,
			},
		}), {
			status: 200,
			headers: {
				'content-type': 'application/json',
				[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
			},
		}));
		const sdk = new AgentSdk({
			repoRoot: sdkFixtureRoot,
			database: new MemoryAgentDatabase(),
			dispatch: {
				projectId: 'project-1',
				marketBaseUrl: 'https://market.example.com',
				policy: 'prefer_remote',
				fetchImpl: fetchMock,
			},
		});

		const result = await sdk.dispatch({
			operation: 'refreshGraph',
			input: {},
		});

		expect(result).toMatchObject({
			ok: true,
			mode: 'job',
			target: 'project_runner',
			job: {
				id: 'job-1',
				status: 'pending',
			},
		});
	});
});
