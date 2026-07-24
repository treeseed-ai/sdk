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
it('rejects host bindings that do not satisfy required service capabilities', () => {
		const profile: ApplicationHostingProfile = {
			id: 'bad-binding',
			label: 'Bad binding',
			services: [{
				id: 'bad-stateful-service',
				label: 'Bad stateful service',
				serviceType: 'stateful-container',
				environments: {
					staging: { hostId: 'smtp' },
				},
			}],
		};

		expect(() => compileHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
			profiles: [profile],
		})).toThrow(/missing capabilities: container, volume, variable, deployment/);
	});

it('orders service dependencies before composite domain services', () => {
		const graph = compileHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
		});
		const nodeIndex = graph.units.findIndex((unit) => unit.id === 'public-treedx-node-01');
		const federationIndex = graph.units.findIndex((unit) => unit.id === 'public-treedx-federation');
		expect(nodeIndex).toBeGreaterThanOrEqual(0);
		expect(federationIndex).toBeGreaterThan(nodeIndex);
	});

it('serializes plans without leaking secret values', async () => {
		const tenantRoot = createTenant(marketConfig());
		const plan = serializeHostingPlan(await planHostingGraph({
			tenantRoot,
			environment: 'staging',
			profiles: [{
				id: 'secret-test',
				label: 'Secret test',
				services: [{
					id: 'secret-api',
					label: 'Secret API',
					serviceType: 'container-api',
					config: {
						token: 'must-not-leak',
						nested: {
							password: 'also-secret',
						},
					},
					secretRefs: ['SECRET_API_TOKEN'],
					environments: {
						staging: { hostId: 'railway' },
					},
				}],
			}],
		}));
		const text = JSON.stringify(plan);
		expect(text).not.toContain('must-not-leak');
		expect(text).not.toContain('also-secret');
		expect(text).toContain('SECRET_API_TOKEN');
		expect(text).toContain('[redacted]');
	});

it('exposes built-in adapter contract methods for every default host', () => {
		for (const adapter of Object.values(createDefaultHostAdapters())) {
			expect(typeof adapter.refresh).toBe('function');
			expect(typeof adapter.diff).toBe('function');
			expect(typeof adapter.apply).toBe('function');
			expect(typeof adapter.verify).toBe('function');
			expect(typeof adapter.status).toBe('function');
		}
	});

it('exposes host-agnostic primitive and domain service types', () => {
		const serviceTypes = createDefaultServiceTypeAdapters();
		expect(serviceTypes['stateful-container'].requiredCapabilities).toEqual(expect.arrayContaining(['container', 'volume']));
		expect(serviceTypes['runner-pool'].requiredCapabilities).toEqual(expect.arrayContaining(['container', 'volume']));
		expect(serviceTypes['treedx-node'].composes).toContain('stateful-container');
		expect(serviceTypes['treedx-federation'].composes).toContain('treedx-node');
		expect(serviceTypes['treedx-node'].defaultHostByEnvironment).toMatchObject({
			local: 'local-docker',
			staging: 'railway',
			prod: 'railway',
		});
	});
});
