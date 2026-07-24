import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { IacClient } from 'railway';
import { connectRailwayServiceSourceWithCli, runRailwayCliJson } from '../hosting/railway/railway-cli.ts';
import { resolveRailwayCredential } from '../../../configuration/service-credentials.ts';
import { listRailwayVariables } from './ensure-railway-service-instance-configuration.ts';
import { listRailwayVolumes } from './upsert-railway-variables.ts';
import { railwayGraphqlRequest } from './collect-railway-volumes.ts';
import { RailwayServiceInstanceSummary, normalizeConnectionNodes, railwayConnectionLabel } from './default-railway-api-url.ts';
import { normalizeRailwayNumber, normalizeService } from './normalize-workspace.ts';

export async function inspectRailwayPostgresService({
	projectId,
	environmentId,
	serviceId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	environmentId: string;
	serviceId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const variables = await listRailwayVariables({ projectId, environmentId, serviceId, env, fetchImpl }).catch(() => ({}));
	const hasConnectionVars = typeof variables.DATABASE_URL === 'string'
		&& typeof variables.PGHOST === 'string'
		&& typeof variables.PGUSER === 'string'
		&& typeof variables.PGPASSWORD === 'string'
		&& typeof variables.PGDATABASE === 'string';
	const volumes = await listRailwayVolumes({ projectId, env, fetchImpl }).catch(() => []);
	const volume = volumes.find((candidate) => candidate.instances.some((instance) =>
		instance.serviceId === serviceId
		&& instance.environmentId === environmentId
		&& instance.mountPath === '/var/lib/postgresql/data',
	)) ?? null;
	const deployment = await inspectRailwayServiceDeploymentHealth({ serviceId, environmentId, env, fetchImpl }).catch((error) => ({
		ok: false,
		status: null,
		message: error instanceof Error ? error.message : String(error ?? 'Unable to inspect PostgreSQL deployment health.'),
	}));
	return {
		ok: hasConnectionVars && Boolean(volume) && deployment.ok,
		variableKeys: Object.keys(variables).sort(),
		volumeId: volume?.id ?? null,
		deploymentStatus: deployment.status,
		message: hasConnectionVars
			? volume
				? deployment.ok
					? 'Railway managed PostgreSQL markers are present and the deployment is healthy.'
					: `Railway managed PostgreSQL markers are present, but deployment health is not ready. ${deployment.message}`
				: 'PostgreSQL connection variables exist, but the managed data volume is missing.'
			: 'PostgreSQL connection variables are missing.',
	};
}

export async function inspectRailwayServiceDeploymentHealth({
	serviceId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		serviceInstance?: {
			latestDeployment?: {
				status?: string | null;
				deploymentStopped?: boolean | null;
				meta?: {
					branch?: string | null;
					repo?: string | null;
					image?: string | null;
					rootDirectory?: string | null;
					commitHash?: string | null;
				} | null;
				instances?: Array<{ status?: string | null }> | null;
			} | null;
		} | null;
	}>({
		query: `
query TreeseedRailwayServiceDeploymentHealth($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		latestDeployment {
			status
			deploymentStopped
			meta
			instances {
				status
			}
		}
	}
}
`.trim(),
		variables: { serviceId, environmentId },
		env,
		fetchImpl,
	});
	const deployment = payload.data?.serviceInstance?.latestDeployment;
	const status = railwayConnectionLabel(deployment?.status)?.toUpperCase() ?? null;
	const instanceStatuses = Array.isArray(deployment?.instances)
		? deployment.instances.map((instance) => railwayConnectionLabel(instance?.status)?.toUpperCase()).filter(Boolean)
		: [];
	const stopped = deployment?.deploymentStopped === true;
	const ok = status === 'SUCCESS' && !stopped && (instanceStatuses.length === 0 || instanceStatuses.some((candidate) => candidate === 'RUNNING'));
	return {
		ok,
		status,
		deploymentStopped: stopped,
		instanceStatuses,
		branch: railwayConnectionLabel(deployment?.meta?.branch) || null,
		repo: railwayConnectionLabel(deployment?.meta?.repo) || null,
		rootDirectory: railwayConnectionLabel(deployment?.meta?.rootDirectory) || null,
		commitHash: railwayConnectionLabel(deployment?.meta?.commitHash) || null,
		image: railwayConnectionLabel(deployment?.meta?.image) || null,
		requiredMountPath: railwayConnectionLabel(deployment?.meta?.serviceManifest?.deploy?.requiredMountPath) || null,
		volumeMounts: Array.isArray(deployment?.meta?.volumeMounts)
			? deployment.meta.volumeMounts.map((entry: unknown) => railwayConnectionLabel(entry)).filter(Boolean)
			: [],
		message: ok
			? 'Deployment is healthy.'
			: `Latest deployment status is ${status ?? 'unknown'}${stopped ? ' and stopped' : ''}${instanceStatuses.length ? `; instances=${instanceStatuses.join(',')}` : ''}.`,
	};
}

export async function listRailwayServices({
	projectId,
	env = process.env,
	fetchImpl = fetch,
}: {
	projectId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const payload = await railwayGraphqlRequest<{
		project?: Record<string, unknown> | null;
	}>({
		query: `
query TreeseedRailwayProjectServices($projectId: String!) {
	project(id: $projectId) {
		id
		services(first: 50) {
			edges {
				node {
					id
					name
				}
			}
		}
	}
}
`.trim(),
		variables: { projectId },
		env,
		fetchImpl,
	});
	return normalizeConnectionNodes(payload.data?.project ? (payload.data.project as Record<string, unknown>).services : null, normalizeService);
}

export async function getRailwayServiceInstance({
	serviceId,
	environmentId,
	env = process.env,
	fetchImpl = fetch,
}: {
	serviceId: string;
	environmentId: string;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	fetchImpl?: typeof fetch;
}) {
	const legacySummary = {
		id: null,
		buildCommand: null,
		dockerfilePath: null,
		railwayConfigFile: null,
		startCommand: null,
		cronSchedule: null,
		rootDirectory: null,
		healthcheckPath: null,
		healthcheckTimeoutSeconds: null,
		healthcheckIntervalSeconds: null,
		restartPolicy: null,
		runtimeMode: null,
		sleepApplication: null,
		runtimeConfigSupported: false,
	} satisfies RailwayServiceInstanceSummary;
	try {
		const payload = await railwayGraphqlRequest<{
			serviceInstance?: Record<string, unknown> | null;
		}>({
			query: `
query TreeseedRailwayServiceInstance($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		id
		buildCommand
		dockerfilePath
		railwayConfigFile
		startCommand
		cronSchedule
		rootDirectory
		healthcheckPath
		healthcheckTimeout
		sleepApplication
	}
}
`.trim(),
			variables: { serviceId, environmentId },
			env,
			fetchImpl,
		});
		const instance = payload.data?.serviceInstance;
		return {
			id: railwayConnectionLabel(instance?.id) || null,
			buildCommand: railwayConnectionLabel(instance?.buildCommand) || null,
			dockerfilePath: railwayConnectionLabel(instance?.dockerfilePath) || null,
			railwayConfigFile: railwayConnectionLabel(instance?.railwayConfigFile) || null,
			startCommand: railwayConnectionLabel(instance?.startCommand) || null,
			cronSchedule: railwayConnectionLabel(instance?.cronSchedule) || null,
			rootDirectory: railwayConnectionLabel(instance?.rootDirectory) || null,
			healthcheckPath: railwayConnectionLabel(instance?.healthcheckPath) || null,
			healthcheckTimeoutSeconds: normalizeRailwayNumber(instance?.healthcheckTimeout),
			healthcheckIntervalSeconds: null,
			restartPolicy: null,
			runtimeMode: instance?.sleepApplication === true ? 'serverless' : 'replicated',
			sleepApplication: typeof instance?.sleepApplication === 'boolean' ? instance.sleepApplication : null,
			runtimeConfigSupported: true,
		} satisfies RailwayServiceInstanceSummary;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (/Cannot query field .*healthcheckPath|Cannot query field .*healthcheckTimeout|Cannot query field .*sleepApplication/iu.test(message)) {
			const payload = await railwayGraphqlRequest<{
				serviceInstance?: Record<string, unknown> | null;
			}>({
				query: `
query TreeseedRailwayServiceInstanceLegacy($serviceId: String!, $environmentId: String!) {
	serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
		id
		buildCommand
		dockerfilePath
		railwayConfigFile
		startCommand
		cronSchedule
		rootDirectory
	}
}
`.trim(),
				variables: { serviceId, environmentId },
				env,
				fetchImpl,
			});
			const instance = payload.data?.serviceInstance;
			return {
				...legacySummary,
				id: railwayConnectionLabel(instance?.id) || null,
				buildCommand: railwayConnectionLabel(instance?.buildCommand) || null,
				dockerfilePath: railwayConnectionLabel(instance?.dockerfilePath) || null,
				railwayConfigFile: railwayConnectionLabel(instance?.railwayConfigFile) || null,
				startCommand: railwayConnectionLabel(instance?.startCommand) || null,
				cronSchedule: railwayConnectionLabel(instance?.cronSchedule) || null,
				rootDirectory: railwayConnectionLabel(instance?.rootDirectory) || null,
			} satisfies RailwayServiceInstanceSummary;
		}
		if (!/ServiceInstance not found/iu.test(message)) {
			throw error;
		}
		return legacySummary;
	}
}
