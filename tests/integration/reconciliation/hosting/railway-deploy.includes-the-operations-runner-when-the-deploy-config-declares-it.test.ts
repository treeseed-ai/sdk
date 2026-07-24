import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/operations/services/hosting/railway/railway-cli.ts', () => ({
	runRailwayCliJson: vi.fn(async () => ({ id: 'deployment-test' })),
	connectRailwayServiceSourceWithCli: vi.fn(async () => ({})),
}));

import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../../../../src/operations/services/hosting/railway/railway-cli.ts';

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
} from '../../../../src/operations/services/hosting/railway/railway-deploy.ts';

import {
	ensureRailwayServiceVolume,
	listRailwayVolumes,
} from '../../../../src/operations/services/hosting/railway/railway-api.ts';

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
			'treeseed-api-operations-runner-staging-01',
		]);
		expect(runners[0]).toMatchObject({
			instanceKey: 'operationsRunner:1',
			runnerId: 'treeseed-api-operations-runner-staging-01',
			sourceMode: 'git',
			imageRef: null,
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

		expect(findStaleOperationsRunnerResources([
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
		expect(findStaleOperationsRunnerResources([
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
			'treeseed-api-operations-runner-staging-01',
			'treeseed-api-operations-runner-staging-02',
			'treeseed-api-operations-runner-staging-03',
		]);
		expect(runners.map((service) => service.instanceKey)).toEqual([
			'operationsRunner:1',
			'operationsRunner:2',
			'operationsRunner:3',
		]);
		expect(runners.every((service) => service.runnerPool?.maxRunners === 4)).toBe(true);
		expect(runners.every((service) => service.volumeMountPath === '/data')).toBe(true);
	});
});
