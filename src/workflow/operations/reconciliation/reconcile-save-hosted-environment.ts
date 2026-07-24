import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectReconcileStatus, reconcileTarget } from "../../../reconcile/index.ts";
import { collectEnvironmentContext, collectConfigSeedValues, setMachineEnvironmentValue } from "../../../operations/services/configuration/config-runtime.ts";
import { createPersistentDeployTarget, purgeSourcePageCaches } from "../../../operations/services/hosting/deployment/deploy.ts";
import { highestStableGitTagOnLine } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { discoverPackageAdapters } from "../../../operations/services/reconciliation/package-adapters.ts";
import { collectLiveHostedServiceChecks } from "../../../operations/services/hosting/audit/live-hosted-service-checks.ts";
import { configuredRailwayServices, waitForRailwayManagedDeploymentsSettled } from "../../../operations/services/hosting/railway/railway-deploy.ts";
import { compileHostingGraph } from "../../../hosting/graph.ts";
import { type WorkflowRunCommand } from "../../runs.ts";
import type { WorkflowOperationId } from "../../../operations/workflow.ts";
import { WorkflowOperationHelpers } from '../recovery/workflow-write.ts';
import { selectorFromWorkflowHostingGraph } from '../packages/normalize-release-candidate-mode.ts';
import { workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { stringRecord } from '../repositories/gates-for-saved-repository-reports.ts';

export async function reconcileSaveHostedEnvironment(
	root: string,
	environment: 'staging' | 'prod',
	helpers: WorkflowOperationHelpers,
	workflowRunId: string,
	operation: Extract<WorkflowOperationId, 'save' | 'release'> = 'save',
	envOverlay: Record<string, string | undefined> = {},
	options: { liveAppId?: string } = {},
) {
	const target = createPersistentDeployTarget(environment);
	const env = {
		...helpers.context.env,
		...collectConfigSeedValues(root, environment, helpers.context.env),
		...envOverlay,
	};
	const graph = compileHostingGraph({ tenantRoot: root, environment, env });
	const selector = selectorFromWorkflowHostingGraph(graph);
	if (process.env.TREESEED_WORKFLOW_HOSTED_RECONCILE_MODE === 'skip') {
		return {
			status: 'skipped' as const, 			reason: 'disabled', 			environment,
			selectedApps: [...new Set(graph.units.map((unit) => unit.application?.id).filter((value): value is string => Boolean(value)))],
			selectedResources: graph.units.map((unit) => ({
				id: unit.id, 				host: unit.host.id, 				serviceType: unit.serviceType.id, 				placement: unit.placement, 				serviceName: typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null,
			})),
		};
	}
	const reconcileSession = new Map<string, unknown>([['workflowRunId', workflowRunId]]);
	helpers.write(`[${operation}][workflow] Reconciling ${environment} hosted deployments for ${graph.units.length} selected resources.`);
	const reconcile = await reconcileTarget({
		tenantRoot: root,
		target,
		env,
		selector,
		planOnly: false,
		write: (line) => helpers.write(`[${operation}][reconcile] ${line}`, 'stderr'),
		session: reconcileSession,
	});
	const status = await collectReconcileStatus({
		tenantRoot: root,
		target,
		env,
		selector,
		session: reconcileSession,
	});
	if (!status.ready) {
		workflowError(operation, 'hosted_reconcile_failed', `Hosted reconciliation for ${environment} did not verify:\n${status.blockers.join('\n')}`, {
			details: { environment, selector, status, reconcile },
		});
	}
	const selectedRailwayServiceNames = new Set(graph.units
		.filter((unit) => unit.host.id === 'railway')
		.map((unit) => typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null)
		.filter((value): value is string => Boolean(value)));
	const selectedRailwayServices = configuredRailwayServices(root, environment, env)
		.filter((service) => selectedRailwayServiceNames.has(service.serviceName));
	if (selectedRailwayServices.length > 0) {
		const deployments = await waitForRailwayManagedDeploymentsSettled(root, environment, {
			services: selectedRailwayServices, 			env, 			timeoutMs: operation === 'release' ? 900_000 : 600_000, 			onProgress: (line, stream) => helpers.write(`[${operation}][railway] ${line}`, stream),
		});
		if (!deployments.ok) {
			const deploymentFailures = deployments.checks
				.filter((check) => check.ok !== true && check.skipped !== true)
				.map((check) => `${check.serviceName ?? check.service}: ${check.message ?? check.status ?? 'deployment did not settle'}`);
			workflowError(operation, 'hosted_deployment_failed', `Hosted Railway deployments for ${environment} did not settle:\n${deploymentFailures.join('\n')}`, {
				details: { environment, selector, deployments, reconcile },
			});
		}
	}
	const live = await collectLiveHostedServiceChecks({
		tenantRoot: root,
		target: environment,
		appId: options.liveAppId,
		strict: true,
		requireLiveRailway: true,
		requireLiveHttp: true,
		env,
	});
	const liveFailures = [
		...live.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
		...live.liveObservation.issues,
	];
	if (liveFailures.length > 0) {
		workflowError(operation, 'hosted_live_verification_failed', `Hosted live verification for ${environment} failed:\n${liveFailures.join('\n')}`, {
			details: { environment, selector, live, reconcile },
		});
	}
	return {
		status: 'reconciled' as const,
		environment,
		selectedApps: [...new Set(graph.units.map((unit) => unit.application?.id).filter((value): value is string => Boolean(value)))],
		selectedResources: graph.units.map((unit) => ({
			id: unit.id, 			host: unit.host.id, 			serviceType: unit.serviceType.id, 			placement: unit.placement, 			serviceName: typeof unit.config.serviceName === 'string' ? unit.config.serviceName : null,
		})),
		reconcile,
		postApplyStatus: status,
		liveVerification: live,
	};
}

export async function runReleaseWebLiveVerification(
	root: string,
	environment: 'prod',
	helpers: WorkflowHelpers,
	operation: WorkflowRunCommand,
) {
	if (process.env.TREESEED_WORKFLOW_RELEASE_GATES_MODE === 'skip') {
		return { status: 'skipped' as const, environment, reason: 'release gates disabled' };
	}
	const env = {
		...helpers.context.env,
		...collectConfigSeedValues(root, environment, helpers.context.env),
	};
	let purge;
	try {
		purge = purgeSourcePageCaches(root, { target: environment, env });
	} catch (error) {
		workflowError(operation, 'hosted_live_verification_failed', `Production web cache purge failed before root live verification:\n${error instanceof Error ? error.message : String(error)}`, {
			details: { environment },
		});
	}
	if (purge?.skipped) {
		workflowError(operation, 'hosted_live_verification_failed', `Production web cache purge was skipped before root live verification: ${purge.reason ?? 'unknown reason'}`, {
			details: { environment, purge },
		});
	}
	helpers.write(`[${operation}][cloudflare] purged production source page cache for ${purge?.urls?.length ?? 0} urls before web live verification.`, 'stderr');
	const live = await collectLiveHostedServiceChecks({
		tenantRoot: root,
		target: environment,
		appId: 'web',
		serviceKeys: ['web'],
		strict: true,
		requireLiveRailway: false,
		requireLiveHttp: true,
		env,
	});
	const liveFailures = [
		...live.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
		...live.liveObservation.issues,
	];
	if (liveFailures.length > 0) {
		workflowError(operation, 'hosted_live_verification_failed', `Production web live verification failed after root deployment:\n${liveFailures.join('\n')}`, {
			details: { environment, live },
		});
	}
	return live;
}

export async function verifyReleaseApiEnvironmentIsolation(
	root: string,
	helpers: WorkflowHelpers,
	releaseImageRefs: Record<string, string>,
) {
	const reports: Record<string, Awaited<ReturnType<typeof collectLiveHostedServiceChecks>>> = {};
	for (const environment of ['prod', 'staging'] as const) {
		const env = {
			...helpers.context.env, 			...collectConfigSeedValues(root, environment, helpers.context.env),
			...(environment === 'prod' ? releaseImageRefs : {}),
		};
		helpers.write(`[release][railway] read-only ${environment} source-invariance verification started.`, 'stderr');
		const report = await collectLiveHostedServiceChecks({
			tenantRoot: root, 			target: environment, 			appId: 'api',
			serviceKeys: ['api', 'operationsRunner', 'public-treedx-node-01'],
			strict: true, 			requireLiveRailway: true, 			requireLiveHttp: true, 			env,
		});
		const failures = [
			...report.checks.filter((check) => check.status === 'failed').map((check) => `${check.id}: ${check.issues.join('; ') || 'failed'}`),
			...report.liveObservation.issues,
		];
		if (failures.length > 0) {
			workflowError('release', 'hosted_live_verification_failed', `${environment} API source-invariance verification failed after production deployment:\n${failures.join('\n')}`, {
				details: { environment, report },
			});
		}
		reports[environment] = report;
		helpers.write(`[release][railway] read-only ${environment} source-invariance verification passed.`, 'stderr');
	}
	return { status: 'verified', order: ['prod', 'staging'], reports };
}

export function productionReleaseImageRefEnv(selectedVersions: Map<string, string>) {
	const refs: Record<string, string> = {};
	const apiVersion = selectedVersions.get('@treeseed/api');
	if (apiVersion) {
		refs.TREESEED_API_IMAGE_REF = `treeseed/api:${apiVersion}`;
		refs.TREESEED_OPERATIONS_RUNNER_IMAGE_REF = `treeseed/op-runner:${apiVersion}`;
	}
	const agentVersion = selectedVersions.get('@treeseed/agent');
	if (agentVersion) {
		refs.TREESEED_AGENT_MANAGER_IMAGE_REF = `treeseed/agent-manager:${agentVersion}`;
		refs.TREESEED_AGENT_RUNNER_IMAGE_REF = `treeseed/agent-runner:${agentVersion}`;
	}
	const treedxVersion = selectedVersions.get('treedx') ?? selectedVersions.get('@treeseed/treedx');
	if (treedxVersion) {
		refs.TREESEED_PUBLIC_TREEDX_IMAGE_REF = `treeseed/treedx:${treedxVersion}`;
	}
	return refs;
}

export function productionReleaseImageRefVersions(root: string, selectedVersions: Map<string, string>) {
	const versions = new Map(selectedVersions);
	for (const adapter of discoverPackageAdapters(root)) {
		const prodSource = stringRecord(adapter.metadata.deploymentSource)?.prod;
		const imageBackedPackage = ['@treeseed/api', '@treeseed/agent', 'treedx', '@treeseed/treedx'].includes(adapter.id);
		if (prodSource !== 'image' && !imageBackedPackage) continue;
		if (versions.has(adapter.id) || !adapter.version) continue;
		const line = stableVersionLine(adapter.version);
		const stableVersion = (line ? highestStableGitTagOnLine(adapter.dir, line) : null) ?? adapter.version;
		versions.set(adapter.id, stableVersion);
	}
	for (const [packageName, relativePath] of [['@treeseed/api', 'packages/api'], ['@treeseed/agent', 'packages/agent']] as const) {
		if (versions.has(packageName)) continue;
		const packageRoot = resolve(root, relativePath);
		const packageJsonPath = resolve(packageRoot, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const version = stringRecord(JSON.parse(readFileSync(packageJsonPath, 'utf8'))).version;
		if (typeof version !== 'string') continue;
		const line = stableVersionLine(version);
		versions.set(packageName, (line ? highestStableGitTagOnLine(packageRoot, line) : null) ?? version);
	}
	return versions;
}

export function persistProductionReleaseImageRefs(root: string, releaseImageRefs: Record<string, string>) {
	const registry = collectEnvironmentContext(root);
	const entries = new Map(registry.entries.map((entry) => [entry.id, entry]));
	const persisted: Record<string, string> = {};
	for (const [id, value] of Object.entries(releaseImageRefs)) {
		const entry = entries.get(id) ?? { id, storage: 'scoped' as const, sensitivity: 'plain' as const };
		if (entry.sensitivity === 'secret') {
			workflowError('release', 'validation_failed', `Production release image ref ${id} must be a non-secret environment value.`);
		}
		setMachineEnvironmentValue(root, 'prod', entry, value);
		persisted[id] = value;
	}
	return persisted;
}

export function stableVersionLine(version: string) {
	const match = version.match(/^(\d+\.\d+)\.\d+(?:-[0-9A-Za-z.-]+)?$/u);
	return match?.[1] ?? null;
}
