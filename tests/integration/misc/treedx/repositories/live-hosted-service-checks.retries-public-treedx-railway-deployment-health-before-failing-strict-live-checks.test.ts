import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { collectLiveHostedServiceChecks } from '../../../../../src/operations/services/hosting/audit/live-hosted-service-checks.ts';

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

		const report = await collectLiveHostedServiceChecks({
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
