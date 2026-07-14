import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectTreeseedDeploymentReadiness } from '../../src/operations/services/deployment-readiness.ts';

let roots: string[] = [];

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

function config(overrides = '') {
	return `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.dev
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
services:
  api:
    enabled: true
    provider: railway
    rootDir: packages/api
    railway:
      projectName: treeseed-api
      serviceName: treeseed-api
      rootDir: packages/api
      imageRefEnv: TREESEED_API_IMAGE_REF
      sourceMode: git
      sourceRepo: treeseed-ai/api
      dockerfilePath: /Dockerfile.api
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
      imageRefEnv: TREESEED_OPERATIONS_RUNNER_IMAGE_REF
      sourceMode: git
      sourceRepo: treeseed-ai/api
      dockerfilePath: /Dockerfile.operations-runner
      buildCommand: npm run build
      startCommand: npm run start:runner
      healthcheckPath: /healthz
      runtimeMode: service
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
        volumeMountPath: /data
  treeseedDatabase:
    enabled: true
    provider: railway
    railway:
      resourceType: postgres
      serviceName: treeseed-api-postgres
      serviceTargets:
        - api
        - operationsRunner
${overrides}`;
}

function rootWith(body: string) {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-readiness-'));
	roots.push(root);
	writeFileSync(resolve(root, 'package.json'), '{"name":"@treeseed/market","type":"module"}\n');
	writeFileSync(resolve(root, 'treeseed.site.yaml'), body);
	return root;
}

function writeApiPackage(root: string, relativeDir = 'packages/api') {
	const dir = resolve(root, relativeDir);
	mkdirSync(dir, { recursive: true });
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({
		name: '@treeseed/market',
		type: 'module',
		workspaces: [relativeDir],
	}, null, 2));
	writeFileSync(resolve(dir, 'package.json'), JSON.stringify({ name: '@treeseed/custom-api', type: 'module' }, null, 2));
writeFileSync(resolve(dir, 'treeseed.package.yaml'), `id: "@treeseed/custom-api"
name: Custom API
repository: treeseed-ai/api
localDev:
  services:
    api:
      script: dev:api
    operationsRunner:
      script: dev:runner
`);
}

function byId(report: ReturnType<typeof collectTreeseedDeploymentReadiness>, id: string) {
	const found = report.checks.find((check) => check.id === id);
	if (!found) throw new Error(`Missing check ${id}`);
	return found;
}

describe('deployment readiness', () => {
	it('passes UI-only projects that use a configured API connection', () => {
		const report = collectTreeseedDeploymentReadiness({
			tenantRoot: rootWith(`name: UI Only
slug: ui-only
siteUrl: https://ui.example.test
contactEmail: ui@example.test
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
    localBaseUrl: http://127.0.0.1:3100
    environments:
      staging:
        baseUrl: https://api-staging.example.test
`),
			environment: 'staging',
		});
		expect(report.ok).toBe(true);
		expect(byId(report, 'connection:api')).toMatchObject({
			status: 'passed',
			observed: expect.objectContaining({ baseUrl: 'https://api-staging.example.test' }),
		});
		expect(report.checks.map((check) => check.id)).not.toContain('hosting:api:present');
	});

	it('uses a discovered embedded API package root when validating hosting readiness', () => {
		const root = rootWith(config().replaceAll('packages/api', 'services/backend'));
		writeApiPackage(root, 'services/backend');
		const report = collectTreeseedDeploymentReadiness({ tenantRoot: root, environment: 'staging' });
		expect(report.ok).toBe(true);
		expect(byId(report, 'hosting:api:rootDir')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'railway-config:api:rootDirectory')).toMatchObject({ status: 'passed' });
	});

	it('passes current API package deployment shape', () => {
		const report = collectTreeseedDeploymentReadiness({ tenantRoot: rootWith(config()), environment: 'staging' });
		expect(report.ok).toBe(true);
		expect(byId(report, 'railway-config:api:rootDirectory')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'hosting:api:sourceMode')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'hosting:api:sourceRepo')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'hosting:operationsRunner:sourceMode')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'hosting:operationsRunner:sourceRepo')).toMatchObject({ status: 'passed' });
	});

	it('requires canonical Railway identities with production image deployment readiness', () => {
		const previous = {
			api: process.env.TREESEED_API_IMAGE_REF,
			runner: process.env.TREESEED_OPERATIONS_RUNNER_IMAGE_REF,
			treedx: process.env.TREESEED_PUBLIC_TREEDX_IMAGE_REF,
		};
		process.env.TREESEED_API_IMAGE_REF = 'treeseed/api:1.2.3';
		process.env.TREESEED_OPERATIONS_RUNNER_IMAGE_REF = 'treeseed/op-runner:1.2.3';
		process.env.TREESEED_PUBLIC_TREEDX_IMAGE_REF = 'treeseed/treedx:1.2.3';
		try {
			const report = collectTreeseedDeploymentReadiness({ tenantRoot: rootWith(config()), environment: 'prod' });
			expect(byId(report, 'railway-config:api:serviceName')).toMatchObject({ status: 'passed', observed: { serviceName: 'treeseed-api' } });
			expect(byId(report, 'railway-config:operationsRunner:serviceName')).toMatchObject({ status: 'passed', observed: { serviceName: 'treeseed-api-operations-runner-01' } });
		} finally {
			if (previous.api === undefined) delete process.env.TREESEED_API_IMAGE_REF;
			else process.env.TREESEED_API_IMAGE_REF = previous.api;
			if (previous.runner === undefined) delete process.env.TREESEED_OPERATIONS_RUNNER_IMAGE_REF;
			else process.env.TREESEED_OPERATIONS_RUNNER_IMAGE_REF = previous.runner;
			if (previous.treedx === undefined) delete process.env.TREESEED_PUBLIC_TREEDX_IMAGE_REF;
			else process.env.TREESEED_PUBLIC_TREEDX_IMAGE_REF = previous.treedx;
		}
	});

	it('requires package-local API and runner Dockerfile build contracts for local readiness', () => {
		const report = collectTreeseedDeploymentReadiness({ tenantRoot: rootWith(config()), environment: 'local' });
		expect(report.ok).toBe(true);
		expect(byId(report, 'hosting:api:dockerfilePath')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'hosting:api:startCommand')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'hosting:operationsRunner:dockerfilePath')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'hosting:operationsRunner:startCommand')).toMatchObject({ status: 'passed' });
	});

	it('fails when nested Railway rootDir overrides the package root', () => {
		const misconfigured = config()
			.replace('    rootDir: packages/api\n    railway:', '    rootDir: .\n    railway:')
			.replace('      serviceName: treeseed-api\n      rootDir: packages/api', '      serviceName: treeseed-api\n      rootDir: .');
		const report = collectTreeseedDeploymentReadiness({
			tenantRoot: rootWith(misconfigured),
			environment: 'staging',
		});
		expect(report.ok).toBe(false);
		expect(byId(report, 'hosting:api:rootDir')).toMatchObject({ status: 'failed' });
		expect(byId(report, 'railway-config:api:rootDirectory')).toMatchObject({ status: 'failed' });
		expect(JSON.stringify(report)).not.toContain('postgres://');
	});

	it('fails when database targets omit the runner', () => {
		const report = collectTreeseedDeploymentReadiness({
			tenantRoot: rootWith(config().replace('        - operationsRunner', '')),
			environment: 'staging',
		});
		expect(byId(report, 'hosting:treeseedDatabase:serviceTargets')).toMatchObject({ status: 'failed' });
	});
});
