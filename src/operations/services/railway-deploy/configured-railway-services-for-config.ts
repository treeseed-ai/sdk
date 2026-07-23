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
import { HOSTED_PROJECT_SERVICE_KEYS, OPERATIONS_RUNNER_BOOTSTRAP_COUNT, RAILWAY_SERVICE_KEYS, WORKER_RUNNER_BOOTSTRAP_INDEX, WORKER_RUNNER_VOLUME_MOUNT_PATH, configuredApiPublicBaseUrl, defaultRailwayImageRef, deriveRailwayCapacityProviderRunnerServiceName, deriveRailwayOperationsRunnerServiceName, deriveRailwayWorkerRunnerServiceName, envValue, normalizeScheduleExpressions, normalizeScope, railwayImageRefEnvForService, railwayServiceNameSuffix, resolveRailwayEnvironmentForScope } from './normalize-scope.ts';
import { configuredPublicTreeDxRailwayServices, resolveRailwayCapacityProviderRoot, resolveRailwayServiceSourcePolicy } from './configured-public-tree-dx-railway-services.ts';

export function configuredRailwayServicesForConfig(tenantRoot, scope, deployConfig, application = null, machineConfigRoot = tenantRoot, envOverlay = {}, options = {}) {
	const normalizedScope = normalizeScope(scope);
	const identityOnly = options.identityOnly === true;
	const imageRefKeys = [
		'TREESEED_API_IMAGE_REF',
		'TREESEED_OPERATIONS_RUNNER_IMAGE_REF',
		'TREESEED_AGENT_MANAGER_IMAGE_REF',
		'TREESEED_AGENT_RUNNER_IMAGE_REF',
		'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
	];
	let machineEnv = {};
	try {
		machineEnv = resolveTreeseedMachineEnvironmentValues(machineConfigRoot, normalizedScope, imageRefKeys);
	} catch {
		machineEnv = {};
	}
	const imageRefEnv = { ...machineEnv, ...process.env, ...envOverlay };
	let identity;
	try {
		identity = resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget(normalizedScope));
	} catch {
		identity = { deploymentKey: deployConfig.slug ?? deployConfig.name ?? 'treeseed' };
	}
	const managedRuntime = deployConfig.runtime?.mode === 'treeseed_managed';
	const hostingKind = deployConfig.hosting?.kind ?? (managedRuntime ? 'hosted_project' : 'self_hosted_project');
	if (!managedRuntime) {
		return [];
	}
	const configuredOptionalServiceKeys = Object.keys(deployConfig.services ?? {})
		.filter((serviceKey) => RAILWAY_SERVICE_KEYS.includes(serviceKey));
	const serviceKeys = hostingKind === 'hosted_project'
		? [...new Set([...HOSTED_PROJECT_SERVICE_KEYS, ...configuredOptionalServiceKeys])]
		: RAILWAY_SERVICE_KEYS;

	const configuredServices = serviceKeys
		.flatMap((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return [];
			}

			const isCapacityProviderService = String(serviceKey).startsWith('capacityProvider');
			const defaultRootDir = ['api', 'operationsRunner'].includes(serviceKey)
				? '.'
				: isCapacityProviderService
					? 'packages/agent'
					: 'packages/core';
			const serviceRoot = isCapacityProviderService
				? resolveRailwayCapacityProviderRoot(tenantRoot, service)
				: resolve(tenantRoot, service.railway?.rootDir ?? service.rootDir ?? defaultRootDir);
			const railwayEnvironment = resolveRailwayEnvironmentForScope(
				normalizedScope,
				service.environments?.[normalizedScope]?.railwayEnvironment,
			);
			const publicBaseUrl = service.environments?.[normalizedScope]?.baseUrl
				?? service.publicBaseUrl
				?? (serviceKey === 'api' ? configuredApiPublicBaseUrl(deployConfig, normalizedScope) : null);
			const environmentConfig = service.environments?.[normalizedScope];
			const baseServiceName = service.railway?.serviceName
				?? (serviceKey === 'workerRunner'
					? deriveRailwayWorkerRunnerServiceName(identity.deploymentKey)
					: `${identity.deploymentKey}-${railwayServiceNameSuffix(serviceKey)}`);
			const configuredServiceName = typeof environmentConfig?.serviceName === 'string' && environmentConfig.serviceName.trim()
				? environmentConfig.serviceName.trim()
				: isApiRailwaySourcePolicyService({ key: serviceKey, serviceName: baseServiceName })
					? railwayEnvironmentQualifiedServiceName(baseServiceName, normalizedScope)
					: baseServiceName;
			const configuredRunnerPool = service.railway?.runnerPool && typeof service.railway.runnerPool === 'object'
				? service.railway.runnerPool
				: null;
			const runnerPool = serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner'
				? {
					bootstrapCount: Math.max(1, Number.parseInt(String(configuredRunnerPool?.bootstrapCount ?? (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)), 10) || (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)),
					maxRunners: Math.max(1, Number.parseInt(String(configuredRunnerPool?.maxRunners ?? configuredRunnerPool?.bootstrapCount ?? (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)), 10) || (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)),
					volumeMountPath: service.railway?.volumeMountPath ?? configuredRunnerPool?.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH,
				}
				: serviceKey === 'workerRunner'
					? {
						bootstrapIndex: WORKER_RUNNER_BOOTSTRAP_INDEX,
						volumeMountPath: WORKER_RUNNER_VOLUME_MOUNT_PATH,
					}
					: null;
			const instanceCount = serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? runnerPool.bootstrapCount : 1;
			return Array.from({ length: instanceCount }, (_, offset) => {
				const runnerIndex = offset + 1;
				const serviceName = serviceKey === 'operationsRunner'
					? deriveRailwayOperationsRunnerServiceName(configuredServiceName, runnerIndex)
					: serviceKey === 'capacityProviderRunner'
						? deriveRailwayCapacityProviderRunnerServiceName(configuredServiceName, runnerIndex)
						: configuredServiceName;
				const configuredImageRefEnv = service.railway?.imageRefEnv ?? railwayImageRefEnvForService(serviceKey);
				const canUseImageRefEnv = normalizedScope === 'prod'
					|| serviceKey === 'capacityProviderManager'
					|| serviceKey === 'capacityProviderRunner';
				const imageRef = service.railway?.imageRef
					?? (canUseImageRefEnv && configuredImageRefEnv ? envValue(configuredImageRefEnv, imageRefEnv) || null : null)
					?? defaultRailwayImageRef(serviceKey, normalizedScope, imageRefEnv);
				const sourcePolicy = identityOnly
					? {
						sourceMode: normalizedScope === 'prod' ? 'image' : 'git',
						sourceRepo: null,
						sourceBranch: null,
						sourceCommit: null,
						sourceRootDirectory: null,
					}
					: resolveRailwayServiceSourcePolicy({
						tenantRoot,
						scope: normalizedScope,
						serviceKey,
						service,
						serviceRoot,
						imageRef,
						serviceName,
					});
				const resolvedImageRef = sourcePolicy.sourceMode === 'image' ? imageRef : null;
					return {
						key: serviceKey,
					instanceKey: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? `${serviceKey}:${runnerIndex}` : serviceKey,
					runnerIndex: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? runnerIndex : null,
					serviceConfig: service,
					scope: normalizedScope,
					projectId: service.railway?.projectId ?? null,
					projectName: environmentConfig?.railwayProjectName ?? service.railway?.projectName ?? identity.deploymentKey,
					serviceId: service.railway?.serviceId ?? null,
					serviceName,
					runnerId: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? serviceName : null,
					rootDir: serviceRoot,
					publicBaseUrl,
					railwayEnvironment,
					buildCommand: resolvedImageRef || (sourcePolicy.sourceMode === 'git' && service.railway?.dockerfilePath)
						? null
						: service.railway?.buildCommand ?? null,
						startCommand: isCapacityProviderService ? null : resolvedImageRef ? null : service.railway?.startCommand ?? null,
					imageRef: resolvedImageRef,
					sourceMode: sourcePolicy.sourceMode,
					sourceRepo: sourcePolicy.sourceRepo,
					sourceBranch: sourcePolicy.sourceBranch,
					sourceCommit: sourcePolicy.sourceCommit,
					sourceRootDirectory: sourcePolicy.sourceRootDirectory,
					dockerfilePath: sourcePolicy.sourceMode === 'git'
						? service.railway?.dockerfilePath ?? apiRailwayDefaultDockerfilePath({ key: serviceKey, serviceName })
						: null,
					healthcheckPath: service.railway?.healthcheckPath ?? null,
					healthcheckTimeoutSeconds: service.railway?.healthcheckTimeoutSeconds ?? null,
					healthcheckIntervalSeconds: service.railway?.healthcheckIntervalSeconds ?? null,
					restartPolicy: service.railway?.restartPolicy ?? null,
					runtimeMode: service.railway?.runtimeMode ?? null,
					volumeMountPath: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? runnerPool.volumeMountPath : service.railway?.volumeMountPath ?? null,
					schedule: normalizeScheduleExpressions(service.railway?.schedule),
					hostingKind,
						runnerPool,
						application,
						secretRefs: Array.isArray(service.secretRefs) ? service.secretRefs : [],
						variableRefs: Array.isArray(service.variableRefs) ? service.variableRefs : [],
					};
				});
		})
		.filter(Boolean);
	return [
		...configuredServices,
		...configuredPublicTreeDxRailwayServices({
			tenantRoot,
			scope: normalizedScope,
			deployConfig,
			identity,
			hostingKind,
			application,
			imageRefEnv,
			workspaceRoot: machineConfigRoot,
			identityOnly,
		}),
	];
}
