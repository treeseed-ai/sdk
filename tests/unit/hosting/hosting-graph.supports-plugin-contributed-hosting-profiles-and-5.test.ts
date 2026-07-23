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
it('supports plugin-contributed hosting profiles and adapters', () => {
		const tenantRoot = createTenant(`${marketConfig()}
plugins:
  - package: ./hosting-plugin.cjs
`);
		writeFileSync(resolve(tenantRoot, 'hosting-plugin.cjs'), `module.exports = {
  hosting() {
    return {
      hostAdapters: {
        customHost: {
          id: 'customHost',
          label: 'Custom Host',
          capabilities: [
            { id: 'container', environments: ['staging'] },
            { id: 'variable', environments: ['staging'] },
            { id: 'deployment', environments: ['staging'] },
            { id: 'health', environments: ['staging'] }
          ],
          refresh(input) { return { status: 'pending', locators: {}, state: { id: input.unit.id }, warnings: [] }; },
          diff(input) { return { unitId: input.unit.id, action: 'create', reasons: ['custom'], before: {}, after: {}, warnings: [] }; },
          apply(input) { return { status: 'ready', locators: {}, state: { id: input.unit.id }, warnings: [] }; },
          verify(input) { return { unitId: input.unit.id, status: 'ready', verified: true, checks: [], warnings: [] }; },
          status(input) { return { status: 'ready', locators: {}, state: { id: input.unit.id }, warnings: [] }; }
        }
      },
      profiles: [{
        id: 'plugin-profile',
        label: 'Plugin profile',
        services: [{
          id: 'plugin-api',
          label: 'Plugin API',
          serviceType: 'container-api',
          environments: { staging: { hostId: 'customHost' } }
        }]
      }]
    };
  }
};`);

		const graph = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging' });

		expect(graph.hosts.customHost.label).toBe('Custom Host');
		expect(graph.units.find((unit) => unit.id === 'plugin-api')).toMatchObject({
			host: { id: 'customHost' },
			serviceType: { id: 'container-api' },
		});
	});

it('keeps service type adapters independent from a single host id', () => {
		const serviceTypes = createDefaultServiceTypeAdapters();
		const stateful = serviceTypes['stateful-container'];
		const treedx = serviceTypes['treedx-node'];

		expect(stateful.requiredCapabilities).toEqual(treedx.requiredCapabilities);
		expect(new Set(Object.values(stateful.defaultHostByEnvironment))).toEqual(new Set(['local-docker', 'railway']));
		expect(new Set(Object.values(treedx.defaultHostByEnvironment))).toEqual(new Set(['local-docker', 'railway']));
	});

it('returns a serializable hosting plan with placement-first UI metadata', async () => {
		const plan = serializeHostingPlan(await planTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
		}));

		expect(plan.placements.find((placement) => placement.placement === 'knowledge-library')).toMatchObject({
			label: 'Knowledge Library',
			hostIds: ['railway'],
		});
		const treeDxEntry = plan.units.find((entry) => entry.unit.id === 'public-treedx-node-01');
		expect(treeDxEntry?.unit).toMatchObject({
			serviceType: 'treedx-node',
			hostId: 'railway',
			projectGroupId: 'public-treedx-federation',
			config: {
				sourceMode: 'git',
				sourceRepo: 'treeseed-ai/treedx',
			},
		});
		expect(treeDxEntry).toMatchObject({
			desired: { id: 'public-treedx-node-01' },
			diff: { unitId: 'public-treedx-node-01' },
			actions: expect.any(Array),
			retainedResources: [],
			blockedDrift: [],
			providerLimitations: [],
		});
	});
});
