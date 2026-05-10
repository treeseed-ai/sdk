import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCliDeployConfig } from './runtime-tools.ts';
import { createPersistentDeployTarget, resolveTreeseedResourceIdentity } from './deploy.ts';
import { runPrefixedCommand, sleep, type TreeseedBootstrapTaskPrefix, type TreeseedBootstrapWriter } from './bootstrap-runner.ts';
import { resolveTreeseedToolCommand } from '../../managed-dependencies.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	ensureRailwayServiceVolume,
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

function normalizeScope(scope) {
	return scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
}

function resolveRailwayEnvironmentForScope(scope, configuredEnvironment) {
	return normalizeRailwayEnvironmentName(configuredEnvironment || normalizeScope(scope));
}
const RAILWAY_SERVICE_KEYS = ['api', 'workdayManager', 'workerRunner'];
const HOSTED_PROJECT_SERVICE_KEYS = ['api', 'workdayManager', 'workerRunner'];
const WORKER_RUNNER_BOOTSTRAP_INDEX = 1;
const WORKER_RUNNER_VOLUME_MOUNT_PATH = '/data';

function shouldManageRailwaySchedules(scope, phase = 'deploy') {
	const environment = normalizeRailwayEnvironmentName(scope);
	return phase === 'deploy' && (environment === 'staging' || environment === 'production');
}

function railwayServiceNameSuffix(serviceKey) {
	return serviceKey === 'workdayManager'
		? 'workday-manager'
		: serviceKey === 'workerRunner'
			? 'worker-runner'
			: serviceKey;
}

export function deriveRailwayWorkerRunnerServiceName(projectSlug, index = WORKER_RUNNER_BOOTSTRAP_INDEX) {
	const normalizedIndex = Math.max(1, Number.parseInt(String(index), 10) || WORKER_RUNNER_BOOTSTRAP_INDEX);
	return `${projectSlug}-worker-runner-${String(normalizedIndex).padStart(2, '0')}`;
}

export function deriveRailwayWorkerRunnerVolumeName(serviceName, environmentName = '') {
	const environment = normalizeRailwayEnvironmentName(environmentName);
	const environmentSuffix = environment && environment !== 'production' ? `-${environment}` : '';
	return `${serviceName}${environmentSuffix}-data`;
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

function envValue(name) {
	const value = process.env[name];
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

function parseRailwayJsonOutput(output) {
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
		const status = String(deployment?.status ?? '').trim().toUpperCase();
		const instanceStatuses = Array.isArray(deployment?.instances)
			? deployment.instances.map((entry) => String(entry?.status ?? '').trim()).filter(Boolean)
			: [];
		const ok = railwayStatusDeploymentSettled(status);
		return {
			type: 'deployment-status',
			service: service.key,
			serviceName: service.serviceName,
			environment: normalizeRailwayEnvironmentName(environment.name),
			ok,
			status: status || 'missing_deployment',
			observed: {
				status: status || null,
				deploymentStopped: deployment?.deploymentStopped ?? null,
				instanceStatuses,
				volumeMounts: Array.isArray(deployment?.meta?.volumeMounts) ? deployment.meta.volumeMounts : [],
			},
			message: ok
				? undefined
				: `Railway deployment for ${service.serviceName} is not settled yet; observed ${status || 'missing deployment status'}.`,
		};
	});
}

function normalizeRailwayCliVolume(value, { serviceId, environmentId, fallbackName, fallbackMountPath }) {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const record = value;
	const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : '';
	if (!id) {
		return null;
	}
	const name = typeof record.name === 'string' && record.name.trim() ? record.name.trim() : fallbackName;
	const mountPath = typeof record.mountPath === 'string' && record.mountPath.trim() ? record.mountPath.trim() : fallbackMountPath;
	const sizeMb = typeof record.sizeMB === 'number' ? record.sizeMB : null;
	const currentSizeMb = typeof record.currentSizeMB === 'number' ? record.currentSizeMB : null;
	return {
		id,
		name,
		projectId: null,
		instances: [{
			id,
			serviceId,
			environmentId,
			mountPath,
			sizeGb: sizeMb === null ? null : sizeMb / 1000,
			usedGb: currentSizeMb === null ? null : currentSizeMb / 1000,
		}],
	};
}

function normalizeRailwayCliVolumeList(value, options) {
	if (!value || typeof value !== 'object' || !Array.isArray(value.volumes)) {
		return [];
	}
	return value.volumes
		.map((entry) => normalizeRailwayCliVolume(entry, options))
		.filter(Boolean);
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
	if (token) {
		merged.RAILWAY_API_TOKEN = token;
		merged.RAILWAY_TOKEN = token;
	} else {
		delete merged.RAILWAY_API_TOKEN;
		delete merged.RAILWAY_TOKEN;
	}
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

function normalizeRailwayProjectList(payload) {
	try {
		const parsed = JSON.parse(payload);
		if (!Array.isArray(parsed)) {
			return [];
		}
		return parsed
			.map((entry) => {
				if (!entry || typeof entry !== 'object') {
					return null;
				}
				const id = typeof entry.id === 'string' ? entry.id.trim() : '';
				const name = typeof entry.name === 'string' ? entry.name.trim() : '';
				if (!id && !name) {
					return null;
				}
				return { id, name };
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

function railwayMessage(result) {
	return `${result?.stderr ?? ''}\n${result?.stdout ?? ''}`.trim();
}

function isRailwayAlreadyExistsMessage(result) {
	return /already exists|already taken|duplicate|has already been taken/iu.test(railwayMessage(result));
}

export function isRailwayTransientFailure(result) {
	return /timed out|failed to fetch|temporarily unavailable|econnreset|etimedout|failed to stream build logs|failed to retrieve build log/iu.test(railwayMessage(result));
}

function sleepSync(milliseconds) {
	if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
		return;
	}
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function isRailwayScheduleCapabilityError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /cronTriggers|cronTriggerCreate|cronTriggerUpdate/iu.test(message);
}

function defaultRailwayScheduleQueries() {
	return {
		listQuery: envValue('TREESEED_RAILWAY_SCHEDULE_LIST_QUERY') || `
query TreeseedScheduleList($serviceId: String!, $environmentId: String!, $projectId: String) {
	service(id: $serviceId) {
		id
		name
		cronTriggers {
			edges {
				node {
					id
					name
					schedule
					command
					enabled
					service { id name }
					environment { id name }
				}
			}
		}
	}
}
`.trim(),
		createMutation: envValue('TREESEED_RAILWAY_SCHEDULE_CREATE_MUTATION') || `
mutation TreeseedScheduleCreate($serviceId: String!, $environmentId: String!, $name: String!, $schedule: String!, $command: String!, $enabled: Boolean!) {
	cronTriggerCreate(
		input: {
			serviceId: $serviceId
			environmentId: $environmentId
			name: $name
			schedule: $schedule
			command: $command
			enabled: $enabled
		}
	) {
		id
		name
		schedule
		command
		enabled
		service { id name }
		environment { id name }
	}
}
`.trim(),
		updateMutation: envValue('TREESEED_RAILWAY_SCHEDULE_UPDATE_MUTATION') || `
mutation TreeseedScheduleUpdate($id: String!, $name: String!, $schedule: String!, $command: String!, $enabled: Boolean!) {
	cronTriggerUpdate(
		id: $id
		input: {
			name: $name
			schedule: $schedule
			command: $command
			enabled: $enabled
		}
	) {
		id
		name
		schedule
		command
		enabled
		service { id name }
		environment { id name }
	}
}
`.trim(),
	};
}

export function runRailway(args, { cwd, capture = false, allowFailure = false, input, env } = {}) {
	const effectiveEnv = buildRailwayCommandEnv({ ...process.env, ...(env ?? {}) });
	const railway = resolveTreeseedToolCommand('railway', { env: effectiveEnv });
	if (!railway) {
		throw new Error('Railway CLI is unavailable.');
	}
	const runWithEnv = (spawnEnv) => spawnSync(railway.command, [...railway.argsPrefix, ...args], {
		cwd,
		stdio: input !== undefined ? ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'] : (capture ? 'pipe' : 'inherit'),
		encoding: 'utf8',
		env: spawnEnv,
		input,
	});
	const result = runWithEnv(effectiveEnv);

	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `railway ${args.join(' ')} failed`);
	}

	return result;
}

export async function waitForRailwayManagedDeploymentsSettled(
	tenantRoot,
	scope,
	{
		services = configuredRailwayServices(tenantRoot, scope),
		env = process.env,
		timeoutMs = 600_000,
		pollMs = 15_000,
		onProgress,
	} = {},
) {
	const deadline = Date.now() + timeoutMs;
	const projectId = services.find((service) => typeof service.projectId === 'string' && service.projectId.trim())?.projectId ?? null;
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
				message: `Railway deployment status for ${service.serviceName} cannot be checked without a project id.`,
			})),
		};
	}
	let checks = [];
	let lastError = null;
	let lastSummary = '';
	for (;;) {
		lastError = null;
		try {
			const statusPayload = await fetchRailwayProjectDeploymentStatus({
				projectId,
				env,
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
				message: error instanceof Error ? error.message : String(error),
			}));
		}
		const summary = formatRailwayDeploymentStatusSummary(scope, checks);
		if (summary !== lastSummary || !checks.every((entry) => entry.ok === true)) {
			onProgress?.(summary, 'stdout');
			lastSummary = summary;
		}
		if (checks.every((entry) => entry.ok === true)) {
			return { ok: true, checks };
		}
		if (Date.now() >= deadline) {
			return {
				ok: false,
				checks,
				message: lastError instanceof Error
					? lastError.message
					: 'Railway deployments did not settle before the monitor timeout.',
			};
		}
		await sleep(pollMs);
	}
}

async function fetchRailwayProjectDeploymentStatus({ projectId, env = process.env }) {
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
	});
	return payload.data?.project ?? null;
}

export function setRailwaySecretVariable(
	{ cwd, service, environment, key, value, env = process.env, capture = false, allowFailure = false },
) {
	const effectiveEnv = buildRailwayCommandEnv({
		...process.env,
		...(env ?? {}),
	});
	let result = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		const railway = resolveTreeseedToolCommand('railway', { env: effectiveEnv });
		if (!railway) {
			throw new Error('Railway CLI is unavailable.');
		}
		result = spawnSync(railway.command, [
			...railway.argsPrefix,
			'variable',
			'set',
			'--service',
			service,
			'--environment',
			environment,
			'--stdin',
			'--skip-deploys',
			key,
		], {
			cwd,
			stdio: ['pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'],
			encoding: 'utf8',
			env: effectiveEnv,
			input: `${value}\n`,
		});
		if (result.status === 0) {
			return result;
		}
		if (!isRailwayTransientFailure(result)) {
			break;
		}
	}
	if (result?.status !== 0 && !allowFailure) {
		throw new Error(result?.stderr?.trim() || result?.stdout?.trim() || `railway variable set --stdin ${key} failed`);
	}
	return result;
}

export function ensureRailwayProjectExists(
	service,
	{ env = process.env } = {},
) {
	const projectName = typeof service?.projectName === 'string' ? service.projectName.trim() : '';
	if (!projectName) {
		throw new Error(`Railway service ${service?.key ?? service?.serviceName ?? service?.serviceId ?? '(unknown)'} is missing a projectName.`);
	}
	const listed = runRailway(['list', '--json'], {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (listed.status === 0) {
		const match = normalizeRailwayProjectList(listed.stdout ?? '')
			.find((entry) => entry.name === projectName || entry.id === projectName);
		if (match) {
			return match;
		}
	}
	const args = ['init', '--name', projectName, '--json'];
	const workspace = resolveRailwayWorkspace(env);
	if (workspace) {
		args.push('--workspace', workspace);
	}
	const created = runRailway(args, {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (created.status !== 0 && !isRailwayAlreadyExistsMessage(created)) {
		throw new Error(railwayMessage(created) || `railway ${args.join(' ')} failed`);
	}
	return null;
}

export function ensureRailwayEnvironmentExists(
	service,
	{ env = process.env } = {},
) {
	const environmentName = normalizeRailwayEnvironmentName(service?.railwayEnvironment);
	if (!environmentName) {
		return null;
	}
	const linkResult = runRailway(['environment', 'link', environmentName, '--json'], {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (linkResult.status === 0) {
		return linkResult;
	}
	const createResult = runRailway(['environment', 'new', environmentName, '--json'], {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (createResult.status !== 0 && !isRailwayAlreadyExistsMessage(createResult)) {
		throw new Error(railwayMessage(createResult) || `railway environment new ${environmentName} failed`);
	}
	const relinkResult = runRailway(['environment', 'link', environmentName, '--json'], {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (relinkResult.status !== 0) {
		throw new Error(railwayMessage(relinkResult) || `railway environment link ${environmentName} failed`);
	}
	return relinkResult;
}

export function ensureRailwayServiceExists(
	service,
	{ env = process.env } = {},
) {
	const serviceSelector = typeof (service?.serviceName ?? service?.serviceId) === 'string'
		? String(service.serviceName ?? service.serviceId).trim()
		: '';
	if (!serviceSelector) {
		throw new Error(`Railway service ${service?.key ?? '(unknown)'} is missing a service selector.`);
	}
	const statusArgs = ['service', 'status', '--service', serviceSelector, '--environment', service.railwayEnvironment, '--json'];
	const statusResult = runRailway(statusArgs, {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (statusResult.status === 0) {
		return statusResult;
	}
	const createResult = runRailway(['add', '--service', serviceSelector, '--json'], {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (createResult.status !== 0 && !isRailwayAlreadyExistsMessage(createResult)) {
		throw new Error(railwayMessage(createResult) || `railway add --service ${serviceSelector} failed`);
	}
	const refreshed = runRailway(statusArgs, {
		cwd: service.rootDir,
		capture: true,
		allowFailure: true,
		env,
	});
	if (refreshed.status !== 0) {
		throw new Error(railwayMessage(refreshed) || `railway service status --service ${serviceSelector} failed`);
	}
	return refreshed;
}

export function ensureRailwayProjectContext(
	service,
	{ env = process.env, allowFailure = false, capture = false } = {},
) {
	ensureRailwayProjectExists(service, { env });
	let projectSelector = service?.projectId ?? '';
	if ((!projectSelector || !String(projectSelector).trim()) && service?.projectName) {
		const listed = runRailway(['list', '--json'], {
			cwd: service.rootDir,
			capture: true,
			allowFailure: true,
			env,
		});
		if (listed.status === 0) {
			const match = normalizeRailwayProjectList(listed.stdout ?? '')
				.find((entry) => entry.name === service.projectName || entry.id === service.projectName);
			projectSelector = match?.id || match?.name || service.projectName;
		} else {
			projectSelector = service.projectName;
		}
	}
	projectSelector = typeof projectSelector === 'string' ? projectSelector.trim() : '';
	if (typeof projectSelector !== 'string' || projectSelector.trim().length === 0) {
		throw new Error(`Railway service ${service?.key ?? service?.serviceName ?? service?.serviceId ?? '(unknown)'} is missing a project selector.`);
	}
	const args = ['link', '--project', projectSelector];
	const workspace = resolveRailwayWorkspace(env);
	if (workspace) {
		args.push('--workspace', workspace);
	}
	const environmentName = normalizeRailwayEnvironmentName(service?.railwayEnvironment);
	if (environmentName) {
		args.push('--environment', environmentName);
	}
	runRailway(args, {
		cwd: service.rootDir,
		capture,
		allowFailure,
		env,
	});
	if (environmentName) {
		ensureRailwayEnvironmentExists(service, { env });
		return runRailway(['environment', 'link', environmentName, '--json'], {
			cwd: service.rootDir,
			capture,
			allowFailure,
			env,
		});
	}
	return null;
}

export function configuredRailwayServices(tenantRoot, scope) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const normalizedScope = normalizeScope(scope);
	const identity = resolveTreeseedResourceIdentity(deployConfig, createPersistentDeployTarget(normalizedScope));
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

	return serviceKeys
		.map((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return null;
			}

			const defaultRootDir = ['api', 'workdayManager', 'workerRunner'].includes(serviceKey) ? '.' : 'packages/core';
			const serviceRoot = resolve(tenantRoot, service.railway?.rootDir ?? service.rootDir ?? defaultRootDir);
			const railwayEnvironment = resolveRailwayEnvironmentForScope(
				normalizedScope,
				service.environments?.[normalizedScope]?.railwayEnvironment,
			);
			const publicBaseUrl = service.environments?.[normalizedScope]?.baseUrl ?? service.publicBaseUrl ?? null;
			return {
				key: serviceKey,
				scope: normalizedScope,
				projectId: service.railway?.projectId ?? null,
				projectName: service.railway?.projectName ?? identity.deploymentKey,
				serviceId: service.railway?.serviceId ?? null,
				serviceName: service.railway?.serviceName
					?? (serviceKey === 'workerRunner'
						? deriveRailwayWorkerRunnerServiceName(identity.deploymentKey)
						: `${identity.deploymentKey}-${railwayServiceNameSuffix(serviceKey)}`),
				rootDir: serviceRoot,
				publicBaseUrl,
				railwayEnvironment,
				buildCommand: service.railway?.buildCommand ?? null,
				startCommand: service.railway?.startCommand ?? null,
				healthcheckPath: service.railway?.healthcheckPath ?? null,
				healthcheckTimeoutSeconds: service.railway?.healthcheckTimeoutSeconds ?? null,
				healthcheckIntervalSeconds: service.railway?.healthcheckIntervalSeconds ?? null,
				restartPolicy: service.railway?.restartPolicy ?? null,
				runtimeMode: service.railway?.runtimeMode ?? null,
				schedule: normalizeScheduleExpressions(service.railway?.schedule),
				hostingKind,
				runnerPool: serviceKey === 'workerRunner'
					? {
						bootstrapIndex: WORKER_RUNNER_BOOTSTRAP_INDEX,
						volumeMountPath: WORKER_RUNNER_VOLUME_MOUNT_PATH,
					}
					: null,
			};
		})
		.filter(Boolean);
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
		if (!existsSync(service.rootDir)) {
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
		throw new Error('Configure RAILWAY_API_TOKEN before deploying Railway-managed services.');
	}
	return validation;
}

export async function ensureRailwayScheduledJobs(
	tenantRoot,
	scope,
	{ dryRun = false, fetchImpl = fetch, apiToken, apiUrl, env = process.env } = {},
) {
	const { schedules } = validateRailwayServiceConfiguration(tenantRoot, scope);
	if (schedules.length === 0) {
		return [];
	}
	const effectiveApiToken = apiToken || resolveRailwayAuthToken(env);
	const effectiveApiUrl = apiUrl || resolveRailwayApiUrl(env);
	if (typeof effectiveApiToken !== 'string' || effectiveApiToken.trim().length === 0) {
		throw new Error('Configure RAILWAY_API_TOKEN before deploying Railway-managed services.');
	}
	const results = [];

	try {
		for (const schedule of schedules) {
			const target = await resolveRailwayScheduleTarget(schedule, {
				env,
				fetchImpl,
				ensure: !dryRun,
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
				env: { ...env, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl },
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
			if (dryRun) {
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
				env: { ...env, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl },
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
	const effectiveApiToken = apiToken || env?.RAILWAY_API_TOKEN;
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
				env: { ...env, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl },
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
	const effectiveEnv = { ...env, RAILWAY_API_TOKEN: effectiveApiToken, TREESEED_RAILWAY_API_URL: effectiveApiUrl };
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
		if (service.key === 'workerRunner') {
			const expectedVolumeName = deriveRailwayWorkerRunnerVolumeName(target.service.name, target.environment.name);
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
					&& entry.mountPath === WORKER_RUNNER_VOLUME_MOUNT_PATH),
			) ?? null;
			checks.push({
				type: 'worker-runner-volume',
				service: service.key,
				serviceName: target.service.name,
				serviceId: target.service.id,
				projectId: target.project.id,
				environment: target.environment.name,
				environmentId: target.environment.id,
				volumeName: expectedVolumeName,
				mountPath: WORKER_RUNNER_VOLUME_MOUNT_PATH,
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
					: `Railway worker-runner volume ${expectedVolumeName} is missing or is not mounted at ${WORKER_RUNNER_VOLUME_MOUNT_PATH}.`,
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

function shouldAttachRailwayDeployLogs(env = process.env) {
	const configured = configuredEnvValue(env, 'TREESEED_RAILWAY_DEPLOY_ATTACH_LOGS');
	if (configured === '1' || configured === 'true') {
		return true;
	}
	if (configured === '0' || configured === 'false') {
		return false;
	}
	return configuredEnvValue(env, 'CI') === 'true';
}

function shouldUseVerboseRailwayDeploy(env = process.env) {
	const configured = configuredEnvValue(env, 'TREESEED_RAILWAY_DEPLOY_VERBOSE');
	if (configured === '1' || configured === 'true') {
		return true;
	}
	if (configured === '0' || configured === 'false') {
		return false;
	}
	return shouldAttachRailwayDeployLogs(env);
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

export function planRailwayServiceDeploy(service, { env = process.env } = {}) {
	const args = [
		'up',
		'--service',
		service.serviceName ?? service.serviceId,
		shouldAttachRailwayDeployLogs(env) ? '--ci' : '--detach',
	];
	if (shouldUseVerboseRailwayDeploy(env)) {
		args.push('--verbose');
	}
	if (service.projectId) {
		args.push('--project', service.projectId);
	}
	const environmentName = normalizeRailwayEnvironmentName(service.railwayEnvironment);
	if (environmentName) {
		args.push('--environment', environmentName);
	}
	return {
		command: 'railway',
		args,
		cwd: service.rootDir,
	};
}

async function resolveRailwayDeployProjectContext(service, { env = process.env } = {}) {
	if (service.projectId) {
		return service;
	}
	const workspace = await resolveRailwayWorkspaceContext({ env });
	const { project } = await ensureRailwayProject({
		projectId: service.projectId,
		projectName: service.projectName,
		defaultEnvironmentName: service.railwayEnvironment,
		env,
		workspace: workspace.id,
	});
	return {
		...service,
		projectId: project.id,
		projectName: project.name ?? service.projectName,
	};
}

async function syncRailwayServiceRuntimeConfigurationAfterDeploy(tenantRoot, service, { env = process.env } = {}) {
	const wantsInstanceConfig = service.buildCommand
		|| service.startCommand
		|| service.rootDir
		|| service.healthcheckPath
		|| service.healthcheckTimeoutSeconds !== null
		|| service.healthcheckTimeoutSeconds !== undefined
		|| service.healthcheckIntervalSeconds !== null
		|| service.healthcheckIntervalSeconds !== undefined
		|| service.restartPolicy
		|| service.runtimeMode;
	const wantsRunnerVolume = service.key === 'workerRunner';
	if (!wantsInstanceConfig && !wantsRunnerVolume) {
		return null;
	}

	const workspace = await resolveRailwayWorkspaceContext({ env });
	let project = null;
	if (service.projectId) {
		project = await ensureRailwayProject({
			projectId: service.projectId,
			projectName: service.projectName,
			defaultEnvironmentName: service.railwayEnvironment,
			env,
			workspace: workspace.id,
		}).then((result) => result.project);
	} else {
		const projects = await listRailwayProjects({ env, workspaceId: workspace.id });
		project = projects.find((entry) => entry.name === service.projectName) ?? null;
		if (!project) {
			project = await ensureRailwayProject({
				projectName: service.projectName,
				defaultEnvironmentName: service.railwayEnvironment,
				env,
				workspace: workspace.id,
			}).then((result) => result.project);
		}
	}

	const environmentName = normalizeRailwayEnvironmentName(service.railwayEnvironment);
	let environment = project.environments.find((entry) => entry.name === environmentName || entry.id === environmentName) ?? null;
	if (!environment) {
		environment = await ensureRailwayEnvironment({
			projectId: project.id,
			environmentName,
			env,
		}).then((result) => result.environment);
	}

	let railwayService = project.services.find((entry) => entry.id === service.serviceId || entry.name === service.serviceName) ?? null;
	if (!railwayService) {
		railwayService = await ensureRailwayService({
			projectId: project.id,
			serviceId: service.serviceId,
			serviceName: service.serviceName,
			env,
		}).then((result) => result.service);
	}

	const runtimeConfiguration = wantsInstanceConfig
		? await ensureRailwayServiceInstanceConfiguration({
			serviceId: railwayService.id,
			environmentId: environment.id,
			buildCommand: service.buildCommand,
			startCommand: railwayServiceRuntimeStartCommand(service),
			cronSchedule: service.schedule?.[0] ?? null,
			rootDirectory: relativeRailwayRootDir(tenantRoot, service.rootDir),
			healthcheckPath: service.healthcheckPath,
			healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
			healthcheckIntervalSeconds: service.healthcheckIntervalSeconds,
			restartPolicy: service.restartPolicy,
			runtimeMode: service.runtimeMode,
			env,
		})
		: null;
	await upsertRailwayVariables({
		projectId: project.id,
		environmentId: environment.id,
		serviceId: railwayService.id,
		variables: {
			TREESEED_SKIP_PACKAGE_PREPARE: '1',
		},
		env,
	});
	const volumeMountPath = service.runnerPool?.volumeMountPath ?? WORKER_RUNNER_VOLUME_MOUNT_PATH;
	const volumeConfiguration = wantsRunnerVolume
		? await ensureRailwayServiceVolumeWithCliFallback({
			tenantRoot,
			projectId: project.id,
			environmentId: environment.id,
			environmentName: environment.name,
			serviceId: railwayService.id,
			serviceName: railwayService.name,
			name: deriveRailwayWorkerRunnerVolumeName(railwayService.name, environment.name),
			mountPath: volumeMountPath,
			env,
		})
		: null;
	if (wantsRunnerVolume) {
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
		});
	}
	return {
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

async function ensureRailwayServiceVolumeWithCliFallback({
	tenantRoot,
	projectId,
	environmentId,
	environmentName,
	serviceId,
	serviceName,
	name,
	mountPath,
	env = process.env,
}) {
	try {
		return await ensureRailwayServiceVolume({
			projectId,
			environmentId,
			serviceId,
			name,
			mountPath,
			env,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (!message.includes('Problem processing request')) {
			throw error;
		}
	}

	const cliOptions = {
		cwd: tenantRoot,
		capture: true,
		env,
	};
	const volumeArgs = ['volume', '--service', serviceId, '--environment', environmentId];
	const listResult = runRailway([...volumeArgs, 'list', '--json'], cliOptions);
	const existingVolumes = normalizeRailwayCliVolumeList(parseRailwayJsonOutput(listResult.stdout ?? ''), {
		serviceId,
		environmentId,
		fallbackName: name,
		fallbackMountPath: mountPath,
	});
	let volume = existingVolumes.find((entry) => entry.name === name)
		?? existingVolumes.find((entry) => entry.instances.some((instance) => instance.mountPath === mountPath))
		?? existingVolumes[0]
		?? null;
	let created = false;
	let updated = false;

	if (!volume) {
		const createResult = runRailway([...volumeArgs, 'add', '--mount-path', mountPath, '--json'], cliOptions);
		volume = normalizeRailwayCliVolume(parseRailwayJsonOutput(createResult.stdout ?? ''), {
			serviceId,
			environmentId,
			fallbackName: name,
			fallbackMountPath: mountPath,
		});
		if (!volume) {
			throw new Error(`Railway CLI volume add did not return a usable volume for ${serviceName} in ${environmentName}.`);
		}
		created = true;
	}

	const instance = volume.instances.find((entry) => entry.serviceId === serviceId && entry.environmentId === environmentId) ?? volume.instances[0] ?? null;
	if (volume.name !== name || instance?.mountPath !== mountPath) {
		const updateResult = runRailway([...volumeArgs, 'update', '--volume', volume.id, '--name', name, '--mount-path', mountPath, '--json'], cliOptions);
		const updatedVolume = normalizeRailwayCliVolume(parseRailwayJsonOutput(updateResult.stdout ?? ''), {
			serviceId,
			environmentId,
			fallbackName: name,
			fallbackMountPath: mountPath,
		});
		volume = updatedVolume ?? {
			...volume,
			name,
			instances: volume.instances.map((entry) => ({ ...entry, mountPath })),
		};
		updated = true;
	}

	return {
		volume,
		instance: volume.instances.find((entry) => entry.serviceId === serviceId && entry.environmentId === environmentId) ?? volume.instances[0] ?? null,
		created,
		updated,
	};
}

export async function deployRailwayService(
	tenantRoot,
	service,
	{
		dryRun = false,
		write,
		prefix,
		env = process.env,
	}: {
		dryRun?: boolean;
		write?: TreeseedBootstrapWriter;
		prefix?: TreeseedBootstrapTaskPrefix;
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	} = {},
) {
	if (dryRun) {
		const plan = planRailwayServiceDeploy(service, { env });
		return {
			service: service.key,
			status: 'planned',
			command: [plan.command, ...plan.args].join(' '),
			cwd: plan.cwd,
			publicBaseUrl: service.publicBaseUrl,
		};
	}
	const deployService = await resolveRailwayDeployProjectContext(service, { env });
	const plan = planRailwayServiceDeploy(deployService, { env });
	const commandEnv = buildRailwayCommandEnv({ ...process.env, ...env });
	const railway = resolveTreeseedToolCommand('railway', { env: commandEnv });
	if (!railway) {
		throw new Error('Railway CLI is unavailable.');
	}

	const taskPrefix = prefix ?? {
		scope: normalizeScope(deployService.scope ?? deployService.railwayEnvironment ?? 'railway'),
		system: deployService.key === 'api' ? 'api' : 'agents',
		task: `${deployService.key}-railway-deploy`,
		stage: 'deploy',
	};
	const runtimeConfiguration = await syncRailwayServiceRuntimeConfigurationAfterDeploy(tenantRoot, deployService, {
		env: commandEnv,
	});
	if (deployService.buildCommand && shouldRunRailwayPredeployBuild(commandEnv)) {
		const buildResult = await runPrefixedCommand('bash', ['-lc', deployService.buildCommand], {
			cwd: deployService.rootDir,
			env: commandEnv,
			write,
			prefix: { ...taskPrefix, stage: 'build' },
		});
		if (buildResult.status !== 0) {
			throw new Error(`Railway ${deployService.key} build command failed.`);
		}
	}

	let lastFailure = null;
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const result = await runPrefixedCommand(railway.command, [...railway.argsPrefix, ...plan.args], {
			cwd: service.rootDir,
			env: commandEnv,
			write,
			prefix: taskPrefix,
		});
		if (result.status === 0) {
			lastFailure = null;
			break;
		}
		lastFailure = result;
		if (!isRailwayTransientFailure(result) || attempt === 5) {
			throw new Error(result.stderr?.trim() || result.stdout?.trim() || `railway ${plan.args.join(' ')} failed with exit code ${result.status ?? 'unknown'} in ${plan.cwd}`);
		}
		const backoffMs = 5000 * attempt;
		const warning = `Railway deploy for ${deployService.serviceName ?? deployService.serviceId ?? deployService.key} hit a transient failure; retrying in ${Math.round(backoffMs / 1000)}s...`;
		write ? write(`[${taskPrefix.scope}][${taskPrefix.system}][${taskPrefix.task}][retry] ${warning}`, 'stderr') : console.warn(warning);
		await sleep(backoffMs);
	}
	if (lastFailure) {
		throw new Error(lastFailure.stderr?.trim() || lastFailure.stdout?.trim() || `railway ${plan.args.join(' ')} failed`);
	}
	return {
		service: deployService.key,
		status: 'deployed',
		command: [plan.command, ...plan.args].join(' '),
		cwd: plan.cwd,
		publicBaseUrl: deployService.publicBaseUrl,
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
