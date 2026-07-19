import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadCliDeployConfig } from './runtime-tools.ts';
import { resolveTreeseedMachineEnvironmentValues } from './config-runtime.ts';
import { createPersistentDeployTarget, resolveTreeseedResourceIdentity } from './deploy.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from './git-runner.ts';
import { discoverTreeseedApplications } from '../../hosting/apps.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from './railway-source-policy.ts';
import { runPrefixedCommand, sleep, type TreeseedBootstrapTaskPrefix, type TreeseedBootstrapWriter } from './bootstrap-runner.ts';
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
} from './railway-api.ts';
import { elapsedMs, formatDurationMs, type TreeseedTimingEntry } from '../../timing.ts';

function normalizeScope(scope) {
	return scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
}

function resolveRailwayEnvironmentForScope(scope, configuredEnvironment) {
	return normalizeRailwayEnvironmentName(configuredEnvironment || normalizeScope(scope));
}
const RAILWAY_SERVICE_KEYS = ['api', 'operationsRunner', 'capacityProviderManager', 'capacityProviderRunner'];
const HOSTED_PROJECT_SERVICE_KEYS = ['api'];
const WORKER_RUNNER_BOOTSTRAP_INDEX = 1;
const WORKER_RUNNER_VOLUME_MOUNT_PATH = '/data';
const OPERATIONS_RUNNER_BOOTSTRAP_COUNT = 2;
const PUBLIC_TREEDX_NODE_SERVICE_KEY_PREFIX = 'public-treedx-node-';

export function isTreeseedOperationsRunnerResourceName(value) {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	if (normalized.startsWith('market-ops')) {
		return true;
	}
	return normalized.includes('operations-runner');
}

export function findStaleTreeseedOperationsRunnerResources(resources, desiredNames) {
	const desired = new Set([...desiredNames].map((value) => String(value ?? '').trim()).filter(Boolean));
	return resources.filter((resource) => {
		const name = String(resource?.name ?? '').trim();
		return name && isTreeseedOperationsRunnerResourceName(name) && !desired.has(name);
	});
}

function shouldManageRailwaySchedules(scope, phase = 'deploy') {
	const environment = normalizeRailwayEnvironmentName(scope);
	return phase === 'deploy' && (environment === 'staging' || environment === 'production');
}

function railwayServiceNameSuffix(serviceKey) {
	return serviceKey === 'capacityProviderManager'
				? 'capacity-provider-manager'
				: serviceKey === 'capacityProviderRunner'
					? 'capacity-provider-runner'
				: serviceKey === 'workdayManager'
			? 'workday-manager'
		: serviceKey === 'workerRunner'
			? 'worker-runner'
			: serviceKey === 'operationsRunner'
				? 'operations-runner'
				: serviceKey;
}

export function deriveRailwayWorkerRunnerServiceName(projectSlug, index = WORKER_RUNNER_BOOTSTRAP_INDEX) {
	const normalizedIndex = Math.max(1, Number.parseInt(String(index), 10) || WORKER_RUNNER_BOOTSTRAP_INDEX);
	return `${projectSlug}-worker-runner-${String(normalizedIndex).padStart(2, '0')}`;
}

export function deriveRailwayOperationsRunnerServiceName(baseServiceName, index = WORKER_RUNNER_BOOTSTRAP_INDEX) {
	const normalizedIndex = Math.max(1, Number.parseInt(String(index), 10) || WORKER_RUNNER_BOOTSTRAP_INDEX);
	const base = String(baseServiceName ?? '').trim().replace(/-\d+$/u, '').replace(/-\d{2}$/u, '') || 'treeseed-api-operations-runner';
	return `${base}-${String(normalizedIndex).padStart(2, '0')}`;
}

function railwayImageRefEnvForService(serviceKey) {
	if (serviceKey === 'api') return 'TREESEED_API_IMAGE_REF';
	if (serviceKey === 'operationsRunner') return 'TREESEED_OPERATIONS_RUNNER_IMAGE_REF';
	if (serviceKey === 'capacityProviderManager') return 'TREESEED_AGENT_MANAGER_IMAGE_REF';
	if (serviceKey === 'capacityProviderRunner') return 'TREESEED_AGENT_RUNNER_IMAGE_REF';
	if (isPublicTreeDxNodeServiceKey(serviceKey)) return 'TREESEED_PUBLIC_TREEDX_IMAGE_REF';
	return null;
}

function defaultRailwayImageRef(serviceKey, scope = 'staging', env = process.env) {
	if (
		normalizeScope(scope) !== 'prod'
		&& serviceKey !== 'capacityProviderManager'
		&& serviceKey !== 'capacityProviderRunner'
	) {
		return null;
	}
	if (serviceKey === 'api') {
		return envValue('TREESEED_API_IMAGE_REF', env) || null;
	}
	if (serviceKey === 'operationsRunner') {
		return envValue('TREESEED_OPERATIONS_RUNNER_IMAGE_REF', env) || null;
	}
	if (serviceKey === 'capacityProviderManager') {
		return envValue('TREESEED_AGENT_MANAGER_IMAGE_REF', env) || null;
	}
	if (serviceKey === 'capacityProviderRunner') {
		return envValue('TREESEED_AGENT_RUNNER_IMAGE_REF', env) || null;
	}
	if (isPublicTreeDxNodeServiceKey(serviceKey)) {
		return envValue('TREESEED_PUBLIC_TREEDX_IMAGE_REF', env) || null;
	}
	return null;
}

function isPublicTreeDxNodeServiceKey(serviceKey) {
	return String(serviceKey ?? '').startsWith(PUBLIC_TREEDX_NODE_SERVICE_KEY_PREFIX);
}

export function deriveRailwayWorkerRunnerVolumeName(serviceName, environmentName = '') {
	return `${serviceName}-volume`;
}

export function deriveRailwayOperationsRunnerVolumeName(serviceName, environmentName = '') {
	return `${serviceName}-volume`;
}

export function deriveRailwayCapacityProviderRunnerServiceName(baseServiceName, index = WORKER_RUNNER_BOOTSTRAP_INDEX) {
	const normalizedIndex = Math.max(1, Number.parseInt(String(index), 10) || WORKER_RUNNER_BOOTSTRAP_INDEX);
	const base = String(baseServiceName ?? '').trim().replace(/-\d+$/u, '').replace(/-\d{2}$/u, '') || 'treeseed-capacity-provider-runner';
	return `${base}-${String(normalizedIndex).padStart(2, '0')}`;
}

export function deriveRailwayCapacityProviderRunnerVolumeName(serviceName, environmentName = '') {
	return `${serviceName}-volume`;
}

export function railwayServiceRuntimeStartCommand(service) {
	return service.startCommand;
}

function normalizeScheduleExpressions(value) {
	if (typeof value === 'string' && value.trim()) {
		return [value.trim()];
	}
	if (Array.isArray(value)) {
		return value
			.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
			.filter(Boolean);
	}
	return [];
}

function envValue(name, env = process.env) {
	const value = env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function relativeRailwayRootDir(tenantRoot, serviceRoot) {
	const resolved = relative(tenantRoot, serviceRoot).replace(/\\/gu, '/');
	return !resolved || resolved === '' ? '.' : resolved;
}

function configuredEnvValue(env, name) {
	const value = env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function configuredApiPublicBaseUrl(deployConfig, scope) {
	const apiSurface = deployConfig.surfaces?.api;
	if (!apiSurface || typeof apiSurface !== 'object') return null;
	const environment = apiSurface.environments?.[scope];
	const configured = environment?.baseUrl
		?? environment?.domain
		?? (scope === 'local' ? apiSurface.localBaseUrl : null)
		?? apiSurface.publicBaseUrl
		?? null;
	if (typeof configured !== 'string' || !configured.trim()) return null;
	const value = configured.trim().replace(/\/+$/u, '');
	return /^https?:\/\//iu.test(value) ? value : `https://${value}`;
}

function railwayDeployTransport(env) {
	const configured = configuredEnvValue(env, 'TREESEED_RAILWAY_DEPLOY_TRANSPORT').toLowerCase();
	return configured === 'cli-fallback' ? 'cli-fallback' : 'api';
}

async function timedRailwayPhase<T>(
	timings: TreeseedTimingEntry[],
	name: string,
	run: () => Promise<T> | T,
	metadata?: Record<string, unknown>,
) {
	const startMs = performance.now();
	try {
		const result = await Promise.resolve(run());
		timings.push({
			name,
			durationMs: elapsedMs(startMs),
			status: 'success',
			...(metadata ? { metadata } : {}),
		});
		return result;
	} catch (error) {
		timings.push({
			name,
			durationMs: elapsedMs(startMs),
			status: 'failed',
			metadata: {
				...(metadata ?? {}),
				error: error instanceof Error ? error.name || 'Error' : 'Error',
			},
		});
		throw error;
	}
}

export function parseRailwayJsonOutput(output) {
	const trimmed = typeof output === 'string' ? output.trim() : '';
	if (!trimmed) {
		return null;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		// Some Railway commands print a prompt/status line before --json output.
	}
	const lines = trimmed.split(/\r?\n/u);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const candidate = lines.slice(index).join('\n').trim();
		if (!candidate.startsWith('{') && !candidate.startsWith('[')) {
			continue;
		}
		try {
			return JSON.parse(candidate);
		} catch {
			// Keep looking for the final JSON payload.
		}
	}
	return null;
}

function railwayEdgeNodes(value) {
	return Array.isArray(value?.edges)
		? value.edges.map((entry) => entry?.node).filter(Boolean)
		: [];
}

function railwayStatusEnvironmentNodes(payload) {
	if (!payload || typeof payload !== 'object') {
		return [];
	}
	if (Array.isArray(payload.environments)) {
		return payload.environments;
	}
	return railwayEdgeNodes(payload.environments);
}

function railwayStatusDeploymentSettled(status) {
	const normalized = String(status ?? '').trim().toUpperCase();
	return normalized === 'SUCCESS' || normalized === 'SLEEPING';
}

function railwayStatusDeploymentTerminalFailure(status) {
	const normalized = String(status ?? '').trim().toUpperCase();
	return ['FAILED', 'CRASHED', 'REMOVED'].includes(normalized);
}

function formatRailwayDeploymentStatusSummary(scope, checks) {
	const aliases = {
		api: 'api',
		workdayManager: 'manager',
		workerRunner: 'runner',
	};
	const parts = checks.map((check) => {
		const name = aliases[check.service] ?? String(check.serviceName ?? check.service ?? 'service');
		const status = String(check.status ?? 'unknown').toUpperCase();
		const instanceStatuses = Array.isArray(check.observed?.instanceStatuses) && check.observed.instanceStatuses.length > 0
			? `/${check.observed.instanceStatuses.join('+')}`
			: '';
		const stopped = check.observed?.deploymentStopped === true ? '/stopped' : '';
		return `${name}=${status}${instanceStatuses}${stopped}`;
	});
	return `[railway][monitor][${scope}] ${parts.join(' ')}`;
}

export function collectRailwayDeploymentStatusChecks(statusPayload, scope, services) {
	const expectedEnvironment = resolveRailwayEnvironmentForScope(scope);
	const environments = railwayStatusEnvironmentNodes(statusPayload);
	const environment = environments.find((candidate) =>
		normalizeRailwayEnvironmentName(candidate?.name) === expectedEnvironment
	) ?? null;
	if (!environment) {
		return services.map((service) => ({
			type: 'deployment-status',
			service: service.key,
			serviceName: service.serviceName,
			environment: expectedEnvironment,
			ok: false,
			status: 'missing_environment',
			message: `Railway status did not include the ${expectedEnvironment} environment.`,
		}));
	}

	const instances = railwayEdgeNodes(environment.serviceInstances);
	return services.map((service) => {
		const instance = instances.find((candidate) => candidate?.serviceName === service.serviceName) ?? null;
		if (!instance) {
			return {
				type: 'deployment-status',
				service: service.key,
				serviceName: service.serviceName,
				environment: expectedEnvironment,
				ok: false,
				status: 'missing_service_instance',
				message: `Railway status did not include service ${service.serviceName} in ${expectedEnvironment}.`,
			};
		}
		const deployment = instance.latestDeployment ?? null;
		if (!deployment) {
			return {
				type: 'deployment-status',
				service: service.key,
				serviceName: service.serviceName,
				environment: normalizeRailwayEnvironmentName(environment.name),
				ok: true,
				skipped: true,
				status: 'no_active_deployment',
				observed: {
					status: null,
					deploymentId: null,
					deploymentCreatedAt: null,
					deploymentStopped: null,
					instanceStatuses: [],
					volumeMounts: [],
				},
				message: `Railway service ${service.serviceName} has no active deployment to wait for.`,
			};
		}
		const status = String(deployment?.status ?? '').trim().toUpperCase();
		const instanceStatuses = Array.isArray(deployment?.instances)
			? deployment.instances.map((entry) => String(entry?.status ?? '').trim()).filter(Boolean)
			: [];
		const ok = railwayStatusDeploymentSettled(status);
		const terminalFailure = railwayStatusDeploymentTerminalFailure(status);
		return {
			type: 'deployment-status',
			service: service.key,
			serviceName: service.serviceName,
			environment: normalizeRailwayEnvironmentName(environment.name),
			ok,
			terminalFailure,
			status: status || 'missing_deployment',
			observed: {
				status: status || null,
				deploymentId: deployment?.id ?? null,
				deploymentCreatedAt: deployment?.createdAt ?? null,
				deploymentStopped: deployment?.deploymentStopped ?? null,
				instanceStatuses,
				volumeMounts: Array.isArray(deployment?.meta?.volumeMounts) ? deployment.meta.volumeMounts : [],
			},
			message: ok
				? undefined
				: terminalFailure
					? `Railway deployment for ${service.serviceName} failed with terminal status ${status}.`
					: `Railway deployment for ${service.serviceName} is not settled yet; observed ${status || 'missing deployment status'}.`,
		};
	});
}

export function isUsableRailwayToken(value) {
	return typeof value === 'string' && value.trim().length >= 8;
}

export function resolveRailwayAuthToken(env = process.env) {
	return resolveRailwayApiToken(env);
}

export function buildRailwayCommandEnv(env = process.env) {
	const merged = { ...env };
	const token = resolveRailwayAuthToken(merged);
	const projectToken = configuredEnvValue(merged, 'TREESEED_RAILWAY_TOKEN');
	if (token) {
		merged.RAILWAY_API_TOKEN = token;
	} else {
		merged.RAILWAY_API_TOKEN = undefined;
	}
	merged.RAILWAY_TOKEN = projectToken || undefined;
	return merged;
}

function normalizeRailwaySchedule(schedule) {
	if (!schedule || typeof schedule !== 'object') {
		return null;
	}
	const expression = String(
		schedule.expression
		?? schedule.schedule
		?? schedule.cron
		?? schedule.cronExpression
		?? '',
	).trim();
	if (!expression) {
		return null;
	}
	return {
		id: schedule.id ? String(schedule.id) : null,
		name: schedule.name ? String(schedule.name) : null,
		expression,
		command: String(schedule.command ?? schedule.startCommand ?? '').trim() || null,
		enabled: schedule.enabled !== false,
		serviceId: schedule.serviceId
			? String(schedule.serviceId)
			: schedule.service?.id
				? String(schedule.service.id)
				: null,
		serviceName: schedule.serviceName
			? String(schedule.serviceName)
			: schedule.service?.name
				? String(schedule.service.name)
				: null,
		environmentId: schedule.environmentId
			? String(schedule.environmentId)
			: schedule.environment?.id
				? String(schedule.environment.id)
				: null,
		environmentName: schedule.environmentName
			? String(schedule.environmentName)
			: schedule.environment?.name
				? String(schedule.environment.name)
				: null,
	};
}

function collectRailwaySchedules(value, seen = new Set()) {
	const matches = [];
	const visit = (entry) => {
		if (!entry || typeof entry !== 'object') {
			return;
		}
		if (seen.has(entry)) {
			return;
		}
		seen.add(entry);
		if (Array.isArray(entry)) {
			for (const item of entry) {
				visit(item);
			}
			return;
		}
		const normalized = normalizeRailwaySchedule(entry);
		if (normalized) {
			matches.push(normalized);
		}
		for (const child of Object.values(entry)) {
			visit(child);
		}
	};
	visit(value);
	return matches;
}

function isRailwayScheduleCapabilityError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /cronTriggers|cronTriggerCreate|cronTriggerUpdate/iu.test(message);
}

export async function waitForRailwayManagedDeploymentsSettled(
	tenantRoot,
	scope,
	{
		services = configuredRailwayServices(tenantRoot, scope),
		env = process.env,
		timeoutMs = 600_000,
		pollMs = 15_000,
		fetchImpl = fetch,
		onProgress,
	} = {},
) {
	const startMs = performance.now();
	const deadline = Date.now() + timeoutMs;
	const projectId = await resolveRailwayDeploymentProjectId(services, { env, fetchImpl });
	if (!projectId) {
		return {
			ok: false,
			checks: services.map((service) => ({
				type: 'deployment-status',
				service: service.key,
				serviceName: service.serviceName,
				environment: resolveRailwayEnvironmentForScope(scope),
				ok: false,
				status: 'missing_project',
				settle: {
					durationMs: elapsedMs(startMs),
					pollCount: 0,
					finalStatus: 'missing_project',
				},
				message: `Railway deployment status for ${service.serviceName} cannot be checked without a project id.`,
			})),
		};
	}
	let checks = [];
	let lastError = null;
	let lastSummary = '';
	let pollCount = 0;
	for (;;) {
		lastError = null;
		pollCount += 1;
		try {
			const statusPayload = await fetchRailwayProjectDeploymentStatus({
				projectId,
				env,
				fetchImpl,
			});
			checks = collectRailwayDeploymentStatusChecks(statusPayload, scope, services);
		} catch (error) {
			lastError = error;
			checks = services.map((service) => ({
				type: 'deployment-status',
				service: service.key,
				serviceName: service.serviceName,
				environment: resolveRailwayEnvironmentForScope(scope),
				ok: false,
				status: 'status_error',
				settle: {
					durationMs: elapsedMs(startMs),
					pollCount,
					finalStatus: 'status_error',
				},
				message: error instanceof Error ? error.message : String(error),
			}));
		}
		const summary = formatRailwayDeploymentStatusSummary(scope, checks);
		const progress = `${summary} poll=${pollCount} elapsed=${formatDurationMs(elapsedMs(startMs))}`;
		if (progress !== lastSummary || !checks.every((entry) => entry.ok === true || entry.skipped === true)) {
			onProgress?.(progress, 'stdout');
			lastSummary = progress;
		}
		if (checks.every((entry) => entry.ok === true || entry.skipped === true)) {
			return {
				ok: true,
				checks: checks.map((check) => ({
					...check,
					settle: {
						durationMs: elapsedMs(startMs),
						pollCount,
						finalStatus: check.status,
						fastSkipped: check.skipped === true,
					},
				})),
				settle: {
					durationMs: elapsedMs(startMs),
					pollCount,
					status: checks.every((entry) => entry.skipped === true) ? 'skipped' : 'settled',
				},
			};
		}
		if (checks.some((entry) => entry.terminalFailure === true)) {
			return {
				ok: false,
				checks: checks.map((check) => ({
					...check,
					settle: {
						durationMs: elapsedMs(startMs),
						pollCount,
						finalStatus: check.status,
						terminalFailure: check.terminalFailure === true,
					},
				})),
				settle: {
					durationMs: elapsedMs(startMs),
					pollCount,
					status: 'failed',
				},
				message: 'Railway deployment reached a terminal failed state.',
			};
		}
		if (Date.now() >= deadline) {
			return {
				ok: false,
				checks: checks.map((check) => ({
					...check,
					settle: {
						durationMs: elapsedMs(startMs),
						pollCount,
						finalStatus: check.status,
						timeout: true,
					},
				})),
				settle: {
					durationMs: elapsedMs(startMs),
					pollCount,
					status: 'timeout',
				},
				message: lastError instanceof Error
					? lastError.message
					: 'Railway deployments did not settle before the monitor timeout.',
			};
		}
		await sleep(pollMs);
	}
}

async function resolveRailwayDeploymentProjectId(services, { env = process.env, fetchImpl = fetch } = {}) {
	const configuredProjectId = services.find((service) => typeof service.projectId === 'string' && service.projectId.trim())?.projectId?.trim();
	if (configuredProjectId) {
		return configuredProjectId;
	}
	const projectName = services.find((service) => typeof service.projectName === 'string' && service.projectName.trim())?.projectName?.trim();
	if (!projectName) {
		return null;
	}
	try {
		const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
		const projects = await listRailwayProjects({ env, workspaceId: workspace.id, fetchImpl });
		return projects.find((project) => project.name === projectName)?.id ?? null;
	} catch {
		return null;
	}
}

async function fetchRailwayProjectDeploymentStatus({ projectId, env = process.env, fetchImpl = fetch }) {
	const payload = await railwayGraphqlRequest({
		query: `
query TreeseedRailwayDeploymentStatus($projectId: String!) {
	project(id: $projectId) {
		id
		environments(first: 50) {
			edges {
				node {
					id
					name
					serviceInstances {
						edges {
							node {
								id
								serviceId
								serviceName
								latestDeployment {
									id
									status
									createdAt
									deploymentStopped
									meta
									instances {
										id
										status
									}
								}
							}
						}
					}
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
		retries: 0,
	});
	return payload.data?.project ?? null;
}

function configuredRailwayServicesForConfig(tenantRoot, scope, deployConfig, application = null, machineConfigRoot = tenantRoot, envOverlay = {}, options = {}) {
	const normalizedScope = normalizeScope(scope);
	const identityOnly = options.identityOnly === true;
	const imageRefKeys = [
		'TREESEED_API_IMAGE_REF',
		'TREESEED_OPERATIONS_RUNNER_IMAGE_REF',
		'TREESEED_AGENT_MANAGER_IMAGE_REF',
		'TREESEED_AGENT_RUNNER_IMAGE_REF',
		'TREESEED_PUBLIC_TREEDX_IMAGE_REF',
	];
	let machineEnv = {};
	try {
		machineEnv = resolveTreeseedMachineEnvironmentValues(machineConfigRoot, normalizedScope, imageRefKeys);
	} catch {
		machineEnv = {};
	}
	const imageRefEnv = { ...machineEnv, ...process.env, ...envOverlay };
	let identity;
	try {
		identity = resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget(normalizedScope));
	} catch {
		identity = { deploymentKey: deployConfig.slug ?? deployConfig.name ?? 'treeseed' };
	}
	const managedRuntime = deployConfig.runtime?.mode === 'treeseed_managed';
	const hostingKind = deployConfig.hosting?.kind ?? (managedRuntime ? 'hosted_project' : 'self_hosted_project');
	if (!managedRuntime) {
		return [];
	}
	const configuredOptionalServiceKeys = Object.keys(deployConfig.services ?? {})
		.filter((serviceKey) => RAILWAY_SERVICE_KEYS.includes(serviceKey));
	const serviceKeys = hostingKind === 'hosted_project'
		? [...new Set([...HOSTED_PROJECT_SERVICE_KEYS, ...configuredOptionalServiceKeys])]
		: RAILWAY_SERVICE_KEYS;

	const configuredServices = serviceKeys
		.flatMap((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return [];
			}

			const isCapacityProviderService = String(serviceKey).startsWith('capacityProvider');
			const defaultRootDir = ['api', 'operationsRunner'].includes(serviceKey)
				? '.'
				: isCapacityProviderService
					? 'packages/agent'
					: 'packages/core';
			const serviceRoot = isCapacityProviderService
				? resolveRailwayCapacityProviderRoot(tenantRoot, service)
				: resolve(tenantRoot, service.railway?.rootDir ?? service.rootDir ?? defaultRootDir);
			const railwayEnvironment = resolveRailwayEnvironmentForScope(
				normalizedScope,
				service.environments?.[normalizedScope]?.railwayEnvironment,
			);
			const publicBaseUrl = service.environments?.[normalizedScope]?.baseUrl
				?? service.publicBaseUrl
				?? (serviceKey === 'api' ? configuredApiPublicBaseUrl(deployConfig, normalizedScope) : null);
			const environmentConfig = service.environments?.[normalizedScope];
			const baseServiceName = service.railway?.serviceName
				?? (serviceKey === 'workerRunner'
					? deriveRailwayWorkerRunnerServiceName(identity.deploymentKey)
					: `${identity.deploymentKey}-${railwayServiceNameSuffix(serviceKey)}`);
			const configuredServiceName = typeof environmentConfig?.serviceName === 'string' && environmentConfig.serviceName.trim()
				? environmentConfig.serviceName.trim()
				: isApiRailwaySourcePolicyService({ key: serviceKey, serviceName: baseServiceName })
					? railwayEnvironmentQualifiedServiceName(baseServiceName, normalizedScope)
					: baseServiceName;
			const configuredRunnerPool = service.railway?.runnerPool && typeof service.railway.runnerPool === 'object'
				? service.railway.runnerPool
				: null;
			const runnerPool = serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner'
				? {
					bootstrapCount: Math.max(1, Number.parseInt(String(configuredRunnerPool?.bootstrapCount ?? (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)), 10) || (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)),
					maxRunners: Math.max(1, Number.parseInt(String(configuredRunnerPool?.maxRunners ?? configuredRunnerPool?.bootstrapCount ?? (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)), 10) || (serviceKey === 'capacityProviderRunner' ? 1 : OPERATIONS_RUNNER_BOOTSTRAP_COUNT)),
					volumeMountPath: service.railway?.volumeMountPath ?? configuredRunnerPool?.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH,
				}
				: serviceKey === 'workerRunner'
					? {
						bootstrapIndex: WORKER_RUNNER_BOOTSTRAP_INDEX,
						volumeMountPath: WORKER_RUNNER_VOLUME_MOUNT_PATH,
					}
					: null;
			const instanceCount = serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? runnerPool.bootstrapCount : 1;
			return Array.from({ length: instanceCount }, (_, offset) => {
				const runnerIndex = offset + 1;
				const serviceName = serviceKey === 'operationsRunner'
					? deriveRailwayOperationsRunnerServiceName(configuredServiceName, runnerIndex)
					: serviceKey === 'capacityProviderRunner'
						? deriveRailwayCapacityProviderRunnerServiceName(configuredServiceName, runnerIndex)
						: configuredServiceName;
				const configuredImageRefEnv = service.railway?.imageRefEnv ?? railwayImageRefEnvForService(serviceKey);
				const canUseImageRefEnv = normalizedScope === 'prod'
					|| serviceKey === 'capacityProviderManager'
					|| serviceKey === 'capacityProviderRunner';
				const imageRef = service.railway?.imageRef
					?? (canUseImageRefEnv && configuredImageRefEnv ? envValue(configuredImageRefEnv, imageRefEnv) || null : null)
					?? defaultRailwayImageRef(serviceKey, normalizedScope, imageRefEnv);
				const sourcePolicy = identityOnly
					? {
						sourceMode: normalizedScope === 'prod' ? 'image' : 'git',
						sourceRepo: null,
						sourceBranch: null,
						sourceCommit: null,
						sourceRootDirectory: null,
					}
					: resolveRailwayServiceSourcePolicy({
						tenantRoot,
						scope: normalizedScope,
						serviceKey,
						service,
						serviceRoot,
						imageRef,
						serviceName,
					});
				const resolvedImageRef = sourcePolicy.sourceMode === 'image' ? imageRef : null;
					return {
						key: serviceKey,
					instanceKey: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? `${serviceKey}:${runnerIndex}` : serviceKey,
					runnerIndex: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? runnerIndex : null,
					serviceConfig: service,
					scope: normalizedScope,
					projectId: service.railway?.projectId ?? null,
					projectName: environmentConfig?.railwayProjectName ?? service.railway?.projectName ?? identity.deploymentKey,
					serviceId: service.railway?.serviceId ?? null,
					serviceName,
					runnerId: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? serviceName : null,
					rootDir: serviceRoot,
					publicBaseUrl,
					railwayEnvironment,
					buildCommand: resolvedImageRef || (sourcePolicy.sourceMode === 'git' && service.railway?.dockerfilePath)
						? null
						: service.railway?.buildCommand ?? null,
						startCommand: isCapacityProviderService ? null : resolvedImageRef ? null : service.railway?.startCommand ?? null,
					imageRef: resolvedImageRef,
					sourceMode: sourcePolicy.sourceMode,
					sourceRepo: sourcePolicy.sourceRepo,
					sourceBranch: sourcePolicy.sourceBranch,
					sourceCommit: sourcePolicy.sourceCommit,
					sourceRootDirectory: sourcePolicy.sourceRootDirectory,
					dockerfilePath: sourcePolicy.sourceMode === 'git'
						? service.railway?.dockerfilePath ?? apiRailwayDefaultDockerfilePath({ key: serviceKey, serviceName })
						: null,
					healthcheckPath: service.railway?.healthcheckPath ?? null,
					healthcheckTimeoutSeconds: service.railway?.healthcheckTimeoutSeconds ?? null,
					healthcheckIntervalSeconds: service.railway?.healthcheckIntervalSeconds ?? null,
					restartPolicy: service.railway?.restartPolicy ?? null,
					runtimeMode: service.railway?.runtimeMode ?? null,
					volumeMountPath: serviceKey === 'operationsRunner' || serviceKey === 'capacityProviderRunner' ? runnerPool.volumeMountPath : service.railway?.volumeMountPath ?? null,
					schedule: normalizeScheduleExpressions(service.railway?.schedule),
					hostingKind,
						runnerPool,
						application,
						secretRefs: Array.isArray(service.secretRefs) ? service.secretRefs : [],
						variableRefs: Array.isArray(service.variableRefs) ? service.variableRefs : [],
					};
				});
		})
		.filter(Boolean);
	return [
		...configuredServices,
		...configuredPublicTreeDxRailwayServices({
			tenantRoot,
			scope: normalizedScope,
			deployConfig,
			identity,
			hostingKind,
			application,
			imageRefEnv,
			workspaceRoot: machineConfigRoot,
			identityOnly,
		}),
	];
}

function configuredPublicTreeDxRailwayServices({ tenantRoot, scope, deployConfig, identity, hostingKind, application, imageRefEnv, workspaceRoot, identityOnly = false }) {
	if (deployConfig.hosting?.kind !== 'treeseed_control_plane') {
		return [];
	}
	const railway = deployConfig.publicTreeDxFederation?.railway ?? {};
	const nodePool = railway.nodePool && typeof railway.nodePool === 'object' && !Array.isArray(railway.nodePool)
		? railway.nodePool
		: {};
	const bootstrapCount = Math.max(0, Number.parseInt(String(nodePool.bootstrapCount ?? 1), 10) || 0);
	if (bootstrapCount <= 0) {
		return [];
	}
	const configuredSource = railway.source && typeof railway.source === 'object' && !Array.isArray(railway.source)
		? railway.source
		: {};
	const treeDxRoot = resolve(workspaceRoot ?? tenantRoot, 'packages', 'treedx');
	const configuredMode = typeof railway.sourceMode === 'string' ? railway.sourceMode : null;
	if (scope === 'staging' && configuredMode === 'image') {
		throw new Error('public-treedx-node-01: API Railway staging services must use GitHub Dockerfile source builds (configured sourceMode image is not allowed).');
	}
	const sourceMode = scope === 'prod'
		? 'image'
		: configuredMode === 'git' || configuredMode === 'image'
			? configuredMode
			: 'git';
	const repository = typeof railway.sourceRepo === 'string'
		? railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: readTreeseedPackageRepository(treeDxRoot) ?? 'treeseed-ai/treedx';
	const sourceBranch = typeof railway.sourceBranch === 'string'
		? railway.sourceBranch
		: typeof configuredSource.branch === 'string'
			? configuredSource.branch
			: scope === 'staging'
				? 'staging'
				: null;
	const sourceRootDirectory = typeof railway.sourceRootDirectory === 'string'
		? railway.sourceRootDirectory
		: typeof configuredSource.rootDirectory === 'string'
			? configuredSource.rootDirectory
			: '.';
	const projectName = typeof railway.projectName === 'string' && railway.projectName.trim()
		? railway.projectName.trim()
		: typeof imageRefEnv.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME === 'string' && imageRefEnv.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME.trim()
			? imageRefEnv.TREESEED_PUBLIC_TREEDX_RAILWAY_PROJECT_NAME.trim()
			: identity.deploymentKey;
	const railwayEnvironment = resolveRailwayEnvironmentForScope(scope, railway.environmentName);
	const baseImageRef = envValue('TREESEED_PUBLIC_TREEDX_IMAGE_REF', imageRefEnv) || 'treeseed/treedx';
	return Array.from({ length: bootstrapCount }, (_, offset) => {
		const index = offset + 1;
		const baseServiceName = `${PUBLIC_TREEDX_NODE_SERVICE_KEY_PREFIX}${String(index).padStart(2, '0')}`;
		const serviceName = railwayTreeDxServiceName(index, scope);
		const service = {
			key: baseServiceName,
			serviceName,
			sourceMode,
			sourceRepo: sourceMode === 'git' ? repository : null,
			sourceBranch: sourceMode === 'git' ? sourceBranch : null,
			sourceCommit: sourceMode === 'git'
				? typeof railway.sourceCommit === 'string'
					? railway.sourceCommit
					: typeof configuredSource.commit === 'string'
						? configuredSource.commit
						: headCommitSafe(treeDxRoot) ?? headCommitSafe(tenantRoot)
				: null,
			sourceRootDirectory: sourceMode === 'git' ? sourceRootDirectory : null,
			imageRef: sourceMode === 'image' ? baseImageRef : null,
			dockerfilePath: sourceMode === 'git' ? railway.dockerfilePath ?? '/Dockerfile' : null,
			buildCommand: sourceMode === 'git' ? railway.buildCommand ?? null : null,
			startCommand: sourceMode === 'git' ? railway.startCommand ?? null : null,
		};
		if (!identityOnly) {
			assertApiRailwaySourcePolicy(scope, service);
		}
		return {
			key: service.key,
			instanceKey: serviceName,
			runnerIndex: null,
			serviceConfig: null,
			scope,
			projectId: typeof railway.projectId === 'string' ? railway.projectId : null,
			projectName,
			serviceId: typeof railway.serviceId === 'string' && bootstrapCount === 1 ? railway.serviceId : null,
			serviceName: service.serviceName,
			runnerId: null,
			rootDir: treeDxRoot,
			publicBaseUrl: null,
			railwayEnvironment,
			buildCommand: service.buildCommand,
			startCommand: service.startCommand,
			imageRef: service.imageRef,
			sourceMode: service.sourceMode,
			sourceRepo: service.sourceRepo,
			sourceBranch: service.sourceBranch,
			sourceCommit: service.sourceCommit,
			sourceRootDirectory: service.sourceRootDirectory,
			dockerfilePath: service.dockerfilePath,
			healthcheckPath: railway.healthcheckPath ?? null,
			healthcheckTimeoutSeconds: railway.healthcheckTimeoutSeconds ?? null,
			healthcheckIntervalSeconds: railway.healthcheckIntervalSeconds ?? null,
			restartPolicy: railway.restartPolicy ?? null,
			runtimeMode: railway.runtimeMode ?? 'replicated',
			volumeMountPath: railway.volumeMountPath ?? '/data',
			schedule: [],
			hostingKind,
			runnerPool: null,
			application,
			environmentVariables: {
					PORT: '4000',
					TREEDX_DATA_DIR: railway.volumeMountPath ?? '/data',
					TREEDX_AUTH_MODE: 'connected',
					TREEDX_AUTH_VERIFIER: 'hs256_dev',
					TREEDX_ALLOW_DEV_VERIFIER_IN_PROD: 'true',
					TREEDX_EXEC_BACKEND: 'container_sandbox',
					TREEDX_FEDERATION_MODE: 'connected_library',
					TREEDX_JWT_AUDIENCE: 'treedx-public-federation',
					TREEDX_JWT_ISSUER: 'https://api.treeseed.local/treedx',
					TREEDX_BOOTSTRAP_TRUST_ACTOR_ID: 'treeseed-api',
					TREEDX_BOOTSTRAP_TRUST_TENANT_ID: 'treeseed-control-plane',
					TREEDX_BOOTSTRAP_TRUST_REPO_IDS: '*',
					TREEDX_BOOTSTRAP_TRUST_REFS: '*',
					TREEDX_BOOTSTRAP_TRUST_PATHS: '**',
					TREEDX_SCOPE: 'public_federation',
				},
				secretRefs: ['TREEDX_SECRET_KEY_BASE', 'TREEDX_ADMIN_TOKEN', 'TREEDX_JWT_HS256_SECRET'],
				variableRefs: [
					'PORT',
					'TREEDX_DATA_DIR',
					'TREEDX_AUTH_MODE',
					'TREEDX_AUTH_VERIFIER',
					'TREEDX_ALLOW_DEV_VERIFIER_IN_PROD',
					'TREEDX_EXEC_BACKEND',
					'TREEDX_FEDERATION_MODE',
					'TREEDX_JWT_AUDIENCE',
					'TREEDX_JWT_ISSUER',
					'TREEDX_BOOTSTRAP_TRUST_ACTOR_ID',
					'TREEDX_BOOTSTRAP_TRUST_TENANT_ID',
					'TREEDX_BOOTSTRAP_TRUST_REPO_IDS',
					'TREEDX_BOOTSTRAP_TRUST_REFS',
					'TREEDX_BOOTSTRAP_TRUST_PATHS',
					'TREEDX_SCOPE',
				],
			};
		});
	}

function readTreeseedPackageRepository(packageRoot) {
	const manifestPath = resolve(packageRoot, 'treeseed.package.yaml');
	if (!existsSync(manifestPath)) return null;
	try {
		const manifest = parseYaml(readFileSync(manifestPath, 'utf8'));
		const repository = manifest && typeof manifest === 'object' && !Array.isArray(manifest)
			? (manifest as Record<string, unknown>).repository
			: null;
		return typeof repository === 'string' && /^[^/\s]+\/[^/\s]+$/u.test(repository.trim()) ? repository.trim() : null;
	} catch {
		return null;
	}
}

function headCommitSafe(cwd) {
	try {
		return runTreeseedGitText(['rev-parse', 'HEAD'], {
			cwd,
			mode: classifyTreeseedGitMode(['rev-parse', 'HEAD']),
		}).trim();
	} catch {
		return null;
	}
}

function resolveRailwayServiceSourcePolicy({ tenantRoot, scope, serviceKey, service, serviceRoot, imageRef, serviceName: effectiveServiceName }) {
	const configuredMode = typeof service.railway?.sourceMode === 'string' ? service.railway.sourceMode : null;
	const configuredSource = service.railway?.source && typeof service.railway.source === 'object' && !Array.isArray(service.railway.source)
		? service.railway.source
		: {};
	const configuredRepo = typeof service.railway?.sourceRepo === 'string'
		? service.railway.sourceRepo
		: typeof configuredSource.repository === 'string'
			? configuredSource.repository
			: typeof configuredSource.repo === 'string'
				? configuredSource.repo
				: null;
	const serviceName = effectiveServiceName ?? service.railway?.serviceName ?? null;
	const packageRepository = configuredRepo
		?? readTreeseedPackageRepository(serviceRoot)
		?? readTreeseedPackageRepository(tenantRoot)
		?? apiRailwayDefaultSourceRepo({ key: serviceKey, serviceName });
	const dockerfilePath = service.railway?.dockerfilePath ?? apiRailwayDefaultDockerfilePath({ key: serviceKey, serviceName });
	const apiPackageSourceEligible = ['api', 'operationsRunner'].includes(serviceKey);
	if (scope === 'staging' && isApiRailwaySourcePolicyService({ key: serviceKey, serviceName }) && (configuredMode === 'image' || service.railway?.imageRef)) {
		throw new Error(`${serviceName ?? serviceKey}: API Railway staging services must use GitHub Dockerfile source builds (configured image source is not allowed).`);
	}
	const sourceMode = scope === 'prod'
		? 'image'
		: scope === 'staging' && apiPackageSourceEligible
			? 'git'
		: configuredMode === 'git' || configuredMode === 'image'
			? configuredMode
			: imageRef
				? 'image'
			: 'git';
	if (sourceMode !== 'git') {
		const policy = {
			sourceMode: 'image',
			sourceRepo: null,
			sourceBranch: null,
			sourceCommit: null,
			sourceRootDirectory: null,
		};
		assertApiRailwaySourcePolicy(scope, {
			key: serviceKey,
			serviceName,
			imageRef,
			dockerfilePath: null,
			buildCommand: null,
			startCommand: null,
			...policy,
		});
		return policy;
	}
	const policy = {
		sourceMode: 'git',
		sourceRepo: packageRepository,
		sourceBranch: typeof service.railway?.sourceBranch === 'string'
			? service.railway.sourceBranch
			: typeof configuredSource.branch === 'string'
				? configuredSource.branch
				: scope === 'staging'
					? 'staging'
					: null,
		sourceCommit: typeof service.railway?.sourceCommit === 'string'
			? service.railway.sourceCommit
			: typeof configuredSource.commit === 'string'
				? configuredSource.commit
				: headCommitSafe(serviceRoot),
		sourceRootDirectory: typeof service.railway?.sourceRootDirectory === 'string'
			? service.railway.sourceRootDirectory
			: typeof configuredSource.rootDirectory === 'string'
				? configuredSource.rootDirectory
				: '.',
	};
	assertApiRailwaySourcePolicy(scope, {
		key: serviceKey,
		serviceName,
		imageRef: null,
		dockerfilePath,
		...policy,
	});
	return policy;
}

function resolveRailwayCapacityProviderRoot(tenantRoot, service) {
	if (service.railway?.rootDir) {
		return resolve(tenantRoot, service.railway.rootDir);
	}
	const candidates = [
		resolve(tenantRoot, '..', 'agent'),
		resolve(tenantRoot, 'packages', 'agent'),
		resolve(tenantRoot, '..', '..', 'packages', 'agent'),
	];
	const found = candidates.find((candidate) =>
		existsSync(resolve(candidate, 'treeseed.package.yaml'))
		|| existsSync(resolve(candidate, 'package.json')),
	);
	return found ?? resolve(tenantRoot, 'packages', 'agent');
}

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

async function resolveRailwayScheduleTarget(
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

export async function ensureRailwayScheduledJobs(
	tenantRoot,
	scope,
	{ planOnly = false, fetchImpl = fetch, apiToken, apiUrl, env = process.env } = {},
) {
	const { schedules } = validateRailwayServiceConfiguration(tenantRoot, scope);
	if (schedules.length === 0) {
		return [];
	}
	const effectiveApiToken = apiToken || resolveRailwayAuthToken(env);
	const effectiveApiUrl = apiUrl || resolveRailwayApiUrl(env);
	if (typeof effectiveApiToken !== 'string' || effectiveApiToken.trim().length === 0) {
		throw new Error('Configure TREESEED_RAILWAY_API_TOKEN before deploying Railway-managed services.');
	}
	const results = [];

	try {
		for (const schedule of schedules) {
			const target = await resolveRailwayScheduleTarget(schedule, {
				env,
				fetchImpl,
				ensure: !planOnly,
			});
			if (!target.project || !target.environment || !target.service) {
				results.push({
					...schedule,
					id: null,
					projectId: target.project?.id ?? null,
					serviceId: target.service?.id ?? null,
					environmentId: target.environment?.id ?? null,
					status: 'skipped_missing_identifiers',
					enabled: schedule.enabled !== false,
					command: schedule.command,
				});
				continue;
			}
			const current = await getRailwayServiceInstance({
				serviceId: target.service.id,
				environmentId: target.environment.id,
				env: { ...env, TREESEED_RAILWAY_API_TOKEN: effectiveApiToken, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl },
				fetchImpl,
			});
			const desired = {
				name: schedule.logicalName,
				schedule: schedule.expression,
				command: schedule.command,
				enabled: schedule.enabled !== false,
			};
			const drifted = Boolean(
				current.id
				&& (
					current.cronSchedule !== desired.schedule
					|| (current.startCommand ?? null) !== (desired.command ?? null)
				)
			);
			if (planOnly) {
				results.push({
					...schedule,
					projectId: target.project.id,
					id: current.id,
					status: current.id ? (drifted ? 'planned_update' : 'planned_noop') : 'planned_create',
					enabled: desired.enabled,
					command: desired.command,
					serviceId: target.service.id,
					environmentId: target.environment.id,
				});
				continue;
			}
			const updated = await ensureRailwayServiceInstanceConfiguration({
				serviceId: target.service.id,
				environmentId: target.environment.id,
				startCommand: desired.command,
				cronSchedule: desired.schedule,
				env: { ...env, TREESEED_RAILWAY_API_TOKEN: effectiveApiToken, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl },
				fetchImpl,
			});
			results.push({
				...schedule,
				projectId: target.project.id,
				id: updated.instance.id,
				status: updated.updated ? 'updated' : 'noop',
				enabled: desired.enabled,
				command: desired.command,
				serviceId: target.service.id,
				environmentId: target.environment.id,
			});
		}
	} catch (error) {
		if (!isRailwayScheduleCapabilityError(error)) {
			throw error;
		}
		return schedules.map((schedule) => ({
			...schedule,
			id: null,
			status: 'unsupported',
			enabled: schedule.enabled !== false,
			command: schedule.command,
			message: 'Railway GraphQL no longer exposes cron trigger resources for this account. Schedule reconciliation is not currently supported.',
		}));
	}

	return results;
}

export async function verifyRailwayScheduledJobs(
	tenantRoot,
	scope,
	{ fetchImpl = fetch, apiToken, apiUrl, env = process.env } = {},
) {
	const effectiveApiToken = apiToken || resolveRailwayAuthToken(env);
	const effectiveApiUrl = apiUrl || resolveRailwayApiUrl(env);
	const configured = configuredRailwayScheduledJobs(tenantRoot, scope);
	const checks = [];

	try {
		for (const schedule of configured) {
			const target = await resolveRailwayScheduleTarget(schedule, {
				env,
				fetchImpl,
				ensure: false,
			});
			if (!target.project || !target.environment || !target.service) {
				checks.push({
					...schedule,
					id: null,
					ok: false,
					status: 'skipped_missing_identifiers',
					message: `Railway schedule target is missing in workspace ${target.workspace.name}.`,
				});
				continue;
			}
			const existing = await getRailwayServiceInstance({
				serviceId: target.service.id,
				environmentId: target.environment.id,
				env: { ...env, TREESEED_RAILWAY_API_TOKEN: effectiveApiToken, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl },
				fetchImpl,
			});
			checks.push({
				...schedule,
				id: existing.id,
				projectId: target.project.id,
				serviceId: target.service.id,
				environmentId: target.environment.id,
				ok: Boolean(
					existing.id
					&& existing.cronSchedule === schedule.expression
					&& (existing.startCommand ?? null) === (schedule.command ?? null)
				),
				status: existing.id ? 'checked' : 'missing',
				observed: existing.id
					? {
						expression: existing.cronSchedule,
						command: existing.startCommand ?? null,
						enabled: true,
					}
					: null,
				message: existing.id
					? undefined
					: `Railway schedule ${schedule.logicalName} is missing for ${target.service.name} in ${target.environment.name}.`,
			});
		}
	} catch (error) {
		if (!isRailwayScheduleCapabilityError(error)) {
			throw error;
		}
		return {
			ok: true,
			unsupported: true,
			message: 'Railway GraphQL no longer exposes cron trigger resources for this account. Schedule verification is skipped.',
			checks: configured.map((schedule) => ({
				...schedule,
				id: null,
				ok: true,
				status: 'unsupported',
				message: 'Railway GraphQL no longer exposes cron trigger resources for this account. Schedule verification is skipped.',
			})),
		};
	}

	return {
		ok: checks.every((entry) => entry.ok === true),
		checks,
	};
}

export async function verifyRailwayManagedResources(
	tenantRoot,
	scope,
	{
		fetchImpl = fetch,
		apiToken,
		apiUrl,
		env = process.env,
		settleDeployments = false,
		settleTimeoutMs = 600_000,
		settlePollMs = 15_000,
		onProgress,
	} = {},
) {
	const effectiveApiToken = apiToken || resolveRailwayAuthToken(env);
	const effectiveApiUrl = apiUrl || resolveRailwayApiUrl(env);
	const effectiveEnv = { ...env, TREESEED_RAILWAY_API_TOKEN: effectiveApiToken, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl };
	const services = configuredRailwayServices(tenantRoot, scope);
	const checks = [];
	const deploymentStatusServices = [];

	for (const service of services) {
		const target = await resolveRailwayScheduleTarget({
			projectId: service.projectId,
			projectName: service.projectName,
			serviceId: service.serviceId,
			serviceName: service.serviceName,
			environment: normalizeRailwayEnvironmentName(service.railwayEnvironment),
			environmentId: envValue('TREESEED_RAILWAY_ENVIRONMENT_ID') || null,
		}, {
			env: effectiveEnv,
			fetchImpl,
			ensure: false,
		});
		if (!target.project || !target.environment || !target.service) {
			checks.push({
				type: 'service',
				service: service.key,
				serviceName: service.serviceName,
				projectName: service.projectName,
				environment: service.railwayEnvironment,
				ok: false,
				status: 'missing',
				message: `Railway service ${service.serviceName} is missing in ${service.railwayEnvironment}.`,
			});
			continue;
		}
		deploymentStatusServices.push({
			...service,
			projectId: target.project.id,
		});
		const instance = await getRailwayServiceInstance({
			serviceId: target.service.id,
			environmentId: target.environment.id,
			env: effectiveEnv,
			fetchImpl,
		});
		checks.push({
			type: 'service-instance',
			service: service.key,
			serviceName: target.service.name,
			serviceId: target.service.id,
			projectId: target.project.id,
			environment: target.environment.name,
			environmentId: target.environment.id,
			instanceId: instance.id,
			ok: Boolean(instance.id),
			status: instance.id ? 'checked' : 'missing',
			observed: instance.id
				? {
					rootDirectory: instance.rootDirectory,
					startCommand: instance.startCommand,
					cronSchedule: instance.cronSchedule,
					sleepApplication: instance.sleepApplication,
					runtimeMode: instance.runtimeMode,
				}
				: null,
			message: instance.id
				? undefined
				: `Railway service instance for ${target.service.name} is missing in ${target.environment.name}.`,
		});
		const expectedVolumeMountPath = service.volumeMountPath ?? service.runnerPool?.volumeMountPath ?? null;
		if (expectedVolumeMountPath) {
			const expectedVolumeName = service.key === 'operationsRunner'
				? deriveRailwayOperationsRunnerVolumeName(target.service.name, target.environment.name)
				: service.key === 'capacityProviderRunner'
					? deriveRailwayCapacityProviderRunnerVolumeName(target.service.name, target.environment.name)
				: deriveRailwayWorkerRunnerVolumeName(target.service.name, target.environment.name);
			const volumes = await listRailwayVolumes({
				projectId: target.project.id,
				env: effectiveEnv,
				fetchImpl,
			});
			const volume = volumes.find((candidate) =>
				candidate.name === expectedVolumeName
				&& candidate.instances.some((entry) =>
					entry.serviceId === target.service.id
					&& entry.environmentId === target.environment.id
					&& entry.mountPath === expectedVolumeMountPath),
			) ?? null;
			checks.push({
				type: 'service-volume',
				service: service.key,
				serviceName: target.service.name,
				serviceId: target.service.id,
				projectId: target.project.id,
				environment: target.environment.name,
				environmentId: target.environment.id,
				volumeName: expectedVolumeName,
				mountPath: expectedVolumeMountPath,
				ok: Boolean(volume),
				status: volume ? 'checked' : 'missing',
				observed: volume
					? {
						id: volume.id,
						name: volume.name,
						instances: volume.instances,
					}
					: null,
				message: volume
					? undefined
					: `Railway volume ${expectedVolumeName} is missing or is not mounted on ${target.service.name} at ${expectedVolumeMountPath}.`,
			});
		}
	}

	const schedules = await verifyRailwayScheduledJobs(tenantRoot, scope, {
		fetchImpl,
		apiToken: effectiveApiToken,
		apiUrl: effectiveApiUrl,
		env: effectiveEnv,
	});
	for (const check of schedules.checks ?? []) {
		checks.push({
			type: 'schedule',
			...check,
		});
	}
	if (settleDeployments) {
		const settled = await waitForRailwayManagedDeploymentsSettled(tenantRoot, scope, {
			services: deploymentStatusServices.length > 0 ? deploymentStatusServices : services,
			env: effectiveEnv,
			fetchImpl,
			timeoutMs: settleTimeoutMs,
			pollMs: settlePollMs,
			onProgress,
		});
		for (const check of settled.checks ?? []) {
			checks.push(check);
		}
	}

	return {
		ok: checks.every((entry) => entry.ok === true || entry.skipped === true),
		checks,
	};
}

function railwayPhaseTimeoutMs(env = process.env, phase = 'default') {
	const configured = Number.parseInt(configuredEnvValue(env, `TREESEED_RAILWAY_${String(phase).toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_TIMEOUT_MS`), 10);
	if (Number.isFinite(configured) && configured > 0) {
		return configured;
	}
	const defaultConfigured = Number.parseInt(configuredEnvValue(env, 'TREESEED_RAILWAY_PHASE_TIMEOUT_MS'), 10);
	if (Number.isFinite(defaultConfigured) && defaultConfigured > 0) {
		return defaultConfigured;
	}
	if (phase === 'sync_runtime_config') {
		return 600_000;
	}
	return phase === 'deploy' ? 300_000 : 180_000;
}

async function withRailwayPhaseTimeout(run, timeoutMs, message) {
	let timer: NodeJS.Timeout | null = null;
	try {
		return await Promise.race([
			Promise.resolve().then(run),
			new Promise((_, reject) => {
				timer = setTimeout(() => reject(new Error(message)), timeoutMs);
			}),
		]);
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
	}
}

export function shouldRunRailwayPredeployBuild(env = process.env) {
	const configured = configuredEnvValue(env, 'TREESEED_RAILWAY_PREDEPLOY_BUILD');
	if (configured === '1' || configured === 'true') {
		return true;
	}
	if (configured === '0' || configured === 'false') {
		return false;
	}
	return configuredEnvValue(env, 'CI') !== 'true';
}

async function syncRailwayApiDeviceLoginVariables(service, env, write, prefix, fetchImpl = fetch) {
	if (service.key !== 'api') {
		return null;
	}
	const projectId = configuredEnvValue(service, 'projectId');
	const environmentId = configuredEnvValue(service, 'environmentId');
	const serviceId = configuredEnvValue(service, 'serviceId');
	if (!projectId || !environmentId || !serviceId) {
		return null;
	}
	const variables = Object.fromEntries(
		[
			'TREESEED_API_AUTH_APPROVAL_BASE_URL',
			'TREESEED_SITE_URL',
			'TREESEED_BETTER_AUTH_URL',
		]
			.map((key) => [key, configuredEnvValue(env, key)])
			.filter(([, value]) => value),
	);
	if (Object.keys(variables).length === 0) {
		return null;
	}
	await upsertRailwayVariables({
		projectId,
		environmentId,
		serviceId,
		variables,
		env,
		fetchImpl,
	});
	write ? write(`[${prefix.scope}][${prefix.system}][${prefix.task}][vars] Synced device login approval URL variables for ${service.serviceName ?? serviceId}.`, 'stdout') : null;
	return { variables: Object.keys(variables) };
}

async function resolveRailwayDeployProjectContext(service, { env = process.env, fetchImpl = fetch } = {}) {
	if (service.projectId) {
		return service;
	}
	const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
	const { project } = await ensureRailwayProject({
		projectId: service.projectId,
		projectName: service.projectName,
		defaultEnvironmentName: service.railwayEnvironment,
		env,
		workspace: workspace.id,
		fetchImpl,
	});
	return {
		...service,
		projectId: project.id,
		projectName: project.name ?? service.projectName,
	};
}

async function syncRailwayServiceRuntimeConfigurationAfterDeploy(tenantRoot, service, { env = process.env, writePhase = null, fetchImpl = fetch } = {}) {
	const writeSyncPhase = (stage, message) => {
		if (typeof writePhase === 'function') {
			writePhase(`sync-runtime-config:${stage}`, message);
		}
	};
	const wantsInstanceConfig = service.buildCommand
		|| service.startCommand
		|| (!(service.imageRef || service.sourceMode === 'image') && service.rootDir)
		|| service.healthcheckPath
		|| service.healthcheckTimeoutSeconds !== null
		|| service.healthcheckTimeoutSeconds !== undefined
		|| service.healthcheckIntervalSeconds !== null
		|| service.healthcheckIntervalSeconds !== undefined
		|| service.restartPolicy
		|| service.runtimeMode;
	const wantsRunnerVolume = service.key === 'workerRunner' || service.key === 'operationsRunner' || service.key === 'capacityProviderRunner';
	if (!wantsInstanceConfig && !wantsRunnerVolume) {
		writeSyncPhase('skip', 'No runtime configuration changes requested.');
		return null;
	}

	writeSyncPhase('workspace', 'Resolving Railway workspace.');
	const workspace = await resolveRailwayWorkspaceContext({ env, fetchImpl });
	let project = null;
	if (service.projectId) {
		writeSyncPhase('project', `Resolving Railway project ${service.projectName ?? service.projectId}.`);
		project = await ensureRailwayProject({
			projectId: service.projectId,
			projectName: service.projectName,
			defaultEnvironmentName: service.railwayEnvironment,
			env,
			workspace: workspace.id,
			fetchImpl,
		}).then((result) => result.project);
	} else {
		writeSyncPhase('project', `Looking up Railway project ${service.projectName}.`);
		const projects = await listRailwayProjects({ env, workspaceId: workspace.id, fetchImpl });
		project = projects.find((entry) => entry.name === service.projectName) ?? null;
		if (!project) {
			writeSyncPhase('project', `Creating Railway project ${service.projectName}.`);
			project = await ensureRailwayProject({
				projectName: service.projectName,
				defaultEnvironmentName: service.railwayEnvironment,
				env,
				workspace: workspace.id,
				fetchImpl,
			}).then((result) => result.project);
		}
	}

	const environmentName = normalizeRailwayEnvironmentName(service.railwayEnvironment);
	let environment = project.environments.find((entry) => entry.name === environmentName || entry.id === environmentName) ?? null;
	if (!environment) {
		writeSyncPhase('environment', `Creating Railway environment ${environmentName}.`);
		environment = await ensureRailwayEnvironment({
			projectId: project.id,
			environmentName,
			env,
			fetchImpl,
		}).then((result) => result.environment);
	}

	let railwayService = project.services.find((entry) => entry.id === service.serviceId || entry.name === service.serviceName) ?? null;
	if (!railwayService) {
		writeSyncPhase('service', `Creating Railway service ${service.serviceName ?? service.key}.`);
		railwayService = await ensureRailwayService({
			projectId: project.id,
			serviceId: service.serviceId,
			serviceName: service.serviceName,
			environmentId: environment.id,
			imageRef: service.imageRef,
			sourceRepo: service.sourceRepo,
			sourceBranch: service.sourceBranch,
			env,
			fetchImpl,
		}).then((result) => result.service);
	} else if (service.imageRef || service.sourceRepo) {
		railwayService = await ensureRailwayService({
			projectId: project.id,
			serviceId: service.serviceId,
			serviceName: service.serviceName,
			environmentId: environment.id,
			imageRef: service.imageRef,
			sourceRepo: service.sourceRepo,
			sourceBranch: service.sourceBranch,
			env,
			fetchImpl,
		}).then((result) => result.service);
	}

	if (wantsInstanceConfig) {
		writeSyncPhase('instance', 'Ensuring Railway service instance configuration.');
	}
	const runtimeConfiguration = wantsInstanceConfig
		? await ensureRailwayServiceInstanceConfiguration({
			serviceId: railwayService.id,
			environmentId: environment.id,
			buildCommand: service.buildCommand,
			startCommand: railwayServiceRuntimeStartCommand(service),
			cronSchedule: service.schedule?.[0] ?? null,
			rootDirectory: service.imageRef || service.sourceMode === 'image' ? null : service.sourceRootDirectory ?? '.',
			healthcheckPath: service.healthcheckPath,
			healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
			healthcheckIntervalSeconds: service.healthcheckIntervalSeconds,
			restartPolicy: service.restartPolicy,
			runtimeMode: service.runtimeMode,
			deploymentRegion: wantsRunnerVolume
				? configuredEnvValue(env, 'TREESEED_RAILWAY_STATEFUL_REGION') || 'us-west2'
				: null,
			env,
			fetchImpl,
		})
		: null;
	writeSyncPhase('variables', 'Upserting Railway runtime variables.');
	await upsertRailwayVariables({
		projectId: project.id,
		environmentId: environment.id,
		serviceId: railwayService.id,
		variables: {
			TREESEED_SKIP_PACKAGE_PREPARE: '1',
			...(['api', 'operationsRunner'].includes(service.key) ? {
				...(configuredEnvValue(env, 'TREESEED_PLATFORM_RUNNER_SECRET') ? {
					TREESEED_PLATFORM_RUNNER_SECRET: configuredEnvValue(env, 'TREESEED_PLATFORM_RUNNER_SECRET'),
				} : {}),
				...(configuredEnvValue(env, 'TREESEED_CREDENTIAL_SESSION_SECRET') ? {
					TREESEED_CREDENTIAL_SESSION_SECRET: configuredEnvValue(env, 'TREESEED_CREDENTIAL_SESSION_SECRET'),
				} : {}),
				...(configuredEnvValue(env, 'TREESEED_WEB_SERVICE_SECRET') ? {
					TREESEED_WEB_SERVICE_SECRET: configuredEnvValue(env, 'TREESEED_WEB_SERVICE_SECRET'),
				} : {}),
			} : {}),
			...(service.sourceMode === 'git' ? {
				TREESEED_DEPLOY_SOURCE_MODE: 'git',
				...(service.sourceRepo ? { TREESEED_DEPLOY_SOURCE_REPOSITORY: service.sourceRepo } : {}),
				...(service.sourceBranch ? { TREESEED_DEPLOY_SOURCE_BRANCH: service.sourceBranch } : {}),
				...(service.sourceCommit ? { TREESEED_DEPLOY_SOURCE_COMMIT: service.sourceCommit } : {}),
			} : {
				TREESEED_DEPLOY_SOURCE_MODE: 'image',
			}),
			...(service.key === 'operationsRunner' ? {
				NIXPACKS_APT_PKGS: 'git',
				NIXPACKS_PKGS: 'git',
				TREESEED_PLATFORM_RUNNER_ID: service.runnerId ?? railwayService.name,
				TREESEED_PLATFORM_RUNNER_DATA_DIR: service.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH,
				TREESEED_PLATFORM_RUNNER_ENVIRONMENT: normalizeScope(service.scope) === 'prod' ? 'production' : normalizeScope(service.scope),
				TREESEED_MANAGER_ID: normalizeScope(service.scope),
				...(configuredEnvValue(env, 'TREESEED_RAILWAY_API_TOKEN') ? { TREESEED_RAILWAY_API_TOKEN: configuredEnvValue(env, 'TREESEED_RAILWAY_API_TOKEN') } : {}),
				...(configuredEnvValue(env, 'TREESEED_RAILWAY_WORKSPACE') ? { TREESEED_RAILWAY_WORKSPACE: configuredEnvValue(env, 'TREESEED_RAILWAY_WORKSPACE') } : {}),
				...(configuredEnvValue(env, 'TREESEED_API_BASE_URL') || configuredEnvValue(env, 'TREESEED_URL') ? {
					TREESEED_API_BASE_URL: configuredEnvValue(env, 'TREESEED_API_BASE_URL') || configuredEnvValue(env, 'TREESEED_URL'),
				} : {}),
			} : {}),
			...(String(service.key).startsWith('capacityProvider') ? {
				TREESEED_PROVIDER_ENVIRONMENT: normalizeScope(service.scope) === 'prod' ? 'production' : normalizeScope(service.scope),
				TREESEED_MANAGER_ID: normalizeScope(service.scope),
				TREESEED_MARKET_ID: normalizeScope(service.scope),
					TREESEED_PROVIDER_ROLE: service.key === 'capacityProviderManager'
							? 'manager'
							: 'runner',
				...(service.key === 'capacityProviderRunner' ? {
					TREESEED_PROVIDER_DATA_DIR: service.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH,
					TREESEED_PROVIDER_RUNNER_ID: service.runnerId ?? railwayService.name,
				} : {}),
				...(configuredEnvValue(env, 'TREESEED_MARKET_URL') ? { TREESEED_MARKET_URL: configuredEnvValue(env, 'TREESEED_MARKET_URL') } : {}),
				...(configuredEnvValue(env, 'TREESEED_CAPACITY_PROVIDER_MANIFEST') ? { TREESEED_CAPACITY_PROVIDER_MANIFEST: configuredEnvValue(env, 'TREESEED_CAPACITY_PROVIDER_MANIFEST') } : {}),
				...(configuredEnvValue(env, 'TREESEED_CODEX_AUTH_JSON_B64') ? { TREESEED_CODEX_AUTH_JSON_B64: configuredEnvValue(env, 'TREESEED_CODEX_AUTH_JSON_B64') } : {}),
			} : {}),
		},
		env,
		fetchImpl,
	});
	const volumeMountPath = service.volumeMountPath ?? service.runnerPool?.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH;
	if (wantsRunnerVolume) {
		writeSyncPhase('volume', `Ensuring Railway volume mounted at ${volumeMountPath}.`);
	}
	const volumeConfiguration = wantsRunnerVolume
		? await ensureRailwayServiceVolume({
			projectId: project.id,
			environmentId: environment.id,
			serviceId: railwayService.id,
			name: service.key === 'operationsRunner'
				? deriveRailwayOperationsRunnerVolumeName(railwayService.name, environment.name)
				: service.key === 'capacityProviderRunner'
					? deriveRailwayCapacityProviderRunnerVolumeName(railwayService.name, environment.name)
				: deriveRailwayWorkerRunnerVolumeName(railwayService.name, environment.name),
			mountPath: volumeMountPath,
			env,
			fetchImpl,
		})
		: null;
	if (wantsRunnerVolume) {
		if (service.key === 'workerRunner') {
			writeSyncPhase('volume-vars', 'Upserting Railway worker volume variables.');
			await upsertRailwayVariables({
				projectId: project.id,
				environmentId: environment.id,
				serviceId: railwayService.id,
				variables: {
					TREESEED_RUNNER_SERVICE_NAME: railwayService.name,
					TREESEED_RUNNER_VOLUME_ROOT: volumeMountPath,
					TREESEED_RUNNER_VOLUME_NAME: volumeConfiguration?.volume.name ?? deriveRailwayWorkerRunnerVolumeName(railwayService.name, environment.name),
					TREESEED_WORKER_IDLE_EXIT_MS: configuredEnvValue(env, 'TREESEED_WORKER_IDLE_EXIT_MS') || '60000',
					...(volumeConfiguration?.volume.id ? { TREESEED_RUNNER_VOLUME_ID: volumeConfiguration.volume.id } : {}),
				},
				env,
				fetchImpl,
			});
		}
	}
	writeSyncPhase('done', 'Runtime configuration is synchronized.');
	return {
		projectId: project.id,
		projectName: project.name ?? service.projectName ?? null,
		environmentId: environment.id,
		environmentName: environment.name ?? environmentName,
		serviceId: railwayService.id,
		serviceName: railwayService.name ?? service.serviceName ?? null,
		instance: runtimeConfiguration?.instance ?? null,
		updated: Boolean(runtimeConfiguration?.updated || volumeConfiguration?.updated || volumeConfiguration?.created),
		volume: volumeConfiguration
			? {
				id: volumeConfiguration.volume.id,
				name: volumeConfiguration.volume.name,
				mountPath: volumeConfiguration.instance?.mountPath ?? volumeMountPath,
				created: volumeConfiguration.created,
				updated: volumeConfiguration.updated,
			}
			: null,
	};
}

export async function deployRailwayService(
	tenantRoot,
	service,
	{
		planOnly = false,
		write,
		prefix,
		env = process.env,
		fetchImpl = fetch,
	}: {
		planOnly?: boolean;
		write?: TreeseedBootstrapWriter;
		prefix?: TreeseedBootstrapTaskPrefix;
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
		fetchImpl?: typeof fetch;
	} = {},
) {
	const timings: TreeseedTimingEntry[] = [];
	if (planOnly) {
		return {
			service: service.key,
			status: 'planned',
			command: 'railway-cli service redeploy',
			cwd: service.rootDir,
			publicBaseUrl: service.publicBaseUrl,
			timings,
			transport: {
				railway: {
					reconcile: 'api',
					deploy: railwayDeployTransport(env),
				},
			},
		};
	}
	const deployService = await timedRailwayPhase(timings, 'railway:resolve-context', () => resolveRailwayDeployProjectContext(service, { env, fetchImpl }), {
		service: service.key,
	});
	const commandEnv = buildRailwayCommandEnv({ ...process.env, ...env });
	const deployTransport = railwayDeployTransport(commandEnv);

	const taskPrefix = prefix ?? {
		scope: normalizeScope(deployService.scope ?? deployService.railwayEnvironment ?? 'railway'),
		system: deployService.key === 'api' ? 'api' : 'agents',
		task: `${deployService.key}-railway-deploy`,
		stage: 'deploy',
	};
	const writePhase = (stage, message) => {
		write ? write(`[${taskPrefix.scope}][${taskPrefix.system}][${taskPrefix.task}][${stage}] ${message}`, 'stdout') : null;
	};
	writePhase('resolve-context', `Resolved Railway service ${deployService.serviceName ?? deployService.serviceId ?? deployService.key}.`);
	writePhase('sync-runtime-config', 'Syncing Railway runtime configuration.');
	const runtimeConfiguration = await timedRailwayPhase(timings, 'railway:sync-runtime-config', () => withRailwayPhaseTimeout(
		() => syncRailwayServiceRuntimeConfigurationAfterDeploy(tenantRoot, deployService, { env: commandEnv, writePhase, fetchImpl }),
		railwayPhaseTimeoutMs(commandEnv, 'sync_runtime_config'),
		`Railway runtime configuration sync timed out for ${deployService.serviceName ?? deployService.key}.`,
	), { service: deployService.key });
	const cliDeployService = {
		...deployService,
		projectId: runtimeConfiguration?.projectId ?? deployService.projectId,
		projectName: runtimeConfiguration?.projectName ?? deployService.projectName,
		environmentId: runtimeConfiguration?.environmentId ?? deployService.environmentId,
		serviceId: runtimeConfiguration?.serviceId ?? deployService.serviceId,
		serviceName: runtimeConfiguration?.serviceName ?? deployService.serviceName,
		railwayEnvironment: runtimeConfiguration?.environmentName ?? runtimeConfiguration?.environmentId ?? deployService.railwayEnvironment,
	};
	writePhase('device-login-vars', 'Syncing Railway device-login variables.');
	await timedRailwayPhase(timings, 'railway:device-login-vars', () => withRailwayPhaseTimeout(
		() => syncRailwayApiDeviceLoginVariables(cliDeployService, commandEnv, write, taskPrefix, fetchImpl),
		railwayPhaseTimeoutMs(commandEnv, 'device_login_vars'),
		`Railway device-login variable sync timed out for ${cliDeployService.serviceName ?? cliDeployService.key}.`,
	), {
		service: cliDeployService.key,
	});
		if (deployService.buildCommand && !deployService.imageRef && shouldRunRailwayPredeployBuild(commandEnv)) {
		const buildResult = await timedRailwayPhase(timings, 'railway:predeploy-build', () => runPrefixedCommand('bash', ['-lc', deployService.buildCommand], {
			cwd: deployService.rootDir,
			env: commandEnv,
			write,
			prefix: { ...taskPrefix, stage: 'build' },
		}), { service: deployService.key });
		if (buildResult.status !== 0) {
			throw new Error(`Railway ${deployService.key} build command failed.`);
		}
	}
	if (deployTransport !== 'cli-fallback') {
		writePhase('deploy', `Deploying Railway service ${cliDeployService.serviceName ?? cliDeployService.serviceId ?? cliDeployService.key} through the managed Railway CLI.`);
		const apiDeploy = await timedRailwayPhase(timings, 'railway:api-deploy', () => withRailwayPhaseTimeout(
			() => deployRailwayServiceInstance({
				projectId: cliDeployService.projectId,
				serviceId: cliDeployService.serviceId,
				environmentId: cliDeployService.environmentId,
				env: commandEnv,
				fetchImpl,
			}),
			railwayPhaseTimeoutMs(commandEnv, 'deploy'),
			`Railway API deploy phase timed out for ${cliDeployService.serviceName ?? cliDeployService.key}.`,
		), { service: cliDeployService.key });
		return {
			service: deployService.key,
			status: 'deployed',
			command: 'railway-cli service redeploy',
			cwd: deployService.rootDir,
			publicBaseUrl: deployService.publicBaseUrl,
			timings,
			deploymentId: apiDeploy.deploymentId,
			transport: {
				railway: {
					reconcile: 'api',
					deploy: 'api',
				},
			},
			runtimeConfiguration: runtimeConfiguration
				? {
					updated: runtimeConfiguration.updated,
					healthcheckPath: runtimeConfiguration.instance?.healthcheckPath ?? null,
					healthcheckTimeoutSeconds: runtimeConfiguration.instance?.healthcheckTimeoutSeconds ?? null,
					runtimeMode: runtimeConfiguration.instance?.runtimeMode ?? null,
					volume: runtimeConfiguration.volume ?? null,
				}
				: null,
		};
	}
	throw new Error(`Railway deployment for ${cliDeployService.serviceName ?? cliDeployService.serviceId ?? cliDeployService.key} requires Railway API deployment support. CLI deploy fallback has been removed.`);
}
