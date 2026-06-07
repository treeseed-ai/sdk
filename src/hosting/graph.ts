import { loadTreeseedDeployConfig } from '../platform/deploy-config.ts';
import { loadTreeseedPlugins } from '../platform/plugins/runtime.ts';
import { resolve } from 'node:path';
import type {
	TreeseedApplicationHostingProfile,
	TreeseedHostAdapter,
	TreeseedHostProjectGroup,
	TreeseedHostingApplyResult,
	TreeseedHostingEnvironment,
	TreeseedHostingGraphFilter,
	TreeseedHostingGraph,
	TreeseedHostingGraphInput,
	TreeseedHostingPlan,
	TreeseedHostingPlacementSummary,
	TreeseedHostingUnit,
	TreeseedServiceInstanceSpec,
	TreeseedServicePlacement,
	TreeseedServiceTypeAdapter,
} from './contracts.ts';
import {
	createDefaultHostAdapters,
	createDefaultHostingProfiles,
	createDefaultServiceTypeAdapters,
	redactSensitiveConfig,
	sanitizedUnitConfig,
	summarizePlacementStatus,
} from './builtins.ts';

const ENVIRONMENT_NAMES: Record<TreeseedHostingEnvironment, string> = {
	local: 'local',
	staging: 'staging',
	prod: 'production',
};

const PLACEMENT_LABELS: Record<TreeseedServicePlacement, string> = {
	web: 'Site Hosting',
	api: 'API Runtime',
	database: 'Database',
	'knowledge-library': 'Knowledge Library',
	'runner-capacity': 'Runner Capacity',
	repository: 'Repository',
	'content-storage': 'Content Storage',
	email: 'Email',
	operations: 'Operations',
	custom: 'Custom',
};

function mergeRecord<T>(...records: Array<Record<string, T> | undefined>): Record<string, T> {
	return Object.assign({}, ...records.filter(Boolean));
}

function asPluginRecord<T>(value: unknown): Record<string, T> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, T> : {};
}

function normalizeEnvironment(value: unknown): TreeseedHostingEnvironment {
	return value === 'prod' || value === 'production'
		? 'prod'
		: value === 'staging'
			? 'staging'
			: 'local';
}

function serviceKeyPlacement(serviceKey: string): TreeseedServicePlacement {
	if (serviceKey === 'api') return 'api';
	if (serviceKey === 'marketDatabase') return 'database';
	if (serviceKey === 'marketOperationsRunner') return 'runner-capacity';
	if (/runner|capacity/iu.test(serviceKey)) return 'runner-capacity';
	if (/database|postgres|db/iu.test(serviceKey)) return 'database';
	if (/email|smtp/iu.test(serviceKey)) return 'email';
	return 'operations';
}

function serviceKeyType(serviceKey: string, service: Record<string, any>): string {
	if (serviceKey === 'marketDatabase' || service.railway?.resourceType === 'postgres') return 'relational-database';
	if (serviceKey === 'marketOperationsRunner' || /runner/iu.test(serviceKey)) return 'runner-pool';
	if (Array.isArray(service.railway?.schedule) || typeof service.railway?.schedule === 'string') return 'scheduled-job';
	if (serviceKey === 'api') return 'container-api';
	return service.railway?.volumeMountPath ? 'stateful-container' : 'container-api';
}

function collectPluginHostingContributions(input: TreeseedHostingGraphInput) {
	const plugins = loadTreeseedPlugins(input.deployConfig);
	const context = {
		projectRoot: input.tenantRoot,
		tenantConfig: undefined,
		deployConfig: input.deployConfig,
		pluginConfig: {},
	};
	const hostAdapters: Record<string, TreeseedHostAdapter> = {};
	const serviceTypeAdapters: Record<string, TreeseedServiceTypeAdapter> = {};
	const profiles: TreeseedApplicationHostingProfile[] = [];

	for (const entry of plugins) {
		const pluginContext = { ...context, pluginConfig: entry.config ?? {} };
		const contribution = entry.plugin.hosting;
		const resolved = typeof contribution === 'function' ? contribution(pluginContext) : contribution;
		if (!resolved || typeof resolved !== 'object') continue;
		Object.assign(hostAdapters, asPluginRecord<TreeseedHostAdapter>(resolved.hostAdapters));
		Object.assign(serviceTypeAdapters, asPluginRecord<TreeseedServiceTypeAdapter>(resolved.serviceTypeAdapters));
		const contributedProfiles = Array.isArray(resolved.profiles) ? resolved.profiles : [];
		profiles.push(...contributedProfiles.filter(Boolean));
	}

	return {
		hostAdapters,
		serviceTypeAdapters,
		profiles,
	};
}

function marketProjectGroup(environment: TreeseedHostingEnvironment): TreeseedHostProjectGroup {
	return {
		id: 'market-control-plane',
		label: 'Market control plane',
		hostId: environment === 'local' ? 'local-process' : 'railway',
		environments: {
			local: { projectName: 'treeseed-market-local', environmentName: 'local' },
			staging: { projectName: 'treeseed-market', environmentName: 'staging' },
			prod: { projectName: 'treeseed-market', environmentName: 'production' },
		},
		metadata: { stableProjectName: 'treeseed-market' },
	};
}

function publicTreeDxProjectGroup(environment: TreeseedHostingEnvironment): TreeseedHostProjectGroup {
	return {
		id: 'public-treedx-federation',
		label: 'Public TreeDX federation',
		hostId: environment === 'local' ? 'local-docker' : 'railway',
		environments: {
			local: { projectName: 'treeseed-public-treedx-local', environmentName: 'local' },
			staging: { projectName: 'treeseed-public-treedx', environmentName: 'staging', sharedAcrossEnvironments: true },
			prod: { projectName: 'treeseed-public-treedx', environmentName: 'production', sharedAcrossEnvironments: true },
		},
		metadata: {
			publicFederation: true,
			singleProjectAcrossStagingAndProd: true,
			isolation: 'railway-environment-service-volume-domain',
		},
	};
}

function privateTreeDxProjectGroup(teamId = '{teamId}'): TreeseedHostProjectGroup {
	return {
		id: 'private-team-treedx',
		label: 'Private team TreeDX',
		hostId: 'railway',
		environments: {
			staging: { projectName: `treeseed-team-${teamId}-treedx`, environmentName: 'staging' },
			prod: { projectName: `treeseed-team-${teamId}-treedx`, environmentName: 'production' },
		},
		metadata: { transferable: true, privateTeam: true },
	};
}

function buildProfileFromDeployConfig(input: TreeseedHostingGraphInput): TreeseedApplicationHostingProfile {
	const config = input.deployConfig!;
	const environment = input.environment;
	const services: TreeseedServiceInstanceSpec[] = [];
	const projectGroups = [
		marketProjectGroup(environment),
		publicTreeDxProjectGroup(environment),
		privateTreeDxProjectGroup(),
	];

	if (config.surfaces?.web?.enabled !== false) {
		services.push({
			id: 'web',
			label: 'Site Hosting',
			serviceType: 'web-site',
			placement: 'web',
			projectGroupId: environment === 'local' ? undefined : 'market-control-plane',
			config: {
				rootDir: config.surfaces?.web?.rootDir ?? '.',
				publicBaseUrl: config.surfaces?.web?.environments?.[environment]?.baseUrl ?? config.surfaces?.web?.publicBaseUrl ?? null,
				domain: config.surfaces?.web?.environments?.[environment]?.domain ?? null,
				cache: config.surfaces?.web?.cache ?? null,
			},
			environments: {
				local: { hostId: 'local-process', config: { hotReload: true, baseUrl: config.surfaces?.web?.localBaseUrl ?? 'http://127.0.0.1:4321' } },
				staging: { hostId: 'cloudflare', projectGroupId: 'market-control-plane' },
				prod: { hostId: 'cloudflare', projectGroupId: 'market-control-plane' },
			},
		});
	}

	for (const [serviceKey, serviceValue] of Object.entries(config.services ?? {})) {
		const service = serviceValue as Record<string, any> | undefined;
		if (!service || service.enabled === false) continue;
		const serviceType = serviceKeyType(serviceKey, service);
		const placement = serviceKeyPlacement(serviceKey);
		const defaultProjectGroup = service.provider === 'railway' || service.railway ? 'market-control-plane' : undefined;
		services.push({
			id: serviceKey,
			label: placement === 'runner-capacity' ? 'Runner Capacity' : serviceKey === 'api' ? 'API Runtime' : serviceKey,
			serviceType,
			placement,
			projectGroupId: defaultProjectGroup,
			config: {
				rootDir: service.railway?.rootDir ?? service.rootDir ?? '.',
				buildCommand: service.railway?.buildCommand ?? null,
				startCommand: service.railway?.startCommand ?? null,
				healthcheckPath: service.railway?.healthcheckPath ?? null,
				runtimeMode: service.railway?.runtimeMode ?? null,
				volumeMountPath: service.railway?.volumeMountPath ?? null,
				runnerPool: service.railway?.runnerPool ?? null,
				resourceType: service.railway?.resourceType ?? null,
				serviceName: service.railway?.serviceName ?? null,
				serviceTargets: service.railway?.serviceTargets ?? null,
			},
			secretRefs: serviceKey === 'marketDatabase' ? ['TREESEED_MARKET_DATABASE_URL'] : [],
			variableRefs: serviceKey === 'marketOperationsRunner'
				? ['TREESEED_PLATFORM_RUNNER_ID', 'TREESEED_PLATFORM_RUNNER_DATA_DIR', 'TREESEED_PLATFORM_RUNNER_ENVIRONMENT']
				: [],
			environments: {
				local: {
					hostId: serviceType === 'relational-database' || serviceType === 'runner-pool' || service.railway?.volumeMountPath ? 'local-docker' : 'local-process',
					projectGroupId: undefined,
					config: service.environments?.local ?? {},
				},
				staging: {
					hostId: service.provider ?? 'railway',
					projectGroupId: defaultProjectGroup,
					config: service.environments?.staging ?? {},
				},
				prod: {
					hostId: service.provider ?? 'railway',
					projectGroupId: defaultProjectGroup,
					config: service.environments?.prod ?? {},
				},
			},
		});
	}

	if (config.cloudflare?.r2) {
		services.push({
			id: 'content-storage',
			label: 'Content Storage',
			serviceType: 'object-store',
			placement: 'content-storage',
			config: {
				bucketName: config.cloudflare.r2.bucketName ?? null,
				manifestKeyTemplate: config.cloudflare.r2.manifestKeyTemplate ?? null,
				previewRootTemplate: config.cloudflare.r2.previewRootTemplate ?? null,
			},
			environments: {
				local: { hostId: 'local-docker' },
				staging: { hostId: 'cloudflare' },
				prod: { hostId: 'cloudflare' },
			},
		});
	}

	if (config.smtp?.enabled !== false) {
		services.push({
			id: 'email',
			label: 'Email',
			serviceType: 'email-relay',
			placement: 'email',
			secretRefs: ['SMTP_PASSWORD'],
			environments: {
				local: { hostId: 'smtp' },
				staging: { hostId: 'smtp' },
				prod: { hostId: 'smtp' },
			},
		});
	}

	if (config.hosting?.kind === 'market_control_plane' || config.slug === 'treeseed-market') {
		services.push(
			{
				id: 'public-treedx-federation',
				label: 'Public TreeDX federation',
				serviceType: 'treedx-federation',
				placement: 'knowledge-library',
				projectGroupId: 'public-treedx-federation',
				dependencies: ['public-treedx-node'],
				config: {
					projectName: 'treeseed-public-treedx',
					isolation: 'separate Railway environments, services, volumes, and domains',
				},
				environments: {
					local: { hostId: 'local-docker', projectGroupId: 'public-treedx-federation' },
					staging: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
					prod: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
				},
				metadata: { publicFederation: true, nodeCount: 'one-or-more' },
			},
			{
				id: 'public-treedx-node',
				label: 'Public TreeDX node',
				serviceType: 'treedx-node',
				placement: 'knowledge-library',
				projectGroupId: 'public-treedx-federation',
				config: {
					image: 'treeseed/treedx',
					imageTagRef: 'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
					volumeName: 'public-treedx-data',
					volumeMountPath: '/data',
					environmentVariables: {
						TREEDX_DATA_DIR: '/data',
					},
				},
				variableRefs: ['TREESEED_PUBLIC_TREEDX_IMAGE_REF', 'TREEDX_DATA_DIR'],
				secretRefs: ['TREESEED_TREEDX_ADMIN_TOKEN'],
				environments: {
					local: { hostId: 'local-docker', projectGroupId: 'public-treedx-federation' },
					staging: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
					prod: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
				},
				metadata: { publicFederation: true, defaultNode: true },
			},
		);
	}

	return {
		id: `${config.slug}-compiled`,
		label: `${config.name} hosting profile`,
		services,
		projectGroups,
		metadata: {
			source: 'treeseed.site.yaml',
			environment,
		},
	};
}

function assertCapabilityBinding(unit: TreeseedHostingUnit) {
	const hostCapabilities = new Set(unit.host.capabilities
		.filter((capability) => capability.environments.includes(unit.environment))
		.map((capability) => capability.id));
	const missing = unit.requiredCapabilities.filter((capability) => !hostCapabilities.has(capability));
	if (missing.length > 0) {
		throw new Error(`Hosting unit "${unit.id}" cannot bind ${unit.serviceType.id} to host "${unit.host.id}" in ${unit.environment}; missing capabilities: ${missing.join(', ')}.`);
	}
}

function orderUnits(units: TreeseedHostingUnit[]) {
	const remaining = new Map(units.map((unit) => [unit.id, unit]));
	const ordered: TreeseedHostingUnit[] = [];
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

function createUnit(
	service: TreeseedServiceInstanceSpec,
	environment: TreeseedHostingEnvironment,
	hosts: Record<string, TreeseedHostAdapter>,
	serviceTypes: Record<string, TreeseedServiceTypeAdapter>,
	projectGroups: Record<string, TreeseedHostProjectGroup>,
): TreeseedHostingUnit | null {
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
	const unit: TreeseedHostingUnit = {
		id: service.id,
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
	};
	assertCapabilityBinding(unit);
	return unit;
}

function summarizePlacements(units: TreeseedHostingUnit[]): TreeseedHostingPlacementSummary[] {
	const grouped = new Map<TreeseedServicePlacement, TreeseedHostingUnit[]>();
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

function normalizeFilterValues(values: string[] | undefined) {
	return new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function filterHostingUnits(units: TreeseedHostingUnit[], filter: TreeseedHostingGraphFilter | undefined) {
	const serviceIds = normalizeFilterValues(filter?.serviceIds);
	const placements = normalizeFilterValues(filter?.placements as string[] | undefined);
	const hosts = normalizeFilterValues(filter?.hosts);
	if (serviceIds.size === 0 && placements.size === 0 && hosts.size === 0) return units;
	const allServiceIds = new Set(units.map((unit) => unit.id));
	const missingServices = [...serviceIds].filter((serviceId) => !allServiceIds.has(serviceId));
	if (missingServices.length > 0) {
		throw new Error(`Unknown hosting service id${missingServices.length === 1 ? '' : 's'}: ${missingServices.join(', ')}.`);
	}
	return units.filter((unit) =>
		(serviceIds.size === 0 || serviceIds.has(unit.id))
		&& (placements.size === 0 || placements.has(unit.placement))
		&& (hosts.size === 0 || hosts.has(unit.host.id)));
}

export function compileTreeseedHostingGraph(input: TreeseedHostingGraphInput): TreeseedHostingGraph {
	const environment = normalizeEnvironment(input.environment);
	const deployConfig = input.deployConfig ?? loadTreeseedDeployConfig(resolve(input.tenantRoot, 'treeseed.site.yaml'));
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
	const units = filterHostingUnits(orderUnits(services
		.map((service) => createUnit(service, environment, hosts, serviceTypes, projectGroups))
		.filter((unit): unit is TreeseedHostingUnit => Boolean(unit))), input.filter);

	return {
		tenantRoot: input.tenantRoot,
		environment,
		deployConfig,
		hosts,
		serviceTypes,
		profiles,
		projectGroups,
		units,
		placements: summarizePlacements(units),
		warnings: [],
	};
}

export async function planTreeseedHostingGraph(input: TreeseedHostingGraphInput & { dryRun?: boolean }): Promise<TreeseedHostingPlan> {
	const graph = compileTreeseedHostingGraph(input);
	const units = [];
	for (const unit of graph.units) {
		const observed = await unit.host.observe({ environment: graph.environment, unit, graph, dryRun: input.dryRun !== false });
		const plan = await unit.host.plan({ environment: graph.environment, unit, graph, observed, dryRun: input.dryRun !== false });
		const verification = await unit.host.verify({ environment: graph.environment, unit, graph, observed, dryRun: input.dryRun !== false });
		units.push({ unit, observed, plan, verification });
	}
	return {
		environment: graph.environment,
		dryRun: input.dryRun !== false,
		units,
		placements: graph.placements,
		warnings: graph.warnings,
	};
}

export async function applyTreeseedHostingGraph(input: TreeseedHostingGraphInput & { dryRun?: boolean }): Promise<TreeseedHostingApplyResult> {
	const plan = await planTreeseedHostingGraph(input);
	const graph = compileTreeseedHostingGraph(input);
	const results = [];
	for (const entry of plan.units) {
		const unit = graph.units.find((candidate) => candidate.id === entry.unit.id) ?? entry.unit;
		const result = await unit.host.apply({ environment: graph.environment, unit, graph, plan: entry.plan, dryRun: plan.dryRun });
		const verification = await unit.host.verify({ environment: graph.environment, unit, graph, observed: result, dryRun: plan.dryRun });
		results.push({ unit, plan: entry.plan, result, verification });
	}
	return {
		environment: plan.environment,
		dryRun: plan.dryRun,
		results,
		placements: plan.placements,
		warnings: plan.warnings,
	};
}

export function serializeHostingUnit(unit: TreeseedHostingUnit) {
	return sanitizedUnitConfig(unit);
}

export function serializeHostingPlan(plan: TreeseedHostingPlan) {
	return {
		environment: plan.environment,
		dryRun: plan.dryRun,
		placements: plan.placements,
		units: plan.units.map((entry) => ({
			unit: serializeHostingUnit(entry.unit),
			observed: entry.observed,
			plan: entry.plan,
			verification: entry.verification,
		})),
		warnings: plan.warnings,
	};
}

export function serializeHostingApplyResult(result: TreeseedHostingApplyResult) {
	return {
		environment: result.environment,
		dryRun: result.dryRun,
		placements: result.placements,
		results: result.results.map((entry) => ({
			unit: serializeHostingUnit(entry.unit),
			plan: entry.plan,
			result: entry.result,
			verification: entry.verification,
		})),
		warnings: result.warnings,
	};
}

export function hostingEnvironmentLabel(environment: TreeseedHostingEnvironment) {
	return ENVIRONMENT_NAMES[environment];
}
