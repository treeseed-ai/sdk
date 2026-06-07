import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	applyTreeseedHostingGraph,
	compileTreeseedHostingGraph,
	createDefaultHostAdapters,
	createDefaultServiceTypeAdapters,
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

function marketConfig(extra = '') {
	return `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.ai
contactEmail: hello@treeseed.email
hosting:
  kind: market_control_plane
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
  marketDatabase:
    enabled: true
    provider: railway
    railway:
      resourceType: postgres
      serviceName: treeseed-market-postgres
      environmentVariable: TREESEED_MARKET_DATABASE_URL
      serviceTargets:
        - api
        - marketOperationsRunner
  api:
    enabled: true
    provider: railway
    rootDir: .
    railway:
      projectName: treeseed-market
      serviceName: treeseed-market-api
      buildCommand: npm run build:api
      startCommand: node ./src/api/server.js
      healthcheckPath: /healthz
  marketOperationsRunner:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-market
      serviceName: treeseed-market-operations-runner
      buildCommand: npm run build:market-operations-runner
      startCommand: node ./dist/market-operations-runner/entrypoint.js run
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
smtp:
  enabled: true
${extra}`;
}

describe('hosting graph', () => {
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
			projectGroup: { id: 'market-control-plane' },
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
		expect(graph.units.find((unit) => unit.id === 'marketDatabase')?.host.id).toBe('local-docker');
		expect(graph.units.find((unit) => unit.id === 'marketOperationsRunner')?.host.id).toBe('local-docker');
		expect(graph.units.find((unit) => unit.id === 'public-treedx-node')?.host.id).toBe('local-docker');
	});

	it('keeps public TreeDX in one Railway project while isolating staging and production by environment', () => {
		const tenantRoot = createTenant(marketConfig());
		const staging = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging' });
		const prod = compileTreeseedHostingGraph({ tenantRoot, environment: 'prod' });

		const stagingGroup = staging.projectGroups['public-treedx-federation'];
		const prodGroup = prod.projectGroups['public-treedx-federation'];
		expect(stagingGroup.environments.staging?.projectName).toBe('treeseed-public-treedx');
		expect(prodGroup.environments.prod?.projectName).toBe('treeseed-public-treedx');
		expect(stagingGroup.environments.staging?.environmentName).toBe('staging');
		expect(prodGroup.environments.prod?.environmentName).toBe('production');
		expect(staging.units.find((unit) => unit.id === 'public-treedx-node')).toMatchObject({
			host: { id: 'railway' },
			projectGroup: { id: 'public-treedx-federation' },
			config: {
				volumeMountPath: '/data',
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
		const nodeIndex = graph.units.findIndex((unit) => unit.id === 'public-treedx-node');
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
			expect(typeof adapter.observe).toBe('function');
			expect(typeof adapter.plan).toBe('function');
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
          observe(input) { return { status: 'pending', locators: {}, state: { id: input.unit.id }, warnings: [] }; },
          plan(input) { return { unitId: input.unit.id, action: 'create', reasons: ['custom'], before: {}, after: {}, warnings: [] }; },
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
		expect(plan.units.find((entry) => entry.unit.id === 'public-treedx-node')?.unit).toMatchObject({
			serviceType: 'treedx-node',
			hostId: 'railway',
			projectGroupId: 'public-treedx-federation',
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
			observe({ unit }) {
				observed.push(`observe:${unit.id}`);
				return { status: 'ready', locators: {}, state: {}, warnings: [] };
			},
			plan({ unit }) {
				observed.push(`plan:${unit.id}`);
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
			'observe:strict-api',
			'plan:strict-api',
			'apply:strict-api',
			'verify:strict-api',
		]));
	});
});

