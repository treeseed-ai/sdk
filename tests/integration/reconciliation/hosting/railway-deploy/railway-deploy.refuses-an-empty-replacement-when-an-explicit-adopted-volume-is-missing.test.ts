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
it('refuses an empty replacement when an explicit adopted volume is missing', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			data: { project: { volumes: { edges: [] } } },
		}), { status: 200, headers: { 'content-type': 'application/json' } }));

		await expect(ensureRailwayServiceVolume({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-runner-staging-01',
			name: 'treeseed-api-operations-runner-staging-01-volume',
			mountPath: '/data',
			adoptVolumeId: 'legacy-volume-id',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		})).rejects.toThrow(/refusing to create an empty replacement volume/u);
		expect(fetchMock.mock.calls.some(([, init]) => String(init?.body ?? '').includes('TreeseedRailwayVolumeCreate'))).toBe(false);
	});

it('deduplicates Railway volume aliases and preserves pending deletion state', async () => {
		const instance = {
			id: 'instance-staging',
			serviceId: 'service-staging',
			environmentId: 'env-staging',
			mountPath: '/data',
			state: 'READY',
		};
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({
			data: {
				project: {
					volumes: { edges: [{ node: {
						id: 'volume-staging',
						name: 'service-staging-volume',
						instances: [instance],
						volumeInstances: { edges: [{ node: { ...instance, deletedAt: '2026-07-16T00:00:00.000Z' } }] },
					} }] },
				},
			},
		}), { status: 200, headers: { 'content-type': 'application/json' } }));

		const volumes = await listRailwayVolumes({
			projectId: 'project-1',
			env: { TREESEED_RAILWAY_API_TOKEN: 'railway-token' },
			fetchImpl: fetchMock as typeof fetch,
		});
		expect(volumes).toHaveLength(1);
		expect(volumes[0]?.instances).toEqual([expect.objectContaining({
			id: 'instance-staging',
			deletedAt: '2026-07-16T00:00:00.000Z',
		})]);
	});

it('reuses a Railway service volume that appears after a create conflict', async () => {
		let listCount = 0;
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			const iacResponse = railwayIacMutationResponse(body);
			if (iacResponse) return iacResponse;
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

		expect(result.created).toBe(true);
		expect(result.updated).toBe(false);
		expect(result.volume.id).toBe('existing-volume');
		expect(result.instance?.serviceId).toBe('svc-postgres');
	});
});
