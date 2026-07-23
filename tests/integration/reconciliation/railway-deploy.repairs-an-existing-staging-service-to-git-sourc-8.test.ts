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
it('repairs an existing staging service to Git source before deploying it', async () => {
		const tenantRoot = await createTenantFixture();
		const service = {
			key: 'api',
			scope: 'staging',
			projectId: 'project-1',
			projectName: 'treeseed-api',
			serviceId: 'svc-api',
			serviceName: 'treeseed-api',
			environmentId: 'env-staging',
			railwayEnvironment: 'staging',
			rootDir: tenantRoot,
			sourceMode: 'git',
			sourceRepo: 'treeseed-ai/api',
			sourceBranch: 'staging',
			sourceRootDirectory: '.',
			imageRef: null,
			buildCommand: null,
			startCommand: null,
			healthcheckPath: '/healthz',
			healthcheckTimeoutSeconds: 30,
			healthcheckIntervalSeconds: null,
			restartPolicy: null,
			runtimeMode: 'service',
			publicBaseUrl: 'https://api.preview.treeseed.dev',
		};
		const stagedPatches: Array<Record<string, unknown>> = [];
		const railwayVariables: Record<string, string> = {};
		const fetchMock = vi.fn(async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}'));
			if (String(body.query ?? '').includes('IacStageEnvironmentChanges')) {
				const patch = body.variables?.payload as Record<string, unknown>;
				stagedPatches.push(patch);
				const servicePatch = (patch.services as Record<string, { variables?: Record<string, { value?: string }> }> | undefined)?.['svc-api'];
				for (const [key, entry] of Object.entries(servicePatch?.variables ?? {})) {
					if (typeof entry.value === 'string') railwayVariables[key] = entry.value;
				}
			}
			const iacResponse = railwayIacMutationResponse(body);
			if (iacResponse) return iacResponse;
			const query = String(body.query ?? '');
			if (query.includes('TreeseedRailwayAuthProfile')) {
				return new Response(JSON.stringify(railwayTopologyPayload()), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (query.includes('TreeseedRailwayProjects')) {
				return new Response(JSON.stringify({
					data: {
						projects: {
							edges: [{
								node: {
									id: 'project-1',
									name: 'treeseed-api',
									workspaceId: 'workspace-1',
									deletedAt: null,
									environments: { edges: [{ node: { id: 'env-staging', name: 'staging' } }] },
									services: { edges: [{ node: { id: 'svc-api', name: 'treeseed-api' } }] },
								},
							}],
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (query.includes('TreeseedRailwayProjectServices')) {
				return new Response(JSON.stringify({
					data: {
						project: {
							id: 'project-1',
							services: { edges: [{ node: { id: 'svc-api', name: 'treeseed-api' } }] },
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (query.includes('TreeseedRailwayServiceInstance')) {
				return new Response(JSON.stringify({
					data: {
						serviceInstance: {
							id: 'instance-api',
							buildCommand: null,
							dockerfilePath: null,
							railwayConfigFile: null,
							startCommand: null,
							cronSchedule: null,
							rootDirectory: '.',
							healthcheckPath: '/healthz',
							healthcheckTimeout: 30,
							sleepApplication: false,
						},
					},
				}), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (query.includes('TreeseedRailwayVariableCollectionUpsert')) {
				Object.assign(railwayVariables, body.variables.input.variables);
				return new Response(JSON.stringify({ data: { variableCollectionUpsert: true } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			if (query.includes('TreeseedRailwayVariables')) {
				return new Response(JSON.stringify({ data: { variables: railwayVariables } }), { status: 200, headers: { 'content-type': 'application/json' } });
			}
			throw new Error(`Unexpected Railway query: ${body.query}`);
		});
		const result = await deployRailwayService(tenantRoot, service, {
			env: {
				CI: 'true',
				TREESEED_RAILWAY_API_TOKEN: 'railway-token',
				TREESEED_RAILWAY_WORKSPACE: 'workspace-1',
				TREESEED_PLATFORM_RUNNER_SECRET: 'runner-secret-for-test',
				TREESEED_CREDENTIAL_SESSION_SECRET: 'credential-secret-for-test',
				TREESEED_WEB_SERVICE_SECRET: 'web-service-secret-for-test',
			},
			fetchImpl: fetchMock as typeof fetch,
		});

		expect(result.status).toBe('deployed');
		expect(connectRailwayServiceSourceWithCli).toHaveBeenCalledWith(expect.objectContaining({
			projectId: 'project-1',
			environmentId: 'env-staging',
			serviceId: 'svc-api',
			repo: 'treeseed-ai/api',
			branch: 'staging',
		}));
		expect(railwayVariables).toMatchObject({
			TREESEED_DEPLOY_SOURCE_MODE: 'git',
			TREESEED_DEPLOY_SOURCE_REPOSITORY: 'treeseed-ai/api',
			TREESEED_DEPLOY_SOURCE_BRANCH: 'staging',
			TREESEED_PLATFORM_RUNNER_SECRET: 'runner-secret-for-test',
			TREESEED_CREDENTIAL_SESSION_SECRET: 'credential-secret-for-test',
			TREESEED_WEB_SERVICE_SECRET: 'web-service-secret-for-test',
		});
		expect(runRailwayCliJson).toHaveBeenCalledWith(expect.objectContaining({
			args: expect.arrayContaining(['service', 'redeploy', '--project', 'project-1', '--environment', 'env-staging', '--service', 'svc-api']),
		}));
	});

it('lets Railway run service build commands from a clean upload in hosted CI', () => {
		expect(shouldRunRailwayPredeployBuild({ CI: 'true' })).toBe(false);
		expect(shouldRunRailwayPredeployBuild({ CI: 'true', TREESEED_RAILWAY_PREDEPLOY_BUILD: '1' })).toBe(true);
		expect(shouldRunRailwayPredeployBuild({ CI: 'true', TREESEED_RAILWAY_PREDEPLOY_BUILD: '0' })).toBe(false);
		expect(shouldRunRailwayPredeployBuild({})).toBe(true);
	});
});
