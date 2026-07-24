import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';

import { existsSync, readFileSync } from 'node:fs';
import { readSourceModule, sourceFunctionBody } from '../../support/workspace-test-root.ts';

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
it('provisions configured provider resources before hosted deploy steps', () => {
		const source = readSourceModule(new URL('../../../src/operations/services/project-platform.ts', import.meta.url));
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
		const publishSource = sourceFunctionBody(source, 'publishContent');
		expect(publishSource).toContain('resolveTreeseedResourceIdentity(siteConfig, target).teamId');
		expect(publishSource).toContain("projectPlatformTempRoot(options.tenantRoot, 'content-publish')");
	});

it('writes provider timing summaries into deploy workflow GitHub step summaries', () => {
		const workflowPaths = [
			new URL('../../templates/github/deploy-web.workflow.yml', import.meta.url),
			new URL('../../../core/templates/github/deploy-web.workflow.yml', import.meta.url),
			new URL('../../../../.github/workflows/deploy-web.yml', import.meta.url),
		];

		for (const workflowPath of workflowPaths) {
			if (!existsSync(workflowPath)) {
				continue;
			}
			const source = readFileSync(workflowPath, 'utf8');
			expect(source).toContain('TREESEED_PROVIDER_TIMING_SUMMARY_PATH');
			expect(source).toContain('treeseed-provider-timing.md');
			expect(source).toContain('GITHUB_STEP_SUMMARY');
			expect(source).toContain('timeout-minutes: 30');
		}
	});

it('retries transient Cloudflare D1 Wrangler failures with provider-scale backoff', () => {
		const source = readSourceModule(new URL('../../../src/operations/services/project-platform.ts', import.meta.url));
		const retryStart = source.indexOf('async function runPrefixedWranglerWithRetry');
		const retrySource = source.slice(retryStart, source.indexOf('export type TenantCloudflareDeployContext', retryStart));

		expect(retryStart).toBeGreaterThanOrEqual(0);
		expect(source).toContain('const WRANGLER_TRANSIENT_MAX_ATTEMPTS = 6;');
		expect(source).toContain('const WRANGLER_COMMAND_TIMEOUT_MS = 180_000;');
		expect(source).toContain('function wranglerTransientRetryDelayMs');
		expect(source).toContain('code:\\s*7500');
		expect(retrySource).toContain('attempt <= WRANGLER_TRANSIENT_MAX_ATTEMPTS');
		expect(retrySource).toContain('timeoutMs: WRANGLER_COMMAND_TIMEOUT_MS');
		expect(retrySource).toContain('Math.round(retryDelayMs / 1000)');
		expect(retrySource).not.toContain('attempt <= 3');
	});

it('reconciles Railway Postgres volume naming through the IaC project graph', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const syncSource = sourceFunctionBody(source, 'syncRailwayEnvironmentForScope');
		const compiler = readSourceModule(new URL('../../../src/reconcile/providers/railway-iac.ts', import.meta.url));

		expect(syncSource).not.toBe('');
		expect(syncSource).toContain('renderRailwayIacProject');
		expect(syncSource).toContain('applyRailwayIacProject');
		expect(syncSource).not.toContain('ensureRailwayPostgresService({');
		expect(syncSource).not.toContain('ensureRailwayServiceVolume({');
		expect(compiler).toContain('const postgresVolumeName = `${input.database.serviceName}-volume`;');
		expect(compiler).toContain("'/var/lib/postgresql/data'");
	});

it('uses the Railway IaC graph for Treeseed operations runner reconciliation', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const syncSource = sourceFunctionBody(source, 'syncRailwayEnvironmentForScope');

		expect(syncSource).not.toBe('');
		expect(syncSource).toContain('planRailwayIacProject');
		expect(syncSource).toContain('validateRailwayIacChangeSet');
		expect(syncSource).toContain('applyRailwayIacProject');
		expect(syncSource).not.toContain('await ensureRailwayServiceVolume({');
		expect(syncSource).not.toContain('Railway API volume reconciliation did not mount');
		expect(syncSource).not.toContain('ensureRailwayServiceVolumeWithCliFallback');
		expect(syncSource).not.toContain('runRailway(');
	});

it('does not gate Railway runtime secrets behind managed-host CI exposure policy', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const syncStart = source.indexOf('function collectRailwayEnvironmentSync');
		const syncEnd = source.indexOf('function isLoopbackServiceUrl', syncStart);
		const syncSource = source.slice(syncStart, syncEnd);

		expect(syncStart).toBeGreaterThanOrEqual(0);
		expect(syncEnd).toBeGreaterThan(syncStart);
		expect(syncSource).toContain("entry.targets.includes(target)");
		expect(syncSource).not.toContain("shouldExposeManagedHostRuntimeSecret(input.context.deployConfig, entry.id)");
	});

it('verifies runner volume mounts through the Railway API view', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const verifySource = sourceFunctionBody(source, 'verifyRailwayUnit');

		expect(verifySource).not.toBe('');
		expect(verifySource).toContain('listRailwayVolumes({ projectId: entry.project.id, env: topology.env })');
		expect(verifySource).not.toContain('listRailwayServiceVolumesWithCli');
		expect(verifySource).toContain("source: 'api'");
	});

it('blocks on opaque Railway API environment creation failures without CLI fallback', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const fallbackStart = source.indexOf('async function ensureRailwayEnvironmentForService');
		const fallbackEnd = source.indexOf('async function resolveRailwayTopologyForScope', fallbackStart);
		const topologyStart = source.indexOf('async function resolveRailwayTopologyForScope');
		const topologyEnd = source.indexOf('async function ensureRailwayPostgresDataService', topologyStart);
		const fallbackSource = source.slice(fallbackStart, fallbackEnd);
		const topologySource = source.slice(topologyStart, topologyEnd);

		expect(fallbackStart).toBeGreaterThanOrEqual(0);
		expect(fallbackEnd).toBeGreaterThan(fallbackStart);
		expect(fallbackSource).toContain('Problem processing request');
		expect(fallbackSource).toContain('listRailwayEnvironments');
		expect(fallbackSource).toContain('Railway API environment provisioning failed');
		expect(fallbackSource).not.toContain('ensureRailwayProjectContext');
		expect(fallbackSource).not.toContain('runRailway(');
		expect(topologySource).toContain('ensureRailwayEnvironmentForService');
	});

it('refreshes Railway topology during service instance verification retries', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const topologySource = sourceFunctionBody(source, 'resolveRailwayTopologyForScope');
		const verifySource = sourceFunctionBody(source, 'verifyRailwayUnit');

		expect(topologySource).not.toBe('');
		expect(verifySource).not.toBe('');
		expect(topologySource).toContain('}, refresh);');
		expect(verifySource).toContain('refresh: true');
	});

it('does not expose a Railway CLI volume reconciliation fallback', () => {
		const source = readSourceModule(new URL('../../../src/operations/services/railway-deploy.ts', import.meta.url));
		expect(source).not.toContain('ensureRailwayServiceVolumeWithCliFallback');
		expect(source).not.toContain('listRailwayServiceVolumesWithCli');
		expect(source).not.toContain("'volume', '--service'");
		expect(source).not.toContain("'attach', '--volume'");
	});

it('does not adopt Railway one-volume service conflicts through CLI reconciliation', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const syncSource = sourceFunctionBody(source, 'syncRailwayEnvironmentForScope');

		expect(syncSource).not.toBe('');
		expect(syncSource).not.toContain('looksLikeRailwaySingleVolumeConflict');
		expect(syncSource).not.toContain('findRailwayVolumeMountedForService');
		expect(syncSource).toContain('applyRailwayIacProject');
	});

it('reattaches existing Railway volumes without temporary transfer resources or copying data', () => {
		const source = readSourceModule(new URL('../../../src/reconcile/builtin-adapters.ts', import.meta.url));
		const syncSource = sourceFunctionBody(source, 'syncRailwayEnvironmentForScope');

		expect(source).not.toContain('async function migrateSharedRailwayVolumes');
		expect(source).not.toContain('copyRailwayVolumeFilesWithCli');
		expect(source).not.toContain('treeseed-volume-migration-');
		expect(source).not.toContain('temporaryMigrationResourceNames');
		expect(syncSource).toContain('resolveRailwayIacVolumeBindings');
	});

it('allows Railway API project context resolution from a project id alone', () => {
		const source = readSourceModule(new URL('../../../src/operations/services/railway-deploy.ts', import.meta.url));
		const helperSource = sourceFunctionBody(source, 'resolveRailwayDeployProjectContext');

		expect(helperSource).not.toBe('');
		expect(helperSource).toContain('if (service.projectId)');
		expect(helperSource).toContain('projectId: service.projectId');
		expect(helperSource).toContain('return service');
	});

it('does not expose a Railway CLI volume lister for verification fallback', () => {
		const source = readSourceModule(new URL('../../../src/operations/services/railway-deploy.ts', import.meta.url));
		expect(source).not.toContain('export function listRailwayServiceVolumesWithCli');
		expect(source).not.toContain('normalizeRailwayCliVolumeList');
	});
});
