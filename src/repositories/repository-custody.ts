import { realpathSync } from 'node:fs';
import { resolve,sep } from 'node:path';
import type { RepositoryIdentity } from './repository-identity.ts';

export type RepositoryCustody = 'developer' | 'capacity-provider' | 'operations-runner' | 'treedx';

export interface RepositoryCheckoutRecord {
	repository: RepositoryIdentity;
	custody: RepositoryCustody;
	checkoutId: string;
	rootPath: string;
	gitCommonDirectory: string;
	baseRevision: string;
	currentRevision: string;
	purpose: 'development' | 'assignment' | 'integration' | 'publication' | 'content-workspace';
	ownerId: string;
	createdAt: string;
	expiresAt?: string;
}

export interface RepositoryHandoff {
	repository: RepositoryIdentity;
	sourceRevision: string;
	targetRef?: string;
	contentDigest: string;
	requestedByOperationId: string;
	sourceCustody: RepositoryCustody;
	destinationCustody: RepositoryCustody;
	remoteFetch: { remoteUrl: string; expectedObjectId: string };
}

export interface RepositoryRefLease {
	repositoryKey: string;
	ref: string;
	holderOperationId: string;
	expectedOldRevision: string;
	desiredRevision: string;
	acquiredAt: string;
	expiresAt: string;
	stateVersion: number;
}

export interface ManagedRepositoryStorageMarker {
	schema: 'treeseed.repository-storage/v1';
	custody: Exclude<RepositoryCustody, 'developer'>;
	environment: 'local' | 'staging' | 'production';
	hostPath: string;
	servicePath: string;
	writableBy: string[];
	createdAt: string;
	stateVersion: number;
	warning: 'managed-storage-do-not-edit';
}

function normalizedRealPath(path: string) {
	try { return realpathSync(path); } catch { return resolve(path); }
}

function containsPath(parent: string, child: string) {
	return child === parent || child.startsWith(`${parent}${sep}`);
}

export function repositoryStorageOverlap(leftPath: string, rightPath: string) {
	const left = normalizedRealPath(leftPath);
	const right = normalizedRealPath(rightPath);
	return containsPath(left, right) || containsPath(right, left);
}

export function assertIsolatedRepositoryStorage(input: {
	developerRoot: string;
	managedRoots: Array<{ custody: Exclude<RepositoryCustody, 'developer'>; path: string }>;
}) {
	const stateRoot = resolve(input.developerRoot, '.treeseed');
	for (const managed of input.managedRoots) {
		const root = normalizedRealPath(managed.path);
		if (!containsPath(normalizedRealPath(stateRoot), root)) {
			throw new Error(`${managed.custody} repository storage must be inside the developer workspace .treeseed state root.`);
		}
	}
	for (let index = 0; index < input.managedRoots.length; index += 1) {
		for (let other = index + 1; other < input.managedRoots.length; other += 1) {
			const left = input.managedRoots[index]!;
			const right = input.managedRoots[other]!;
			if (repositoryStorageOverlap(left.path, right.path)) {
				throw new Error(`${left.custody} and ${right.custody} repository storage overlap.`);
			}
		}
	}
}
