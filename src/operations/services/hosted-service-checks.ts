import { relative, resolve } from 'node:path';
import { collectTreeseedEnvironmentContext, resolveTreeseedMachineEnvironmentValues } from './config-runtime.ts';
import { configuredRailwayServices } from './railway-deploy.ts';
import { isApiRailwaySourcePolicyService, isImmutableRailwayImageRef } from './railway-source-policy.ts';
import { loadTreeseedPlatformConfig } from '../../platform/config.ts';
import { discoverTreeseedApplications } from '../../hosting/apps.ts';

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

const RAILWAY_SECRET_KEYS_BY_SERVICE: Record<string, string[]> = {
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
	capacityProviderManager: [
		'TREESEED_CAPACITY_PROVIDER_API_KEY',
	],
	capacityProviderRunner: [
		'TREESEED_CAPACITY_PROVIDER_API_KEY',
	],
};

const RAILWAY_VARIABLE_KEYS_BY_SERVICE: Record<string, string[]> = {
	operationsRunner: [
		'TREESEED_PLATFORM_RUNNER_ID',
		'TREESEED_PLATFORM_RUNNER_DATA_DIR',
		'TREESEED_PLATFORM_RUNNER_ENVIRONMENT',
		'TREESEED_MANAGER_ID',
	],
	capacityProviderManager: [
		'TREESEED_PROVIDER_ENVIRONMENT',
		'TREESEED_PROVIDER_ROLE',
		'TREESEED_MARKET_URL',
	],
	capacityProviderRunner: [
		'TREESEED_PROVIDER_ENVIRONMENT',
		'TREESEED_PROVIDER_ROLE',
		'TREESEED_MARKET_URL',
		'TREESEED_PROVIDER_RUNNER_ID',
		'TREESEED_PROVIDER_DATA_DIR',
	],
};

function check(input: Omit<TreeseedHostedServiceCheck, 'issues'> & { issues?: string[] }): TreeseedHostedServiceCheck {
	return {
		...input,
		issues: input.issues ?? [],
	};
}

function statusForMatch(observed: unknown, expected: unknown) {
	return observed === expected ? 'passed' : 'failed';
}

function rootDirectory(tenantRoot: string, rootDir: string) {
	const rel = relative(tenantRoot, rootDir).split('\\').join('/');
	return rel || '.';
}

function railwayServiceRootDirectory(tenantRoot: string, service: ReturnType<typeof configuredRailwayServices>[number]) {
	const sourceRootDirectory = String(service.sourceRootDirectory ?? '').trim();
	if (sourceRootDirectory) {
		return sourceRootDirectory;
	}
	return rootDirectory(service.application?.root ?? tenantRoot, service.rootDir);
}

function railwayServiceUsesImageSource(service: ReturnType<typeof configuredRailwayServices>[number]) {
	return Boolean(service.imageRef || service.sourceMode === 'image');
}

function hasConfiguredValue(values: Record<string, string | undefined>, key: string) {
	return typeof values[key] === 'string' && Boolean(values[key]?.trim());
}

function hasProviderKey(record: Record<string, unknown> | string[] | undefined, key: string) {
	if (Array.isArray(record)) return record.includes(key);
	if (record && typeof record === 'object') return Object.prototype.hasOwnProperty.call(record, key);
	return false;
}

function variableObserved(observed: TreeseedObservedRailwayServiceState | undefined, key: string) {
	return hasProviderKey(observed?.variables, key) || hasProviderKey(observed?.secrets, key);
}

function valuePresence(values: Record<string, string | undefined>, observed: TreeseedObservedRailwayServiceState | undefined, key: string, serviceTarget: string) {
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

function serviceTypeFor(key: string): TreeseedHostedServiceType {
	if (key === 'api') return 'api';
	if (key === 'operationsRunner') return 'operationsRunner';
	if (key === 'capacityProviderManager') return 'capacityProviderManager';
	if (key === 'capacityProviderRunner') return 'capacityProviderRunner';
	if (key === 'treeseedDatabase') return 'treeseedDatabase';
	return 'unknown';
}

function observedFor(options: TreeseedHostedServiceCheckOptions, serviceName: string | null | undefined) {
	return serviceName ? options.observedRailwayServices?.[serviceName] : undefined;
}

function webCheckConfig(deployConfig: Record<string, any>, selectedApplication: ReturnType<typeof discoverTreeseedApplications>[number] | null) {
	const selectedConfig = selectedApplication?.roles.includes('web') ? selectedApplication.config : deployConfig;
	return {
		appId: selectedApplication?.roles.includes('web') ? selectedApplication.id : 'web',
		config: selectedConfig,
		web: selectedConfig.surfaces?.web,
	};
}

function httpStatus(url: string, options: TreeseedHostedServiceCheckOptions) {
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

export function collectTreeseedHostedServiceChecks(options: TreeseedHostedServiceCheckOptions): TreeseedHostedServiceCheckReport {
	const target = options.target ?? 'prod';
	const tenantRoot = options.tenantRoot;
	const configEnv = { ...process.env, ...(options.env ?? {}) };
	const deployConfig = loadTreeseedPlatformConfig({ tenantRoot, environment: target, env: configEnv }).deployConfig;
	const registry = collectTreeseedEnvironmentContext(tenantRoot);
	let machineValues: Record<string, string | undefined> = {};
	try {
		machineValues = resolveTreeseedMachineEnvironmentValues(tenantRoot, target);
	} catch {
		machineValues = {};
	}
	const values = { ...machineValues, ...configEnv, ...(options.valuesOverlay ?? {}) };
	const checks: TreeseedHostedServiceCheck[] = [];
	const selectedServiceKeys = new Set((options.serviceKeys ?? []).map((key) => key.trim()).filter(Boolean));
	const selectedAppId = options.appId?.trim() || null;
	const applications = discoverTreeseedApplications(tenantRoot);
	const selectedApplication = selectedAppId
		? applications.find((application) => application.id === selectedAppId || application.relativeRoot === selectedAppId)
		: null;
	const selectedService = (serviceKey: string) => selectedServiceKeys.size === 0 || selectedServiceKeys.has(serviceKey);
	const workspaceHasApiApplication = applications.some((application) =>
		application.roles.includes('api')
		|| application.config.surfaces?.api?.enabled === true
		|| application.config.services?.api?.enabled !== false && Boolean(application.config.services?.api)
	);
	const includeWeb = selectedService('web') && (!selectedAppId || selectedAppId === 'web' || selectedApplication?.roles.includes('web') === true);
	const includeApi = selectedService('api') && (!selectedAppId || selectedAppId === 'api' || selectedApplication?.roles.includes('api') === true);
	const selectedAppHasApi = Boolean(
		selectedApplication?.roles.includes('api')
		|| selectedApplication?.config.surfaces?.api?.enabled === true
		|| selectedApplication?.config.services?.api?.enabled !== false && selectedApplication?.config.services?.api
		|| selectedAppId === 'web' && workspaceHasApiApplication
		|| selectedAppId === 'web' && (
			deployConfig.surfaces?.api?.enabled === true
			|| deployConfig.services?.api?.enabled !== false && deployConfig.services?.api
		),
	);

	const selectedWeb = webCheckConfig(deployConfig, selectedApplication);
	const web = selectedWeb.web;
	if (includeWeb && web?.enabled !== false && web?.provider === 'cloudflare') {
		const domain = web.environments?.[target]?.domain ?? web.publicBaseUrl ?? selectedWeb.config.siteUrl ?? null;
		checks.push(check({
			id: `cloudflare:${selectedWeb.appId}:surface`,
			provider: 'cloudflare',
			serviceKey: selectedWeb.appId,
			serviceType: 'web',
			target,
			description: 'Cloudflare web surface is configured.',
			expected: {
				provider: 'cloudflare',
				domain,
				pagesProjectName: selectedWeb.config.cloudflare?.pages?.projectName ?? null,
			},
			observed: { configured: true },
			status: 'passed',
		}));
		if (domain) {
			const url = String(domain).startsWith('http') ? String(domain) : `https://${domain}`;
			checks.push({ ...httpStatus(url, options), id: `http:${selectedWeb.appId}`, serviceKey: selectedWeb.appId, serviceType: 'web', description: 'Web public URL responds.' });
			if (selectedServiceKeys.size === 0 && (!selectedAppId || selectedAppHasApi)) {
				checks.push({ ...httpStatus(`${url.replace(/\/+$/u, '')}/v1/healthz`, options), id: `http:${selectedWeb.appId}:v1-healthz`, serviceKey: selectedWeb.appId, serviceType: 'web', description: 'Web proxy reaches API health.' });
			}
		}
	}
	for (const [surfaceKey, surface] of Object.entries(deployConfig.surfaces ?? {})) {
		if (!selectedService(surfaceKey)) continue;
		if (selectedAppId === 'api' && surfaceKey === 'web') continue;
		if (surface && typeof surface === 'object' && surface.enabled !== false && surface.provider && !['cloudflare', 'railway'].includes(surface.provider)) {
			checks.push(check({
				id: `surface-provider:${surfaceKey}:${surface.provider}`,
				provider: surface.provider === 'github' ? 'github' : 'http',
				serviceKey: surfaceKey,
				serviceType: surfaceKey === 'web' ? 'web' : surfaceKey === 'api' ? 'api' : 'unknown',
				target,
				description: `Unsupported hosted surface provider ${surface.provider}.`,
				expected: { supportedProviders: ['cloudflare', 'railway'] },
				observed: { provider: surface.provider },
				status: 'warning',
				issues: [`Hosted service checker does not yet support provider ${surface.provider}.`],
			}));
		}
	}

	const configuredServices = configuredRailwayServices(tenantRoot, target, configEnv)
		.filter((service) => !selectedAppId || service.application?.id === selectedAppId)
		.filter((service) => selectedServiceKeys.size === 0 || selectedServiceKeys.has(service.key));
	for (const service of configuredServices) {
		const serviceType = serviceTypeFor(service.key);
		const observed = observedFor(options, service.serviceName);
		const expectedRootDirectory = railwayServiceRootDirectory(tenantRoot, service);
		const apiSourcePolicyService = isApiRailwaySourcePolicyService(service);
		if (target === 'prod' && apiSourcePolicyService && railwayServiceUsesImageSource(service)) {
			checks.push(check({
				id: `railway:${service.instanceKey}:image-ref-policy`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} uses an immutable production image reference.`,
				expected: { imageRef: '<released-image>:<immutable-tag>' },
				observed: { imageRef: service.imageRef ?? null },
				status: isImmutableRailwayImageRef(service.imageRef) ? 'passed' : 'failed',
				issues: isImmutableRailwayImageRef(service.imageRef) ? [] : [`Production API Railway service ${service.serviceName} is missing an immutable image ref.`],
			}));
			const observedGitSource = Boolean(observed?.deploymentRepo || observed?.deploymentBranch);
			checks.push(check({
				id: `railway:${service.instanceKey}:production-source-isolation`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} production deployment has no Git source.`,
				expected: { repo: null, branch: null },
				observed: observed ? { repo: observed.deploymentRepo ?? null, branch: observed.deploymentBranch ?? null } : { skipped: true },
				status: observed ? (observedGitSource ? 'failed' : 'passed') : 'skipped',
				issues: observed && observedGitSource ? [`Production API Railway service ${service.serviceName} still reports Git source metadata.`] : [],
			}));
		}
		checks.push(check({
			id: `railway:${service.instanceKey}:service`,
			provider: 'railway',
			serviceKey: service.key,
			serviceType,
			target,
			description: `Railway service ${service.serviceName} is configured.`,
			expected: { projectName: service.projectName, serviceName: service.serviceName, environmentName: service.railwayEnvironment },
			observed: observed
				? { projectName: observed.projectName ?? null, serviceName: observed.serviceName ?? null, environmentName: observed.environmentName ?? null }
				: { skipped: true },
			status: observed ? 'passed' : 'skipped',
			issues: observed ? [] : ['No live Railway observation was provided.'],
		}));

		for (const [key, expected] of Object.entries({
			rootDirectory: railwayServiceUsesImageSource(service) ? null : expectedRootDirectory,
			buildCommand: service.buildCommand,
			dockerfilePath: service.dockerfilePath,
			startCommand: service.startCommand,
			healthcheckPath: service.healthcheckPath,
			healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
			runtimeMode: service.runtimeMode,
		})) {
			if (expected == null) continue;
			const actual = observed?.[key as keyof TreeseedObservedRailwayServiceState] ?? null;
			checks.push(check({
				id: `railway:${service.instanceKey}:${key}`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} ${key} matches config.`,
				expected: { [key]: expected },
				observed: observed ? { [key]: actual } : { skipped: true },
				status: observed ? statusForMatch(actual, expected) : 'skipped',
				issues: !observed || actual === expected ? [] : [`Expected ${key}=${expected}, observed ${actual ?? '(unset)'}.`],
			}));
		}

		if (!railwayServiceUsesImageSource(service) && service.sourceRepo) {
			const actualRepo = observed?.deploymentRepo ?? null;
			const actualBranch = observed?.deploymentBranch ?? null;
			const actualRootDirectory = observed?.deploymentRootDirectory ?? null;
			const sourceUploadDeployment = target === 'staging'
				&& !apiSourcePolicyService
				&& actualRepo === null
				&& actualBranch === null
				&& observed?.deploymentHealthy === true;
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment-repo`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} latest deployment uses the desired Git repo.`,
				expected: { repo: service.sourceRepo },
				observed: observed ? { repo: actualRepo, sourceUpload: sourceUploadDeployment } : { skipped: true },
				status: observed ? (sourceUploadDeployment ? 'passed' : statusForMatch(actualRepo, service.sourceRepo)) : 'skipped',
				issues: !observed || sourceUploadDeployment || actualRepo === service.sourceRepo ? [] : [`Expected deployment repo=${service.sourceRepo}, observed ${actualRepo ?? '(unset)'}.`],
			}));
			if (service.sourceBranch) {
				checks.push(check({
					id: `railway:${service.instanceKey}:deployment-branch`,
					provider: 'railway',
					serviceKey: service.key,
					serviceType,
					target,
					description: `Railway ${service.serviceName} latest deployment uses the desired Git branch.`,
					expected: { branch: service.sourceBranch },
					observed: observed ? { branch: actualBranch, commitHash: observed.deploymentCommitHash ?? null, sourceUpload: sourceUploadDeployment } : { skipped: true },
					status: observed ? (sourceUploadDeployment ? 'passed' : statusForMatch(actualBranch, service.sourceBranch)) : 'skipped',
					issues: !observed || sourceUploadDeployment || actualBranch === service.sourceBranch ? [] : [`Expected deployment branch=${service.sourceBranch}, observed ${actualBranch ?? '(unset)'}.`],
				}));
			}
			if (service.sourceCommit) {
				const actualCommit = observed?.deploymentCommitHash ?? null;
				checks.push(check({
					id: `railway:${service.instanceKey}:deployment-commit`,
					provider: 'railway',
					serviceKey: service.key,
					serviceType,
					target,
					description: `Railway ${service.serviceName} latest deployment uses the exact promoted commit.`,
					expected: { commitHash: service.sourceCommit },
					observed: observed ? { commitHash: actualCommit } : { skipped: true },
					status: observed ? statusForMatch(actualCommit, service.sourceCommit) : 'skipped',
					issues: !observed || actualCommit === service.sourceCommit ? [] : [`Expected deployment commitHash=${service.sourceCommit}, observed ${actualCommit ?? '(unset)'}.`],
				}));
			}
			if (expectedRootDirectory) {
				checks.push(check({
					id: `railway:${service.instanceKey}:deployment-root-directory`,
					provider: 'railway',
					serviceKey: service.key,
					serviceType,
					target,
					description: `Railway ${service.serviceName} latest deployment uses the desired Git root directory.`,
					expected: { rootDirectory: expectedRootDirectory },
					observed: observed ? { rootDirectory: actualRootDirectory } : { skipped: true },
					status: observed ? statusForMatch(actualRootDirectory, expectedRootDirectory) : 'skipped',
					issues: !observed || actualRootDirectory === expectedRootDirectory ? [] : [`Expected deployment rootDirectory=${expectedRootDirectory}, observed ${actualRootDirectory ?? '(unset)'}.`],
				}));
			}
		}

		if (observed && observed.deploymentHealthy === false) {
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} latest deployment is healthy.`,
				expected: { healthy: true },
				observed: { healthy: false, status: observed.deploymentStatus ?? null },
				status: 'failed',
				issues: [`Latest Railway deployment status is ${observed.deploymentStatus ?? 'unknown'}.`],
			}));
		} else if (observed) {
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} latest deployment is healthy.`,
				expected: { healthy: true },
				observed: { healthy: observed.deploymentHealthy ?? null, status: observed.deploymentStatus ?? null },
				status: observed.deploymentHealthy === true ? 'passed' : 'skipped',
				issues: observed.deploymentHealthy === true ? [] : ['No live Railway deployment health observation was provided.'],
			}));
		}

		if (service.volumeMountPath) {
			const volumeAttached = Boolean(observed?.volumeId)
				&& observed?.volumeMountPath === service.volumeMountPath
				&& (!observed?.serviceName || !observed?.volumeServiceId || observed.volumeServiceId === observed.serviceId)
				&& observed?.volumePendingDeletion !== true
				&& !(typeof observed?.volumeDeletedAt === 'string' && observed.volumeDeletedAt.trim())
				&& !['DELETING', 'DELETED'].includes(String(observed?.volumeState ?? '').toUpperCase());
			checks.push(check({
				id: `railway:${service.instanceKey}:volume`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} volume mount matches config.`,
				expected: { volumeMountPath: service.volumeMountPath },
				observed: observed ? {
					volumeName: observed.volumeName ?? null,
					volumeId: observed.volumeId ?? null,
					volumeMountPath: observed.volumeMountPath ?? null,
					volumeServiceId: observed.volumeServiceId ?? null,
					volumeEnvironmentId: observed.volumeEnvironmentId ?? null,
					volumeState: observed.volumeState ?? null,
					volumePendingDeletion: observed.volumePendingDeletion ?? null,
					volumeDeletedAt: observed.volumeDeletedAt ?? null,
				} : { skipped: true },
				status: observed ? (volumeAttached ? 'passed' : 'failed') : 'skipped',
				issues: !observed || volumeAttached ? [] : [`Expected an attached persistent volume mounted at ${service.volumeMountPath}, observed ${observed.volumeMountPath ?? '(unset)'} on volume ${observed.volumeName ?? '(none)'}.`],
			}));
			const volumeNotPendingDeletion = observed?.volumePendingDeletion === false
				&& !['DELETING', 'DELETED'].includes(String(observed?.volumeState ?? '').toUpperCase());
			checks.push(check({
				id: `railway:${service.instanceKey}:volume-retained`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} volume is retained and active.`,
				expected: { pendingDeletion: false },
				observed: observed ? {
					volumeName: observed.volumeName ?? null,
					volumeId: observed.volumeId ?? null,
					state: observed.volumeState ?? null,
					pendingDeletion: observed.volumePendingDeletion ?? null,
					deletedAt: observed.volumeDeletedAt ?? null,
				} : { skipped: true },
				status: observed ? (volumeNotPendingDeletion ? 'passed' : 'failed') : 'skipped',
				issues: !observed || volumeNotPendingDeletion ? [] : [`Expected an active retained volume, observed state=${observed.volumeState ?? '(unset)'} pendingDeletion=${String(observed.volumePendingDeletion ?? null)} deletedAt=${observed.volumeDeletedAt ?? '(unset)'}.`],
			}));
			const deploymentHasVolumeMount = observed?.deploymentRequiredMountPath === service.volumeMountPath
				|| (observed?.deploymentVolumeMounts ?? []).includes(service.volumeMountPath);
			checks.push(check({
				id: `railway:${service.instanceKey}:deployment-required-mount`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} deployment metadata includes the volume mount.`,
				expected: { volumeMountPath: service.volumeMountPath },
				observed: observed ? {
					requiredMountPath: observed.deploymentRequiredMountPath ?? null,
					volumeMounts: observed.deploymentVolumeMounts ?? [],
				} : { skipped: true },
				status: observed ? (deploymentHasVolumeMount ? 'passed' : 'failed') : 'skipped',
				issues: !observed || deploymentHasVolumeMount ? [] : [`Expected deployment metadata to include volume mount ${service.volumeMountPath}.`],
			}));
		}

		for (const key of [...(RAILWAY_SECRET_KEYS_BY_SERVICE[service.key] ?? []), ...(RAILWAY_VARIABLE_KEYS_BY_SERVICE[service.key] ?? [])]) {
			const presence = valuePresence(values, observed, key, service.key);
			const status = presence.present ? 'passed' : observed ? 'failed' : 'skipped';
			checks.push(check({
				id: `railway:${service.instanceKey}:env:${key}`,
				provider: 'railway',
				serviceKey: service.key,
				serviceType,
				target,
				description: `Railway ${service.serviceName} has ${key}.`,
				expected: { key, serviceTarget: service.key, present: true },
				observed: presence,
				status,
				issues: presence.present ? [] : observed ? [`${key} is missing for ${service.key}.`] : ['No live Railway variable observation was provided.'],
			}));
		}

		if (service.publicBaseUrl) {
			const baseUrl = service.publicBaseUrl.replace(/\/+$/u, '');
			checks.push({ ...httpStatus(`${baseUrl}${service.healthcheckPath ?? '/healthz'}`, options), id: `http:${service.instanceKey}:healthz`, serviceKey: service.key, serviceType, description: `${service.serviceName} health endpoint responds.` });
			if (service.key === 'api') {
				checks.push({ ...httpStatus(`${baseUrl}/healthz/deep`, options), id: `http:${service.instanceKey}:healthz-deep`, serviceKey: service.key, serviceType, description: `${service.serviceName} deep health endpoint responds.` });
			}
		}
	}

	const applicationConfigs = [
		...(includeWeb ? [deployConfig] : []),
		...discoverTreeseedApplications(tenantRoot)
			.filter((application) => application.root !== resolve(tenantRoot))
			.filter((application) => !selectedAppId || application.id === selectedAppId)
			.map((application) => application.config),
	];
	const treeseedDatabaseService = applicationConfigs
		.map((config) => config.services?.treeseedDatabase)
		.find((service) => service?.enabled !== false);
	if (
		includeApi
		&& (selectedServiceKeys.size === 0 || selectedServiceKeys.has('treeseedDatabase'))
		&& treeseedDatabaseService?.enabled !== false
		&& treeseedDatabaseService?.provider === 'railway'
	) {
		const targets = treeseedDatabaseService.railway?.serviceTargets ?? [];
		checks.push(check({
			id: 'railway:treeseedDatabase:targets',
			provider: 'railway',
			serviceKey: 'treeseedDatabase',
			serviceType: 'treeseedDatabase',
			target,
			description: 'Treeseed database targets API and runner services.',
			expected: { serviceTargets: ['api', 'operationsRunner'] },
			observed: { serviceTargets: targets },
			status: targets.includes('api') && targets.includes('operationsRunner') ? 'passed' : 'failed',
			issues: targets.includes('api') && targets.includes('operationsRunner') ? [] : ['Treeseed database must target api and operationsRunner.'],
		}));
	}

	for (const service of Object.values(selectedAppId ? {} : deployConfig.services ?? {})) {
		if (service && typeof service === 'object' && service.enabled !== false && service.provider && !['railway'].includes(service.provider)) {
			checks.push(check({
				id: `provider:${service.provider}`,
				provider: 'railway',
				serviceType: 'unknown',
				target,
				description: `Unsupported hosted service provider ${service.provider}.`,
				expected: { supportedProviders: ['railway'] },
				observed: { provider: service.provider },
				status: 'warning',
				issues: [`Hosted service checker does not yet support provider ${service.provider}.`],
			}));
		}
	}

	const entryIds = new Set(registry.entries.map((entry: { id: string }) => entry.id));
	for (const key of includeApi ? ['TREESEED_DATABASE_URL', 'TREESEED_WEB_SERVICE_SECRET', 'TREESEED_PLATFORM_RUNNER_SECRET'] : []) {
		if (!entryIds.has(key)) {
			checks.push(check({
				id: `registry:${key}`,
				provider: 'railway',
				serviceType: 'unknown',
				target,
				description: `Environment registry declares ${key}.`,
				expected: { registryEntry: key },
				observed: { registryEntry: null },
				status: 'failed',
				issues: [`${key} is missing from the environment registry.`],
			}));
		}
	}

	const summary = {
		passed: checks.filter((entry) => entry.status === 'passed').length,
		failed: checks.filter((entry) => entry.status === 'failed').length,
		skipped: checks.filter((entry) => entry.status === 'skipped').length,
		warning: checks.filter((entry) => entry.status === 'warning').length,
	};
	return {
		target,
		tenantRoot: resolve(tenantRoot),
		generatedAt: (options.now ?? new Date()).toISOString(),
		summary,
		checks,
	};
}
