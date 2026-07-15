import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectTreeseedLiveHostedServiceChecks } from '../../src/operations/services/live-hosted-service-checks.ts';

let roots: string[] = [];

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

function root() {
	const path = mkdtempSync(resolve(tmpdir(), 'treeseed-live-hosted-'));
	roots.push(path);
	writeFileSync(resolve(path, 'package.json'), '{"name":"@treeseed/market","type":"module","workspaces":["packages/*"]}\n');
	writeFileSync(resolve(path, 'treeseed.site.yaml'), `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://web.example.test
contactEmail: hello@treeseed.ai
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
    publicBaseUrl: https://web.example.test
  api:
    enabled: true
    provider: railway
    environments:
      staging:
        domain: api.example.test
services:
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
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      serviceTargets: [api, operationsRunner]
`);
	return path;
}

function writePackageApp(rootPath: string, relativeRoot: string, config: string) {
	const appRoot = resolve(rootPath, relativeRoot);
	mkdirSync(appRoot, { recursive: true });
	writeFileSync(resolve(appRoot, 'package.json'), '{"name":"@treeseed/ui","type":"module"}\n');
	writeFileSync(resolve(appRoot, 'treeseed.site.yaml'), config);
}

describe('live hosted service checks', () => {
	it('marks required missing live observations as failed in strict mode', async () => {
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root(),
			target: 'staging',
			strict: true,
			requireLiveRailway: true,
			requireLiveHttp: false,
			env: {
				TREESEED_RAILWAY_API_TOKEN: '',
				TREESEED_RAILWAY_TOKEN: '',
				RAILWAY_API_TOKEN: '',
				RAILWAY_TOKEN: '',
			},
		});
		expect(report.summary.failed).toBeGreaterThan(0);
		expect(report.checks.some((check) => check.provider === 'railway' && check.status === 'failed')).toBe(true);
		expect(JSON.stringify(report)).not.toContain('postgres://redacted');
		expect(JSON.stringify(report)).not.toContain('do-not-print');
	});

	it('observes HTTP checks with retry', async () => {
		let attempts = 0;
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root(),
			target: 'staging',
			requireLiveRailway: false,
			requireLiveHttp: true,
			retry: { attempts: 2, intervalMs: 1 },
			fetchImpl: (async () => {
				attempts += 1;
				if (attempts === 1) throw new Error('temporary');
				return new Response('{}', { status: 200 });
			}) as typeof fetch,
		});
		expect(report.checks.find((check) => check.id === 'http:web')?.status).toBe('passed');
		expect(report.checks.find((check) => check.id === 'http:api:healthz')?.status).toBe('passed');
		expect(report.checks.find((check) => check.id === 'http:api:healthz-deep')?.status).toBe('passed');
	});

	it('retries transient HTTP status failures with an HTTP-specific policy', async () => {
		let attempts = 0;
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root(),
			target: 'staging',
			requireLiveRailway: false,
			requireLiveHttp: true,
			retry: { attempts: 1, intervalMs: 0 },
			httpRetry: { attempts: 3, intervalMs: 1 },
			fetchImpl: (async () => {
				attempts += 1;
				return new Response('{}', { status: attempts < 3 ? 503 : 200 });
			}) as typeof fetch,
		});

		expect(attempts).toBeGreaterThanOrEqual(3);
		expect(report.checks.find((check) => check.id === 'http:web')?.status).toBe('passed');
	});

	it('reports the final transient HTTP status after exhausting readiness attempts', async () => {
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root(),
			target: 'staging',
			requireLiveRailway: false,
			requireLiveHttp: true,
			httpRetry: { attempts: 2, intervalMs: 1 },
			fetchImpl: (async () => new Response('{}', { status: 503 })) as typeof fetch,
		});

		expect(report.checks.find((check) => check.id === 'http:web')).toMatchObject({
			status: 'failed',
			observed: { status: 503, ok: false },
		});
	});

	it('scopes live reports to selected service keys', async () => {
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot: root(),
			target: 'staging',
			serviceKeys: ['api'],
			requireLiveRailway: false,
			requireLiveHttp: false,
		});

		expect(report.checks.some((check) => check.serviceKey === 'api')).toBe(true);
		expect(report.checks.some((check) => check.serviceKey === 'operationsRunner')).toBe(false);
		expect(report.checks.some((check) => check.id === 'railway:treeseedDatabase:targets')).toBe(false);
	});

	it('matches package-root API services to the inferred api app during database topology checks', async () => {
		const tenantRoot = root();
		const fetchImpl = (async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> };
			const query = String(body.query ?? '');
			const project = {
				id: 'project-api',
				name: 'treeseed-api',
				workspaceId: 'workspace-1',
				deletedAt: null,
				environments: { edges: [{ node: { id: 'env-staging', name: 'staging' } }] },
				services: { edges: [
					{ node: { id: 'svc-api', name: 'treeseed-api' } },
					{ node: { id: 'svc-postgres', name: 'treeseed-api-postgres' } },
				] },
			};
			if (query.includes('TreeseedRailwayAuthProfile')) {
				return Response.json({ data: { me: { id: 'user-1', name: 'Test', email: 'test@example.com', workspaces: [{ id: 'workspace-1', name: 'knowledge-coop' }] } } });
			}
			if (query.includes('TreeseedRailwayProjects')) {
				return Response.json({ data: { projects: { edges: [{ node: project }] } } });
			}
			if (query.includes('TreeseedRailwayProjectEnvironments')) {
				return Response.json({ data: { project: { id: 'project-api', environments: project.environments } } });
			}
			if (query.includes('TreeseedRailwayProjectServices')) {
				return Response.json({ data: { project: { id: 'project-api', services: project.services } } });
			}
			if (query.includes('TreeseedRailwayVolumeList')) {
				return Response.json({ data: { project: { id: 'project-api', volumes: { edges: [{ node: {
					id: 'vol-postgres',
					name: 'treeseed-api-postgres-volume',
					projectId: 'project-api',
					volumeInstances: { edges: [{ node: { id: 'vi-postgres', serviceId: 'svc-postgres', environmentId: 'env-staging', mountPath: '/var/lib/postgresql/data', state: 'READY' } }] },
				} }] } } } });
			}
			if (query.includes('TreeseedRailwayVariables')) {
				return Response.json({ data: { variables: {} } });
			}
			if (query.includes('TreeseedRailwayServiceInstance(')) {
				return Response.json({ data: { serviceInstance: {
					id: `instance-${String(body.variables?.serviceId ?? 'service')}`,
					buildCommand: 'npm run build',
					startCommand: 'npm run start:api',
					cronSchedule: null,
					rootDirectory: null,
					healthcheckPath: '/healthz',
					healthcheckTimeout: null,
					sleepApplication: false,
				} } });
			}
			if (query.includes('TreeseedRailwayServiceDeploymentHealth')) {
				return Response.json({ data: { serviceInstance: { latestDeployment: {
					status: 'SUCCESS',
					deploymentStopped: false,
					instances: [{ status: 'RUNNING' }],
				} } } });
			}
			throw new Error(`Unexpected Railway query: ${query}`);
		}) as typeof fetch;

		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot,
			target: 'staging',
			appId: 'api',
			serviceKeys: ['api'],
			strict: true,
			requireLiveRailway: true,
			requireLiveHttp: false,
			env: { TREESEED_RAILWAY_API_TOKEN: 'test-token', TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop' },
			fetchImpl,
		});

		const allIssues = [
			...report.liveObservation.issues,
			...report.checks.flatMap((check) => check.issues),
		].join('\n');
		expect(allIssues).not.toContain('no Railway API or operations runner service is configured to own the database');
	});

	it('retains the opposite environment while reporting obsolete unsuffixed identities as stale', async () => {
		const tenantRoot = root();
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: TreeSeed API
slug: treeseed-api
siteUrl: https://web.example.test
contactEmail: hello@treeseed.ai
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
surfaces:
  api:
    enabled: true
    provider: railway
services:
  operationsRunner:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api-operations-runner
      runnerPool:
        bootstrapCount: 1
      startCommand: npm run start:operations-runner
      volumeMountPath: /data
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      serviceTargets: [operationsRunner]
`);
		const services = [
			{ id: 'runner-staging', name: 'treeseed-api-operations-runner-staging-01' },
			{ id: 'runner-production', name: 'treeseed-api-operations-runner-production-01' },
			{ id: 'runner-unsuffixed', name: 'treeseed-api-operations-runner-01' },
			{ id: 'runner-legacy', name: 'treeseed-api-operations-runner-old-01' },
			{ id: 'postgres', name: 'treeseed-api-postgres' },
		];
		const volumes = [
			{ id: 'volume-staging', name: 'treeseed-api-operations-runner-staging-01-volume', projectId: 'project-api', volumeInstances: { edges: [{ node: { id: 'vi-staging', serviceId: 'runner-staging', environmentId: 'env-staging', mountPath: '/data', state: 'READY' } }] } },
			{ id: 'volume-production', name: 'treeseed-api-operations-runner-production-01-volume', projectId: 'project-api', volumeInstances: { edges: [{ node: { id: 'vi-production', serviceId: 'runner-production', environmentId: 'env-production', mountPath: '/data', state: 'READY' } }] } },
			{ id: 'volume-unsuffixed', name: 'treeseed-api-operations-runner-01-volume', projectId: 'project-api', volumeInstances: { edges: [{ node: { id: 'vi-unsuffixed', serviceId: 'runner-unsuffixed', environmentId: 'env-staging', mountPath: '/data', state: 'READY' } }] } },
			{ id: 'volume-legacy', name: 'treeseed-api-operations-runner-old-01-volume', projectId: 'project-api', volumeInstances: { edges: [{ node: { id: 'vi-legacy', serviceId: 'runner-legacy', environmentId: 'env-staging', mountPath: '/data', state: 'READY' } }] } },
		];
		const fetchImpl = (async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> };
			const query = String(body.query ?? '');
			if (query.includes('TreeseedRailwayAuthProfile')) {
				return Response.json({ data: { me: { id: 'user-1', name: 'Test', email: 'test@example.com', workspaces: [{ id: 'workspace-1', name: 'knowledge-coop' }] } } });
			}
			if (query.includes('TreeseedRailwayProjects')) {
				return Response.json({ data: { projects: { edges: [{ node: { id: 'project-api', name: 'treeseed-api', workspaceId: 'workspace-1', deletedAt: null } }] } } });
			}
			if (query.includes('TreeseedRailwayProjectEnvironments')) {
				return Response.json({ data: { project: { id: 'project-api', environments: { edges: [
					{ node: { id: 'env-staging', name: 'staging' } },
					{ node: { id: 'env-production', name: 'production' } },
				] } } } });
			}
			if (query.includes('TreeseedRailwayProjectServices')) {
				return Response.json({ data: { project: { id: 'project-api', services: { edges: services.map((node) => ({ node })) } } } });
			}
			if (query.includes('TreeseedRailwayVolumeList')) {
				return Response.json({ data: { project: { id: 'project-api', volumes: { edges: volumes.map((node) => ({ node })) } } } });
			}
			if (query.includes('TreeseedRailwayVariables')) return Response.json({ data: { variables: {} } });
			if (query.includes('TreeseedRailwayServiceInstance(')) {
				return Response.json({ data: { serviceInstance: { id: `instance-${String(body.variables?.serviceId ?? '')}`, buildCommand: null, startCommand: 'npm run start:operations-runner', cronSchedule: null, rootDirectory: null, healthcheckPath: null, healthcheckTimeout: null, sleepApplication: false } } });
			}
			if (query.includes('TreeseedRailwayServiceDeploymentHealth')) {
				return Response.json({ data: { serviceInstance: { latestDeployment: { status: 'SUCCESS', deploymentStopped: false, instances: [{ status: 'RUNNING' }] } } } });
			}
			throw new Error(`Unexpected Railway query: ${query}`);
		}) as typeof fetch;

		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot,
			target: 'staging',
			serviceKeys: ['operationsRunner'],
			requireLiveRailway: true,
			requireLiveHttp: false,
			env: { TREESEED_RAILWAY_API_TOKEN: 'test-token', TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop' },
			fetchImpl,
		});
		const issues = report.liveObservation.issues.join('\n');
		expect(issues).not.toContain('treeseed-api-operations-runner-production-01: stale');
		expect(issues).not.toContain('treeseed-api-operations-runner-production-01-volume: stale');
		expect(issues).toContain('treeseed-api-operations-runner-old-01: stale');
		expect(issues).toContain('treeseed-api-operations-runner-old-01-volume: stale');

		const productionReport = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot,
			target: 'prod',
			serviceKeys: ['operationsRunner'],
			requireLiveRailway: true,
			requireLiveHttp: false,
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'test-token',
				TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop',
				TREESEED_API_IMAGE_REF: 'treeseed/api:1.2.3',
				TREESEED_OPERATIONS_RUNNER_IMAGE_REF: 'treeseed/op-runner:1.2.3',
				TREESEED_PUBLIC_TREEDX_IMAGE_REF: 'treeseed/treedx:1.2.3',
			},
			fetchImpl,
		});
		const productionIssues = productionReport.liveObservation.issues.join('\n');
		expect(productionIssues).not.toContain('treeseed-api-operations-runner-staging-01: stale');
		expect(productionIssues).not.toContain('treeseed-api-operations-runner-staging-01-volume: stale');
		expect(productionIssues).toContain('treeseed-api-operations-runner-01: stale');
		expect(productionIssues).toContain('treeseed-api-operations-runner-01-volume: stale');
	}, 15_000);

	it('uses release image refs when checking production Railway image services', async () => {
		const tenantRoot = root();
		const fetchImpl = (async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> };
			const query = String(body.query ?? '');
			const project = {
				id: 'project-api',
				name: 'treeseed-api',
				workspaceId: 'workspace-1',
				deletedAt: null,
				environments: { edges: [{ node: { id: 'env-production', name: 'production' } }] },
				services: { edges: [
					{ node: { id: 'svc-api', name: 'treeseed-api' } },
					{ node: { id: 'svc-postgres', name: 'treeseed-api-postgres' } },
				] },
			};
			if (query.includes('TreeseedRailwayAuthProfile')) {
				return Response.json({ data: { me: { id: 'user-1', name: 'Test', email: 'test@example.com', workspaces: [{ id: 'workspace-1', name: 'knowledge-coop' }] } } });
			}
			if (query.includes('TreeseedRailwayProjects')) {
				return Response.json({ data: { projects: { edges: [{ node: project }] } } });
			}
			if (query.includes('TreeseedRailwayProjectEnvironments')) {
				return Response.json({ data: { project: { id: 'project-api', environments: project.environments } } });
			}
			if (query.includes('TreeseedRailwayProjectServices')) {
				return Response.json({ data: { project: { id: 'project-api', services: project.services } } });
			}
			if (query.includes('TreeseedRailwayVolumeList')) {
				return Response.json({ data: { project: { id: 'project-api', volumes: { edges: [] } } } });
			}
			if (query.includes('TreeseedRailwayVariables')) {
				return Response.json({ data: { variables: {} } });
			}
			if (query.includes('TreeseedRailwayServiceInstance(')) {
				return Response.json({ data: { serviceInstance: {
					id: `instance-${String(body.variables?.serviceId ?? 'service')}`,
					buildCommand: null,
					startCommand: null,
					cronSchedule: null,
					rootDirectory: null,
					healthcheckPath: '/healthz',
					healthcheckTimeout: 120,
					sleepApplication: false,
				} } });
			}
			if (query.includes('TreeseedRailwayServiceDeploymentHealth')) {
				return Response.json({ data: { serviceInstance: { latestDeployment: {
					status: 'SUCCESS',
					deploymentStopped: false,
					instances: [{ status: 'RUNNING' }],
				} } } });
			}
			throw new Error(`Unexpected Railway query: ${query}`);
		}) as typeof fetch;

		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot,
			target: 'prod',
			serviceKeys: ['api'],
			strict: true,
			requireLiveRailway: true,
			requireLiveHttp: false,
			env: {
				TREESEED_RAILWAY_API_TOKEN: 'test-token',
				TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop',
				TREESEED_API_IMAGE_REF: 'treeseed/api:0.6.14',
				TREESEED_OPERATIONS_RUNNER_IMAGE_REF: 'treeseed/op-runner:0.6.14',
				TREESEED_PUBLIC_TREEDX_IMAGE_REF: 'treeseed/treedx:0.6.14',
			},
			fetchImpl,
		});

		const allIssues = [
			...report.liveObservation.issues,
			...report.checks.flatMap((check) => check.issues),
		].join('\n');
		expect(allIssues).not.toContain('no immutable image ref is resolved');
		expect(allIssues).not.toContain('Expected startCommand=npm run start:api');
		expect(report.checks.find((check) => check.id === 'railway:api:startCommand')).toBeUndefined();
	});

	it('observes selected package-local web app URL with branch alias fallback', async () => {
		const tenantRoot = root();
		writePackageApp(tenantRoot, 'packages/ui', `name: TreeSeed UI
slug: treeseed-ui
siteUrl: https://ui.treeseed.ai
contactEmail: hello@treeseed.ai
hosting:
  kind: self_hosted_project
  projectId: ui
runtime:
  mode: none
cloudflare:
  pages:
    projectName: treeseed-ui
    stagingBranch: staging
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: sandbox
    publicBaseUrl: https://ui.treeseed.ai
    environments:
      staging:
        domain: ui-staging.treeseed.ai
`);
		const urls: string[] = [];
		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot,
			target: 'staging',
			appId: 'ui',
			requireLiveRailway: false,
			requireLiveHttp: true,
			retry: { attempts: 1, intervalMs: 1 },
			fetchImpl: (async (input) => {
				const url = String(input);
				urls.push(url);
				if (url === 'https://ui-staging.treeseed.ai') throw new Error('temporary dns miss');
				return new Response('{}', { status: 200 });
			}) as typeof fetch,
		});

		expect(urls).toEqual(['https://ui-staging.treeseed.ai', 'https://staging.treeseed-ui.pages.dev']);
		expect(report.checks.find((check) => check.id === 'http:ui')).toMatchObject({
			status: 'warning',
			observed: {
				fallbackUrl: 'https://staging.treeseed-ui.pages.dev',
				fallbackStatus: 200,
				fallbackOk: true,
			},
		});
		expect(report.checks.some((check) => check.id === 'http:web')).toBe(false);
	}, 15_000);

	it('retries public TreeDX Railway deployment health before failing strict live checks', async () => {
		const tenantRoot = root();
		writeFileSync(resolve(tenantRoot, 'treeseed.site.yaml'), `name: TreeSeed API
slug: treeseed-api
siteUrl: https://web.example.test
contactEmail: hello@treeseed.ai
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
    publicBaseUrl: https://web.example.test
  api:
    enabled: true
    provider: railway
services:
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
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      serviceTargets: [api, operationsRunner]
`);
		let deploymentHealthCalls = 0;
		const fetchImpl = (async (_input, init) => {
			const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> };
			const query = String(body.query ?? '');
			const project = {
				id: 'project-api',
				name: 'treeseed-api',
				workspaceId: 'workspace-1',
				deletedAt: null,
				environments: { edges: [{ node: { id: 'env-staging', name: 'staging' } }] },
				services: { edges: [
					{ node: { id: 'svc-api', name: 'treeseed-api' } },
					{ node: { id: 'svc-postgres', name: 'treeseed-api-postgres' } },
					{ node: { id: 'svc-treedx', name: 'treeseed-treedx-staging-01' } },
				] },
			};
			if (query.includes('TreeseedRailwayAuthProfile')) {
				return Response.json({ data: { me: { id: 'user-1', name: 'Test', email: 'test@example.com', workspaces: [{ id: 'workspace-1', name: 'knowledge-coop' }] } } });
			}
			if (query.includes('TreeseedRailwayProjects')) {
				return Response.json({ data: { projects: { edges: [{ node: project }] } } });
			}
			if (query.includes('TreeseedRailwayProjectEnvironments')) {
				return Response.json({ data: { project: { id: 'project-api', environments: project.environments } } });
			}
			if (query.includes('TreeseedRailwayProjectServices')) {
				return Response.json({ data: { project: { id: 'project-api', services: project.services } } });
			}
			if (query.includes('TreeseedRailwayVolumeList')) {
				return Response.json({ data: { project: { id: 'project-api', volumes: { edges: [{ node: {
					id: 'vol-treedx',
					name: 'treeseed-treedx-staging-01-volume',
					projectId: 'project-api',
					volumeInstances: { edges: [{ node: { id: 'vi-treedx', serviceId: 'svc-treedx', environmentId: 'env-staging', mountPath: '/data', state: 'READY' } }] },
				} }] } } } });
			}
			if (query.includes('TreeseedRailwayVariables')) {
				const serviceId = String(body.variables?.serviceId ?? '');
				return Response.json({ data: { variables: serviceId === 'svc-treedx' ? { TREEDX_FEDERATION_MODE: 'connected_library' } : {} } });
			}
			if (query.includes('TreeseedRailwayServiceInstance(')) {
				return Response.json({ data: { serviceInstance: {
					id: `instance-${String(body.variables?.serviceId ?? 'service')}`,
					buildCommand: null,
					startCommand: null,
					cronSchedule: null,
					rootDirectory: null,
					healthcheckPath: null,
					healthcheckTimeout: null,
					sleepApplication: false,
				} } });
			}
			if (query.includes('TreeseedRailwayServiceDeploymentHealth')) {
				deploymentHealthCalls += 1;
				const latestDeployment = deploymentHealthCalls === 1
					? { status: 'DEPLOYING', deploymentStopped: true, instances: [{ status: 'RUNNING' }] }
					: { status: 'SUCCESS', deploymentStopped: false, instances: [{ status: 'RUNNING' }] };
				return Response.json({ data: { serviceInstance: { latestDeployment } } });
			}
			throw new Error(`Unexpected Railway query: ${query}`);
		}) as typeof fetch;

		const report = await collectTreeseedLiveHostedServiceChecks({
			tenantRoot,
			target: 'staging',
			strict: true,
			requireLiveRailway: true,
			requireLiveHttp: false,
			retry: { attempts: 2, intervalMs: 1 },
			env: { TREESEED_RAILWAY_API_TOKEN: 'test-token', TREESEED_RAILWAY_WORKSPACE: 'knowledge-coop' },
			fetchImpl,
		});

		expect(deploymentHealthCalls).toBeGreaterThanOrEqual(2);
		expect(report.liveObservation.issues).not.toContain(expect.stringContaining('public TreeDX latest deployment is not healthy'));
	}, 15_000);
});
