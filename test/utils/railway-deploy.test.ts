import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	configuredRailwayScheduledJobs,
	configuredRailwayServices,
	collectRailwayDeploymentStatusChecks,
	buildRailwayCommandEnv,
	deriveRailwayCapacityProviderRunnerServiceName,
	deriveRailwayCapacityProviderRunnerVolumeName,
	deriveRailwayOperationsRunnerServiceName,
	deriveRailwayOperationsRunnerVolumeName,
	deriveRailwayWorkerRunnerServiceName,
	deriveRailwayWorkerRunnerVolumeName,
	ensureRailwayScheduledJobs,
	findStaleTreeseedOperationsRunnerResources,
	railwayServiceRuntimeStartCommand,
	resolveRailwayAuthToken,
	shouldRunRailwayPredeployBuild,
	validateRailwayServiceConfiguration,
	validateRailwayDeployPrerequisites,
	waitForRailwayManagedDeploymentsSettled,
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

		expect(services).toHaveLength(1);
		expect(services.every((service) => service.railwayEnvironment === 'production')).toBe(true);
	});

	it('keeps worker-runner naming helpers private to package-owned provider assets', async () => {
		const tenantRoot = await createTenantFixture();

		const services = configuredRailwayServices(tenantRoot, 'staging');
		const runner = services.find((service) => service.key === 'workerRunner');

		expect(deriveRailwayWorkerRunnerServiceName('acme-docs')).toBe('acme-docs-worker-runner-01');
		expect(deriveRailwayWorkerRunnerVolumeName('acme-docs-worker-runner-01')).toBe('acme-docs-worker-runner-01-volume');
		expect(deriveRailwayWorkerRunnerVolumeName('acme-docs-worker-runner-01', 'staging')).toBe('acme-docs-worker-runner-01-volume');
		expect(runner).toBeUndefined();
	});

	it('does not plan root Market workday-manager schedules', async () => {
		const tenantRoot = await createTenantFixture();

		const staging = configuredRailwayScheduledJobs(tenantRoot, 'staging');
		const prod = configuredRailwayScheduledJobs(tenantRoot, 'prod');

		expect(staging).toEqual([]);
		expect(prod).toEqual([]);
	});

	it('keeps root Market Railway services to the API service', async () => {
		const tenantRoot = await createTenantFixture();
		const services = configuredRailwayServices(tenantRoot, 'staging');

		expect(services.map((service) => service.key)).toEqual(['api']);
		expect(railwayServiceRuntimeStartCommand(services[0])).toBeNull();
	});

	it('includes the Treeseed operations runner when the deploy config declares it', async () => {
		const tenantRoot = await createTenantFixture();
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
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: packages/api
  operationsRunner:
    provider: railway
    enabled: true
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api-operations-runner-01
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      healthcheckPath: /healthz
      runtimeMode: service
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
        volumeMountPath: /data
`,
		);
		const services = configuredRailwayServices(tenantRoot, 'staging');
		const runners = services.filter((service) => service.key === 'operationsRunner');

		expect(services.map((service) => service.key)).toEqual(['api', 'operationsRunner']);
		expect(deriveRailwayOperationsRunnerServiceName('treeseed-api-operations-runner-01', 1)).toBe('treeseed-api-operations-runner-01');
		expect(deriveRailwayOperationsRunnerVolumeName('treeseed-api-operations-runner-01')).toBe('treeseed-api-operations-runner-01-volume');
		expect(runners.map((service) => service.serviceName)).toEqual([
			'treeseed-api-operations-runner-01',
		]);
		expect(runners[0]).toMatchObject({
			instanceKey: 'operationsRunner:1',
			runnerId: 'treeseed-api-operations-runner-01',
			buildCommand: 'npm run build',
			startCommand: 'npm run start:runner',
			healthcheckPath: '/healthz',
			runtimeMode: 'service',
			volumeMountPath: '/data',
		});
		expect(runners[0]?.runnerPool).toMatchObject({ bootstrapCount: 1, maxRunners: 4, volumeMountPath: '/data' });
	});

	it('classifies old operations runner services and volumes as stale resources', () => {
		const desiredServices = new Set(['treeseed-api-operations-runner-01']);
		const desiredVolumes = new Set(['treeseed-api-operations-runner-01-volume']);

		expect(findStaleTreeseedOperationsRunnerResources([
			{ name: 'treeseed-api-operations-runner-01' },
			{ name: 'treeseed-api-operations-runner' },
			{ name: 'treeseed-operations-runner' },
			{ name: 'market-ops-staging-1' },
			{ name: 'public-treedx-node-01' },
		], desiredServices).map((entry) => entry.name)).toEqual([
			'treeseed-api-operations-runner',
			'treeseed-operations-runner',
			'market-ops-staging-1',
		]);
		expect(findStaleTreeseedOperationsRunnerResources([
			{ name: 'treeseed-api-operations-runner-01-volume' },
			{ name: 'operations-runner-volume' },
		], desiredVolumes).map((entry) => entry.name)).toEqual(['operations-runner-volume']);
	});

	it('preserves operations runner bootstrap scaling capacity', async () => {
		const tenantRoot = await createTenantFixture();
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
  operationsRunner:
    provider: railway
    enabled: true
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api-operations-runner-01
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 3
        maxRunners: 4
        volumeMountPath: /data
`,
		);
		const runners = configuredRailwayServices(tenantRoot, 'staging')
			.filter((service) => service.key === 'operationsRunner');

		expect(runners.map((service) => service.serviceName)).toEqual([
			'treeseed-api-operations-runner-01',
			'treeseed-api-operations-runner-02',
			'treeseed-api-operations-runner-03',
		]);
		expect(runners.map((service) => service.instanceKey)).toEqual([
			'operationsRunner:1',
			'operationsRunner:2',
			'operationsRunner:3',
		]);
		expect(runners.every((service) => service.runnerPool?.maxRunners === 4)).toBe(true);
		expect(runners.every((service) => service.volumeMountPath === '/data')).toBe(true);
	});

	it('plans capacity provider role images with runner-only Railway volumes', async () => {
		const tenantRoot = await createTenantFixture();
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
runtime:
  mode: treeseed_managed
services:
  capacityProviderManager:
    provider: railway
    enabled: true
    rootDir: packages/agent
    railway:
      projectName: treeseed-capacity
      serviceName: treeseed-capacity-provider-manager
      imageRef: treeseed/agent-manager:dev-staging
  capacityProviderRunner:
    provider: railway
    enabled: true
    rootDir: packages/agent
    railway:
      projectName: treeseed-capacity
      serviceName: treeseed-capacity-provider-runner-01
      imageRef: treeseed/agent-runner:dev-staging
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 2
        maxRunners: 4
        volumeMountPath: /data
`,
		);
		const services = configuredRailwayServices(tenantRoot, 'staging');
		const manager = services.find((service) => service.key === 'capacityProviderManager');
		const runners = services.filter((service) => service.key === 'capacityProviderRunner');

		expect(services.find((service) => service.key === 'capacityProviderApi')).toBeUndefined();
		expect(manager).toMatchObject({
			serviceName: 'treeseed-capacity-provider-manager',
			imageRef: 'treeseed/agent-manager:dev-staging',
			volumeMountPath: null,
		});
		expect(deriveRailwayCapacityProviderRunnerServiceName('treeseed-capacity-provider-runner-01', 2)).toBe('treeseed-capacity-provider-runner-02');
		expect(deriveRailwayCapacityProviderRunnerVolumeName('treeseed-capacity-provider-runner-02')).toBe('treeseed-capacity-provider-runner-02-volume');
		expect(runners.map((service) => service.serviceName)).toEqual([
			'treeseed-capacity-provider-runner-01',
			'treeseed-capacity-provider-runner-02',
		]);
		expect(runners.every((service) => service.imageRef === 'treeseed/agent-runner:dev-staging')).toBe(true);
		expect(runners.every((service) => service.volumeMountPath === '/data')).toBe(true);
	});

	it('uses workspace machine image refs for nested package Railway services', async () => {
		const tenantRoot = await createTenantFixture();
		await writeFile(
			join(tenantRoot, 'package.json'),
			JSON.stringify({ workspaces: ['packages/*'] }),
		);
		await mkdir(join(tenantRoot, 'packages/api/.treeseed/config'), { recursive: true });
		await mkdir(join(tenantRoot, '.treeseed/config'), { recursive: true });
		await writeFile(
			join(tenantRoot, '.treeseed/config/machine.yaml'),
			`environments:
  staging:
    values:
      TREESEED_AGENT_MANAGER_IMAGE_REF: treeseed/agent-manager:dev-staging-current
`,
		);
		await writeFile(
			join(tenantRoot, 'packages/api/.treeseed/config/machine.yaml'),
			`environments:
  staging:
    values:
      TREESEED_AGENT_MANAGER_IMAGE_REF: treeseed/agent-manager:dev-staging-stale
`,
		);
		await writeFile(
			join(tenantRoot, 'packages/api/treeseed.site.yaml'),
			`name: Test API
slug: test-api
siteUrl: https://api.example.com
contactEmail: hello@example.com
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
services:
  capacityProviderManager:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-capacity
      serviceName: treeseed-agent-manager
      imageRefEnv: TREESEED_AGENT_MANAGER_IMAGE_REF
      healthcheckPath: /healthz
      runtimeMode: service
`,
		);

		const services = configuredRailwayServices(tenantRoot, 'staging');
		const api = services.find((service) => service.key === 'capacityProviderManager');

		expect(api).toMatchObject({
			serviceName: 'treeseed-agent-manager',
			imageRef: 'treeseed/agent-manager:dev-staging-current',
		});
	});

	it('keeps provider runtime commands out of root Market Railway services', async () => {
		const tenantRoot = await createTenantFixture();
		const services = configuredRailwayServices(tenantRoot, 'staging');
		expect(services.map((service) => service.startCommand).filter(Boolean).join('\n')).not.toContain('npm run build &&');
		expect(services.map((service) => service.startCommand).filter(Boolean).join('\n')).not.toContain('provider/entrypoint.js');
	});

	it('does not require local source roots for image-backed Railway services', async () => {
		const tenantRoot = await createTenantFixture();
		await writeFile(
			join(tenantRoot, 'treeseed.site.yaml'),
			`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
services:
  api:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      imageRef: treeseed/api:dev-staging
  capacityProviderApi:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-agent-capacity-provider
      serviceName: treeseed-agent-api
      imageRef: treeseed/agent-api:dev-staging
`,
		);

		expect(() => validateRailwayServiceConfiguration(tenantRoot, 'staging')).not.toThrow();
	});

	it('lets Railway run service build commands from a clean upload in hosted CI', () => {
		expect(shouldRunRailwayPredeployBuild({ CI: 'true' })).toBe(false);
		expect(shouldRunRailwayPredeployBuild({ CI: 'true', TREESEED_RAILWAY_PREDEPLOY_BUILD: '1' })).toBe(true);
		expect(shouldRunRailwayPredeployBuild({ CI: 'true', TREESEED_RAILWAY_PREDEPLOY_BUILD: '0' })).toBe(false);
		expect(shouldRunRailwayPredeployBuild({})).toBe(true);
	});

	it('creates a missing worker-runner volume at the standard repository mount path', async () => {
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				return new Response(JSON.stringify({ data: { project: { volumes: { edges: [] } } } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('TreeseedRailwayVolumeUpdate')) {
				expect(body.variables).toMatchObject({
					volumeId: 'vol-1',
					input: { name: 'acme-docs-worker-runner-01-data' },
				});
				return new Response(JSON.stringify({
					data: {
						volumeUpdate: {
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
			}
			expect(body.variables.input).toMatchObject({
				projectId: 'project-1',
				environmentId: 'env-staging',
				serviceId: 'svc-runner-01',
				mountPath: '/data',
			});
			return new Response(JSON.stringify({
				data: {
					volumeCreate: {
						id: 'vol-1',
						name: 'generated-volume-name',
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
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
			settleAttempts: 1,
			settleDelayMs: 0,
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
				volumeId: 'vol-1',
				input: { mountPath: '/data' },
			});
			return new Response(JSON.stringify({
				data: {
					volumeInstanceUpdate: true,
				},
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-runner-01',
			name: 'acme-docs-worker-runner-01-data',
			mountPath: '/data',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
			settleAttempts: 1,
			settleDelayMs: 0,
		});

		expect(result.created).toBe(false);
		expect(result.updated).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('adopts an existing service volume before creating a second Railway volume', async () => {
		let listCount = 0;
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				listCount += 1;
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: [{
									node: {
										id: 'existing-volume',
										name: 'acme-docs-worker-runner-01-data',
										projectId: 'project-1',
										volumeInstances: {
											edges: [{
												node: {
													id: 'vi-existing',
													serviceId: 'svc-runner-01',
													environmentId: listCount === 1 ? 'env-production' : 'env-staging',
													mountPath: '/data',
													state: 'READY',
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
				volumeId: 'existing-volume',
				input: {
					serviceId: 'svc-runner-01',
					mountPath: '/data',
				},
			});
			return new Response(JSON.stringify({ data: { volumeInstanceUpdate: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-runner-01',
			name: 'acme-docs-worker-runner-01-data',
			mountPath: '/data',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
			settleAttempts: 1,
			settleDelayMs: 0,
		});

		expect(result.created).toBe(false);
		expect(result.updated).toBe(true);
		expect(result.volume.id).toBe('existing-volume');
		expect(fetchMock.mock.calls.some(([, init]) => String(init?.body ?? '').includes('TreeseedRailwayVolumeCreate'))).toBe(false);
	});

	it('reuses a Railway service volume that appears after a create conflict', async () => {
		let listCount = 0;
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				listCount += 1;
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: listCount === 1 ? [] : [{
									node: {
										id: 'existing-volume',
										name: 'postgres-staging-data',
										projectId: 'project-1',
										volumeInstances: {
											edges: [{
												node: {
													id: 'vi-existing',
													serviceId: 'svc-postgres',
													environmentId: 'env-staging',
													mountPath: '/var/lib/postgresql/data',
													state: 'READY',
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
			expect(String(body.query)).toContain('TreeseedRailwayVolumeCreate');
			return new Response(JSON.stringify({
				errors: [{
					message: 'Service svc-postgres would have 2 volumes attached after this patch (existing-volume, replacement-volume). A service can only have one volume.',
				}],
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		});

		const result = await ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-postgres',
			name: 'postgres-staging-data',
			mountPath: '/var/lib/postgresql/data',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result.created).toBe(false);
		expect(result.updated).toBe(false);
		expect(result.volume.id).toBe('existing-volume');
		expect(result.instance?.serviceId).toBe('svc-postgres');
	});

	it('reuses a Railway service volume that appears after a not authorized create response', async () => {
		let listCount = 0;
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				listCount += 1;
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: listCount === 1 ? [] : [{
									node: {
										id: 'railway-managed-postgres-volume',
										name: 'generated-postgres-volume',
										projectId: 'project-1',
										volumeInstances: {
											edges: [{
												node: {
													id: 'vi-postgres',
													serviceId: 'svc-postgres',
													environmentId: 'env-staging',
													mountPath: '/var/lib/postgresql/data',
													state: 'READY',
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
			if (String(body.query).includes('TreeseedRailwayVolumeCreate')) {
				return new Response(JSON.stringify({
					errors: [{ message: 'Not Authorized' }],
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('TreeseedRailwayVolumeUpdate')) {
				return new Response(JSON.stringify({
					data: {
						volumeUpdate: {
							id: 'railway-managed-postgres-volume',
							name: 'postgres-staging-data',
							projectId: 'project-1',
							volumeInstances: {
								edges: [{
									node: {
										id: 'vi-postgres',
										serviceId: 'svc-postgres',
										environmentId: 'env-staging',
										mountPath: '/var/lib/postgresql/data',
										state: 'READY',
									},
								}],
							},
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});

		const result = await ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-postgres',
			name: 'postgres-staging-data',
			mountPath: '/var/lib/postgresql/data',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result.created).toBe(false);
		expect(result.updated).toBe(true);
		expect(result.volume.id).toBe('railway-managed-postgres-volume');
		expect(result.volume.name).toBe('postgres-staging-data');
		expect(result.instance?.serviceId).toBe('svc-postgres');
	});

	it('creates a service-specific volume instead of adopting an unrelated environment volume', async () => {
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: [{
									node: {
										id: 'existing-env-volume',
										name: 'legacy-data',
										projectId: 'project-1',
										volumeInstances: {
											edges: [{
												node: {
													id: 'vi-existing',
													environmentId: 'env-staging',
													mountPath: '/data',
													state: 'READY',
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
			if (String(body.query).includes('TreeseedRailwayVolumeCreate')) {
				expect(body.variables.input).toMatchObject({
					projectId: 'project-1',
					environmentId: 'env-staging',
					serviceId: 'svc-treedx',
					mountPath: '/data',
				});
				return new Response(JSON.stringify({
					data: {
						volumeCreate: {
							id: 'service-volume',
							name: 'public-treedx-node-01-volume',
							projectId: 'project-1',
							volumeInstances: {
								edges: [{
									node: {
										id: 'vi-service',
										serviceId: 'svc-treedx',
										environmentId: 'env-staging',
										mountPath: '/data',
										state: 'READY',
									},
								}],
							},
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway API call: ${body.query}`);
		});

		const result = await ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-treedx',
			name: 'public-treedx-node-01-volume',
			mountPath: '/data',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
			settleAttempts: 1,
			settleDelayMs: 0,
		});

		expect(result.created).toBe(true);
		expect(result.volume.id).toBe('service-volume');
		expect(result.instance?.serviceId).toBe('svc-treedx');
	});

	it('recreates a named volume when Railway reports the listed volume as missing', async () => {
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('TreeseedRailwayVolumeList')) {
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: [{
									node: {
										id: 'stale-volume',
										name: 'acme-docs-worker-runner-01-data',
										projectId: 'project-1',
										volumeInstances: {
											edges: [{
												node: {
													id: 'vi-stale',
													serviceId: 'old-service',
													environmentId: 'env-staging',
													mountPath: '/old-data',
													state: 'READY',
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
			if (String(body.query).includes('TreeseedRailwayVolumeInstanceUpdate')) {
				return new Response(JSON.stringify({
					errors: [{ message: 'Volume stale-volume not found.' }],
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			expect(String(body.query)).toContain('TreeseedRailwayVolumeCreate');
			expect(body.variables.input).toMatchObject({
				projectId: 'project-1',
				environmentId: 'env-staging',
				serviceId: 'svc-runner-01',
				mountPath: '/data',
			});
			return new Response(JSON.stringify({
				data: {
					volumeCreate: {
						id: 'replacement-volume',
						name: 'acme-docs-worker-runner-01-data',
						projectId: 'project-1',
						volumeInstances: {
							edges: [{
								node: {
									id: 'vi-replacement',
									serviceId: 'svc-runner-01',
									environmentId: 'env-staging',
									mountPath: '/data',
									state: 'READY',
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
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result.created).toBe(true);
		expect(result.updated).toBe(true);
		expect(result.volume.id).toBe('replacement-volume');
		expect(result.instance?.serviceId).toBe('svc-runner-01');
	});

	it('does not create schedules for deleted root Market processing roles', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', 'railway-token');
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
					startCommand: 'node ./packages/agent/dist/provider/entrypoint.js manager',
					cronSchedule: '0 9 * * 1-5',
				});
				return new Response(JSON.stringify({ data: { serviceInstanceUpdate: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});

		const result = await ensureRailwayScheduledJobs(tenantRoot, 'prod', { fetchImpl: fetchMock as typeof fetch });

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result).toEqual([]);
	});

	it('verifies no Railway schedules for deleted root Market processing roles', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('TREESEED_RAILWAY_API_TOKEN', 'railway-token');
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
						startCommand: 'node ./packages/agent/dist/provider/entrypoint.js runner',
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
		expect(ensured).toEqual([]);

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
						startCommand: 'node ./packages/agent/dist/provider/entrypoint.js manager',
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
		expect(verified.checks).toEqual([]);
	});

	it('verifies only the managed API Railway service', async () => {
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
							startCommand: serviceId === 'svc-manager' ? 'node ./packages/agent/dist/provider/entrypoint.js manager' : null,
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
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result.ok).toBe(true);
		expect(result.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({ type: 'service-instance', service: 'api', ok: true }),
		]));
		expect(result.checks.some((check) => check.service === 'workdayManager' || check.service === 'workerRunner')).toBe(false);
		expect(result.checks.some((check) => check.type === 'worker-runner-volume' || check.type === 'schedule')).toBe(false);
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
										status: 'BUILDING',
										deploymentStopped: false,
										instances: [{ status: 'CREATED' }],
										meta: {},
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
				service: 'api',
				ok: false,
				status: 'BUILDING',
			}),
		]));

		for (const edge of statusPayload.environments.edges[0].node.serviceInstances.edges) {
			if (edge.node.serviceName.endsWith('-api')) {
				edge.node.latestDeployment.status = 'SUCCESS';
				edge.node.latestDeployment.instances = [{ status: 'RUNNING' }];
			}
		}
		const settled = collectRailwayDeploymentStatusChecks(statusPayload, 'staging', services);
		expect(settled.every((entry) => entry.ok)).toBe(true);
		expect(settled).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: 'deployment-status',
				service: 'api',
				ok: true,
			}),
		]));
	});

	it('fast-skips Railway deployment settle when no active deployment is present', async () => {
		const tenantRoot = await createTenantFixture();
		const services = configuredRailwayServices(tenantRoot, 'staging');
		const progress: string[] = [];
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			data: {
				project: {
					id: 'railway-project-1',
					environments: {
						edges: [{
							node: {
								name: 'staging',
								serviceInstances: {
									edges: services.map((service) => ({
										node: {
											id: `instance-${service.key}`,
											serviceId: `svc-${service.key}`,
											serviceName: service.serviceName,
											latestDeployment: null,
										},
									})),
								},
							},
						}],
					},
				},
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await waitForRailwayManagedDeploymentsSettled(tenantRoot, 'staging', {
			services: services.map((service) => ({ ...service, projectId: 'railway-project-1' })),
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
			pollMs: 0,
			onProgress(line) {
				progress.push(line);
			},
		});

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result.settle).toMatchObject({ pollCount: 1, status: 'skipped' });
		expect(result.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({
				type: 'deployment-status',
				service: 'api',
				ok: true,
				skipped: true,
				status: 'no_active_deployment',
				settle: expect.objectContaining({ pollCount: 1, fastSkipped: true }),
			}),
		]));
		expect(progress[0]).toMatch(/poll=1 elapsed=/u);
	});

	it('reports Railway settle timeout diagnostics with poll metadata', async () => {
		const tenantRoot = await createTenantFixture();
		const services = configuredRailwayServices(tenantRoot, 'staging');
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			data: {
				project: {
					id: 'railway-project-1',
					environments: {
						edges: [{
							node: {
								name: 'staging',
								serviceInstances: {
									edges: services.map((service) => ({
										node: {
											id: `instance-${service.key}`,
											serviceId: `svc-${service.key}`,
											serviceName: service.serviceName,
											latestDeployment: {
												id: 'deploy-1',
												status: 'BUILDING',
												createdAt: '2026-06-02T00:00:00.000Z',
												deploymentStopped: false,
												instances: [{ status: 'CREATED' }],
												meta: {},
											},
										},
									})),
								},
							},
						}],
					},
				},
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const result = await waitForRailwayManagedDeploymentsSettled(tenantRoot, 'staging', {
			services: services.map((service) => ({ ...service, projectId: 'railway-project-1' })),
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
			timeoutMs: 0,
			pollMs: 0,
		});

		expect(result.ok).toBe(false);
		expect(result.settle).toMatchObject({ pollCount: 1, status: 'timeout' });
		expect(result.checks).toEqual(expect.arrayContaining([
			expect.objectContaining({
				service: 'api',
				status: 'BUILDING',
				observed: expect.objectContaining({ deploymentId: 'deploy-1' }),
				settle: expect.objectContaining({ pollCount: 1, timeout: true }),
			}),
		]));
	});

	it('accepts Railway deploy prerequisites and schedule sync from explicit env overrides', async () => {
		const tenantRoot = await createTenantFixture();
		vi.stubEnv('TREESEED_RAILWAY_ENVIRONMENT_ID', 'env-production');

		expect(() =>
			validateRailwayDeployPrerequisites(tenantRoot, 'prod', {
				env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
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
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(fetchMock).not.toHaveBeenCalled();
		expect(result).toEqual([]);
	});

	it('uses TREESEED_RAILWAY_API_TOKEN as the Treeseed-owned Railway API auth source', async () => {
		expect(resolveRailwayAuthToken({
			TREESEED_RAILWAY_API_TOKEN: 'railway-api-token',
		})).toBe('railway-api-token');
		expect(resolveRailwayAuthToken({ RAILWAY_TOKEN: 'railway-cli-token' })).toBe('');
		expect(resolveRailwayAuthToken({})).toBe('');
		expect(buildRailwayCommandEnv({ TREESEED_RAILWAY_API_TOKEN: 'railway-api-token' })).toMatchObject({
			TREESEED_RAILWAY_API_TOKEN: 'railway-api-token',
		});
		expect(buildRailwayCommandEnv({ TREESEED_RAILWAY_API_TOKEN: 'railway-api-token' }).RAILWAY_TOKEN).toBeUndefined();
		expect(buildRailwayCommandEnv({
			TREESEED_RAILWAY_API_TOKEN: 'railway-api-token',
			RAILWAY_TOKEN: 'railway-project-token',
		})).toMatchObject({
			TREESEED_RAILWAY_API_TOKEN: 'railway-api-token',
			RAILWAY_TOKEN: 'railway-project-token',
		});
	});

});
