import { loadTreeseedDeployConfig } from '../platform/deploy-config.ts';
import { loadTreeseedPlugins } from '../platform/plugins/runtime.ts';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createPersistentDeployTarget } from '../operations/services/deploy.ts';
import { collectTreeseedConfigSeedValues, resolveTreeseedMachineEnvironmentValues } from '../operations/services/config-runtime.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../operations/services/git-runner.ts';
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

function publicTreeDxSourcePolicy(input: TreeseedHostingGraphInput, config: Record<string, any>) {
	const railway = config.publicTreeDxFederation?.railway ?? {};
	const configuredSource = railway.source && typeof railway.source === 'object' && !Array.isArray(railway.source)
		? railway.source
		: {};
	const configuredMode = typeof railway.sourceMode === 'string' ? railway.sourceMode : null;
	const treeDxRoot = resolve(input.tenantRoot, 'packages', 'treedx');
	const repository = typeof railway.sourceRepo === 'string'
		? railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: readPackageRepository(treeDxRoot) ?? 'treeseed-ai/treedx';
	const sourceMode = configuredMode === 'git' || configuredMode === 'image'
		? configuredMode
		: input.environment === 'staging'
			? 'git'
			: 'image';
	if (sourceMode !== 'git') {
		return {
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceCommit: null,
			sourceRootDirectory: null,
			image: 'treeseed/treedx',
			imageTagRef: 'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
		};
	}
	return {
		sourceMode: 'git',
		sourceRepo: repository,
		sourceBranch: typeof railway.sourceBranch === 'string'
			? railway.sourceBranch
			: typeof configuredSource.branch === 'string'
				? configuredSource.branch
				: 'staging',
		sourceCommit: headCommitSafe(treeDxRoot) ?? headCommitSafe(input.tenantRoot),
		sourceRootDirectory: typeof railway.sourceRootDirectory === 'string'
			? railway.sourceRootDirectory
			: typeof configuredSource.rootDirectory === 'string'
				? configuredSource.rootDirectory
				: '.',
		image: null,
		imageTagRef: null,
	};
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
	if (String(serviceKey).startsWith('capacityProvider')) return 'capacity-provider';
	if (serviceKey === 'operationsRunner' || /runner/iu.test(serviceKey)) return 'runner-pool';
	if (Array.isArray(service.railway?.schedule) || typeof service.railway?.schedule === 'string') return 'scheduled-job';
	if (serviceKey === 'api') return 'container-api';
	return service.railway?.volumeMountPath ? 'stateful-container' : 'container-api';
}

function railwayImageRefEnvForService(serviceKey: string) {
	if (serviceKey === 'api') return 'TREESEED_API_IMAGE_REF';
	if (serviceKey === 'operationsRunner') return 'TREESEED_OPERATIONS_RUNNER_IMAGE_REF';
	if (serviceKey === 'capacityProviderManager') return 'TREESEED_AGENT_MANAGER_IMAGE_REF';
	if (serviceKey === 'capacityProviderRunner') return 'TREESEED_AGENT_RUNNER_IMAGE_REF';
	return null;
}

function defaultRailwayImageRefForService(serviceKey: string, environment: TreeseedHostingEnvironment) {
	return null;
}

function readPackageRepository(root: string) {
	const manifestPath = resolve(root, 'treeseed.package.yaml');
	if (!existsSync(manifestPath)) return null;
	try {
		const parsed = parseYaml(readFileSync(manifestPath, 'utf8'));
		const repository = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>).repository
			: null;
		return typeof repository === 'string' && /^[^/\s]+\/[^/\s]+$/u.test(repository.trim()) ? repository.trim() : null;
	} catch {
		return null;
	}
}

function headCommitSafe(root: string) {
	try {
		return runTreeseedGitText(['rev-parse', 'HEAD'], {
			cwd: root,
			mode: classifyTreeseedGitMode(['rev-parse', 'HEAD']),
		}).trim();
	} catch {
		return null;
	}
}

function resolveRailwayServiceSourceRoot(input: TreeseedHostingGraphInput, serviceKey: string, service: Record<string, any>) {
	if (String(serviceKey).startsWith('capacityProvider')) {
		if (service.railway?.rootDir) {
			return resolve(input.tenantRoot, service.railway.rootDir);
		}
		const workspaceRoot = input.configRoot ?? input.tenantRoot;
		const candidates = [
			resolve(input.tenantRoot, '..', 'agent'),
			resolve(workspaceRoot, 'packages', 'agent'),
			resolve(input.tenantRoot, '..', '..', 'packages', 'agent'),
		];
		const found = candidates.find((candidate) =>
			existsSync(resolve(candidate, 'treeseed.package.yaml'))
			|| existsSync(resolve(candidate, 'package.json')),
		);
		return found ?? resolve(workspaceRoot, 'packages', 'agent');
	}
	const rootDir = service.railway?.rootDir ?? service.rootDir ?? '.';
	return resolve(input.tenantRoot, rootDir);
}

function railwaySourcePolicy(input: TreeseedHostingGraphInput, serviceKey: string, service: Record<string, any>, imageRef: string | null) {
	const configuredSource = service.railway?.source && typeof service.railway.source === 'object' && !Array.isArray(service.railway.source)
		? service.railway.source
		: {};
	const configuredMode = typeof service.railway?.sourceMode === 'string' ? service.railway.sourceMode : null;
	const repository = typeof service.railway?.sourceRepo === 'string'
		? service.railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: readPackageRepository(resolveRailwayServiceSourceRoot(input, serviceKey, service)) ?? readPackageRepository(input.tenantRoot);
	const sourceEligible = ['api', 'operationsRunner', 'capacityProviderManager', 'capacityProviderRunner'].includes(serviceKey);
	const mode = input.environment === 'prod'
		? 'image'
		: configuredMode === 'git' || configuredMode === 'image'
			? configuredMode
			: imageRef
					? 'image'
				: input.environment === 'staging' && sourceEligible && repository
					? 'git'
					: 'git';
	if (mode !== 'git') {
		return {
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceCommit: null,
			sourceRootDirectory: null,
			imageRef,
		};
	}
	return {
		sourceMode: 'git',
		sourceRepo: repository,
		sourceBranch: typeof service.railway?.sourceBranch === 'string'
			? service.railway.sourceBranch
			: typeof configuredSource.branch === 'string'
				? configuredSource.branch
				: input.environment === 'staging'
					? 'staging'
					: null,
		sourceCommit: headCommitSafe(resolveRailwayServiceSourceRoot(input, serviceKey, service)) ?? headCommitSafe(input.tenantRoot),
		sourceRootDirectory: typeof service.railway?.sourceRootDirectory === 'string'
			? service.railway.sourceRootDirectory
			: typeof configuredSource.rootDirectory === 'string'
				? configuredSource.rootDirectory
				: '.',
		imageRef: null,
	};
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
	const apiService = config.services?.api && typeof config.services.api === 'object'
		? config.services.api as Record<string, any>
		: null;
	const railwayProjectName = typeof apiService?.railway?.projectName === 'string' && apiService.railway.projectName.trim()
		? apiService.railway.projectName.trim()
		: undefined;
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

function railwayProjectGroupIdForProjectName(prefix: string, projectName: string) {
	const slug = projectName
		.toLowerCase()
		.replace(/[^a-z0-9-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		|| 'railway-project';
	return `${prefix}:${slug}`;
}

function capacityProviderProjectGroupId(projectName: string) {
	return railwayProjectGroupIdForProjectName('capacity-provider', projectName);
}

function capacityProviderProjectGroups(environment: TreeseedHostingEnvironment, config: Record<string, any>): TreeseedHostProjectGroup[] {
	const projectNames = new Set<string>();
	for (const [serviceKey, service] of Object.entries(config.services ?? {})) {
		if (!String(serviceKey).startsWith('capacityProvider')) continue;
		if (!service || typeof service !== 'object') continue;
		const projectName = (service as Record<string, any>).railway?.projectName;
		if (typeof projectName === 'string' && projectName.trim()) {
			projectNames.add(projectName.trim());
		}
	}
	return [...projectNames].map((projectName) => ({
		id: capacityProviderProjectGroupId(projectName),
		label: 'Capacity provider',
		hostId: environment === 'local' ? 'local-docker' : 'railway',
		environments: {
			local: { projectName: `${projectName}-local`, environmentName: 'local' },
			staging: { projectName, environmentName: 'staging' },
			prod: { projectName, environmentName: 'production' },
		},
		metadata: {
			stableProjectName: projectName,
			isolation: 'capacity-provider',
		},
	}));
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
		...capacityProviderProjectGroups(environment, config),
		publicTreeDxProjectGroup(environment, config),
		privateTreeDxProjectGroup(),
	];
	const railwayImageRefEnvKeys = [...new Set(Object.keys(config.services ?? {})
		.map((serviceKey) => railwayImageRefEnvForService(serviceKey))
		.filter((value): value is string => Boolean(value)))];
	let railwayImageRefEnv: Record<string, string> = {};
	try {
		railwayImageRefEnv = resolveTreeseedMachineEnvironmentValues(input.configRoot ?? input.tenantRoot, environment, railwayImageRefEnvKeys) as Record<string, string>;
	} catch {
		railwayImageRefEnv = {};
	}

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
				cloudflare: config.cloudflare
					? {
						workerName: config.cloudflare.workerName ?? null,
						pages: config.cloudflare.pages ?? null,
					}
					: null,
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
		const configuredRailwayProjectName = typeof service.railway?.projectName === 'string' && service.railway.projectName.trim()
			? service.railway.projectName.trim()
			: null;
		const defaultProjectGroup = service.provider === 'railway' || service.railway
			? String(serviceKey).startsWith('capacityProvider') && configuredRailwayProjectName
				? capacityProviderProjectGroupId(configuredRailwayProjectName)
				: 'treeseed-control-plane'
			: undefined;
		const imageRefEnv = railwayImageRefEnvForService(serviceKey);
				const imageRef = service.railway?.imageRef
					?? (imageRefEnv ? railwayImageRefEnv[imageRefEnv] ?? process.env[imageRefEnv] : null)
					?? defaultRailwayImageRefForService(serviceKey, input.environment)
					?? null;
		const sourcePolicy = railwaySourcePolicy(input, serviceKey, service, imageRef);
		services.push({
			id: serviceKey,
			label: placement === 'runner-capacity' ? 'Runner Capacity' : serviceKey === 'api' ? 'API Runtime' : serviceKey,
			serviceType,
			placement,
			projectGroupId: defaultProjectGroup,
			config: {
				rootDir: service.railway?.rootDir ?? service.rootDir ?? '.',
				imageRef: sourcePolicy.imageRef,
				imageRefEnv: sourcePolicy.sourceMode === 'image' ? imageRefEnv : null,
				sourceMode: sourcePolicy.sourceMode,
				sourceRepo: sourcePolicy.sourceRepo,
				sourceBranch: sourcePolicy.sourceBranch,
				sourceCommit: sourcePolicy.sourceCommit,
				sourceRootDirectory: sourcePolicy.sourceRootDirectory,
				dockerfilePath: sourcePolicy.sourceMode === 'git'
					? service.railway?.dockerfilePath ?? null
					: null,
				buildCommand: sourcePolicy.imageRef ? null : service.railway?.buildCommand ?? null,
				startCommand: sourcePolicy.imageRef ? null : service.railway?.startCommand ?? null,
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
			metadata: String(serviceKey).startsWith('capacityProvider')
				? { capacityProvider: true, deployByDefault: false }
				: {},
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
		const treeDxSourcePolicy = publicTreeDxSourcePolicy(input, config);
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
					...(treeDxSourcePolicy.image ? { image: treeDxSourcePolicy.image } : {}),
					...(treeDxSourcePolicy.imageTagRef ? { imageTagRef: treeDxSourcePolicy.imageTagRef } : {}),
					sourceMode: treeDxSourcePolicy.sourceMode,
					...(treeDxSourcePolicy.sourceRepo ? { sourceRepo: treeDxSourcePolicy.sourceRepo } : {}),
					...(treeDxSourcePolicy.sourceBranch ? { sourceBranch: treeDxSourcePolicy.sourceBranch } : {}),
					...(treeDxSourcePolicy.sourceCommit ? { sourceCommit: treeDxSourcePolicy.sourceCommit } : {}),
					...(treeDxSourcePolicy.sourceRootDirectory ? { sourceRootDirectory: treeDxSourcePolicy.sourceRootDirectory } : {}),
					serviceName,
					volumeName: `${serviceName}-volume`,
					volumeMountPath: '/data',
					runtimeMode: 'replicated',
					environmentVariables: {
							PHX_SERVER: 'true',
							PORT: '4000',
							TREESEED_TREEDX_DATA_DIR: '/data',
							TREESEED_TREEDX_AUTH_MODE: 'connected',
							TREESEED_TREEDX_AUTH_VERIFIER: 'hs256_dev',
							TREESEED_TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
							TREESEED_TREEDX_EXEC_BACKEND: 'container_sandbox',
							TREESEED_TREEDX_FEDERATION_MODE: 'connected_library',
							TREESEED_TREEDX_JWT_AUDIENCE: 'treedx-public-federation',
							TREESEED_TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
							TREESEED_TREEDX_BOOTSTRAP_TRUST_ACTOR_ID: 'treeseed-api',
							TREESEED_TREEDX_BOOTSTRAP_TRUST_TENANT_ID: 'treeseed-control-plane',
							TREESEED_TREEDX_BOOTSTRAP_TRUST_REPO_IDS: '*',
							TREESEED_TREEDX_BOOTSTRAP_TRUST_REFS: '*',
							TREESEED_TREEDX_BOOTSTRAP_TRUST_PATHS: '**',
							TREESEED_TREEDX_SCOPE: 'public_federation',
						},
					},
					variableRefs: [
					...(treeDxSourcePolicy.sourceMode === 'image' ? ['TREESEED_PUBLIC_TREEDX_IMAGE_REF'] : []),
						'PHX_HOST',
						'PHX_SERVER',
						'PORT',
						'TREESEED_TREEDX_DATA_DIR',
						'TREESEED_TREEDX_AUTH_MODE',
						'TREESEED_TREEDX_AUTH_VERIFIER',
						'TREESEED_TREEDX_ALLOW_DEV_VERIFIER_IN_PROD',
						'TREESEED_TREEDX_EXEC_BACKEND',
						'TREESEED_TREEDX_FEDERATION_MODE',
						'TREESEED_TREEDX_JWT_AUDIENCE',
						'TREESEED_TREEDX_JWT_ISSUER',
						'TREESEED_TREEDX_BOOTSTRAP_TRUST_ACTOR_ID',
						'TREESEED_TREEDX_BOOTSTRAP_TRUST_TENANT_ID',
						'TREESEED_TREEDX_BOOTSTRAP_TRUST_REPO_IDS',
						'TREESEED_TREEDX_BOOTSTRAP_TRUST_REFS',
						'TREESEED_TREEDX_BOOTSTRAP_TRUST_PATHS',
						'TREESEED_TREEDX_SCOPE',
					],
				secretRefs: ['TREESEED_TREEDX_SECRET_KEY_BASE', 'TREESEED_TREEDX_ADMIN_TOKEN', 'TREESEED_TREEDX_JWT_HS256_SECRET'],
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
	const unitId = application && application.relativeRoot !== '.' && service.id === 'web'
		? application.id
		: service.id;
	const unit: TreeseedHostingUnit = {
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
	const allServiceIds = new Set(units.map((unit) => unit.id));
	const missingServices = [...serviceIds].filter((serviceId) => !allServiceIds.has(serviceId));
	if (missingServices.length > 0) {
		throw new Error(`Unknown hosting service id${missingServices.length === 1 ? '' : 's'}: ${missingServices.join(', ')}.`);
	}
	if (serviceIds.size === 0 && placements.size === 0 && hosts.size === 0) {
		return units.filter((unit) => unit.metadata.deployByDefault !== false);
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
			configRoot: tenantRoot,
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

function isInfrastructureHostedUnit(unit: TreeseedHostingUnit) {
	return ['railway', 'cloudflare', 'cloudflare-dns', 'local-docker'].includes(unit.host.id);
}

function railwayEnvForHostingApply(input: TreeseedHostingGraphInput, graph: TreeseedHostingGraph) {
	const seedValues = collectTreeseedConfigSeedValues(input.tenantRoot, graph.environment);
	return {
		...process.env,
		...seedValues,
	};
}

/**
 * @deprecated Use reconcileTreeseedTarget with hosting selectors instead.
 */
export async function applyTreeseedHostingGraph(input: TreeseedHostingGraphInput & { dryRun?: boolean }): Promise<TreeseedHostingApplyResult> {
	const plan = await planTreeseedHostingGraph(input);
	const graph = compileTreeseedHostingGraph(input);
	const selectedSystems = railwayReconcileSystemsForUnits(graph.units);
	const infrastructureUnits = graph.units.filter(isInfrastructureHostedUnit);
	if (plan.dryRun) {
		return {
			environment: plan.environment,
			dryRun: true,
			selectedApps: [...new Set(graph.units.map((unit) => unit.application?.id).filter((value): value is string => Boolean(value)))],
			selectedSystems,
			skippedSystems: ['web', 'data', 'github']
				.filter((system) => !selectedSystems.includes(system as TreeseedRunnableBootstrapSystem))
				.map((system) => ({ system, reason: selectedSystems.length > 0 ? 'Not selected by hosting app filter.' : 'No Railway reconciliation selected.' })),
			results: plan.units.map((entry) => ({
				unit: entry.unit,
				plan: entry.plan,
				result: entry.observed,
				verification: entry.verification,
			})),
			placements: plan.placements,
			warnings: plan.warnings,
		};
	}
	if (infrastructureUnits.length > 0 && selectedSystems.length === 0) {
		throw new Error(`Hosting apply selected infrastructure resources but no provider reconciliation system was selected: ${infrastructureUnits.map((unit) => `${unit.id} (${unit.host.id})`).join(', ')}.`);
	}
	const reconcile = await reconcileTreeseedTarget({
		tenantRoot: graph.tenantRoot,
		target: createPersistentDeployTarget(graph.environment),
		systems: selectedSystems.length > 0 ? selectedSystems : undefined,
		env: railwayEnvForHostingApply(input, graph),
		dryRun: plan.dryRun,
	});
	const resultByUnit = new Map<string, (typeof reconcile.results)[number]>();
	for (const entry of reconcile.results) {
		resultByUnit.set(entry.unit.unitId, entry);
		resultByUnit.set(entry.unit.logicalName, entry);
	}
	const results = plan.units.map((entry) => {
		const unit = graph.units.find((candidate) => candidate.id === entry.unit.id) ?? entry.unit;
		const reconcileResult = resultByUnit.get(entry.unit.id) ?? resultByUnit.get(unit.id) ?? resultByUnit.get(unit.logicalName) ?? null;
		return {
			unit,
			plan: entry.plan,
			result: {
				status: reconcileResult?.verification?.ready || plan.dryRun ? 'ready' : 'blocked',
				locators: reconcileResult?.resourceLocators ?? {},
				state: reconcileResult?.state ?? {
					unitId: unit.id,
					action: plan.dryRun ? 'plan' : 'unmatched',
				},
				warnings: reconcileResult?.warnings ?? [],
			},
			verification: reconcileResult?.verification ? {
				unitId: unit.id,
				status: reconcileResult.verification.verified ? 'ready' : 'blocked',
				verified: reconcileResult.verification.verified,
				checks: reconcileResult.verification.checks.map((check) => ({
					key: check.key,
					label: check.description,
					ok: check.verified,
					expected: check.expected,
					observed: check.observed,
					issues: check.issues,
				})),
				warnings: reconcileResult.verification.warnings,
			} : {
				unitId: unit.id,
				status: plan.dryRun ? 'ready' : 'blocked',
				verified: plan.dryRun,
				checks: plan.dryRun ? [] : [{
					key: 'reconcile-result',
					label: 'Hosting unit matched a reconcile result',
					ok: false,
					issues: [`No reconcile result matched hosting unit ${unit.id}.`],
				}],
				warnings: [],
			},
		};
	});
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
