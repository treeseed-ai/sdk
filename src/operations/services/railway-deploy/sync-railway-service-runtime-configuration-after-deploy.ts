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
import { WORKER_RUNNER_VOLUME_MOUNT_PATH, configuredEnvValue, deriveRailwayCapacityProviderRunnerVolumeName, deriveRailwayOperationsRunnerVolumeName, deriveRailwayWorkerRunnerVolumeName, normalizeScope, railwayServiceRuntimeStartCommand } from './normalize-scope.ts';

export async function syncRailwayServiceRuntimeConfigurationAfterDeploy(tenantRoot, service, { env = process.env, writePhase = null, fetchImpl = fetch } = {}) {
	const writeSyncPhase = (stage, message) => {
		if (typeof writePhase === 'function') {
			writePhase(`sync-runtime-config:${stage}`, message);
		}
	};
	const wantsInstanceConfig = service.buildCommand
		|| service.startCommand
		|| (!(service.imageRef || service.sourceMode === 'image') && service.rootDir)
		|| service.healthcheckPath
		|| service.healthcheckTimeoutSeconds !== null
		|| service.healthcheckTimeoutSeconds !== undefined
		|| service.healthcheckIntervalSeconds !== null
		|| service.healthcheckIntervalSeconds !== undefined
		|| service.restartPolicy
		|| service.runtimeMode;
	const wantsRunnerVolume = service.key === 'workerRunner' || service.key === 'operationsRunner' || service.key === 'capacityProviderRunner';
	if (!wantsInstanceConfig && !wantsRunnerVolume) {
		writeSyncPhase('skip', 'No runtime configuration changes requested.');
		return null;
	}

	writeSyncPhase('workspace', 'Resolving Railway workspace.');
	const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
	let project = null;
	if (service.projectId) {
		writeSyncPhase('project', `Resolving Railway project ${service.projectName ?? service.projectId}.`);
		project = await ensureRailwayProject({
			projectId: service.projectId,
			projectName: service.projectName,
			defaultEnvironmentName: service.railwayEnvironment,
			env,
			workspace: workspace.id,
			fetchImpl,
		}).then((result) => result.project);
	} else {
		writeSyncPhase('project', `Looking up Railway project ${service.projectName}.`);
		const projects = await listRailwayProjects({ env, workspaceId: workspace.id, fetchImpl });
		project = projects.find((entry) => entry.name === service.projectName) ?? null;
		if (!project) {
			writeSyncPhase('project', `Creating Railway project ${service.projectName}.`);
			project = await ensureRailwayProject({
				projectName: service.projectName,
				defaultEnvironmentName: service.railwayEnvironment,
				env,
				workspace: workspace.id,
				fetchImpl,
			}).then((result) => result.project);
		}
	}

	const environmentName = normalizeRailwayEnvironmentName(service.railwayEnvironment);
	let environment = project.environments.find((entry) => entry.name === environmentName || entry.id === environmentName) ?? null;
	if (!environment) {
		writeSyncPhase('environment', `Creating Railway environment ${environmentName}.`);
		environment = await ensureRailwayEnvironment({
			projectId: project.id,
			environmentName,
			env,
			fetchImpl,
		}).then((result) => result.environment);
	}

	let railwayService = project.services.find((entry) => entry.id === service.serviceId || entry.name === service.serviceName) ?? null;
	if (!railwayService) {
		writeSyncPhase('service', `Creating Railway service ${service.serviceName ?? service.key}.`);
		railwayService = await ensureRailwayService({
			projectId: project.id,
			serviceId: service.serviceId,
			serviceName: service.serviceName,
			environmentId: environment.id,
			imageRef: service.imageRef,
			sourceRepo: service.sourceRepo,
			sourceBranch: service.sourceBranch,
			env,
			fetchImpl,
		}).then((result) => result.service);
	} else if (service.imageRef || service.sourceRepo) {
		railwayService = await ensureRailwayService({
			projectId: project.id,
			serviceId: service.serviceId,
			serviceName: service.serviceName,
			environmentId: environment.id,
			imageRef: service.imageRef,
			sourceRepo: service.sourceRepo,
			sourceBranch: service.sourceBranch,
			env,
			fetchImpl,
		}).then((result) => result.service);
	}

	if (wantsInstanceConfig) {
		writeSyncPhase('instance', 'Ensuring Railway service instance configuration.');
	}
	const runtimeConfiguration = wantsInstanceConfig
		? await ensureRailwayServiceInstanceConfiguration({
			serviceId: railwayService.id,
			environmentId: environment.id,
			buildCommand: service.buildCommand,
			startCommand: railwayServiceRuntimeStartCommand(service),
			cronSchedule: service.schedule?.[0] ?? null,
			rootDirectory: service.imageRef || service.sourceMode === 'image' ? null : service.sourceRootDirectory ?? '.',
			healthcheckPath: service.healthcheckPath,
			healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
			healthcheckIntervalSeconds: service.healthcheckIntervalSeconds,
			restartPolicy: service.restartPolicy,
			runtimeMode: service.runtimeMode,
			deploymentRegion: wantsRunnerVolume
				? configuredEnvValue(env, 'TREESEED_RAILWAY_STATEFUL_REGION') || 'us-west2'
				: null,
			env,
			fetchImpl,
		})
		: null;
	writeSyncPhase('variables', 'Upserting Railway runtime variables.');
	await upsertRailwayVariables({
		projectId: project.id,
		environmentId: environment.id,
		serviceId: railwayService.id,
		variables: {
			TREESEED_SKIP_PACKAGE_PREPARE: '1',
			...(['api', 'operationsRunner'].includes(service.key) ? {
				...(configuredEnvValue(env, 'TREESEED_PLATFORM_RUNNER_SECRET') ? {
					TREESEED_PLATFORM_RUNNER_SECRET: configuredEnvValue(env, 'TREESEED_PLATFORM_RUNNER_SECRET'),
				} : {}),
				...(configuredEnvValue(env, 'TREESEED_CREDENTIAL_SESSION_SECRET') ? {
					TREESEED_CREDENTIAL_SESSION_SECRET: configuredEnvValue(env, 'TREESEED_CREDENTIAL_SESSION_SECRET'),
				} : {}),
				...(configuredEnvValue(env, 'TREESEED_WEB_SERVICE_SECRET') ? {
					TREESEED_WEB_SERVICE_SECRET: configuredEnvValue(env, 'TREESEED_WEB_SERVICE_SECRET'),
				} : {}),
			} : {}),
			...(service.sourceMode === 'git' ? {
				TREESEED_DEPLOY_SOURCE_MODE: 'git',
				...(service.sourceRepo ? { TREESEED_DEPLOY_SOURCE_REPOSITORY: service.sourceRepo } : {}),
				...(service.sourceBranch ? { TREESEED_DEPLOY_SOURCE_BRANCH: service.sourceBranch } : {}),
				...(service.sourceCommit ? { TREESEED_DEPLOY_SOURCE_COMMIT: service.sourceCommit } : {}),
			} : {
				TREESEED_DEPLOY_SOURCE_MODE: 'image',
			}),
			...(service.key === 'operationsRunner' ? {
				NIXPACKS_APT_PKGS: 'git',
				NIXPACKS_PKGS: 'git',
				TREESEED_PLATFORM_RUNNER_ID: service.runnerId ?? railwayService.name,
				TREESEED_PLATFORM_RUNNER_DATA_DIR: service.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH,
				TREESEED_PLATFORM_RUNNER_ENVIRONMENT: normalizeScope(service.scope) === 'prod' ? 'production' : normalizeScope(service.scope),
				TREESEED_MANAGER_ID: normalizeScope(service.scope),
				...(configuredEnvValue(env, 'TREESEED_RAILWAY_API_TOKEN') ? { TREESEED_RAILWAY_API_TOKEN: configuredEnvValue(env, 'TREESEED_RAILWAY_API_TOKEN') } : {}),
				...(configuredEnvValue(env, 'TREESEED_RAILWAY_WORKSPACE') ? { TREESEED_RAILWAY_WORKSPACE: configuredEnvValue(env, 'TREESEED_RAILWAY_WORKSPACE') } : {}),
				...(configuredEnvValue(env, 'TREESEED_API_BASE_URL') || configuredEnvValue(env, 'TREESEED_URL') ? {
					TREESEED_API_BASE_URL: configuredEnvValue(env, 'TREESEED_API_BASE_URL') || configuredEnvValue(env, 'TREESEED_URL'),
				} : {}),
			} : {}),
			...(String(service.key).startsWith('capacityProvider') ? {
				TREESEED_PROVIDER_ENVIRONMENT: normalizeScope(service.scope) === 'prod' ? 'production' : normalizeScope(service.scope),
				TREESEED_MANAGER_ID: normalizeScope(service.scope),
				TREESEED_MARKET_ID: normalizeScope(service.scope),
					TREESEED_PROVIDER_ROLE: service.key === 'capacityProviderManager'
							? 'manager'
							: 'runner',
				...(service.key === 'capacityProviderRunner' ? {
					TREESEED_PROVIDER_DATA_DIR: service.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH,
					TREESEED_PROVIDER_RUNNER_ID: service.runnerId ?? railwayService.name,
				} : {}),
				...(configuredEnvValue(env, 'TREESEED_MARKET_URL') ? { TREESEED_MARKET_URL: configuredEnvValue(env, 'TREESEED_MARKET_URL') } : {}),
				...(configuredEnvValue(env, 'TREESEED_CAPACITY_PROVIDER_MANIFEST') ? { TREESEED_CAPACITY_PROVIDER_MANIFEST: configuredEnvValue(env, 'TREESEED_CAPACITY_PROVIDER_MANIFEST') } : {}),
				...(configuredEnvValue(env, 'TREESEED_CODEX_AUTH_JSON_B64') ? { TREESEED_CODEX_AUTH_JSON_B64: configuredEnvValue(env, 'TREESEED_CODEX_AUTH_JSON_B64') } : {}),
			} : {}),
		},
		env,
		fetchImpl,
	});
	const volumeMountPath = service.volumeMountPath ?? service.runnerPool?.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH;
	if (wantsRunnerVolume) {
		writeSyncPhase('volume', `Ensuring Railway volume mounted at ${volumeMountPath}.`);
	}
	const volumeConfiguration = wantsRunnerVolume
		? await ensureRailwayServiceVolume({
			projectId: project.id,
			environmentId: environment.id,
			serviceId: railwayService.id,
			name: service.key === 'operationsRunner'
				? deriveRailwayOperationsRunnerVolumeName(railwayService.name, environment.name)
				: service.key === 'capacityProviderRunner'
					? deriveRailwayCapacityProviderRunnerVolumeName(railwayService.name, environment.name)
				: deriveRailwayWorkerRunnerVolumeName(railwayService.name, environment.name),
			mountPath: volumeMountPath,
			env,
			fetchImpl,
		})
		: null;
	if (wantsRunnerVolume) {
		if (service.key === 'workerRunner') {
			writeSyncPhase('volume-vars', 'Upserting Railway worker volume variables.');
			await upsertRailwayVariables({
				projectId: project.id,
				environmentId: environment.id,
				serviceId: railwayService.id,
				variables: {
					TREESEED_RUNNER_SERVICE_NAME: railwayService.name,
					TREESEED_RUNNER_VOLUME_ROOT: volumeMountPath,
					TREESEED_RUNNER_VOLUME_NAME: volumeConfiguration?.volume.name ?? deriveRailwayWorkerRunnerVolumeName(railwayService.name, environment.name),
					TREESEED_WORKER_IDLE_EXIT_MS: configuredEnvValue(env, 'TREESEED_WORKER_IDLE_EXIT_MS') || '60000',
					...(volumeConfiguration?.volume.id ? { TREESEED_RUNNER_VOLUME_ID: volumeConfiguration.volume.id } : {}),
				},
				env,
				fetchImpl,
			});
		}
	}
	writeSyncPhase('done', 'Runtime configuration is synchronized.');
	return {
		projectId: project.id,
		projectName: project.name ?? service.projectName ?? null,
		environmentId: environment.id,
		environmentName: environment.name ?? environmentName,
		serviceId: railwayService.id,
		serviceName: railwayService.name ?? service.serviceName ?? null,
		instance: runtimeConfiguration?.instance ?? null,
		updated: Boolean(runtimeConfiguration?.updated || volumeConfiguration?.updated || volumeConfiguration?.created),
		volume: volumeConfiguration
			? {
				id: volumeConfiguration.volume.id,
				name: volumeConfiguration.volume.name,
				mountPath: volumeConfiguration.instance?.mountPath ?? volumeMountPath,
				created: volumeConfiguration.created,
				updated: volumeConfiguration.updated,
			}
			: null,
	};
}
