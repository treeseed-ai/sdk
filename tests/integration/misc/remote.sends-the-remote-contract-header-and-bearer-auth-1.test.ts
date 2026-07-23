import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	RemoteTreeseedAuthClient,
	RemoteTreeseedClient,
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from '../../../src/remote.ts';

import {
	MarketClient,
	addMarketProfile,
	listIntegratedMarketCatalog,
	loadMarketRegistryState,
	resolveDefaultCentralMarketBaseUrl,
	resolveMarketProfile,
} from '../../../src/market-client.ts';

import { AgentSdk } from '../../../src/sdk.ts';

import { findDispatchCapability } from '../../../src/dispatch.ts';

import {
	resolveTreeseedRemoteConfig,
	setTreeseedRemoteSession,
	TREESEED_MACHINE_KEY_PASSPHRASE_ENV,
	unlockTreeseedSecretSessionFromEnv,
} from '../../../src/operations/services/config-runtime.ts';

import {
	buildSecretMap,
	buildWranglerConfigContents,
	createBranchPreviewDeployTarget,
	createPersistentDeployTarget,
	loadDeployState,
	resolveConfiguredSurfaceBaseUrl,
} from '../../../src/operations/services/deploy.ts';

import { loadCliDeployConfig } from '../../../src/operations/services/runtime-tools.ts';

import { MemoryAgentDatabase } from '../../../src/d1-store.ts';

import { sdkFixtureRoot } from '../../support/test-fixture.ts';

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
		expect(resolveDefaultCentralMarketBaseUrl({})).toBe('https://api.treeseed.dev');
		expect(resolveDefaultCentralMarketBaseUrl({ TREESEED_API_BASE_URL: 'http://127.0.0.1:3000' }))
			.toBe('https://api.treeseed.dev');
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

			expect(calls).toContain('https://api.treeseed.dev/v1/catalog?kind=template');
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
});
