import { existsSync,mkdirSync,readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertIsolatedRepositoryStorage,type ManagedRepositoryStorageMarker } from '../../../repositories/repository-custody.ts';

type ManagedStorageSpec = {
	custody: ManagedRepositoryStorageMarker['custody'];
	hostPath: string;
	servicePath: string;
};

const MARKER_FILE = '.treeseed-managed-storage.json';

function storageSpec(value: unknown): ManagedStorageSpec | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (!['capacity-provider', 'treedx'].includes(String(record.custody))) return null;
	if (typeof record.hostPath !== 'string' || typeof record.servicePath !== 'string') return null;
	return record as ManagedStorageSpec;
}

export function canonicalLocalRepositoryStorageRoots(tenantRoot: string) {
	return [
		{ custody: 'capacity-provider' as const, path: resolve(tenantRoot, '.treeseed/local-capacity-provider/data') },
		{ custody: 'treedx' as const, path: resolve(tenantRoot, '.treeseed/local-treedx/data') },
	];
}

export function managedRepositoryStorageStatus(tenantRoot: string, value: unknown) {
	const spec = storageSpec(value);
	if (!spec) return { configured: false, ready: true, path: null, issues: [] as string[] };
	const hostPath = resolve(tenantRoot, spec.hostPath);
	const issues: string[] = [];
	try {
		assertIsolatedRepositoryStorage({ developerRoot: tenantRoot, managedRoots: canonicalLocalRepositoryStorageRoots(tenantRoot) });
	} catch (error) {
		issues.push(error instanceof Error ? error.message : String(error));
	}
	const markerPath = resolve(hostPath, MARKER_FILE);
	if (!existsSync(markerPath)) issues.push(`Managed repository storage marker is missing: ${markerPath}`);
	else {
		try {
			const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as ManagedRepositoryStorageMarker;
			if (marker.schema !== 'treeseed.repository-storage/v1' || marker.custody !== spec.custody || resolve(marker.hostPath) !== hostPath) {
				issues.push(`Managed repository storage marker does not match ${spec.custody} custody.`);
			}
		} catch {
			issues.push(`Managed repository storage marker is invalid: ${markerPath}`);
		}
	}
	return { configured: true, ready: issues.length === 0, path: hostPath, markerPath, issues };
}

export function ensureManagedRepositoryStorage(tenantRoot: string, value: unknown) {
	const spec = storageSpec(value);
	if (!spec) return null;
	assertIsolatedRepositoryStorage({ developerRoot: tenantRoot, managedRoots: canonicalLocalRepositoryStorageRoots(tenantRoot) });
	const hostPath = resolve(tenantRoot, spec.hostPath);
	mkdirSync(hostPath, { recursive: true });
	const markerPath = resolve(hostPath, MARKER_FILE);
	let createdAt = new Date().toISOString();
	if (existsSync(markerPath)) {
		try {
			const current = JSON.parse(readFileSync(markerPath, 'utf8')) as Partial<ManagedRepositoryStorageMarker>;
			if (current.schema === 'treeseed.repository-storage/v1' && current.custody !== spec.custody) {
				throw new Error(`Repository storage ${hostPath} is already owned by ${current.custody}.`);
			}
			if (typeof current.createdAt === 'string') createdAt = current.createdAt;
		} catch (error) {
			if (error instanceof SyntaxError) throw new Error(`Repository storage marker is invalid: ${markerPath}`);
			throw error;
		}
	}
	const marker: ManagedRepositoryStorageMarker = {
		schema: 'treeseed.repository-storage/v1',
		custody: spec.custody,
		environment: 'local',
		hostPath,
		servicePath: spec.servicePath,
		writableBy: [spec.custody],
		createdAt,
		stateVersion: 1,
		warning: 'managed-storage-do-not-edit',
	};
	writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, 'utf8');
	return marker;
}
