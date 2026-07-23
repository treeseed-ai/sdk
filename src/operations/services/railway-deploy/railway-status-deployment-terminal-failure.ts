import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadCliDeployConfig } from '../runtime-tools.ts';
import { resolveTreeseedMachineEnvironmentValues } from '../config-runtime.ts';
import { createPersistentDeployTarget, resolveTreeseedResourceIdentity } from '../deploy.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../git-runner.ts';
import { discoverTreeseedApplications } from '../../../hosting/apps.ts';
import { apiRailwayDefaultDockerfilePath, apiRailwayDefaultSourceRepo, assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService, railwayEnvironmentQualifiedServiceName, railwayTreeDxServiceName } from '../railway-source-policy.ts';
import { runPrefixedCommand, sleep, type TreeseedBootstrapTaskPrefix, type TreeseedBootstrapWriter } from '../bootstrap-runner.ts';
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
} from '../railway-api.ts';
import { elapsedMs, formatDurationMs, type TreeseedTimingEntry } from '../../../timing.ts';
import { configuredEnvValue, railwayEdgeNodes, railwayStatusDeploymentSettled, railwayStatusEnvironmentNodes, resolveRailwayEnvironmentForScope } from './normalize-scope.ts';

export function railwayStatusDeploymentTerminalFailure(status) {
	const normalized = String(status ?? '').trim().toUpperCase();
	return ['FAILED', 'CRASHED', 'REMOVED'].includes(normalized);
}

export function formatRailwayDeploymentStatusSummary(scope, checks) {
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

export function normalizeRailwaySchedule(schedule) {
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

export function collectRailwaySchedules(value, seen = new Set()) {
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

export function isRailwayScheduleCapabilityError(error: unknown) {
	const message = error instanceof Error ? error.message : String(error ?? '');
	return /cronTriggers|cronTriggerCreate|cronTriggerUpdate/iu.test(message);
}
