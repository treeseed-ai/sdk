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
});
