import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import {
	CAPACITY_PROVIDER_ENDPOINTS,
	CAPACITY_PROVIDER_DEPLOYMENT_SERVICE_ROLES,
	CAPACITY_PROVIDER_ENV_KEYS,
	CAPACITY_PROVIDER_SCOPES,
	CapacityProviderApiError,
	MarketProviderClient,
	TREESEED_REMOTE_CONTRACT_HEADER,
	TREESEED_REMOTE_CONTRACT_VERSION,
	assertCapacityProviderRegistrationResponse,
	buildCapacityProviderAuthHeaders,
	deployCapacityProviderToManagedMarketHost,
	deployCapacityProviderToRailway,
	redactCapacityProviderEnv,
	renderCapacityProviderSelfHostInstructions,
	persistCapacityProviderConnectionToTreeseedConfig,
	resolveCapacityProviderEnvironment,
	resolveCapacityProviderLaunchEnvironment,
	type CapacityProviderDeploymentIntent,
	type CapacityProviderDeploymentResult,
	type CapacityProviderPortfolioManifest,
	type CapacityProviderRegistrationRequest,
	type CapacityProviderRegistrationResponse,
	type ProviderReportRequest,
	type ProviderTaskClaimRequest,
	type ProviderTaskCompleteRequest,
	type ProviderTaskEventRequest,
	type ProviderTaskFailRequest,
	type ProviderUsageReport,
	type ProviderWorkdayRequest,
} from '../../src/index.ts';
import {
	createDefaultTreeseedMachineConfig,
	unlockTreeseedSecretSessionWithPassphrase,
	writeTreeseedMachineConfig,
} from '../../src/workflow-support.ts';

const apiKey = 'tsp_test_plaintext_secret_123456789';

function jsonResponse(payload: unknown, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: {
			'content-type': 'application/json',
			[TREESEED_REMOTE_CONTRACT_HEADER]: String(TREESEED_REMOTE_CONTRACT_VERSION),
		},
	});
}

describe('capacity provider SDK contracts', () => {
	it('serializes provider registration, heartbeat, portfolio, task, usage, report, and deployment shapes', () => {
		const registration: CapacityProviderRegistrationRequest = {
			marketId: 'prod',
			runtime: {
				package: '@treeseed/agent',
				version: '0.9.0',
				entrypoint: 'packages/agent/dist/provider/entrypoint.js',
				roles: ['api', 'manager', 'runner'],
			},
			capabilities: [{
				id: 'codex-docs-work',
				agents: ['treeseed-docs-planner', 'treeseed-docs-engineer', 'treeseed-docs-reviewer'],
				operations: ['plan', 'research', 'mutate', 'verify', 'report'],
				models: ['codex'],
				repositoryAccess: 'git_worktree',
				verification: ['local_command'],
			}],
			budgets: {
				dailyCreditBudget: 1000,
				monthlyCreditBudget: 10000,
				maxConcurrentWorkdays: 1,
				maxConcurrentRunners: 4,
			},
			health: {
				dataDirWritable: true,
				codexReady: true,
			},
		};
		const registrationResponse: CapacityProviderRegistrationResponse = {
			ok: true,
			provider: {
				id: 'cp_123',
				teamId: 'team_123',
				name: 'Canonical name from Market UI',
				status: 'online',
			},
			portfolioManifestUrl: '/v1/provider/portfolio',
			heartbeatIntervalSeconds: 30,
		};
		const portfolio: CapacityProviderPortfolioManifest = {
			team: {
				id: 'team_123',
				slug: 'treeseed',
				name: 'TreeSeed',
			},
			projects: [{
				id: 'proj_123',
				slug: 'market',
				name: 'TreeSeed Market',
				repository: {
					provider: 'github',
					role: 'primary',
					owner: 'treeseed-ai',
					name: 'market',
					defaultBranch: 'staging',
					cloneUrl: 'git@github.com:treeseed-ai/market.git',
					checkoutPath: '.',
				},
				agentSpecs: {
					root: 'src/content/agents',
					testsRoot: 'src/content/agent-tests',
				},
				workPolicy: {
					enabled: true,
					startCron: '0 9 * * 1-5',
					durationMinutes: 480,
					dailyCreditBudget: 1000,
					maxRunners: 1,
					maxWorkersPerRunner: 4,
				},
			}],
		};
		const workday: ProviderWorkdayRequest = {
			projectId: 'proj_123',
			environment: 'local',
			idempotencyKey: 'workday:proj_123:local:today',
		};
		const claim: ProviderTaskClaimRequest = {
			runnerId: 'runner-1',
			limit: 1,
			capabilities: ['codex-docs-work'],
		};
		const event: ProviderTaskEventRequest = {
			kind: 'runner.progress',
			data: { message: 'started' },
		};
		const usage: ProviderUsageReport = {
			taskId: 'task-1',
			workDayId: 'wd-1',
			projectId: 'proj_123',
			taskSignature: 'docs.update',
			executionProfileId: 'codex',
			actualCredits: 12,
		};
		const complete: ProviderTaskCompleteRequest = {
			output: { ok: true },
			usage,
		};
		const fail: ProviderTaskFailRequest = {
			errorMessage: 'verification failed',
			retryable: true,
		};
		const report: ProviderReportRequest = {
			workDayId: 'wd-1',
			kind: 'dry-run',
			body: { summary: 'ready' },
		};
		const deployment: CapacityProviderDeploymentIntent = {
			teamId: 'team_123',
			capacityProviderId: 'cp_123',
			launchMode: 'self_hosted',
			hostKind: 'local',
		};
		const deploymentResult: CapacityProviderDeploymentResult = {
			id: 'deploy_123',
			teamId: 'team_123',
			capacityProviderId: 'cp_123',
			launchMode: 'self_hosted',
			hostKind: 'local',
			status: 'not_deployed',
			serviceRefs: {},
			envRefs: {},
			result: {},
		};

		expect(registration.runtime.entrypoint).toBe('packages/agent/dist/provider/entrypoint.js');
		expect(registrationResponse.provider.status).toBe('online');
		expect(portfolio.projects[0]?.agentSpecs.testsRoot).toBe('src/content/agent-tests');
		expect(workday.environment).toBe('local');
		expect(claim.capabilities).toEqual(['codex-docs-work']);
		expect(event.kind).toBe('runner.progress');
		expect(complete.usage?.actualCredits).toBe(12);
		expect(fail.retryable).toBe(true);
		expect(report.body.summary).toBe('ready');
		expect(deployment.launchMode).toBe('self_hosted');
		expect(deploymentResult.status).toBe('not_deployed');
		expect(CAPACITY_PROVIDER_SCOPES).toContain('provider:portfolio:read');
	});

	it('calls provider-authenticated Market endpoints with bearer auth and contract headers', async () => {
		const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
		const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
			const url = String(input);
			const body = init?.body ? JSON.parse(String(init.body)) : null;
			calls.push({
				url,
				method: String(init?.method ?? 'GET'),
				headers: Object.fromEntries(new Headers(init?.headers).entries()),
				body,
			});
			const path = new URL(url).pathname;
			if (path === CAPACITY_PROVIDER_ENDPOINTS.register) {
				return jsonResponse({
					ok: true,
					provider: { id: 'cp_123', teamId: 'team_123', name: 'Local provider', status: 'online' },
					portfolioManifestUrl: '/v1/provider/portfolio',
					heartbeatIntervalSeconds: 30,
				});
			}
			if (path === CAPACITY_PROVIDER_ENDPOINTS.heartbeat) return jsonResponse({ ok: true, heartbeatIntervalSeconds: 30 });
			if (path === CAPACITY_PROVIDER_ENDPOINTS.portfolio) {
				return jsonResponse({
					team: { id: 'team_123', slug: 'treeseed', name: 'TreeSeed' },
					projects: [{
						id: 'proj_123',
						slug: 'market',
						name: 'TreeSeed Market',
						repository: { provider: 'github', role: 'primary', owner: 'treeseed-ai', name: 'market', defaultBranch: 'staging', cloneUrl: 'git@github.com:treeseed-ai/market.git', checkoutPath: '.' },
						agentSpecs: { root: 'src/content/agents', testsRoot: 'src/content/agent-tests' },
						workPolicy: { enabled: true },
					}],
				});
			}
			if (path === CAPACITY_PROVIDER_ENDPOINTS.workdays) return jsonResponse({ ok: true, workDay: { id: 'wd-1' } });
			if (path === CAPACITY_PROVIDER_ENDPOINTS.claimTask) return jsonResponse({ ok: true, tasks: [{ id: 'task-1' }] });
			if (path.endsWith('/events')) return jsonResponse({ ok: true, event: { id: 'event-1' } });
			if (path.endsWith('/complete')) return jsonResponse({ ok: true, task: { id: 'task-1', state: 'completed' } });
			if (path.endsWith('/fail')) return jsonResponse({ ok: true, task: { id: 'task-2', state: 'failed' } });
			if (path === CAPACITY_PROVIDER_ENDPOINTS.usage) return jsonResponse({ ok: true, usage: { id: 'usage-1' } });
			if (path === CAPACITY_PROVIDER_ENDPOINTS.reports) return jsonResponse({ ok: true, report: { id: 'report-1' } });
			return jsonResponse({ error: 'not found' }, 404);
		});
		const client = new MarketProviderClient({
			marketUrl: 'https://market.example.com/',
			marketId: 'prod',
			apiKey,
			fetchImpl: fetchMock as typeof fetch,
			userAgent: 'treeseed-test',
		});

		await client.register({
			runtime: { package: '@treeseed/agent', version: '0.9.0', entrypoint: 'packages/agent/dist/provider/entrypoint.js', roles: ['api'] },
			capabilities: [],
			budgets: {},
			health: {},
		});
		await client.heartbeat();
		await client.portfolio();
		await client.createWorkday({ projectId: 'proj_123', environment: 'local' });
		await client.claimTask({ limit: 1 });
		await client.appendTaskEvent('task-1', { kind: 'runner.progress' });
		await client.completeTask('task-1', { output: { ok: true } });
		await client.failTask('task-2', { errorMessage: 'failed' });
		await client.reportUsage({ taskId: 'task-1', actualCredits: 1 });
		await client.writeReport({ workDayId: 'wd-1', kind: 'summary', body: {} });

		expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual([
			'POST /v1/provider/register',
			'POST /v1/provider/heartbeat',
			'GET /v1/provider/portfolio',
			'POST /v1/provider/workdays',
			'POST /v1/provider/tasks/claim',
			'POST /v1/provider/tasks/task-1/events',
			'POST /v1/provider/tasks/task-1/complete',
			'POST /v1/provider/tasks/task-2/fail',
			'POST /v1/provider/usage',
			'POST /v1/provider/reports',
		]);
		for (const call of calls) {
			expect(call.headers.authorization).toBe(`Bearer ${apiKey}`);
			expect(call.headers[TREESEED_REMOTE_CONTRACT_HEADER]).toBe(String(TREESEED_REMOTE_CONTRACT_VERSION));
			expect(call.headers.accept).toBe('application/json');
		}
		expect(calls[0]?.body).toMatchObject({ marketId: 'prod' });
	});

	it('rejects malformed responses and converts non-ok responses into API errors', async () => {
		expect(() => assertCapacityProviderRegistrationResponse({ ok: true })).toThrow(/missing provider/u);
		const malformedClient = new MarketProviderClient({
			marketUrl: 'https://market.example.com',
			marketId: 'prod',
			apiKey,
			fetchImpl: (async () => jsonResponse({ ok: true })) as typeof fetch,
		});
		await expect(malformedClient.register({
			runtime: { package: '@treeseed/agent', version: '0.9.0', entrypoint: 'entrypoint.js', roles: ['api'] },
			capabilities: [],
			budgets: {},
			health: {},
		})).rejects.toThrow(/missing provider/u);

		const failingClient = new MarketProviderClient({
			marketUrl: 'https://market.example.com',
			marketId: 'prod',
			apiKey,
			fetchImpl: (async () => jsonResponse({ error: 'auth failed' }, 401)) as typeof fetch,
		});
		await expect(failingClient.heartbeat()).rejects.toBeInstanceOf(CapacityProviderApiError);
		await expect(failingClient.heartbeat()).rejects.toThrow('auth failed');
	});

	it('builds auth headers and renders self-host environment without exposing secrets in display output', () => {
		expect(buildCapacityProviderAuthHeaders(apiKey)).toEqual({ authorization: `Bearer ${apiKey}` });

		const env = resolveCapacityProviderEnvironment({
			marketUrl: 'https://api.treeseed.ai/',
			marketId: 'prod',
			apiKey,
			providerHostDataDir: '.treeseed/local-capacity-provider/data',
			codexAuthJsonB64: 'codex-auth-secret',
			maxConcurrentRunners: 4,
		});
		expect(env).toMatchObject({
			TREESEED_MARKET_URL: 'https://api.treeseed.ai',
			TREESEED_MANAGER_ID: 'prod',
			TREESEED_CAPACITY_PROVIDER_API_KEY: apiKey,
			TREESEED_PROVIDER_DATA_DIR: '/data',
			TREESEED_PROVIDER_API_PORT: '3100',
			TREESEED_PROVIDER_ENVIRONMENT: 'local',
			TREESEED_PROVIDER_HOST_DATA_DIR: '.treeseed/local-capacity-provider/data',
			TREESEED_CODEX_AUTH_JSON_B64: 'codex-auth-secret',
			TREESEED_PROVIDER_MAX_CONCURRENT_RUNNERS: '4',
		});

		const redacted = redactCapacityProviderEnv(env);
		expect(redacted.TREESEED_CAPACITY_PROVIDER_API_KEY).not.toContain(apiKey);
		expect(redacted.TREESEED_CODEX_AUTH_JSON_B64).not.toContain('codex-auth-secret');

		const instructions = renderCapacityProviderSelfHostInstructions({
			marketUrl: 'https://api.treeseed.ai',
			marketId: 'prod',
			apiKey,
			codexAuthJsonB64: 'codex-auth-secret',
		});
		const displayOutput = JSON.stringify({
			composeFile: instructions.composeFile,
			commands: instructions.commands,
			redactedEnv: instructions.redactedEnv,
			summary: instructions.summary,
		});
		expect(displayOutput).not.toContain(apiKey);
		expect(displayOutput).not.toContain('codex-auth-secret');
		expect(instructions.commands.join('\n')).not.toContain('env');
		expect(instructions.composeFile).toBe('packages/agent/compose.capacity-provider.yml');
	});

	it('resolves capacity provider launch env from process env and explicit overrides without writing files', () => {
		const launch = resolveCapacityProviderLaunchEnvironment({
			env: {
				TREESEED_MARKET_URL: 'https://stored.example.com',
				TREESEED_MANAGER_ID: 'stored',
				TREESEED_CAPACITY_PROVIDER_API_KEY: 'stored-secret-key',
				TREESEED_PROVIDER_HOST_DATA_DIR: '.treeseed/stored/data',
			},
			overrides: {
				TREESEED_MARKET_URL: 'http://127.0.0.1:3000',
				TREESEED_MANAGER_ID: 'local',
				TREESEED_CAPACITY_PROVIDER_API_KEY: apiKey,
				TREESEED_PROVIDER_STARTUP_MODE: 'diagnostic',
			},
			diagnostic: true,
		});

		expect(CAPACITY_PROVIDER_ENV_KEYS).toContain('TREESEED_CAPACITY_PROVIDER_API_KEY');
		expect(launch.source).toBe('process-env');
		expect(launch.missing).toEqual([]);
		expect(launch.diagnostic).toBe(true);
		expect(launch.env).toMatchObject({
			TREESEED_MARKET_URL: 'http://127.0.0.1:3000',
			TREESEED_MANAGER_ID: 'local',
			TREESEED_CAPACITY_PROVIDER_API_KEY: apiKey,
			TREESEED_PROVIDER_HOST_DATA_DIR: '.treeseed/stored/data',
			TREESEED_PROVIDER_DATA_DIR: '/data',
			TREESEED_PROVIDER_API_PORT: '3100',
			TREESEED_PROVIDER_ENVIRONMENT: 'local',
			TREESEED_PROVIDER_STARTUP_MODE: 'diagnostic',
		});
		expect(JSON.stringify(launch.redactedEnv)).not.toContain(apiKey);
		expect(() => resolveCapacityProviderLaunchEnvironment({ env: {}, requireConnection: true })).toThrow(/TREESEED_MARKET_URL/u);
	});

	it('deploys provider roles through SDK primitives with host-secret env refs and redacted output', async () => {
		const intent: CapacityProviderDeploymentIntent = {
			teamId: 'team_123',
			capacityProviderId: 'cp_123',
			launchMode: 'connected_host',
			hostKind: 'railway',
			hostId: 'host_123',
		};
		const env = resolveCapacityProviderEnvironment({
			marketUrl: 'https://api.treeseed.ai',
			marketId: 'prod',
			apiKey,
		});
		const seen: Array<{ role: string; command: string; env: Record<string, string>; redactedEnv: Record<string, string> }> = [];
		const railway = await deployCapacityProviderToRailway({
			intent,
			env,
			redactedEnv: redactCapacityProviderEnv(env),
			imageRef: 'ghcr.io/treeseed-ai/agent:verified',
			serviceNamePrefix: 'provider-verified',
			adapter: {
				async provisionService(spec) {
					seen.push({ role: spec.role, command: spec.startCommand, env: spec.env, redactedEnv: spec.redactedEnv });
					return {
						role: spec.role,
						serviceName: spec.serviceName,
						serviceId: `svc_${spec.role}`,
						status: 'deployed',
						envRefs: {
							TREESEED_CAPACITY_PROVIDER_API_KEY: `${spec.serviceName}:secret`,
						},
					};
				},
			},
		});
		expect(CAPACITY_PROVIDER_DEPLOYMENT_SERVICE_ROLES).toEqual(['api', 'manager', 'runner']);
		expect(railway.ok).toBe(true);
		expect(railway.status).toBe('deployed');
		expect(Object.keys(railway.serviceRefs)).toEqual(['api', 'manager', 'runner']);
		expect(seen.map((entry) => entry.command)).toEqual([
			'node ./dist/provider/entrypoint.js api',
			'node ./dist/provider/entrypoint.js manager',
			'node ./dist/provider/entrypoint.js runner',
		]);
		expect(seen.every((entry) => entry.env.TREESEED_CAPACITY_PROVIDER_API_KEY === apiKey)).toBe(true);
		expect(JSON.stringify(railway)).not.toContain(apiKey);
		expect(JSON.stringify(seen.map((entry) => entry.redactedEnv))).not.toContain(apiKey);

		const managed = await deployCapacityProviderToManagedMarketHost({
			intent: { ...intent, launchMode: 'managed_market_host', hostKind: 'managed_market_host' },
			env,
		});
		expect(managed.launchMode).toBe('managed_market_host');
		expect(JSON.stringify(managed)).not.toContain(apiKey);
	});

	it('persists local provider connection values into encrypted Treeseed machine config', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'treeseed-provider-config-'));
		const previousHome = process.env.HOME;
		const previousTransport = process.env.TREESEED_KEY_AGENT_TRANSPORT;
		try {
			process.env.HOME = root;
			process.env.TREESEED_KEY_AGENT_TRANSPORT = 'inline';
			writeFileSync(resolve(root, 'treeseed.site.yaml'), [
				'name: Provider Config Test',
				'slug: provider-config-test',
				'siteUrl: https://example.com',
				'contactEmail: ops@example.com',
				'surfaces:',
				'  api:',
				'    enabled: true',
				'',
			].join('\n'), 'utf8');
			writeTreeseedMachineConfig(root, createDefaultTreeseedMachineConfig({
				tenantRoot: root,
				deployConfig: {
					name: 'Provider Config Test',
					slug: 'provider-config-test',
					siteUrl: 'https://example.com',
					surfaces: {
						api: {
							enabled: true,
						},
					},
				},
				tenantConfig: undefined,
			}));
			unlockTreeseedSecretSessionWithPassphrase(root, 'test-passphrase', {
				createIfMissing: true,
				allowMigration: false,
			});

			const persisted = persistCapacityProviderConnectionToTreeseedConfig({
				tenantRoot: root,
				scope: 'local',
				marketUrl: 'http://127.0.0.1:3000/',
				marketId: 'local',
				apiKey,
				providerHostDataDir: '.treeseed/local-capacity-provider/data',
				providerEnvironment: 'local',
			});
			const launch = resolveCapacityProviderLaunchEnvironment({
				tenantRoot: root,
				scope: 'local',
				env: {},
				requireConnection: true,
			});

			expect(persisted.writtenKeys).toEqual([
				'TREESEED_MARKET_URL',
				'TREESEED_MANAGER_ID',
				'TREESEED_CAPACITY_PROVIDER_API_KEY',
				'TREESEED_PROVIDER_HOST_DATA_DIR',
				'TREESEED_PROVIDER_ENVIRONMENT',
			]);
			expect(launch.env).toMatchObject({
				TREESEED_MARKET_URL: 'http://127.0.0.1:3000',
				TREESEED_MANAGER_ID: 'local',
				TREESEED_CAPACITY_PROVIDER_API_KEY: apiKey,
				TREESEED_PROVIDER_HOST_DATA_DIR: '.treeseed/local-capacity-provider/data',
				TREESEED_PROVIDER_ENVIRONMENT: 'local',
			});
			expect(launch.source).toBe('treeseed-config');
			expect(JSON.stringify(persisted.redactedEnv)).not.toContain(apiKey);
		} finally {
			if (previousHome === undefined) delete process.env.HOME;
			else process.env.HOME = previousHome;
			if (previousTransport === undefined) delete process.env.TREESEED_KEY_AGENT_TRANSPORT;
			else process.env.TREESEED_KEY_AGENT_TRANSPORT = previousTransport;
			rmSync(root, { recursive: true, force: true });
		}
	});
});
