import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/operations/services/railway-cli.ts', () => ({
	runRailwayCliJson: vi.fn(async () => ({ id: 'deployment-test' })),
	connectRailwayServiceSourceWithCli: vi.fn(async () => ({})),
}));

import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../../../src/operations/services/railway-cli.ts';

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
	deployRailwayService,
	ensureRailwayScheduledJobs,
	findStaleTreeseedOperationsRunnerResources,
	obsoleteUnqualifiedRailwayResourceNames,
	railwayObsoleteAliasCleanupPolicy,
	railwayServiceRuntimeStartCommand,
	resolveRailwayAuthToken,
	shouldRunRailwayPredeployBuild,
	validateRailwayServiceConfiguration,
	validateRailwayDeployPrerequisites,
	waitForRailwayManagedDeploymentsSettled,
	verifyRailwayManagedResources,
	verifyRailwayScheduledJobs,
} from '../../../src/operations/services/railway-deploy.ts';

import {
	ensureRailwayServiceVolume,
	listRailwayVolumes,
} from '../../../src/operations/services/railway-api.ts';

const tempRoots = new Set<string>();

function railwayIacMutationResponse(body: { query?: unknown }) {
	const query = String(body.query ?? '');
	if (query.includes('IacStageEnvironmentChanges')) {
		return new Response(JSON.stringify({ data: { environmentStageChanges: { id: 'patch-1' } } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	}
	if (query.includes('IacCommitStagedPatch')) {
		return new Response(JSON.stringify({ data: { environmentPatchCommitStaged: true } }), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	}
	return null;
}

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
it('resolves Railway deployment settle project ids from configured project names', async () => {
		const tenantRoot = await createTenantFixture();
		const services = configuredRailwayServices(tenantRoot, 'prod').map((service) => ({
			...service,
			projectId: null,
		}));
		const fetchMock = vi.fn(async (_url, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			const query = String(body.query ?? '');
			if (query.includes('TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (query.includes('TreeseedRailwayProjects')) {
				return new Response(JSON.stringify(railwayProjectsPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (query.includes('TreeseedRailwayDeploymentStatus')) {
				expect(body.variables.projectId).toBe('railway-project-1');
				return new Response(JSON.stringify({
					data: {
						project: {
							id: 'railway-project-1',
							environments: {
								edges: [{
									node: {
										name: 'production',
										serviceInstances: {
											edges: services.map((service) => ({
												node: {
													id: `instance-${service.key}`,
													serviceId: `svc-${service.key}`,
													serviceName: service.serviceName,
													latestDeployment: {
														status: 'SUCCESS',
														deploymentStopped: false,
														instances: [{ status: 'RUNNING' }],
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
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway GraphQL query: ${query}`);
		});

		const result = await waitForRailwayManagedDeploymentsSettled(tenantRoot, 'prod', {
			services,
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop',
			},
			fetchImpl: fetchMock as typeof fetch,
			pollMs: 0,
		});

		expect(result.ok).toBe(true);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		expect(result.settle).toMatchObject({ pollCount: 1, status: 'settled' });
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
});
