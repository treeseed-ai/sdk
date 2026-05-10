import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	configuredRailwayScheduledJobs,
	configuredRailwayServices,
	collectRailwayDeploymentStatusChecks,
	buildRailwayCommandEnv,
	buildRailwayDeployCommandEnv,
	deriveRailwayWorkerRunnerServiceName,
	deriveRailwayWorkerRunnerVolumeName,
	ensureRailwayScheduledJobs,
	isRailwayTransientFailure,
	planRailwayServiceDeploy,
	railwayServiceRuntimeStartCommand,
	resolveRailwayAuthToken,
	shouldRunRailwayPredeployBuild,
	validateRailwayDeployPrerequisites,
	verifyRailwayManagedResources,
	verifyRailwayScheduledJobs,
} from '../../src/operations/services/railway-deploy.ts';
import { ensureRailwayServiceVolume } from '../../src/operations/services/railway-api.ts';

const tempRoots = new Set<string>();

async function createTenantFixture() {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-railway-deploy-'));
	tempRoots.add(tenantRoot);
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n',
	);
	await writeFile(
		join(tenantRoot, 'treeseed.site.yaml'),
		`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
services:
  api:
    provider: railway
    enabled: true
    railway:
      projectName: acme-docs
      serviceName: acme-docs-api
      rootDir: .
  workerRunner:
    provider: railway
    enabled: true
    railway:
      projectName: acme-docs
      rootDir: .
  workdayManager:
    provider: railway
    enabled: true
    railway:
      projectId: railway-project-1
      projectName: acme-docs
      serviceId: svc-manager
      serviceName: acme-docs-workday-start
      startCommand: npm run workday-manager
      schedule:
        - "0 9 * * 1-5"
`,
	);
	return tenantRoot;
}

function railwayTopologyPayload() {
	return {
		data: {
			me: {
				id: 'user-1',
				name: 'Adrian Webb',
				email: 'adrian@example.com',
				workspaces: [
					{ id: 'workspace-1', name: 'knowledge-coop' },
				],
			},
		},
	};
}

function railwayProjectsPayload() {
	return {
		data: {
			projects: {
				edges: [{
					node: {
						id: 'railway-project-1',
						name: 'acme-docs',
						workspaceId: 'workspace-1',
						environments: {
							edges: [{
								node: {
									id: 'env-production',
									name: 'production',
								},
							}, {
								node: {
									id: 'env-staging',
									name: 'staging',
								},
							}],
						},
						services: {
							edges: [
								{
									node: {
										id: 'svc-api',
										name: 'acme-docs-api',
									},
								},
								{
									node: {
										id: 'svc-manager',
										name: 'acme-docs-workday-start',
									},
								},
								{
									node: {
										id: 'svc-runner-01',
										name: 'acme-docs-worker-runner-01',
									},
								},
								{
									node: {
										id: 'svc-workday-start',
										name: 'acme-docs-workday-start',
									},
								},
								{
									node: {
										id: 'svc-workday-report',
										name: 'acme-docs-workday-report',
									},
								},
							],
						},
					},
				}],
			},
		},
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const tenantRoot of tempRoots) {
		await rm(tenantRoot, { recursive: true, force: true });
	}
	tempRoots.clear();
});

describe('railway scheduled jobs', () => {
	it('normalizes prod scope to the Railway production environment by default', async () => {
		const tenantRoot = await createTenantFixture();

		const services = configuredRailwayServices(tenantRoot, 'prod');

		expect(services).toHaveLength(3);
		expect(services.every((service) => service.railwayEnvironment === 'production')).toBe(true);
	});

	it('derives worker-runner pool service and volume names outside tenant config', async () => {
		const tenantRoot = await createTenantFixture();

		const services = configuredRailwayServices(tenantRoot, 'staging');
		const runner = services.find((service) => service.key === 'workerRunner');

		expect(deriveRailwayWorkerRunnerServiceName('acme-docs')).toBe('acme-docs-worker-runner-01');
		expect(deriveRailwayWorkerRunnerVolumeName('acme-docs-worker-runner-01')).toBe('acme-docs-worker-runner-01-data');
		expect(deriveRailwayWorkerRunnerVolumeName('acme-docs-worker-runner-01', 'staging')).toBe('acme-docs-worker-runner-01-staging-data');
		expect(runner).toMatchObject({
			serviceName: 'acme-docs-worker-runner-01',
			runnerPool: {
				bootstrapIndex: 1,
				volumeMountPath: '/data',
			},
		});
	});

	it('plans workday-manager schedules for staging and prod', async () => {
		const tenantRoot = await createTenantFixture();

		const staging = configuredRailwayScheduledJobs(tenantRoot, 'staging');
		const prod = configuredRailwayScheduledJobs(tenantRoot, 'prod');

		expect(staging).toHaveLength(1);
		expect(staging[0]).toMatchObject({
			service: 'workdayManager',
			serviceName: 'acme-docs-workday-start',
			environment: 'staging',
			expression: '0 9 * * 1-5',
			command: 'npm run workday-manager',
		});
		expect(prod).toHaveLength(1);
		expect(prod[0]).toMatchObject({
			service: 'workdayManager',
			environment: 'production',
		});
	});

	it('configures the workday-manager service instance with the cron command', async () => {
		const tenantRoot = await createTenantFixture();
		const manager = configuredRailwayServices(tenantRoot, 'staging').find((service) => service.key === 'workdayManager');

		expect(manager?.startCommand).toBe('npm run workday-manager');
		expect(railwayServiceRuntimeStartCommand(manager)).toBe('npm run workday-manager');
	});

	it('detaches Railway deploys from build log streaming by default outside CI', () => {
		const plan = planRailwayServiceDeploy({
			projectId: 'railway-project-1',
			serviceName: 'acme-docs-api',
			railwayEnvironment: 'staging',
			rootDir: '.',
		}, { env: {} });

		expect(plan).toMatchObject({
			command: 'railway',
			args: [
				'up',
				'--service',
				'acme-docs-api',
				'--detach',
				'--project',
				'railway-project-1',
				'--environment',
				'staging',
			],
			cwd: '.',
		});
	});

	it('uses Railway service IDs for deploys when available', () => {
		const plan = planRailwayServiceDeploy({
			projectId: 'railway-project-1',
			serviceId: 'service-id-1',
			serviceName: 'acme-docs-api',
			railwayEnvironment: 'staging',
			rootDir: '.',
		}, { env: {} });

		expect(plan.args).toEqual(expect.arrayContaining([
			'--service',
			'service-id-1',
		]));
		expect(plan.args).not.toContain('acme-docs-api');
	});

	it('supports attached Railway build logs when explicitly requested', () => {
		const plan = planRailwayServiceDeploy({
			serviceName: 'acme-docs-api',
			railwayEnvironment: 'staging',
			rootDir: '.',
		}, { env: { TREESEED_RAILWAY_DEPLOY_ATTACH_LOGS: '1' } });

		expect(plan.args).toContain('--ci');
		expect(plan.args).not.toContain('--detach');
	});

	it('uses detached Railway deploy mode in hosted CI unless attachment is requested', () => {
		const plan = planRailwayServiceDeploy({
			serviceName: 'acme-docs-api',
			railwayEnvironment: 'staging',
			rootDir: '.',
		}, { env: { CI: 'true' } });

		expect(plan.args).toContain('--detach');
		expect(plan.args).not.toContain('--ci');
		expect(plan.args).not.toContain('--verbose');
	});

	it('disables Railway CLI CI mode for detached deploys in hosted CI', () => {
		expect(buildRailwayDeployCommandEnv({
			CI: 'true',
			RAILWAY_API_TOKEN: 'railway-api-token',
		})).toMatchObject({
			CI: 'false',
			RAILWAY_TOKEN: 'railway-api-token',
		});
		expect(buildRailwayDeployCommandEnv({
			CI: 'true',
			RAILWAY_API_TOKEN: 'railway-api-token',
			TREESEED_RAILWAY_DEPLOY_ATTACH_LOGS: '1',
		})).toMatchObject({
			CI: 'true',
			RAILWAY_TOKEN: 'railway-api-token',
		});
	});

	it('allows Railway deploy log attachment to be disabled explicitly in CI', () => {
		const plan = planRailwayServiceDeploy({
			serviceName: 'acme-docs-api',
			railwayEnvironment: 'staging',
			rootDir: '.',
		}, { env: { CI: 'true', TREESEED_RAILWAY_DEPLOY_ATTACH_LOGS: '0' } });

		expect(plan.args).toContain('--detach');
		expect(plan.args).not.toContain('--ci');
		expect(plan.args).not.toContain('--verbose');
	});

	it('lets Railway run service build commands from a clean upload in hosted CI', () => {
		expect(shouldRunRailwayPredeployBuild({ CI: 'true' })).toBe(false);
		expect(shouldRunRailwayPredeployBuild({ CI: 'true', TREESEED_RAILWAY_PREDEPLOY_BUILD: '1' })).toBe(true);
		expect(shouldRunRailwayPredeployBuild({ CI: 'true', TREESEED_RAILWAY_PREDEPLOY_BUILD: '0' })).toBe(false);
		expect(shouldRunRailwayPredeployBuild({})).toBe(true);
	});

	it('treats Railway build log retrieval failures as transient deploy failures', () => {
		expect(isRailwayTransientFailure({
			status: 1,
			stdout: 'Build Logs: https://railway.com/project/example',
			stderr: 'Failed to stream build logs: Failed to retrieve build log',
		})).toBe(true);
	});

	it('creates a missing worker-runner volume at the standard repository mount path', async () => {
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				return new Response(JSON.stringify({ data: { project: { volumes: { edges: [] } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			expect(body.variables.input).toMatchObject({
				projectId: 'project-1',
				environmentId: 'env-staging',
				serviceId: 'svc-runner-01',
				name: 'acme-docs-worker-runner-01-data',
				mountPath: '/data',
			});
			return new Response(JSON.stringify({
				data: {
					volumeCreate: {
						id: 'vol-1',
						name: 'acme-docs-worker-runner-01-data',
						projectId: 'project-1',
						volumeInstances: {
							edges: [{
								node: {
									id: 'vi-1',
									serviceId: 'svc-runner-01',
									environmentId: 'env-staging',
									mountPath: '/data',
								},
							}],
						},
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-runner-01',
			name: 'acme-docs-worker-runner-01-data',
			mountPath: '/data',
			env: { RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result).toMatchObject({
			created: true,
			updated: false,
			volume: {
				id: 'vol-1',
				name: 'acme-docs-worker-runner-01-data',
			},
		});
	});

	it('updates a drifted worker-runner volume mount path without deleting it', async () => {
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: [{
									node: {
										id: 'vol-1',
										name: 'acme-docs-worker-runner-01-data',
										projectId: 'project-1',
										volumeInstances: {
											edges: [{
												node: {
													id: 'vi-1',
													serviceId: 'svc-runner-01',
													environmentId: 'env-staging',
													mountPath: '/app/data',
												},
											}],
										},
									},
								}],
							},
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			expect(String(body.query)).toContain('TreeseedRailwayVolumeInstanceUpdate');
			expect(body.variables).toEqual({
				id: 'vi-1',
				input: { mountPath: '/data' },
			});
			return new Response(JSON.stringify({
				data: {
					volumeInstanceUpdate: {
						id: 'vi-1',
						serviceId: 'svc-runner-01',
						environmentId: 'env-staging',
						mountPath: '/data',
					},
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-runner-01',
			name: 'acme-docs-worker-runner-01-data',
			mountPath: '/data',
			env: { RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result.created).toBe(false);
		expect(result.updated).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('creates a missing schedule and returns its locator for prod deploy', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('RAILWAY_API_TOKEN', 'railway-token');
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-production');

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayServiceInstance')) {
				return new Response(JSON.stringify({
					data: {
						serviceInstance: {
							id: 'instance-1',
							buildCommand: null,
							startCommand: null,
							cronSchedule: null,
							rootDirectory: null,
							healthcheckPath: null,
							healthcheckTimeout: null,
							sleepApplication: false,
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('mutation TreeseedRailwayServiceInstanceUpdate')) {
				expect(body.variables.input).toMatchObject({
					startCommand: 'npm run workday-manager',
					cronSchedule: '0 9 * * 1-5',
				});
				return new Response(JSON.stringify({ data: { serviceInstanceUpdate: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});

		const result = await ensureRailwayScheduledJobs(tenantRoot, 'prod', { fetchImpl: fetchMock as typeof fetch });

		expect(fetchMock).toHaveBeenCalledTimes(6);
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: 'instance-1',
			logicalName: 'workdayManager:1',
			status: 'updated',
			expression: '0 9 * * 1-5',
		});
	});

	it('updates a drifted schedule and verifies reconciled jobs', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('RAILWAY_API_TOKEN', 'railway-token');
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-production');

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayServiceInstance')) {
				return new Response(JSON.stringify({
					data: {
						serviceInstance: {
							id: 'instance-1',
							buildCommand: null,
							startCommand: 'npm run manager:old',
							cronSchedule: '0 * * * *',
							rootDirectory: null,
							healthcheckPath: null,
							healthcheckTimeout: null,
							sleepApplication: false,
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('mutation TreeseedRailwayServiceInstanceUpdate')) {
				return new Response(JSON.stringify({ data: { serviceInstanceUpdate: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});

		const ensured = await ensureRailwayScheduledJobs(tenantRoot, 'prod', { fetchImpl: fetchMock as typeof fetch });
		expect(ensured[0]).toMatchObject({
			id: 'instance-1',
			status: 'updated',
			command: 'npm run workday-manager',
		});

		const verifyFetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayServiceInstance')) {
				return new Response(JSON.stringify({
				data: {
					serviceInstance: {
						id: 'instance-1',
						buildCommand: null,
						startCommand: 'npm run workday-manager',
						cronSchedule: '0 9 * * 1-5',
						rootDirectory: null,
						healthcheckPath: null,
						healthcheckTimeout: null,
						sleepApplication: false,
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});

		const verified = await verifyRailwayScheduledJobs(tenantRoot, 'prod', { fetchImpl: verifyFetchMock as typeof fetch });
		expect(verified.ok).toBe(true);
		expect(verified.checks[0]).toMatchObject({
			id: 'instance-1',
			ok: true,
		});
	});

	it('verifies managed Railway services, workday schedule, and worker-runner volume', async () => {
		const tenantRoot = await createTenantFixture();
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayServiceInstance')) {
				const serviceId = body.variables.serviceId;
				return new Response(JSON.stringify({
					data: {
						serviceInstance: {
							id: `instance-${serviceId}`,
							buildCommand: null,
							startCommand: serviceId === 'svc-manager' ? 'npm run workday-manager' : null,
							cronSchedule: serviceId === 'svc-manager' ? '0 9 * * 1-5' : null,
							rootDirectory: null,
							healthcheckPath: null,
							healthcheckTimeout: null,
							sleepApplication: serviceId === 'svc-api',
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayVolumeList')) {
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: [{
									node: {
										id: 'vol-1',
										name: 'acme-docs-worker-runner-01-staging-data',
										projectId: 'railway-project-1',
										volumeInstances: {
											edges: [{
												node: {
													id: 'vi-1',
													serviceId: 'svc-runner-01',
													environmentId: 'env-staging',
													mountPath: '/data',
												},
											}],
										},
									},
								}],
							},
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});

		const result = await verifyRailwayManagedResources(tenantRoot, 'staging', {
			env: { RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result.ok).toBe(true);
		expect(result.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({ type: 'service-instance', service: 'api', ok: true }),
			expect.objectContaining({ type: 'service-instance', service: 'workdayManager', ok: true }),
			expect.objectContaining({ type: 'service-instance', service: 'workerRunner', ok: true }),
			expect.objectContaining({ type: 'worker-runner-volume', volumeName: 'acme-docs-worker-runner-01-staging-data', mountPath: '/data', ok: true }),
			expect.objectContaining({ type: 'schedule', service: 'workdayManager', ok: true }),
		]));
	});

	it('reports Railway deployment status checks as unsettled until deploys reach success or sleeping', async () => {
		const tenantRoot = await createTenantFixture();
		const services = configuredRailwayServices(tenantRoot, 'staging');
		const statusPayload = {
			environments: {
				edges: [{
					node: {
						name: 'staging',
						serviceInstances: {
							edges: services.map((service) => ({
								node: {
									serviceName: service.serviceName,
									latestDeployment: {
										status: service.key === 'workerRunner' ? 'BUILDING' : 'SUCCESS',
										deploymentStopped: service.key === 'workerRunner',
										instances: service.key === 'workerRunner' ? [{ status: 'CREATED' }] : [{ status: 'RUNNING' }],
										meta: service.key === 'workerRunner' ? { volumeMounts: ['/data'] } : {},
									},
								},
							})),
						},
					},
				}],
			},
		};

		const unsettled = collectRailwayDeploymentStatusChecks(statusPayload, 'staging', services);
		expect(unsettled).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: 'deployment-status',
				service: 'workerRunner',
				ok: false,
				status: 'BUILDING',
			}),
		]));

		for (const edge of statusPayload.environments.edges[0].node.serviceInstances.edges) {
			if (edge.node.serviceName.endsWith('worker-runner-01')) {
				edge.node.latestDeployment.status = 'SUCCESS';
				edge.node.latestDeployment.instances = [{ status: 'EXITED' }];
			}
		}
		const settled = collectRailwayDeploymentStatusChecks(statusPayload, 'staging', services);
		expect(settled.every((entry) => entry.ok)).toBe(true);
		expect(settled).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: 'deployment-status',
				service: 'workerRunner',
				ok: true,
				observed: expect.objectContaining({
					volumeMounts: ['/data'],
				}),
			}),
		]));
	});

	it('accepts Railway deploy prerequisites and schedule sync from explicit env overrides', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-production');

		expect(() =>
			validateRailwayDeployPrerequisites(tenantRoot, 'prod', {
				env: { RAILWAY_API_TOKEN: 'railway-token' },
			}),
		).not.toThrow();

		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayServiceInstance')) {
				expect(init?.headers).toMatchObject({
					authorization: 'Bearer railway-token',
				});
				return new Response(JSON.stringify({
					data: {
						serviceInstance: {
							id: 'instance-1',
							buildCommand: null,
							startCommand: null,
							cronSchedule: null,
							rootDirectory: null,
							healthcheckPath: null,
							healthcheckTimeout: null,
							sleepApplication: false,
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('mutation TreeseedRailwayServiceInstanceUpdate')) {
				return new Response(JSON.stringify({ data: { serviceInstanceUpdate: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});

		const result = await ensureRailwayScheduledJobs(tenantRoot, 'prod', {
			env: { RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result[0]).toMatchObject({
			id: 'instance-1',
			status: 'updated',
		});
	});

	it('uses RAILWAY_API_TOKEN as the Treeseed-owned Railway auth source', async () => {
		expect(resolveRailwayAuthToken({
			RAILWAY_API_TOKEN: 'railway-api-token',
		})).toBe('railway-api-token');
		expect(resolveRailwayAuthToken({})).toBe('');
		expect(buildRailwayCommandEnv({ RAILWAY_API_TOKEN: 'railway-api-token' })).toMatchObject({
			RAILWAY_API_TOKEN: 'railway-api-token',
			RAILWAY_TOKEN: 'railway-api-token',
		});
	});
});
