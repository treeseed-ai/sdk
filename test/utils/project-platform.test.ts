import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
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

	it('fails publish-content preflight with deploy readiness errors before R2 operations', async () => {
		const tenantRoot = await createTenantFixture();

		await expect(publishProjectContent({
			tenantRoot,
			scope: 'staging',
			reporter: noopReporter(),
		})).rejects.toThrow(/Treeseed environment (?:is not ready for deploy \(staging\)|staging has not been initialized)/u);
	});
});
