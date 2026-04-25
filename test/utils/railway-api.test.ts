import { describe, expect, it, vi } from 'vitest';
import {
	ensureRailwayServiceInstanceConfiguration,
	getRailwayServiceInstance,
	railwayGraphqlRequest,
} from '../../src/operations/services/railway-api.ts';

describe('railwayGraphqlRequest', () => {
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
				RAILWAY_API_TOKEN: 'railway-token-value',
			},
			retries: 1,
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(result.data.ok).toBe(true);
	});

	it('reads Railway service instance runtime configuration when the schema supports it', async () => {
		const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
			data: {
				serviceInstance: {
					id: 'svc-inst-1',
					buildCommand: 'npm run build:api',
					startCommand: 'node ./src/api/server.js',
					rootDirectory: '.',
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
			env: { RAILWAY_API_TOKEN: 'railway-token-value' },
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
						buildCommand: 'npm run build:api',
						startCommand: 'node ./src/api/server.js',
						rootDirectory: '.',
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
						buildCommand: 'npm run build:api',
						startCommand: 'node ./src/api/server.js',
						rootDirectory: '.',
						healthcheckPath: '/healthz',
						healthcheckTimeout: 10,
						sleepApplication: true,
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await ensureRailwayServiceInstanceConfiguration({
			serviceId: 'svc-api',
			environmentId: 'env-production',
			startCommand: 'node ./src/api/server.js',
			rootDirectory: '.',
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 10,
			runtimeMode: 'serverless',
			env: { RAILWAY_API_TOKEN: 'railway-token-value' },
			fetchImpl: fetchMock,
		});

		expect(fetchMock).toHaveBeenCalledTimes(3);
		const [, updateInit] = fetchMock.mock.calls[1] ?? [];
		expect(JSON.parse(String(updateInit?.body))).toMatchObject({
			variables: {
				serviceId: 'svc-api',
				environmentId: 'env-production',
				input: {
					startCommand: 'node ./src/api/server.js',
					rootDirectory: '.',
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
});
