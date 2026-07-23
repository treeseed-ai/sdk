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
import { configuredRailwayServices } from './configured-railway-services.ts';
import { resolveRailwayEnvironmentForScope } from './normalize-scope.ts';
import { collectRailwayDeploymentStatusChecks, formatRailwayDeploymentStatusSummary } from './railway-status-deployment-terminal-failure.ts';

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

export async function resolveRailwayDeploymentProjectId(services, { env = process.env, fetchImpl = fetch } = {}) {
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

export async function fetchRailwayProjectDeploymentStatus({ projectId, env = process.env, fetchImpl = fetch }) {
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
