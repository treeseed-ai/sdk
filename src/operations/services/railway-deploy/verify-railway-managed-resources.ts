import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadCliDeployConfig } from '../runtime-tools.ts';
import { resolveTreeseedMachineEnvironmentValues } from '../config-runtime.ts';
import { createPersistentDeployTarget, resolveTreeseedResourceIdentity } from '../deploy.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../git-runner.ts';
import { discoverTreeseedApplications } from '../../../hosting/apps.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from '../railway-source-policy.ts';
import { runPrefixedCommand, sleep, type TreeseedBootstrapTaskPrefix, type TreeseedBootstrapWriter } from '../bootstrap-runner.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	ensureRailwayServiceVolume,
	deployRailwayServiceInstance,
	getRailwayServiceInstance,
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	railwayGraphqlRequest,
	resolveRailwayApiToken,
	resolveRailwayApiUrl,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../railway-api.ts';
import { elapsedMs, formatDurationMs, type TreeseedTimingEntry } from '../../../timing.ts';
import { resolveRailwayAuthToken } from './railway-status-deployment-terminal-failure.ts';
import { configuredRailwayServices, resolveRailwayScheduleTarget } from './configured-railway-services.ts';
import { configuredEnvValue, deriveRailwayCapacityProviderRunnerVolumeName, deriveRailwayOperationsRunnerVolumeName, deriveRailwayWorkerRunnerVolumeName, envValue } from './normalize-scope.ts';
import { verifyRailwayScheduledJobs } from './ensure-railway-scheduled-jobs.ts';
import { waitForRailwayManagedDeploymentsSettled } from './wait-for-railway-managed-deployments-settled.ts';

export async function verifyRailwayManagedResources(
	tenantRoot,
	scope,
	{
		fetchImpl = fetch,
		apiToken,
		apiUrl,
		env = process.env,
		settleDeployments = false,
		settleTimeoutMs = 600_000,
		settlePollMs = 15_000,
		onProgress,
	} = {},
) {
	const effectiveApiToken = apiToken || resolveRailwayAuthToken(env);
	const effectiveApiUrl = apiUrl || resolveRailwayApiUrl(env);
	const effectiveEnv = { ...env, TREESEED_RAILWAY_API_TOKEN: effectiveApiToken, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl };
	const services = configuredRailwayServices(tenantRoot, scope);
	const checks = [];
	const deploymentStatusServices = [];

	for (const service of services) {
		const target = await resolveRailwayScheduleTarget({
			projectId: service.projectId,
			projectName: service.projectName,
			serviceId: service.serviceId,
			serviceName: service.serviceName,
			environment: normalizeRailwayEnvironmentName(service.railwayEnvironment),
			environmentId: envValue('TREESEED_RAILWAY_ENVIRONMENT_ID') || null,
		}, {
			env: effectiveEnv,
			fetchImpl,
			ensure: false,
		});
		if (!target.project || !target.environment || !target.service) {
			checks.push({
				type: 'service',
				service: service.key,
				serviceName: service.serviceName,
				projectName: service.projectName,
				environment: service.railwayEnvironment,
				ok: false,
				status: 'missing',
				message: `Railway service ${service.serviceName} is missing in ${service.railwayEnvironment}.`,
			});
			continue;
		}
		deploymentStatusServices.push({
			...service,
			projectId: target.project.id,
		});
		const instance = await getRailwayServiceInstance({
			serviceId: target.service.id,
			environmentId: target.environment.id,
			env: effectiveEnv,
			fetchImpl,
		});
		checks.push({
			type: 'service-instance',
			service: service.key,
			serviceName: target.service.name,
			serviceId: target.service.id,
			projectId: target.project.id,
			environment: target.environment.name,
			environmentId: target.environment.id,
			instanceId: instance.id,
			ok: Boolean(instance.id),
			status: instance.id ? 'checked' : 'missing',
			observed: instance.id
				? {
					rootDirectory: instance.rootDirectory,
					startCommand: instance.startCommand,
					cronSchedule: instance.cronSchedule,
					sleepApplication: instance.sleepApplication,
					runtimeMode: instance.runtimeMode,
				}
				: null,
			message: instance.id
				? undefined
				: `Railway service instance for ${target.service.name} is missing in ${target.environment.name}.`,
		});
		const expectedVolumeMountPath = service.volumeMountPath ?? service.runnerPool?.volumeMountPath ?? null;
		if (expectedVolumeMountPath) {
			const expectedVolumeName = service.key === 'operationsRunner'
				? deriveRailwayOperationsRunnerVolumeName(target.service.name, target.environment.name)
				: service.key === 'capacityProviderRunner'
					? deriveRailwayCapacityProviderRunnerVolumeName(target.service.name, target.environment.name)
				: deriveRailwayWorkerRunnerVolumeName(target.service.name, target.environment.name);
			const volumes = await listRailwayVolumes({
				projectId: target.project.id,
				env: effectiveEnv,
				fetchImpl,
			});
			const volume = volumes.find((candidate) =>
				candidate.name === expectedVolumeName
				&& candidate.instances.some((entry) =>
					entry.serviceId === target.service.id
					&& entry.environmentId === target.environment.id
					&& entry.mountPath === expectedVolumeMountPath),
			) ?? null;
			checks.push({
				type: 'service-volume',
				service: service.key,
				serviceName: target.service.name,
				serviceId: target.service.id,
				projectId: target.project.id,
				environment: target.environment.name,
				environmentId: target.environment.id,
				volumeName: expectedVolumeName,
				mountPath: expectedVolumeMountPath,
				ok: Boolean(volume),
				status: volume ? 'checked' : 'missing',
				observed: volume
					? {
						id: volume.id,
						name: volume.name,
						instances: volume.instances,
					}
					: null,
				message: volume
					? undefined
					: `Railway volume ${expectedVolumeName} is missing or is not mounted on ${target.service.name} at ${expectedVolumeMountPath}.`,
			});
		}
	}

	const schedules = await verifyRailwayScheduledJobs(tenantRoot, scope, {
		fetchImpl,
		apiToken: effectiveApiToken,
		apiUrl: effectiveApiUrl,
		env: effectiveEnv,
	});
	for (const check of schedules.checks ?? []) {
		checks.push({
			type: 'schedule',
			...check,
		});
	}
	if (settleDeployments) {
		const settled = await waitForRailwayManagedDeploymentsSettled(tenantRoot, scope, {
			services: deploymentStatusServices.length > 0 ? deploymentStatusServices : services,
			env: effectiveEnv,
			fetchImpl,
			timeoutMs: settleTimeoutMs,
			pollMs: settlePollMs,
			onProgress,
		});
		for (const check of settled.checks ?? []) {
			checks.push(check);
		}
	}

	return {
		ok: checks.every((entry) => entry.ok === true || entry.skipped === true),
		checks,
	};
}

export function railwayPhaseTimeoutMs(env = process.env, phase = 'default') {
	const configured = Number.parseInt(configuredEnvValue(env, `TREESEED_RAILWAY_${String(phase).toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_TIMEOUT_MS`), 10);
	if (Number.isFinite(configured) && configured > 0) {
		return configured;
	}
	const defaultConfigured = Number.parseInt(configuredEnvValue(env, 'TREESEED_RAILWAY_PHASE_TIMEOUT_MS'), 10);
	if (Number.isFinite(defaultConfigured) && defaultConfigured > 0) {
		return defaultConfigured;
	}
	if (phase === 'sync_runtime_config') {
		return 600_000;
	}
	return phase === 'deploy' ? 300_000 : 180_000;
}

export async function withRailwayPhaseTimeout(run, timeoutMs, message) {
	let timer: NodeJS.Timeout | null = null;
	try {
		return await Promise.race([
			Promise.resolve().then(run),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

export function shouldRunRailwayPredeployBuild(env = process.env) {
	const configured = configuredEnvValue(env, 'TREESEED_RAILWAY_PREDEPLOY_BUILD');
	if (configured === '1' || configured === 'true') {
		return true;
	}
	if (configured === '0' || configured === 'false') {
		return false;
	}
	return configuredEnvValue(env, 'CI') !== 'true';
}

export async function syncRailwayApiDeviceLoginVariables(service, env, write, prefix, fetchImpl = fetch) {
	if (service.key !== 'api') {
		return null;
	}
	const projectId = configuredEnvValue(service, 'projectId');
	const environmentId = configuredEnvValue(service, 'environmentId');
	const serviceId = configuredEnvValue(service, 'serviceId');
	if (!projectId || !environmentId || !serviceId) {
		return null;
	}
	const variables = Object.fromEntries(
		[
			'TREESEED_API_AUTH_APPROVAL_BASE_URL',
			'TREESEED_SITE_URL',
			'TREESEED_BETTER_AUTH_URL',
		]
			.map((key) => [key, configuredEnvValue(env, key)])
			.filter(([, value]) => value),
	);
	if (Object.keys(variables).length === 0) {
		return null;
	}
	await upsertRailwayVariables({
		projectId,
		environmentId,
		serviceId,
		variables,
		env,
		fetchImpl,
	});
	write ? write(`[${prefix.scope}][${prefix.system}][${prefix.task}][vars] Synced device login approval URL variables for ${service.serviceName ?? serviceId}.`, 'stdout') : null;
	return { variables: Object.keys(variables) };
}

export async function resolveRailwayDeployProjectContext(service, { env = process.env, fetchImpl = fetch } = {}) {
	if (service.projectId) {
		return service;
	}
	const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
	const { project } = await ensureRailwayProject({
		projectId: service.projectId,
		projectName: service.projectName,
		defaultEnvironmentName: service.railwayEnvironment,
		env,
		workspace: workspace.id,
		fetchImpl,
	});
	return {
		...service,
		projectId: project.id,
		projectName: project.name ?? service.projectName,
	};
}
