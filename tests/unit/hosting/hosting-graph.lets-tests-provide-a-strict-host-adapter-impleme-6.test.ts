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
it('lets tests provide a strict host adapter implementation for read-only planning', async () => {
		const observed: string[] = [];
		const strictHost: TreeseedHostAdapter = {
			id: 'strict-host',
			label: 'Strict Host',
			capabilities: [
				{ id: 'container', environments: ['staging'] },
				{ id: 'variable', environments: ['staging'] },
				{ id: 'deployment', environments: ['staging'] },
				{ id: 'health', environments: ['staging'] },
			],
			refresh({ unit }) {
				observed.push(`refresh:${unit.id}`);
				return { status: 'ready', locators: {}, state: {}, warnings: [] };
			},
			diff({ unit }) {
				observed.push(`diff:${unit.id}`);
				return { unitId: unit.id, action: 'noop', reasons: [], before: {}, after: {}, warnings: [] };
			},
			apply({ unit }) {
				observed.push(`apply:${unit.id}`);
				return { status: 'ready', locators: {}, state: {}, warnings: [] };
			},
			verify({ unit }) {
				observed.push(`verify:${unit.id}`);
				return { unitId: unit.id, status: 'ready', verified: true, checks: [], warnings: [] };
			},
			status({ unit }) {
				observed.push(`status:${unit.id}`);
				return { status: 'ready', locators: {}, state: {}, warnings: [] };
			},
		};

		await planTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
			hostAdapters: { 'strict-host': strictHost },
			profiles: [{
				id: 'strict-profile',
				label: 'Strict profile',
				services: [{
					id: 'strict-api',
					label: 'Strict API',
					serviceType: 'container-api',
					environments: { staging: { hostId: 'strict-host' } },
				}],
			}],
		});

		expect(observed).toEqual(expect.arrayContaining([
			'refresh:strict-api',
			'diff:strict-api',
			'verify:strict-api',
		]));
		expect(observed).not.toContain('apply:strict-api');
	});
});
