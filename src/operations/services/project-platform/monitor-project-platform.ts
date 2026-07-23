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
import { ProjectPlatformAction, ProjectPlatformActionOptions, WEB_PLATFORM_BOOTSTRAP_SYSTEMS, currentCommit, currentRef, resolveProjectPlatformBootstrapSystems, timedPhase, writeWorkflowStatus } from './project-platform-scope.ts';
import { probeHttp, resolveImmediatePagesProbeUrl, resolveReporter } from './repair-hosting-after-successful-deploy.ts';
import { probeR2, resolveApiMonitorEndpoints, resolveImmediateApiProbeUrl } from './resolve-immediate-api-probe-url.ts';
import { reportDeployment } from './tenant-cloudflare-deploy-context.ts';
import { deployProjectPlatform, publishProjectContent } from './deploy-project-platform.ts';

export async function monitorProjectPlatform(options: ProjectPlatformActionOptions) {
	const timings: TreeseedTimingEntry[] = [];
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	const env = { ...process.env, ...(options.env ?? {}) };
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	const selectedSystems = new Set(resolveProjectPlatformBootstrapSystems(options, siteConfig));
	const apiSelected = selectedSystems.has('api');
	const agentsSelected = selectedSystems.has('agents');
	const state = loadDeployState(options.tenantRoot, siteConfig, { target });
	const webProbeUrl = resolveImmediatePagesProbeUrl(siteConfig, state, target);
	const apiBaseUrl = resolveImmediateApiProbeUrl(siteConfig, state, target);
	const apiMonitorEndpoints = resolveApiMonitorEndpoints(siteConfig, apiBaseUrl);
	const railwayResourcesPromise = options.scope === 'local' || (!apiSelected && !agentsSelected)
		? { ok: true, skipped: true, reason: options.scope === 'local' ? 'local_scope' : 'railway_not_selected' }
		: timedPhase(timings, 'monitor:railway-resources', () => verifyRailwayManagedResources(options.tenantRoot, options.scope, {
			env,
			settleDeployments: true,
			onProgress: options.write,
		}));
	const skippedApiCheck = apiSelected
		? { ok: false, skipped: true, reason: 'api_url_unconfigured' }
		: { ok: true, skipped: true, reason: 'api_not_selected' };
	const skippedAgentCheck = agentsSelected
		? { ok: false, skipped: true, reason: 'api_url_unconfigured' }
		: { ok: true, skipped: true, reason: 'agents_not_selected' };
	const skippedD1Check = apiMonitorEndpoints.processingAgentApi
		? { ok: true, skipped: true, reason: 'processing_agent_api' }
		: skippedApiCheck;
	const pagesProbeOptions = options.scope === 'prod'
		? { attempts: 18, delayMs: 10000 }
		: { attempts: 3, delayMs: 5000 };
	const checks = {
		pages: timedPhase(timings, 'monitor:probe-pages', () => probeHttp(webProbeUrl, pagesProbeOptions)),
		apiHealth: apiSelected && apiMonitorEndpoints.apiHealth ? timedPhase(timings, 'monitor:probe-api-health', () => probeHttp(apiMonitorEndpoints.apiHealth, { attempts: 8, delayMs: 10000 })) : Promise.resolve(skippedApiCheck),
		apiReady: apiSelected && apiMonitorEndpoints.apiReady ? timedPhase(timings, 'monitor:probe-api-ready', () => probeHttp(apiMonitorEndpoints.apiReady, { attempts: 8, delayMs: 10000 })) : Promise.resolve(skippedApiCheck),
		d1Health: apiSelected && apiMonitorEndpoints.d1Health ? timedPhase(timings, 'monitor:probe-d1-health', () => probeHttp(apiMonitorEndpoints.d1Health, { attempts: 8, delayMs: 10000 })) : Promise.resolve(skippedD1Check),
		agentHealth: agentsSelected && apiMonitorEndpoints.agentHealth ? timedPhase(timings, 'monitor:probe-agent-health', () => probeHttp(apiMonitorEndpoints.agentHealth, { attempts: 8, delayMs: 10000 })) : Promise.resolve(skippedAgentCheck),
		r2: options.planOnly ? Promise.resolve({ ok: true, skipped: true, reason: 'plan' }) : timedPhase(timings, 'monitor:probe-r2', () => probeR2(options.tenantRoot, siteConfig, state, target)),
		railwayResources: Promise.resolve(railwayResourcesPromise),
		readiness: state.readiness,
		apiMonitor: {
			ok: true,
			processingAgentApi: apiMonitorEndpoints.processingAgentApi,
			endpoints: apiMonitorEndpoints,
		},
	};
	const resolvedChecks = {
		...checks,
		pages: await checks.pages,
		apiHealth: await checks.apiHealth,
		apiReady: await checks.apiReady,
		d1Health: await checks.d1Health,
		agentHealth: await checks.agentHealth,
		r2: await checks.r2,
		railwayResources: await checks.railwayResources,
	};
	const ok = [
		resolvedChecks.pages,
		resolvedChecks.apiHealth,
		resolvedChecks.apiReady,
		resolvedChecks.d1Health,
		resolvedChecks.agentHealth,
		resolvedChecks.r2,
		resolvedChecks.railwayResources,
	].every((check) => check?.ok === true || check?.skipped === true);
	if (!ok) {
		const failedChecks = Object.entries(resolvedChecks)
			.filter(([, check]) => check && typeof check === 'object' && check.ok !== true && check.skipped !== true)
			.map(([name, check]) => `${name}: ${JSON.stringify(check)}`);
		throw new Error(`Treeseed monitor failed for ${options.scope}.\n${failedChecks.join('\n')}`);
	}
	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'mixed',
		status: 'success',
		sourceRef: currentRef(options.tenantRoot),
		commitSha: currentCommit(options.tenantRoot),
		triggeredByType: 'project_runner',
		metadata: {
			mode: 'monitor',
			target: deployTargetLabel(target),
			checks: resolvedChecks,
			timings,
		},
		finishedAt: new Date().toISOString(),
	});
	return {
		ok,
		target: deployTargetLabel(target),
		checks: resolvedChecks,
		timings,
	};
}

export async function syncControlPlaneState(options: ProjectPlatformActionOptions) {
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	const state = loadDeployState(options.tenantRoot, siteConfig, { target });
	await reporter.reportEnvironment({
		environment: options.scope,
		deploymentProfile: siteConfig.hosting?.kind ?? 'self_hosted_project',
		baseUrl: state.lastDeployedUrl,
		cloudflareAccountId: String(process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? siteConfig.cloudflare.accountId ?? '').trim() || null,
		pagesProjectName: state.pages?.projectName ?? null,
		workerName: state.workerName,
		r2BucketName: state.content?.bucketName ?? null,
		d1DatabaseName: state.d1Databases?.SITE_DATA_DB?.databaseName ?? null,
		railwayProjectName: state.services.api?.provider === 'railway' ? state.services.api?.lastDeployedUrl ?? null : null,
		metadata: { target: deployTargetLabel(target) },
	});
}

export async function runProjectPlatformAction(action: ProjectPlatformAction, options: ProjectPlatformActionOptions) {
	const previousWorkflowAction = process.env.TREESEED_WORKFLOW_ACTION;
	const previousWorkflowPlane = process.env.TREESEED_WORKFLOW_PLANE;
	process.env.TREESEED_WORKFLOW_ACTION = action;
	process.env.TREESEED_WORKFLOW_PLANE = previousWorkflowPlane ?? 'all';
	writeWorkflowStatus(`action:start ${action} scope=${options.scope}`);
	writeWorkflowStatus('action:apply-environment:start');
	applyTreeseedEnvironmentToProcess({ tenantRoot: options.tenantRoot, scope: options.scope, override: true });
	writeWorkflowStatus('action:apply-environment:done');
	writeWorkflowStatus('action:resolve-reporter:start');
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	writeWorkflowStatus(`action:resolve-reporter:done kind=${reporter.kind} enabled=${reporter.enabled ? 'true' : 'false'}`);
	try {
		switch (action) {
			case 'deploy_web':
				return await deployProjectPlatform({
					...options,
					reporter,
					bootstrapSystems: options.bootstrapSystems ?? WEB_PLATFORM_BOOTSTRAP_SYSTEMS,
				});
			case 'publish_content':
				return await publishProjectContent({ ...options, reporter });
			case 'monitor':
				return await monitorProjectPlatform({ ...options, reporter });
			default:
				throw new Error(`Unsupported workflow action "${action}".`);
		}
	} catch (error) {
		await reportDeployment(reporter, {
			environment: options.scope,
			deploymentKind: action === 'publish_content'
					? 'content'
					: action === 'deploy_web'
						? 'code'
						: 'mixed',
			status: 'failed',
			sourceRef: currentRef(options.tenantRoot),
			commitSha: currentCommit(options.tenantRoot),
			triggeredByType: 'project_runner',
			metadata: {
				message: error instanceof Error ? error.message : String(error),
			},
			finishedAt: new Date().toISOString(),
		}).catch(() => undefined);
		throw error;
	} finally {
		if (previousWorkflowAction === undefined) {
			delete process.env.TREESEED_WORKFLOW_ACTION;
		} else {
			process.env.TREESEED_WORKFLOW_ACTION = previousWorkflowAction;
		}
		if (previousWorkflowPlane === undefined) {
			delete process.env.TREESEED_WORKFLOW_PLANE;
		} else {
			process.env.TREESEED_WORKFLOW_PLANE = previousWorkflowPlane;
		}
	}
}
