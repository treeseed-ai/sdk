import { describe, expect, it, vi } from 'vitest';
import {
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	getRailwayServiceInstance,
	railwayGraphqlRequest,
} from '../../src/operations/services/railway-api.ts';

describe('railwayGraphqlRequest', () => {
	it('creates missing Railway services from GitHub source when requested', async () => {
		const requests: unknown[] = [];
		const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
			requests.push(JSON.parse(String(init?.body ?? '{}')));
			const query = String((requests.at(-1) as { query?: string }).query ?? '');
			if (query.includes('TreeseedRailwayServices') || query.includes('TreeseedRailwayEnvironmentServices')) {
				return new Response(JSON.stringify({ data: { project: { services: { edges: [] } }, environment: { serviceInstances: { edges: [] } } } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			return new Response(JSON.stringify({ data: { serviceCreate: { id: 'svc-api', name: 'treeseed-api' } } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});

		const result = await ensureRailwayService({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceName: 'treeseed-api',
			sourceRepo: 'treeseed-ai/api',
			sourceBranch: 'staging',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
		});

		const createRequest = requests.find((entry) => String((entry as { query?: string }).query ?? '').includes('TreeseedRailwayServiceCreate')) as { variables?: { input?: Record<string, unknown> } };
		expect(result.created).toBe(true);
		expect(createRequest.variables?.input).toMatchObject({
			projectId: 'project-1',
			name: 'treeseed-api',
			environmentId: 'env-staging',
			source: { repo: 'treeseed-ai/api' },
			branch: 'staging',
		});
		expect(JSON.stringify(createRequest.variables?.input)).not.toContain('image');
	});

	it('retries transient 429 responses and succeeds on a later attempt', async () => {
		const fetchMock = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({ errors: [{ message: 'Rate limit exceeded' }] }), {
				status: 429,
				headers: {
					'content-type': 'application/json',
					'retry-after': '0',
				},
			}))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					ok: true,
				},
			}), {
				status: 200,
				headers: {
					'content-type': 'application/json',
				},
			}));

		const result = await railwayGraphqlRequest<{ ok: boolean }>({
			query: 'query TreeseedTest { ok }',
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'railway-token-value',
			},
			retries: 1,
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.data.ok).toBe(true);
	});

	it('uses the configured Railway API request timeout', async () => {
		const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));

		await expect(railwayGraphqlRequest({
			query: 'query TreeseedTest { ok }',
			env: {
				RAILWAY_API_TOKEN: 'railway-token-value',
				TREESEED_RAILWAY_API_TIMEOUT_MS: '1',
			},
			retries: 0,
			fetchImpl: fetchMock,
		})).rejects.toThrow(/timed out after 1ms/u);
	});

	it('reads Railway service instance runtime configuration when the schema supports it', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
			data: {
				serviceInstance: {
					id: 'svc-inst-1',
					buildCommand: 'npm run build',
					startCommand: 'npm run start:api',
					rootDirectory: 'packages/api',
					healthcheckPath: '/healthz',
					healthcheckTimeout: 10,
					sleepApplication: true,
				},
			},
		}), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		}));

		const result = await getRailwayServiceInstance({
			serviceId: 'svc-api',
			environmentId: 'env-production',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
		});

		expect(result).toMatchObject({
			id: 'svc-inst-1',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
			sleepApplication: true,
			runtimeConfigSupported: true,
		});
	});

	it('updates Railway service instance runtime settings through the API', async () => {
		const fetchMock = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'svc-inst-1',
						buildCommand: 'npm run build',
						startCommand: 'npm run start:api',
						rootDirectory: 'packages/api',
						healthcheckPath: '/readyz',
						healthcheckTimeout: 5,
						sleepApplication: false,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstanceUpdate: true,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'svc-inst-1',
						buildCommand: 'npm run build',
						startCommand: 'npm run start:api',
						rootDirectory: 'packages/api',
						healthcheckPath: '/healthz',
						healthcheckTimeout: 10,
						sleepApplication: true,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await ensureRailwayServiceInstanceConfiguration({
			serviceId: 'svc-api',
			environmentId: 'env-production',
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
			settleDelayMs: 0,
		});

		expect(fetchMock).toHaveBeenCalledTimes(3);
		const [, updateInit] = fetchMock.mock.calls[1] ?? [];
		expect(JSON.parse(String(updateInit?.body))).toMatchObject({
			variables: {
				serviceId: 'svc-api',
				environmentId: 'env-production',
				input: {
					startCommand: 'npm run start:api',
					rootDirectory: 'packages/api',
					healthcheckPath: '/healthz',
					healthcheckTimeout: 10,
					sleepApplication: true,
				},
			},
		});
		expect(result.instance).toMatchObject({
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
			sleepApplication: true,
		});
	});

	it('waits for Railway service instance settings to settle after an update', async () => {
		const staleInstance = {
			id: 'svc-inst-1',
			buildCommand: null,
			startCommand: null,
			rootDirectory: null,
			healthcheckPath: null,
			healthcheckTimeout: null,
			sleepApplication: false,
		};
		const fetchMock = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: staleInstance,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstanceUpdate: true,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: staleInstance,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: staleInstance,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'svc-inst-1',
						buildCommand: null,
						startCommand: 'npm run start:api',
						rootDirectory: 'packages/api',
						healthcheckPath: '/healthz',
						healthcheckTimeout: 10,
						sleepApplication: true,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await ensureRailwayServiceInstanceConfiguration({
			serviceId: 'svc-api',
			environmentId: 'env-production',
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
			settleDelayMs: 0,
		});

		expect(fetchMock).toHaveBeenCalledTimes(5);
		expect(result.instance).toMatchObject({
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
		});
	});

	it('waits for a new Railway service instance before applying runtime settings', async () => {
		const fetchMock = vi.fn<typeof fetch>()
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: null,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'svc-inst-1',
						buildCommand: null,
						startCommand: null,
						rootDirectory: null,
						healthcheckPath: null,
						healthcheckTimeout: null,
						sleepApplication: false,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstanceUpdate: true,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'svc-inst-1',
						buildCommand: null,
						startCommand: 'npm run start:api',
						rootDirectory: 'packages/api',
						healthcheckPath: '/healthz',
						healthcheckTimeout: 10,
						sleepApplication: true,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await ensureRailwayServiceInstanceConfiguration({
			serviceId: 'svc-api',
			environmentId: 'env-production',
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
			settleDelayMs: 0,
		});

		expect(fetchMock).toHaveBeenCalledTimes(4);
		const [, retryInit] = fetchMock.mock.calls[1] ?? [];
		expect(String(retryInit?.body)).toContain('TreeseedRailwayServiceInstance');
		const [, updateInit] = fetchMock.mock.calls[2] ?? [];
		expect(JSON.parse(String(updateInit?.body))).toMatchObject({
			variables: {
				serviceId: 'svc-api',
				environmentId: 'env-production',
				input: {
					startCommand: 'npm run start:api',
					rootDirectory: 'packages/api',
					healthcheckPath: '/healthz',
					healthcheckTimeout: 10,
					sleepApplication: true,
				},
			},
		});
		expect(result.instance).toMatchObject({
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
		});
	});

	it('keeps waiting for delayed Railway service instance creation before applying runtime settings', async () => {
		const fetchMock = vi.fn<typeof fetch>();
		for (let index = 0; index < 10; index += 1) {
			fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: null,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }));
		}
		fetchMock
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'svc-inst-1',
						buildCommand: null,
						startCommand: null,
						rootDirectory: null,
						healthcheckPath: null,
						healthcheckTimeout: null,
						sleepApplication: false,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstanceUpdate: true,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'svc-inst-1',
						buildCommand: null,
						startCommand: 'npm run start:api',
						rootDirectory: 'packages/api',
						healthcheckPath: '/healthz',
						healthcheckTimeout: 10,
						sleepApplication: true,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await ensureRailwayServiceInstanceConfiguration({
			serviceId: 'svc-api',
			environmentId: 'env-production',
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
			settleAttempts: 12,
			settleDelayMs: 0,
		});

		expect(fetchMock).toHaveBeenCalledTimes(13);
		expect(result.updated).toBe(true);
		expect(result.instance).toMatchObject({
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
		});
	});
});
