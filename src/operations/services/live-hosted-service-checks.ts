import { loadCliDeployConfig } from './runtime-tools.ts';
import {
	getRailwayServiceInstance,
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	listRailwayVariables,
	listRailwayVolumes,
	resolveRailwayWorkspaceContext,
} from './railway-api.ts';
import { configuredRailwayServices } from './railway-deploy.ts';
import {
	collectTreeseedHostedServiceChecks,
	type TreeseedHostedServiceCheckReport,
	type TreeseedHostedServiceTarget,
	type TreeseedObservedRailwayServiceState,
} from './hosted-service-checks.ts';

export interface TreeseedLiveHostedServiceCheckOptions {
	tenantRoot: string;
	target: TreeseedHostedServiceTarget;
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

function findByName<T extends { name?: string | null; id?: string | null }>(items: T[], nameOrId: string | null | undefined) {
	if (!nameOrId) return null;
	return items.find((item) => item.name === nameOrId || item.id === nameOrId) ?? null;
}

async function collectRailwayObservations(options: TreeseedLiveHostedServiceCheckOptions) {
	const observed: Record<string, TreeseedObservedRailwayServiceState> = {};
	const issues: string[] = [];
	try {
		const workspace = await resolveRailwayWorkspaceContext({ env: options.env, fetchImpl: options.fetchImpl });
		const projects = await listRailwayProjects({ workspaceId: workspace.id, env: options.env, fetchImpl: options.fetchImpl });
		for (const service of configuredRailwayServices(options.tenantRoot, options.target)) {
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
			const services = await listRailwayServices({ projectId: project.id, env: options.env, fetchImpl: options.fetchImpl });
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
				? volumes.flatMap((entry: any) => Array.isArray(entry.volumeInstances) ? entry.volumeInstances : [])
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
	const webDomain = deployConfig.surfaces?.web?.environments?.[options.target]?.domain
		?? deployConfig.surfaces?.web?.publicBaseUrl
		?? deployConfig.siteUrl;
	const webUrl = urlForDomain(webDomain);
	if (webUrl) {
		urls.add(webUrl);
		urls.add(`${webUrl}/v1/healthz`);
	}
	for (const service of configuredRailwayServices(options.tenantRoot, options.target)) {
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
	const entries = await Promise.all([...urls].map(async (url) => [url, await observeHttp(url, options)] as const));
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
