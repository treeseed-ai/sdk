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
import { ProjectPlatformActionOptions, currentCommit, currentRef, recordTiming, resolveProjectPlatformBootstrapSystems, timedPhase, writeProviderTimingSummary, writeWorkflowStatus } from './project-platform-scope.ts';
import { repairHostingAfterSuccessfulDeploy, resolveReporter } from './repair-hosting-after-successful-deploy.ts';
import { TenantCloudflareDeployContext, prepareTenantCloudflareDeploy, reportDeployment, runTenantDataMigration, runTenantWebBuild, runTenantWebPublish } from './tenant-cloudflare-deploy-context.ts';
import { provisionProjectPlatform } from './provision-project-platform.ts';
import { publishContent } from './publish-content.ts';
import { monitorProjectPlatform } from './monitor-project-platform.ts';

export async function deployProjectPlatform(options: ProjectPlatformActionOptions) {
	writeWorkflowStatus(`deploy:start scope=${options.scope} planOnly=${options.planOnly ? 'true' : 'false'}`);
	const timings: TreeseedTimingEntry[] = [];
	const deployStartMs = performance.now();
	writeWorkflowStatus('deploy:resolve-reporter');
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	writeWorkflowStatus(`deploy:reporter kind=${reporter.kind} enabled=${reporter.enabled ? 'true' : 'false'}`);
	const commitSha = currentCommit(options.tenantRoot);
	const branchName = currentRef(options.tenantRoot);
	writeWorkflowStatus('deploy:resolve-bootstrap-systems');
	const bootstrapSystems = resolveProjectPlatformBootstrapSystems(options);
	const selectedSystems = new Set(bootstrapSystems);
	const execution = options.bootstrapExecution ?? 'parallel';
	const write = options.write;
	const env = { ...process.env, ...(options.env ?? {}) };
	writeWorkflowStatus(`deploy:bootstrap-systems ${bootstrapSystems.join(',') || '(none)'}`);
	writeWorkflowStatus('deploy:report-running');
	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'code',
		status: 'running',
		sourceRef: branchName,
		commitSha,
		triggeredByType: 'project_runner',
		metadata: { scope: options.scope },
	});
	writeWorkflowStatus('deploy:reported-running');

	if (!options.skipProvision) {
		writeWorkflowStatus('deploy:provision:start');
		const provision = await timedPhase(timings, 'deploy:provision', () => provisionProjectPlatform({ ...options, reporter, bootstrapSystems }));
		timings.push(...((provision as { timings?: TreeseedTimingEntry[] }).timings ?? []));
		writeWorkflowStatus('deploy:provision:done');
	}

	const nodes: Array<TreeseedBootstrapDagNode> = [];
	let cloudflareContext: TenantCloudflareDeployContext | null = null;
	if (options.scope === 'local' && selectedSystems.has('web')) {
		nodes.push({
			id: 'web:build',
			run: () => runTenantWebBuild({
				tenantRoot: options.tenantRoot,
				scope: 'local',
				planOnly: options.planOnly,
				env,
				write,
			}),
		});
	} else if (selectedSystems.has('data') || selectedSystems.has('web')) {
		cloudflareContext = prepareTenantCloudflareDeploy({
			tenantRoot: options.tenantRoot,
			scope: options.scope,
			planOnly: options.planOnly,
			write,
			env,
		});
	}
	if (cloudflareContext && selectedSystems.has('data')) {
		const context = cloudflareContext;
		nodes.push({
			id: 'data:d1-migrate',
			run: () => runTenantDataMigration(context),
		});
	}
	if (cloudflareContext && selectedSystems.has('web')) {
		const context = cloudflareContext;
		const contentNodeId = 'content:publish-runtime';
		nodes.push({
			id: contentNodeId,
			dependencies: selectedSystems.has('data') ? ['data:d1-migrate'] : [],
			run: () => publishContent({
				...options,
				reporter,
				bootstrapSystems: ['web'],
			}, reporter, { mode: 'production' }),
		});
		nodes.push({
			id: 'web:build',
			run: () => runTenantWebBuild(context),
		});
		nodes.push({
			id: 'web:publish',
			dependencies: ['web:build', contentNodeId, ...(selectedSystems.has('data') ? ['data:d1-migrate'] : [])],
			run: () => runTenantWebPublish(context),
		});
	}

	const serviceResultsByKey = new Map<string, Awaited<ReturnType<typeof deployRailwayService>>>();
	let selectedRailwayServiceKeys: string[] = [];
	if (options.scope !== 'local' && (selectedSystems.has('api') || selectedSystems.has('agents'))) {
		const validation = validateRailwayDeployPrerequisites(options.tenantRoot, options.scope, { env });
		const selectedServices = validation.services.filter((service) =>
			service.key === 'api' ? selectedSystems.has('api') : selectedSystems.has('agents'),
		);
		const sequentialRailwayDeploys = String(env.TREESEED_RAILWAY_DEPLOY_SEQUENTIAL ?? '').trim() === '1';
		let previousRailwayDeployNodeId: string | null = null;
		for (const service of selectedServices) {
			const system = service.key === 'api' ? 'api' : 'agents';
			const nodeId = `${system}:${service.key}-railway-deploy`;
			selectedRailwayServiceKeys.push(service.key);
			nodes.push({
				id: nodeId,
				dependencies: resolveRailwayServiceDeployDependencies({
					includeDataDependency: selectedSystems.has('data'),
					previousRailwayDeployNodeId,
					sequentialRailwayDeploys,
				}),
				run: async () => {
					const result = await deployRailwayService(options.tenantRoot, service, {
						planOnly: options.planOnly,
						write,
						env,
						prefix: {
							scope: options.scope,
							system,
							task: `${service.key}-railway-deploy`,
							stage: 'deploy',
						},
					});
					serviceResultsByKey.set(service.key, result);
					return result;
				},
			});
			if (sequentialRailwayDeploys) {
				previousRailwayDeployNodeId = nodeId;
			}
		}
	}

	const managesRailwaySchedules = options.scope === 'staging' || options.scope === 'prod';
	let railwaySchedules: any[] = [];
	let railwayScheduleVerification: any = { ok: true, checks: [], skipped: true, reason: !selectedSystems.has('agents') ? 'agents_not_selected' : !managesRailwaySchedules ? 'scope_not_scheduled' : 'plan' };
	if (managesRailwaySchedules && selectedSystems.has('agents')) {
		const agentDeployNodeIds = nodes
			.filter((node) => node.id.startsWith('agents:') && node.id.endsWith('-railway-deploy'))
			.map((node) => node.id);
		nodes.push({
			id: 'agents:schedules',
			dependencies: agentDeployNodeIds,
			run: async () => {
				writeTreeseedBootstrapLine(write, {
					scope: options.scope,
					system: 'agents',
					task: 'schedules',
					stage: 'deploy',
				}, 'Reconciling Railway schedules...');
				railwaySchedules = await ensureRailwayScheduledJobs(options.tenantRoot, options.scope, { planOnly: options.planOnly, env });
				railwayScheduleVerification = !options.planOnly
					? await verifyRailwayScheduledJobs(options.tenantRoot, options.scope)
					: { ok: true, checks: railwaySchedules, skipped: true, reason: 'plan' };
				return {
					service: 'railway-schedules',
					status: railwayScheduleVerification.ok ? 'verified' : 'failed',
					command: 'railway schedules reconcile',
					cwd: options.tenantRoot,
					publicBaseUrl: null,
					schedules: railwaySchedules,
					scheduleVerification: railwayScheduleVerification,
				};
			},
		});
	}

	await runTreeseedBootstrapDag({ nodes, execution, write, timings });

	const serviceResults = selectedRailwayServiceKeys
		.map((serviceKey) => serviceResultsByKey.get(serviceKey))
		.filter(Boolean);
	for (const result of serviceResults) {
		timings.push(...((result as { timings?: TreeseedTimingEntry[] }).timings ?? []));
	}
	if (options.scope !== 'local' && !options.planOnly && (selectedSystems.has('web') || serviceResults.length > 0)) {
		finalizeDeploymentState(options.tenantRoot, {
			target: createPersistentDeployTarget(options.scope),
			serviceResults,
			env,
		});
	}
	if (!managesRailwaySchedules || !selectedSystems.has('agents')) {
		railwaySchedules = [];
		railwayScheduleVerification = { ok: true, checks: railwaySchedules, skipped: true, reason: !selectedSystems.has('agents') ? 'agents_not_selected' : !managesRailwaySchedules ? 'scope_not_scheduled' : 'plan' };
	}
	if (selectedSystems.has('agents')) {
		serviceResults.push({
			service: 'railway-schedules',
			status: railwayScheduleVerification.ok ? 'verified' : 'failed',
			command: 'railway schedules reconcile',
			cwd: options.tenantRoot,
			publicBaseUrl: null,
			schedules: railwaySchedules,
			scheduleVerification: railwayScheduleVerification,
		});
	}
	const monitor = await timedPhase(timings, 'deploy:monitor', () => monitorProjectPlatform({ ...options, reporter, bootstrapSystems }));
	timings.push(...((monitor as { timings?: TreeseedTimingEntry[] }).timings ?? []));
	const hostingRepair = await timedPhase(timings, 'deploy:hosting-repair', () => repairHostingAfterSuccessfulDeploy(options, bootstrapSystems));
	recordTiming(timings, 'deploy:total', deployStartMs);
	writeProviderTimingSummary(options, timings);

	await reportDeployment(reporter, {
		environment: options.scope,
		deploymentKind: 'code',
		status: 'success',
		sourceRef: branchName,
		commitSha,
		triggeredByType: 'project_runner',
		metadata: {
			scope: options.scope,
			railway: options.scope === 'local' ? [] : configuredRailwayServices(options.tenantRoot, options.scope)
				.map((service) => service.key)
				.filter((serviceKey) => serviceKey === 'api' ? selectedSystems.has('api') : selectedSystems.has('agents')),
			monitor,
			hostingRepair,
			timings,
		},
		finishedAt: new Date().toISOString(),
	});

	return {
		ok: true,
		scope: options.scope,
		monitor,
		hostingRepair,
		serviceResults,
		timings,
	};
}

export function resolveRailwayServiceDeployDependencies({
	includeDataDependency,
	previousRailwayDeployNodeId,
	sequentialRailwayDeploys = false,
}: {
	includeDataDependency: boolean;
	previousRailwayDeployNodeId?: string | null;
	sequentialRailwayDeploys?: boolean;
}) {
	return [
		...(includeDataDependency ? ['data:d1-migrate'] : []),
		...(sequentialRailwayDeploys && previousRailwayDeployNodeId ? [previousRailwayDeployNodeId] : []),
	];
}

export async function publishProjectContent(options: ProjectPlatformActionOptions) {
	const reporter = resolveReporter(options.tenantRoot, options.reporter);
	return publishContent(options, reporter);
}
