import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
normalizeGitRemoteForDependency,
updateInternalDependencySpecs,
type PackageDependencyReference
} from '../../packages/package-reference-policy.ts';
import {
incrementVersion
} from '../../treedx/workspaces/workspace-save.ts';
import { nextDevVersion } from './classify-repo-kind.ts';
import { RepositorySaveNode,RepositorySaveOptions,emitProgress,readJson,runGit,writeJson } from './repo-kind.ts';

export function hasStagedChanges(repoDir: string) {
	try {
		return runGit(['diff', '--cached', '--name-only'], { cwd: repoDir, capture: true }).trim().length > 0;
	} catch {
		return false;
	}
}

export function updateDependencyReferences(node: RepositorySaveNode, finalizedReferences: Map<string, PackageDependencyReference>) {
	if (!node.packageJson || !node.packageJsonPath) return [];
	const changed = updateInternalDependencySpecs(node.packageJson, finalizedReferences);
	if (changed.length > 0) {
		writeJson(node.packageJsonPath, node.packageJson);
	}
	return changed;
}

export function isRootWorkspaceRepository(node: RepositorySaveNode, options: Pick<RepositorySaveOptions, 'root'>) {
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	return node.path === options.root && Array.isArray(packageJson?.workspaces);
}

export function syncDirectGitDependencyLockfileEntries(
	node: RepositorySaveNode,
	options: Pick<RepositorySaveOptions, 'onProgress'>,
	references: PackageDependencyReference[],
) {
	if (references.length === 0) return false;
	const lockfilePath = resolve(node.path, 'package-lock.json');
	if (!existsSync(lockfilePath)) return false;
	const lockfile = readJson(lockfilePath);
	const rootPackage = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
		? (lockfile.packages as Record<string, Record<string, unknown>>)['']
		: null;
	const packageEntries = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
		? lockfile.packages as Record<string, Record<string, unknown>>
		: null;
	if (!rootPackage || !packageEntries) return false;
	let changed = false;
	for (const reference of references) {
		const manifestSpec = reference.manifestSpec ?? reference.spec;
		const declaredSpec = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
			.map((field) => node.packageJson?.[field])
			.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value)))
			.map((dependencies) => dependencies[reference.packageName])
			.find((value): value is string => typeof value === 'string');
		if (declaredSpec !== manifestSpec) continue;
		const visitDependencyMaps = (value: unknown) => {
			if (!value || typeof value !== 'object') return;
			if (Array.isArray(value)) {
				for (const item of value) visitDependencyMaps(item);
				return;
			}
			const record = value as Record<string, unknown>;
			for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
				const dependencies = record[field];
				if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue;
				const dependencyMap = dependencies as Record<string, unknown>;
				const current = dependencyMap[reference.packageName];
				if (typeof current === 'string' && current !== manifestSpec) {
					dependencyMap[reference.packageName] = manifestSpec;
					changed = true;
				}
			}
			for (const nested of Object.values(record)) visitDependencyMaps(nested);
		};
		visitDependencyMaps(lockfile);
		const sourceLockfilePath = reference.sourcePath ? resolve(reference.sourcePath, 'package-lock.json') : null;
		const sourceLockfile = sourceLockfilePath && existsSync(sourceLockfilePath) ? readJson(sourceLockfilePath) : null;
		const sourcePackages = sourceLockfile?.packages && typeof sourceLockfile.packages === 'object' && !Array.isArray(sourceLockfile.packages)
			? sourceLockfile.packages as Record<string, Record<string, unknown>>
			: null;
		const sourceRoot = sourcePackages?.[''];
		const copiedDependencyEntries = new Set<string>();
		const copyMissingDependencyClosure = (dependencies: unknown) => {
			if (!sourcePackages || !dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) return;
			for (const [dependencyName, dependencySpec] of Object.entries(dependencies as Record<string, unknown>)) {
				const entryKey = `node_modules/${dependencyName}`;
				if (copiedDependencyEntries.has(entryKey)) continue;
				copiedDependencyEntries.add(entryKey);
				const sourceEntry = sourcePackages[entryKey];
				if (!sourceEntry) continue;
				const consumerDeclaresDependency = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
					.some((field) => {
						const declared = rootPackage[field];
						return Boolean(declared && typeof declared === 'object' && !Array.isArray(declared)
							&& dependencyName in (declared as Record<string, unknown>));
					});
				const exactVersion = typeof dependencySpec === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(dependencySpec)
					? dependencySpec
					: null;
				const existingEntry = packageEntries[entryKey];
				const changedGitResolution = !consumerDeclaresDependency
					&& typeof dependencySpec === 'string'
					&& dependencySpec.includes('#')
					&& typeof sourceEntry.resolved === 'string'
					&& existingEntry?.resolved !== sourceEntry.resolved;
				if (!existingEntry || (!consumerDeclaresDependency && exactVersion && existingEntry.version !== exactVersion) || changedGitResolution) {
					packageEntries[entryKey] = structuredClone(sourceEntry);
					changed = true;
				}
				copyMissingDependencyClosure(packageEntries[entryKey].dependencies);
				copyMissingDependencyClosure(packageEntries[entryKey].optionalDependencies);
			}
		};
		for (const [entryKey, entry] of Object.entries(packageEntries)) {
			if (entryKey !== `node_modules/${reference.packageName}` && !entryKey.endsWith(`/node_modules/${reference.packageName}`)) continue;
			const nextResolved = normalizeGitRemoteForDependency(reference.remoteUrl ?? '', 'ssh');
			const resolved = nextResolved ? `${nextResolved}#${manifestSpec.slice(manifestSpec.lastIndexOf('#') + 1)}` : manifestSpec;
			if (entry.resolved !== resolved) {
				entry.resolved = resolved;
				changed = true;
			}
			if (typeof reference.version === 'string' && reference.version && entry.version !== reference.version) {
				entry.version = reference.version;
				changed = true;
			}
			if ('integrity' in entry) {
				delete entry.integrity;
				changed = true;
			}
			for (const field of ['dependencies', 'optionalDependencies'] as const) {
				const sourceDependencies = sourceRoot?.[field];
				if (!sourceDependencies || typeof sourceDependencies !== 'object' || Array.isArray(sourceDependencies)) continue;
				if (JSON.stringify(entry[field] ?? {}) !== JSON.stringify(sourceDependencies)) {
					entry[field] = structuredClone(sourceDependencies);
					changed = true;
				}
				copyMissingDependencyClosure(sourceDependencies);
			}
		}
	}
	if (!changed) return false;
	writeJson(lockfilePath, lockfile);
	emitProgress(options, node, 'lockfile', 'Synchronized direct internal Git dependency lockfile entries without npm git preparation.');
	return true;
}

export function planPackageVersion(node: RepositorySaveNode, options: RepositorySaveOptions) {
	if (!node.packageJson || !node.packageJsonPath) return null;
	const current = String(node.packageJson.version ?? '0.0.0');
	return node.branchMode === 'package-release-main'
		? incrementVersion(current, options.bump ?? 'patch')
		: nextDevVersion(current, options.branch);
}

export function applyPackageVersion(node: RepositorySaveNode, version: string) {
	if (!node.packageJson || !node.packageJsonPath) return false;
	let changed = false;
	if (node.packageJson.version !== version) {
		node.packageJson.version = version;
		writeJson(node.packageJsonPath, node.packageJson);
		changed = true;
	}
	const lockfilePath = resolve(node.path, 'package-lock.json');
	if (existsSync(lockfilePath)) {
		const lockfile = readJson(lockfilePath);
		const rootEntry = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
			? (lockfile.packages as Record<string, Record<string, unknown>>)['']
			: null;
		const lockfileMatches = lockfile.version === version
			&& rootEntry?.version === version
			&& (typeof node.packageJson.name !== 'string' || rootEntry?.name === node.packageJson.name);
		if (lockfileMatches) return changed;
		lockfile.version = version;
		const packages = lockfile.packages && typeof lockfile.packages === 'object' && !Array.isArray(lockfile.packages)
			? lockfile.packages as Record<string, Record<string, unknown>>
			: {};
		packages[''] = {
			...(packages[''] ?? {}),
			...(typeof node.packageJson.name === 'string' ? { name: node.packageJson.name } : {}),
			version,
		};
		lockfile.packages = packages;
		writeJson(lockfilePath, lockfile);
		changed = true;
	}
	return changed;
}

export function shouldSkipNetworkInstall() {
	return process.env.TREESEED_SAVE_NPM_INSTALL_MODE !== 'allow';
}

export function shouldSkipGitDependencySmoke(options?: Pick<RepositorySaveOptions, 'verifyMode'>) {
	return shouldSkipNetworkInstall()
		|| process.env.TREESEED_GIT_DEPENDENCY_SMOKE === 'skip'
		|| options?.verifyMode === 'skip';
}

export function hasNpmLockfile(repoDir: string) {
	return existsSync(resolve(repoDir, 'package-lock.json')) || existsSync(resolve(repoDir, 'npm-shrinkwrap.json'));
}
