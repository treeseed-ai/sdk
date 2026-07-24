import { resolve } from 'node:path';
import { loadPlatformConfig } from '../../../platform/configuration/config.ts';
import { resolveLaunchEnvironment } from '../configuration/config-runtime.ts';
import {
	getRailwayServiceInstance,
	inspectRailwayServiceDeploymentHealth,
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	listRailwayVariables,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspaceContext,
} from '../hosting/railway/railway-api.ts';
import {
	configuredRailwayServices,
	findStaleOperationsRunnerResources,
	isOperationsRunnerResourceName,
	railwayObsoleteAliasCleanupPolicy,
} from '../hosting/railway/railway-deploy.ts';
import { railwayTreeDxServiceName } from '../hosting/railway/railway-source-policy.ts';
import { discoverApplications } from '../../../hosting/apps.ts';
import {
	collectHostedServiceChecks,
	type HostedServiceCheckReport,
	type HostedServiceTarget,
	type ObservedRailwayServiceState,
} from '../hosting/audit/hosted-service-checks.ts';
import { LiveHostedServiceCheckOptions, activeRailwayVolumeInstances, findByName, indexedName, inspectRailwayServiceDeploymentHealthWithRetry, isActiveRailwayVolumeInstance, isRetainedDetachedRailwayVolume, liveCheckErrorMessage, railwayVolumeInstanceStates, selectedServiceKeySet, serviceIsSelected, serviceMatchesAppSelection, DatabaseDescriptors } from './default-retry-attempts.ts';
import { verifyRailwayPostgresTopology } from './verify-railway-postgres-topology.ts';

export async function collectRailwayObservations(options: LiveHostedServiceCheckOptions) {
	const observed: Record<string, ObservedRailwayServiceState> = {};
	const issues: string[] = [];
	const inspectedVolumeScopes = new Set<string>();
	const inspectedRunnerScopes = new Set<string>();
	const selectedServiceKeys = selectedServiceKeySet(options);
	const applications = discoverApplications(options.tenantRoot);
	const environmentCache = new Map<string, Promise<Awaited<ReturnType<typeof listRailwayEnvironments>>>>();
	const serviceCache = new Map<string, Promise<Awaited<ReturnType<typeof listRailwayServices>>>>();
	const volumeCache = new Map<string, Promise<Awaited<ReturnType<typeof listRailwayVolumes>>>>();
	const environmentsFor = (projectId: string) => {
		const existing = environmentCache.get(projectId);
		if (existing) return existing;
		const loaded = listRailwayEnvironments({ projectId, env: options.env, fetchImpl: options.fetchImpl });
		environmentCache.set(projectId, loaded);
		return loaded;
	};
	const servicesFor = (projectId: string) => {
		const existing = serviceCache.get(projectId);
		if (existing) return existing;
		const loaded = listRailwayServices({ projectId, env: options.env, fetchImpl: options.fetchImpl });
		serviceCache.set(projectId, loaded);
		return loaded;
	};
	const volumesFor = (projectId: string) => {
		const existing = volumeCache.get(projectId);
		if (existing) return existing;
		const loaded = listRailwayVolumes({ projectId, env: options.env, fetchImpl: options.fetchImpl }).catch(() => []);
		volumeCache.set(projectId, loaded);
		return loaded;
	};
	try {
		const workspace = await resolveRailwayWorkspaceContext({ env: options.env, fetchImpl: options.fetchImpl });
		const projects = await listRailwayProjects({ workspaceId: workspace.id, env: options.env, fetchImpl: options.fetchImpl });
		const configuredServices = configuredRailwayServices(options.tenantRoot, options.target, options.env)
			.filter((entry) => serviceMatchesAppSelection(entry, options.tenantRoot, options.appId, applications))
			.filter((entry) => serviceIsSelected(selectedServiceKeys, entry.key));
		const siblingTarget = options.target === 'staging' ? 'prod' : options.target === 'prod' ? 'staging' : null;
		const configuredSiblingServices = siblingTarget
			? configuredRailwayServices(options.tenantRoot, siblingTarget, options.env, { identityOnly: true })
				.filter((entry) => entry.enabled !== false)
				.filter((entry) => entry.key === 'operationsRunner')
			: [];
		const retainedObsoleteAliases = options.target === 'staging'
			? railwayObsoleteAliasCleanupPolicy('staging', configuredServices).retainedResourceNames
			: [];
		if (selectedServiceKeys.size === 0 || selectedServiceKeys.has('api') || selectedServiceKeys.has('operationsRunner')) {
			for (const descriptor of DatabaseDescriptors(options.tenantRoot, options)) {
				await verifyRailwayPostgresTopology({ descriptor, configuredServices, projects, options, issues });
			}
		}
		for (const service of configuredServices) {
			if (options.target === 'prod' && service.sourceMode === 'image' && !service.imageRef) {
				issues.push(`${service.serviceName}: production Railway service is configured for image deployment but no immutable image ref is resolved.`);
			}
			const project = service.projectId
				? findByName(projects, service.projectId)
				: findByName(projects, service.projectName);
			if (!project?.id) {
				issues.push(`${service.serviceName}: Railway project ${service.projectName} was not found.`);
				continue;
			}
			const environments = await environmentsFor(project.id);
			const environment = findByName(environments, service.railwayEnvironment);
			if (!environment?.id) {
				issues.push(`${service.serviceName}: Railway environment ${service.railwayEnvironment} was not found.`);
				continue;
			}
			const volumeScope = `${project.id}:${environment.id}`;
			if (!inspectedVolumeScopes.has(volumeScope)) {
				inspectedVolumeScopes.add(volumeScope);
				const volumes = await volumesFor(project.id);
				for (const volume of volumes) {
					if (isRetainedDetachedRailwayVolume(volume.name)) {
						continue;
					}
					if (String(volume.name ?? '').endsWith('-postgres-volume') && activeRailwayVolumeInstances(volume).length === 0) {
						issues.push(`${volume.name ?? volume.id}: detached PostgreSQL volume remains in Railway project ${project.name} (states=${railwayVolumeInstanceStates(volume)}).`);
					}
					const detachedPostgresInstances = activeRailwayVolumeInstances(volume).filter((instance) =>
						instance.environmentId === environment.id
						&& instance.mountPath === '/var/lib/postgresql/data'
						&& !instance.serviceId
					);
					if (detachedPostgresInstances.length > 0) {
						issues.push(`${volume.name ?? volume.id}: detached PostgreSQL volume remains in Railway project ${project.name} (states=${railwayVolumeInstanceStates(volume)}).`);
					}
				}
			}
			const services = await servicesFor(project.id);
			const runnerScope = `${project.id}:${environment.id}`;
			if (service.key === 'operationsRunner' && !inspectedRunnerScopes.has(runnerScope)) {
				inspectedRunnerScopes.add(runnerScope);
				const desiredRunnerNames = new Set([
					...configuredServices
						.filter((entry) => entry.key === 'operationsRunner')
						.filter((entry) => (entry.projectId ? entry.projectId === project.id : entry.projectName === project.name))
						.filter((entry) => normalizeRailwayEnvironmentName(entry.railwayEnvironment) === normalizeRailwayEnvironmentName(environment.name))
						.map((entry) => entry.serviceName)
						.filter(Boolean),
					...configuredSiblingServices
						.filter((entry) => entry.projectId ? entry.projectId === project.id : entry.projectName === project.name)
						.map((entry) => entry.serviceName)
						.filter((name) => Boolean(name) && isOperationsRunnerResourceName(name)),
					...retainedObsoleteAliases
						.filter((name) => isOperationsRunnerResourceName(name) && !name.endsWith('-volume')),
				]);
				const desiredRunnerServiceIds = new Set(services
					.filter((entry) => desiredRunnerNames.has(entry.name))
					.map((entry) => entry.id));
				for (const staleService of findStaleOperationsRunnerResources(services, desiredRunnerNames)) {
					issues.push(`${staleService.name}: stale operations runner Railway service remains in project ${project.name}.`);
				}
				const volumes = await volumesFor(project.id);
				const desiredRunnerVolumeNames = new Set([
					...[...desiredRunnerNames].map((name) => `${name}-volume`),
					...retainedObsoleteAliases.filter((name) => name.endsWith('-volume')),
				]);
				for (const staleVolume of findStaleOperationsRunnerResources(volumes, desiredRunnerVolumeNames)) {
					const activeInstances = activeRailwayVolumeInstances(staleVolume);
					const relevant = staleVolume.instances.length === 0 || activeInstances.length > 0;
					const attachedToDesiredRunner = activeInstances.some((instance) => desiredRunnerServiceIds.has(instance.serviceId ?? ''));
					if (relevant && !attachedToDesiredRunner) {
						issues.push(`${staleVolume.name ?? staleVolume.id}: stale operations runner Railway volume remains in project ${project.name} (states=${railwayVolumeInstanceStates(staleVolume)}).`);
					}
				}
			}
			const railwayService = service.serviceId
				? findByName(services, service.serviceId)
				: findByName(services, service.serviceName);
			if (!railwayService?.id) {
				issues.push(`${service.serviceName}: Railway service was not found.`);
				continue;
			}
			const [instance, variables, volumes] = await Promise.all([
				getRailwayServiceInstance({ serviceId: railwayService.id, environmentId: environment.id, env: options.env, fetchImpl: options.fetchImpl }),
				listRailwayVariables({ projectId: project.id, environmentId: environment.id, serviceId: railwayService.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => ({})),
				volumesFor(project.id),
			]);
			const mountedVolume = Array.isArray(volumes)
				? volumes.find((entry: any) => {
					const instances = Array.isArray(entry.instances)
						? entry.instances
						: Array.isArray(entry.volumeInstances) ? entry.volumeInstances : [];
					return instances.some((instance: any) =>
						instance?.serviceId === railwayService.id
						&& instance?.environmentId === environment.id
						&& (!service.volumeMountPath || instance?.mountPath === service.volumeMountPath)
						&& isActiveRailwayVolumeInstance(instance)
					);
				}) ?? null
				: null;
			const volumeInstance = mountedVolume
				? ((Array.isArray((mountedVolume as any).instances)
					? (mountedVolume as any).instances
					: Array.isArray((mountedVolume as any).volumeInstances) ? (mountedVolume as any).volumeInstances : [])
					.find((instance: any) =>
						instance?.serviceId === railwayService.id
						&& instance?.environmentId === environment.id
						&& (!service.volumeMountPath || instance?.mountPath === service.volumeMountPath)
						&& isActiveRailwayVolumeInstance(instance)
					) ?? null)
				: null;
			const variableKeys = Object.keys(variables ?? {});
			const deployment = await inspectRailwayServiceDeploymentHealthWithRetry({
				serviceId: railwayService.id,
				environmentId: environment.id,
				serviceName: service.serviceName,
				acceptSleeping: service.runtimeMode === 'serverless',
				options,
			}).catch((error) => ({
				ok: false,
				status: null,
				message: error instanceof Error ? error.message : String(error ?? 'Unable to inspect Railway deployment health.'),
			}));
			if (!deployment.ok) {
				issues.push(`${service.serviceName}: latest Railway deployment is not healthy. ${deployment.message}`);
			}
			if (service.volumeMountPath && !volumeInstance) {
				issues.push(`${service.serviceName}: Railway volume is not mounted at ${service.volumeMountPath}.`);
			}
			observed[service.serviceName] = {
				projectName: project.name,
				environmentName: environment.name,
				serviceName: railwayService.name,
				serviceId: railwayService.id,
				rootDirectory: instance.rootDirectory,
				buildCommand: instance.buildCommand,
				dockerfilePath: instance.dockerfilePath,
				startCommand: instance.startCommand,
				healthcheckPath: instance.healthcheckPath,
				healthcheckTimeoutSeconds: instance.healthcheckTimeoutSeconds,
				runtimeMode: service.runtimeMode ?? instance.runtimeMode,
				deploymentStatus: deployment.status,
				deploymentHealthy: deployment.ok,
				deploymentBranch: deployment.branch ?? null,
				deploymentRepo: deployment.repo ?? null,
				deploymentRootDirectory: deployment.rootDirectory ?? null,
				deploymentCommitHash: deployment.commitHash ?? null,
				deploymentRequiredMountPath: deployment.requiredMountPath ?? null,
				deploymentVolumeMounts: deployment.volumeMounts ?? [],
				volumeName: mountedVolume?.name ?? null,
				volumeId: mountedVolume?.id ?? null,
				volumeMountPath: volumeInstance?.mountPath ?? null,
				volumeServiceId: volumeInstance?.serviceId ?? null,
				volumeEnvironmentId: volumeInstance?.environmentId ?? null,
				volumeState: volumeInstance?.state ?? null,
				volumePendingDeletion: volumeInstance?.isPendingDeletion ?? null,
				volumeDeletedAt: volumeInstance?.deletedAt ?? null,
				variables: variableKeys,
				secrets: variableKeys,
				health: 'unknown',
			};
		}
		if (selectedServiceKeys.size === 0) {
			const deployConfig = loadPlatformConfig({ tenantRoot: options.tenantRoot, environment: options.target, env: options.env }).deployConfig;
			const appConfigs = [
				...(!options.appId || options.appId === 'web' ? [deployConfig] : []),
				...discoverApplications(options.tenantRoot)
					.filter((application) => application.id === 'api' && (!options.appId || options.appId === 'api'))
					.map((application) => application.config),
			];
			for (const config of appConfigs) {
				const nodePool = config.publicTreeDxFederation?.railway?.nodePool;
				if (!nodePool && config.hosting?.kind !== 'treeseed_control_plane') continue;
				const bootstrapCount = Math.max(1, Number.parseInt(String(nodePool?.bootstrapCount ?? 1), 10) || 1);
				const projectName = config.slug ?? 'treeseed-api';
				const environmentName = normalizeRailwayEnvironmentName(options.target) || options.target;
				const project = findByName(projects, projectName);
				if (!project?.id) {
					issues.push(`public-treedx: Railway project ${projectName} was not found.`);
					continue;
				}
				const environments = await environmentsFor(project.id);
				const environment = findByName(environments, environmentName);
				if (!environment?.id) {
					issues.push(`public-treedx: Railway environment ${environmentName} was not found.`);
					continue;
				}
				const [services, volumes] = await Promise.all([
					servicesFor(project.id),
					volumesFor(project.id),
				]);
				for (let index = 1; index <= bootstrapCount; index += 1) {
					const logicalServiceName = indexedName('public-treedx-node', index);
					const serviceName = railwayTreeDxServiceName(index, options.target);
					const volumeName = `${serviceName}-volume`;
					const configuredNode = Array.isArray(config.services)
						? config.services.find((service: any) => service?.id === logicalServiceName || service?.name === logicalServiceName)
						: null;
					const volumeMountPath = typeof configuredNode?.volumeMountPath === 'string' && configuredNode.volumeMountPath.trim()
						? configuredNode.volumeMountPath.trim()
						: '/data';
					const service = findByName(services, serviceName);
					if (!service?.id) {
						issues.push(`${serviceName}: public TreeDX Railway service was not found.`);
						continue;
					}
					const deployment = await inspectRailwayServiceDeploymentHealthWithRetry({
						serviceId: service.id,
						environmentId: environment.id,
						serviceName,
						options,
					}).catch((error) => ({
						ok: false,
						status: null,
						message: error instanceof Error ? error.message : String(error ?? 'Unable to inspect TreeDX deployment health.'),
					}));
					if (!deployment.ok) {
						issues.push(`${serviceName}: public TreeDX latest deployment is not healthy. ${deployment.message}`);
					}
					const variables = await listRailwayVariables({ projectId: project.id, environmentId: environment.id, serviceId: service.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => ({}));
					if (variables.TREEDX_FEDERATION_MODE !== 'connected_library') {
						issues.push(`${serviceName}: TREEDX_FEDERATION_MODE is not connected_library.`);
					}
					const mountedVolume = volumes.find((volume) => volume.name === volumeName && volume.instances.some((instance) =>
						instance.serviceId === service.id
						&& instance.environmentId === environment.id
						&& instance.mountPath === volumeMountPath
						&& isActiveRailwayVolumeInstance(instance)
					));
					if (!mountedVolume) {
						issues.push(`${serviceName}: public TreeDX volume ${volumeName} is not mounted at ${volumeMountPath}.`);
					}
				}
			}
		}
		return { observed, status: 'observed' as const, issues };
	} catch (error) {
		return {
			observed,
			status: 'failed' as const,
			issues: [...issues, liveCheckErrorMessage(error, 'Railway live observation failed without provider details.')].filter((issue) => issue.trim()),
		};
	}
}
