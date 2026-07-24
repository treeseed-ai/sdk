import { configuredRailwayServices, isOperationsRunnerResourceName } from "../../../../operations/services/hosting/railway/railway-deploy.ts";
import { assertNoRailwaySourceIdentityCollisions } from "../../../../operations/services/hosting/railway/railway-source-policy.ts";
import { listRailwayVolumes } from "../../../../operations/services/hosting/railway/railway-api.ts";
import type { ReconcileAdapterInput } from "../../../support/contracts/contracts.ts";
import { type RailwayIacService } from "../../../providers/railway-iac.ts";
import { activeRailwayVolumeInstances, configuredRailwayServicesForInput, isRailwayCapacityProviderService, railwayServiceMatchesKey, resolveRailwayTopologyForScope, traceRailwayReconcile } from '../../hosting/resolve-railway-topology-for-scope.ts';
import { resolveReconcileEnvironmentValues } from '../../reconciliation/build-workflow-meta-adapter.ts';
import { collectRailwayEnvironmentSync } from '../../hosting/observe-railway-unit.ts';
import { configuredMarketDatabaseService, railwayServiceRootDirectory } from '../../hosting/build-cloudflare-diff.ts';
import { reconcileStaleOperationsRunnerResourcesForProject } from './reconcile-stale-operations-runner-resources-for-project.ts';

export function configuredRailwayProjectSyncGroups(
	input: ReconcileAdapterInput,
	scope: 'local' | 'staging' | 'prod',
	serviceKeys?: string[],
) {
	const allServices = configuredRailwayServicesForInput(input, scope)
		.filter((service) => service.enabled !== false)
		.filter((service) => !isRailwayCapacityProviderService(service));
	const selected = Array.isArray(serviceKeys) && serviceKeys.length > 0
		? allServices.filter((service) => serviceKeys.some((key) => railwayServiceMatchesKey(service, key)))
		: allServices;
	const selectedProjectKeys = new Set(selected.map((service) => `${service.projectName}:::${service.railwayEnvironment}`));
	const grouped = new Map<string, ReturnType<typeof configuredRailwayServices>[number][]>();
	for (const service of allServices) {
		const key = `${service.projectName}:::${service.railwayEnvironment}`;
		if (!selectedProjectKeys.has(key)) {
			continue;
		}
		const services = grouped.get(key) ?? [];
		services.push(service);
		grouped.set(key, services);
	}
	return [...grouped.values()];
}

export function configuredRailwaySiblingResourceNames(
	input: ReconcileAdapterInput,
	scope: 'local' | 'staging' | 'prod',
	projectName: string,
) {
	const siblingScope = scope === 'prod' ? 'staging' : scope === 'staging' ? 'prod' : null;
	if (!siblingScope) return [];
	const siblingServices = configuredRailwayServices(
		input.context.tenantRoot,
		siblingScope,
		resolveReconcileEnvironmentValues(input, siblingScope),
		{ identityOnly: true },
	)
		.filter((service) => service.enabled !== false)
		.filter((service) => !isRailwayCapacityProviderService(service))
		.filter((service) => service.projectName === projectName);
	const currentServices = configuredRailwayServices(
		input.context.tenantRoot,
		scope,
		resolveReconcileEnvironmentValues(input, scope),
		{ identityOnly: true },
	)
		.filter((service) => service.enabled !== false)
		.filter((service) => !isRailwayCapacityProviderService(service))
		.filter((service) => service.projectName === projectName);
	assertNoRailwaySourceIdentityCollisions([
		...currentServices.map((service) => ({ ...service, environment: scope })),
		...siblingServices.map((service) => ({ ...service, environment: siblingScope })),
	]);
	const database = configuredRailwayIacDatabase(input, siblingServices);
	return [...new Set([
		...siblingServices.flatMap((service) => [
			service.serviceName,
			...(service.volumeMountPath ? [`${service.serviceName}-volume`] : []),
		]),
		...(database ? [database.serviceName, `${database.serviceName}-volume`] : []),
	])];
}

export function railwayIacServiceInput(
	input: ReconcileAdapterInput,
	sync: ReturnType<typeof collectRailwayEnvironmentSync>,
	service: ReturnType<typeof configuredRailwayServices>[number],
	scope: 'local' | 'staging' | 'prod',
): RailwayIacService {
	if (scope === 'staging' && service.imageRef) {
		throw new Error(`Railway staging service ${service.serviceName} must build from Git source, not Docker image ${service.imageRef}.`);
	}
	if (scope === 'prod' && service.sourceMode === 'git') {
		throw new Error(`Railway production service ${service.serviceName} must deploy an immutable image, not Git source.`);
	}
	if (scope === 'prod' && service.sourceMode === 'image' && !service.imageRef) {
		throw new Error(`Railway production service ${service.serviceName} must deploy an immutable image, but no image reference was resolved.`);
	}
	const serviceSync = sync.forService(service.key, service);
	const deployVariablePrefix = service.serviceName.includes('treedx') || service.key.includes('treedx')
		? 'TREEDX'
		: 'TREESEED';
	const sourceVariables = service.sourceMode === 'git'
		? {
				...(service.sourceRepo ? { [`${deployVariablePrefix}_DEPLOY_SOURCE_REPOSITORY`]: service.sourceRepo } : {}),
				...(service.sourceBranch ? { [`${deployVariablePrefix}_DEPLOY_SOURCE_BRANCH`]: service.sourceBranch } : {}),
				...(service.sourceCommit ? { [`${deployVariablePrefix}_DEPLOY_SOURCE_COMMIT`]: service.sourceCommit } : {}),
			}
			: {};
	let customDomain: string | null = null;
	if (service.key === 'api' && service.publicBaseUrl) {
		try {
			customDomain = new URL(service.publicBaseUrl).hostname || null;
		} catch {
			customDomain = null;
		}
	}
	return {
		key: service.instanceKey ?? service.key,
		serviceName: service.serviceName,
		sourceMode: service.sourceMode,
		sourceRepo: service.sourceMode === 'git' ? service.sourceRepo : null,
		sourceBranch: service.sourceMode === 'git' ? service.sourceBranch : null,
		sourceCommit: service.sourceMode === 'git' ? service.sourceCommit : null,
		sourceRootDirectory: service.sourceMode === 'git'
			? service.sourceRootDirectory ?? railwayServiceRootDirectory(input.context.tenantRoot, service)
			: null,
		imageRef: service.imageRef,
		dockerfilePath: service.sourceMode === 'git' ? service.dockerfilePath : null,
		buildCommand: service.sourceMode === 'git' ? service.buildCommand : null,
		startCommand: service.sourceMode === 'git' ? service.startCommand : null,
		healthcheckPath: service.healthcheckPath,
		healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
		runtimeMode: service.runtimeMode,
		volumeMountPath: service.volumeMountPath,
		customDomains: customDomain ? [customDomain] : [],
		variables: {
			...serviceSync.variables,
			...sourceVariables,
		},
		secrets: serviceSync.secrets,
	};
}

export function configuredRailwayIacDatabase(
	input: ReconcileAdapterInput,
	projectServices: ReturnType<typeof configuredRailwayServices>,
	detachVolumeIds: string[] = [],
) {
	if (!projectServices.some((service) => service.key === 'api' || service.key === 'operationsRunner')) {
		return null;
	}
	const Database = configuredMarketDatabaseService(input.context.tenantRoot, input.context.deployConfig);
	const DatabaseService = Database?.service;
	if (
		!DatabaseService
		|| DatabaseService.enabled === false
		|| DatabaseService.provider !== 'railway'
		|| DatabaseService.railway?.resourceType !== 'postgres'
	) {
		return null;
	}
	return {
		serviceName: Database.serviceName,
		environmentVariable: 'TREESEED_DATABASE_URL',
		mountPath: '/var/lib/postgresql/data',
		detachVolumeIds,
	};
}

export function railwayIacChangeName(change: Record<string, any>) {
	return String(change?.resource?.name ?? change?.previous?.name ?? change?.address ?? change?.path ?? '');
}

export function railwayIacPlanDeletesResource(changeSet: any, resourceName: string) {
	return (changeSet?.changes ?? []).some((change: Record<string, any>) =>
		change.kind === 'resource.delete'
		&& railwayIacChangeName(change) === resourceName
	);
}

export function activeAttachedRailwayVolumeIds(
	volumes: Awaited<ReturnType<typeof listRailwayVolumes>>,
	serviceId: string | null | undefined,
	environmentId: string,
	desiredVolumeName: string,
) {
	if (!serviceId) {
		return [];
	}
	return volumes
		.filter((volume) => volume.instances.some((instance) =>
			instance.serviceId === serviceId
			&& instance.environmentId === environmentId
			&& (
				volume.name !== desiredVolumeName
				|| activeRailwayVolumeInstances({ instances: [instance] }).length === 0
			)
		))
		.map((volume) => volume.id);
}

export async function reconcileStaleOperationsRunnerResourcesForScope(
	input: ReconcileAdapterInput,
	topology: Awaited<ReturnType<typeof resolveRailwayTopologyForScope>>,
) {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const desiredRunners = configuredRailwayServicesForInput(input, scope)
		.filter((service) => service.key === 'operationsRunner')
		.filter((service) => service.enabled !== false);
	const desiredServiceNames = new Set(desiredRunners.map((service) => service.serviceName).filter(Boolean));
	const desiredVolumeNames = new Set([...desiredServiceNames].map((serviceName) => `${serviceName}-volume`));
	if (desiredServiceNames.size === 0) {
		traceRailwayReconcile(topology.env, 'sync:runner:cleanup-skip', 'no desired operations runner service names');
		return;
	}
	const projectEntries = [...topology.services.values()]
		.filter((entry) => entry.project?.id && entry.environment?.id)
		.map((entry) => ({ project: entry.project!, environment: entry.environment! }));
	traceRailwayReconcile(
		topology.env,
		'sync:runner:cleanup-projects',
		projectEntries.map((entry) => `${entry.project.name}:${entry.environment.name}`).join(',') || '(none)',
	);
	const projects = new Map(projectEntries.map((entry) => [entry.project.id, entry]));
	for (const { project, environment } of projects.values()) {
		const siblingResourceNames = configuredRailwaySiblingResourceNames(input, scope, project.name);
		const retainedSiblingServiceNames = siblingResourceNames
			.filter((name) => !name.endsWith('-volume'))
			.filter(isOperationsRunnerResourceName);
		const retainedSiblingVolumeNames = siblingResourceNames
			.filter((name) => name.endsWith('-volume'))
			.filter(isOperationsRunnerResourceName);
		await reconcileStaleOperationsRunnerResourcesForProject(input, {
			scope,
			env: topology.env,
			project,
			environment,
			desiredServiceNames: new Set([...desiredServiceNames, ...retainedSiblingServiceNames]),
			desiredVolumeNames: new Set([...desiredVolumeNames, ...retainedSiblingVolumeNames]),
		});
	}
}
