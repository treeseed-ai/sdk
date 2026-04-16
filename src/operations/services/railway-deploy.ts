import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCliDeployConfig } from './runtime-tools.ts';

const DEFAULT_RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';
function normalizeScope(scope) {
	return scope === 'prod' ? 'prod' : scope === 'staging' ? 'staging' : 'local';
}
const RAILWAY_SERVICE_KEYS = ['api', 'agents', 'manager', 'worker', 'runner', 'workdayStart', 'workdayReport'];
const HOSTED_PROJECT_SERVICE_KEYS = ['api', 'manager', 'worker', 'agents'];

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

async function railwayGraphqlRequest({
	query,
	variables,
	apiToken = envValue('RAILWAY_API_TOKEN') || envValue('RAILWAY_TOKEN'),
	apiUrl = envValue('TREESEED_RAILWAY_API_URL') || DEFAULT_RAILWAY_API_URL,
	fetchImpl = fetch,
}) {
	if (!apiToken) {
		throw new Error('Configure RAILWAY_API_TOKEN before invoking Railway GraphQL APIs.');
	}
	const response = await fetchImpl(apiUrl, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${apiToken}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({ query, variables }),
	});
	const payload = await response.json().catch(() => ({}));
	if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length > 0)) {
		throw new Error(
			payload?.errors?.[0]?.message
			?? `Railway GraphQL request failed with ${response.status}.`,
		);
	}
	return payload;
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

function runRailway(args, { cwd, capture = false, allowFailure = false } = {}) {
	const result = spawnSync('railway', args, {
		cwd,
		stdio: capture ? 'pipe' : 'inherit',
		encoding: 'utf8',
		env: { ...process.env },
	});

	if (result.status !== 0 && !allowFailure) {
		throw new Error(result.stderr?.trim() || result.stdout?.trim() || `railway ${args.join(' ')} failed`);
	}

	return result;
}

export function configuredRailwayServices(tenantRoot, scope) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const normalizedScope = normalizeScope(scope);
	const hostingKind = deployConfig.hosting?.kind ?? 'self_hosted_project';
	const serviceKeys = hostingKind === 'hosted_project'
		? HOSTED_PROJECT_SERVICE_KEYS
		: RAILWAY_SERVICE_KEYS;

	return serviceKeys
		.map((serviceKey) => {
			const service = deployConfig.services?.[serviceKey];
			if (!service || service.enabled === false || (service.provider ?? 'railway') !== 'railway') {
				return null;
			}

			const defaultRootDir = ['api', 'manager', 'worker', 'runner', 'workdayStart', 'workdayReport'].includes(serviceKey) ? '.' : 'packages/core';
			const serviceRoot = resolve(tenantRoot, service.railway?.rootDir ?? service.rootDir ?? defaultRootDir);
			const railwayEnvironment = service.environments?.[normalizedScope]?.railwayEnvironment ?? normalizedScope;
			const publicBaseUrl = service.environments?.[normalizedScope]?.baseUrl ?? service.publicBaseUrl ?? null;
			return {
				key: serviceKey,
				scope: normalizedScope,
				projectId: service.railway?.projectId ?? null,
				projectName: service.railway?.projectName ?? null,
				serviceId: service.railway?.serviceId ?? null,
				serviceName: service.railway?.serviceName ?? null,
				rootDir: serviceRoot,
				publicBaseUrl,
				railwayEnvironment,
				buildCommand: service.railway?.buildCommand ?? null,
				startCommand: service.railway?.startCommand ?? null,
				schedule: normalizeScheduleExpressions(service.railway?.schedule),
				hostingKind,
			};
		})
		.filter(Boolean);
}

export function configuredRailwayScheduledJobs(tenantRoot, scope) {
	return configuredRailwayServices(tenantRoot, scope)
		.filter((service) => Array.isArray(service.schedule) && service.schedule.length > 0)
		.flatMap((service) =>
			service.schedule.map((expression, index) => ({
				service: service.key,
				projectId: service.projectId,
				projectName: service.projectName,
				serviceId: service.serviceId,
				serviceName: service.serviceName,
				environment: service.railwayEnvironment,
				environmentId: envValue('TREESEED_RAILWAY_ENVIRONMENT_ID') || null,
				expression,
				command: service.startCommand,
				enabled: true,
				logicalName: `${service.key}:${index + 1}`,
			})),
		);
}

export function resolveRailwayDeploymentProfile(tenantRoot) {
	const deployConfig = loadCliDeployConfig(tenantRoot);
	const hostingKind = deployConfig.hosting?.kind ?? 'self_hosted_project';
	return {
		hostingKind,
		managedTopology: hostingKind === 'hosted_project' ? [...HOSTED_PROJECT_SERVICE_KEYS] : [...RAILWAY_SERVICE_KEYS],
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
		if (service.schedule?.length && !service.serviceId) {
			issues.push(`${service.key}: scheduled Railway services require railway.serviceId for Railway API reconciliation.`);
		}
		if (service.schedule?.length && !envValue('TREESEED_RAILWAY_ENVIRONMENT_ID')) {
			issues.push(`${service.key}: scheduled Railway services require TREESEED_RAILWAY_ENVIRONMENT_ID to be configured.`);
		}
	}

	if (issues.length > 0) {
		throw new Error(`Railway service configuration is incomplete:\n- ${issues.join('\n- ')}`);
	}

	return {
		services,
		schedules: configuredRailwayScheduledJobs(tenantRoot, scope),
		hostingKind,
		managedTopology,
	};
}

export function validateRailwayDeployPrerequisites(tenantRoot, scope) {
	const validation = validateRailwayServiceConfiguration(tenantRoot, scope);
	const token = process.env.RAILWAY_API_TOKEN;
	if (typeof token !== 'string' || token.trim().length === 0) {
		throw new Error('Configure RAILWAY_API_TOKEN before deploying Railway-managed services.');
	}
	return validation;
}

export async function ensureRailwayScheduledJobs(
	tenantRoot,
	scope,
	{ dryRun = false, fetchImpl = fetch, apiToken, apiUrl } = {},
) {
	const { schedules } = validateRailwayDeployPrerequisites(tenantRoot, scope);
	const queries = defaultRailwayScheduleQueries();
	const results = [];

	for (const schedule of schedules) {
		const variables = {
			projectId: schedule.projectId,
			serviceId: schedule.serviceId,
			environmentId: schedule.environmentId,
		};
		const listed = await railwayGraphqlRequest({
			query: queries.listQuery,
			variables,
			apiToken,
			apiUrl,
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
				id: existing?.id ?? null,
				status: existing ? (drifted ? 'planned_update' : 'planned_noop') : 'planned_create',
				enabled: desired.enabled,
				command: desired.command,
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
				apiToken,
				apiUrl,
				fetchImpl,
			});
			const createdSchedule = collectRailwaySchedules(created?.data)[0];
			if (!createdSchedule?.id) {
				throw new Error(`Railway schedule create did not return an id for ${schedule.logicalName}.`);
			}
			results.push({
				...schedule,
				id: createdSchedule.id,
				status: 'created',
				enabled: createdSchedule.enabled,
				command: createdSchedule.command ?? desired.command,
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
				apiToken,
				apiUrl,
				fetchImpl,
			});
			const updatedSchedule = collectRailwaySchedules(updated?.data)[0];
			if (!updatedSchedule?.id) {
				throw new Error(`Railway schedule update did not return an id for ${schedule.logicalName}.`);
			}
			results.push({
				...schedule,
				id: updatedSchedule.id,
				status: 'updated',
				enabled: updatedSchedule.enabled,
				command: updatedSchedule.command ?? desired.command,
			});
			continue;
		}
		results.push({
			...schedule,
			id: existing.id,
			status: 'noop',
			enabled: existing.enabled,
			command: existing.command ?? desired.command,
		});
	}

	return results;
}

export async function verifyRailwayScheduledJobs(
	tenantRoot,
	scope,
	{ fetchImpl = fetch, apiToken, apiUrl } = {},
) {
	const configured = configuredRailwayScheduledJobs(tenantRoot, scope);
	const queries = defaultRailwayScheduleQueries();
	const checks = [];

	for (const schedule of configured) {
		const listed = await railwayGraphqlRequest({
			query: queries.listQuery,
			variables: {
				projectId: schedule.projectId,
				serviceId: schedule.serviceId,
				environmentId: schedule.environmentId,
			},
			apiToken,
			apiUrl,
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
			ok: Boolean(
				existing
				&& existing.expression === schedule.expression
				&& (existing.command ?? null) === (schedule.command ?? null)
				&& existing.enabled !== false
			),
		});
	}

	return {
		ok: checks.every((entry) => entry.ok === true),
		checks,
	};
}

export function planRailwayServiceDeploy(service) {
	const args = ['up', '--service', service.serviceName ?? service.serviceId, '--ci'];
	if (service.railwayEnvironment) {
		args.push('--environment', service.railwayEnvironment);
	}
	return {
		command: 'railway',
		args,
		cwd: service.rootDir,
	};
}

export function deployRailwayService(tenantRoot, service, { dryRun = false } = {}) {
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

	if (service.buildCommand) {
		const buildResult = spawnSync('bash', ['-lc', service.buildCommand], {
			cwd: service.rootDir,
			stdio: 'inherit',
			env: { ...process.env },
		});
		if (buildResult.status !== 0) {
			throw new Error(`Railway ${service.key} build command failed.`);
		}
	}

	runRailway(plan.args, { cwd: service.rootDir });
	return {
		service: service.key,
		status: 'deployed',
		command: [plan.command, ...plan.args].join(' '),
		cwd: plan.cwd,
		publicBaseUrl: service.publicBaseUrl,
	};
}
