import { resolve } from 'node:path';
import { loadPlatformConfig } from '../../../platform/configuration/config.ts';
import { resolveLaunchEnvironment } from '../configuration/config-runtime.ts';
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
} from '../hosting/railway/railway-api.ts';
import {
	configuredRailwayServices,
	findStaleOperationsRunnerResources,
	isOperationsRunnerResourceName,
	railwayObsoleteAliasCleanupPolicy,
} from '../hosting/railway/railway-deploy.ts';
import { railwayTreeDxServiceName } from '../hosting/railway/railway-source-policy.ts';
import { discoverApplications } from '../../../hosting/apps.ts';
import {
	collectHostedServiceChecks,
	type HostedServiceCheckReport,
	type HostedServiceTarget,
	type ObservedRailwayServiceState,
} from '../hosting/audit/hosted-service-checks.ts';


export const DEFAULT_RETRY_ATTEMPTS = 3;

export const DEFAULT_RETRY_INTERVAL_MS = 1500;

export const DEFAULT_RAILWAY_DEPLOYMENT_SETTLE_ATTEMPTS = 12;

export const DEFAULT_RAILWAY_DEPLOYMENT_SETTLE_INTERVAL_MS = 5000;

export interface LiveHostedServiceCheckOptions {
	tenantRoot: string;
	target: HostedServiceTarget;
	appId?: string;
	serviceKeys?: string[];
	strict?: boolean;
	requireLiveRailway?: boolean;
	requireLiveHttp?: boolean;
	timeoutMs?: number;
	retry?: {
		attempts: number;
		intervalMs: number;
	};
	httpRetry?: {
		attempts: number;
		intervalMs: number;
	};
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}

export interface LiveHostedServiceCheckReport extends HostedServiceCheckReport {
	live: true;
	liveObservation: {
		railway: 'observed' | 'skipped' | 'failed';
		http: 'observed' | 'skipped' | 'failed';
		issues: string[];
	};
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function liveCheckErrorMessage(error: unknown, fallback: string) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return message.trim() || fallback;
}

export function normalizeBaseUrl(value: unknown) {
	return typeof value === 'string' && value.trim()
		? value.trim().replace(/\/+$/u, '')
		: null;
}

export function urlForDomain(value: unknown) {
	const normalized = normalizeBaseUrl(value);
	if (!normalized) return null;
	return /^https?:\/\//iu.test(normalized) ? normalized : `https://${normalized}`;
}

export function selectedWebConfig(deployConfig: Record<string, any>, selectedApplication: ReturnType<typeof discoverApplications>[number] | null) {
	return selectedApplication?.roles.includes('web') ? selectedApplication.config : deployConfig;
}

export function pagesBranchName(config: Record<string, any>, target: HostedServiceTarget) {
	const pages = config.cloudflare?.pages && typeof config.cloudflare.pages === 'object'
		? config.cloudflare.pages
		: {};
	const key = target === 'prod' ? 'productionBranch' : 'stagingBranch';
	const fallback = target === 'prod' ? 'main' : 'staging';
	return typeof pages[key] === 'string' && pages[key].trim() ? pages[key].trim() : fallback;
}

export async function observeHttp(url: string, options: LiveHostedServiceCheckOptions) {
	const attempts = Math.max(1, Math.floor(options.httpRetry?.attempts ?? options.retry?.attempts ?? DEFAULT_RETRY_ATTEMPTS));
	const intervalMs = Math.max(0, Math.floor(options.httpRetry?.intervalMs ?? options.retry?.intervalMs ?? DEFAULT_RETRY_INTERVAL_MS));
	const timeoutMs = Math.max(1000, Math.floor(options.timeoutMs ?? 10000));
	let lastError = '';
	let lastResponse: { status: number; ok: boolean } | null = null;
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
			lastResponse = { status: response.status, ok: response.ok };
			if (response.ok) return lastResponse;
		} catch (error) {
			clearTimeout(timeout);
			lastError = error instanceof Error ? error.message : String(error);
			if (attempt + 1 < attempts) await sleep(intervalMs);
		}
		if (attempt + 1 < attempts) await sleep(intervalMs);
	}
	return lastResponse ?? { ok: false, error: lastError || 'HTTP request failed.' };
}

export async function inspectRailwayServiceDeploymentHealthWithRetry(input: {
	serviceId: string;
	environmentId: string;
	serviceName?: string;
	acceptSleeping?: boolean;
	options: LiveHostedServiceCheckOptions;
}) {
	const attempts = Math.max(1, Math.floor(input.options.retry?.attempts ?? DEFAULT_RAILWAY_DEPLOYMENT_SETTLE_ATTEMPTS));
	const intervalMs = Math.max(0, Math.floor(input.options.retry?.intervalMs ?? DEFAULT_RAILWAY_DEPLOYMENT_SETTLE_INTERVAL_MS));
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
			if (input.acceptSleeping && deployment.status === 'SLEEPING') {
				return { ...deployment, ok: true, message: 'Serverless deployment is healthy and sleeping until requested.' };
			}
		} catch (error) {
			lastError = error;
		}
		if (attempt === 0 || (attempt + 1) % 3 === 0) {
			process.stderr.write(`[trsd][railway][live-check] service=${input.serviceName ?? input.serviceId} attempt=${attempt + 1}/${attempts} status=${lastDeployment?.status ?? 'unavailable'}\n`);
		}
		if (attempt + 1 < attempts) await sleep(intervalMs);
	}
	return lastDeployment ?? {
		ok: false,
		status: null,
		message: lastError instanceof Error ? lastError.message : String(lastError ?? 'Unable to inspect deployment health.'),
	};
}

export function findByName<T extends { name?: string | null; id?: string | null }>(items: T[], nameOrId: string | null | undefined) {
	if (!nameOrId) return null;
	return items.find((item) => item.name === nameOrId || item.id === nameOrId) ?? null;
}

export function indexedName(baseName: string, index: number) {
	return `${baseName.replace(/-\d+$/u, '')}-${String(Math.max(1, index)).padStart(2, '0')}`;
}

export function isActiveRailwayVolumeInstance(instance: { state?: string | null; isPendingDeletion?: boolean | null; deletedAt?: string | null }) {
	const state = String(instance.state ?? 'READY').toUpperCase();
	return instance.isPendingDeletion !== true
		&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
		&& state !== 'DELETING'
		&& state !== 'DELETED';
}

export function activeRailwayVolumeInstances(volume: { instances?: Array<{ state?: string | null; isPendingDeletion?: boolean | null; deletedAt?: string | null }> }) {
	const instances = Array.isArray(volume.instances) ? volume.instances : [];
	return instances.filter(isActiveRailwayVolumeInstance);
}

export function railwayVolumeInstanceStates(volume: { instances?: Array<{ state?: string | null; isPendingDeletion?: boolean | null; deletedAt?: string | null }> }) {
	const states = (Array.isArray(volume.instances) ? volume.instances : [])
		.map((instance) => {
			const state = String(instance.state ?? 'READY').trim().toUpperCase();
			return `${state}${instance.isPendingDeletion === true ? ':PENDING_DELETION' : ''}${instance.deletedAt ? `:DELETED_AT=${instance.deletedAt}` : ''}`;
		})
		.filter(Boolean);
	return states.length > 0 ? [...new Set(states)].join(',') : 'none';
}

export function isRetainedDetachedRailwayVolume(value: unknown) {
	return String(value ?? '').trim().startsWith('retained-');
}

export function selectedServiceKeySet(options: LiveHostedServiceCheckOptions) {
	return new Set((options.serviceKeys ?? []).map((key) => key.trim()).filter(Boolean));
}

export function serviceIsSelected(selected: Set<string>, serviceKey: string) {
	return selected.size === 0 || selected.has(serviceKey);
}

export function serviceMatchesAppSelection(
	service: ReturnType<typeof configuredRailwayServices>[number],
	tenantRoot: string,
	appId: string | undefined,
	applications: ReturnType<typeof discoverApplications>,
) {
	if (!appId) return true;
	if (service.application?.id === appId) return true;
	if (!service.application) {
		const rootApplication = applications.find((application) => application.root === tenantRoot);
		return rootApplication?.id === appId || rootApplication?.relativeRoot === appId;
	}
	return false;
}

export function DatabaseDescriptors(tenantRoot: string, options: LiveHostedServiceCheckOptions) {
	const descriptors: Array<{
		applicationId: string | null;
		applicationRoot: string;
		serviceName: string;
	}> = [];
	const rootConfig = loadPlatformConfig({ tenantRoot, environment: options.target, env: process.env }).deployConfig;
	const applications = discoverApplications(tenantRoot);
	const candidates = [
		{ applicationId: null, applicationRoot: tenantRoot, config: rootConfig },
		...applications.map((application) => ({
			applicationId: application.id,
			applicationRoot: application.root,
			config: application.config,
		})),
	];
	for (const candidate of candidates) {
		if (options.appId && options.appId !== candidate.applicationId) continue;
		const service = candidate.config.services?.treeseedDatabase;
		if (
			!service
			|| service.enabled === false
			|| service.provider !== 'railway'
			|| service.railway?.resourceType !== 'postgres'
		) {
			continue;
		}
		const serviceName = typeof service.railway?.serviceName === 'string' && service.railway.serviceName.trim()
			? service.railway.serviceName.trim()
			: `${candidate.config.slug ?? 'treeseed-api'}-postgres`;
		descriptors.push({
			applicationId: candidate.applicationId,
			applicationRoot: candidate.applicationRoot,
			serviceName,
		});
	}
	return descriptors;
}
