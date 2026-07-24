import { describe, expect, it, vi } from 'vitest';

import {
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	getRailwayServiceInstance,
	inspectRailwayServiceDeploymentHealth,
	assertRailwayGraphqlReadOnly,
	railwayGraphqlRequest,
	upsertRailwayVariables,
} from '../../../../../src/operations/services/hosting/railway/railway-api.ts';
describe('railwayGraphqlRequest', () => {
it('reports the immutable image attached to the latest deployment', async () => {
		const result = await inspectRailwayServiceDeploymentHealth({
			serviceId: 'service-1',
			environmentId: 'environment-production',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: vi.fn<typeof fetch>(async () => Response.json({ data: { serviceInstance: { latestDeployment: {
				status: 'SUCCESS',
				deploymentStopped: false,
				meta: { image: 'treeseed/api:1.2.3' },
				instances: [{ status: 'RUNNING' }],
			} } } })),
		});
		expect(result).toMatchObject({ ok: true, image: 'treeseed/api:1.2.3' });
	});

it('rejects every non-query Railway GraphQL operation before transport', () => {
		expect(() => assertRailwayGraphqlReadOnly('mutation Unsafe { serviceDelete(id: "x") }')).toThrow(/read-only/u);
		expect(() => assertRailwayGraphqlReadOnly('# comment\nsubscription Unsafe { deployments }')).toThrow(/read-only/u);
		expect(() => assertRailwayGraphqlReadOnly('query Safe { me { id } }')).not.toThrow();
		expect(() => assertRailwayGraphqlReadOnly('{ me { id } }')).not.toThrow();
	});

it('creates missing Railway services from GitHub source when requested', async () => {
		const requests: unknown[] = [];
		let committed = false;
		const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
			requests.push(JSON.parse(String(init?.body ?? '{}')));
			const query = String((requests.at(-1) as { query?: string }).query ?? '');
			if (query.includes('TreeseedRailwayProjectServices') || query.includes('TreeseedRailwayEnvironmentServices')) {
				const edges = committed ? [{ node: { id: 'svc-api', name: 'treeseed-api' } }] : [];
				return new Response(JSON.stringify({ data: { project: { services: { edges } }, environment: { serviceInstances: { edges } } } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			if (query.includes('IacStageEnvironmentChanges')) {
				return new Response(JSON.stringify({ data: { environmentStageChanges: { id: 'patch-1' } } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			committed = true;
			return new Response(JSON.stringify({ data: { environmentPatchCommitStaged: true } }), {
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

		const createRequest = requests.find((entry) => String((entry as { query?: string }).query ?? '').includes('IacStageEnvironmentChanges')) as { variables?: { payload?: Record<string, any> } };
		expect(result.created).toBe(true);
		expect(createRequest.variables?.payload).toMatchObject({
			services: {
				'treeseed-api': {
					isCreated: true,
					source: { repo: 'treeseed-ai/api', branch: 'staging', image: null },
				},
			},
		});
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
				TREESEED_RAILWAY_API_TOKEN: 'railway-token-value',
				TREESEED_RAILWAY_API_TIMEOUT_MS: '1',
			},
			retries: 0,
			fetchImpl: fetchMock,
		})).rejects.toThrow(/timed out after 1ms/u);
	});

it('serializes concurrent Railway observations to prevent request bursts', async () => {
		let releaseFirst: ((response: Response) => void) | null = null;
		const firstResponse = new Promise<Response>((resolve) => { releaseFirst = resolve; });
		const success = () => new Response(JSON.stringify({ data: { ok: true } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
		const fetchMock = vi.fn<typeof fetch>()
			.mockImplementationOnce(() => firstResponse)
			.mockImplementationOnce(async () => success());
		const input = {
			query: 'query TreeseedTest { ok }',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			retries: 0,
			fetchImpl: fetchMock,
		};

		const first = railwayGraphqlRequest<{ ok: boolean }>(input);
		const second = railwayGraphqlRequest<{ ok: boolean }>(input);
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
		releaseFirst!(success());
		await expect(Promise.all([first, second])).resolves.toEqual([
			{ data: { ok: true } },
			{ data: { ok: true } },
		]);
		expect(fetchMock).toHaveBeenCalledTimes(2);
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
					environmentStageChanges: { id: 'patch-1' },
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: { environmentPatchCommitStaged: true } }), { status: 200, headers: { 'content-type': 'application/json' } }))
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

		expect(fetchMock).toHaveBeenCalledTimes(4);
		const [, updateInit] = fetchMock.mock.calls[1] ?? [];
		expect(JSON.parse(String(updateInit?.body))).toMatchObject({
			variables: {
				environmentId: 'env-production',
				payload: {
					services: {
						'svc-api': {
							deploy: expect.objectContaining({ startCommand: 'npm run start:api', healthcheckPath: '/healthz', healthcheckTimeout: 10, sleepApplication: true }),
							source: { rootDirectory: 'packages/api' },
						},
					},
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
});
