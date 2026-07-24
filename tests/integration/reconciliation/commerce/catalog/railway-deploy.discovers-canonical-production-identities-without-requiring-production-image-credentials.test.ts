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
it('discovers canonical production identities without requiring production image credentials', async () => {
		const tenantRoot = await createTenantFixture();
		await writeFile(
			join(tenantRoot, 'treeseed.site.yaml'),
			`name: Test API
slug: treeseed-api
siteUrl: https://api.example.com
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
      imageRefEnv: TREESEED_API_IMAGE_REF
  operationsRunner:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api-operations-runner-01
      imageRefEnv: TREESEED_OPERATIONS_RUNNER_IMAGE_REF
`,
		);

		const services = configuredRailwayServices(tenantRoot, 'prod', {}, { identityOnly: true });

		expect(services.map((service) => service.serviceName)).toEqual(expect.arrayContaining([
			'treeseed-api-production',
			'treeseed-api-operations-runner-production-01',
			'treeseed-treedx-production-01',
		]));
	});

it('keeps provider runtime commands out of root Market Railway services', async () => {
		const tenantRoot = await createTenantFixture();
		const services = configuredRailwayServices(tenantRoot, 'staging');
		expect(services.map((service) => service.startCommand).filter(Boolean).join('\n')).not.toContain('npm run build &&');
		expect(services.map((service) => service.startCommand).filter(Boolean).join('\n')).not.toContain('provider/entrypoint.js');
	});

it('rejects image-backed staging API services without source metadata', async () => {
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
      imageRef: treeseed/api:1.2.3
  capacityProviderApi:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-agent-capacity-provider
      serviceName: treeseed-agent-api
      imageRef: treeseed/agent-api:1.2.3
`,
		);

		expect(() => validateRailwayServiceConfiguration(tenantRoot, 'staging')).toThrow(/API Railway staging services must use GitHub Dockerfile source builds/u);
	});

it('does not require an agent checkout for image-backed capacity provider services', async () => {
		const tenantRoot = await createTenantFixture();
		await writeFile(
			join(tenantRoot, 'treeseed.site.yaml'),
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
      projectName: treeseed-agent-capacity-provider
      serviceName: treeseed-agent-manager
      imageRef: treeseed/agent-manager:1.2.3
      runtimeMode: service
  capacityProviderRunner:
    provider: railway
    enabled: true
    railway:
      projectName: treeseed-agent-capacity-provider
      serviceName: treeseed-agent-runner-01
      imageRef: treeseed/agent-runner:1.2.3
      runtimeMode: service
      volumeMountPath: /data
`,
		);

		expect(() => validateRailwayServiceConfiguration(tenantRoot, 'staging')).not.toThrow();
	});
});
