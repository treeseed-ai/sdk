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
it('recognizes only obsolete unsuffixed source-divergent API identities', () => {
		const aliases = obsoleteUnqualifiedRailwayResourceNames([
			{ key: 'api', serviceName: 'treeseed-api-staging', volumeMountPath: null },
			{ key: 'operationsRunner', serviceName: 'treeseed-api-operations-runner-staging-01', volumeMountPath: '/data' },
			{ key: 'public-treedx-node-01', serviceName: 'public-treedx-node-staging-01', volumeMountPath: '/data' },
			{ key: 'postgres', serviceName: 'treeseed-api-postgres', volumeMountPath: '/var/lib/postgresql/data' },
		] as ReturnType<typeof configuredRailwayServices>);

		expect(aliases).toEqual([
			'treeseed-api',
			'treeseed-api-operations-runner-01',
			'treeseed-api-operations-runner-01-volume',
			'public-treedx-node-01',
			'public-treedx-node-01-volume',
		]);
		expect(aliases).not.toContain('treeseed-api-postgres-production');
		expect(obsoleteUnqualifiedRailwayResourceNames([
			{ key: 'operationsRunner', serviceName: 'treeseed-ops-production-02', railwayEnvironment: 'production', volumeMountPath: '/data' },
			{ key: 'public-treedx-node-02', serviceName: 'treeseed-treedx-production-02', railwayEnvironment: 'production', volumeMountPath: '/data' },
		] as ReturnType<typeof configuredRailwayServices>)).toEqual(expect.arrayContaining([
			'treeseed-api-operations-runner-02',
			'treeseed-api-operations-runner-production-02',
			'treeseed-api-operations-runner-production-02-volume',
			'public-treedx-node-02',
			'public-treedx-node-production-02',
			'public-treedx-node-production-02-volume',
		]));
		expect(railwayObsoleteAliasCleanupPolicy('staging', [
			{ key: 'api', serviceName: 'treeseed-api-staging', volumeMountPath: null },
		] as ReturnType<typeof configuredRailwayServices>)).toEqual({
			retainedResourceNames: ['treeseed-api'],
			allowedResourceDeletions: [],
		});
		expect(railwayObsoleteAliasCleanupPolicy('prod', [
			{ key: 'api', serviceName: 'treeseed-api-production', volumeMountPath: null },
		] as ReturnType<typeof configuredRailwayServices>)).toEqual({
			retainedResourceNames: ['treeseed-api'],
			allowedResourceDeletions: [],
		});
		expect(railwayObsoleteAliasCleanupPolicy('prod', [
			{ key: 'api', serviceName: 'treeseed-api-production', volumeMountPath: null },
		] as ReturnType<typeof configuredRailwayServices>, [
			'treeseed-api-production',
			'treeseed-api',
		], [
			'treeseed-api-production',
		])).toEqual({
			retainedResourceNames: [],
			allowedResourceDeletions: ['treeseed-api'],
		});
		expect(railwayObsoleteAliasCleanupPolicy('prod', [
			{ key: 'api', serviceName: 'treeseed-api-production', volumeMountPath: null },
		] as ReturnType<typeof configuredRailwayServices>, [
			'treeseed-api-staging',
			'treeseed-api-production',
			'treeseed-api',
		], [
			'treeseed-api-staging',
			'treeseed-api-production',
			'treeseed-api',
		])).toEqual({
			retainedResourceNames: [],
			allowedResourceDeletions: ['treeseed-api'],
		});
	});

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
});
