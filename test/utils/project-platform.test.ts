import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControlPlaneReporter } from '../../src/control-plane.ts';
import {
	monitorProjectPlatform,
	publishProjectContent,
	resolveRailwayServiceDeployDependencies,
} from '../../src/operations/services/project-platform.ts';

const tempRoots = new Set<string>();

function noopReporter(): ControlPlaneReporter {
	return {
		kind: 'noop',
		enabled: false,
		async reportEnvironment() {},
		async reportResource() {},
		async reportDeployment() {},
		async registerAgentPoolHeartbeat() {},
		async reportScaleDecision() {},
		async reportWorkdaySummary() {},
		async getProjectCapacityPlan() { return null; },
		async createCapacityReservation() { return null; },
		async reportCapacityEstimate() { return null; },
		async reportCapacityUsage() {},
		async reportCapacityRoutingDecision() { return null; },
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
    execution: stub
    mutation: local_branch
    repository: stub
    verification: stub
    notification: stub
    research: stub
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
	delete process.env.TREESEED_WORKER_POOL_SCALER;
});

describe('project platform workflow actions', () => {
	it('provisions configured provider resources before hosted deploy steps', () => {
		const source = readFileSync(new URL('../../src/operations/services/project-platform.ts', import.meta.url), 'utf8');
		const deployStart = source.indexOf('export async function deployProjectPlatform');
		const provisionCall = source.indexOf("timedPhase(timings, 'deploy:provision'", deployStart);
		const cloudflarePrepare = source.indexOf('cloudflareContext = prepareTenantCloudflareDeploy', deployStart);
		const contentPublish = source.indexOf("const contentNodeId = 'content:publish-runtime';", deployStart);
		const railwayDeploy = source.indexOf('deployRailwayService(options.tenantRoot, service', deployStart);

		expect(deployStart).toBeGreaterThanOrEqual(0);
		expect(provisionCall).toBeGreaterThan(deployStart);
		expect(cloudflarePrepare).toBeGreaterThan(provisionCall);
		expect(contentPublish).toBeGreaterThan(cloudflarePrepare);
		expect(railwayDeploy).toBeGreaterThan(provisionCall);
		expect(source.slice(deployStart, cloudflarePrepare)).toContain('if (!options.skipProvision)');
		expect(source.slice(contentPublish, railwayDeploy)).toContain("mode: 'production'");
		expect(source.slice(contentPublish, railwayDeploy)).toContain("dependencies: ['web:build', contentNodeId");
		expect(source.slice(source.indexOf('async function publishContent'), deployStart)).toContain('resolveTreeseedResourceIdentity(siteConfig, target).teamId');
	});

	it('writes provider timing summaries into deploy workflow GitHub step summaries', () => {
		const workflowPaths = [
			new URL('../../../../.github/workflows/deploy-web.yml', import.meta.url),
			new URL('../../templates/github/deploy-web.workflow.yml', import.meta.url),
			new URL('../../../core/templates/github/deploy-web.workflow.yml', import.meta.url),
		];

		for (const workflowPath of workflowPaths) {
			const source = readFileSync(workflowPath, 'utf8');
			expect(source).toContain('TREESEED_PROVIDER_TIMING_SUMMARY_PATH');
			expect(source).toContain('treeseed-provider-timing.md');
			expect(source).toContain('GITHUB_STEP_SUMMARY');
		}
	});

	it('does not manually create replacement volumes for Railway Postgres plugin services', () => {
		const source = readFileSync(new URL('../../src/reconcile/builtin-adapters.ts', import.meta.url), 'utf8');
		const databaseStart = source.indexOf('async function ensureRailwayMarketDatabaseForScope');
		const databaseEnd = source.indexOf('async function observeRailwayUnit', databaseStart);
		const databaseSource = source.slice(databaseStart, databaseEnd);

		expect(databaseStart).toBeGreaterThanOrEqual(0);
		expect(databaseEnd).toBeGreaterThan(databaseStart);
		expect(databaseSource).toContain('Railway Postgres creates and owns its backing volume asynchronously');
		expect(databaseSource).not.toContain('await ensureRailwayServiceVolume({');
	});

	it('uses the Railway CLI volume path for market operations runner reconciliation', () => {
		const source = readFileSync(new URL('../../src/reconcile/builtin-adapters.ts', import.meta.url), 'utf8');
		const syncStart = source.indexOf('async function syncRailwayEnvironmentForScope');
		const syncEnd = source.indexOf('async function ensureRailwayMarketDatabaseForScope', syncStart);
		const syncSource = source.slice(syncStart, syncEnd);

		expect(syncStart).toBeGreaterThanOrEqual(0);
		expect(syncEnd).toBeGreaterThan(syncStart);
		expect(syncSource).toContain('ensureRailwayServiceVolumeWithCliFallback');
		expect(syncSource).toContain("preferCli: entry.configuredService.key === 'marketOperationsRunner'");
	});

	it('verifies runner volume mounts through the Railway API view', () => {
		const source = readFileSync(new URL('../../src/reconcile/builtin-adapters.ts', import.meta.url), 'utf8');
		const verifyStart = source.indexOf('async function verifyRailwayUnit');
		const verifyEnd = source.indexOf('function railwayVerificationMaySettle', verifyStart);
		const verifySource = source.slice(verifyStart, verifyEnd);

		expect(verifyStart).toBeGreaterThanOrEqual(0);
		expect(verifyEnd).toBeGreaterThan(verifyStart);
		expect(verifySource).toContain('listRailwayVolumes({ projectId: entry.project.id, env: topology.env })');
		expect(verifySource).not.toContain('listRailwayServiceVolumesWithCli');
		expect(verifySource).toContain("source: 'api'");
	});

	it('falls back to Railway CLI environment creation for opaque API failures', () => {
		const source = readFileSync(new URL('../../src/reconcile/builtin-adapters.ts', import.meta.url), 'utf8');
		const fallbackStart = source.indexOf('async function ensureRailwayEnvironmentForService');
		const fallbackEnd = source.indexOf('async function resolveRailwayTopologyForScope', fallbackStart);
		const topologyStart = source.indexOf('async function resolveRailwayTopologyForScope');
		const topologyEnd = source.indexOf('async function ensureRailwayPostgresDataService', topologyStart);
		const fallbackSource = source.slice(fallbackStart, fallbackEnd);
		const topologySource = source.slice(topologyStart, topologyEnd);

		expect(fallbackStart).toBeGreaterThanOrEqual(0);
		expect(fallbackEnd).toBeGreaterThan(fallbackStart);
		expect(fallbackSource).toContain('Problem processing request');
		expect(fallbackSource).toContain('ensureRailwayProjectContext');
		expect(fallbackSource).toContain('allowFailure: true');
		expect(fallbackSource).toContain('listRailwayEnvironments');
		expect(topologySource).toContain('ensureRailwayEnvironmentForService');
	});

	it('refreshes Railway topology during service instance verification retries', () => {
		const source = readFileSync(new URL('../../src/reconcile/builtin-adapters.ts', import.meta.url), 'utf8');
		const topologyStart = source.indexOf('async function resolveRailwayTopologyForScope');
		const topologyEnd = source.indexOf('async function syncRailwayEnvironmentForScope', topologyStart);
		const verifyStart = source.indexOf('async function verifyRailwayUnit');
		const verifyEnd = source.indexOf('function railwayVerificationMaySettle', verifyStart);
		const topologySource = source.slice(topologyStart, topologyEnd);
		const verifySource = source.slice(verifyStart, verifyEnd);

		expect(topologyStart).toBeGreaterThanOrEqual(0);
		expect(topologyEnd).toBeGreaterThan(topologyStart);
		expect(verifyStart).toBeGreaterThanOrEqual(0);
		expect(verifyEnd).toBeGreaterThan(verifyStart);
		expect(topologySource).toContain('}, refresh);');
		expect(verifySource).toContain('refresh: true');
	});

	it('waits for Railway CLI-created runner volumes to become API-visible mounts', () => {
		const source = readFileSync(new URL('../../src/operations/services/railway-deploy.ts', import.meta.url), 'utf8');
		const fallbackStart = source.indexOf('export async function ensureRailwayServiceVolumeWithCliFallback');
		const fallbackEnd = source.indexOf('export async function deployRailwayService', fallbackStart);
		const fallbackSource = source.slice(fallbackStart, fallbackEnd);

		expect(fallbackStart).toBeGreaterThanOrEqual(0);
		expect(fallbackEnd).toBeGreaterThan(fallbackStart);
		expect(fallbackSource).toContain("'attach', '--volume'");
		expect(fallbackSource.indexOf('ensureRailwayProjectContext')).toBeLessThan(fallbackSource.indexOf("'volume', '--service'"));
		expect(fallbackSource).toContain('allowFailure: true');
		expect(fallbackSource).toContain('already mounted');
		expect(fallbackSource).toContain('waitForRailwayServiceVolumeMount');
		expect(fallbackSource).toContain('listRailwayVolumes({ projectId, env })');
		expect(fallbackSource.indexOf('const mounted = volumes.find')).toBeLessThan(fallbackSource.indexOf('entry.name === volumeName'));
		expect(fallbackSource).not.toContain("'update', '--volume'");
	});

	it('allows Railway CLI project context linking from a project id alone', () => {
		const source = readFileSync(new URL('../../src/operations/services/railway-deploy.ts', import.meta.url), 'utf8');
		const helperStart = source.indexOf('export function ensureRailwayProjectExists');
		const helperEnd = source.indexOf('export function ensureRailwayEnvironmentExists', helperStart);
		const helperSource = source.slice(helperStart, helperEnd);

		expect(helperStart).toBeGreaterThanOrEqual(0);
		expect(helperEnd).toBeGreaterThan(helperStart);
		expect(helperSource).toContain('const projectId');
		expect(helperSource).toContain('entry.id === projectId');
		expect(helperSource).toContain("return { id: projectId, name: '' }");
	});

	it('exposes a safe Railway CLI volume lister for verification fallback', () => {
		const source = readFileSync(new URL('../../src/operations/services/railway-deploy.ts', import.meta.url), 'utf8');
		const helperStart = source.indexOf('export function listRailwayServiceVolumesWithCli');
		const helperEnd = source.indexOf('export function isUsableRailwayToken', helperStart);
		const helperSource = source.slice(helperStart, helperEnd);

		expect(helperStart).toBeGreaterThanOrEqual(0);
		expect(helperEnd).toBeGreaterThan(helperStart);
		expect(helperSource).toContain("'volume', '--service'");
		expect(helperSource).toContain('allowFailure: true');
		expect(helperSource).toContain('normalizeRailwayCliVolumeList');
		expect(helperSource).toContain('serviceName');
	});


	it('chains Railway service deploy dependencies to avoid concurrent remote builds', () => {
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: true,
			previousRailwayDeployNodeId: null,
		})).toEqual(['data:d1-migrate']);
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: true,
			previousRailwayDeployNodeId: 'api:api-railway-deploy',
		})).toEqual(['data:d1-migrate', 'api:api-railway-deploy']);
		expect(resolveRailwayServiceDeployDependencies({
			includeDataDependency: false,
			previousRailwayDeployNodeId: 'agents:manager-railway-deploy',
		})).toEqual(['agents:manager-railway-deploy']);
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
			dryRun: true,
			reporter: noopReporter(),
			bootstrapSystems: ['data', 'web'],
		});

		expect(result.checks.apiHealth).toMatchObject({ ok: true, skipped: true, reason: 'api_not_selected' });
		expect(result.checks.agentHealth).toMatchObject({ ok: true, skipped: true, reason: 'agents_not_selected' });
		expect(fetched.every((url) => !url.startsWith('https://api.example.com'))).toBe(true);
	});

	it('uses Market API health endpoints for api services', async () => {
		const tenantRoot = await createTenantFixture(`surfaces:
  api:
    enabled: true
    provider: railway
services:
  api:
    enabled: true
    provider: railway
    railway:
      startCommand: node ./src/api/server.js
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
			dryRun: true,
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

	it('does not probe root Market worker runner scale readiness after provider migration', async () => {
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
			dryRun: true,
			reporter: noopReporter(),
			bootstrapSystems: ['data', 'web'],
		});

		expect(result.checks.scaleProbe).toMatchObject({
			ok: true,
			skipped: true,
			mocked: true,
			serviceId: null,
		});
	});

	it('uses market operations runner readiness instead of old worker-runner scale readiness', async () => {
		const tenantRoot = await createTenantFixture(`services:
  marketOperationsRunner:
    enabled: true
    provider: railway
    railway:
      projectName: treeseed-market
      serviceName: treeseed-market-operations-runner
`);
		vi.stubGlobal('fetch', vi.fn(async () => new Response('ok', { status: 200 })));

		const result = await monitorProjectPlatform({
			tenantRoot,
			scope: 'local',
			dryRun: true,
			reporter: noopReporter(),
			bootstrapSystems: ['agents'],
		});

		expect(result.checks.scaleProbe).toMatchObject({
			ok: true,
			mocked: true,
			serviceName: 'treeseed-market-operations-runner',
			runnerKind: 'market_operations_runner',
		});
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
