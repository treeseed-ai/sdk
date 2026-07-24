import { loadDeployState } from "../../../operations/services/hosting/deployment/deploy.ts";
import { configuredRailwayServices } from "../../../operations/services/hosting/railway/railway-deploy.ts";
import { ensureRailwayEnvironment, ensureRailwayProject, listRailwayEnvironmentServices, getRailwayServiceInstance, getRailwayProject, listRailwayProjects, listRailwayVariables, resolveRailwayWorkspaceContext } from "../../../operations/services/hosting/railway/railway-api.ts";
import type { RailwayServiceSummary } from "../../../operations/services/hosting/railway/railway-api.ts";
import type { ReconcileAdapterInput } from "../../support/contracts/contracts.ts";
import { buildRailwayEnv, providerCache, resolveReconcileEnvironmentValues } from '../reconciliation/build-workflow-meta-adapter.ts';
import { toDeployTarget } from './to-deploy-target.ts';
import { ensureRailwayEnvironmentForService } from './build-cloudflare-diff.ts';

export async function resolveRailwayTopologyForScope(
	input: ReconcileAdapterInput,
	scope: 'local' | 'staging' | 'prod',
	{
		ensure = false,
		refresh = false,
		serviceKeys,
		includeInstances = ensure,
		includeVariables = false,
	}: {
		ensure?: boolean;
		refresh?: boolean;
		serviceKeys?: string[];
		includeInstances?: boolean;
		includeVariables?: boolean;
	} = {},
) {
	const imageRefValues = resolveReconcileEnvironmentValues(input, scope);
	const imageRefFingerprint = [
		'TREESEED_API_IMAGE_REF',
		'TREESEED_OPERATIONS_RUNNER_IMAGE_REF',
		'TREESEED_AGENT_MANAGER_IMAGE_REF',
		'TREESEED_AGENT_RUNNER_IMAGE_REF',
		'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
	]
		.map((key) => `${key}=${imageRefValues[key] ?? ''}`)
		.join('|');
	const normalizedServiceKeys = Array.isArray(serviceKeys) && serviceKeys.length > 0
		? [...new Set(serviceKeys.map((value) => String(value).trim()).filter(Boolean))].sort()
		: ['__all__'];
	const cacheKey = `railway:topology:${scope}:${ensure ? 'ensure' : 'observe'}:${includeInstances ? 'instances' : 'no-instances'}:${includeVariables ? 'variables' : 'no-variables'}:${normalizedServiceKeys.join(',')}:${imageRefFingerprint}`;
	return await providerCache(input, cacheKey, async () => {
		const env = buildRailwayEnv(input, scope);
		const deployState = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target: toDeployTarget(input.context.target) });
		const services = configuredRailwayServicesForInput(input, scope)
			.filter((service) => normalizedServiceKeys.includes('__all__') || normalizedServiceKeys.includes(service.key));
		traceRailwayReconcile(env, 'topology:start', `scope=${scope} ensure=${ensure ? 'yes' : 'no'} services=${services.map((service) => service.key).join(',')}`);
		let workspace = null as Awaited<ReturnType<typeof resolveRailwayWorkspaceContext>> | null;
		const knownProjects: Array<Awaited<ReturnType<typeof getRailwayProject>>> = [];
		const knownProjectIds = [...new Set(services
			.map((service) => service.projectId || deployState.services?.[service.key]?.projectId || '')
			.filter((value) => typeof value === 'string' && value.trim().length > 0)
			.map((value) => value.trim()))];
		for (const projectId of knownProjectIds) {
			traceRailwayReconcile(env, 'topology:known-project:get', projectId);
			const project = await getRailwayProject({ projectId, env });
			traceRailwayReconcile(env, 'topology:known-project:done', `${projectId}:${project?.name ?? '(missing)'}`);
			if (project) {
				knownProjects.push(project);
			}
		}
		if (knownProjects.length === 0 || services.some((service) => !(service.projectId || deployState.services?.[service.key]?.projectId))) {
			traceRailwayReconcile(env, 'topology:workspace:get', 'start');
			workspace = await resolveRailwayWorkspaceContext({ env });
			traceRailwayReconcile(env, 'topology:workspace:done', workspace.name);
			traceRailwayReconcile(env, 'topology:projects:list', workspace.name);
			const listedProjects = await listRailwayProjects({
				env,
				workspaceId: workspace.id,
			});
			traceRailwayReconcile(env, 'topology:projects:list:done', String(listedProjects.length));
			for (const project of listedProjects) {
				if (!knownProjects.find((entry) => entry?.id === project.id)) {
					knownProjects.push(project);
				}
			}
		}
		const projectsByKey = new Map<string, (typeof knownProjects)[number]>();
		for (const project of knownProjects) {
			if (!project) {
				continue;
			}
			if (typeof project.deletedAt === 'string' && project.deletedAt.trim()) {
				continue;
			}
			projectsByKey.set(project.id, project);
			projectsByKey.set(project.name, project);
		}
		const resolvedServices = new Map<string, {
			configuredService: ReturnType<typeof configuredRailwayServices>[number];
			project: Awaited<ReturnType<typeof ensureRailwayProject>>['project'] | null;
			environment: Awaited<ReturnType<typeof ensureRailwayEnvironment>>['environment'] | null;
			service: RailwayServiceSummary | null;
			instance: Awaited<ReturnType<typeof getRailwayServiceInstance>> | null;
			currentVariables: Record<string, string | null>;
		}>();

		for (const service of services) {
			traceRailwayReconcile(env, 'topology:service:start', service.key);
			const persistedService = deployState.services?.[service.key] ?? {};
			const resolvedProjectId = service.projectId ?? persistedService.projectId ?? '';
			const resolvedProjectName = service.projectName ?? persistedService.projectName ?? '';
			const resolvedServiceId = service.serviceId ?? persistedService.serviceId ?? '';
			const resolvedServiceName = service.serviceName ?? persistedService.serviceName ?? '';
			let project = projectsByKey.get(resolvedProjectId)
				?? projectsByKey.get(resolvedProjectName)
				?? null;
			if (project && (!Array.isArray(project.services) || project.services.length === 0 || !Array.isArray(project.environments) || project.environments.length === 0)) {
				const hydratedProject = await getRailwayProject({ projectId: project.id, env });
				if (hydratedProject) {
					project = hydratedProject;
					projectsByKey.set(project.id, project);
					projectsByKey.set(project.name, project);
				}
			}
			if (project) {
				traceRailwayReconcile(env, 'topology:project:resolved', `${service.key}:${project.name}:services=${project.services.map((entry) => entry.name).join(',') || '(none)'}:envs=${project.environments.map((entry) => entry.name).join(',') || '(none)'}`);
			}
			if (!project && ensure) {
				if (!workspace) {
					traceRailwayReconcile(env, 'topology:workspace', 'resolving workspace');
					workspace = await resolveRailwayWorkspaceContext({ env });
				}
				traceRailwayReconcile(env, 'topology:project:ensure', `${service.key}:${resolvedProjectName || resolvedProjectId}`);
				const ensuredProject = await ensureRailwayProject({
					projectId: resolvedProjectId,
					projectName: resolvedProjectName,
					defaultEnvironmentName: service.railwayEnvironment || 'staging',
					env,
					workspace: workspace.name,
				});
				project = ensuredProject.project;
				projectsByKey.set(project.id, project);
				projectsByKey.set(project.name, project);
			}

			let environment = project?.environments.find((entry) => entry.name === service.railwayEnvironment || entry.id === service.railwayEnvironment) ?? null;
			if (project) {
				traceRailwayReconcile(env, 'topology:environment:resolved', `${service.key}:${environment?.name ?? '(none)'}:${service.railwayEnvironment}`);
			}
			if (project && !environment && ensure) {
				traceRailwayReconcile(env, 'topology:environment:ensure', `${service.key}:${service.railwayEnvironment}`);
				environment = await ensureRailwayEnvironmentForService({
					service,
					project,
					environmentName: service.railwayEnvironment,
					env,
				});
				project = {
					...project,
					environments: [...project.environments.filter((entry) => entry.id !== environment?.id), environment],
				};
				projectsByKey.set(project.id, project);
				projectsByKey.set(project.name, project);
			}

			if (project && environment && (!Array.isArray(project.services) || project.services.length === 0 || !project.services.some((entry) => entry.id === resolvedServiceId || entry.name === resolvedServiceName))) {
				const environmentServices = await listRailwayEnvironmentServices({ environmentId: environment.id, env }).catch(() => []);
				traceRailwayReconcile(env, 'topology:environment-services:lookup', `${service.key}:${environment.name}:${environmentServices.map((entry) => entry.name).join(',') || '(none)'}`);
				if (environmentServices.length > 0) {
					project = {
						...project,
						services: [...new Map([...project.services, ...environmentServices].map((entry) => [entry.id, entry])).values()],
					};
					projectsByKey.set(project.id, project);
					projectsByKey.set(project.name, project);
					traceRailwayReconcile(env, 'topology:environment-services:resolved', `${service.key}:${environmentServices.map((entry) => entry.name).join(',')}`);
				}
			}

			const resolvedService = project?.services.find((entry) => entry.id === resolvedServiceId || entry.name === resolvedServiceName) ?? null;
			let instance = null;
			if (includeInstances && resolvedService && environment) {
				instance = await getRailwayServiceInstance({
					serviceId: resolvedService.id,
					environmentId: environment.id,
					env,
				});
			}

			const currentVariables = includeVariables && project && environment && resolvedService
				? await listRailwayVariables({
					projectId: project.id,
					environmentId: environment.id,
					serviceId: resolvedService.id,
					env,
				})
				: {};

			resolvedServices.set(service.instanceKey ?? service.serviceName ?? service.key, {
				configuredService: service,
				project,
				environment,
				service: resolvedService,
				instance,
				currentVariables,
			});
			traceRailwayReconcile(env, 'topology:service:done', service.key);
		}
		traceRailwayReconcile(env, 'topology:done', `scope=${scope}`);

		return {
			scope,
			env,
			workspace: workspace ?? {
				id: '',
				name: String(env.TREESEED_RAILWAY_WORKSPACE ?? '').trim(),
			},
			services: resolvedServices,
		};
	}, refresh);
}

export function traceRailwayReconcile(env: Record<string, string | undefined> | undefined, stage: string, message: string) {
	if (env?.TREESEED_RECONCILE_TRACE === '1' || process.env.TREESEED_RECONCILE_TRACE === '1') {
		console.error(`[trsd][railway][${stage}] ${message}`);
	}
}

export function railwayDriftSessionKey(scope: string) {
	return `railway:provider-drift:${scope}`;
}

export function recordRailwayProviderDrift(input: ReconcileAdapterInput, scope: string, drift: Record<string, unknown>) {
	const key = railwayDriftSessionKey(scope);
	const current = input.context.session.get(key);
	const entries = Array.isArray(current) ? current : [];
	entries.push(drift);
	input.context.session.set(key, entries);
}

export function railwayProviderDrift(input: ReconcileAdapterInput, scope: string) {
	const current = input.context.session.get(railwayDriftSessionKey(scope));
	return Array.isArray(current) ? current as Array<Record<string, unknown>> : [];
}

export function configuredRailwayServicesForInput(input: ReconcileAdapterInput, scope: 'local' | 'staging' | 'prod') {
	return configuredRailwayServices(input.context.tenantRoot, scope, resolveReconcileEnvironmentValues(input, scope));
}

export function assertNoBlockedRailwayProviderDrift(input: ReconcileAdapterInput, scope: string) {
	const blocked = railwayProviderDrift(input, scope).filter((drift) => drift.status === 'blocked' || drift.action === 'blocked' || drift.action === 'manual-repair-required');
	if (blocked.length === 0) return;
	const reasons = blocked.map((drift) => String(drift.reason ?? drift.kind ?? 'unknown Railway drift'));
	throw new Error(`Railway provider drift blocks reconciliation: ${reasons.join('; ')}`);
}

export function activeRailwayVolumeInstances(volume: { instances?: Array<{ state?: string | null }> }) {
	const instances = Array.isArray(volume.instances) ? volume.instances : [];
	return instances.filter((instance) => {
		const state = String(instance.state ?? 'READY').toUpperCase();
		const pendingDeletion = 'isPendingDeletion' in instance && instance.isPendingDeletion === true;
		const deletedAt = 'deletedAt' in instance && typeof instance.deletedAt === 'string' && instance.deletedAt.trim();
		return !pendingDeletion && !deletedAt && state !== 'DELETING' && state !== 'DELETED';
	});
}

export function isRailwayCapacityProviderService(service: ReturnType<typeof configuredRailwayServices>[number]) {
	return String(service.key ?? '').startsWith('capacityProvider');
}

export function railwayServiceMatchesKey(service: ReturnType<typeof configuredRailwayServices>[number], key: string) {
	return service.key === key || service.instanceKey === key || service.serviceName === key || service.serviceId === key;
}
