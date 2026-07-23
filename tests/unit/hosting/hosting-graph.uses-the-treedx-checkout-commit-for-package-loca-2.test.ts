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
it('uses the TreeDX checkout commit for package-local API staging source builds', () => {
		const tenantRoot = createSplitWorkspace();
		const apiCommit = createGitCommit(resolve(tenantRoot, 'packages', 'api'));
		const treeDxCommit = createGitCommit(resolve(tenantRoot, 'packages', 'treedx'));
		const graph = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging', appId: 'api' });
		const treeDx = graph.units.find((unit) => unit.id === 'public-treedx-node-01');

		expect(treeDx?.config.sourceRepo).toBe('treeseed-ai/treedx');
		expect(treeDx?.config.sourceCommit).toBe(treeDxCommit);
		expect(treeDx?.config.sourceCommit).not.toBe(apiCommit);
	});

it('compiles current Market config into user-facing service placements', () => {
		const graph = compileTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
		});

		expect(graph.placements.map((placement) => placement.placement)).toEqual(expect.arrayContaining([
			'web',
			'api',
			'database',
			'runner-capacity',
			'content-storage',
			'email',
			'knowledge-library',
		]));
		expect(graph.units.find((unit) => unit.id === 'api')).toMatchObject({
			placement: 'api',
			host: { id: 'railway' },
			projectGroup: { id: 'treeseed-control-plane' },
		});
		expect(graph.units.find((unit) => unit.id === 'web')).toMatchObject({
			placement: 'web',
			host: { id: 'cloudflare' },
		});
	});

it('uses local process and local Docker host bindings for local dev fallback', () => {
		const graph = compileTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'local',
		});

		expect(graph.units.find((unit) => unit.id === 'web')?.host.id).toBe('local-process');
		expect(graph.units.find((unit) => unit.id === 'api')?.host.id).toBe('local-process');
		expect(graph.units.find((unit) => unit.id === 'treeseedDatabase')?.host.id).toBe('local-docker');
		expect(graph.units.find((unit) => unit.id === 'operationsRunner')?.host.id).toBe('local-docker');
		expect(graph.units.find((unit) => unit.id === 'public-treedx-node-01')?.host.id).toBe('local-docker');
	});

it('filters hosting graph units by service id', async () => {
		const tenantRoot = createTenant(marketConfig());
		const plan = await planTreeseedHostingGraph({
			tenantRoot,
			environment: 'staging',
			filter: { serviceIds: ['api'] },
		});

		expect(plan.units.map((entry) => entry.unit.id)).toEqual(['api']);
	});

it('keeps descriptive host adapters fail-closed until canonical reconciliation supplies live evidence', async () => {
		const plan = await planTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
			filter: { serviceIds: ['api'] },
		});
		const api = plan.units[0];

		expect(api?.observed.status).toBe('blocked');
		expect(api?.plan.action).toBe('blocked');
		expect(api?.verification).toMatchObject({ status: 'blocked', verified: false });
		expect(api?.observed.state).not.toHaveProperty('applied');
	});

it('fails targeted hosting graph requests for unknown services', () => {
		expect(() => compileTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
			filter: { serviceIds: ['missing'] },
		})).toThrow(/Unknown hosting service id/u);
	});
});
