import { loadTreeseedDeployConfig } from '../platform/deploy-config.ts';
import { loadTreeseedPlugins } from '../platform/plugins/runtime.ts';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createPersistentDeployTarget } from '../operations/services/deploy.ts';
import { collectTreeseedConfigSeedValues } from '../operations/services/config-runtime.ts';
import {
	configuredRailwayServices,
	deployRailwayService,
	waitForRailwayManagedDeploymentsSettled,
} from '../operations/services/railway-deploy.ts';
import {
	deployRailwayServiceInstance,
	deleteRailwayService,
	ensureRailwayEnvironment,
	ensureRailwayGeneratedServiceDomain,
	ensureRailwayProject,
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	ensureRailwayServiceVolume,
	listRailwayVariables,
	listRailwayServices,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspaceContext,
	updateRailwayServiceName,
	upsertRailwayVariables,
} from '../operations/services/railway-api.ts';
import { createTreeseedCanonicalReconcileReport, type TreeseedCanonicalAction, type TreeseedCanonicalDrift, type TreeseedCanonicalGraphNode, type TreeseedCanonicalPostcondition } from '../reconcile/index.ts';
import { reconcileTreeseedTarget } from '../reconcile/index.ts';
import type { TreeseedRunnableBootstrapSystem } from '../reconcile/bootstrap-systems.ts';
import { discoverTreeseedApplications, findTreeseedApplication, type TreeseedDiscoveredApplication } from './apps.ts';
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
	TreeseedHostAdapterOperationResult,
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

function indexedName(baseName: string, index: number) {
	return `${baseName.replace(/-\d+$/u, '').replace(/-\d{2}$/u, '')}-${String(Math.max(1, index)).padStart(2, '0')}`;
}

function publicTreeDxNodePool(config: Record<string, any>) {
	const nodePool = config.publicTreeDxFederation?.railway?.nodePool ?? {};
	const bootstrapCount = Math.max(1, Number.parseInt(String(nodePool.bootstrapCount ?? 1), 10) || 1);
	const maxNodes = Math.max(bootstrapCount, Number.parseInt(String(nodePool.maxNodes ?? 4), 10) || 4);
	return { bootstrapCount, maxNodes };
}

function treeDxSecretBase() {
	return randomBytes(48).toString('base64url');
}

function serviceKeyPlacement(serviceKey: string): TreeseedServicePlacement {
	if (serviceKey === 'api') return 'api';
	if (serviceKey === 'treeseedDatabase') return 'database';
	if (serviceKey === 'operationsRunner') return 'runner-capacity';
	if (/runner|capacity/iu.test(serviceKey)) return 'runner-capacity';
	if (/database|postgres|db/iu.test(serviceKey)) return 'database';
	if (/email|smtp/iu.test(serviceKey)) return 'email';
	return 'operations';
}

function serviceKeyType(serviceKey: string, service: Record<string, any>): string {
	if (serviceKey === 'treeseedDatabase' || service.railway?.resourceType === 'postgres') return 'relational-database';
	if (serviceKey === 'operationsRunner' || /runner/iu.test(serviceKey)) return 'runner-pool';
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

function marketProjectGroup(environment: TreeseedHostingEnvironment, config: Record<string, any>): TreeseedHostProjectGroup {
	const railwayProjectName = Object.values(config.services ?? {})
		.map((service) => (service && typeof service === 'object' ? (service as Record<string, any>).railway?.projectName : null))
		.find((value) => typeof value === 'string' && value.trim()) as string | undefined;
	const projectName = railwayProjectName ?? config.slug ?? 'treeseed-api';
	return {
		id: 'treeseed-control-plane',
		label: 'Treeseed control plane',
		hostId: environment === 'local' ? 'local-process' : 'railway',
		environments: {
			local: { projectName: `${projectName}-local`, environmentName: 'local' },
			staging: { projectName, environmentName: 'staging' },
			prod: { projectName, environmentName: 'production' },
		},
		metadata: { stableProjectName: projectName },
	};
}

function publicTreeDxProjectGroup(environment: TreeseedHostingEnvironment, config: Record<string, any>): TreeseedHostProjectGroup {
	const apiProjectName = marketProjectGroup(environment, config).environments.staging?.projectName ?? config.slug ?? 'treeseed-api';
	return {
		id: 'public-treedx-federation',
		label: 'Public TreeDX federation',
		hostId: environment === 'local' ? 'local-docker' : 'railway',
		environments: {
			local: { projectName: `${apiProjectName}-local`, environmentName: 'local' },
			staging: { projectName: apiProjectName, environmentName: 'staging' },
			prod: { projectName: apiProjectName, environmentName: 'production' },
		},
		metadata: {
			publicFederation: true,
			ownedByAppProject: 'api',
			isolation: 'railway-service-volume-domain',
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
		marketProjectGroup(environment, config),
		publicTreeDxProjectGroup(environment, config),
		privateTreeDxProjectGroup(),
	];

	if (config.surfaces?.web && config.surfaces.web.enabled !== false) {
		services.push({
			id: 'web',
			label: 'Site Hosting',
			serviceType: 'web-site',
			placement: 'web',
			projectGroupId: environment === 'local' ? undefined : 'treeseed-control-plane',
			config: {
				rootDir: config.surfaces?.web?.rootDir ?? '.',
				publicBaseUrl: config.surfaces?.web?.environments?.[environment]?.baseUrl ?? config.surfaces?.web?.publicBaseUrl ?? null,
				domain: config.surfaces?.web?.environments?.[environment]?.domain ?? null,
				cache: config.surfaces?.web?.cache ?? null,
			},
			environments: {
				local: { hostId: 'local-process', config: { hotReload: true, baseUrl: config.surfaces?.web?.localBaseUrl ?? 'http://127.0.0.1:4321' } },
				staging: { hostId: 'cloudflare', projectGroupId: 'treeseed-control-plane' },
				prod: { hostId: 'cloudflare', projectGroupId: 'treeseed-control-plane' },
			},
		});
	}

	for (const [serviceKey, serviceValue] of Object.entries(config.services ?? {})) {
		const service = serviceValue as Record<string, any> | undefined;
		if (!service || service.enabled === false) continue;
		const serviceType = serviceKeyType(serviceKey, service);
		const placement = serviceKeyPlacement(serviceKey);
		const defaultProjectGroup = service.provider === 'railway' || service.railway ? 'treeseed-control-plane' : undefined;
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
			secretRefs: serviceKey === 'treeseedDatabase' ? ['TREESEED_DATABASE_URL'] : [],
			variableRefs: serviceKey === 'operationsRunner'
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

	if (config.smtp?.enabled === true) {
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

	if (config.hosting?.kind === 'treeseed_control_plane') {
		const treeDxNodePool = publicTreeDxNodePool(config);
		const treeDxNodeUnits = Array.from({ length: treeDxNodePool.bootstrapCount }, (_, offset) => {
			const nodeIndex = offset + 1;
			const serviceName = indexedName('public-treedx-node', nodeIndex);
			return {
				id: serviceName,
				label: `Public TreeDX node ${String(nodeIndex).padStart(2, '0')}`,
				serviceType: 'treedx-node',
				placement: 'knowledge-library' as const,
				projectGroupId: 'public-treedx-federation',
				config: {
					image: 'treeseed/treedx',
					imageTagRef: 'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
					serviceName,
					volumeName: `${serviceName}-volume`,
					volumeMountPath: '/data',
					runtimeMode: 'replicated',
					environmentVariables: {
						PHX_SERVER: 'true',
						PORT: '4000',
						TREEDX_DATA_DIR: '/data',
						TREEDX_AUTH_MODE: 'connected',
						TREEDX_AUTH_VERIFIER: 'hs256_dev',
						TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
						TREEDX_EXEC_BACKEND: 'container_sandbox',
						TREEDX_FEDERATION_MODE: 'connected_library',
						TREEDX_JWT_AUDIENCE: 'treedx-public-federation',
						TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
						TREESEED_TREEDX_SCOPE: 'public_federation',
					},
				},
				variableRefs: [
					'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
					'PHX_HOST',
					'PHX_SERVER',
					'PORT',
					'TREEDX_DATA_DIR',
					'TREEDX_AUTH_MODE',
					'TREEDX_AUTH_VERIFIER',
					'TREEDX_ALLOW_DEV_VERIFIER_IN_PROD',
					'TREEDX_EXEC_BACKEND',
					'TREEDX_FEDERATION_MODE',
					'TREEDX_JWT_AUDIENCE',
					'TREEDX_JWT_ISSUER',
					'TREESEED_TREEDX_SCOPE',
				],
				secretRefs: ['SECRET_KEY_BASE', 'TREESEED_TREEDX_ADMIN_TOKEN', 'TREEDX_JWT_HS256_SECRET'],
				environments: {
					local: { hostId: 'local-docker', projectGroupId: 'public-treedx-federation' },
					staging: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
					prod: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
				},
				metadata: {
					publicFederation: true,
					defaultNode: nodeIndex === 1,
					nodeIndex,
					maxNodes: treeDxNodePool.maxNodes,
					retainVolumeOnScaleDown: true,
				},
			};
		});
		services.push(
			{
				id: 'public-treedx-federation',
				label: 'Public TreeDX federation',
				serviceType: 'treedx-federation',
				placement: 'knowledge-library',
				projectGroupId: 'public-treedx-federation',
				dependencies: treeDxNodeUnits.map((unit) => unit.id),
				config: {
					projectName: marketProjectGroup(environment, config).environments.staging?.projectName ?? config.slug ?? 'treeseed-api',
					isolation: 'same API Railway project, separate service, volume, and domain',
					federationMode: 'connected_library',
					nodePool: treeDxNodePool,
				},
				environments: {
					local: { hostId: 'local-docker', projectGroupId: 'public-treedx-federation' },
					staging: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
					prod: { hostId: 'railway', projectGroupId: 'public-treedx-federation' },
				},
				metadata: { publicFederation: true, nodeCount: treeDxNodePool.bootstrapCount, maxNodes: treeDxNodePool.maxNodes },
			},
			...treeDxNodeUnits,
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
	application?: Pick<TreeseedDiscoveredApplication, 'id' | 'root' | 'relativeRoot' | 'configPath' | 'roles'>,
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
		application,
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

function compileSingleTreeseedHostingGraph(
	input: TreeseedHostingGraphInput,
	application?: TreeseedDiscoveredApplication,
): TreeseedHostingGraph {
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
		.filter((unit): unit is TreeseedHostingUnit => Boolean(unit))), input.filter);

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

function mergeTreeseedHostingGraphs(input: TreeseedHostingGraphInput, applications: TreeseedDiscoveredApplication[]): TreeseedHostingGraph {
	const environment = normalizeEnvironment(input.environment);
	const graphs = applications.map((application) => compileSingleTreeseedHostingGraph({
		...input,
		tenantRoot: application.root,
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

export function compileTreeseedHostingGraph(input: TreeseedHostingGraphInput): TreeseedHostingGraph {
	if (input.deployConfig) {
		return compileSingleTreeseedHostingGraph(input);
	}
	const tenantRoot = resolve(input.tenantRoot);
	if (input.appId) {
		const application = findTreeseedApplication(tenantRoot, input.appId);
		if (!application) {
			throw new Error(`Unknown Treeseed application "${input.appId}".`);
		}
		return compileSingleTreeseedHostingGraph({
			...input,
			tenantRoot: application.root,
			deployConfig: application.config,
		}, application);
	}
	const applications = discoverTreeseedApplications(tenantRoot);
	if (applications.length > 1) {
		return mergeTreeseedHostingGraphs(input, applications);
	}
	return compileSingleTreeseedHostingGraph(input, applications[0]);
}

export async function planTreeseedHostingGraph(input: TreeseedHostingGraphInput & { dryRun?: boolean }): Promise<TreeseedHostingPlan> {
	const graph = compileTreeseedHostingGraph(input);
	const units = [];
	for (const unit of graph.units) {
		const observed = await unit.host.refresh({ environment: graph.environment, unit, graph, dryRun: input.dryRun !== false });
		const plan = await unit.host.diff({ environment: graph.environment, unit, graph, observed, dryRun: input.dryRun !== false });
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

function railwayReconcileSystemsForUnits(units: TreeseedHostingUnit[]): TreeseedRunnableBootstrapSystem[] {
	const systems = new Set<TreeseedRunnableBootstrapSystem>();
	for (const unit of units) {
		if (unit.host.id !== 'railway') continue;
		if (unit.placement === 'api' || unit.id === 'api' || unit.serviceType.id === 'container-api') {
			systems.add('api');
		}
		if (unit.placement === 'runner-capacity' || unit.id === 'operationsRunner' || unit.serviceType.id === 'runner-pool') {
			systems.add('agents');
		}
		if (unit.placement === 'database' && units.some((candidate) => candidate.id === 'api' || candidate.placement === 'api')) {
			systems.add('api');
		}
	}
	return [...systems];
}

function railwayDeployServiceKeysForUnits(units: TreeseedHostingUnit[]) {
	const keys = new Set<string>();
	for (const unit of units) {
		if (unit.host.id !== 'railway') continue;
		if (unit.id === 'api' || unit.placement === 'api' || unit.serviceType.id === 'container-api') {
			keys.add('api');
		}
		if (unit.id === 'operationsRunner' || unit.placement === 'runner-capacity' || unit.serviceType.id === 'runner-pool') {
			keys.add('operationsRunner');
		}
	}
	return keys;
}

function railwayEnvForHostingApply(input: TreeseedHostingGraphInput, graph: TreeseedHostingGraph) {
	const seedValues = collectTreeseedConfigSeedValues(input.tenantRoot, graph.environment);
	return {
		...process.env,
		...seedValues,
	};
}

async function deploySelectedRailwayServices(input: TreeseedHostingGraphInput, graph: TreeseedHostingGraph) {
	const selectedKeys = railwayDeployServiceKeysForUnits(graph.units);
	if (selectedKeys.size === 0 || graph.environment === 'local') {
		return [];
	}
	const env = railwayEnvForHostingApply(input, graph);
	const services = configuredRailwayServices(graph.tenantRoot, graph.environment)
		.filter((service) => selectedKeys.has(service.key));
	const results = [];
	for (const service of services) {
		results.push(await deployRailwayService(graph.tenantRoot, service, {
			env,
			prefix: {
				scope: graph.environment,
				system: service.key === 'api' ? 'api' : 'agents',
				task: `${service.key}-railway-deploy`,
				stage: 'deploy',
			},
		}));
	}
	return results;
}

function valueFromUnitConfig(unit: TreeseedHostingUnit, key: string) {
	const config = unit.config && typeof unit.config === 'object' ? unit.config as Record<string, unknown> : {};
	const value = config[key];
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function traceHostingRailway(env: Record<string, string | undefined>, stage: string, message: string) {
	if (env.TREESEED_RECONCILE_TRACE === '1' || process.env.TREESEED_RECONCILE_TRACE === '1') {
		console.error(`[trsd][hosting][railway][${stage}] ${message}`);
	}
}

async function treeDxStage<T>(env: Record<string, string | undefined>, stage: string, task: () => Promise<T>): Promise<T> {
	traceHostingRailway(env, `treedx:${stage}:start`, stage);
	try {
		const result = await task();
		traceHostingRailway(env, `treedx:${stage}:done`, stage);
		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		throw new Error(`Public TreeDX Railway reconcile failed during ${stage}: ${message}`);
	}
}

async function reconcilePublicTreeDxUnits(input: TreeseedHostingGraphInput, graph: TreeseedHostingGraph) {
	if (graph.environment === 'local') {
		return [];
	}
	const nodeUnits = graph.units.filter((unit) => unit.id.startsWith('public-treedx-node-') && unit.host.id === 'railway');
	if (nodeUnits.length === 0) {
		return [];
	}
	const env = railwayEnvForHostingApply(input, graph);
	const workspace = await resolveRailwayWorkspaceContext({ env });
	const results: TreeseedHostAdapterOperationResult[] = [];
	for (const unit of nodeUnits) {
		const projectName = unit.projectGroup?.environments?.[graph.environment]?.projectName
			|| String(env.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME ?? '').trim()
			|| 'treeseed-api';
		const environmentName = normalizeRailwayEnvironmentName(unit.projectGroup?.environments?.[graph.environment]?.environmentName) || ENVIRONMENT_NAMES[graph.environment];
		const configuredImage = valueFromUnitConfig(unit, 'image') ?? 'treeseed/treedx';
		const imageRef = String(env.TREESEED_PUBLIC_TREEDX_IMAGE_REF ?? '').trim()
			|| (configuredImage.includes(':') ? configuredImage : `${configuredImage}:latest`);
		const serviceName = valueFromUnitConfig(unit, 'serviceName') ?? unit.id;
		const volumeName = valueFromUnitConfig(unit, 'volumeName') ?? `${serviceName}-volume`;
		const mountPath = valueFromUnitConfig(unit, 'volumeMountPath') ?? '/data';
		const deploymentRegion = String(env.TREESEED_PUBLIC_TREEDX_RAILWAY_REGION ?? env.TREESEED_RAILWAY_STATEFUL_REGION ?? 'us-west2').trim();
		const ensuredProject = await treeDxStage(env, 'project', () => ensureRailwayProject({
			projectName,
			defaultEnvironmentName: environmentName,
			workspace: workspace.name,
			env,
		}));
		const ensuredEnvironment = await treeDxStage(env, 'environment', () => ensureRailwayEnvironment({
			projectId: ensuredProject.project.id,
			environmentName,
			env,
		}));
		const ensuredService = await treeDxStage(env, 'service', async () => {
			const services = await listRailwayServices({ projectId: ensuredProject.project.id, env });
			const existing = services.find((service) => service.name === serviceName) ?? null;
			const legacy = unit.metadata.nodeIndex === 1
				? services.find((service) => service.name === 'public-treedx-node') ?? null
				: null;
			if (!existing && legacy) {
				const renamed = await updateRailwayServiceName({ serviceId: legacy.id, name: serviceName, env });
				return { service: renamed, created: false, adopted: true };
			}
			return ensureRailwayService({
				projectId: ensuredProject.project.id,
				environmentId: ensuredEnvironment.environment.id,
				serviceName,
				imageRef,
				env,
			});
		});
		const instance = await treeDxStage(env, 'instance', () => ensureRailwayServiceInstanceConfiguration({
			serviceId: ensuredService.service.id,
			environmentId: ensuredEnvironment.environment.id,
			healthcheckPath: '/api/v1/health',
			healthcheckTimeoutSeconds: 120,
			runtimeMode: 'replicated',
			deploymentRegion,
			env,
		}));
		const currentVariables = await treeDxStage(env, 'variables:observe', () => listRailwayVariables({
			projectId: ensuredProject.project.id,
			environmentId: ensuredEnvironment.environment.id,
			serviceId: ensuredService.service.id,
			env,
		}).catch(() => ({})));
		await treeDxStage(env, 'variables', () => upsertRailwayVariables({
			projectId: ensuredProject.project.id,
			environmentId: ensuredEnvironment.environment.id,
			serviceId: ensuredService.service.id,
			variables: {
				TREESEED_PUBLIC_TREEDX_IMAGE_REF: imageRef,
				PHX_HOST: `${serviceName}.railway.app`,
				PHX_SERVER: 'true',
				PORT: '4000',
				TREEDX_DATA_DIR: mountPath,
				TREEDX_AUTH_MODE: 'connected',
				TREEDX_AUTH_VERIFIER: 'hs256_dev',
				TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
				TREEDX_EXEC_BACKEND: 'container_sandbox',
				TREEDX_FEDERATION_MODE: 'connected_library',
				TREEDX_JWT_AUDIENCE: 'treedx-public-federation',
				TREEDX_JWT_ISSUER: `https://${serviceName}.railway.app/treedx`,
				TREESEED_TREEDX_SCOPE: 'public_federation',
				...(typeof currentVariables.SECRET_KEY_BASE === 'string' && currentVariables.SECRET_KEY_BASE.trim()
					? {}
					: { SECRET_KEY_BASE: treeDxSecretBase() }),
				...(typeof currentVariables.TREEDX_JWT_HS256_SECRET === 'string' && currentVariables.TREEDX_JWT_HS256_SECRET.trim()
					? {}
					: { TREEDX_JWT_HS256_SECRET: treeDxSecretBase() }),
				...(typeof env.TREESEED_TREEDX_ADMIN_TOKEN === 'string' && env.TREESEED_TREEDX_ADMIN_TOKEN.trim()
					? { TREESEED_TREEDX_ADMIN_TOKEN: env.TREESEED_TREEDX_ADMIN_TOKEN }
					: {}),
			},
			env,
		}));
		const volume = await treeDxStage(env, 'volume', () => ensureRailwayServiceVolume({
			projectId: ensuredProject.project.id,
			environmentId: ensuredEnvironment.environment.id,
			serviceId: ensuredService.service.id,
			name: volumeName,
			mountPath,
			env,
		}));
		const domain = await treeDxStage(env, 'domain', () => ensureRailwayGeneratedServiceDomain({
			projectId: ensuredProject.project.id,
			environmentId: ensuredEnvironment.environment.id,
			serviceId: ensuredService.service.id,
			env,
		}));
		await treeDxStage(env, 'variables:domain', () => upsertRailwayVariables({
			projectId: ensuredProject.project.id,
			environmentId: ensuredEnvironment.environment.id,
			serviceId: ensuredService.service.id,
			variables: {
				PHX_HOST: domain.domain.domain,
				TREEDX_JWT_ISSUER: `https://${domain.domain.domain}/treedx`,
			},
			env,
		}));
		const deployment = await treeDxStage(env, 'deploy', () => deployRailwayServiceInstance({
			serviceId: ensuredService.service.id,
			environmentId: ensuredEnvironment.environment.id,
			env,
		}));
		results.push({
			status: 'ready',
			locators: {
				hostId: 'railway',
				projectGroupId: unit.projectGroup?.id ?? null,
				projectName,
				serviceName,
				domain: domain.domain.domain,
			},
			state: {
				unitId: unit.id,
				serviceType: unit.serviceType.id,
				placement: unit.placement,
				projectId: ensuredProject.project.id,
				environmentId: ensuredEnvironment.environment.id,
				serviceId: ensuredService.service.id,
				imageRef,
				volumeMountPath: volume.instance?.mountPath ?? mountPath,
				healthcheckPath: instance.instance.healthcheckPath,
				deploymentId: deployment.deploymentId,
			},
			warnings: [],
		});
	}
	const firstUnit = nodeUnits[0];
	const desiredIndexes = new Set(nodeUnits.map((unit) => Number(unit.metadata.nodeIndex ?? 1)).filter((index) => Number.isFinite(index) && index > 0));
	const projectName = firstUnit.projectGroup?.environments?.[graph.environment]?.projectName
		|| String(env.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME ?? '').trim()
		|| 'treeseed-api';
	const environmentName = normalizeRailwayEnvironmentName(firstUnit.projectGroup?.environments?.[graph.environment]?.environmentName) || ENVIRONMENT_NAMES[graph.environment];
	const ensuredProject = await treeDxStage(env, 'scale-down-project', () => ensureRailwayProject({
		projectName,
		defaultEnvironmentName: environmentName,
		workspace: workspace.name,
		env,
	}));
	await treeDxStage(env, 'scale-down-environment', () => ensureRailwayEnvironment({
		projectId: ensuredProject.project.id,
		environmentName,
		env,
	}));
	const services = await treeDxStage(env, 'scale-down-services', () => listRailwayServices({ projectId: ensuredProject.project.id, env }));
	for (const service of services) {
		const match = /^public-treedx-node-(\d{2,})$/u.exec(service.name);
		const index = match ? Number.parseInt(match[1], 10) : null;
		const staleSingleton = service.name === 'public-treedx-node' && desiredIndexes.has(1);
		if ((index !== null && !desiredIndexes.has(index)) || staleSingleton) {
			await treeDxStage(env, `scale-down-service:${service.name}`, () => deleteRailwayService({ serviceId: service.id, env }));
			results.push({
				status: 'ready',
				locators: {
					hostId: 'railway',
					projectGroupId: firstUnit.projectGroup?.id ?? null,
					projectName,
					serviceName: service.name,
				},
				state: {
					unitId: service.name,
					action: 'delete',
					retainedResources: [{
						kind: 'volume',
						name: `${service.name}-volume`,
						reason: 'Stateful TreeDX volumes are retained across scale-down for later reclaim.',
					}],
				},
				warnings: [`Destroyed scaled-down TreeDX service ${service.name}; retained ${service.name}-volume.`],
			});
		}
	}
	return results;
}

export async function applyTreeseedHostingGraph(input: TreeseedHostingGraphInput & { dryRun?: boolean }): Promise<TreeseedHostingApplyResult> {
	const plan = await planTreeseedHostingGraph(input);
	const graph = compileTreeseedHostingGraph(input);
	const selectedSystems = railwayReconcileSystemsForUnits(graph.units);
	const usesDefaultRailwayAdapter = !input.hostAdapters?.railway && !(Array.isArray(input.profiles) && input.profiles.length > 0);
	if (!plan.dryRun && selectedSystems.length > 0 && usesDefaultRailwayAdapter) {
		await reconcileTreeseedTarget({
			tenantRoot: graph.tenantRoot,
			target: createPersistentDeployTarget(graph.environment),
			systems: selectedSystems,
			env: railwayEnvForHostingApply(input, graph),
		});
		await reconcilePublicTreeDxUnits(input, graph);
		await deploySelectedRailwayServices(input, graph);
	}
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
		selectedApps: [...new Set(graph.units.map((unit) => unit.application?.id).filter((value): value is string => Boolean(value)))],
		selectedSystems,
		skippedSystems: ['web', 'data', 'github']
			.filter((system) => !selectedSystems.includes(system as TreeseedRunnableBootstrapSystem))
			.map((system) => ({ system, reason: selectedSystems.length > 0 ? 'Not selected by hosting app filter.' : 'No Railway reconciliation selected.' })),
		transport: selectedSystems.length > 0
			? {
				railway: {
					reconcile: 'api',
					deploy: process.env.TREESEED_RAILWAY_DEPLOY_TRANSPORT === 'cli-fallback' ? 'cli-fallback' : 'api',
				},
			}
			: undefined,
		results,
		placements: plan.placements,
		warnings: plan.warnings,
	};
}

export function serializeHostingUnit(unit: TreeseedHostingUnit) {
	return sanitizedUnitConfig(unit);
}

function canonicalActionKind(value: unknown): TreeseedCanonicalAction['kind'] {
	const allowed = new Set(['noop', 'create', 'update', 'replace', 'delete', 'adopt', 'rename', 'reattach', 'retain', 'taint', 'blocked']);
	return typeof value === 'string' && allowed.has(value) ? value as TreeseedCanonicalAction['kind'] : 'noop';
}

function canonicalHostingNode(unit: TreeseedHostingUnit, value?: unknown): TreeseedCanonicalGraphNode {
	return {
		id: unit.id,
		provider: unit.host.id,
		type: unit.serviceType.id,
		owner: unit.application?.id ?? null,
		environment: unit.environment,
		spec: serializeHostingUnit(unit),
		state: value,
		locators: {
			hostId: unit.host.id,
			projectGroupId: unit.projectGroup?.id ?? null,
			serviceTypeId: unit.serviceType.id,
		},
		metadata: {
			placement: unit.placement,
			logicalName: unit.logicalName,
		},
	};
}

function canonicalHostingDrift(unit: TreeseedHostingUnit, entries: unknown, fallbackReason: string): TreeseedCanonicalDrift[] {
	const rawEntries = Array.isArray(entries) ? entries : [];
	if (rawEntries.length === 0) return [];
	return rawEntries.map((entry, index) => ({
		id: `${unit.id}:drift:${index + 1}`,
		resourceId: unit.id,
		severity: 'blocking',
		reason: typeof entry === 'string' ? entry : fallbackReason,
		provider: unit.host.id,
		type: unit.serviceType.id,
		observed: entry,
	}));
}

function canonicalHostingPostcondition(unit: TreeseedHostingUnit, verification: { verified?: boolean; checks?: unknown[]; issues?: unknown[] }) {
	const issues = [
		...(Array.isArray(verification.issues) ? verification.issues.map(String) : []),
		...(Array.isArray(verification.checks)
			? verification.checks.flatMap((check) => {
				if (!check || typeof check !== 'object') return [];
				const maybeIssues = (check as { issues?: unknown }).issues;
				return Array.isArray(maybeIssues) ? maybeIssues.map(String) : [];
			})
			: []),
	];
	return {
		id: `${unit.id}:verified`,
		resourceId: unit.id,
		description: `Live postconditions pass for ${unit.logicalName}.`,
		source: 'sdk',
		required: true,
		ok: verification.verified === true,
		issues,
		observed: verification,
	} satisfies TreeseedCanonicalPostcondition;
}

function hostingPlanReason(plan: { action?: unknown; reasons?: string[] }, prefix: string) {
	return plan.reasons?.length ? plan.reasons.join('; ') : `${prefix} ${String(plan.action ?? 'noop')}.`;
}

function canonicalHostingReportFromPlan(plan: TreeseedHostingPlan) {
	const desiredGraph = plan.units.map((entry) => canonicalHostingNode(entry.unit));
	const observedGraph = plan.units.map((entry) => canonicalHostingNode(entry.unit, entry.observed));
	const diff = plan.units.flatMap((entry) => [
		...(entry.plan.action && entry.plan.action !== 'noop'
			? [{
				id: `${entry.unit.id}:diff`,
				resourceId: entry.unit.id,
				severity: canonicalActionKind(entry.plan.action) === 'blocked' ? 'blocking' : 'info',
				reason: hostingPlanReason(entry.plan, 'Planned'),
				provider: entry.unit.host.id,
				type: entry.unit.serviceType.id,
				expected: serializeHostingUnit(entry.unit),
				observed: entry.observed,
			} satisfies TreeseedCanonicalDrift]
			: []),
		...canonicalHostingDrift(entry.unit, entry.plan.blockedDrift, 'Blocked provider drift.'),
	]);
	const providerLimitations = plan.units.flatMap((entry) => canonicalHostingDrift(entry.unit, entry.plan.providerLimitations, 'Provider limitation.'));
	const actions = plan.units.map((entry) => ({
		id: `${entry.unit.id}:${entry.plan.action ?? 'noop'}`,
		kind: canonicalActionKind(entry.plan.action),
		resourceId: entry.unit.id,
		reason: hostingPlanReason(entry.plan, 'Planned'),
		provider: entry.unit.host.id,
		type: entry.unit.serviceType.id,
		before: entry.observed,
		after: serializeHostingUnit(entry.unit),
	} satisfies TreeseedCanonicalAction));
	return createTreeseedCanonicalReconcileReport({
		desiredGraph,
		observedGraph,
		stateGraph: [],
		diff,
		actions,
		postconditions: plan.units.map((entry) => canonicalHostingPostcondition(entry.unit, entry.verification)),
		selectedResources: plan.units.map((entry) => entry.unit.id),
		skippedResources: [],
		blockedDrift: diff.filter((entry) => entry.severity === 'blocking'),
		providerLimitations,
		retainedResources: plan.units.flatMap((entry) => (entry.plan.retainedResources ?? []).map((resource: unknown, index: number) => ({
			id: `${entry.unit.id}:retained:${index + 1}`,
			provider: entry.unit.host.id,
			type: 'retained-resource',
			owner: entry.unit.application?.id ?? null,
			state: resource,
		}))),
		liveVerification: {
			ok: plan.units.every((entry) => entry.verification.verified === true),
			source: 'hosting-plan',
			issues: plan.units
				.filter((entry) => entry.verification.verified !== true)
				.map((entry) => `${entry.unit.id}: verification did not pass`),
		},
	});
}

function canonicalHostingReportFromApplyResult(result: TreeseedHostingApplyResult) {
	const desiredGraph = result.results.map((entry) => canonicalHostingNode(entry.unit));
	const observedGraph = result.results.map((entry) => canonicalHostingNode(entry.unit, entry.result));
	const diff = result.results.flatMap((entry) => [
		...(entry.plan.action && entry.plan.action !== 'noop'
			? [{
				id: `${entry.unit.id}:diff`,
				resourceId: entry.unit.id,
				severity: canonicalActionKind(entry.plan.action) === 'blocked' ? 'blocking' : 'info',
				reason: hostingPlanReason(entry.plan, 'Applied'),
				provider: entry.unit.host.id,
				type: entry.unit.serviceType.id,
				expected: serializeHostingUnit(entry.unit),
				observed: entry.result,
			} satisfies TreeseedCanonicalDrift]
			: []),
		...canonicalHostingDrift(entry.unit, entry.plan.blockedDrift, 'Blocked provider drift.'),
	]);
	const providerLimitations = result.results.flatMap((entry) => canonicalHostingDrift(entry.unit, entry.plan.providerLimitations, 'Provider limitation.'));
	const actions = result.results.map((entry) => ({
		id: `${entry.unit.id}:${entry.plan.action ?? 'noop'}`,
		kind: canonicalActionKind(entry.plan.action),
		resourceId: entry.unit.id,
		reason: hostingPlanReason(entry.plan, 'Applied'),
		provider: entry.unit.host.id,
		type: entry.unit.serviceType.id,
		before: entry.result,
		after: serializeHostingUnit(entry.unit),
	} satisfies TreeseedCanonicalAction));
	return createTreeseedCanonicalReconcileReport({
		desiredGraph,
		observedGraph,
		stateGraph: [],
		diff,
		actions,
		postconditions: result.results.map((entry) => canonicalHostingPostcondition(entry.unit, entry.verification)),
		selectedResources: result.results.map((entry) => entry.unit.id),
		skippedResources: result.skippedSystems.map((entry) => ({ id: entry.system, reason: entry.reason })),
		blockedDrift: diff.filter((entry) => entry.severity === 'blocking'),
		providerLimitations,
		retainedResources: result.results.flatMap((entry) => (entry.plan.retainedResources ?? []).map((resource: unknown, index: number) => ({
			id: `${entry.unit.id}:retained:${index + 1}`,
			provider: entry.unit.host.id,
			type: 'retained-resource',
			owner: entry.unit.application?.id ?? null,
			state: resource,
		}))),
		liveVerification: {
			ok: result.results.every((entry) => entry.verification.verified === true),
			source: 'hosting-apply',
			issues: result.results
				.filter((entry) => entry.verification.verified !== true)
				.map((entry) => `${entry.unit.id}: verification did not pass after apply`),
		},
	});
}

export function serializeHostingPlan(plan: TreeseedHostingPlan) {
	const selectedSystems = railwayReconcileSystemsForUnits(plan.units.map((entry) => entry.unit));
	const canonical = canonicalHostingReportFromPlan(plan);
	return {
		environment: plan.environment,
		dryRun: plan.dryRun,
		...canonical,
		selectedApps: [...new Set(plan.units.map((entry) => entry.unit.application?.id).filter((value): value is string => Boolean(value)))],
		selectedSystems,
		skippedSystems: ['web', 'data', 'github']
			.filter((system) => !selectedSystems.includes(system as TreeseedRunnableBootstrapSystem))
			.map((system) => ({ system, reason: selectedSystems.length > 0 ? 'Not selected by hosting app filter.' : 'No Railway reconciliation selected.' })),
		transport: selectedSystems.length > 0
			? {
				railway: {
					reconcile: 'api',
					deploy: process.env.TREESEED_RAILWAY_DEPLOY_TRANSPORT === 'cli-fallback' ? 'cli-fallback' : 'api',
				},
			}
			: undefined,
		placements: plan.placements,
		units: plan.units.map((entry) => ({
			unit: serializeHostingUnit(entry.unit),
			desired: serializeHostingUnit(entry.unit),
			observed: entry.observed,
			diff: entry.plan,
			actions: entry.plan.actions ?? [entry.plan.action],
			retainedResources: entry.plan.retainedResources ?? [],
			blockedDrift: entry.plan.blockedDrift ?? [],
			providerLimitations: entry.plan.providerLimitations ?? [],
			plan: entry.plan,
			verification: entry.verification,
		})),
		warnings: plan.warnings,
	};
}

export function serializeHostingApplyResult(result: TreeseedHostingApplyResult) {
	const canonical = canonicalHostingReportFromApplyResult(result);
	return {
		environment: result.environment,
		dryRun: result.dryRun,
		...canonical,
		selectedApps: result.selectedApps ?? [],
		selectedSystems: result.selectedSystems ?? [],
		skippedSystems: result.skippedSystems ?? [],
		transport: result.transport,
		placements: result.placements,
		results: result.results.map((entry) => ({
			unit: serializeHostingUnit(entry.unit),
			desired: serializeHostingUnit(entry.unit),
			observed: entry.result,
			diff: entry.plan,
			actions: entry.plan.actions ?? [entry.plan.action],
			retainedResources: entry.plan.retainedResources ?? [],
			blockedDrift: entry.plan.blockedDrift ?? [],
			providerLimitations: entry.plan.providerLimitations ?? [],
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
