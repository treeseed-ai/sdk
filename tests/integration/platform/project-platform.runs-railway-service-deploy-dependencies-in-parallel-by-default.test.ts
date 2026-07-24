import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { existsSync, readFileSync } from 'node:fs';
import { readSourceModule } from '../../support/workspace-test-root.ts';

import { join } from 'node:path';

import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ControlPlaneReporter } from '../../../src/control-plane.ts';

import {
	monitorProjectPlatform,
	publishProjectContent,
	resolveRailwayServiceDeployDependencies,
} from '../../../src/operations/services/project-platform.ts';

const tempRoots = new Set<string>();

function noopReporter(): ControlPlaneReporter {
	return {
		kind: 'noop',
		enabled: false,
		async reportEnvironment() {},
		async reportResource() {},
		async reportDeployment() {},
		async createApprovalRequest() { return null; },
	};
}

async function createTenantFixture(configExtra = '') {
	const tenantRoot = await mkdtemp(join(tmpdir(), 'treeseed-sdk-project-platform-'));
	tempRoots.add(tenantRoot);
	await mkdir(join(tenantRoot, 'src'), { recursive: true });
	await writeFile(
		join(tenantRoot, 'src/manifest.yaml'),
		'id: test-site\nsiteConfigPath: ./src/config.yaml\ncontent:\n  pages: ./src/content/pages\n  books: ./src/content/books\n  docs: ./src/content/knowledge\n',
	);
	await writeFile(
		join(tenantRoot, 'treeseed.site.yaml'),
		`name: Test Site
slug: test-site
siteUrl: https://example.com
contactEmail: hello@example.com
hosting:
  kind: hosted_project
  teamId: acme
  projectId: docs
cloudflare:
  accountId: account-123
providers:
  forms: store_only
  agents:
    execution: codex
    mutation: local_branch
    repository: git
    verification: local
    notification: sdk_message
    research: project_graph
  deploy: cloudflare
  content:
    runtime: team_scoped_r2_overlay
    publish: team_scoped_r2_overlay
    docs: default
  site: default
turnstile:
  enabled: false
${configExtra}`,
	);
	return tenantRoot;
}

afterEach(async () => {
	vi.unstubAllGlobals();
	for (const root of tempRoots) {
		await rm(root, { recursive: true, force: true });
	}
	tempRoots.clear();
	delete process.env.TREESEED_API_BASE_URL;
	delete process.env.TREESEED_RAILWAY_DEPLOY_SEQUENTIAL;
});
describe('project platform workflow actions', () => {
it('runs Railway service deploy dependencies in parallel by default', () => {
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: true,
			previousRailwayDeployNodeId: null,
		})).toEqual(['data:d1-migrate']);
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: true,
			previousRailwayDeployNodeId: 'api:api-railway-deploy',
		})).toEqual(['data:d1-migrate']);
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: false,
			previousRailwayDeployNodeId: 'agents:manager-railway-deploy',
		})).toEqual([]);
	});

it('can restore sequential Railway service deploy dependencies with an env fallback', () => {
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: true,
			previousRailwayDeployNodeId: 'api:api-railway-deploy',
			sequentialRailwayDeploys: true,
		})).toEqual(['data:d1-migrate', 'api:api-railway-deploy']);
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: false,
			previousRailwayDeployNodeId: 'agents:manager-railway-deploy',
			sequentialRailwayDeploys: true,
		})).toEqual(['agents:manager-railway-deploy']);
	});

it('records redacted Railway deploy child timing entries', () => {
		const source = readSourceModule(new URL('../../../src/operations/services/railway-deploy.ts', import.meta.url));
		const deployStart = source.indexOf('export async function deployRailwayService');
		const deploySource = source.slice(deployStart);

		expect(deploySource).toContain("timedRailwayPhase(timings, 'railway:resolve-context'");
		expect(deploySource).toContain("timedRailwayPhase(timings, 'railway:sync-runtime-config'");
		expect(deploySource).toContain("railwayPhaseTimeoutMs(commandEnv, 'sync_runtime_config')");
		expect(source).toContain("if (phase === 'sync_runtime_config')");
		expect(source).toContain("writePhase(`sync-runtime-config:${stage}`, message)");
		expect(deploySource).toContain("timedRailwayPhase(timings, 'railway:device-login-vars'");
		expect(deploySource).toContain("timedRailwayPhase(timings, 'railway:predeploy-build'");
		expect(deploySource).toContain("timedRailwayPhase(timings, 'railway:api-deploy'");
		expect(deploySource).not.toContain('metadata: { env');
		expect(deploySource).toContain('service: cliDeployService.key');
	});

it('starts monitor probes concurrently once endpoints are known', async () => {
		const tenantRoot = await createTenantFixture(`surfaces:
  api:
    enabled: true
    provider: railway
services:
  api:
    enabled: true
    provider: railway
    railway:
      startCommand: npm run start:api
`);
		const fetched: string[] = [];
		const releases: Array<() => void> = [];
		vi.stubGlobal('fetch', vi.fn(async (input) => {
			fetched.push(String(input));
			return await new Promise<Response>((resolve) => {
				releases.push(() => resolve(new Response(JSON.stringify({ ok: true }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				})));
			});
		}));
		process.env.TREESEED_API_BASE_URL = 'https://api.example.com';

		const monitoring = monitorProjectPlatform({
			tenantRoot,
			scope: 'local',
			planOnly: true,
			reporter: noopReporter(),
			bootstrapSystems: ['api'],
		});

		for (let attempt = 0; attempt < 20 && fetched.length < 4; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		expect(fetched.some((url) => url.endsWith('/healthz'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/readyz'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/healthz/deep'))).toBe(true);
		expect(fetched.length).toBeGreaterThanOrEqual(4);
		for (const release of releases) {
			release();
		}

		const result = await monitoring;
		expect(result.checks.apiHealth).toMatchObject({ ok: true });
		expect(result.checks.apiReady).toMatchObject({ ok: true });
		expect(result.checks.d1Health).toMatchObject({ ok: true });
	});

it('skips API and agent monitor probes when runtime systems are not selected', async () => {
		const tenantRoot = await createTenantFixture();
		const fetched: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (input) => {
			fetched.push(String(input));
			return new Response('ok', { status: 200 });
		}));
		process.env.TREESEED_API_BASE_URL = 'https://api.example.com';

		const result = await monitorProjectPlatform({
			tenantRoot,
			scope: 'staging',
			planOnly: true,
			reporter: noopReporter(),
			bootstrapSystems: ['data', 'web'],
		});

		expect(result.checks.apiHealth).toMatchObject({ ok: true, skipped: true, reason: 'api_not_selected' });
		expect(result.checks.agentHealth).toMatchObject({ ok: true, skipped: true, reason: 'agents_not_selected' });
		expect(fetched.every((url) => !url.startsWith('https://api.example.com'))).toBe(true);
	});

it('probes the configured staging web domain instead of the Pages preview alias', async () => {
		const tenantRoot = await createTenantFixture(`surfaces:
  web:
    enabled: true
    provider: cloudflare
    publicBaseUrl: https://example.com
    environments:
      staging:
        domain: staging.example.com
`);
		await mkdir(join(tenantRoot, '.treeseed/state/environments/staging'), { recursive: true });
		await writeFile(
			join(tenantRoot, '.treeseed/state/environments/staging/deploy.json'),
			`${JSON.stringify({
				pages: {
					projectName: 'test-site',
					stagingBranch: 'staging',
				},
			}, null, 2)}\n`,
		);
		const fetched: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (input) => {
			fetched.push(String(input));
			return new Response('ok', { status: 200 });
		}));

		await monitorProjectPlatform({
			tenantRoot,
			scope: 'staging',
			planOnly: true,
			reporter: noopReporter(),
			bootstrapSystems: ['web'],
		});

		expect(fetched).toContain('https://staging.example.com');
		expect(fetched).not.toContain('https://staging.test-site.pages.dev');
	});

it('uses API health endpoints for api services', async () => {
		const tenantRoot = await createTenantFixture(`surfaces:
  api:
    enabled: true
    provider: railway
services:
  api:
    enabled: true
    provider: railway
    railway:
      startCommand: npm run start:api
`);
		const fetched: string[] = [];
		vi.stubGlobal('fetch', vi.fn(async (input) => {
			fetched.push(String(input));
			return new Response(JSON.stringify({ ok: true }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}));
		process.env.TREESEED_API_BASE_URL = 'https://api.example.com';

		const result = await monitorProjectPlatform({
			tenantRoot,
			scope: 'local',
			planOnly: true,
			reporter: noopReporter(),
			bootstrapSystems: ['api', 'agents'],
		});

		expect(result.checks.apiMonitor).toMatchObject({ ok: true, processingAgentApi: false });
		expect(result.checks.d1Health).toMatchObject({ ok: true });
		expect(fetched.some((url) => url.endsWith('/healthz'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/readyz'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/agent/healthz'))).toBe(false);
		expect(fetched.some((url) => url.endsWith('/healthz/deep'))).toBe(true);
		expect(fetched.some((url) => url.endsWith('/internal/core/agent/healthz'))).toBe(false);
	});

it('does not expose the retired worker-pool scale probe after provider migration', async () => {
		const tenantRoot = await createTenantFixture(`services:
  workerRunner:
    enabled: true
    provider: railway
    railway:
      projectName: test-site
`);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

		const result = await monitorProjectPlatform({
			tenantRoot,
			scope: 'staging',
			planOnly: true,
			reporter: noopReporter(),
			bootstrapSystems: ['data', 'web'],
		});

		expect(result.checks).not.toHaveProperty('scaleProbe');
	});

it('fails publish-content preflight with deploy readiness errors before R2 operations', async () => {
		const tenantRoot = await createTenantFixture();

		await expect(publishProjectContent({
			tenantRoot,
			scope: 'staging',
			reporter: noopReporter(),
		})).rejects.toThrow(/Treeseed environment (?:is not ready for deploy \(staging\)|staging has not been initialized)/u);
	});
});
