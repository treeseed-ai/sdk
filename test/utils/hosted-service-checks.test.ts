import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectTreeseedHostedServiceChecks } from '../../src/operations/services/hosted-service-checks.ts';

let roots: string[] = [];

function fixtureRoot(config = siteConfig()) {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-hosted-checks-'));
	roots.push(root);
	writeFileSync(resolve(root, 'package.json'), JSON.stringify({ name: '@treeseed/market', type: 'module', workspaces: ['packages/*'] }, null, 2));
	writeFileSync(resolve(root, 'treeseed.site.yaml'), config);
	return root;
}

afterEach(() => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
	roots = [];
});

function siteConfig(extra = '') {
	return `name: TreeSeed Market
slug: treeseed-market
siteUrl: https://treeseed.ai
contactEmail: hello@treeseed.email
hosting:
  kind: treeseed_control_plane
runtime:
  mode: treeseed_managed
surfaces:
  web:
    enabled: true
    provider: cloudflare
    rootDir: .
    publicBaseUrl: https://treeseed.ai
    environments:
      staging:
        domain: treeseed-market-staging-479e4625.treeseed.ai
      prod:
        domain: treeseed.ai
  api:
    enabled: true
    provider: railway
    rootDir: packages/api
    environments:
      staging:
        domain: api-treeseed-staging.treeseed.ai
      prod:
        domain: api.treeseed.ai
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
      healthcheckTimeoutSeconds: 120
      runtimeMode: serverless
    environments:
      staging:
        railwayEnvironment: staging
      prod:
        railwayEnvironment: prod
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
      healthcheckPath: /healthz
      healthcheckTimeoutSeconds: 120
      runtimeMode: service
      volumeMountPath: /data
      runnerPool:
        bootstrapCount: 1
        maxRunners: 4
        volumeMountPath: /data
    environments:
      staging:
        railwayEnvironment: staging
      prod:
        railwayEnvironment: prod
${extra}`;
}

function byId(report: ReturnType<typeof collectTreeseedHostedServiceChecks>, id: string) {
	const found = report.checks.find((check) => check.id === id);
	if (!found) throw new Error(`Missing check ${id}`);
	return found;
}

function writePackageApp(root: string, relativeRoot: string, config: string) {
	const appRoot = resolve(root, relativeRoot);
	mkdirSync(appRoot, { recursive: true });
	writeFileSync(resolve(appRoot, 'package.json'), JSON.stringify({ name: '@treeseed/ui', type: 'module' }, null, 2));
	writeFileSync(resolve(appRoot, 'treeseed.site.yaml'), config);
}

describe('hosted service checks', () => {
	it('does not require API proxy health for web-only apps', () => {
		const root = fixtureRoot(`name: TreeSeed UI
slug: treeseed-ui
siteUrl: https://ui.treeseed.ai
contactEmail: hello@treeseed.email
hosting:
  kind: self_hosted_project
  projectId: ui
runtime:
  mode: none
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
		const report = collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target: 'staging',
			appId: 'web',
			httpChecks: {
				'https://ui-staging.treeseed.ai': { status: 200, ok: true },
			},
		});

		expect(byId(report, 'http:web')).toMatchObject({ status: 'passed' });
		expect(report.checks.some((check) => check.id === 'http:web:v1-healthz')).toBe(false);
	});

	it('checks selected package-local web app domains instead of the root web app', () => {
		const root = fixtureRoot();
		writePackageApp(root, 'packages/ui', `name: TreeSeed UI
slug: treeseed-ui
siteUrl: https://ui.treeseed.ai
contactEmail: hello@treeseed.email
hosting:
  kind: self_hosted_project
  projectId: ui
runtime:
  mode: none
cloudflare:
  pages:
    projectName: treeseed-ui
    productionBranch: main
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
		const report = collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target: 'staging',
			appId: 'ui',
			httpChecks: {
				'https://ui-staging.treeseed.ai': { status: 200, ok: true },
			},
		});

		expect(byId(report, 'cloudflare:ui:surface')).toMatchObject({
			serviceKey: 'ui',
			expected: {
				domain: 'ui-staging.treeseed.ai',
				pagesProjectName: 'treeseed-ui',
			},
		});
		expect(byId(report, 'http:ui')).toMatchObject({ status: 'passed', serviceKey: 'ui' });
		expect(report.checks.some((check) => check.id === 'http:web')).toBe(false);
		expect(report.checks.some((check) => check.id === 'http:ui:v1-healthz')).toBe(false);
	});

	it('generates config-driven checks for API, runner, web, and database services', () => {
		const root = fixtureRoot();
		const report = collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target: 'staging',
			now: new Date('2026-06-07T00:00:00.000Z'),
			valuesOverlay: {
				TREESEED_DATABASE_URL: 'postgres://redacted',
				TREESEED_PLATFORM_RUNNER_SECRET: 'runner-secret',
				TREESEED_CREDENTIAL_SESSION_SECRET: 'credential-secret',
			},
			observedRailwayServices: {
				'treeseed-api': {
					serviceName: 'treeseed-api',
					projectName: 'treeseed-api',
					environmentName: 'staging',
					rootDirectory: 'packages/api',
					buildCommand: 'npm run build',
					startCommand: 'npm run start:api',
					healthcheckPath: '/healthz',
					healthcheckTimeoutSeconds: 120,
					runtimeMode: 'serverless',
				},
				'treeseed-api-operations-runner-01': {
					serviceName: 'treeseed-api-operations-runner-01',
					projectName: 'treeseed-api',
					environmentName: 'staging',
					rootDirectory: 'packages/api',
					buildCommand: 'npm run build',
					startCommand: 'npm run start:runner',
					healthcheckPath: '/healthz',
					healthcheckTimeoutSeconds: 120,
					runtimeMode: 'service',
					volumeMountPath: '/data',
				},
			},
		});
		expect(report.target).toBe('staging');
		expect(byId(report, 'railway:api:rootDirectory')).toMatchObject({ status: 'passed', expected: { rootDirectory: 'packages/api' } });
		expect(byId(report, 'railway:api:buildCommand')).toMatchObject({ status: 'passed', expected: { buildCommand: 'npm run build' } });
		expect(byId(report, 'railway:api:startCommand')).toMatchObject({ status: 'passed', expected: { startCommand: 'npm run start:api' } });
		expect(byId(report, 'railway:operationsRunner:1:startCommand')).toMatchObject({ status: 'passed', expected: { startCommand: 'npm run start:runner' } });
		expect(byId(report, 'railway:operationsRunner:1:volume')).toMatchObject({ status: 'passed', expected: { volumeMountPath: '/data' } });
		expect(byId(report, 'railway:treeseedDatabase:targets')).toMatchObject({ status: 'passed' });
	});

	it('detects Railway drift and missing required service values without leaking secret values', () => {
		const root = fixtureRoot();
		const report = collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target: 'staging',
			valuesOverlay: {
				TREESEED_DATABASE_URL: 'postgres://do-not-print',
			},
			observedRailwayServices: {
				'treeseed-api': {
					serviceName: 'treeseed-api',
					rootDirectory: '.',
					buildCommand: 'npm run build:api',
					startCommand: 'node ./src/api/server.ts',
				},
			},
		});
		expect(byId(report, 'railway:api:rootDirectory').status).toBe('failed');
		expect(byId(report, 'railway:api:startCommand').issues[0]).toContain('npm run start:api');
		expect(byId(report, 'railway:api:env:TREESEED_PLATFORM_RUNNER_SECRET').status).toBe('failed');
		expect(JSON.stringify(report)).not.toContain('postgres://do-not-print');
	});

	it('skips disabled services and warns for unsupported providers', () => {
		const root = fixtureRoot(siteConfig()
			.replace('  operationsRunner:\n    enabled: true', '  operationsRunner:\n    enabled: false')
			.replace('  api:\n    enabled: true\n    provider: railway', '  api:\n    enabled: true\n    provider: custom-host'));
		const report = collectTreeseedHostedServiceChecks({ tenantRoot: root, target: 'prod' });
		expect(report.checks.some((check) => check.serviceKey === 'operationsRunner')).toBe(false);
		expect(report.checks.some((check) => check.status === 'warning' && check.issues.some((issue) => issue.includes('custom-host')))).toBe(true);
	});
});
