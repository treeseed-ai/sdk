import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../git-runner.ts';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { elapsedMs, formatTimingMarkdown, formatTimingSummary, type TreeseedTimingEntry } from '../../../timing.ts';
import {
	createControlPlaneReporter,
	type ControlPlaneDeploymentReport,
	type ControlPlaneReporter,
} from '../../../control-plane.ts';
import {
	resolvePublishedContentPreviewTtlHours,
	resolveTeamScopedContentLocator,
	signEditorialPreviewToken,
	type PublishedContentManifest,
	type PublishedContentObjectPointer,
} from '../../../platform/published-content.ts';
import { createPublishedContentPipeline } from '../../../platform/published-content-pipeline.ts';
import { collectTreeseedReconcileStatus, reconcileTreeseedTarget, resolveTreeseedBootstrapSelection } from '../../../reconcile/index.ts';
import { loadTreeseedManifest } from '../../../platform/tenant-config.ts';
import { applyTreeseedEnvironmentToProcess, assertTreeseedCommandEnvironment } from '../config-runtime.ts';
import { runTreeseedHostingAudit } from '../hosting-audit.ts';
import {
	assertDeploymentInitialized,
	createPersistentDeployTarget,
	deployTargetLabel,
	ensureGeneratedWranglerConfig,
	finalizeDeploymentState,
	loadDeployState,
	markDeploymentInitialized,
	purgePublishedContentCaches,
	resolveConfiguredCloudflareAccountId,
	resolveConfiguredSurfaceBaseUrl,
	resolveTreeseedResourceIdentity,
	runRemoteD1Migrations,
	syncCloudflareSecrets,
	writeDeployState,
} from '../deploy.ts';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from '../git-workflow.ts';
import {
	configuredRailwayServices,
	deployRailwayService,
	ensureRailwayScheduledJobs,
	validateRailwayDeployPrerequisites,
	validateRailwayServiceConfiguration,
	verifyRailwayManagedResources,
	verifyRailwayScheduledJobs,
} from '../railway-deploy.ts';
import { loadCliDeployConfig, packageScriptPath } from '../runtime-tools.ts';
import { resolveTreeseedToolCommand } from '../../../managed-dependencies.ts';
import type { TreeseedRunnableBootstrapSystem } from '../../../reconcile/index.ts';
import { runPrefixedCommand, runTreeseedBootstrapDag, sleep, writeTreeseedBootstrapLine, type TreeseedBootstrapDagNode, type TreeseedBootstrapExecution, type TreeseedBootstrapTaskPrefix, type TreeseedBootstrapWriter } from '../bootstrap-runner.ts';
import { runTenantDeployPreflight } from '../save-deploy-preflight.ts';
import { findFirstMatchingString } from './repair-hosting-after-successful-deploy.ts';
import { runWrangler } from './project-platform-scope.ts';
import { projectPlatformTempRoot, readR2JsonObject, writeTempFile } from './tenant-cloudflare-deploy-context.ts';

export function resolveImmediateApiProbeUrl(siteConfig, state, target) {
	const configuredUrl = resolveConfiguredSurfaceBaseUrl(siteConfig, target, 'api')
		?? siteConfig.services?.api?.environments?.[target.kind === 'persistent' ? target.scope : 'prod']?.baseUrl
		?? siteConfig.services?.api?.publicBaseUrl
		?? process.env.TREESEED_API_BASE_URL
		?? state.services?.api?.lastDeployedUrl
		?? null;
	if (configuredUrl) {
		return configuredUrl;
	}
	const railwayHost = findFirstMatchingString(
		state,
		(value) => /^[a-z0-9-]+\.up\.railway\.app$/iu.test(String(value).trim()),
	);
	if (railwayHost) {
		return `https://${railwayHost}`;
	}
	return null;
}

export function resolveApiMonitorEndpoints(siteConfig, apiBaseUrl: string | null) {
	if (!apiBaseUrl) {
		return {
			apiHealth: null,
			apiReady: null,
			d1Health: null,
			agentHealth: null,
			processingAgentApi: false,
		};
	}
	const baseUrl = String(apiBaseUrl).replace(/\/+$/u, '');
	return {
		apiHealth: `${baseUrl}/healthz`,
		apiReady: `${baseUrl}/readyz`,
		d1Health: `${baseUrl}/healthz/deep`,
		agentHealth: null,
		processingAgentApi: false,
	};
}

export function r2HealthKey(state) {
	return `${state.content?.manifestKey?.replace(/\/common\.json$/u, '') ?? 'health'}/healthchecks/${Date.now()}.json`;
}

export function deleteR2Object(
	tenantRoot: string,
	bucketName: string,
	objectKey: string,
	wranglerPath: string,
	wranglerEnv: Record<string, string | undefined>,
) {
	runWrangler(tenantRoot, [
		'r2',
		'object',
		'delete',
		`${bucketName}/${objectKey}`,
		'--config',
		wranglerPath,
		'--remote',
	], wranglerEnv, { allowFailure: true });
}

export function probeR2(
	tenantRoot: string,
	siteConfig,
	state,
	target,
) {
	const bucketName = state.content?.bucketName;
	const cloudflareAccountId = String(process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim();
	if (!bucketName) {
		return { ok: false, skipped: true, reason: 'r2_unconfigured' };
	}
	const { wranglerPath } = ensureGeneratedWranglerConfig(tenantRoot, { target });
	const wranglerEnv = { CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId };
	const tempRoot = mkdtempSync(join(projectPlatformTempRoot(tenantRoot, 'r2-health'), 'treeseed-r2-health-'));
	const objectKey = r2HealthKey(state);
	try {
		const payload = JSON.stringify({ ok: true, createdAt: new Date().toISOString() });
		const writeFile = writeTempFile(tempRoot, 'probe.json', payload);
		runWrangler(tenantRoot, [
			'r2',
			'object',
			'put',
			`${bucketName}/${objectKey}`,
			'--config',
			wranglerPath,
			'--remote',
			'--force',
			'--file',
			writeFile,
			'--content-type',
			'application/json',
		], wranglerEnv);
		const readBack = readR2JsonObject(tenantRoot, bucketName, objectKey, wranglerPath, wranglerEnv);
		return {
			ok: Boolean(readBack?.ok),
			objectKey,
		};
	} finally {
		deleteR2Object(tenantRoot, bucketName, objectKey, wranglerPath, wranglerEnv);
		rmSync(tempRoot, { recursive: true, force: true });
	}
}
