import { loadDeployConfig } from '../../platform/hosting/deploy-config.ts';
import { loadPlugins } from '../../platform/plugins/runtime.ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { resolveMachineEnvironmentValues } from '../../operations/services/configuration/config-runtime.ts';
import { classifyGitMode, runGitText } from '../../operations/services/operations/git-runner.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from '../../operations/services/hosting/railway/railway-source-policy.ts';
import { createCanonicalReconcileReport, type CanonicalAction, type CanonicalDrift, type CanonicalGraphNode, type CanonicalPostcondition } from '../../reconcile/index.ts';
import type { RunnableBootstrapSystem } from '../../reconcile/support/bootstrap-systems.ts';
import { discoverApplications, findApplication, type DiscoveredApplication } from '../apps.ts';
import type {
	ApplicationHostingProfile,
	HostAdapter,
	HostProjectGroup,
	HostingEnvironment,
	HostingGraphFilter,
	HostingGraph,
	HostingGraphInput,
	HostingPlan,
	HostingPlacementSummary,
	HostingUnit,
	ServiceInstanceSpec,
	ServicePlacement,
	ServiceTypeAdapter,
} from '../contracts.ts';
import {
	createDefaultHostAdapters,
	createDefaultHostingProfiles,
	createDefaultServiceTypeAdapters,
	redactSensitiveConfig,
	sanitizedUnitConfig,
	summarizePlacementStatus,
} from '../builtins.ts';
import { PLACEMENT_LABELS, mergeRecord, normalizeEnvironment } from './railway-service-name-max-length.ts';
import { collectPluginHostingContributions } from './railway-source-policy.ts';
import { buildProfileFromDeployConfig } from './build-profile-from-deploy-config.ts';

export function assertCapabilityBinding(unit: HostingUnit) {
	const hostCapabilities = new Set(unit.host.capabilities
		.filter((capability) => capability.environments.includes(unit.environment))
		.map((capability) => capability.id));
	const missing = unit.requiredCapabilities.filter((capability) => !hostCapabilities.has(capability));
	if (missing.length > 0) {
		throw new Error(`Hosting unit "${unit.id}" cannot bind ${unit.serviceType.id} to host "${unit.host.id}" in ${unit.environment}; missing capabilities: ${missing.join(', ')}.`);
	}
}

export function orderUnits(units: HostingUnit[]) {
	const remaining = new Map(units.map((unit) => [unit.id, unit]));
	const ordered: HostingUnit[] = [];
	while (remaining.size > 0) {
		const ready = [...remaining.values()].filter((unit) =>
			unit.dependencies.every((dependency) => !remaining.has(dependency) || ordered.some((orderedUnit) => orderedUnit.id === dependency)));
		if (ready.length === 0) {
			throw new Error(`Hosting graph contains a dependency cycle: ${[...remaining.keys()].join(', ')}.`);
		}
		for (const unit of ready) {
			remaining.delete(unit.id);
			ordered.push(unit);
		}
	}
	return ordered;
}

export function createUnit(
	service: ServiceInstanceSpec,
	environment: HostingEnvironment,
	hosts: Record<string, HostAdapter>,
	serviceTypes: Record<string, ServiceTypeAdapter>,
	projectGroups: Record<string, HostProjectGroup>,
	application?: Pick<DiscoveredApplication, 'id' | 'root' | 'relativeRoot' | 'configPath' | 'roles'>,
): HostingUnit | null {
	const serviceType = serviceTypes[service.serviceType];
	if (!serviceType) {
		throw new Error(`Unknown hosting service type "${service.serviceType}" for service "${service.id}".`);
	}
	const binding = service.environments?.[environment];
	if (binding?.enabled === false) return null;
	const hostId = binding?.hostId ?? serviceType.defaultHostByEnvironment?.[environment];
	if (!hostId) {
		throw new Error(`Hosting service "${service.id}" does not define a host binding for ${environment}.`);
	}
	const host = hosts[hostId];
	if (!host) {
		throw new Error(`Unknown hosting host "${hostId}" for service "${service.id}".`);
	}
	const projectGroupId = binding?.projectGroupId ?? service.projectGroupId;
	const projectGroup = projectGroupId ? projectGroups[projectGroupId] ?? null : null;
	const unitId = application && application.relativeRoot !== '.' && service.id === 'web'
		? application.id
		: service.id;
	const unit: HostingUnit = {
		id: unitId,
		label: service.label,
		serviceType,
		placement: service.placement ?? serviceType.placement,
		host,
		environment,
		projectGroup,
		dependencies: service.dependencies ?? [],
		requiredCapabilities: serviceType.requiredCapabilities,
		config: redactSensitiveConfig({
			...(service.config ?? {}),
			...(binding?.config ?? {}),
		}) as Record<string, unknown>,
		secretRefs: service.secretRefs ?? [],
		variableRefs: service.variableRefs ?? [],
		metadata: redactSensitiveConfig(service.metadata ?? {}) as Record<string, unknown>,
		application,
	};
	assertCapabilityBinding(unit);
	return unit;
}

export function summarizePlacements(units: HostingUnit[]): HostingPlacementSummary[] {
	const grouped = new Map<ServicePlacement, HostingUnit[]>();
	for (const unit of units) {
		grouped.set(unit.placement, [...(grouped.get(unit.placement) ?? []), unit]);
	}
	return [...grouped.entries()].map(([placement, placementUnits]) => ({
		placement,
		label: PLACEMENT_LABELS[placement] ?? placement,
		serviceIds: placementUnits.map((unit) => unit.id),
		hostIds: [...new Set(placementUnits.map((unit) => unit.host.id))],
		status: summarizePlacementStatus(placementUnits.map(() => 'pending')),
		advanced: false,
	}));
}

export function normalizeFilterValues(values: string[] | undefined) {
	return new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
}

export function filterHostingUnits(units: HostingUnit[], filter: HostingGraphFilter | undefined) {
	const serviceIds = normalizeFilterValues(filter?.serviceIds);
	const placements = normalizeFilterValues(filter?.placements as string[] | undefined);
	const hosts = normalizeFilterValues(filter?.hosts);
	const allServiceIds = new Set(units.flatMap((unit) => [unit.id, typeof unit.config.poolKey === 'string' ? unit.config.poolKey : null])
		.filter((value): value is string => Boolean(value)));
	const missingServices = [...serviceIds].filter((serviceId) => !allServiceIds.has(serviceId));
	if (missingServices.length > 0) {
		throw new Error(`Unknown hosting service id${missingServices.length === 1 ? '' : 's'}: ${missingServices.join(', ')}.`);
	}
	if (serviceIds.size === 0 && placements.size === 0 && hosts.size === 0) {
		return units.filter((unit) => unit.metadata.deployByDefault !== false);
	}
	return units.filter((unit) =>
		(serviceIds.size === 0 || serviceIds.has(unit.id) || (typeof unit.config.poolKey === 'string' && serviceIds.has(unit.config.poolKey)))
		&& (placements.size === 0 || placements.has(unit.placement))
		&& (hosts.size === 0 || hosts.has(unit.host.id)));
}

export function compileSingleHostingGraph(
	input: HostingGraphInput,
	application?: DiscoveredApplication,
): HostingGraph {
	const environment = normalizeEnvironment(input.environment);
	const deployConfig = input.deployConfig ?? loadDeployConfig(resolve(input.tenantRoot, 'treeseed.site.yaml'));
	const pluginContributions = collectPluginHostingContributions({ ...input, deployConfig, environment });
	const hosts = mergeRecord(createDefaultHostAdapters(), pluginContributions.hostAdapters, input.hostAdapters);
	const serviceTypes = mergeRecord(createDefaultServiceTypeAdapters(), pluginContributions.serviceTypeAdapters, input.serviceTypeAdapters);
	const compiledProfile = buildProfileFromDeployConfig({ ...input, deployConfig, environment });
	const profiles = [
		...createDefaultHostingProfiles(),
		...pluginContributions.profiles,
		compiledProfile,
		...(input.profiles ?? []),
	];
	const projectGroups = Object.fromEntries(
		profiles.flatMap((profile) => profile.projectGroups ?? []).map((group) => [group.id, group]),
	);
	const services = profiles.flatMap((profile) => profile.services);
	const applicationInfo = application
		? {
			id: application.id,
			root: application.root,
			relativeRoot: application.relativeRoot,
			configPath: application.configPath,
			roles: application.roles,
		}
		: undefined;
	const units = filterHostingUnits(orderUnits(services
		.map((service) => createUnit(service, environment, hosts, serviceTypes, projectGroups, applicationInfo))
		.filter((unit): unit is HostingUnit => Boolean(unit))), input.filter);

	return {
		tenantRoot: input.tenantRoot,
		environment,
		deployConfig,
		applications: application ? [application] : undefined,
		hosts,
		serviceTypes,
		profiles,
		projectGroups,
		units,
		placements: summarizePlacements(units),
		warnings: [],
	};
}

export function mergeHostingGraphs(input: HostingGraphInput, applications: DiscoveredApplication[]): HostingGraph {
	const environment = normalizeEnvironment(input.environment);
	const graphs = applications.map((application) => compileSingleHostingGraph({
		...input,
		tenantRoot: application.root,
		configRoot: resolve(input.tenantRoot),
		deployConfig: application.config,
		filter: undefined,
	}, application));
	const rootGraph = graphs.find((graph) => graph.tenantRoot === resolve(input.tenantRoot)) ?? graphs[0];
	const hosts = mergeRecord(...graphs.map((graph) => graph.hosts), input.hostAdapters);
	const serviceTypes = mergeRecord(...graphs.map((graph) => graph.serviceTypes), input.serviceTypeAdapters);
	const projectGroups = mergeRecord(...graphs.map((graph) => graph.projectGroups));
	const profiles = graphs.flatMap((graph) => graph.profiles);
	const units = filterHostingUnits(orderUnits(graphs.flatMap((graph) => graph.units)), input.filter);
	return {
		tenantRoot: resolve(input.tenantRoot),
		environment,
		deployConfig: rootGraph.deployConfig,
		applications,
		hosts,
		serviceTypes,
		profiles,
		projectGroups,
		units,
		placements: summarizePlacements(units),
		warnings: graphs.flatMap((graph) => graph.warnings),
	};
}

export function compileHostingGraph(input: HostingGraphInput): HostingGraph {
	if (input.deployConfig) {
		return compileSingleHostingGraph(input);
	}
	const tenantRoot = resolve(input.tenantRoot);
	if (input.appId) {
		const application = findApplication(tenantRoot, input.appId);
		if (!application) {
			throw new Error(`Unknown Treeseed application "${input.appId}".`);
		}
		return compileSingleHostingGraph({
			...input,
			tenantRoot: application.root,
			configRoot: tenantRoot,
			deployConfig: application.config,
		}, application);
	}
	const applications = discoverApplications(tenantRoot);
	if (applications.length > 1) {
		return mergeHostingGraphs(input, applications);
	}
	return compileSingleHostingGraph(input, applications[0]);
}

export async function planHostingGraph(input: HostingGraphInput & { planOnly?: boolean }): Promise<HostingPlan> {
	const graph = compileHostingGraph(input);
	const units = [];
	for (const unit of graph.units) {
		const observed = await unit.host.refresh({ environment: graph.environment, unit, graph, planOnly: input.planOnly !== false });
		const plan = await unit.host.diff({ environment: graph.environment, unit, graph, observed, planOnly: input.planOnly !== false });
		const verification = await unit.host.verify({ environment: graph.environment, unit, graph, observed, planOnly: input.planOnly !== false });
		units.push({ unit, observed, plan, verification });
	}
	return {
		environment: graph.environment,
		planOnly: input.planOnly !== false,
		units,
		placements: graph.placements,
		warnings: graph.warnings,
	};
}

export function railwayReconcileSystemsForUnits(units: HostingUnit[]): RunnableBootstrapSystem[] {
	const systems = new Set<RunnableBootstrapSystem>();
	for (const unit of units) {
		if (unit.host.id !== 'railway') continue;
		if (unit.id === 'operationsRunner') {
			systems.add('api');
			continue;
		}
		if (unit.placement === 'api' || unit.placement === 'knowledge-library' || unit.id === 'api' || unit.serviceType.id === 'container-api' || unit.serviceType.id === 'treedx-node') {
			systems.add('api');
		}
		if (unit.placement === 'runner-capacity' || unit.serviceType.id === 'runner-pool') {
			systems.add('agents');
		}
		if (unit.placement === 'database' && units.some((candidate) => candidate.id === 'api' || candidate.placement === 'api')) {
			systems.add('api');
		}
	}
	return [...systems];
}

export function serializeHostingUnit(unit: HostingUnit) {
	return sanitizedUnitConfig(unit);
}

export function canonicalActionKind(value: unknown): CanonicalAction['kind'] {
	const allowed = new Set(['noop', 'create', 'update', 'replace', 'delete', 'adopt', 'rename', 'reattach', 'retain', 'taint', 'blocked']);
	return typeof value === 'string' && allowed.has(value) ? value as CanonicalAction['kind'] : 'noop';
}
