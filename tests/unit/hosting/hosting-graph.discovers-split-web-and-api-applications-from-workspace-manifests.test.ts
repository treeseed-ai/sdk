import { execFileSync } from 'node:child_process';

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	compileHostingGraph,
	createDefaultHostAdapters,
	createDefaultServiceTypeAdapters,
	discoverApplications,
	planHostingGraph,
	serializeHostingPlan,
	type ApplicationHostingProfile,
	type HostAdapter,
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
it('discovers split web and API applications from workspace manifests', () => {
		const tenantRoot = createSplitWorkspace();
		const applications = discoverApplications(tenantRoot);
		expect(applications.map((app) => [app.id, app.relativeRoot])).toEqual([
			['web', '.'],
			['api', 'packages/api'],
			['ui', 'packages/ui'],
		]);
	});

it('merges split workspace app graphs and preserves app-relative API roots', () => {
		const tenantRoot = createSplitWorkspace();
		const graph = compileHostingGraph({ tenantRoot, environment: 'staging' });
		expect(graph.units.map((unit) => unit.id)).toEqual(expect.arrayContaining([
			'web',
			'ui',
			'api',
			'operationsRunner',
			'treeseedDatabase',
			'public-treedx-node-01',
		]));
		expect(graph.units.find((unit) => unit.id === 'api')).toMatchObject({
			application: { id: 'api', relativeRoot: 'packages/api' },
			config: { rootDir: '.' },
		});
		expect(graph.units.find((unit) => unit.id === 'web')).toMatchObject({
			application: { id: 'web', relativeRoot: '.' },
		});
		expect(graph.units.find((unit) => unit.id === 'ui')).toMatchObject({
			application: { id: 'ui', relativeRoot: 'packages/ui' },
			config: { rootDir: 'sandbox', domain: 'ui-staging.treeseed.ai' },
		});
	});

it('can compile only the selected discovered application', () => {
		const tenantRoot = createSplitWorkspace();
		const web = compileHostingGraph({ tenantRoot, environment: 'staging', appId: 'web' });
		const api = compileHostingGraph({ tenantRoot, environment: 'staging', appId: 'api' });
		const ui = compileHostingGraph({ tenantRoot, environment: 'staging', appId: 'ui' });
		expect(web.units.map((unit) => unit.id)).toEqual(['web']);
		expect(api.units.map((unit) => unit.id)).toEqual(expect.arrayContaining(['api', 'operationsRunner', 'treeseedDatabase']));
		expect(api.units.find((unit) => unit.id === 'api')?.config.rootDir).toBe('.');
		expect(ui.units.map((unit) => unit.id)).toEqual(['ui']);
		expect(ui.units[0]).toMatchObject({
			application: { id: 'ui', relativeRoot: 'packages/ui' },
			config: {
				rootDir: 'sandbox',
				domain: 'ui-staging.treeseed.ai',
				cloudflare: {
					pages: {
						projectName: 'treeseed-ui',
						buildOutputDir: 'sandbox/dist',
					},
				},
			},
		});
	});

it('expands runner and TreeDX pools into indexed services with dedicated volumes', () => {
		const config = marketConfig(`publicTreeDxFederation:
  railway:
    nodePool:
      bootstrapCount: 2
      maxNodes: 4
`).replace('bootstrapCount: 1', 'bootstrapCount: 2');
		const tenantRoot = createTenant(config);
		const graph = compileHostingGraph({ tenantRoot, environment: 'staging' });
		const runners = graph.units.filter((unit) => unit.config.poolKey === 'operationsRunner');
		const treeDxNodes = graph.units.filter((unit) => unit.serviceType.id === 'treedx-node');

		expect(runners.map((unit) => unit.id)).toEqual(['operationsRunner', 'operationsRunner-02']);
		expect(runners.map((unit) => unit.config.serviceName)).toEqual([
			'treeseed-ops-staging-01',
			'treeseed-ops-staging-02',
		]);
		expect(runners.map((unit) => unit.config.volumeName)).toEqual([
			'treeseed-ops-staging-01-volume',
			'treeseed-ops-staging-02-volume',
		]);
		expect(treeDxNodes.map((unit) => unit.config.serviceName)).toEqual([
			'treeseed-treedx-staging-01',
			'treeseed-treedx-staging-02',
		]);
		expect(treeDxNodes.map((unit) => unit.config.volumeName)).toEqual([
			'treeseed-treedx-staging-01-volume',
			'treeseed-treedx-staging-02-volume',
		]);

		const selected = compileHostingGraph({
			tenantRoot,
			environment: 'staging',
			filter: { serviceIds: ['operationsRunner'] },
		});
		expect(selected.units.map((unit) => unit.id)).toEqual(['operationsRunner', 'operationsRunner-02']);
	});
});
