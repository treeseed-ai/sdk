import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	runRailwayIac,
	type RailwayChangeSet,
	type RailwayIacApplyResponse,
	type RailwayIacPlanResponse,
	type ResourceNode,
} from 'railway/iac';
import { assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService } from '../../operations/services/railway-source-policy.ts';

export type TreeseedRailwayIacService = {
	key: string;
	serviceName: string;
	sourceMode?: string | null;
	sourceRepo?: string | null;
	sourceBranch?: string | null;
	sourceCommit?: string | null;
	sourceRootDirectory?: string | null;
	imageRef?: string | null;
	dockerfilePath?: string | null;
	buildCommand?: string | null;
	startCommand?: string | null;
	healthcheckPath?: string | null;
	healthcheckTimeoutSeconds?: number | null;
	runtimeMode?: string | null;
	numReplicas?: number | null;
	volumeMountPath?: string | null;
	volumeName?: string | null;
	volumeAddress?: string | null;
	variables?: Record<string, string>;
	secrets?: Record<string, string>;
	detachVolumeIds?: string[];
	customDomains?: string[];
};

export type TreeseedRailwayObservedService = {
	id: string;
	name: string;
};

export type TreeseedRailwayObservedVolumeInstance = {
	id?: string | null;
	environmentId?: string | null;
	serviceId?: string | null;
	mountPath?: string | null;
	state?: string | null;
	isPendingDeletion?: boolean | null;
	deletedAt?: string | null;
};

export type TreeseedRailwayObservedVolume = {
	id: string;
	name?: string | null;
	instances: TreeseedRailwayObservedVolumeInstance[];
};

export type TreeseedRailwayVolumeBinding = {
	serviceName: string;
	volumeId: string;
	volumeName: string;
	canonicalVolumeName: string;
	mode: 'canonical' | 'environment-owned' | 'shared-legacy';
	reason: string;
};

export type TreeseedRailwayVolumeBindingResult = {
	bindings: TreeseedRailwayVolumeBinding[];
	blockedReasons: string[];
};

export type TreeseedRailwayPendingVolumeCollision = {
	serviceName: string;
	volumeId: string;
	canonicalVolumeName: string;
	mountPath: string;
	serviceId: string | null;
};

export type TreeseedRailwayIacDatabase = {
	serviceName: string;
	environmentVariable: string;
	mountPath?: string | null;
	detachVolumeIds?: string[];
	useNativePostgres?: boolean;
};

export type TreeseedRailwayIacProjectInput = {
	tenantRoot: string;
	scope?: string | null;
	projectName: string;
	projectId: string;
	environmentName: string;
	environmentId: string;
	railwayApiToken: string;
	railwayApiUrl?: string | null;
	services: TreeseedRailwayIacService[];
	database: TreeseedRailwayIacDatabase | null;
	retainedResources?: ResourceNode[];
	region?: string | null;
};

export type TreeseedRailwayIacRenderResult = {
	filePath: string;
	tempDir: string;
	projectName: string;
	environmentName: string;
	serviceNames: string[];
	volumeNames: string[];
	databaseName: string | null;
	retainedResourceNames: string[];
	source: string;
};

export type RailwayIacValidationResult = {
	ok: boolean;
	destructiveChanges: string[];
	blockedReasons: string[];
	allowedDrift: string[];
};

export async function waitForRailwayVolumeAdoptionResources<TService, TVolume>({
	load,
	serviceName,
	volumeId,
	attempts = 12,
	intervalMs = 2_500,
	sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: {
	load: () => Promise<{ services: Array<TService & { name?: string | null }>; volumes: Array<TVolume & { id?: string | null }> }>;
	serviceName: string;
	volumeId: string;
	attempts?: number;
	intervalMs?: number;
	sleep?: (milliseconds: number) => Promise<unknown>;
}) {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const current = await load();
		const service = current.services.find((candidate) => candidate.name === serviceName) ?? null;
		const volume = current.volumes.find((candidate) => candidate.id === volumeId) ?? null;
		if (service && volume) return { service, volume, services: current.services, volumes: current.volumes, attempt };
		if (attempt < attempts) await sleep(intervalMs);
	}
	return null;
}

export async function waitForRailwayServices<TService extends { name?: string | null }>({
	load,
	serviceNames,
	attempts = 12,
	intervalMs = 2_500,
	sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: {
	load: () => Promise<TService[]>;
	serviceNames: Iterable<string>;
	attempts?: number;
	intervalMs?: number;
	sleep?: (milliseconds: number) => Promise<unknown>;
}) {
	const expected = [...new Set(serviceNames)];
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const services = await load();
		const observed = new Set(services.map((service) => service.name).filter(Boolean));
		if (expected.every((name) => observed.has(name))) return { services, attempt };
		if (attempt < attempts) await sleep(intervalMs);
	}
	return null;
}

export async function waitForRailwayVolumeName<TVolume extends { id?: string | null; name?: string | null }>({
	load,
	volumeId,
	expectedName,
	attempts = 12,
	intervalMs = 2_500,
	sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: {
	load: () => Promise<TVolume[]>;
	volumeId: string;
	expectedName: string;
	attempts?: number;
	intervalMs?: number;
	sleep?: (milliseconds: number) => Promise<unknown>;
}) {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const volume = (await load()).find((candidate) => candidate.id === volumeId) ?? null;
		if (volume?.name === expectedName) return { volume, attempt };
		if (attempt < attempts) await sleep(intervalMs);
	}
	return null;
}

export async function waitForRailwayVolumeDetachment<TVolume extends {
	id?: string | null;
	instances?: Array<{ environmentId?: string | null; serviceId?: string | null }>;
}>({
	load,
	volumeId,
	environmentId,
	serviceId,
	attempts = 12,
	intervalMs = 2_500,
	sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: {
	load: () => Promise<TVolume[]>;
	volumeId: string;
	environmentId: string;
	serviceId: string;
	attempts?: number;
	intervalMs?: number;
	sleep?: (milliseconds: number) => Promise<unknown>;
}) {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		const volume = (await load()).find((candidate) => candidate.id === volumeId) ?? null;
		const attached = volume?.instances?.some((instance) =>
			instance.environmentId === environmentId && instance.serviceId === serviceId,
		) ?? false;
		if (!attached) return { volume, attempt };
		if (attempt < attempts) await sleep(intervalMs);
	}
	return null;
}

export async function waitForRailwayServiceAbsence<TService extends { id?: string | null }>({
	load,
	serviceId,
	attempts = 12,
	intervalMs = 2_500,
	sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
}: {
	load: () => Promise<TService[]>;
	serviceId: string;
	attempts?: number;
	intervalMs?: number;
	sleep?: (milliseconds: number) => Promise<unknown>;
}) {
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		if (!(await load()).some((service) => service.id === serviceId)) return { attempt };
		if (attempt < attempts) await sleep(intervalMs);
	}
	return null;
}

const STALE_RAILWAY_IAC_RENDER_AGE_MS = 15 * 60 * 1000;

export function cleanupStaleRailwayIacRenders(tenantRoot: string, now = Date.now()) {
	const tempParent = resolve(tenantRoot, '.treeseed', 'tmp');
	let entries: string[];
	try {
		entries = readdirSync(tempParent);
	} catch {
		return [];
	}
	const removed: string[] = [];
	for (const entry of entries.filter((name) => name.startsWith('railway-iac-'))) {
		const path = resolve(tempParent, entry);
		try {
			if (now - statSync(path).mtimeMs < STALE_RAILWAY_IAC_RENDER_AGE_MS) continue;
			rmSync(path, { recursive: true, force: true });
			removed.push(path);
		} catch {
			// A concurrent process may have completed and removed its own directory.
		}
	}
	return removed;
}

export function railwayIacApplyFailure(response: RailwayIacApplyResponse) {
	const diagnostics = (response.diagnostics ?? [])
		.map((entry) => String(entry.message ?? '').trim())
		.filter(Boolean);
	if (!response.ok) return diagnostics.join('; ') || 'Railway IaC planning failed before apply.';
	const changes = response.changeSet?.changes ?? [];
	if (changes.length === 0) return null;
	if (!response.applyResult) return 'Railway IaC returned no apply result for a non-empty change set.';
	const successfulStatuses = new Set(['APPLIED', 'COMPLETED', 'SUCCESS', 'SUCCEEDED']);
	const applyStatus = String(response.applyResult.status ?? '').trim().toUpperCase();
	const failedChanges = (response.applyResult.changes ?? [])
		.filter((change) => !successfulStatuses.has(String(change.status ?? '').trim().toUpperCase()))
		.map((change) => `${change.path ?? change.kind}: ${change.status || 'unknown'}`);
	const applyDiagnostics = (response.applyResult.diagnostics ?? [])
		.map((entry) => typeof entry === 'string' ? entry : JSON.stringify(entry))
		.filter(Boolean);
	if (!successfulStatuses.has(applyStatus) || failedChanges.length > 0 || applyDiagnostics.length > 0) {
		return [
			`apply status ${applyStatus || 'unknown'}`,
			...failedChanges,
			...diagnostics,
			...applyDiagnostics,
		].join('; ');
	}
	return null;
}

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

function js(value: unknown) {
	return JSON.stringify(value);
}

function id(prefix: string, index: number) {
	return `${prefix}${index}`;
}

function codeObject(entries: Array<[string, string | null | undefined]>) {
	const rendered = entries
		.filter(([, value]) => typeof value === 'string' && value.length > 0)
		.map(([key, value]) => `${js(key)}: ${value}`);
	return rendered.length > 0 ? `{\n${rendered.map((line) => `      ${line}`).join(',\n')}\n    }` : '{}';
}

function literalVariable(value: string) {
	return js(value);
}

function validateGeneratedVariables(service: TreeseedRailwayIacService) {
	const keys = [...Object.keys(service.variables ?? {}), ...Object.keys(service.secrets ?? {})];
	const isTreeDxService = service.serviceName.includes('treedx') || service.key.includes('treedx');
	return keys.filter((key) => {
		if (key === 'PORT') return false;
		if (key.startsWith('TREESEED_')) return false;
		if (isTreeDxService && key.startsWith('TREEDX_')) return false;
		return true;
	});
}

function serviceSource(service: TreeseedRailwayIacService) {
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

function buildConfig(service: TreeseedRailwayIacService) {
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

function deployConfig(service: TreeseedRailwayIacService) {
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

function renderServiceEnv(service: TreeseedRailwayIacService, databaseVariableName: string | null, databaseEnvName: string | null) {
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

function renderPostgresEnv() {
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

function normalizeIacScope(input: Pick<TreeseedRailwayIacProjectInput, 'scope' | 'environmentName'>) {
	if (input.scope === 'prod' || input.scope === 'staging') return input.scope;
	const environmentName = String(input.environmentName ?? '').trim().toLowerCase();
	return environmentName === 'production' || environmentName === 'prod'
		? 'prod'
		: environmentName === 'staging'
			? 'staging'
			: 'local';
}

function activeObservedVolumeInstances(volume: TreeseedRailwayObservedVolume) {
	return volume.instances.filter((instance) => {
		const state = String(instance.state ?? 'READY').toUpperCase();
		return instance.isPendingDeletion !== true
			&& !(typeof instance.deletedAt === 'string' && instance.deletedAt.trim())
			&& state !== 'DELETING'
			&& state !== 'DELETED';
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
		return input.volumes
			.filter((volume) => volume.name === canonicalVolumeName || (
				String(volume.name ?? '').startsWith('pending-delete-')
				&& Boolean(desiredServiceId)
				&& volume.instances.some((instance) => instance.serviceId === desiredServiceId)
			))
			.filter((volume) => volume.instances.length > 0 && activeObservedVolumeInstances(volume).length === 0)
			.map((volume) => ({
				serviceName: service.serviceName,
				volumeId: volume.id,
				canonicalVolumeName,
				mountPath: service.volumeMountPath!,
				serviceId: volume.instances.find((instance) => instance.serviceId)?.serviceId ?? null,
			}));
	});
}

export function resolveRailwayIacVolumeBindings(input: {
	environmentId: string;
	services: TreeseedRailwayIacService[];
	liveServices: TreeseedRailwayObservedService[];
	volumes: TreeseedRailwayObservedVolume[];
}): TreeseedRailwayVolumeBindingResult {
	const bindings: TreeseedRailwayVolumeBinding[] = [];
	const blockedReasons: string[] = [];
	const serviceIdByName = new Map(input.liveServices.map((service) => [service.name, service.id]));

	for (const service of input.services.filter((candidate) => Boolean(candidate.volumeMountPath))) {
		const canonicalVolumeName = `${service.serviceName}-volume`;
		const desiredServiceId = serviceIdByName.get(service.serviceName) ?? null;
		const canonical = input.volumes.flatMap((volume) =>
			activeObservedVolumeInstances(volume)
				.filter((instance) => instance.environmentId === input.environmentId && volume.name === canonicalVolumeName)
				.map((instance) => ({ volume, instance })),
		);
		const candidatesByVolume = new Map(canonical.map((candidate) => [candidate.volume.id, candidate]));
		if (candidatesByVolume.size > 1) {
			blockedReasons.push(`${service.serviceName}: ${candidatesByVolume.size} active volumes are viable in environment ${input.environmentId}; refusing ambiguous stateful volume ownership.`);
			continue;
		}
		const selected = candidatesByVolume.values().next().value as typeof candidates[number] | undefined;
		if (!selected?.volume.id || !selected.volume.name) {
			const pendingCanonicalCollision = input.volumes.some((volume) =>
				(volume.name === canonicalVolumeName || (
					String(volume.name ?? '').startsWith('pending-delete-')
					&& Boolean(desiredServiceId)
					&& volume.instances.some((instance) => instance.serviceId === desiredServiceId)
				))
				&& volume.instances.length > 0
				&& activeObservedVolumeInstances(volume).length === 0,
			);
			if (pendingCanonicalCollision) continue;
			continue;
		}
		bindings.push({
			serviceName: service.serviceName,
			volumeId: selected.volume.id,
			volumeName: selected.volume.name,
			canonicalVolumeName,
			mode: 'canonical',
			reason: selected.instance.serviceId === desiredServiceId
				? 'existing desired-service attachment'
				: 'active canonical volume',
		});
	}

	return { bindings, blockedReasons };
}

export function detachRetainedRailwayVolumeBindings(
	resources: ResourceNode[],
	bindings: TreeseedRailwayVolumeBinding[],
) {
	const movedVolumeNames = new Set(bindings.map((binding) => binding.volumeName));
	return resources.map((resource) => {
		if (resource.type !== 'service' && resource.type !== 'database') return resource;
		const attachments = Object.fromEntries(Object.entries(resource.volumeAttachments ?? {})
			.filter(([, attachment]) => !movedVolumeNames.has(String(attachment.volume).replace(/^volume\./u, ''))));
		const volumeMounts = Object.fromEntries(Object.entries(resource.volumeMounts ?? {})
			.filter(([volumeId]) => !bindings.some((binding) => binding.volumeId === volumeId)));
		let deploy = resource.deploy;
		if (deploy && Object.keys(attachments).length === 0 && Object.keys(volumeMounts).length === 0) {
			const { requiredMountPath: _requiredMountPath, ...deployWithoutMountRequirement } = deploy;
			deploy = Object.keys(deployWithoutMountRequirement).length > 0 ? deployWithoutMountRequirement : undefined;
		}
		const { volumeAttachments: _attachments, volumeMounts: _volumeMounts, ...retained } = resource;
		return {
			...retained,
			...(Object.keys(attachments).length > 0 ? { volumeAttachments: attachments } : {}),
			...(Object.keys(volumeMounts).length > 0 ? { volumeMounts } : {}),
			...(deploy ? { deploy } : {}),
		} as ResourceNode;
	});
}


export function detachRetainedRailwayCustomDomains(resources: ResourceNode[], domains: string[]) {
	const selected = new Set(domains);
	return resources.map((resource) => {
		if (resource.type !== 'service' || selected.size === 0) return resource;
		const customDomains = Object.fromEntries(Object.entries(resource.networking?.customDomains ?? {})
			.filter(([domain]) => !selected.has(domain)));
		if (Object.keys(customDomains).length === Object.keys(resource.networking?.customDomains ?? {}).length) return resource;
		const networking = { ...(resource.networking ?? {}), customDomains };
		return { ...resource, networking } as ResourceNode;
	});
}

export function renderRailwayIacProject(input: TreeseedRailwayIacProjectInput): TreeseedRailwayIacRenderResult {
	const scope = normalizeIacScope(input);
	const region = input.region?.trim() || 'us-east4-eqdc4a';
	const tempParent = resolve(input.tenantRoot, '.treeseed', 'tmp');
	cleanupStaleRailwayIacRenders(input.tenantRoot);
	mkdirSync(tempParent, { recursive: true });
	const tempDir = mkdtempSync(resolve(tempParent, 'railway-iac-'));
	const filePath = resolve(tempDir, 'railway.mjs');
	const resources: string[] = [];
	const declarations: string[] = [];
	const volumeNames: string[] = [];
	const databaseVariableName = input.database ? 'db' : null;
	const databaseEnvName = input.database?.environmentVariable ?? null;
	const desiredResourceNames = new Set([
		...input.services.map((service) => service.serviceName),
		...input.services.filter((service) => service.volumeMountPath).map((service) => `${service.serviceName}-volume`),
		...(input.database ? [input.database.serviceName, `${input.database.serviceName}-volume`] : []),
	]);
	const retainedResources = (input.retainedResources ?? []).filter((resource) => !desiredResourceNames.has(resource.name));
	if (retainedResources.length > 0) {
		declarations.push(`  const retainedResources = ${js(retainedResources)};`);
		resources.push('...retainedResources');
	}
	if (input.database) {
		const postgresVolumeName = `${input.database.serviceName}-volume`;
		const postgresMountPath = input.database.mountPath?.trim() || '/var/lib/postgresql/data';
		volumeNames.push(postgresVolumeName);
		if (input.database.useNativePostgres) {
			declarations.push(`  const dbVolume = volume(${js(postgresVolumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})});`);
			declarations.push(`  const db = postgres(${js(input.database.serviceName)}, ${js({ region })});`);
			resources.push('dbVolume', 'db');
		} else {
			const postgresMounts = [
				...(input.database.detachVolumeIds ?? []).map((volumeId) => `${js(volumeId)}: null`),
				`${js(postgresMountPath)}: dbVolume`,
			];
			declarations.push(`  const dbVolume = volume(${js(postgresVolumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})});`);
			declarations.push(`  const db = service(${js(input.database.serviceName)}, {
    source: image("ghcr.io/railwayapp-templates/postgres-ssl:18"),
    env: ${renderPostgresEnv()},
    deploy: {
      requiredMountPath: ${js(postgresMountPath)},
      region: ${js(region)}
    },
    volumeMounts: { ${postgresMounts.join(', ')} }
  });`);
			resources.push('dbVolume', 'db');
		}
	}
	input.services.forEach((service, index) => {
		assertApiRailwaySourcePolicy(scope, service);
		const serviceVar = id('svc', index);
		const invalidVariables = validateGeneratedVariables(service);
		if (invalidVariables.length > 0) {
			throw new Error(`Railway IaC service ${service.serviceName} has invalid generated variables: ${invalidVariables.join(', ')}.`);
		}
		const entries = [
			`source: ${serviceSource(service)}`,
			`env: ${renderServiceEnv(service, databaseVariableName, databaseEnvName)}`,
		];
		const build = buildConfig(service);
		const deploy = deployConfig(service);
		if (build) entries.push(`build: ${js(build)}`);
		if (deploy) entries.push(`deploy: ${js(deploy)}`);
		entries.push(`regions: ${js({ [region]: 1 })}`);
		if ((service.customDomains?.length ?? 0) > 0) {
			entries.push(`networking: ${js({
				customDomains: Object.fromEntries(service.customDomains!.map((domain) => [domain, {}])),
			})}`);
		}
		if (service.volumeMountPath) {
			const volumeName = service.volumeName?.trim() || `${service.serviceName}-volume`;
			const volumeAddress = service.volumeAddress?.trim() || null;
			const volumeVar = id('vol', index);
			const volumeMounts = [
				...(service.detachVolumeIds ?? []).map((volumeId) => `${js(volumeId)}: null`),
				`${js(service.volumeMountPath)}: ${volumeVar}`,
			];
			volumeNames.push(volumeName);
			declarations.push(`  const ${volumeVar} = ${volumeAddress ? 'Object.assign(' : ''}volume(${js(volumeName)}, ${js({
				region,
				sizeMB: 50000,
				allowOnlineResize: true,
				alerts: { usage: { 80: {}, 95: {}, 100: {} } },
			})})${volumeAddress ? `, { address: ${js(volumeAddress)} })` : ''};`);
			entries.push(`volumeMounts: { ${volumeMounts.join(', ')} }`);
			resources.push(volumeVar);
		}
		declarations.push(`  const ${serviceVar} = service(${js(service.serviceName)}, {\n    ${entries.join(',\n    ')}\n  });`);
		resources.push(serviceVar);
	});
	const source = `
import { defineRailway, empty, github, image, postgres, project, service, volume, preserve } from "railway/iac";

export default defineRailway(() => {
${declarations.join('\n')}
  return project(${js(input.projectName)}, { resources: [${resources.join(', ')}] });
});
`.trimStart();
	writeFileSync(filePath, source);
	return {
		filePath,
		tempDir,
		projectName: input.projectName,
		environmentName: input.environmentName,
		serviceNames: input.services.map((service) => service.serviceName),
		volumeNames,
		databaseName: input.database?.serviceName ?? null,
		retainedResourceNames: retainedResources.map((resource) => resource.name),
		source,
	};
}

export function selectRailwayIacRetainedResources(
	plan: Pick<RailwayIacPlanResponse, 'changeSet' | 'currentGraph'>,
	allowedNames: Iterable<string>,
): ResourceNode[] {
	const allowed = new Set(allowedNames);
	return (plan.currentGraph?.resources ?? []).filter((resource) => allowed.has(resource.name));
}

function changeName(change: any) {
	const directName = String(change?.resource?.name ?? change?.previous?.name ?? '').trim();
	if (directName) return directName;
	const location = String(change?.address ?? change?.path ?? '').trim();
	const pathMatch = /(?:^|\.)?(?:resources\.)?(?:service|database|volume)\.([^\.\s]+)/u.exec(location);
	if (pathMatch?.[1]) return pathMatch[1];
	const summaryMatch = /\b(?:service|database|volume)\s+([^\s]+)/iu.exec(String(change?.summary ?? ''));
	return summaryMatch?.[1] ?? location;
}

function changeFieldText(change: any) {
	return [
		change?.field,
		change?.path,
		change?.address,
		change?.summary,
	].map((value) => String(value ?? '').toLowerCase()).join(' ');
}

function isRailwaySourceChange(change: any) {
	const field = String(change?.field ?? '').toLowerCase();
	const path = String(change?.path ?? '').toLowerCase();
	const summary = String(change?.summary ?? '').toLowerCase();
	return field === 'source'
		|| /\.source\b/u.test(path)
		|| (/source/u.test(summary) && !/\b(env|environment|variable|variables)\b/u.test(summary));
}

function isRailwayImageSourceChange(change: any) {
	if (!isRailwaySourceChange(change)) return false;
	return /image|docker-image/u.test(changeFieldText(change));
}

function isRailwayGitSourceChange(change: any) {
	if (!isRailwaySourceChange(change)) return false;
	return /github|repo|branch/u.test(changeFieldText(change));
}

export function validateRailwayIacChangeSet(changeSet: RailwayChangeSet | undefined, desiredNames: {
	services: string[];
	volumes: string[];
	database: string | null;
	scope: string;
	serviceSourceModes?: Record<string, string | null | undefined>;
	serviceSourceRefs?: Record<string, string | null | undefined>;
	allowedResourceDeletions?: string[];
	protectedResourceNames?: string[];
}): RailwayIacValidationResult {
	const blockedReasons: string[] = [];
	const destructiveChanges: string[] = [];
	const desired = new Set([...desiredNames.services, ...desiredNames.volumes, ...(desiredNames.database ? [desiredNames.database] : [])]);
	const allowedResourceDeletions = new Set(desiredNames.allowedResourceDeletions ?? []);
	const protectedResourceNames = new Set(desiredNames.protectedResourceNames ?? []);
	const created = new Set((changeSet?.changes ?? [])
		.filter((change) => change.kind === 'resource.create')
		.map((change) => changeName(change)));
	for (const change of changeSet?.changes ?? []) {
		const name = changeName(change);
		const serviceName = name.replace(/^(service|database|volume)\./u, '');
		const sourceMode = desiredNames.serviceSourceModes?.[name]
			?? desiredNames.serviceSourceModes?.[serviceName]
			?? null;
		const sourceRef = desiredNames.serviceSourceRefs?.[name]
			?? desiredNames.serviceSourceRefs?.[serviceName]
			?? null;
		const sourceChanged = change.kind === 'resource.update' && isRailwaySourceChange(change);
		const imageSourceChange = sourceChanged && isRailwayImageSourceChange(change);
		const gitSourceChange = sourceChanged && isRailwayGitSourceChange(change);
		const desiredGitSource = sourceMode === 'git' && typeof sourceRef === 'string' && sourceRef.startsWith('github:');
		const desiredImageSource = sourceMode === 'image' && typeof sourceRef === 'string' && sourceRef.startsWith('image:');
		const apiPolicyService = isApiRailwaySourcePolicyService({ serviceName });
		if (protectedResourceNames.has(name) && (change.kind === 'resource.update' || change.kind === 'resource.delete')) {
			blockedReasons.push(`Railway IaC plan would ${change.kind === 'resource.delete' ? 'delete' : 'update'} sibling-environment resource ${name}.`);
		}
		if (change.kind === 'resource.delete') {
			destructiveChanges.push(change.summary);
			if (!allowedResourceDeletions.has(name) && !allowedResourceDeletions.has(serviceName)) {
				blockedReasons.push(`Railway IaC plan would delete resource ${name || change.summary}; hosting reconciliation only deletes explicitly recognized obsolete aliases. Use the explicit destroy workflow for other deletions.`);
			}
			if (desired.has(name) && !created.has(name)) {
				blockedReasons.push(`Railway IaC plan would delete desired resource ${name}.`);
			}
		}
		if (desiredNames.scope === 'staging' && sourceChanged && apiPolicyService && sourceMode === 'git' && !gitSourceChange && !desiredGitSource) {
			blockedReasons.push(`Railway IaC plan would change staging API resource ${name} source without confirming a GitHub source.`);
		}
		if (desiredNames.scope === 'staging' && sourceChanged && imageSourceChange && !(apiPolicyService && sourceMode === 'git' && (gitSourceChange || desiredGitSource))) {
			blockedReasons.push(`Railway IaC plan would switch staging resource ${name} to an image source.`);
		}
		if (desiredNames.scope === 'staging' && sourceChanged && (!sourceMode || sourceMode === 'image')) {
			blockedReasons.push(`Railway IaC plan would apply an image-backed desired source to staging resource ${name}.`);
		}
		if (desiredNames.scope === 'prod' && sourceChanged && apiPolicyService && sourceMode === 'image' && !imageSourceChange && !desiredImageSource) {
			blockedReasons.push(`Railway IaC plan would change production API resource ${name} source without confirming an image source.`);
		}
		if (desiredNames.scope === 'prod' && sourceChanged && gitSourceChange) {
			blockedReasons.push(`Railway IaC plan would switch production resource ${name} to a Git source.`);
		}
		if (desiredNames.scope === 'prod' && sourceChanged && (!sourceMode || sourceMode === 'git')) {
			blockedReasons.push(`Railway IaC plan would apply a Git-backed desired source to production resource ${name}.`);
		}
	}
	return {
		ok: blockedReasons.length === 0,
		destructiveChanges,
		blockedReasons,
		allowedDrift: [],
	};
}

export async function planRailwayIacProject(input: TreeseedRailwayIacProjectInput, rendered = renderRailwayIacProject(input)): Promise<RailwayIacPlanResponse> {
	return runRailwayIacWithRateLimitRetry(() => runRailwayIac({
		command: 'plan',
		cwd: rendered.tempDir,
		file: rendered.filePath,
		backboard: {
			endpoint: input.railwayApiUrl?.trim() || undefined,
			token: input.railwayApiToken,
			authType: 'bearer',
			projectId: input.projectId,
			environmentId: input.environmentId,
			decryptVariables: false,
			merge: true,
		},
		}) as Promise<RailwayIacPlanResponse>, {
			onRetry: (attempt, delayMs, error) => process.stderr.write(`[trsd][railway][iac:retry] command=plan attempt=${attempt} waitMs=${delayMs} reason=${error instanceof Error ? error.message : String(error)}\n`),
			onWait: (attempt, remainingMs) => process.stderr.write(`[trsd][railway][iac:retry] command=plan attempt=${attempt} cooldownRemainingMs=${remainingMs}\n`),
		});
}

export async function applyRailwayIacProject(input: TreeseedRailwayIacProjectInput, rendered = renderRailwayIacProject(input)): Promise<RailwayIacApplyResponse> {
	return runRailwayIacWithRateLimitRetry(() => runRailwayIac({
		command: 'apply',
		cwd: rendered.tempDir,
		file: rendered.filePath,
		backboard: {
			endpoint: input.railwayApiUrl?.trim() || undefined,
			token: input.railwayApiToken,
			authType: 'bearer',
			projectId: input.projectId,
			environmentId: input.environmentId,
			decryptVariables: false,
			merge: true,
		},
		}) as Promise<RailwayIacApplyResponse>, {
			onRetry: (attempt, delayMs, error) => process.stderr.write(`[trsd][railway][iac:retry] command=apply attempt=${attempt} waitMs=${delayMs} reason=${error instanceof Error ? error.message : String(error)}\n`),
			onWait: (attempt, remainingMs) => process.stderr.write(`[trsd][railway][iac:retry] command=apply attempt=${attempt} cooldownRemainingMs=${remainingMs}\n`),
		});
}

export function cleanupRailwayIacRender(rendered: Pick<TreeseedRailwayIacRenderResult, 'tempDir'>) {
	rmSync(rendered.tempDir, { recursive: true, force: true });
}
