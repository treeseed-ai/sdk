import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../../src/operations/services/hosting/railway/railway-cli.ts', () => ({
	runRailwayCliJson: vi.fn(async () => ({ id: 'deployment-test' })),
	connectRailwayServiceSourceWithCli: vi.fn(async () => ({})),
}));

import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../../../../../src/operations/services/hosting/railway/railway-cli.ts';

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
	findStaleOperationsRunnerResources,
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
} from '../../../../../src/operations/services/hosting/railway/railway-deploy.ts';

import {
	ensureRailwayServiceVolume,
	listRailwayVolumes,
} from '../../../../../src/operations/services/hosting/railway/railway-api.ts';

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
it('verifies live Railway volumes for operations and capacity provider runners', async () => {
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
services:
  api:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
  operationsRunner:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api-operations-runner-01
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
        volumeMountPath: /data
  capacityProviderManager:
    provider: railway
    enabled: true
    rootDir: packages/agent
    railway:
      projectName: treeseed-api
      serviceName: treeseed-agent-manager
  capacityProviderRunner:
    provider: railway
    enabled: true
    rootDir: packages/agent
    railway:
      projectName: treeseed-api
      serviceName: treeseed-agent-runner-01
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
        volumeMountPath: /data
`,
		);
		const serviceIds: Record<string, string> = {
			'treeseed-api-staging': 'svc-api',
			'treeseed-api-operations-runner-staging-01': 'svc-operations-runner',
			'treeseed-agent-manager': 'svc-agent-manager',
			'treeseed-agent-runner-01': 'svc-agent-runner',
		};
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query).includes('query TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayProjects')) {
				return new Response(JSON.stringify({
					data: {
						projects: {
							edges: [{
								node: {
									id: 'railway-project-1',
									name: 'treeseed-api',
									workspaceId: 'workspace-1',
									environments: {
										edges: [{ node: { id: 'env-staging', name: 'staging' } }],
									},
									services: {
										edges: Object.entries(serviceIds).map(([name, id]) => ({ node: { id, name } })),
									},
								},
							}],
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (String(body.query).includes('query TreeseedRailwayServiceInstance')) {
				const serviceId = body.variables.serviceId;
				return new Response(JSON.stringify({
					data: {
						serviceInstance: {
							id: `instance-${serviceId}`,
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
			if (String(body.query).includes('query TreeseedRailwayVolumeList')) {
				return new Response(JSON.stringify({
					data: {
						project: {
							volumes: {
								edges: [
									{
										node: {
											id: 'vol-operations-runner',
											name: 'treeseed-api-operations-runner-staging-01-volume',
											projectId: 'railway-project-1',
											volumeInstances: {
												edges: [{
													node: {
														id: 'vi-operations-runner',
													serviceId: serviceIds['treeseed-api-operations-runner-staging-01'],
														environmentId: 'env-staging',
														mountPath: '/data',
														state: 'ATTACHED',
													},
												}],
											},
										},
									},
									{
										node: {
											id: 'vol-agent-runner',
											name: 'treeseed-agent-runner-01-volume',
											projectId: 'railway-project-1',
											volumeInstances: {
												edges: [{
													node: {
														id: 'vi-agent-runner',
														serviceId: serviceIds['treeseed-agent-runner-01'],
														environmentId: 'env-staging',
														mountPath: '/data',
														state: 'ATTACHED',
													},
												}],
											},
										},
									},
								],
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
			expect.objectContaining({
				type: 'service-volume',
				service: 'operationsRunner',
				volumeName: 'treeseed-api-operations-runner-staging-01-volume',
				mountPath: '/data',
				ok: true,
			}),
			expect.objectContaining({
				type: 'service-volume',
				service: 'capacityProviderRunner',
				volumeName: 'treeseed-agent-runner-01-volume',
				mountPath: '/data',
				ok: true,
			}),
		]));
	});
});
