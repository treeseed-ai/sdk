import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	changeSetToEnvironmentPatch,
	IacClient,
	runRailwayIac,
	type RailwayChangeSet,
	type RailwayIacApplyResponse,
	type RailwayIacPlanResponse,
	type ResourceNode,
} from 'railway/iac';
import { railwayGraphqlRequest } from '../../../operations/services/railway-api.ts';
import { assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService } from '../../../operations/services/railway-source-policy.ts';
import { TreeseedRailwayIacProjectInput, TreeseedRailwayIacService, TreeseedRailwayObservedService, TreeseedRailwayObservedVolume, TreeseedRailwayPendingVolumeCollision } from './treeseed-railway-iac-service.ts';

export async function runRailwayIacWithRateLimitRetry<T>(
	run: () => Promise<T>,
	{
		delaysMs = [15_000, 45_000, 90_000],
		sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
		onRetry,
		onWait,
	}: {
		delaysMs?: number[];
		sleep?: (milliseconds: number) => Promise<unknown>;
		onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
		onWait?: (attempt: number, remainingMs: number) => void;
	} = {},
): Promise<T> {
	for (let attempt = 1; ; attempt += 1) {
		try {
			const result = await run();
			if (result && typeof result === 'object' && 'ok' in result && (result as { ok?: unknown }).ok === false) {
				const diagnostics = Array.isArray((result as { diagnostics?: unknown[] }).diagnostics)
					? (result as { diagnostics: Array<{ message?: unknown } | string> }).diagnostics
						.map((entry) => typeof entry === 'string' ? entry : String(entry?.message ?? ''))
						.filter(Boolean)
						.join('; ')
					: '';
				if (/fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|HTTP\s+429|rate[ -]?limit/iu.test(diagnostics)) {
					throw new Error(diagnostics || 'Railway IaC transport failed.');
				}
			}
			return result;
		} catch (error) {
			const delayMs = delaysMs[attempt - 1];
			if (delayMs === undefined || !/fetch failed|timed out|etimedout|econnreset|enetunreach|temporarily unavailable|aborted|HTTP\s+429|rate[ -]?limit/iu.test(String(error))) throw error;
			onRetry?.(attempt + 1, delayMs, error);
			let remainingMs = delayMs;
			while (remainingMs > 0) {
				const sliceMs = Math.min(15_000, remainingMs);
				await sleep(sliceMs);
				remainingMs -= sliceMs;
				if (remainingMs > 0) onWait?.(attempt + 1, remainingMs);
			}
		}
	}
}

export function js(value: unknown) {
	return JSON.stringify(value);
}

export function id(prefix: string, index: number) {
	return `${prefix}${index}`;
}

export function codeObject(entries: Array<[string, string | null | undefined]>) {
	const rendered = entries
		.filter(([, value]) => typeof value === 'string' && value.length > 0)
		.map(([key, value]) => `${js(key)}: ${value}`);
	return rendered.length > 0 ? `{\n${rendered.map((line) => `      ${line}`).join(',\n')}\n    }` : '{}';
}

export function literalVariable(value: string) {
	return js(value);
}

export function validateGeneratedVariables(service: TreeseedRailwayIacService) {
	const keys = [...Object.keys(service.variables ?? {}), ...Object.keys(service.secrets ?? {})];
	const isTreeDxService = service.serviceName.includes('treedx') || service.key.includes('treedx');
	return keys.filter((key) => {
		if (key === 'PORT') return false;
		if (key.startsWith('TREESEED_')) return false;
		if (isTreeDxService && key.startsWith('TREEDX_')) return false;
		return true;
	});
}

export function serviceSource(service: TreeseedRailwayIacService) {
	if (service.imageRef) {
		return `image(${js(service.imageRef)})`;
	}
	if (service.sourceMode === 'git' && service.sourceRepo) {
		const sourceConfig = {
			...(service.sourceBranch ? { branch: service.sourceBranch } : {}),
			...(service.sourceRootDirectory ? { rootDirectory: service.sourceRootDirectory } : {}),
			...(service.sourceCommit ? { commitSha: service.sourceCommit } : {}),
		};
		return `github(${js(service.sourceRepo)}, ${js(sourceConfig)})`;
	}
	return 'empty()';
}

export function buildConfig(service: TreeseedRailwayIacService) {
	if (service.imageRef) return null;
	if (service.dockerfilePath) {
		return {
			builder: 'DOCKERFILE',
			dockerfilePath: service.dockerfilePath,
		};
	}
	if (service.buildCommand) {
		return {
			builder: 'NIXPACKS',
			buildCommand: service.buildCommand,
		};
	}
	return null;
}

export function deployConfig(service: TreeseedRailwayIacService) {
	const runtimeMode = String(service.runtimeMode ?? '').trim();
	const deploy = {
		...(service.startCommand ? { startCommand: service.startCommand } : {}),
		...(service.healthcheckPath ? { healthcheckPath: service.healthcheckPath } : {}),
		...(service.healthcheckTimeoutSeconds ? { healthcheckTimeout: service.healthcheckTimeoutSeconds } : {}),
		...(typeof service.numReplicas === 'number' ? { numReplicas: service.numReplicas } : {}),
		...(runtimeMode === 'serverless' ? { sleepApplication: true } : {}),
	};
	return Object.keys(deploy).length > 0 ? deploy : null;
}

export function renderServiceEnv(service: TreeseedRailwayIacService, databaseVariableName: string | null, databaseEnvName: string | null) {
	const variables = {
		...(service.variables ?? {}),
		...(service.secrets ?? {}),
	};
	const entries = Object.entries(variables)
		.filter(([key]) => key.startsWith('TREESEED_') || key.startsWith('TREEDX_') || key === 'PORT')
		.map(([key, value]) => {
			const dbRef = databaseVariableName && databaseEnvName && key === databaseEnvName;
			return [key, dbRef ? `${databaseVariableName}.env.DATABASE_URL` : literalVariable(value)] as [string, string];
		});
	return codeObject(entries);
}

export function renderPostgresEnv() {
	return codeObject([
		['PGDATA', js('/var/lib/postgresql/data/pgdata')],
		['PGHOST', js('${{RAILWAY_PRIVATE_DOMAIN}}')],
		['PGPORT', js('5432')],
		['PGUSER', js('${{POSTGRES_USER}}')],
		['PGDATABASE', js('${{POSTGRES_DB}}')],
		['PGPASSWORD', js('${{POSTGRES_PASSWORD}}')],
		['POSTGRES_DB', js('railway')],
		['DATABASE_URL', js('postgresql://${{PGUSER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_PRIVATE_DOMAIN}}:5432/${{PGDATABASE}}')],
		['POSTGRES_USER', js('postgres')],
		['SSL_CERT_DAYS', js('820')],
		['POSTGRES_PASSWORD', '{ generator: "secret(32, \\"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\\")" }'],
		['DATABASE_PUBLIC_URL', js('postgresql://${{PGUSER}}:${{POSTGRES_PASSWORD}}@${{RAILWAY_TCP_PROXY_DOMAIN}}:${{RAILWAY_TCP_PROXY_PORT}}/${{PGDATABASE}}')],
		['RAILWAY_DEPLOYMENT_DRAINING_SECONDS', js('60')],
	]);
}

export function normalizeIacScope(input: Pick<TreeseedRailwayIacProjectInput, 'scope' | 'environmentName'>) {
	if (input.scope === 'prod' || input.scope === 'staging') return input.scope;
	const environmentName = String(input.environmentName ?? '').trim().toLowerCase();
	return environmentName === 'production' || environmentName === 'prod'
		? 'prod'
		: environmentName === 'staging'
			? 'staging'
			: 'local';
}

export function activeObservedVolumeInstances(volume: TreeseedRailwayObservedVolume) {
	return volume.instances.filter((instance) => {
		const state = String(instance.state ?? 'READY').toUpperCase();
		return instance.isPendingDeletion !== true
			&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
			&& state !== 'DELETING'
			&& state !== 'DELETED';
	});
}

export function pendingObservedVolumeInstances(volume: TreeseedRailwayObservedVolume) {
	return volume.instances.filter((instance) => {
		const state = String(instance.state ?? '').toUpperCase();
		return instance.isPendingDeletion === true
			|| Boolean(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
			|| state === 'DELETING'
			|| state === 'DELETED';
	});
}

export function findRailwayPendingVolumeNameCollisions(input: {
	services: TreeseedRailwayIacService[];
	liveServices?: TreeseedRailwayObservedService[];
	volumes: TreeseedRailwayObservedVolume[];
}): TreeseedRailwayPendingVolumeCollision[] {
	const serviceIdByName = new Map((input.liveServices ?? []).map((service) => [service.name, service.id]));
	return input.services.flatMap((service) => {
		if (!service.volumeMountPath) return [];
		const canonicalVolumeName = `${service.serviceName}-volume`;
		const desiredServiceId = serviceIdByName.get(service.serviceName) ?? null;
		const activeCanonicalVolumeIds = new Set(input.volumes
			.filter((volume) => volume.name === canonicalVolumeName && activeObservedVolumeInstances(volume).length > 0)
			.map((volume) => volume.id));
		return input.volumes
			.filter((volume) => volume.name === canonicalVolumeName || (
				String(volume.name ?? '').startsWith('pending-delete-')
				&& Boolean(desiredServiceId)
				&& volume.instances.some((instance) => instance.serviceId === desiredServiceId)
			))
			.filter((volume) => pendingObservedVolumeInstances(volume).length > 0)
			.filter((volume) => activeCanonicalVolumeIds.size === 0 || activeCanonicalVolumeIds.has(volume.id))
			.map((volume) => ({
				serviceName: service.serviceName,
				volumeId: volume.id,
				canonicalVolumeName,
				mountPath: service.volumeMountPath!,
				serviceId: pendingObservedVolumeInstances(volume).find((instance) => instance.serviceId)?.serviceId
					?? volume.instances.find((instance) => instance.serviceId)?.serviceId
					?? null,
			}));
	});
}
