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
import { configuredRailwayServicesForConfig } from './configured-railway-services-for-config.ts';
import { HOSTED_PROJECT_SERVICE_KEYS, RAILWAY_SERVICE_KEYS, envValue, shouldManageRailwaySchedules } from './normalize-scope.ts';
import { resolveRailwayAuthToken } from './railway-status-deployment-terminal-failure.ts';

export function configuredRailwayServices(tenantRoot, scope, envOverlay = {}, options = {}) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const direct = configuredRailwayServicesForConfig(tenantRoot, scope, deployConfig, null, tenantRoot, envOverlay, options);
	const nested = discoverTreeseedApplications(tenantRoot)
		.filter((application) => application.root !== resolve(tenantRoot))
		.flatMap((application) => configuredRailwayServicesForConfig(
			application.root,
			scope,
			application.config,
			{
				id: application.id,
				root: application.root,
				relativeRoot: application.relativeRoot,
			},
			tenantRoot,
			envOverlay,
			options,
		));
	return [...direct, ...nested];
}

export function obsoleteUnqualifiedRailwayResourceNames(
	services: ReturnType<typeof configuredRailwayServices>,
) {
	const aliases = new Set<string>();
	for (const service of services) {
		const alias = service.serviceName.replace(/-(?:staging|production)(?=-\d+$|$)/u, '');
		if (!alias || alias === service.serviceName) continue;
		aliases.add(alias);
		if (service.volumeMountPath) aliases.add(`${alias}-volume`);
		const index = /-(\d+)$/u.exec(service.serviceName)?.[1] ?? '01';
		const environmentSuffix = service.railwayEnvironment === 'production' ? 'production' : 'staging';
		const formerNames = service.key === 'operationsRunner'
			? [
				`treeseed-api-operations-runner-${index}`,
				`treeseed-api-operations-runner-${environmentSuffix}-${index}`,
			]
			: service.key.startsWith('public-treedx-node-')
				? [
					`public-treedx-node-${index}`,
					`public-treedx-node-${environmentSuffix}-${index}`,
				]
				: [];
		for (const formerName of formerNames) {
			if (formerName === service.serviceName) continue;
			aliases.add(formerName);
			if (service.volumeMountPath) aliases.add(`${formerName}-volume`);
		}
	}
	return [...aliases];
}

export function railwayObsoleteAliasCleanupPolicy(
	scope: 'staging' | 'prod',
	services: ReturnType<typeof configuredRailwayServices>,
	liveProjectServiceNames: Iterable<string> = [],
	activeEnvironmentServiceNames: Iterable<string> = [],
) {
	const aliases = obsoleteUnqualifiedRailwayResourceNames(services);
	const liveNames = new Set(liveProjectServiceNames);
	void scope;
	void activeEnvironmentServiceNames;
	const qualifiedServices = services
		.filter((service) => service.serviceName !== service.serviceName.replace(/-(?:staging|production)(?=-\d+$|$)/u, ''))
		.map((service) => service.serviceName);
	const qualifiedResourcesExist = aliases.length > 0
		&& qualifiedServices.every((name) => liveNames.has(name));
	return {
		retainedResourceNames: qualifiedResourcesExist ? [] : aliases,
		allowedResourceDeletions: qualifiedResourcesExist ? aliases : [],
	};
}

export function configuredRailwayScheduledJobs(tenantRoot, scope, { phase = 'deploy' } = {}) {
	if (!shouldManageRailwaySchedules(scope, phase)) {
		return [];
	}
	return configuredRailwayServices(tenantRoot, scope)
		.filter((service) => Array.isArray(service.schedule) && service.schedule.length > 0)
		.flatMap((service) =>
			service.schedule.map((expression, index) => ({
				service: service.key,
				projectId: service.projectId,
				projectName: service.projectName,
				serviceId: service.serviceId,
				serviceName: service.serviceName,
				environment: normalizeRailwayEnvironmentName(service.railwayEnvironment),
				environmentId: envValue('TREESEED_RAILWAY_ENVIRONMENT_ID') || null,
				expression,
				command: service.startCommand,
				enabled: true,
				logicalName: `${service.key}:${index + 1}`,
			})),
		);
}

export async function resolveRailwayScheduleTarget(
	schedule,
	{
		env = process.env,
		fetchImpl = fetch,
		ensure = false,
	}: {
		env?: NodeJS.ProcessEnv;
		fetchImpl?: typeof fetch;
		ensure?: boolean;
	} = {},
) {
	const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
	const projects = await listRailwayProjects({
		env,
		workspaceId: workspace.id,
		fetchImpl,
	});
	let project = projects.find((entry) => entry.id === schedule.projectId || entry.name === schedule.projectName) ?? null;
	if (!project && ensure) {
		project = (await ensureRailwayProject({
			projectId: schedule.projectId,
			projectName: schedule.projectName,
			defaultEnvironmentName: schedule.environment,
			env,
			workspace: workspace.name,
			fetchImpl,
		})).project;
	}
	if (!project) {
		return { workspace, project: null, environment: null, service: null };
	}
	let environment = project.environments.find((entry) => entry.id === schedule.environmentId || entry.name === schedule.environment) ?? null;
	if (!environment) {
		environment = ensure
			? (await ensureRailwayEnvironment({
				projectId: project.id,
				environmentName: schedule.environment,
				env,
				fetchImpl,
			})).environment
			: (await listRailwayEnvironments({ projectId: project.id, env, fetchImpl }))
				.find((entry) => entry.id === schedule.environmentId || entry.name === schedule.environment)
				?? null;
	}
	let service = project.services.find((entry) => entry.id === schedule.serviceId || entry.name === schedule.serviceName) ?? null;
	if (!service) {
		service = ensure
			? (await ensureRailwayService({
				projectId: project.id,
				serviceId: schedule.serviceId,
				serviceName: schedule.serviceName,
				env,
				fetchImpl,
			})).service
			: (await listRailwayServices({ projectId: project.id, env, fetchImpl }))
				.find((entry) => entry.id === schedule.serviceId || entry.name === schedule.serviceName)
				?? null;
	}
	return { workspace, project, environment, service };
}

export function resolveRailwayDeploymentProfile(tenantRoot) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const hostingKind = deployConfig.hosting?.kind ?? (deployConfig.runtime?.mode === 'treeseed_managed' ? 'hosted_project' : 'self_hosted_project');
	const configuredOptionalServiceKeys = Object.keys(deployConfig.services ?? {})
		.filter((serviceKey) => RAILWAY_SERVICE_KEYS.includes(serviceKey));
	return {
		hostingKind,
		managedTopology: deployConfig.runtime?.mode === 'treeseed_managed'
			? (hostingKind === 'hosted_project'
				? [...new Set([...HOSTED_PROJECT_SERVICE_KEYS, ...configuredOptionalServiceKeys])]
				: [...RAILWAY_SERVICE_KEYS])
			: [],
	};
}

export function validateRailwayServiceConfiguration(tenantRoot, scope) {
	const services = configuredRailwayServices(tenantRoot, scope);
	const { hostingKind, managedTopology } = resolveRailwayDeploymentProfile(tenantRoot);
	const issues = [];
	const configuredKeys = new Set(services.map((service) => service.key));

	if (hostingKind === 'hosted_project') {
		for (const serviceKey of HOSTED_PROJECT_SERVICE_KEYS) {
			if (!configuredKeys.has(serviceKey)) {
				issues.push(`${serviceKey}: hosted_project deployments require the ${serviceKey} Railway service to be configured.`);
			}
		}
	}

	for (const service of services) {
		if (!service.serviceName && !service.serviceId) {
			issues.push(`${service.key}: set railway.serviceName or railway.serviceId in treeseed.site.yaml.`);
		}
		if (!service.projectName && !service.projectId) {
			issues.push(`${service.key}: set railway.projectName or railway.projectId in treeseed.site.yaml.`);
		}
		if (service.sourceMode === 'git' && !service.sourceRepo) {
			issues.push(`${service.key}: staging source builds require railway.source.repository or package repository metadata.`);
		}
		const usesExternalGitSource = service.sourceMode === 'git' && Boolean(service.sourceRepo);
		if (!service.imageRef && !usesExternalGitSource && !existsSync(service.rootDir)) {
			issues.push(`${service.key}: service root ${service.rootDir} does not exist.`);
		}
		if (service.schedule?.length && !service.startCommand) {
			issues.push(`${service.key}: scheduled Railway services require railway.startCommand in treeseed.site.yaml.`);
		}
	}

	if (issues.length > 0) {
		throw new Error(`Railway service configuration is incomplete:\n- ${issues.join('\n- ')}`);
	}

	return {
		services,
		schedules: configuredRailwayScheduledJobs(tenantRoot, scope, { phase: 'deploy' }),
		hostingKind,
		managedTopology,
	};
}

export function validateRailwayDeployPrerequisites(tenantRoot, scope, { env = process.env } = {}) {
	const validation = validateRailwayServiceConfiguration(tenantRoot, scope);
	const token = resolveRailwayAuthToken(env);
	if (typeof token !== 'string' || token.trim().length === 0) {
		throw new Error('Configure TREESEED_RAILWAY_API_TOKEN before deploying Railway-managed services.');
	}
	return validation;
}
