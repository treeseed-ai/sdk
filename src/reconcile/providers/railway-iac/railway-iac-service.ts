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
import { railwayGraphqlRequest } from '../../../operations/services/hosting/railway/railway-api.ts';
import { assertApiRailwaySourcePolicy, isApiRailwaySourcePolicyService } from '../../../operations/services/hosting/railway/railway-source-policy.ts';
import { id } from './run-railway-iac-with-rate-limit-retry.ts';

export type RailwayIacService = {
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

export type RailwayObservedService = {
	id: string;
	name: string;
};

export type RailwayObservedVolumeInstance = {
	id?: string | null;
	environmentId?: string | null;
	serviceId?: string | null;
	mountPath?: string | null;
	state?: string | null;
	isPendingDeletion?: boolean | null;
	deletedAt?: string | null;
};

export type RailwayObservedVolume = {
	id: string;
	name?: string | null;
	instances: RailwayObservedVolumeInstance[];
};

export type RailwayVolumeBinding = {
	serviceName: string;
	volumeId: string;
	volumeName: string;
	canonicalVolumeName: string;
	mode: 'canonical' | 'environment-owned' | 'shared-legacy';
	reason: string;
};

export type RailwayVolumeBindingResult = {
	bindings: RailwayVolumeBinding[];
	blockedReasons: string[];
};

export type RailwayPendingVolumeCollision = {
	serviceName: string;
	volumeId: string;
	canonicalVolumeName: string;
	mountPath: string;
	serviceId: string | null;
};

export type RailwayIacDatabase = {
	serviceName: string;
	environmentVariable: string;
	mountPath?: string | null;
	detachVolumeIds?: string[];
	useNativePostgres?: boolean;
};

export type RailwayIacProjectInput = {
	tenantRoot: string;
	scope?: string | null;
	projectName: string;
	projectId: string;
	environmentName: string;
	environmentId: string;
	railwayApiToken: string;
	railwayApiUrl?: string | null;
	services: RailwayIacService[];
	database: RailwayIacDatabase | null;
	retainedResources?: ResourceNode[];
	region?: string | null;
};

export type RailwayIacRenderResult = {
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

export const STALE_RAILWAY_IAC_RENDER_AGE_MS = 15 * 60 * 1000;

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
