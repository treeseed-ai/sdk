import { execFileSync } from 'node:child_process';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	compileTreeseedHostingGraph,
	createDefaultHostAdapters,
	createDefaultServiceTypeAdapters,
	discoverTreeseedApplications,
	planTreeseedHostingGraph,
	serializeHostingPlan,
	type TreeseedApplicationHostingProfile,
	type TreeseedHostAdapter,
} from '../../../src/hosting/index.ts';

function createTenant(configBody: string) {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-hosting-'));
	mkdirSync(resolve(tenantRoot, 'src'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'src', 'manifest.yaml'), 'id: test\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n');
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), configBody);
	return tenantRoot;
}

function createSplitWorkspace() {
	const tenantRoot = mkdtempSync(join(tmpdir(), 'treeseed-hosting-split-'));
	mkdirSync(resolve(tenantRoot, 'packages', 'api'), { recursive: true });
	mkdirSync(resolve(tenantRoot, 'packages', 'treedx'), { recursive: true });
	mkdirSync(resolve(tenantRoot, 'packages', 'ui', 'sandbox'), { recursive: true });
	writeFileSync(resolve(tenantRoot, 'package.json'), JSON.stringify({
		name: '@treeseed/market',
		type: 'module',
		workspaces: ['packages/*'],
	}, null, 2));
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.dev
contactEmail: hello@treeseed.email
hosting:
  kind: self_hosted_project
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
connections:
  api:
    proxyPrefix: /v1
    localBaseUrl: http://127.0.0.1:3000
    environments:
      staging:
        baseUrl: https://api-staging.example.test
      prod:
        baseUrl: https://api.example.test
`);
	writeFileSync(resolve(tenantRoot, 'packages', 'api', 'package.json'), JSON.stringify({
		name: '@treeseed/api',
		type: 'module',
	}, null, 2));
	writeFileSync(resolve(tenantRoot, 'packages', 'treedx', 'treeseed.package.yaml'), `id: treedx
repository: treeseed-ai/treedx
`);
	writeFileSync(resolve(tenantRoot, 'packages', 'ui', 'package.json'), JSON.stringify({
		name: '@treeseed/ui',
		type: 'module',
	}, null, 2));
writeFileSync(resolve(tenantRoot, 'packages', 'ui', 'treeseed.site.yaml'), `name: TreeSeed UI Sandbox
slug: treeseed-ui
siteUrl: https://ui.treeseed.ai
contactEmail: hello@treeseed.email
hosting:
  kind: self_hosted_project
  projectId: ui
cloudflare:
  workerName: treeseed-ui
  pages:
    projectName: treeseed-ui
    productionBranch: main
    stagingBranch: staging
    buildOutputDir: sandbox/dist
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: sandbox
    environments:
      staging:
        domain: ui-staging.treeseed.ai
      prod:
        domain: ui.treeseed.ai
`);
	writeFileSync(resolve(tenantRoot, 'packages', 'api', 'treeseed.site.yaml'), `name: TreeSeed API
slug: treeseed-api
siteUrl: https://api.treeseed.dev
contactEmail: hello@treeseed.email
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
surfaces:
  api:
    enabled: true
    provider: railway
    rootDir: .
services:
  api:
    enabled: true
    provider: railway
    rootDir: .
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: .
      buildCommand: npm run build
      startCommand: npm run start:api
      healthcheckPath: /healthz
  operationsRunner:
    enabled: true
    provider: railway
    rootDir: .
    railway:
      projectName: treeseed-api
      serviceName: treeseed-ops-01
      rootDir: .
      buildCommand: npm run build
      startCommand: npm run start:runner
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      serviceTargets:
        - api
        - operationsRunner
`);
	return tenantRoot;
}

function createGitCommit(root: string) {
	writeFileSync(resolve(root, 'README.md'), 'fixture\n');
	execFileSync('git', ['init', '-b', 'staging'], { cwd: root, stdio: 'ignore' });
	execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
	execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'fixture'], { cwd: root, stdio: 'ignore' });
	return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function marketConfig(extra = '') {
	return `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.dev
contactEmail: hello@treeseed.email
hosting:
  kind: treeseed_control_plane
  teamId: treeseed
  projectId: market
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
cloudflare:
  accountId: account-123
  r2:
    manifestKeyTemplate: teams/{teamId}/published/common.json
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
    localBaseUrl: http://127.0.0.1:4321
    environments:
      staging:
        domain: treeseed-market-staging.example.test
      prod:
        domain: treeseed.dev
services:
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      resourceType: postgres
      serviceName: treeseed-api-postgres
      environmentVariable: TREESEED_DATABASE_URL
      serviceTargets:
        - api
        - operationsRunner
  api:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:api
      healthcheckPath: /healthz
  operationsRunner:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-ops-01
      rootDir: packages/api
      buildCommand: npm run build
      startCommand: npm run start:runner
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
smtp:
  enabled: true
${extra}`;
}
describe('hosting graph', () => {
it('keeps public TreeDX in the API-owned Railway project while isolating staging and production by environment', () => {
		const tenantRoot = createTenant(marketConfig());
		const staging = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging' });
		const prod = compileTreeseedHostingGraph({
			tenantRoot,
			environment: 'prod',
			env: {
				TREESEED_API_IMAGE_REF: 'treeseed/api:0.2.11',
				TREESEED_OPERATIONS_RUNNER_IMAGE_REF: 'treeseed/op-runner:0.2.11',
				TREESEED_PUBLIC_TREEDX_IMAGE_REF: 'treeseed/treedx:0.2.11',
			},
		});

		const stagingGroup = staging.projectGroups['public-treedx-federation'];
		const prodGroup = prod.projectGroups['public-treedx-federation'];
		expect(stagingGroup.environments.staging?.projectName).toBe('treeseed-api');
		expect(prodGroup.environments.prod?.projectName).toBe('treeseed-api');
		expect(stagingGroup.environments.staging?.environmentName).toBe('staging');
		expect(prodGroup.environments.prod?.environmentName).toBe('production');
		expect(staging.units.find((unit) => unit.id === 'public-treedx-node-01')).toMatchObject({
			host: { id: 'railway' },
			projectGroup: { id: 'public-treedx-federation' },
			config: {
				serviceName: 'treeseed-treedx-staging-01',
				sourceMode: 'git',
				sourceRepo: 'treeseed-ai/treedx',
				sourceBranch: 'staging',
				sourceRootDirectory: '.',
				volumeName: 'treeseed-treedx-staging-01-volume',
				volumeMountPath: '/data',
				environmentVariables: {
					TREEDX_FEDERATION_MODE: 'connected_library',
				},
			},
		});
		expect(staging.units.find((unit) => unit.id === 'public-treedx-node-01')?.config).not.toHaveProperty('imageTagRef');
		expect(prod.units.find((unit) => unit.id === 'public-treedx-node-01')?.config).toMatchObject({
			serviceName: 'treeseed-treedx-production-01',
			sourceMode: 'image',
			image: 'treeseed/treedx',
			imageRef: 'treeseed/treedx:0.2.11',
			imageTagRef: 'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
		});
		for (const serviceId of ['api', 'operationsRunner', 'capacityProviderManager', 'capacityProviderRunner']) {
			const service = prod.units.find((unit) => unit.id === serviceId);
			if (!service) continue;
			expect(service.config).toMatchObject({
				sourceMode: 'image',
				sourceRepo: null,
			});
		}
	});

it('models private TreeDX as a transferable per-team project group', () => {
		const graph = compileTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
		});

		expect(graph.projectGroups['private-team-treedx']).toMatchObject({
			hostId: 'railway',
			metadata: {
				transferable: true,
				privateTeam: true,
			},
		});
	});

it('allows alternate hosts when they satisfy the same service type capabilities', () => {
		const tenantRoot = createTenant(marketConfig());
		const profile: TreeseedApplicationHostingProfile = {
			id: 'alternate-host',
			label: 'Alternate host',
			services: [{
				id: 'alternate-stateful-service',
				label: 'Alternate stateful service',
				serviceType: 'stateful-container',
				environments: {
					staging: { hostId: 'portable-container-host' },
				},
			}],
		};
		const hostAdapters = {
			'portable-container-host': {
				...createDefaultHostAdapters().railway,
				id: 'portable-container-host',
				label: 'Portable container host',
			},
		};

		const graph = compileTreeseedHostingGraph({
			tenantRoot,
			environment: 'staging',
			hostAdapters,
			profiles: [profile],
		});

		expect(graph.units.find((unit) => unit.id === 'alternate-stateful-service')).toMatchObject({
			serviceType: { id: 'stateful-container' },
			host: { id: 'portable-container-host' },
		});
	});
});
