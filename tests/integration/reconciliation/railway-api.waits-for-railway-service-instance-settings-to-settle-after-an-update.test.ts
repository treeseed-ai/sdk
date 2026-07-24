import { describe, expect, it, vi } from 'vitest';

import {
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	getRailwayServiceInstance,
	inspectRailwayServiceDeploymentHealth,
	assertRailwayGraphqlReadOnly,
	railwayGraphqlRequest,
	upsertRailwayVariables,
} from '../../../src/operations/services/railway-api.ts';
describe('railwayGraphqlRequest', () => {
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
					environmentStageChanges: { id: 'patch-1' },
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: { environmentPatchCommitStaged: true } }), { status: 200, headers: { 'content-type': 'application/json' } }))
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

		expect(fetchMock).toHaveBeenCalledTimes(6);
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
					environmentStageChanges: { id: 'patch-1' },
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: { environmentPatchCommitStaged: true } }), { status: 200, headers: { 'content-type': 'application/json' } }))
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
		const [, retryInit] = fetchMock.mock.calls[1] ?? [];
		expect(String(retryInit?.body)).toContain('TreeseedRailwayServiceInstance');
		const [, updateInit] = fetchMock.mock.calls[2] ?? [];
		expect(JSON.parse(String(updateInit?.body))).toMatchObject({
			variables: {
				environmentId: 'env-production',
				payload: {
					services: {
						'svc-api': expect.objectContaining({
							deploy: expect.objectContaining({ startCommand: 'npm run start:api', healthcheckPath: '/healthz', healthcheckTimeout: 10, sleepApplication: true }),
						}),
					},
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
					environmentStageChanges: { id: 'patch-1' },
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ data: { environmentPatchCommitStaged: true } }), { status: 200, headers: { 'content-type': 'application/json' } }))
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

		expect(fetchMock).toHaveBeenCalledTimes(14);
		expect(result.updated).toBe(true);
		expect(result.instance).toMatchObject({
			startCommand: 'npm run start:api',
			rootDirectory: 'packages/api',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
		});
	});

it('retries Railway variables that exist with stale values', async () => {
		const requests: unknown[] = [];
		let variableReads = 0;
		const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
			const request = JSON.parse(String(init?.body ?? '{}'));
			requests.push(request);
			const query = String(request.query ?? '');
			if (query.includes('IacStageEnvironmentChanges')) {
				return new Response(JSON.stringify({ data: { environmentStageChanges: { id: 'patch-1' } } }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				});
			}
			if (query.includes('IacCommitStagedPatch')) {
				return new Response(JSON.stringify({ data: { environmentPatchCommitStaged: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			variableReads += 1;
			const variableValue = variableReads === 1
				? 'treeseed/treedx:0.2.22'
				: 'treeseed/treedx:0.2.23';
			return new Response(JSON.stringify({
				data: {
					variables: {
						TREESEED_PUBLIC_TREEDX_IMAGE_REF: variableValue,
					},
				},
			}), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		});

		await upsertRailwayVariables({
			projectId: 'project-1',
			environmentId: 'env-production',
			serviceId: 'svc-treedx',
			variables: {
				TREESEED_PUBLIC_TREEDX_IMAGE_REF: 'treeseed/treedx:0.2.23',
			},
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
		});

		const upsertRequests = requests.filter((entry) =>
			String((entry as { query?: string }).query ?? '').includes('IacStageEnvironmentChanges'));
		expect(upsertRequests).toHaveLength(2);
		expect(upsertRequests.at(1)).toMatchObject({
			variables: {
				payload: {
					services: {
						'svc-treedx': {
							variables: {
								TREESEED_PUBLIC_TREEDX_IMAGE_REF: { value: 'treeseed/treedx:0.2.23' },
							},
						},
					},
				},
			},
		});
	});
});
