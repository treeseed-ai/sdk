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
siteUrl: https://treeseed.dev
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
    publicBaseUrl: https://treeseed.dev
    environments:
      staging:
        domain: preview.treeseed.dev
      prod:
        domain: treeseed.dev
  api:
    enabled: true
    provider: railway
    rootDir: packages/api
    environments:
      staging:
        domain: api.preview.treeseed.dev
      prod:
        domain: api.treeseed.dev
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
      imageRefEnv: TREESEED_API_IMAGE_REF
      dockerfilePath: /Dockerfile.api
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
      imageRefEnv: TREESEED_OPERATIONS_RUNNER_IMAGE_REF
      dockerfilePath: /Dockerfile.operations-runner
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
	it('requires API proxy health for the selected root web app when API hosting is declared', () => {
		const root = fixtureRoot();
		writePackageApp(root, 'packages/api', `name: TreeSeed API
slug: treeseed-api
siteUrl: https://api.preview.treeseed.dev
contactEmail: hello@treeseed.email
hosting:
  kind: self_hosted_project
  projectId: api
runtime:
  mode: treeseed_managed
surfaces:
  api:
    enabled: true
    provider: railway
    rootDir: .
`);
		const report = collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target: 'staging',
			appId: 'web',
			httpChecks: {
				'https://preview.treeseed.dev': { status: 200, ok: true },
				'https://preview.treeseed.dev/v1/healthz': { status: 200, ok: true },
			},
		});

		expect(byId(report, 'http:web')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'http:web:v1-healthz')).toMatchObject({ status: 'passed' });
	});

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
					rootDirectory: '.',
					buildCommand: 'npm run build',
					dockerfilePath: '/Dockerfile.api',
					startCommand: 'npm run start:api',
					healthcheckPath: '/healthz',
					healthcheckTimeoutSeconds: 120,
					runtimeMode: 'serverless',
				},
				'treeseed-api-operations-runner-01': {
					serviceName: 'treeseed-api-operations-runner-01',
					serviceId: 'runner-service-id',
					projectName: 'treeseed-api',
					environmentName: 'staging',
					rootDirectory: '.',
					buildCommand: 'npm run build',
					dockerfilePath: '/Dockerfile.operations-runner',
					startCommand: 'npm run start:runner',
					healthcheckPath: '/healthz',
					healthcheckTimeoutSeconds: 120,
					runtimeMode: 'service',
					deploymentRequiredMountPath: '/data',
					deploymentVolumeMounts: ['/data'],
					volumeId: 'runner-volume-id',
					volumeName: 'treeseed-api-operations-runner-01-volume',
					volumeMountPath: '/data',
					volumeServiceId: 'runner-service-id',
					volumeEnvironmentId: 'staging-environment-id',
				},
			},
		});
		expect(report.target).toBe('staging');
		expect(byId(report, 'railway:api:service')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'railway:api:healthcheckPath')).toMatchObject({ status: 'passed', expected: { healthcheckPath: '/healthz' } });
		expect(byId(report, 'railway:api:runtimeMode')).toMatchObject({ status: 'passed', expected: { runtimeMode: 'serverless' } });
		expect(byId(report, 'railway:api:rootDirectory')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'railway:api:dockerfilePath')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'railway:api:startCommand')).toMatchObject({ status: 'passed' });
		expect(byId(report, 'railway:operationsRunner:1:volume')).toMatchObject({ status: 'passed', expected: { volumeMountPath: '/data' } });
		expect(byId(report, 'railway:operationsRunner:1:deployment-required-mount')).toMatchObject({ status: 'passed', expected: { volumeMountPath: '/data' } });
		expect(byId(report, 'railway:treeseedDatabase:targets')).toMatchObject({ status: 'passed' });
	});

	it('fails canonical staging API services when live deployment metadata is image-shaped instead of Git-shaped', () => {
		const root = fixtureRoot();
		const report = collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target: 'staging',
			observedRailwayServices: {
				'treeseed-api': {
					serviceName: 'treeseed-api',
					projectName: 'treeseed-api',
					environmentName: 'staging',
					rootDirectory: 'packages/api',
					buildCommand: 'npm run build',
					dockerfilePath: '/Dockerfile.api',
					startCommand: 'npm run start:api',
					healthcheckPath: '/healthz',
					healthcheckTimeoutSeconds: 120,
					runtimeMode: 'serverless',
					deploymentHealthy: true,
					deploymentRepo: null,
					deploymentBranch: null,
					deploymentRootDirectory: null,
				},
			},
		});

		expect(byId(report, 'railway:api:deployment-repo').status).toBe('failed');
		expect(byId(report, 'railway:api:deployment-branch').status).toBe('failed');
		expect(byId(report, 'railway:api:deployment-root-directory').status).toBe('failed');
	});

	it('scopes checks to selected service keys', () => {
		const root = fixtureRoot();
		const report = collectTreeseedHostedServiceChecks({
			tenantRoot: root,
			target: 'staging',
			serviceKeys: ['api'],
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
			},
		});

		expect(byId(report, 'railway:api:service')).toMatchObject({ status: 'passed' });
		expect(report.checks.some((check) => check.serviceKey === 'operationsRunner')).toBe(false);
		expect(report.checks.some((check) => check.id === 'railway:treeseedDatabase:targets')).toBe(false);
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
					rootDirectory: 'packages/api',
					buildCommand: 'npm run build:api',
					startCommand: 'node ./src/api/server.ts',
					healthcheckPath: '/bad-health',
				},
			},
		});
		expect(byId(report, 'railway:api:rootDirectory').status).toBe('failed');
		expect(byId(report, 'railway:api:healthcheckPath').status).toBe('failed');
		expect(byId(report, 'railway:api:healthcheckPath').issues[0]).toContain('/healthz');
		expect(byId(report, 'railway:api:env:TREESEED_PLATFORM_RUNNER_SECRET').status).toBe('failed');
		expect(JSON.stringify(report)).not.toContain('postgres://do-not-print');
	});

	it('skips disabled services and warns for unsupported providers', () => {
		const root = fixtureRoot(siteConfig()
			.replace('  operationsRunner:\n    enabled: true', '  operationsRunner:\n    enabled: false')
			.replace('  api:\n    enabled: true\n    provider: railway', '  api:\n    enabled: true\n    provider: custom-host'));
		const report = collectTreeseedHostedServiceChecks({ tenantRoot: root, target: 'staging' });
		expect(report.checks.some((check) => check.serviceKey === 'operationsRunner')).toBe(false);
		expect(report.checks.some((check) => check.status === 'warning' && check.issues.some((issue) => issue.includes('custom-host')))).toBe(true);
	});
});
