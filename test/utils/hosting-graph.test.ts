import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	applyTreeseedHostingGraph,
	compileTreeseedHostingGraph,
	createDefaultHostAdapters,
	createDefaultServiceTypeAdapters,
	discoverTreeseedApplications,
	planTreeseedHostingGraph,
	serializeHostingApplyResult,
	serializeHostingPlan,
	type TreeseedApplicationHostingProfile,
	type TreeseedHostAdapter,
} from '../../src/hosting/index.ts';

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
	writeFileSync(resolve(tenantRoot, 'package.json'), JSON.stringify({
		name: '@treeseed/market',
		type: 'module',
		workspaces: ['packages/*'],
	}, null, 2));
	writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.ai
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
	writeFileSync(resolve(tenantRoot, 'packages', 'api', 'treeseed.site.yaml'), `name: TreeSeed API
slug: treeseed-api
siteUrl: https://api.treeseed.ai
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
      serviceName: treeseed-api-operations-runner-01
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

function marketConfig(extra = '') {
	return `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.ai
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
        domain: treeseed.ai
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
      serviceName: treeseed-api-operations-runner-01
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
		const applications = discoverTreeseedApplications(tenantRoot);
		expect(applications.map((app) => [app.id, app.relativeRoot])).toEqual([
			['web', '.'],
			['api', 'packages/api'],
		]);
	});

	it('merges split workspace app graphs and preserves app-relative API roots', () => {
		const tenantRoot = createSplitWorkspace();
		const graph = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging' });
		expect(graph.units.map((unit) => unit.id)).toEqual(expect.arrayContaining([
			'web',
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
	});

	it('can compile only the selected discovered application', () => {
		const tenantRoot = createSplitWorkspace();
		const web = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging', appId: 'web' });
		const api = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging', appId: 'api' });
		expect(web.units.map((unit) => unit.id)).toEqual(['web']);
		expect(api.units.map((unit) => unit.id)).toEqual(expect.arrayContaining(['api', 'operationsRunner', 'treeseedDatabase']));
		expect(api.units.find((unit) => unit.id === 'api')?.config.rootDir).toBe('.');
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

	it('fails targeted hosting graph requests for unknown services', () => {
		expect(() => compileTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
			filter: { serviceIds: ['missing'] },
		})).toThrow(/Unknown hosting service id/u);
	});

	it('keeps public TreeDX in the API-owned Railway project while isolating staging and production by environment', () => {
		const tenantRoot = createTenant(marketConfig());
		const staging = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging' });
		const prod = compileTreeseedHostingGraph({ tenantRoot, environment: 'prod' });

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
				serviceName: 'public-treedx-node-01',
				volumeName: 'public-treedx-node-01-volume',
				volumeMountPath: '/data',
				environmentVariables: {
					TREEDX_FEDERATION_MODE: 'connected_library',
				},
			},
		});
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

	it('rejects host bindings that do not satisfy required service capabilities', () => {
		const profile: TreeseedApplicationHostingProfile = {
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

		expect(() => compileTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
			profiles: [profile],
		})).toThrow(/missing capabilities: container, volume, variable, deployment/);
	});

	it('orders service dependencies before composite domain services', () => {
		const graph = compileTreeseedHostingGraph({
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
		const plan = serializeHostingPlan(await planTreeseedHostingGraph({
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

	it('apply is dry-run by default and reports adapter verification', async () => {
		const result = serializeHostingApplyResult(await applyTreeseedHostingGraph({
			tenantRoot: createTenant(marketConfig()),
			environment: 'staging',
		}));

		expect(result.dryRun).toBe(true);
		expect(result.results.length).toBeGreaterThan(0);
		expect(result.results.every((entry) => entry.verification.verified)).toBe(true);
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

	it('lets tests provide a strict host adapter implementation through the public contract', async () => {
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

		await applyTreeseedHostingGraph({
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
			dryRun: false,
		});

		expect(observed).toEqual(expect.arrayContaining([
			'refresh:strict-api',
			'diff:strict-api',
			'apply:strict-api',
			'verify:strict-api',
		]));
	});
});
