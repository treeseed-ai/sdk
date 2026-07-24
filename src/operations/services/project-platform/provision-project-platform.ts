import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { elapsedMs, formatTimingMarkdown, formatTimingSummary, type TimingEntry } from '../../../entrypoints/runtime/timing.ts';
import {
	createControlPlaneReporter,
	type ControlPlaneDeploymentReport,
	type ControlPlaneReporter,
} from '../../../entrypoints/clients/control-plane.ts';
import {
	resolvePublishedContentPreviewTtlHours,
	resolveTeamScopedContentLocator,
	signEditorialPreviewToken,
	type PublishedContentManifest,
	type PublishedContentObjectPointer,
} from '../../../platform/packages/published-content.ts';
import { createPublishedContentPipeline } from '../../../platform/packages/published-content-pipeline.ts';
import { collectReconcileStatus, reconcileTarget, resolveBootstrapSelection } from '../../../reconcile/index.ts';
import { loadManifest } from '../../../platform/configuration/tenant-config.ts';
import { applyEnvironmentToProcess, assertCommandEnvironment } from '../configuration/config-runtime.ts';
import { runHostingAudit } from '../hosting/audit/hosting-audit.ts';
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
	resolveResourceIdentity,
	runRemoteD1Migrations,
	syncCloudflareSecrets,
	writeDeployState,
} from '../hosting/deployment/deploy.ts';
import { currentManagedBranch, PRODUCTION_BRANCH, STAGING_BRANCH } from '../operations/git-workflow.ts';
import {
	configuredRailwayServices,
	deployRailwayService,
	ensureRailwayScheduledJobs,
	validateRailwayDeployPrerequisites,
	validateRailwayServiceConfiguration,
	verifyRailwayManagedResources,
	verifyRailwayScheduledJobs,
} from '../hosting/railway/railway-deploy.ts';
import { loadCliDeployConfig, packageScriptPath } from '../agents/runtime-tools.ts';
import { resolveToolCommand } from '../../../entrypoints/runtime/managed-dependencies.ts';
import type { RunnableBootstrapSystem } from '../../../reconcile/index.ts';
import { runPrefixedCommand, runBootstrapDag, sleep, writeBootstrapLine, type BootstrapDagNode, type BootstrapExecution, type BootstrapTaskPrefix, type BootstrapWriter } from '../operations/bootstrap-runner.ts';
import { runTenantDeployPreflight } from '../hosting/deployment/save-deploy-preflight.ts';
import { ProjectPlatformActionOptions, currentCommit, currentRef, resolveProjectPlatformBootstrapSystems, timedPhase, writeWorkflowStatus } from './project-platform-scope.ts';
import { resolveReporter } from './repair-hosting-after-successful-deploy.ts';
import { reportDeployment } from './tenant-cloudflare-deploy-context.ts';

export async function provisionProjectPlatform(options: ProjectPlatformActionOptions) {
	writeWorkflowStatus(`provision:start scope=${options.scope}`);
	const timings: TimingEntry[] = [];
	writeWorkflowStatus('provision:resolve-reporter');
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	writeWorkflowStatus(`provision:reporter kind=${reporter.kind} enabled=${reporter.enabled ? 'true' : 'false'}`);
	const target = createPersistentDeployTarget(options.scope === 'local' ? 'staging' : options.scope);
	writeWorkflowStatus(`provision:target ${deployTargetLabel(target)}`);
	const siteConfig = loadCliDeployConfig(options.tenantRoot);
	writeWorkflowStatus('provision:resolve-bootstrap-systems');
	const bootstrapSystems = resolveProjectPlatformBootstrapSystems(options, siteConfig);
	const selectedSystems = new Set(bootstrapSystems);
	const env = { ...process.env, ...(options.env ?? {}) };
	writeWorkflowStatus(`provision:reconcile:start systems=${bootstrapSystems.join(',') || '(none)'}`);
	const summary = await timedPhase(timings, 'provision:reconcile', () => reconcileTarget({
		tenantRoot: options.tenantRoot,
		target,
		env,
		systems: bootstrapSystems,
		write: options.write,
		planOnly: options.planOnly,
	}));
	writeWorkflowStatus('provision:reconcile:done');
	timings.push(...((summary as { timings?: TimingEntry[] }).timings ?? []));
	writeWorkflowStatus('provision:collect-reconcile-status:start');
	const verification = await timedPhase(timings, 'provision:collect-reconcile-status', () => collectReconcileStatus({
		tenantRoot: options.tenantRoot,
		target,
		env,
		systems: bootstrapSystems,
	}));
	writeWorkflowStatus('provision:collect-reconcile-status:done');
	if (selectedSystems.has('data') || selectedSystems.has('web')) {
		writeWorkflowStatus('provision:ensure-wrangler-config:start');
		await timedPhase(timings, 'provision:ensure-wrangler-config', () => {
			ensureGeneratedWranglerConfig(options.tenantRoot, { target });
		});
		writeWorkflowStatus('provision:ensure-wrangler-config:done');
	} else {
		writeWorkflowStatus('provision:ensure-wrangler-config:skipped');
	}
	const shouldValidateRailway = selectedSystems.has('api') || selectedSystems.has('agents');
	const railwayValidation = shouldValidateRailway
		? options.scope === 'local'
			? validateRailwayServiceConfiguration(options.tenantRoot, options.scope)
			: validateRailwayDeployPrerequisites(options.tenantRoot, options.scope, { env })
		: { services: [] };
	const railwaySchedules = [];
	const railwayScheduleVerification = {
		ok: true,
		checks: [],
		skipped: true,
		reason: 'deploy_only',
	};
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
		railwayProjectName: railwayValidation.services[0]?.projectName ?? null,
		metadata: {
			target: deployTargetLabel(target),
			previewEnabled: state.previewEnabled ?? false,
			readiness: state.readiness,
		},
	});

	const resourceReports = [
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'pages' as const,
			logicalName: state.pages?.projectName ?? 'pages',
			locator: state.pages?.url ?? null,
			metadata: state.pages ?? {},
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'worker' as const,
			logicalName: state.workerName,
			locator: state.lastDeployedUrl ?? null,
			metadata: { workerName: state.workerName },
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'kv' as const,
			logicalName: state.kvNamespaces?.FORM_GUARD_KV?.name ?? 'form-guard',
			locator: state.kvNamespaces?.FORM_GUARD_KV?.id ?? null,
			metadata: state.kvNamespaces?.FORM_GUARD_KV ?? {},
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'turnstile-widget' as const,
			logicalName: state.turnstileWidgets?.formGuard?.name ?? 'form-guard-turnstile',
			locator: state.turnstileWidgets?.formGuard?.sitekey ?? null,
			metadata: state.turnstileWidgets?.formGuard ?? {},
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'r2' as const,
			logicalName: state.content?.bucketName ?? 'content',
			locator: state.content?.manifestKey ?? null,
			metadata: state.content ?? {},
		},
		{
			environment: options.scope,
			provider: 'cloudflare' as const,
			resourceKind: 'd1' as const,
			logicalName: state.d1Databases?.SITE_DATA_DB?.databaseName ?? 'site-data',
			locator: state.d1Databases?.SITE_DATA_DB?.databaseId ?? null,
			metadata: state.d1Databases?.SITE_DATA_DB ?? {},
		},
	];

	for (const resource of resourceReports) {
		await reporter.reportResource(resource);
	}
	for (const service of railwayValidation.services) {
		await reporter.reportResource({
			environment: options.scope,
			provider: 'railway',
			resourceKind: service.serviceId ? 'railway_service' : 'railway_project',
			logicalName: service.key,
			locator: service.serviceName ?? service.serviceId ?? service.projectName ?? service.projectId ?? null,
			metadata: service,
		});
	}
	for (const schedule of railwaySchedules) {
		const serviceState = state.services?.[schedule.service];
		if (serviceState) {
			serviceState.lastScheduleSyncAt = new Date().toISOString();
		}
		state.railwaySchedules[schedule.logicalName] = {
			...(state.railwaySchedules[schedule.logicalName] ?? {}),
			...schedule,
			lastSyncedAt: new Date().toISOString(),
		};
		await reporter.reportResource({
			environment: options.scope,
			provider: 'railway',
			resourceKind: 'railway_schedule',
			logicalName: schedule.logicalName,
			locator: schedule.id ?? schedule.expression,
			metadata: schedule,
		});
	}
	writeDeployState(options.tenantRoot, state, { target });
	markDeploymentInitialized(options.tenantRoot, { target });

	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'provision',
		status: 'success',
		sourceRef: currentRef(options.tenantRoot),
		commitSha: currentCommit(options.tenantRoot),
		triggeredByType: 'project_runner',
		metadata: {
			target: deployTargetLabel(target),
			summary,
			verification,
			timings,
			reconcileActions: summary.results.map((result) => ({
				unitId: result.unit.unitId,
				action: result.action,
				provider: result.unit.provider,
			})),
			railwayServices: railwayValidation.services.map((service) => service.key),
			railwaySchedules,
			railwayScheduleVerification,
		},
		finishedAt: new Date().toISOString(),
	});

	return {
		ok: true,
		scope: options.scope,
		target: deployTargetLabel(target),
		summary,
		verification,
		timings,
		railway: {
			services: railwayValidation.services.map((service) => service.key),
			schedules: railwaySchedules,
			verification: railwayScheduleVerification,
		},
	};
}
