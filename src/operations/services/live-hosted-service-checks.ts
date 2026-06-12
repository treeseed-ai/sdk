import { loadCliDeployConfig } from './runtime-tools.ts';
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
} from './railway-api.ts';
import { configuredRailwayServices, findStaleTreeseedOperationsRunnerResources } from './railway-deploy.ts';
import { discoverTreeseedApplications } from '../../hosting/apps.ts';
import {
	collectTreeseedHostedServiceChecks,
	type TreeseedHostedServiceCheckReport,
	type TreeseedHostedServiceTarget,
	type TreeseedObservedRailwayServiceState,
} from './hosted-service-checks.ts';

export interface TreeseedLiveHostedServiceCheckOptions {
	tenantRoot: string;
	target: TreeseedHostedServiceTarget;
	appId?: string;
	strict?: boolean;
	requireLiveRailway?: boolean;
	requireLiveHttp?: boolean;
	timeoutMs?: number;
	retry?: {
		attempts: number;
		intervalMs: number;
	};
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}

export interface TreeseedLiveHostedServiceCheckReport extends TreeseedHostedServiceCheckReport {
	live: true;
	liveObservation: {
		railway: 'observed' | 'skipped' | 'failed';
		http: 'observed' | 'skipped' | 'failed';
		issues: string[];
	};
}

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeBaseUrl(value: unknown) {
	return typeof value === 'string' && value.trim()
		? value.trim().replace(/\/+$/u, '')
		: null;
}

function urlForDomain(value: unknown) {
	const normalized = normalizeBaseUrl(value);
	if (!normalized) return null;
	return /^https?:\/\//iu.test(normalized) ? normalized : `https://${normalized}`;
}

function selectedWebConfig(deployConfig: Record<string, any>, selectedApplication: ReturnType<typeof discoverTreeseedApplications>[number] | null) {
	return selectedApplication?.roles.includes('web') ? selectedApplication.config : deployConfig;
}

function pagesBranchName(config: Record<string, any>, target: TreeseedHostedServiceTarget) {
	const pages = config.cloudflare?.pages && typeof config.cloudflare.pages === 'object'
		? config.cloudflare.pages
		: {};
	const key = target === 'prod' ? 'productionBranch' : 'stagingBranch';
	const fallback = target === 'prod' ? 'main' : 'staging';
	return typeof pages[key] === 'string' && pages[key].trim() ? pages[key].trim() : fallback;
}

async function observeHttp(url: string, options: TreeseedLiveHostedServiceCheckOptions) {
	const attempts = Math.max(1, Math.floor(options.retry?.attempts ?? 3));
	const intervalMs = Math.max(0, Math.floor(options.retry?.intervalMs ?? 1500));
	const timeoutMs = Math.max(1000, Math.floor(options.timeoutMs ?? 10000));
	let lastError = '';
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), timeoutMs);
		try {
			const response = await (options.fetchImpl ?? fetch)(url, {
				method: 'GET',
				headers: { accept: 'application/json, text/plain, */*' },
				signal: controller.signal,
			});
			clearTimeout(timeout);
			return { status: response.status, ok: response.ok };
		} catch (error) {
			clearTimeout(timeout);
			lastError = error instanceof Error ? error.message : String(error);
			if (attempt + 1 < attempts) await sleep(intervalMs);
		}
	}
	return { ok: false, error: lastError || 'HTTP request failed.' };
}

async function inspectRailwayServiceDeploymentHealthWithRetry(input: {
	serviceId: string;
	environmentId: string;
	options: TreeseedLiveHostedServiceCheckOptions;
}) {
	const attempts = Math.max(1, Math.floor(input.options.retry?.attempts ?? 3));
	const intervalMs = Math.max(0, Math.floor(input.options.retry?.intervalMs ?? 1500));
	let lastDeployment: Awaited<ReturnType<typeof inspectRailwayServiceDeploymentHealth>> | null = null;
	let lastError: unknown = null;
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		try {
			const deployment = await inspectRailwayServiceDeploymentHealth({
				serviceId: input.serviceId,
				environmentId: input.environmentId,
				env: input.options.env,
				fetchImpl: input.options.fetchImpl,
			});
			lastDeployment = deployment;
			if (deployment.ok) return deployment;
		} catch (error) {
			lastError = error;
		}
		if (attempt + 1 < attempts) await sleep(intervalMs);
	}
	return lastDeployment ?? {
		ok: false,
		status: null,
		message: lastError instanceof Error ? lastError.message : String(lastError ?? 'Unable to inspect deployment health.'),
	};
}

function findByName<T extends { name?: string | null; id?: string | null }>(items: T[], nameOrId: string | null | undefined) {
	if (!nameOrId) return null;
	return items.find((item) => item.name === nameOrId || item.id === nameOrId) ?? null;
}

function indexedName(baseName: string, index: number) {
	return `${baseName.replace(/-\d+$/u, '')}-${String(Math.max(1, index)).padStart(2, '0')}`;
}

function activeRailwayVolumeInstances(volume: { instances?: Array<{ state?: string | null }> }) {
	const instances = Array.isArray(volume.instances) ? volume.instances : [];
	return instances.filter((instance) => {
		const state = String(instance.state ?? 'READY').toUpperCase();
		return state !== 'DELETING' && state !== 'DELETED';
	});
}

function railwayVolumeInstanceStates(volume: { instances?: Array<{ state?: string | null }> }) {
	const states = (Array.isArray(volume.instances) ? volume.instances : [])
		.map((instance) => String(instance.state ?? 'READY').trim().toUpperCase())
		.filter(Boolean);
	return states.length > 0 ? [...new Set(states)].join(',') : 'none';
}

async function collectRailwayObservations(options: TreeseedLiveHostedServiceCheckOptions) {
	const observed: Record<string, TreeseedObservedRailwayServiceState> = {};
	const issues: string[] = [];
	const inspectedVolumeScopes = new Set<string>();
	const inspectedRunnerScopes = new Set<string>();
	try {
		const workspace = await resolveRailwayWorkspaceContext({ env: options.env, fetchImpl: options.fetchImpl });
		const projects = await listRailwayProjects({ workspaceId: workspace.id, env: options.env, fetchImpl: options.fetchImpl });
		const configuredServices = configuredRailwayServices(options.tenantRoot, options.target).filter((entry) => !options.appId || entry.application?.id === options.appId);
		for (const service of configuredServices) {
			const project = service.projectId
				? findByName(projects, service.projectId)
				: findByName(projects, service.projectName);
			if (!project?.id) {
				issues.push(`${service.serviceName}: Railway project ${service.projectName} was not found.`);
				continue;
			}
			const environments = await listRailwayEnvironments({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl });
			const environment = findByName(environments, service.railwayEnvironment);
			if (!environment?.id) {
				issues.push(`${service.serviceName}: Railway environment ${service.railwayEnvironment} was not found.`);
				continue;
			}
			const volumeScope = `${project.id}:${environment.id}`;
			if (!inspectedVolumeScopes.has(volumeScope)) {
				inspectedVolumeScopes.add(volumeScope);
				const volumes = await listRailwayVolumes({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => []);
				for (const volume of volumes) {
					const detachedPostgresInstances = activeRailwayVolumeInstances(volume).filter((instance) =>
						instance.environmentId === environment.id
						&& instance.mountPath === '/var/lib/postgresql/data'
						&& !instance.serviceId
					);
					if (detachedPostgresInstances.length > 0) {
						issues.push(`${volume.name ?? volume.id}: detached PostgreSQL volume remains in Railway project ${project.name} (states=${railwayVolumeInstanceStates(volume)}).`);
					}
				}
			}
			const services = await listRailwayServices({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl });
			const runnerScope = `${project.id}:${environment.id}`;
			if (service.key === 'operationsRunner' && !inspectedRunnerScopes.has(runnerScope)) {
				inspectedRunnerScopes.add(runnerScope);
				const desiredRunnerNames = new Set(configuredServices
					.filter((entry) => entry.key === 'operationsRunner')
					.filter((entry) => (entry.projectId ? entry.projectId === project.id : entry.projectName === project.name))
					.filter((entry) => normalizeRailwayEnvironmentName(entry.railwayEnvironment) === normalizeRailwayEnvironmentName(environment.name))
					.map((entry) => entry.serviceName)
					.filter(Boolean));
				const desiredRunnerServiceIds = new Set(services
					.filter((entry) => desiredRunnerNames.has(entry.name))
					.map((entry) => entry.id));
				for (const staleService of findStaleTreeseedOperationsRunnerResources(services, desiredRunnerNames)) {
					issues.push(`${staleService.name}: stale operations runner Railway service remains in project ${project.name}.`);
				}
				const volumes = await listRailwayVolumes({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => []);
				const desiredRunnerVolumeNames = new Set([...desiredRunnerNames].map((name) => `${name}-volume`));
				for (const staleVolume of findStaleTreeseedOperationsRunnerResources(volumes, desiredRunnerVolumeNames)) {
					const activeInstances = activeRailwayVolumeInstances(staleVolume);
					const relevant = staleVolume.instances.length === 0 || activeInstances.length > 0;
					const attachedToDesiredRunner = activeInstances.some((instance) => desiredRunnerServiceIds.has(instance.serviceId ?? ''));
					if (relevant && !attachedToDesiredRunner) {
						issues.push(`${staleVolume.name ?? staleVolume.id}: stale operations runner Railway volume remains in project ${project.name} (states=${railwayVolumeInstanceStates(staleVolume)}).`);
					}
				}
			}
			const railwayService = service.serviceId
				? findByName(services, service.serviceId)
				: findByName(services, service.serviceName);
			if (!railwayService?.id) {
				issues.push(`${service.serviceName}: Railway service was not found.`);
				continue;
			}
			const [instance, variables, volumes] = await Promise.all([
				getRailwayServiceInstance({ serviceId: railwayService.id, environmentId: environment.id, env: options.env, fetchImpl: options.fetchImpl }),
				listRailwayVariables({ projectId: project.id, environmentId: environment.id, serviceId: railwayService.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => ({})),
				listRailwayVolumes({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => []),
			]);
			const volume = Array.isArray(volumes)
				? volumes.flatMap((entry: any) => Array.isArray(entry.instances)
					? entry.instances
					: Array.isArray(entry.volumeInstances) ? entry.volumeInstances : [])
					.find((entry: any) => entry?.serviceId === railwayService.id && entry?.environmentId === environment.id)
				: null;
			const variableKeys = Object.keys(variables ?? {});
			observed[service.serviceName] = {
				projectName: project.name,
				environmentName: environment.name,
				serviceName: railwayService.name,
				rootDirectory: instance.rootDirectory,
				buildCommand: instance.buildCommand,
				startCommand: instance.startCommand,
				healthcheckPath: instance.healthcheckPath,
				healthcheckTimeoutSeconds: instance.healthcheckTimeoutSeconds,
				runtimeMode: service.runtimeMode ?? instance.runtimeMode,
				volumeMountPath: volume?.mountPath ?? null,
				variables: variableKeys,
				secrets: variableKeys,
				health: 'unknown',
			};
		}
		const deployConfig = loadCliDeployConfig(options.tenantRoot);
		const appConfigs = [
			...(!options.appId || options.appId === 'web' ? [deployConfig] : []),
			...discoverTreeseedApplications(options.tenantRoot)
				.filter((application) => application.id === 'api' && (!options.appId || options.appId === 'api'))
				.map((application) => application.config),
		];
		for (const config of appConfigs) {
			const nodePool = config.publicTreeDxFederation?.railway?.nodePool;
			if (!nodePool && config.hosting?.kind !== 'treeseed_control_plane') continue;
			const bootstrapCount = Math.max(1, Number.parseInt(String(nodePool?.bootstrapCount ?? 1), 10) || 1);
			const projectName = config.slug ?? 'treeseed-api';
			const environmentName = normalizeRailwayEnvironmentName(options.target) || options.target;
			const project = findByName(projects, projectName);
			if (!project?.id) {
				issues.push(`public-treedx: Railway project ${projectName} was not found.`);
				continue;
			}
			const environments = await listRailwayEnvironments({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl });
			const environment = findByName(environments, environmentName);
			if (!environment?.id) {
				issues.push(`public-treedx: Railway environment ${environmentName} was not found.`);
				continue;
			}
			const [services, volumes] = await Promise.all([
				listRailwayServices({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl }),
				listRailwayVolumes({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => []),
			]);
			for (let index = 1; index <= bootstrapCount; index += 1) {
				const serviceName = indexedName('public-treedx-node', index);
				const volumeName = `${serviceName}-volume`;
				const configuredNode = Array.isArray(config.services)
					? config.services.find((service: any) => service?.id === serviceName || service?.name === serviceName)
					: null;
				const volumeMountPath = typeof configuredNode?.volumeMountPath === 'string' && configuredNode.volumeMountPath.trim()
					? configuredNode.volumeMountPath.trim()
					: '/data';
				const service = findByName(services, serviceName);
				if (!service?.id) {
					issues.push(`${serviceName}: public TreeDX Railway service was not found.`);
					continue;
				}
				const deployment = await inspectRailwayServiceDeploymentHealthWithRetry({
					serviceId: service.id,
					environmentId: environment.id,
					options,
				}).catch((error) => ({
					ok: false,
					status: null,
					message: error instanceof Error ? error.message : String(error ?? 'Unable to inspect TreeDX deployment health.'),
				}));
				if (!deployment.ok) {
					issues.push(`${serviceName}: public TreeDX latest deployment is not healthy. ${deployment.message}`);
				}
				const variables = await listRailwayVariables({ projectId: project.id, environmentId: environment.id, serviceId: service.id, env: options.env, fetchImpl: options.fetchImpl }).catch(() => ({}));
				if (variables.TREEDX_FEDERATION_MODE !== 'connected_library') {
					issues.push(`${serviceName}: TREEDX_FEDERATION_MODE is not connected_library.`);
				}
				const mountedVolume = volumes.find((volume) => volume.name === volumeName && volume.instances.some((instance) =>
					instance.serviceId === service.id
					&& instance.environmentId === environment.id
					&& instance.mountPath === volumeMountPath
				));
				if (!mountedVolume) {
					issues.push(`${serviceName}: public TreeDX volume ${volumeName} is not mounted at ${volumeMountPath}.`);
				}
			}
		}
		return { observed, status: 'observed' as const, issues };
	} catch (error) {
		return {
			observed,
			status: 'failed' as const,
			issues: [...issues, error instanceof Error ? error.message : String(error)],
		};
	}
}

async function collectHttpObservations(options: TreeseedLiveHostedServiceCheckOptions) {
	const deployConfig = loadCliDeployConfig(options.tenantRoot);
	const urls = new Set<string>();
	const fallbacks = new Map<string, string>();
	const selectedApplication = options.appId
		? discoverTreeseedApplications(options.tenantRoot).find((application) => application.id === options.appId || application.relativeRoot === options.appId)
		: null;
	if (!options.appId || options.appId === 'web' || selectedApplication?.roles.includes('web')) {
		const webConfig = selectedWebConfig(deployConfig, selectedApplication);
		const webDomain = webConfig.surfaces?.web?.environments?.[options.target]?.domain
			?? webConfig.surfaces?.web?.publicBaseUrl
			?? webConfig.siteUrl;
		const webUrl = urlForDomain(webDomain);
		if (webUrl) {
			urls.add(webUrl);
			if (!options.appId || options.appId === 'web' || selectedApplication?.roles.includes('api')) {
				urls.add(`${webUrl}/v1/healthz`);
			}
			const pagesProjectName = webConfig.cloudflare?.pages?.projectName;
			if (pagesProjectName) {
				const branchName = pagesBranchName(webConfig, options.target);
				const pagesUrl = options.target === 'prod'
					? `https://${pagesProjectName}.pages.dev`
					: `https://${branchName}.${pagesProjectName}.pages.dev`;
				fallbacks.set(webUrl, pagesUrl);
			}
		}
	}
	for (const service of configuredRailwayServices(options.tenantRoot, options.target).filter((entry) => !options.appId || entry.application?.id === options.appId)) {
		const serviceConfig = deployConfig.services?.[service.key];
		const domain = service.publicBaseUrl
			?? serviceConfig?.environments?.[options.target]?.baseUrl
			?? serviceConfig?.environments?.[options.target]?.domain
			?? (service.key === 'api' ? deployConfig.surfaces?.api?.environments?.[options.target]?.domain : null);
		const baseUrl = urlForDomain(domain);
		if (!baseUrl) continue;
		urls.add(`${baseUrl}${service.healthcheckPath ?? '/healthz'}`);
		if (service.key === 'api') urls.add(`${baseUrl}/healthz/deep`);
	}
	const entries = await Promise.all([...urls].map(async (url) => {
		const observed = await observeHttp(url, options);
		const fallbackUrl = fallbacks.get(url);
		if ((observed.ok !== true && !observed.status) && fallbackUrl) {
			const fallback = await observeHttp(fallbackUrl, options);
			return [url, {
				...observed,
				fallbackUrl,
				fallbackStatus: fallback.status,
				fallbackOk: fallback.ok,
				fallbackError: fallback.error,
			}] as const;
		}
		return [url, observed] as const;
	}));
	return Object.fromEntries(entries);
}

function strictenReport(report: TreeseedLiveHostedServiceCheckReport, options: TreeseedLiveHostedServiceCheckOptions) {
	if (!options.strict) return report;
	const checks = report.checks.map((check) => {
		if (check.status !== 'skipped') return check;
		const providerRequired = (options.requireLiveRailway && check.provider === 'railway')
			|| (options.requireLiveHttp && check.provider === 'http');
		if (!providerRequired) return check;
		return {
			...check,
			status: 'failed' as const,
			issues: check.issues.length > 0 ? check.issues : ['Required live observation was not available.'],
			remediation: check.remediation ?? 'Run provider configuration bootstrap or verify provider credentials, then rerun with --live.',
		};
	});
	const summary = {
		passed: checks.filter((entry) => entry.status === 'passed').length,
		failed: checks.filter((entry) => entry.status === 'failed').length,
		skipped: checks.filter((entry) => entry.status === 'skipped').length,
		warning: checks.filter((entry) => entry.status === 'warning').length,
	};
	return { ...report, checks, summary };
}

export async function collectTreeseedLiveHostedServiceChecks(options: TreeseedLiveHostedServiceCheckOptions): Promise<TreeseedLiveHostedServiceCheckReport> {
	const requireLiveRailway = options.requireLiveRailway ?? options.strict === true;
	const requireLiveHttp = options.requireLiveHttp ?? options.strict === true;
	const railway = requireLiveRailway
		? await collectRailwayObservations(options)
		: { observed: {}, status: 'skipped' as const, issues: [] };
	const httpChecks = requireLiveHttp
		? await collectHttpObservations(options)
		: {};
	const report = collectTreeseedHostedServiceChecks({
		tenantRoot: options.tenantRoot,
		target: options.target,
		appId: options.appId,
		observedRailwayServices: railway.observed,
		httpChecks,
	});
	const httpStatus = requireLiveHttp
		? Object.values(httpChecks).some((entry) => entry.ok === true || entry.status)
			? 'observed'
			: 'failed'
		: 'skipped';
	return strictenReport({
		...report,
		live: true,
		liveObservation: {
			railway: railway.status,
			http: httpStatus,
			issues: railway.issues,
		},
	}, options);
}
