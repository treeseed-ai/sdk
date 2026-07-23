import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../railway-cli.ts';
import { resolveTreeseedRailwayApiToken } from '../../../service-credentials.ts';
import { getRailwayServiceInstance } from './inspect-railway-postgres-service.ts';
import { RailwayServiceInstanceSummary, createRailwayEnvironmentPatchClient, railwayConnectionLabel } from './default-railway-api-url.ts';
import { normalizeRailwayNumber, normalizeVariableMap } from './normalize-workspace.ts';
import { railwayGraphqlRequest } from './collect-railway-volumes.ts';

export async function ensureRailwayServiceInstanceConfiguration({
	serviceId,
	environmentId,
	buildCommand,
	dockerfilePath,
	railwayConfigFile,
	startCommand,
	cronSchedule,
	rootDirectory,
	healthcheckPath,
	healthcheckTimeoutSeconds,
	healthcheckIntervalSeconds,
	restartPolicy,
	runtimeMode,
	deploymentRegion,
	clearSourceConfiguration = false,
	env = process.env,
	fetchImpl = fetch,
	settleAttempts = 60,
	settleDelayMs = 5_000,
}: {
	serviceId: string;
	environmentId: string;
	buildCommand?: string | null;
	dockerfilePath?: string | null;
	railwayConfigFile?: string | null;
	startCommand?: string | null;
	cronSchedule?: string | null;
	rootDirectory?: string | null;
	healthcheckPath?: string | null;
	healthcheckTimeoutSeconds?: number | null;
	healthcheckIntervalSeconds?: number | null;
	restartPolicy?: string | null;
	runtimeMode?: string | null;
	deploymentRegion?: string | null;
	clearSourceConfiguration?: boolean;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
	settleAttempts?: number;
	settleDelayMs?: number;
}) {
	let current = await getRailwayServiceInstance({ serviceId, environmentId, env, fetchImpl });
	if (!current.id) {
		for (let attempt = 0; attempt < settleAttempts && !current.id; attempt += 1) {
			await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
			current = await getRailwayServiceInstance({ serviceId, environmentId, env, fetchImpl });
		}
	}
	if (!current.id) {
		return { instance: current, updated: false };
	}
	const desiredRuntimeMode = railwayConnectionLabel(runtimeMode) === 'service'
		? 'replicated'
		: railwayConnectionLabel(runtimeMode) || null;
	const desiredDeploymentRegion = railwayConnectionLabel(deploymentRegion) || null;
	const desired = {
		buildCommand: railwayConnectionLabel(buildCommand) || null,
		dockerfilePath: railwayConnectionLabel(dockerfilePath) || null,
		railwayConfigFile: railwayConnectionLabel(railwayConfigFile) || null,
		startCommand: railwayConnectionLabel(startCommand) || null,
		cronSchedule: railwayConnectionLabel(cronSchedule) || null,
		rootDirectory: railwayConnectionLabel(rootDirectory) || null,
		healthcheckPath: railwayConnectionLabel(healthcheckPath) || null,
		healthcheckTimeoutSeconds: normalizeRailwayNumber(healthcheckTimeoutSeconds),
		healthcheckIntervalSeconds: normalizeRailwayNumber(healthcheckIntervalSeconds),
		restartPolicy: railwayConnectionLabel(restartPolicy) || null,
		runtimeMode: desiredRuntimeMode,
		deploymentRegion: desiredDeploymentRegion,
		sleepApplication: desiredRuntimeMode === 'serverless'
			? true
			: desiredRuntimeMode === 'replicated'
				? false
				: null,
	};
	const needsRuntimeConfig = desired.healthcheckPath !== null
		|| desired.healthcheckTimeoutSeconds !== null
		|| desired.runtimeMode !== null
		|| desired.deploymentRegion !== null;
	if (needsRuntimeConfig && current.runtimeConfigSupported !== true) {
		throw new Error('Railway service instance runtime settings are unsupported by the current Railway API schema.');
	}
	if (desired.healthcheckIntervalSeconds !== null) {
		throw new Error('Railway service instance healthcheck intervals are unsupported by the current Railway API schema.');
	}
	if (desired.restartPolicy !== null) {
		throw new Error('Railway service instance restart policies are unsupported by the current Railway API schema.');
	}
	const drifted = (
		((desired.buildCommand !== null || clearSourceConfiguration) && desired.buildCommand !== current.buildCommand)
		|| ((desired.dockerfilePath !== null || clearSourceConfiguration) && desired.dockerfilePath !== current.dockerfilePath)
		|| ((desired.railwayConfigFile !== null || clearSourceConfiguration) && desired.railwayConfigFile !== current.railwayConfigFile)
		|| ((desired.startCommand !== null || clearSourceConfiguration) && desired.startCommand !== current.startCommand)
		|| (desired.cronSchedule !== null && desired.cronSchedule !== current.cronSchedule)
		|| ((desired.rootDirectory !== null || clearSourceConfiguration) && desired.rootDirectory !== current.rootDirectory)
		|| (desired.healthcheckPath !== null && desired.healthcheckPath !== current.healthcheckPath)
		|| (desired.healthcheckTimeoutSeconds !== null && desired.healthcheckTimeoutSeconds !== current.healthcheckTimeoutSeconds)
		|| (desired.runtimeMode !== null && desired.runtimeMode !== current.runtimeMode)
		|| desired.deploymentRegion !== null
	);
	if (!drifted) {
		return { instance: current, updated: false };
	}
	const client = createRailwayEnvironmentPatchClient({ env, fetchImpl });
	await client.stageEnvironmentChanges({
		environmentId,
		merge: true,
		patch: {
			services: {
				[serviceId]: {
					build: {
						...(desired.buildCommand !== null || clearSourceConfiguration ? { buildCommand: desired.buildCommand } : {}),
						...(desired.dockerfilePath !== null || clearSourceConfiguration ? { dockerfilePath: desired.dockerfilePath } : {}),
					},
					...(desired.railwayConfigFile !== null || clearSourceConfiguration ? { configFile: desired.railwayConfigFile } : {}),
					...(desired.rootDirectory !== null || clearSourceConfiguration ? { source: { rootDirectory: desired.rootDirectory } } : {}),
					deploy: {
						...(desired.startCommand !== null || clearSourceConfiguration ? { startCommand: desired.startCommand } : {}),
						...(desired.cronSchedule !== null ? { cronSchedule: desired.cronSchedule } : {}),
						...(desired.healthcheckPath !== null ? { healthcheckPath: desired.healthcheckPath } : {}),
						...(desired.healthcheckTimeoutSeconds !== null ? { healthcheckTimeout: desired.healthcheckTimeoutSeconds } : {}),
						...(desired.sleepApplication !== null ? { sleepApplication: desired.sleepApplication } : {}),
						...(desired.runtimeMode !== null ? { runtime: desired.runtimeMode } : {}),
						...(desired.deploymentRegion !== null ? {
							region: desired.deploymentRegion,
							multiRegionConfig: { [desired.deploymentRegion]: { numReplicas: 1 } },
						} : {}),
					},
				},
			},
		},
	});
	await client.commitStagedPatch({
		environmentId,
		message: `Treeseed reconcile service configuration ${serviceId}`,
		skipDeploys: true,
	});
	let instance = current;
	for (let attempt = 0; attempt <= settleAttempts; attempt += 1) {
		instance = await getRailwayServiceInstance({
			serviceId,
			environmentId,
			env,
			fetchImpl,
		});
		if (!serviceInstanceDrifted(instance, desired, clearSourceConfiguration) || attempt >= settleAttempts) {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
	}
	return {
		instance: {
			id: instance.id || current.id,
			buildCommand: instance.buildCommand,
			dockerfilePath: instance.dockerfilePath,
			railwayConfigFile: instance.railwayConfigFile,
			startCommand: instance.startCommand,
			cronSchedule: instance.cronSchedule,
			rootDirectory: instance.rootDirectory,
			healthcheckPath: instance.healthcheckPath,
			healthcheckTimeoutSeconds: instance.healthcheckTimeoutSeconds,
			healthcheckIntervalSeconds: instance.healthcheckIntervalSeconds,
			restartPolicy: instance.restartPolicy,
			runtimeMode: instance.runtimeMode,
			sleepApplication: instance.sleepApplication,
			runtimeConfigSupported: instance.runtimeConfigSupported,
		} satisfies RailwayServiceInstanceSummary,
		updated: true,
	};
}

export function serviceInstanceDrifted(
	current: RailwayServiceInstanceSummary,
	desired: {
		buildCommand: string | null;
		dockerfilePath?: string | null;
		railwayConfigFile?: string | null;
		startCommand: string | null;
		cronSchedule: string | null;
		rootDirectory: string | null;
		healthcheckPath: string | null;
		healthcheckTimeoutSeconds: number | null;
		runtimeMode: string | null;
	},
	clearSourceConfiguration = false,
) {
	return (
		((desired.buildCommand !== null || clearSourceConfiguration) && desired.buildCommand !== current.buildCommand)
		|| (((desired.dockerfilePath !== null && desired.dockerfilePath !== undefined) || clearSourceConfiguration) && (desired.dockerfilePath ?? null) !== current.dockerfilePath)
		|| (((desired.railwayConfigFile !== null && desired.railwayConfigFile !== undefined) || clearSourceConfiguration) && (desired.railwayConfigFile ?? null) !== current.railwayConfigFile)
		|| ((desired.startCommand !== null || clearSourceConfiguration) && desired.startCommand !== current.startCommand)
		|| (desired.cronSchedule !== null && desired.cronSchedule !== current.cronSchedule)
		|| ((desired.rootDirectory !== null || clearSourceConfiguration) && desired.rootDirectory !== current.rootDirectory)
		|| (desired.healthcheckPath !== null && desired.healthcheckPath !== current.healthcheckPath)
		|| (desired.healthcheckTimeoutSeconds !== null && desired.healthcheckTimeoutSeconds !== current.healthcheckTimeoutSeconds)
		|| (desired.runtimeMode !== null && desired.runtimeMode !== current.runtimeMode)
	);
}

export async function listRailwayVariables({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId?: string | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		variables?: unknown;
	}>({
		query: `
query TreeseedRailwayVariables($projectId: String!, $environmentId: String!, $serviceId: String) {
	variables(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, unrendered: true)
}
`.trim(),
		variables: {
			projectId,
			environmentId,
			serviceId: serviceId || null,
		},
		env,
		fetchImpl,
	});
	return normalizeVariableMap(payload.data?.variables);
}
