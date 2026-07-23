import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveTreeseedWebCachePolicy } from '../../../platform/deploy-config.ts';
import {
	deleteRailwayCustomDomain,
	deleteRailwayEnvironment,
	deleteRailwayVolume,
	getRailwayServiceInstance,
	listRailwayCustomDomains,
	listRailwayProjects,
	listRailwayVariables,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	resolveRailwayApiToken,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
} from '../railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from '../runtime-tools.ts';
import { sdkD1MigrationsRoot } from '../runtime-paths.ts';
import { resourceOperation } from './collect-missing-deploy-inputs.ts';
import { cloudflareApiRequest, listCloudflareZoneRulesets, resolveCloudflareZoneIdForHost } from './cloudflare-api-request.ts';
import { resolveTreeseedResourceIdentity } from './default-compatibility-date.ts';
import { createPersistentDeployTarget } from './configured-surface-hosts.ts';

export function deleteTreeseedCacheRules(deployConfig, state, { env, planOnly }) {
	const targets = [
		{ role: 'web', zoneId: state.webCache?.webZoneId, host: state.webCache?.webHost },
		{ role: 'content', zoneId: state.webCache?.contentZoneId, host: state.webCache?.contentHost },
	].filter((entry) => entry.host || entry.zoneId);
	if (targets.length === 0) {
		return [resourceOperation('cloudflare', 'cache-rules', null, 'missing')];
	}
	return targets.map((target) => {
		const zoneId = target.zoneId ?? resolveCloudflareZoneIdForHost(deployConfig, target.host, env);
		if (!zoneId) {
			return resourceOperation('cloudflare', 'cache-rules', target.host, 'blocked', { reason: 'zone_unresolved' });
		}
		if (planOnly) {
			return resourceOperation('cloudflare', 'cache-rules', target.host, 'planned', { zoneId });
		}
		const rulesets = listCloudflareZoneRulesets(zoneId, env);
		const ruleset = rulesets.find((entry) => entry?.phase === 'http_request_cache_settings') ?? null;
		const rules = Array.isArray(ruleset?.rules) ? ruleset.rules : [];
		const kept = rules.filter((rule) => typeof rule?.description !== 'string' || !rule.description.startsWith('treeseed-managed:'));
		if (!ruleset || kept.length === rules.length) {
			return resourceOperation('cloudflare', 'cache-rules', target.host, 'missing', { zoneId });
		}
		cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/rulesets/${encodeURIComponent(ruleset.id)}`, {
			method: 'PUT',
			body: { rules: kept },
			env,
		});
		return resourceOperation('cloudflare', 'cache-rules', target.host, 'deleted', { zoneId, rulesetId: ruleset.id, removed: rules.length - kept.length });
	});
}

export function configuredRailwayDestroyTargets(tenantRoot, deployConfig, scope) {
	const normalizedScope = scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
	if (normalizedScope === 'local' || deployConfig.runtime?.mode !== 'treeseed_managed') {
		return [];
	}
	let identity;
	try {
		identity = resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget(normalizedScope));
	} catch {
		identity = { deploymentKey: deployConfig.slug ?? deployConfig.name ?? 'treeseed' };
	}
	const services = [];
	for (const serviceKey of ['api', 'operationsRunner']) {
		const service = deployConfig.services?.[serviceKey];
		if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
			continue;
		}
		const baseServiceName = service.environments?.[normalizedScope]?.serviceName
			?? service.railway?.serviceName
			?? `${identity.deploymentKey}-${serviceKey === 'operationsRunner' ? 'operations-runner' : serviceKey}`;
		const runnerPool = serviceKey === 'operationsRunner' && service.railway?.runnerPool && typeof service.railway.runnerPool === 'object'
			? service.railway.runnerPool
			: null;
		const count = serviceKey === 'operationsRunner'
			? Math.max(1, Number.parseInt(String(runnerPool?.bootstrapCount ?? 1), 10) || 1)
			: 1;
		for (let index = 1; index <= count; index += 1) {
			const serviceName = serviceKey === 'operationsRunner'
				? `${String(baseServiceName).replace(/-\d+$/u, '').replace(/-\d{2}$/u, '')}-${String(index).padStart(2, '0')}`
				: baseServiceName;
			services.push({
				key: serviceKey,
				projectName: service.railway?.projectName ?? identity.deploymentKey,
				serviceName,
				railwayEnvironment: normalizeRailwayEnvironmentName(service.environments?.[normalizedScope]?.railwayEnvironment ?? normalizedScope),
				domain: service.environments?.[normalizedScope]?.domain ?? null,
				volumeMountPath: serviceKey === 'operationsRunner' ? (service.railway?.volumeMountPath ?? runnerPool?.volumeMountPath ?? '/data') : null,
			});
		}
	}
	const treeseedDatabase = deployConfig.services?.treeseedDatabase;
	if (treeseedDatabase?.enabled !== false && treeseedDatabase?.provider === 'railway' && treeseedDatabase?.railway?.resourceType === 'postgres') {
		const baseName = typeof treeseedDatabase.railway?.serviceName === 'string' && treeseedDatabase.railway.serviceName.trim()
			? treeseedDatabase.railway.serviceName.trim()
			: `${deployConfig.slug ?? 'treeseed-market'}-postgres`;
		services.push({
			key: 'treeseedDatabase',
			projectName: deployConfig.services?.api?.railway?.projectName ?? identity.deploymentKey,
			serviceName: baseName.replace(/-(staging|prod|production)$/u, ''),
			railwayEnvironment: normalizeRailwayEnvironmentName(normalizedScope),
			domain: null,
			volumeMountPath: null,
			dataStore: true,
		});
	}
	return services;
}

export async function destroyRailwayResources(tenantRoot, deployConfig, target, { planOnly = false, deleteData = false, env = process.env } = {}) {
	const scope = target.kind === 'persistent' ? target.scope : target.branchName;
	const services = configuredRailwayDestroyTargets(tenantRoot, deployConfig, scope);
	if (services.length === 0) {
		return { operations: [resourceOperation('railway', 'environment', scope, 'skipped', { reason: 'not_applicable' })] };
	}
	const operations = [];
	if (!resolveRailwayApiToken(env)) {
		return {
			operations: services.map((service) => resourceOperation('railway', 'service', service.serviceName, 'blocked', { reason: 'missing_railway_api_token' })),
		};
	}
	const workspace = await resolveRailwayWorkspaceContext({ env, workspace: resolveRailwayWorkspace(env) });
	const projects = await listRailwayProjects({ env, workspaceId: workspace.id });
	const projectNames = [...new Set(services.map((service) => service.projectName).filter(Boolean))];
	for (const projectName of projectNames) {
		const project = projects.find((entry) => !entry.deletedAt && (entry.name === projectName || entry.id === projectName)) ?? null;
		if (!project) {
			operations.push(resourceOperation('railway', 'project', projectName, 'missing'));
			continue;
		}
		const serviceTargets = services.filter((service) => service.projectName === projectName);
		const environmentName = normalizeRailwayEnvironmentName(scope);
		const environment = project.environments.find((entry) => entry.name === environmentName || entry.id === environmentName) ?? null;
		if (!environment) {
			operations.push(resourceOperation('railway', 'environment', environmentName, 'missing', { projectId: project.id }));
		}
		for (const service of serviceTargets) {
			const railwayService = project.services.find((entry) => entry.name === service.serviceName || entry.id === service.serviceName) ?? null;
			const shouldDeleteData = service.dataStore ? deleteData : true;
			operations.push(resourceOperation('railway', service.dataStore ? 'postgres-service' : 'service', service.serviceName, railwayService ? (planOnly ? 'planned' : 'planned') : 'missing', {
				projectId: project.id,
				serviceId: railwayService?.id ?? null,
				...(service.dataStore && !shouldDeleteData ? { status: 'skipped', reason: 'data_preserved' } : {}),
			}));
			if (!railwayService || !environment) {
				continue;
			}
			if (shouldDeleteData) {
				const variables = await listRailwayVariables({
					projectId: project.id,
					environmentId: environment.id,
					serviceId: railwayService.id,
					env,
				});
				for (const variableName of Object.keys(variables).sort()) {
					operations.push(resourceOperation('railway', 'variable', `${service.serviceName}:${variableName}`, planOnly ? 'planned' : 'deleted', {
						projectId: project.id,
						serviceId: railwayService.id,
						environmentId: environment.id,
						reason: scope === 'prod' && deleteData ? 'project_delete' : 'environment_delete',
					}));
				}
			}
			const instance = await getRailwayServiceInstance({ serviceId: railwayService.id, environmentId: environment.id, env });
			if (instance.cronSchedule) {
				operations.push(resourceOperation('railway', 'schedule', `${service.serviceName}:${instance.cronSchedule}`, planOnly ? 'planned' : 'deleted', {
					projectId: project.id,
					serviceId: railwayService.id,
					environmentId: environment.id,
					reason: scope === 'prod' && deleteData ? 'project_delete' : 'environment_delete',
				}));
			}
			if (!service.dataStore && service.domain) {
				const domains = await listRailwayCustomDomains({ projectId: project.id, environmentId: environment.id, serviceId: railwayService.id, env });
				for (const domain of domains.filter((entry) => entry.domain === service.domain)) {
					if (planOnly) {
						operations.push(resourceOperation('railway', 'custom-domain', domain.domain, 'planned', { id: domain.id }));
					} else {
						const result = await deleteRailwayCustomDomain({ projectId: project.id, environmentId: environment.id, serviceId: railwayService.id, domainId: domain.id, env });
						operations.push(resourceOperation('railway', 'custom-domain', domain.domain, result.status, { id: domain.id }));
					}
				}
			}
		}
		if (deleteData) {
			const volumes = await listRailwayVolumes({ projectId: project.id, env });
			for (const volume of volumes) {
				const matchingInstance = volume.instances.find((instance) => instance.environmentId === environment?.id);
				if (!matchingInstance) {
					continue;
				}
				if (planOnly) {
					operations.push(resourceOperation('railway', 'volume', volume.name, 'planned', { id: volume.id, projectId: project.id }));
				} else {
					const result = await deleteRailwayVolume({ projectId: project.id, environmentId: environment.id, volumeId: volume.id, env });
					operations.push(resourceOperation('railway', 'volume', volume.name, result.status, { id: volume.id, projectId: project.id }));
				}
			}
		}
		const shouldDeleteProject = shouldDeleteRailwayProjectAfterEnvironmentDestroy(project, scope, deleteData, environment?.id ?? null);
		if ((scope === 'prod' && deleteData) || shouldDeleteProject) {
			if (planOnly) {
				operations.push(resourceOperation('railway', 'project', project.name, 'planned', {
					id: project.id,
					reason: scope === 'prod' ? 'prod_delete_data_cleanup' : 'no_managed_persistent_environments',
				}));
			} else {
				throw new Error('Railway project deletion is reconciler-owned. Use trsd reconcile destroy or live acceptance cleanup for project-scoped deletion.');
			}
		} else if (environment) {
			if (planOnly) {
				operations.push(resourceOperation('railway', 'environment', environment.name, 'planned', { id: environment.id, projectId: project.id }));
			} else {
				const result = await deleteRailwayEnvironment({ projectId: project.id, environmentId: environment.id, env });
				operations.push(resourceOperation('railway', 'environment', environment.name, result.status, { id: environment.id, projectId: project.id }));
			}
		}
	}
	return { operations };
}

export function shouldDeleteRailwayProjectAfterEnvironmentDestroy(project, scope, deleteData, deletedEnvironmentId = null) {
	if (!deleteData || scope === 'prod') {
		return false;
	}
	const managedPersistentNames = new Set(['staging', 'production', 'prod']);
	const targetEnvironmentName = normalizeRailwayEnvironmentName(scope);
	const remainingManagedEnvironments = (project?.environments ?? [])
		.filter((environment) => environment?.id !== deletedEnvironmentId)
		.filter((environment) => environment?.name !== targetEnvironmentName)
		.filter((environment) => managedPersistentNames.has(environment?.name));
	return remainingManagedEnvironments.length === 0;
}

export function killPidFromFile(filePath, { planOnly }) {
	const pid = Number.parseInt(readFileSync(filePath, 'utf8').trim(), 10);
	if (!Number.isFinite(pid) || pid <= 0) {
		return resourceOperation('local', 'dev-process', filePath, 'missing');
	}
	if (planOnly) {
		return resourceOperation('local', 'dev-process', String(pid), 'planned', { pidFile: filePath });
	}
	try {
		process.kill(-pid, 'SIGTERM');
	} catch {
		try {
			process.kill(pid, 'SIGTERM');
		} catch {
			// Already stopped or not owned by this session.
		}
	}
	try {
		unlinkSync(filePath);
	} catch {
		// Best effort cleanup.
	}
	return resourceOperation('local', 'dev-process', String(pid), 'deleted', { pidFile: filePath });
}

export const LOCAL_DOCKER_RESOURCE_PATTERN = /(?:^|[-_.])(?:treeseed|treedx|treedb)(?:[-_.]|$)|(?:treeseed|treedx|treedb)/iu;

export let destroyDockerRunnerForTests = null;

export function setDestroyDockerRunnerForTests(runner) {
	destroyDockerRunnerForTests = runner;
}

export function runDestroyDocker(args) {
	if (destroyDockerRunnerForTests) {
		return destroyDockerRunnerForTests(args);
	}
	return spawnSync('docker', args, { encoding: 'utf8', stdio: 'pipe' });
}

export function dockerAvailable() {
	const result = runDestroyDocker(['info']);
	return result.status === 0;
}
