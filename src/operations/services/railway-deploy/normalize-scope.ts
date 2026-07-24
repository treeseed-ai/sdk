import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadCliDeployConfig } from '../agents/runtime-tools.ts';
import { resolveMachineEnvironmentValues } from '../configuration/config-runtime.ts';
import { createPersistentDeployTarget, resolveResourceIdentity } from '../hosting/deployment/deploy.ts';
import { classifyGitMode, runGitText } from '../operations/git-runner.ts';
import { discoverApplications } from '../../../hosting/apps.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from '../hosting/railway/railway-source-policy.ts';
import { runPrefixedCommand, sleep, type BootstrapTaskPrefix, type BootstrapWriter } from '../operations/bootstrap-runner.ts';
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
} from '../hosting/railway/railway-api.ts';
import { elapsedMs, formatDurationMs, type TimingEntry } from '../../../entrypoints/runtime/timing.ts';


export function normalizeScope(scope) {
	return scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
}

export function resolveRailwayEnvironmentForScope(scope, configuredEnvironment) {
	return normalizeRailwayEnvironmentName(configuredEnvironment || normalizeScope(scope));
}

export const RAILWAY_SERVICE_KEYS = ['api', 'operationsRunner', 'capacityProviderManager', 'capacityProviderRunner'];

export const HOSTED_PROJECT_SERVICE_KEYS = ['api'];

export const WORKER_RUNNER_BOOTSTRAP_INDEX = 1;

export const WORKER_RUNNER_VOLUME_MOUNT_PATH = '/data';

export const OPERATIONS_RUNNER_BOOTSTRAP_COUNT = 2;

export const PUBLIC_TREEDX_NODE_SERVICE_KEY_PREFIX = 'public-treedx-node-';

export function isOperationsRunnerResourceName(value) {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized) {
		return false;
	}
	if (normalized.startsWith('market-ops')) {
		return true;
	}
	return normalized.includes('operations-runner');
}

export function findStaleOperationsRunnerResources(resources, desiredNames) {
	const desired = new Set([...desiredNames].map((value) => String(value ?? '').trim()).filter(Boolean));
	return resources.filter((resource) => {
		const name = String(resource?.name ?? '').trim();
		return name && isOperationsRunnerResourceName(name) && !desired.has(name);
	});
}

export function shouldManageRailwaySchedules(scope, phase = 'deploy') {
	const environment = normalizeRailwayEnvironmentName(scope);
	return phase === 'deploy' && (environment === 'staging' || environment === 'production');
}

export function railwayServiceNameSuffix(serviceKey) {
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

export function railwayImageRefEnvForService(serviceKey) {
	if (serviceKey === 'api') return 'TREESEED_API_IMAGE_REF';
	if (serviceKey === 'operationsRunner') return 'TREESEED_OPERATIONS_RUNNER_IMAGE_REF';
	if (serviceKey === 'capacityProviderManager') return 'TREESEED_AGENT_MANAGER_IMAGE_REF';
	if (serviceKey === 'capacityProviderRunner') return 'TREESEED_AGENT_RUNNER_IMAGE_REF';
	if (isPublicTreeDxNodeServiceKey(serviceKey)) return 'TREESEED_PUBLIC_TREEDX_IMAGE_REF';
	return null;
}

export function defaultRailwayImageRef(serviceKey, scope = 'staging', env = process.env) {
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

export function isPublicTreeDxNodeServiceKey(serviceKey) {
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

export function normalizeScheduleExpressions(value) {
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

export function envValue(name, env = process.env) {
	const value = env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function relativeRailwayRootDir(tenantRoot, serviceRoot) {
	const resolved = relative(tenantRoot, serviceRoot).replace(/\\/gu, '/');
	return !resolved || resolved === '' ? '.' : resolved;
}

export function configuredEnvValue(env, name) {
	const value = env?.[name];
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function configuredApiPublicBaseUrl(deployConfig, scope) {
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

export function railwayDeployTransport(env) {
	const configured = configuredEnvValue(env, 'TREESEED_RAILWAY_DEPLOY_TRANSPORT').toLowerCase();
	return configured === 'cli-fallback' ? 'cli-fallback' : 'api';
}

export async function timedRailwayPhase<T>(
	timings: TimingEntry[],
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

export function railwayEdgeNodes(value) {
	return Array.isArray(value?.edges)
		? value.edges.map((entry) => entry?.node).filter(Boolean)
		: [];
}

export function railwayStatusEnvironmentNodes(payload) {
	if (!payload || typeof payload !== 'object') {
		return [];
	}
	if (Array.isArray(payload.environments)) {
		return payload.environments;
	}
	return railwayEdgeNodes(payload.environments);
}

export function railwayStatusDeploymentSettled(status) {
	const normalized = String(status ?? '').trim().toUpperCase();
	return normalized === 'SUCCESS' || normalized === 'SLEEPING';
}
