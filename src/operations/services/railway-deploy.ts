import { existsSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCliDeployConfig } from './runtime-tools.ts';
import { createPersistentDeployTarget, resolveTreeseedResourceIdentity } from './deploy.ts';
import { runPrefixedCommand, sleep, type TreeseedBootstrapTaskPrefix, type TreeseedBootstrapWriter } from './bootstrap-runner.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	ensureRailwayServiceInstanceConfiguration,
	listRailwayEnvironments,
	listRailwayProjects,
	listRailwayServices,
	normalizeRailwayEnvironmentName,
	railwayGraphqlRequest,
	resolveRailwayApiToken,
	resolveRailwayApiUrl,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
} from './railway-api.ts';

function normalizeScope(scope) {
	return scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
}

function resolveRailwayEnvironmentForScope(scope, configuredEnvironment) {
	return normalizeRailwayEnvironmentName(configuredEnvironment || normalizeScope(scope));
}
const RAILWAY_SERVICE_KEYS = ['api', 'manager', 'worker', 'workdayStart', 'workdayReport'];
const HOSTED_PROJECT_SERVICE_KEYS = ['api', 'manager', 'worker'];

function shouldManageRailwaySchedules(scope, phase = 'deploy') {
	return phase === 'deploy' && normalizeRailwayEnvironmentName(scope) === 'production';
}

function railwayServiceNameSuffix(serviceKey) {
	return serviceKey === 'workdayStart'
		? 'workday-start'
		: serviceKey === 'workdayReport'
			? 'workday-report'
			: serviceKey;
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
	} else {
		delete merged.RAILWAY_API_TOKEN;
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

function isRailwayTransientFailure(result) {
	return /timed out|failed to fetch|temporarily unavailable|econnreset|etimedout/iu.test(railwayMessage(result));
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
	const runWithEnv = (spawnEnv) => spawnSync('railway', args, {
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

function shellEscape(value) {
	return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

export function setRailwaySecretVariable(
	{ cwd, service, environment, key, value, env = process.env, capture = false, allowFailure = false },
) {
	const effectiveEnv = buildRailwayCommandEnv({
		...process.env,
		...(env ?? {}),
		TREESEED_RAILWAY_SECRET_VALUE: value,
	});
	const command = [
		'printf %s\\\\n "$TREESEED_RAILWAY_SECRET_VALUE"',
		'|',
		'railway variable set',
		'--service',
		shellEscape(service),
		'--environment',
		shellEscape(environment),
		'--stdin',
		'--skip-deploys',
		shellEscape(key),
	].join(' ');
	let result = null;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		result = spawnSync('bash', ['-lc', command], {
			cwd,
			stdio: capture ? 'pipe' : 'inherit',
			encoding: 'utf8',
			env: effectiveEnv,
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

			const defaultRootDir = ['api', 'manager', 'worker', 'workdayStart', 'workdayReport'].includes(serviceKey) ? '.' : 'packages/core';
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
				serviceName: service.railway?.serviceName ?? `${identity.deploymentKey}-${railwayServiceNameSuffix(serviceKey)}`,
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
	const queries = defaultRailwayScheduleQueries();
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
			const variables = {
				projectId: target.project.id,
				serviceId: target.service.id,
				environmentId: target.environment.id,
			};
			const listed = await railwayGraphqlRequest({
				query: queries.listQuery,
				variables,
				apiToken: effectiveApiToken,
				apiUrl: effectiveApiUrl,
				fetchImpl,
			});
			const existing = collectRailwaySchedules(listed?.data).find((entry) =>
				(entry.id && entry.id === schedule.id)
				|| (entry.name && entry.name === schedule.logicalName)
				|| (
					entry.expression === schedule.expression
					&& entry.serviceId === schedule.serviceId
					&& (!schedule.environmentId || entry.environmentId === schedule.environmentId)
				)
			);
			const desired = {
				name: schedule.logicalName,
				schedule: schedule.expression,
				command: schedule.command,
				enabled: schedule.enabled !== false,
			};
			const drifted = Boolean(
				existing
				&& (
					existing.expression !== desired.schedule
					|| (existing.command ?? null) !== (desired.command ?? null)
					|| existing.enabled !== desired.enabled
				)
			);
			if (dryRun) {
				results.push({
					...schedule,
					projectId: variables.projectId,
					id: existing?.id ?? null,
					status: existing ? (drifted ? 'planned_update' : 'planned_noop') : 'planned_create',
					enabled: desired.enabled,
					command: desired.command,
					serviceId: variables.serviceId,
					environmentId: variables.environmentId,
				});
				continue;
			}
			if (!existing) {
				const created = await railwayGraphqlRequest({
					query: queries.createMutation,
					variables: {
						...variables,
						name: desired.name,
						schedule: desired.schedule,
						command: desired.command,
						enabled: desired.enabled,
					},
					apiToken: effectiveApiToken,
					apiUrl: effectiveApiUrl,
					fetchImpl,
				});
				const createdSchedule = collectRailwaySchedules(created?.data)[0];
				if (!createdSchedule?.id) {
					throw new Error(`Railway schedule create did not return an id for ${schedule.logicalName}.`);
				}
				results.push({
					...schedule,
					projectId: variables.projectId,
					id: createdSchedule.id,
					status: 'created',
					enabled: createdSchedule.enabled,
					command: createdSchedule.command ?? desired.command,
					serviceId: variables.serviceId,
					environmentId: variables.environmentId,
				});
				continue;
			}
			if (drifted) {
				const updated = await railwayGraphqlRequest({
					query: queries.updateMutation,
					variables: {
						id: existing.id,
						name: desired.name,
						schedule: desired.schedule,
						command: desired.command,
						enabled: desired.enabled,
					},
					apiToken: effectiveApiToken,
					apiUrl: effectiveApiUrl,
					fetchImpl,
				});
				const updatedSchedule = collectRailwaySchedules(updated?.data)[0];
				if (!updatedSchedule?.id) {
					throw new Error(`Railway schedule update did not return an id for ${schedule.logicalName}.`);
				}
				results.push({
					...schedule,
					projectId: variables.projectId,
					id: updatedSchedule.id,
					status: 'updated',
					enabled: updatedSchedule.enabled,
					command: updatedSchedule.command ?? desired.command,
					serviceId: variables.serviceId,
					environmentId: variables.environmentId,
				});
				continue;
			}
			results.push({
				...schedule,
				projectId: variables.projectId,
				id: existing.id,
				status: 'noop',
				enabled: existing.enabled,
				command: existing.command ?? desired.command,
				serviceId: variables.serviceId,
				environmentId: variables.environmentId,
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
	const queries = defaultRailwayScheduleQueries();
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
			const listed = await railwayGraphqlRequest({
				query: queries.listQuery,
				variables: {
					projectId: target.project.id,
					serviceId: target.service.id,
					environmentId: target.environment.id,
				},
				apiToken: effectiveApiToken,
				apiUrl: effectiveApiUrl,
				fetchImpl,
			});
			const existing = collectRailwaySchedules(listed?.data).find((entry) =>
				(entry.name && entry.name === schedule.logicalName)
				|| (
					entry.expression === schedule.expression
					&& entry.serviceId === schedule.serviceId
					&& (!schedule.environmentId || entry.environmentId === schedule.environmentId)
				)
			);
			checks.push({
				...schedule,
				id: existing?.id ?? null,
				projectId: target.project.id,
				serviceId: target.service.id,
				environmentId: target.environment.id,
				ok: Boolean(
					existing
					&& existing.expression === schedule.expression
					&& (existing.command ?? null) === (schedule.command ?? null)
					&& existing.enabled !== false
				),
				status: existing ? 'checked' : 'missing',
				observed: existing
					? {
						expression: existing.expression,
						command: existing.command ?? null,
						enabled: existing.enabled,
					}
					: null,
				message: existing
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

export function planRailwayServiceDeploy(service) {
	const args = ['up', '--service', service.serviceName ?? service.serviceId, '--ci'];
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
	if (!wantsInstanceConfig) {
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

	return await ensureRailwayServiceInstanceConfiguration({
		serviceId: railwayService.id,
		environmentId: environment.id,
		buildCommand: service.buildCommand,
		startCommand: service.startCommand,
		rootDirectory: relativeRailwayRootDir(tenantRoot, service.rootDir),
		healthcheckPath: service.healthcheckPath,
		healthcheckTimeoutSeconds: service.healthcheckTimeoutSeconds,
		healthcheckIntervalSeconds: service.healthcheckIntervalSeconds,
		restartPolicy: service.restartPolicy,
		runtimeMode: service.runtimeMode,
		env,
	});
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
	const plan = planRailwayServiceDeploy(service);
	if (dryRun) {
		return {
			service: service.key,
			status: 'planned',
			command: [plan.command, ...plan.args].join(' '),
			cwd: plan.cwd,
			publicBaseUrl: service.publicBaseUrl,
		};
	}

	const taskPrefix = prefix ?? {
		scope: normalizeScope(service.scope ?? service.railwayEnvironment ?? 'railway'),
		system: service.key === 'api' ? 'api' : 'agents',
		task: `${service.key}-railway-deploy`,
		stage: 'deploy',
	};
	const commandEnv = buildRailwayCommandEnv({ ...process.env, ...env });
	if (service.buildCommand) {
		const buildResult = await runPrefixedCommand('bash', ['-lc', service.buildCommand], {
			cwd: service.rootDir,
			env: commandEnv,
			write,
			prefix: { ...taskPrefix, stage: 'build' },
		});
		if (buildResult.status !== 0) {
			throw new Error(`Railway ${service.key} build command failed.`);
		}
	}

	let lastFailure = null;
	for (let attempt = 1; attempt <= 5; attempt += 1) {
		const result = await runPrefixedCommand(plan.command, plan.args, {
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
			throw new Error(result.stderr?.trim() || result.stdout?.trim() || `railway ${plan.args.join(' ')} failed`);
		}
		const backoffMs = 5000 * attempt;
		const warning = `Railway deploy for ${service.serviceName ?? service.serviceId ?? service.key} hit a transient failure; retrying in ${Math.round(backoffMs / 1000)}s...`;
		write ? write(`[${taskPrefix.scope}][${taskPrefix.system}][${taskPrefix.task}][retry] ${warning}`, 'stderr') : console.warn(warning);
		await sleep(backoffMs);
	}
	if (lastFailure) {
		throw new Error(lastFailure.stderr?.trim() || lastFailure.stdout?.trim() || `railway ${plan.args.join(' ')} failed`);
	}
	const runtimeConfiguration = await syncRailwayServiceRuntimeConfigurationAfterDeploy(tenantRoot, service, {
		env: commandEnv,
	});
	return {
		service: service.key,
		status: 'deployed',
		command: [plan.command, ...plan.args].join(' '),
		cwd: plan.cwd,
		publicBaseUrl: service.publicBaseUrl,
		runtimeConfiguration: runtimeConfiguration
			? {
				updated: runtimeConfiguration.updated,
				healthcheckPath: runtimeConfiguration.instance.healthcheckPath,
				healthcheckTimeoutSeconds: runtimeConfiguration.instance.healthcheckTimeoutSeconds,
				runtimeMode: runtimeConfiguration.instance.runtimeMode,
			}
			: null,
	};
}
