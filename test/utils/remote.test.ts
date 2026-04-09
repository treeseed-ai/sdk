import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	RemoteTreeseedAuthClient,
	RemoteTreeseedClient,
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
} from '../../src/remote.ts';
import {
	resolveTreeseedRemoteConfig,
	setTreeseedRemoteSession,
} from '../../src/treeseed/scripts/config-runtime-lib.ts';
import { loadDeployState } from '../../src/treeseed/scripts/deploy-lib.ts';
import { loadCliDeployConfig } from '../../src/treeseed/scripts/package-tools.ts';

function createTenantFixture() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-remote-test-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  notes: ./src/content/notes\n  questions: ./src/content/questions\n  objectives: ./src/content/objectives\n  people: ./src/content/people\n  agents: ./src/content/agents\n  books: ./src/content/books\n  docs: ./src/content/knowledge\nfeatures:\n  docs: true\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: Test
slug: test
siteUrl: https://example.com
contactEmail: test@example.com
cloudflare:
  accountId: account-123
  gatewayWorkerName: treeseed-agent-gateway
  queueName: agent-work
  dlqName: agent-work-dlq
services:
  gateway:
    enabled: true
    provider: cloudflare
    cloudflare:
      workerName: treeseed-agent-gateway
  manager:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-manager
      rootDir: packages/agent
  worker:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-worker
      rootDir: packages/agent
  api:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-api
      rootDir: packages/api
    environments:
      staging:
        baseUrl: https://staging-api.example.com
        railwayEnvironment: staging
      prod:
        baseUrl: https://api.example.com
        railwayEnvironment: production
  agents:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-agents
      rootDir: packages/agent
    environments:
      staging:
        baseUrl: https://staging-agents.example.com
      prod:
        baseUrl: https://agents.example.com
providers:
  forms: store_only
  agents:
    execution: stub
    mutation: local_branch
    repository: stub
    verification: stub
    notification: stub
    research: stub
  deploy: cloudflare
  content:
    docs: default
  site: default
`, 'utf8');
	return tenantRoot;
}

describe('remote Treeseed support', () => {
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
				return new Response(JSON.stringify({ ok: true, payload: { id: 'user-1', scopes: ['sdk'] } }), {
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
		setTreeseedRemoteSession(tenantRoot, {
			hostId: 'official',
			accessToken: 'access-token',
			refreshToken: 'refresh-token',
			expiresAt: '2030-01-01T00:00:00.000Z',
			principal: {
				id: 'user-1',
				scopes: ['sdk'],
			},
		});

		const config = resolveTreeseedRemoteConfig(tenantRoot, {});
		expect(config.activeHostId).toBe('official');
		expect(config.auth?.accessToken).toBe('access-token');
		expect(config.hosts[0]?.baseUrl).toBe('https://api.example.com');

		const authPath = resolve(tenantRoot, '.treeseed', 'config', 'remote-auth.json');
		expect(readFileSync(authPath, 'utf8')).not.toContain('access-token');
	});

	it('tracks managed API and agent service state in deploy state', () => {
		const tenantRoot = createTenantFixture();
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const state = loadDeployState(tenantRoot, deployConfig, { scope: 'staging' });

		expect(deployConfig.cloudflare.queueName).toBe('agent-work');
		expect(state.services.api.enabled).toBe(true);
		expect(state.services.api.serviceName).toBe('treeseed-api');
		expect(state.services.api.publicBaseUrl).toBe('https://staging-api.example.com');
		expect(state.services.agents.publicBaseUrl).toBe('https://staging-agents.example.com');
		expect(state.services.gateway.workerName).toBe('treeseed-agent-gateway');
		expect(state.services.manager.serviceName).toBe('treeseed-manager');
		expect(state.services.worker.serviceName).toBe('treeseed-worker');
		expect(state.queues.agentWork.name).toBe('agent-work');
	});
});
