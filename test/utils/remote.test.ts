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
import { AgentSdk } from '../../src/sdk.ts';
import { findDispatchCapability } from '../../src/dispatch.ts';
import {
	resolveTreeseedRemoteConfig,
	setTreeseedRemoteSession,
} from '../../src/operations/services/config-runtime.ts';
import { loadDeployState } from '../../src/operations/services/deploy.ts';
import { loadCliDeployConfig } from '../../src/operations/services/runtime-tools.ts';
import { MemoryAgentDatabase } from '../../src/d1-store.ts';
import { sdkFixtureRoot } from '../test-fixture.ts';

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
  queueName: agent-work
  dlqName: agent-work-dlq
services:
  worker:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-worker
      rootDir: .
  api:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-core
      serviceName: treeseed-api
      rootDir: .
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
      rootDir: .
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

	it('tracks managed API and agent service state in deploy state', () => {
		const tenantRoot = createTenantFixture();
		const deployConfig = loadCliDeployConfig(tenantRoot);
		const state = loadDeployState(tenantRoot, deployConfig, { scope: 'staging' });

		expect(deployConfig.cloudflare.queueName).toBe('agent-work');
		expect(state.services.api.enabled).toBe(true);
		expect(state.services.api.serviceName).toBe('treeseed-api');
		expect(state.services.api.publicBaseUrl).toBe('https://staging-api.example.com');
		expect(state.services.agents.publicBaseUrl).toBe('https://staging-agents.example.com');
		expect(state.services.worker.serviceName).toBe('treeseed-worker');
		expect(state.queues.agentWork.name).toBe('agent-work');
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
