import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { UnitPersistedState } from '../support/contracts/contracts.ts';

export interface LocalComposeRequiredPath {
	path: string;
	kind: 'file' | 'directory';
	description: string;
}

export interface LocalComposeRequiredPathObservation extends LocalComposeRequiredPath {
	exists: boolean;
	valid: boolean;
}

function requiredPathEntries(value: unknown): LocalComposeRequiredPath[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry, index) => {
		if (typeof entry === 'string' && entry.trim()) {
			return [{ path: entry.trim(), kind: 'file' as const, description: `required host file ${index + 1}` }];
		}
		if (!entry || typeof entry !== 'object') return [];
		const record = entry as Record<string, unknown>;
		if (typeof record.path !== 'string' || !record.path.trim()) return [];
		return [{
			path: record.path.trim(),
			kind: record.kind === 'directory' ? 'directory' as const : 'file' as const,
			description: typeof record.description === 'string' && record.description.trim()
				? record.description.trim()
				: `required host path ${index + 1}`,
		}];
	});
}

export function observeLocalComposeRequiredPaths(value: unknown, tenantRoot: string): LocalComposeRequiredPathObservation[] {
	return requiredPathEntries(value).map((entry) => {
		const path = isAbsolute(entry.path) ? entry.path : resolve(tenantRoot, entry.path);
		const exists = existsSync(path);
		const valid = exists && (entry.kind === 'directory' ? statSync(path).isDirectory() : statSync(path).isFile());
		return { ...entry, path, exists, valid };
	});
}

export function localComposeRequiredPathWarnings(observations: LocalComposeRequiredPathObservation[]) {
	return observations.flatMap((entry) => entry.valid
		? []
		: [`${entry.description} is missing or is not a ${entry.kind}: ${entry.path}`]);
}

function requiredPathSignature(value: unknown) {
	if (!Array.isArray(value)) return null;
	return value.map((entry) => {
		const record = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
		return {
			path: typeof record.path === 'string' ? record.path : null,
			kind: typeof record.kind === 'string' ? record.kind : null,
			valid: record.valid === true,
		};
	});
}

export function localComposeDriftReasons(input: {
	persistedState: UnitPersistedState | null;
	desiredSpecHash: string;
	reconciledSpecHash?: string;
	configHash: unknown;
	requiredPaths: LocalComposeRequiredPathObservation[];
}) {
	const previous = input.persistedState;
	if (!previous?.lastReconciledAt) return [];
	const reasons: string[] = [];
	const previousReconciledSpecHash = typeof previous.lastReconciledState.reconciledSpecHash === 'string'
		? previous.lastReconciledState.reconciledSpecHash
		: null;
	if (previousReconciledSpecHash
		? previousReconciledSpecHash !== input.reconciledSpecHash
		: previous.desiredSpecHash !== input.desiredSpecHash) {
		reasons.push('compose desired specification changed');
	}
	const previousConfigHash = typeof previous.lastReconciledState.configHash === 'string'
		? previous.lastReconciledState.configHash
		: null;
	const currentConfigHash = typeof input.configHash === 'string' ? input.configHash : null;
	if (!previousConfigHash && currentConfigHash) {
		reasons.push('rendered compose configuration has not been reconciled');
	} else if (previousConfigHash && currentConfigHash && previousConfigHash !== currentConfigHash) {
		reasons.push('rendered compose configuration changed');
	}
	if (input.requiredPaths.length > 0) {
		const previousSignature = requiredPathSignature(previous.lastReconciledState.requiredPaths);
		const currentSignature = requiredPathSignature(input.requiredPaths);
		if (previousSignature === null) reasons.push('required host path contract has not been reconciled');
		else if (JSON.stringify(previousSignature) !== JSON.stringify(currentSignature)) reasons.push('required host path state changed');
	}
	return reasons;
}

export function localComposeReconciledSpecHash(spec: Record<string, unknown>) {
	const { forceRecreate: _forceRecreate, resetData: _resetData, ...reconciledSpec } = spec;
	return createHash('sha256').update(JSON.stringify(reconciledSpec)).digest('hex');
}

export interface LocalComposeServiceObservation {
	service: string;
	state: string;
	health: string;
}

export function parseLocalComposeServices(stdout: unknown): LocalComposeServiceObservation[] {
	if (typeof stdout !== 'string' || !stdout.trim()) return [];
	let records: unknown[] = [];
	try {
		const parsed = JSON.parse(stdout);
		records = Array.isArray(parsed) ? parsed : [parsed];
	} catch {
		records = stdout.split(/\r?\n/u).filter(Boolean).flatMap((line) => {
			try { return [JSON.parse(line)]; } catch { return []; }
		});
	}
	return records.flatMap((entry) => {
		if (!entry || typeof entry !== 'object') return [];
		const record = entry as Record<string, unknown>;
		const service = record.Service ?? record.service;
		if (typeof service !== 'string' || !service) return [];
		return [{
			service,
			state: String(record.State ?? record.state ?? '').toLowerCase(),
			health: String(record.Health ?? record.health ?? '').toLowerCase(),
		}];
	});
}

export function localComposeServiceReady(observation: LocalComposeServiceObservation | undefined) {
	return Boolean(observation && observation.state === 'running' && !['starting', 'unhealthy'].includes(observation.health));
}

export async function waitForLocalComposeServices(input: {
	serviceNames: string[];
	observe: () => LocalComposeServiceObservation[];
	attempts?: number;
	intervalMs?: number;
	wait?: (milliseconds: number) => Promise<void>;
}) {
	const attempts = Math.max(1, Math.floor(input.attempts ?? 30));
	const intervalMs = Math.max(100, Math.floor(input.intervalMs ?? 1_000));
	const wait = input.wait ?? ((milliseconds: number) => new Promise<void>((resolveWait) => setTimeout(resolveWait, milliseconds)));
	let observations: LocalComposeServiceObservation[] = [];
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		observations = input.observe();
		if (input.serviceNames.every((service) => localComposeServiceReady(observations.find((entry) => entry.service === service)))) {
			return { ready: true, attempts: attempt, observations };
		}
		if (attempt < attempts) await wait(intervalMs);
	}
	return { ready: false, attempts, observations };
}
