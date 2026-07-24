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
import { configuredRailwayScheduledJobs, resolveRailwayScheduleTarget, validateRailwayServiceConfiguration } from './configured-railway-services.ts';
import { isRailwayScheduleCapabilityError, resolveRailwayAuthToken } from './railway-status-deployment-terminal-failure.ts';

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
