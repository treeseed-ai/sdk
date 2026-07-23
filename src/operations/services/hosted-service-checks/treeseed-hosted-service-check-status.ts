import { relative, resolve } from 'node:path';
import { collectTreeseedEnvironmentContext, resolveTreeseedMachineEnvironmentValues } from '../config-runtime.ts';
import { configuredRailwayServices } from '../railway-deploy.ts';
import { isApiRailwaySourcePolicyService, isImmutableRailwayImageRef } from '../railway-source-policy.ts';
import { loadTreeseedPlatformConfig } from '../../../platform/config.ts';
import { discoverTreeseedApplications } from '../../../hosting/apps.ts';


export type TreeseedHostedServiceCheckStatus = 'passed' | 'failed' | 'skipped' | 'warning';

export type TreeseedHostedServiceTarget = 'local' | 'staging' | 'prod';

export type TreeseedHostedServiceProvider = 'cloudflare' | 'railway' | 'http' | 'dns' | 'github';

export type TreeseedHostedServiceType =
	| 'web'
	| 'api'
	| 'operationsRunner'
	| 'capacityProviderManager'
	| 'capacityProviderRunner'
	| 'treeseedDatabase'
	| 'customDomain'
	| 'dnsRecord'
	| 'githubWorkflow'
	| 'unknown';

export interface TreeseedHostedServiceCheck {
	id: string;
	provider: TreeseedHostedServiceProvider;
	serviceKey?: string;
	serviceType: TreeseedHostedServiceType;
	target: TreeseedHostedServiceTarget;
	description: string;
	expected?: Record<string, unknown>;
	observed?: Record<string, unknown>;
	status: TreeseedHostedServiceCheckStatus;
	issues: string[];
	remediation?: string;
}

export interface TreeseedHostedServiceCheckReport {
	target: TreeseedHostedServiceTarget;
	tenantRoot: string;
	generatedAt: string;
	summary: {
		passed: number;
		failed: number;
		skipped: number;
		warning: number;
	};
	checks: TreeseedHostedServiceCheck[];
}

export interface TreeseedObservedRailwayServiceState {
	projectName?: string | null;
	environmentName?: string | null;
	serviceName?: string | null;
	serviceId?: string | null;
	rootDirectory?: string | null;
	buildCommand?: string | null;
	dockerfilePath?: string | null;
	startCommand?: string | null;
	healthcheckPath?: string | null;
	healthcheckTimeoutSeconds?: number | null;
	runtimeMode?: string | null;
	deploymentStatus?: string | null;
	deploymentHealthy?: boolean | null;
	deploymentBranch?: string | null;
	deploymentRepo?: string | null;
	deploymentRootDirectory?: string | null;
	deploymentCommitHash?: string | null;
	deploymentRequiredMountPath?: string | null;
	deploymentVolumeMounts?: string[];
	volumeName?: string | null;
	volumeId?: string | null;
	volumeMountPath?: string | null;
	volumeServiceId?: string | null;
	volumeEnvironmentId?: string | null;
	volumeState?: string | null;
	volumePendingDeletion?: boolean | null;
	volumeDeletedAt?: string | null;
	variables?: Record<string, unknown> | string[];
	secrets?: Record<string, unknown> | string[];
	health?: 'ready' | 'failed' | 'unknown' | string | null;
}

export interface TreeseedHostedServiceCheckOptions {
	tenantRoot: string;
	target?: TreeseedHostedServiceTarget;
	appId?: string;
	serviceKeys?: string[];
	now?: Date;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	valuesOverlay?: Record<string, string | undefined>;
	observedRailwayServices?: Record<string, TreeseedObservedRailwayServiceState | undefined>;
	httpChecks?: Record<string, { status?: number; ok?: boolean; skipped?: boolean; error?: string; fallbackUrl?: string; fallbackStatus?: number; fallbackOk?: boolean; fallbackError?: string } | undefined>;
}

export const RAILWAY_SECRET_KEYS_BY_SERVICE: Record<string, string[]> = {
	api: [
		'TREESEED_DATABASE_URL',
		'TREESEED_WEB_SERVICE_SECRET',
		'TREESEED_PLATFORM_RUNNER_SECRET',
		'TREESEED_CREDENTIAL_SESSION_SECRET',
	],
	operationsRunner: [
		'TREESEED_DATABASE_URL',
		'TREESEED_PLATFORM_RUNNER_SECRET',
		'TREESEED_CREDENTIAL_SESSION_SECRET',
	],
	capacityProviderManager: [],
	capacityProviderRunner: [],
};

export const RAILWAY_VARIABLE_KEYS_BY_SERVICE: Record<string, string[]> = {
	operationsRunner: [
		'TREESEED_PLATFORM_RUNNER_ID',
		'TREESEED_PLATFORM_RUNNER_DATA_DIR',
		'TREESEED_PLATFORM_RUNNER_ENVIRONMENT',
		'TREESEED_MANAGER_ID',
	],
	capacityProviderManager: [
		'TREESEED_CAPACITY_PROVIDER_MANIFEST',
		'TREESEED_PROVIDER_ENVIRONMENT',
		'TREESEED_PROVIDER_ROLE',
		'TREESEED_MARKET_URL',
	],
	capacityProviderRunner: [
		'TREESEED_CAPACITY_PROVIDER_MANIFEST',
		'TREESEED_PROVIDER_ENVIRONMENT',
		'TREESEED_PROVIDER_ROLE',
		'TREESEED_MARKET_URL',
		'TREESEED_PROVIDER_RUNNER_ID',
		'TREESEED_PROVIDER_DATA_DIR',
	],
};

export function check(input: Omit<TreeseedHostedServiceCheck, 'issues'> & { issues?: string[] }): TreeseedHostedServiceCheck {
	return {
		...input,
		issues: input.issues ?? [],
	};
}

export function statusForMatch(observed: unknown, expected: unknown) {
	return observed === expected ? 'passed' : 'failed';
}

export function rootDirectory(tenantRoot: string, rootDir: string) {
	const rel = relative(tenantRoot, rootDir).split('\\').join('/');
	return rel || '.';
}

export function railwayServiceRootDirectory(tenantRoot: string, service: ReturnType<typeof configuredRailwayServices>[number]) {
	const sourceRootDirectory = String(service.sourceRootDirectory ?? '').trim();
	if (sourceRootDirectory) {
		return sourceRootDirectory;
	}
	return rootDirectory(service.application?.root ?? tenantRoot, service.rootDir);
}

export function railwayServiceUsesImageSource(service: ReturnType<typeof configuredRailwayServices>[number]) {
	return Boolean(service.imageRef || service.sourceMode === 'image');
}

export function hasConfiguredValue(values: Record<string, string | undefined>, key: string) {
	return typeof values[key] === 'string' && Boolean(values[key]?.trim());
}

export function hasProviderKey(record: Record<string, unknown> | string[] | undefined, key: string) {
	if (Array.isArray(record)) return record.includes(key);
	if (record && typeof record === 'object') return Object.prototype.hasOwnProperty.call(record, key);
	return false;
}

export function variableObserved(observed: TreeseedObservedRailwayServiceState | undefined, key: string) {
	return hasProviderKey(observed?.variables, key) || hasProviderKey(observed?.secrets, key);
}

export function valuePresence(values: Record<string, string | undefined>, observed: TreeseedObservedRailwayServiceState | undefined, key: string, serviceTarget: string) {
	const providerPresent = variableObserved(observed, key);
	const machinePresent = hasConfiguredValue(values, key);
	const providerObserved = Boolean(observed);
	const present = providerObserved ? providerPresent : machinePresent;
	return {
		key,
		serviceTarget,
		present,
		source: providerPresent ? 'provider' : !providerObserved && machinePresent ? 'machine-config' : 'missing',
		observation: providerObserved ? 'provider-live' : 'not-observed',
	};
}

export function serviceTypeFor(key: string): TreeseedHostedServiceType {
	if (key === 'api') return 'api';
	if (key === 'operationsRunner') return 'operationsRunner';
	if (key === 'capacityProviderManager') return 'capacityProviderManager';
	if (key === 'capacityProviderRunner') return 'capacityProviderRunner';
	if (key === 'treeseedDatabase') return 'treeseedDatabase';
	return 'unknown';
}

export function observedFor(options: TreeseedHostedServiceCheckOptions, serviceName: string | null | undefined) {
	return serviceName ? options.observedRailwayServices?.[serviceName] : undefined;
}

export function webCheckConfig(deployConfig: Record<string, any>, selectedApplication: ReturnType<typeof discoverTreeseedApplications>[number] | null) {
	const selectedConfig = selectedApplication?.roles.includes('web') ? selectedApplication.config : deployConfig;
	return {
		appId: selectedApplication?.roles.includes('web') ? selectedApplication.id : 'web',
		config: selectedConfig,
		web: selectedConfig.surfaces?.web,
	};
}

export function httpStatus(url: string, options: TreeseedHostedServiceCheckOptions) {
	const observed = options.httpChecks?.[url];
	if (!observed) {
		return check({
			id: `http:${url}`,
			provider: 'http',
			serviceType: 'unknown',
			target: options.target ?? 'prod',
			description: `HTTP check ${url}`,
			expected: { ok: true },
			observed: { skipped: true },
			status: 'skipped',
			issues: ['No live HTTP observation was provided.'],
		});
	}
	const ok = observed.ok === true || (typeof observed.status === 'number' && observed.status >= 200 && observed.status < 400);
	const fallbackOk = observed.fallbackOk === true || (typeof observed.fallbackStatus === 'number' && observed.fallbackStatus >= 200 && observed.fallbackStatus < 400);
	return check({
		id: `http:${url}`,
		provider: 'http',
		serviceType: 'unknown',
		target: options.target ?? 'prod',
		description: `HTTP check ${url}`,
		expected: { ok: true },
		observed: {
			status: observed.status ?? null,
			ok,
			skipped: observed.skipped === true,
			fallbackUrl: observed.fallbackUrl,
			fallbackStatus: observed.fallbackStatus,
			fallbackOk,
		},
		status: observed.skipped ? 'skipped' : ok ? 'passed' : fallbackOk ? 'warning' : 'failed',
		issues: ok
			? []
			: fallbackOk
				? [observed.error ?? `HTTP check ${url} did not return a successful status yet; fallback ${observed.fallbackUrl} responded.`]
				: [observed.error ?? `HTTP check ${url} did not return a successful status.`],
	});
}
