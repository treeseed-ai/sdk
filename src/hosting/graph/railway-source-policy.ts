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
import { asPluginRecord, headCommitSafe, readPackageRepository, resolveRailwayServiceSourceRoot } from './railway-service-name-max-length.ts';

export function railwaySourcePolicy(input: HostingGraphInput, serviceKey: string, service: Record<string, any>, imageRef: string | null) {
	const configuredSource = service.railway?.source && typeof service.railway.source === 'object' && !Array.isArray(service.railway.source)
		? service.railway.source
		: {};
	const configuredMode = typeof service.railway?.sourceMode === 'string' ? service.railway.sourceMode : null;
	const baseServiceName = service.railway?.serviceName ?? null;
	const environmentConfig = service.environments?.[input.environment];
	const serviceName = typeof environmentConfig?.serviceName === 'string' && environmentConfig.serviceName.trim()
		? environmentConfig.serviceName.trim()
		: isApiRailwaySourcePolicyService({ key: serviceKey, serviceName: baseServiceName }) && baseServiceName
			? railwayEnvironmentQualifiedServiceName(baseServiceName, input.environment)
			: baseServiceName;
	const repository = typeof service.railway?.sourceRepo === 'string'
		? service.railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: readPackageRepository(resolveRailwayServiceSourceRoot(input, serviceKey, service))
					?? readPackageRepository(input.tenantRoot)
					?? apiRailwayDefaultSourceRepo({ key: serviceKey, serviceName });
	const dockerfilePath = service.railway?.dockerfilePath ?? apiRailwayDefaultDockerfilePath({ key: serviceKey, serviceName });
	const apiPackageSourceEligible = ['api', 'operationsRunner'].includes(serviceKey);
	if (input.environment === 'staging' && isApiRailwaySourcePolicyService({ key: serviceKey, serviceName }) && (configuredMode === 'image' || service.railway?.imageRef)) {
		throw new Error(`${serviceName ?? serviceKey}: API Railway staging services must use GitHub Dockerfile source builds (configured image source is not allowed).`);
	}
	const mode = input.environment === 'prod'
		? 'image'
		: input.environment === 'staging' && apiPackageSourceEligible
			? 'git'
		: configuredMode === 'git' || configuredMode === 'image'
			? configuredMode
			: imageRef
				? 'image'
			: 'git';
	if (mode !== 'git') {
		const policy = {
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceCommit: null,
			sourceRootDirectory: null,
			imageRef,
		};
		assertApiRailwaySourcePolicy(input.environment, {
			key: serviceKey,
			serviceName,
			dockerfilePath: null,
			buildCommand: null,
			startCommand: null,
			...policy,
		});
		return policy;
	}
	const policy = {
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
	assertApiRailwaySourcePolicy(input.environment, {
			key: serviceKey,
			serviceName,
			dockerfilePath,
		...policy,
	});
	return policy;
}

export function collectPluginHostingContributions(input: HostingGraphInput) {
	const plugins = loadPlugins(input.deployConfig);
	const context = {
		projectRoot: input.tenantRoot,
		tenantConfig: undefined,
		deployConfig: input.deployConfig,
		pluginConfig: {},
	};
	const hostAdapters: Record<string, HostAdapter> = {};
	const serviceTypeAdapters: Record<string, ServiceTypeAdapter> = {};
	const profiles: ApplicationHostingProfile[] = [];

	for (const entry of plugins) {
		const pluginContext = { ...context, pluginConfig: entry.config ?? {} };
		const contribution = entry.plugin.hosting;
		const resolved = typeof contribution === 'function' ? contribution(pluginContext) : contribution;
		if (!resolved || typeof resolved !== 'object') continue;
		Object.assign(hostAdapters, asPluginRecord<HostAdapter>(resolved.hostAdapters));
		Object.assign(serviceTypeAdapters, asPluginRecord<ServiceTypeAdapter>(resolved.serviceTypeAdapters));
		const contributedProfiles = Array.isArray(resolved.profiles) ? resolved.profiles : [];
		profiles.push(...contributedProfiles.filter(Boolean));
	}

	return {
		hostAdapters,
		serviceTypeAdapters,
		profiles,
	};
}

export function marketProjectGroup(environment: HostingEnvironment, config: Record<string, any>): HostProjectGroup {
	const apiService = config.services?.api && typeof config.services.api === 'object'
		? config.services.api as Record<string, any>
		: null;
	const railwayProjectName = typeof apiService?.railway?.projectName === 'string' && apiService.railway.projectName.trim()
		? apiService.railway.projectName.trim()
		: undefined;
	const projectName = railwayProjectName ?? config.slug ?? 'treeseed-api';
	const environmentProjectName = (scope: 'staging' | 'prod') => {
		const configured = apiService?.environments?.[scope]?.railwayProjectName;
		return typeof configured === 'string' && configured.trim() ? configured.trim() : projectName;
	};
	return {
		id: 'treeseed-control-plane',
		label: 'Treeseed control plane',
		hostId: environment === 'local' ? 'local-process' : 'railway',
		environments: {
			local: { projectName: `${projectName}-local`, environmentName: 'local' },
			staging: { projectName: environmentProjectName('staging'), environmentName: 'staging' },
			prod: { projectName: environmentProjectName('prod'), environmentName: 'production' },
		},
		metadata: { stableProjectName: projectName },
	};
}

export function railwayProjectGroupIdForProjectName(prefix: string, projectName: string) {
	const slug = projectName
		.toLowerCase()
		.replace(/[^a-z0-9-]+/gu, '-')
		.replace(/^-+|-+$/gu, '')
		|| 'railway-project';
	return `${prefix}:${slug}`;
}

export function capacityProviderProjectGroupId(projectName: string) {
	return railwayProjectGroupIdForProjectName('capacity-provider', projectName);
}

export function capacityProviderProjectGroups(environment: HostingEnvironment, config: Record<string, any>): HostProjectGroup[] {
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

export function publicTreeDxProjectGroup(environment: HostingEnvironment, config: Record<string, any>): HostProjectGroup {
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

export function privateTreeDxProjectGroup(teamId = '{teamId}'): HostProjectGroup {
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
