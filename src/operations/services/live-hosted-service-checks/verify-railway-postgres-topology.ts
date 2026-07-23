import { resolve } from 'node:path';
import { loadTreeseedPlatformConfig } from '../../../platform/config.ts';
import { resolveTreeseedLaunchEnvironment } from '../config-runtime.ts';
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
} from '../railway-api.ts';
import {
	configuredRailwayServices,
	findStaleTreeseedOperationsRunnerResources,
	isTreeseedOperationsRunnerResourceName,
	railwayObsoleteAliasCleanupPolicy,
} from '../railway-deploy.ts';
import { railwayTreeDxServiceName } from '../railway-source-policy.ts';
import { discoverTreeseedApplications } from '../../../hosting/apps.ts';
import {
	collectTreeseedHostedServiceChecks,
	type TreeseedHostedServiceCheckReport,
	type TreeseedHostedServiceTarget,
	type TreeseedObservedRailwayServiceState,
} from '../hosted-service-checks.ts';
import { TreeseedLiveHostedServiceCheckOptions, activeRailwayVolumeInstances, findByName, railwayVolumeInstanceStates, treeseedDatabaseDescriptors } from './default-retry-attempts.ts';

export async function verifyRailwayPostgresTopology(input: {
	descriptor: ReturnType<typeof treeseedDatabaseDescriptors>[number];
	configuredServices: ReturnType<typeof configuredRailwayServices>;
	projects: Awaited<ReturnType<typeof listRailwayProjects>>;
	options: TreeseedLiveHostedServiceCheckOptions;
	issues: string[];
}) {
	const descriptorRoot = resolve(input.descriptor.applicationRoot);
	const ownerService = input.configuredServices.find((service) =>
		['api', 'operationsRunner'].includes(service.key)
		&& (
			!input.descriptor.applicationId
			|| service.application?.id === input.descriptor.applicationId
			|| service.application?.root === descriptorRoot
			|| (!service.application && resolve(service.rootDir) === descriptorRoot)
		)
	);
	if (!ownerService) {
		input.issues.push(`${input.descriptor.serviceName}: no Railway API or operations runner service is configured to own the database.`);
		return;
	}
	const project = ownerService.projectId
		? findByName(input.projects, ownerService.projectId)
		: findByName(input.projects, ownerService.projectName);
	if (!project?.id) {
		input.issues.push(`${input.descriptor.serviceName}: Railway project ${ownerService.projectName} was not found.`);
		return;
	}
	const environments = await listRailwayEnvironments({ projectId: project.id, env: input.options.env, fetchImpl: input.options.fetchImpl });
	const environment = findByName(environments, ownerService.railwayEnvironment);
	if (!environment?.id) {
		input.issues.push(`${input.descriptor.serviceName}: Railway environment ${ownerService.railwayEnvironment} was not found.`);
		return;
	}
	const [services, volumes] = await Promise.all([
		listRailwayServices({ projectId: project.id, env: input.options.env, fetchImpl: input.options.fetchImpl }),
		listRailwayVolumes({ projectId: project.id, env: input.options.env, fetchImpl: input.options.fetchImpl }).catch(() => []),
	]);
	const postgresService = findByName(services, input.descriptor.serviceName);
	if (!postgresService?.id) {
		input.issues.push(`${input.descriptor.serviceName}: canonical Railway PostgreSQL service was not found.`);
	}
	const volumeName = `${input.descriptor.serviceName}-volume`;
	const canonicalVolume = volumes.find((volume) => volume.name === volumeName) ?? null;
	if (!canonicalVolume) {
		input.issues.push(`${volumeName}: canonical Railway PostgreSQL volume was not found.`);
		return;
	}
	const activeInstances = activeRailwayVolumeInstances(canonicalVolume);
	const attachedToPostgres = postgresService?.id
		? activeInstances.some((instance) =>
			instance.serviceId === postgresService.id
			&& instance.environmentId === environment.id
			&& instance.mountPath === '/var/lib/postgresql/data'
		)
		: false;
	if (!attachedToPostgres) {
		input.issues.push(`${volumeName}: canonical Railway PostgreSQL volume is not attached to ${input.descriptor.serviceName} at /var/lib/postgresql/data (states=${railwayVolumeInstanceStates(canonicalVolume)}).`);
	}
}

export function resolveLiveProviderEnv(options: TreeseedLiveHostedServiceCheckOptions) {
	let launchValues: Record<string, string | undefined> = {};
	try {
		launchValues = resolveTreeseedLaunchEnvironment({
			tenantRoot: options.tenantRoot,
			scope: options.target,
			baseEnv: { ...process.env, ...(options.env ?? {}) },
		});
	} catch {
		launchValues = {};
	}
	return {
		...process.env,
		...launchValues,
		...(options.env ?? {}),
	};
}
