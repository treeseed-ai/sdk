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
		const applications = discoverTreeseedApplications(tenantRoot);
		expect(applications.map((app) => [app.id, app.relativeRoot])).toEqual([
			['web', '.'],
			['api', 'packages/api'],
			['ui', 'packages/ui'],
		]);
	});

	it('merges split workspace app graphs and preserves app-relative API roots', () => {
		const tenantRoot = createSplitWorkspace();
		const graph = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging' });
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
		const web = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging', appId: 'web' });
		const api = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging', appId: 'api' });
		const ui = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging', appId: 'ui' });
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
		const graph = compileTreeseedHostingGraph({ tenantRoot, environment: 'staging' });
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

		const selected = compileTreeseedHostingGraph({
			tenantRoot,
			environment: 'staging',
			filter: { serviceIds: ['operationsRunner'] },
		});
		expect(selected.units.map((unit) => unit.id)).toEqual(['operationsRunner', 'operationsRunner-02']);
	});

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
