import { createRequire } from 'node:module';

import { dependencyFields } from './classify-repo-kind.ts';

const require = createRequire(import.meta.url);
const semver = require('semver') as {
	validRange(value: string): string | null;
	satisfies(version: string, range: string, options?: { includePrerelease?: boolean }): boolean;
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function packageEntryKey(dependencyName: string) {
	return `node_modules/${dependencyName}`;
}

/**
 * Validates the part of npm's lock contract that can be proven without network
 * access or mutating the live install. npm ci remains the authoritative full
 * verifier when publication has made every dependency ref available.
 */
export function collectLockfileManifestConsistencyIssues(packageJson: JsonObject, lockfile: JsonObject) {
	const issues: string[] = [];
	const packages = object(lockfile.packages);
	const root = object(packages?.['']);
	if (!packages || !root) return ['package-lock.json must contain an npm packages root entry'];

	for (const field of dependencyFields(packageJson)) {
		if (field === 'peerDependencies') continue;
		const manifestDependencies = object(packageJson[field]);
		if (!manifestDependencies) continue;
		const lockedDependencies = object(root[field]);
		for (const [dependencyName, dependencySpecValue] of Object.entries(manifestDependencies)) {
			if (typeof dependencySpecValue !== 'string') continue;
			const lockedSpec = lockedDependencies?.[dependencyName];
			if (lockedSpec !== dependencySpecValue) {
				issues.push(`package-lock root ${field}.${dependencyName} is ${String(lockedSpec)} instead of ${dependencySpecValue}`);
				continue;
			}
			const range = semver.validRange(dependencySpecValue);
			if (!range) continue;
			const lockedPackage = object(packages[packageEntryKey(dependencyName)]);
			if (lockedPackage?.link === true && typeof lockedPackage.resolved === 'string') continue;
			const lockedVersion = lockedPackage?.version;
			if (typeof lockedVersion !== 'string') {
				issues.push(`package-lock is missing ${packageEntryKey(dependencyName)} for ${field}.${dependencyName}`);
				continue;
			}
			if (!semver.satisfies(lockedVersion, range, { includePrerelease: true })) {
				issues.push(`package-lock ${packageEntryKey(dependencyName)} version ${lockedVersion} does not satisfy ${dependencySpecValue}`);
			}
		}
	}
	return issues;
}
