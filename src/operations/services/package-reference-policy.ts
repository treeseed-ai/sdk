import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverTreeseedPackageAdapters } from './package-adapters.ts';
import { workspacePackages, workspaceRoot } from './workspace-tools.ts';

export type DevDependencyReferenceMode = 'git-commit';
export type GitDependencyProtocol = 'preserve-origin' | 'https' | 'ssh';

export type PackageDependencyReference = {
	packageName: string;
	version: string;
	spec: string;
	manifestSpec: string;
	installSpec: string;
	tagName: string | null;
	remoteUrl: string | null;
	mode: 'stable-semver' | 'dev-git-commit';
};

export type RewrittenDevReference = {
	packageName: string;
	field: string;
	from: string;
	to: string;
	tagName: string | null;
};

const INTERNAL_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];

function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function writeJson(filePath: string, value: Record<string, unknown>) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function internalDependencyFields(packageJson: Record<string, unknown> | null) {
	if (!packageJson) return [];
	return INTERNAL_DEPENDENCY_FIELDS
		.filter((field) => packageJson[field] && typeof packageJson[field] === 'object' && !Array.isArray(packageJson[field]));
}

export function isPrereleaseVersion(version: string) {
	return /^[~^]?\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/u.test(String(version).trim());
}

export function isStableVersion(version: string) {
	return /^\d+\.\d+\.\d+$/u.test(String(version).trim());
}

export function isGitDependencySpec(spec: string) {
	return /^(?:git\+|github:|gitlab:|bitbucket:|ssh:\/\/|https:\/\/|file:)/u.test(String(spec).trim())
		&& String(spec).includes('#');
}

export function devTagFromDependencySpec(spec: string) {
	const value = String(spec).trim();
	const hashIndex = value.lastIndexOf('#');
	if (hashIndex === -1) return null;
	const ref = decodeURIComponent(value.slice(hashIndex + 1));
	return ref.includes('-dev.') ? ref : null;
}

export function releaseTagFromDependencySpec(spec: string) {
	const value = String(spec).trim();
	const hashIndex = value.lastIndexOf('#');
	if (hashIndex === -1) return null;
	const ref = decodeURIComponent(value.slice(hashIndex + 1));
	return isStableVersion(ref) ? ref : null;
}

export function normalizeGitRemoteForDependency(remoteUrl: string, protocol: GitDependencyProtocol = 'preserve-origin') {
	const remote = String(remoteUrl).trim();
	if (!remote) return null;
	if (/^file:\/\//u.test(remote)) return remote;
	if (remote.startsWith('/') || remote.startsWith('./') || remote.startsWith('../')) {
		return `git+${pathToFileURL(remote).href}`;
	}
	if (remote.endsWith('.git') && existsSync(remote)) {
		return `git+${pathToFileURL(remote).href}`;
	}
	const sshMatch = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/u);
	if (sshMatch) {
		if (protocol === 'https') {
			return `git+https://${sshMatch[1]}/${sshMatch[2]}.git`;
		}
		return `git+ssh://git@${sshMatch[1]}/${sshMatch[2]}.git`;
	}
	const httpsMatch = remote.match(/^https:\/\/([^/]+)\/(.+?)(?:\.git)?$/u);
	if (httpsMatch) {
		if (protocol === 'ssh') {
			return `git+ssh://git@${httpsMatch[1]}/${httpsMatch[2]}.git`;
		}
		return `git+https://${httpsMatch[1]}/${httpsMatch[2]}.git`;
	}
	if (/^ssh:\/\//u.test(remote)) return `git+${remote}`;
	if (/^git\+/u.test(remote)) return remote;
	return remote;
}

export function normalizeGitRemoteForManifest(remoteUrl: string, protocol: GitDependencyProtocol = 'preserve-origin') {
	const dependencyRemote = normalizeGitRemoteForDependency(remoteUrl, protocol);
	if (!dependencyRemote) return null;
	const githubSshMatch = dependencyRemote.match(/^git\+ssh:\/\/git@github\.com\/(.+?)(?:\.git)?$/u);
	if (githubSshMatch) {
		return `github:${githubSshMatch[1]}`;
	}
	const githubHttpsMatch = dependencyRemote.match(/^git\+https:\/\/github\.com\/(.+?)(?:\.git)?$/u);
	if (githubHttpsMatch) {
		return `github:${githubHttpsMatch[1]}`;
	}
	return dependencyRemote;
}

export function createPackageDependencyReference(input: {
	packageName: string;
	version: string;
	branchMode: 'package-release-main' | 'package-dev-save';
	remoteUrl?: string | null;
	commitSha?: string | null;
	devDependencyReferenceMode?: DevDependencyReferenceMode;
	gitDependencyProtocol?: GitDependencyProtocol;
}): PackageDependencyReference {
	if (input.branchMode === 'package-release-main') {
		return {
			packageName: input.packageName,
			version: input.version,
			spec: input.version,
			manifestSpec: input.version,
			installSpec: input.version,
			tagName: input.version,
			remoteUrl: input.remoteUrl ?? null,
			mode: 'stable-semver',
		};
	}
	const installRemote = normalizeGitRemoteForDependency(input.remoteUrl ?? '', input.gitDependencyProtocol ?? 'preserve-origin');
	const manifestRemote = normalizeGitRemoteForManifest(input.remoteUrl ?? '', input.gitDependencyProtocol ?? 'preserve-origin');
	if (!installRemote || !manifestRemote) {
		throw new Error(`Unable to create Git dependency for ${input.packageName}; origin remote is missing.`);
	}
	const ref = String(input.commitSha ?? '').trim();
	if (!ref) {
		throw new Error(`Unable to create commit dependency for ${input.packageName}; commit SHA is missing.`);
	}
	const manifestSpec = `${manifestRemote}#${ref}`;
	return {
		packageName: input.packageName,
		version: input.version,
		spec: manifestSpec,
		manifestSpec,
		installSpec: manifestSpec,
		tagName: null,
		remoteUrl: input.remoteUrl ?? null,
		mode: 'dev-git-commit',
	};
}

export function updateInternalDependencySpecs(
	packageJson: Record<string, unknown> | null,
	references: Map<string, PackageDependencyReference>,
) {
	if (!packageJson) return [];
	const changed: RewrittenDevReference[] = [];
	for (const field of internalDependencyFields(packageJson)) {
		const values = packageJson[field] as Record<string, unknown>;
		for (const [depName, reference] of references.entries()) {
			if (!(depName in values)) continue;
			const current = String(values[depName]);
			const nextSpec = reference.manifestSpec ?? reference.spec;
			if (current === nextSpec) continue;
			values[depName] = nextSpec;
			changed.push({
				packageName: depName,
				field,
				from: current,
				to: nextSpec,
				tagName: devTagFromDependencySpec(current) ?? (isPrereleaseVersion(current) ? current : null),
			});
		}
	}
	return changed;
}

export function installableInternalDependencyVersions(root = workspaceRoot(), versions: Map<string, string>) {
	const installablePackages = new Set<string>();
	for (const adapter of discoverTreeseedPackageAdapters(root)) {
		if (adapter.publishTarget === 'npm' || publicNpmPackageManifest(adapter.dir)) {
			installablePackages.add(adapter.id);
			installablePackages.add(adapter.name);
		}
	}
	return new Map([...versions.entries()].filter(([packageName]) => installablePackages.has(packageName)));
}

function publicNpmPackageManifest(packageRoot: string) {
	const packageJsonPath = resolve(packageRoot, 'package.json');
	if (!existsSync(packageJsonPath)) return false;
	const packageJson = readJson(packageJsonPath);
	if (packageJson.private === true) return false;
	const publishConfig = packageJson.publishConfig;
	return Boolean(publishConfig && typeof publishConfig === 'object' && (publishConfig as Record<string, unknown>).access === 'public');
}

export function rewriteInternalDependenciesToStableVersions(root = workspaceRoot(), versions: Map<string, string>) {
	const rewrites: Array<RewrittenDevReference & { repoName: string; packageJsonPath: string }> = [];
	const installableVersions = installableInternalDependencyVersions(root, versions);
	for (const pkg of workspacePackages(root)) {
		const packageJsonPath = resolve(pkg.dir, 'package.json');
		const packageJson = readJson(packageJsonPath);
		const changed = updateInternalDependencySpecs(
			packageJson,
			new Map([...installableVersions.entries()].map(([packageName, version]) => [packageName, {
				packageName,
				version,
				spec: version,
				manifestSpec: version,
				installSpec: version,
				tagName: version,
				remoteUrl: null,
				mode: 'stable-semver' as const,
			}])),
		);
		if (changed.length === 0) continue;
		writeJson(packageJsonPath, packageJson);
		rewrites.push(...changed.map((entry) => ({
			...entry,
			repoName: pkg.name,
			packageJsonPath,
		})));
	}
	return rewrites;
}

export function rewriteProjectInternalDependenciesToStableVersions(
	root = workspaceRoot(),
	versions: Map<string, string>,
	targetPackageNames?: ReadonlySet<string>,
) {
	const rewrites: Array<RewrittenDevReference & { repoName: string; packageJsonPath: string }> = [];
	const installableVersions = installableInternalDependencyVersions(root, versions);
	const targets = [
		{ name: '@treeseed/market', dir: root },
		...workspacePackages(root)
			.filter((pkg) => !targetPackageNames || targetPackageNames.has(pkg.name))
			.map((pkg) => ({ name: pkg.name, dir: pkg.dir })),
	];
	for (const target of targets) {
		const packageJsonPath = resolve(target.dir, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const packageJson = readJson(packageJsonPath);
		const changed = updateInternalDependencySpecs(
			packageJson,
			new Map([...installableVersions.entries()].map(([packageName, version]) => [packageName, {
				packageName,
				version,
				spec: version,
				manifestSpec: version,
				installSpec: version,
				tagName: version,
				remoteUrl: null,
				mode: 'stable-semver' as const,
			}])),
		);
		if (changed.length === 0) continue;
		writeJson(packageJsonPath, packageJson);
		rewrites.push(...changed.map((entry) => ({
			...entry,
			repoName: target.name,
			packageJsonPath,
		})));
	}
	return rewrites;
}

export function collectInternalDevReferenceIssues(root = workspaceRoot(), packageNames = new Set(workspacePackages(root).map((pkg) => pkg.name))) {
	const issues: Array<{ repoName: string; filePath: string; field?: string; dependencyName?: string; spec: string; reason: string }> = [];
	const manifestRoots = [
		{ name: '@treeseed/market', dir: root },
		...workspacePackages(root).map((pkg) => ({ name: pkg.name, dir: pkg.dir })),
	];
	for (const pkg of manifestRoots) {
		const packageJsonPath = resolve(pkg.dir, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const packageJson = readJson(packageJsonPath);
		for (const field of internalDependencyFields(packageJson)) {
			const values = packageJson[field] as Record<string, unknown>;
			for (const [depName, specValue] of Object.entries(values)) {
				if (!packageNames.has(depName)) continue;
				const spec = String(specValue);
				if (isGitDependencySpec(spec)) {
					issues.push({ repoName: pkg.name, filePath: packageJsonPath, field, dependencyName: depName, spec, reason: releaseTagFromDependencySpec(spec) ? 'git-release-ref' : 'git-dev-ref' });
				} else if (isPrereleaseVersion(spec)) {
					issues.push({ repoName: pkg.name, filePath: packageJsonPath, field, dependencyName: depName, spec, reason: 'prerelease-dev-ref' });
				}
			}
		}
	}
	const lockRoots = [{ name: '@treeseed/market', dir: root }, ...workspacePackages(root).map((pkg) => ({ name: pkg.name, dir: pkg.dir }))];
	for (const lockRoot of lockRoots) {
		for (const lockName of ['package-lock.json', 'npm-shrinkwrap.json']) {
			const lockPath = resolve(lockRoot.dir, lockName);
			if (!existsSync(lockPath)) continue;
			const lockfile = readJson(lockPath);
			const packageEntries = lockfile.packages && typeof lockfile.packages === 'object'
				? Object.values(lockfile.packages as Record<string, unknown>)
				: [];
			for (const packageName of packageNames) {
				const entries = [
					lockfile.dependencies?.[packageName],
					...packageEntries
						.map((entry) => entry && typeof entry === 'object' ? (entry as Record<string, unknown>).dependencies?.[packageName] : null),
				];
				for (const entry of entries) {
					if (!entry || typeof entry !== 'object') continue;
					const record = entry as Record<string, unknown>;
					const spec = [
						record.version,
						record.resolved,
						record.from,
					].map((value) => typeof value === 'string' ? value : '').find((value) =>
						isGitDependencySpec(value) || devTagFromDependencySpec(value) || isPrereleaseVersion(value),
					);
					if (spec) {
						issues.push({ repoName: lockRoot.name, filePath: lockPath, spec, reason: releaseTagFromDependencySpec(spec) ? 'lockfile-git-release-ref' : 'lockfile-dev-ref', dependencyName: packageName });
					}
				}
			}
		}
	}
	return issues;
}

export function collectDevelopmentCommitReferenceIssues(root = workspaceRoot(), packageNames = new Set(workspacePackages(root).map((pkg) => pkg.name))) {
	const issues: Array<{ repoName: string; filePath: string; field?: string; dependencyName?: string; spec: string; reason: string }> = [];
	const manifestRoots = [
		{ name: '@treeseed/market', dir: root },
		...workspacePackages(root).map((pkg) => ({ name: pkg.name, dir: pkg.dir })),
	];
	for (const pkg of manifestRoots) {
		const packageJsonPath = resolve(pkg.dir, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const packageJson = readJson(packageJsonPath);
		for (const field of internalDependencyFields(packageJson)) {
			const values = packageJson[field] as Record<string, unknown>;
			for (const [depName, specValue] of Object.entries(values)) {
				if (!packageNames.has(depName)) continue;
				const spec = String(specValue);
				if (!/^github:treeseed-ai\/[a-z0-9._-]+#[a-f0-9]{40}$/u.test(spec)) {
					issues.push({
						repoName: pkg.name,
						filePath: packageJsonPath,
						field,
						dependencyName: depName,
						spec,
						reason: isGitDependencySpec(spec)
							? 'git-ref-is-not-commit-sha'
							: isPrereleaseVersion(spec)
								? 'prerelease-ref'
								: 'non-git-commit-ref',
					});
				}
			}
		}
	}
	for (const lockRoot of manifestRoots) {
		for (const lockName of ['package-lock.json', 'npm-shrinkwrap.json']) {
			const lockPath = resolve(lockRoot.dir, lockName);
			if (!existsSync(lockPath)) continue;
			const lockfile = readJson(lockPath);
			const packageEntries = lockfile.packages && typeof lockfile.packages === 'object'
				? Object.entries(lockfile.packages as Record<string, unknown>)
				: [];
			for (const [entryPath, entry] of packageEntries) {
				if (!entry || typeof entry !== 'object') continue;
				for (const field of internalDependencyFields(entry as Record<string, unknown>)) {
					const values = (entry as Record<string, unknown>)[field] as Record<string, unknown>;
					for (const [depName, specValue] of Object.entries(values)) {
						if (!packageNames.has(depName)) continue;
						const spec = String(specValue);
						if (!/^github:treeseed-ai\/[a-z0-9._-]+#[a-f0-9]{40}$/u.test(spec)) {
							issues.push({
								repoName: lockRoot.name,
								filePath: lockPath,
								field: entryPath ? `packages.${entryPath}.${field}` : field,
								dependencyName: depName,
								spec,
								reason: isGitDependencySpec(spec) ? 'lockfile-git-ref-is-not-commit-sha' : 'lockfile-non-git-commit-ref',
							});
						}
					}
				}
			}
		}
	}
	return issues;
}

export function assertDevelopmentInternalCommitReferences(root = workspaceRoot(), packageNames?: Set<string>) {
	const issues = collectDevelopmentCommitReferenceIssues(root, packageNames);
	if (issues.length === 0) return;
	const rendered = issues
		.map((issue) => `${issue.filePath}${issue.field ? ` ${issue.field}.${issue.dependencyName}` : ''}: ${issue.reason} ${issue.spec}`)
		.join('\n');
	throw new Error(`Development and staging package references must use GitHub commit SHAs for internal Treeseed dependencies.\n${rendered}`);
}

export function assertNoInternalDevReferences(root = workspaceRoot(), packageNames?: Set<string>) {
	const issues = collectInternalDevReferenceIssues(root, packageNames);
	if (issues.length === 0) return;
	const rendered = issues
		.map((issue) => `${issue.filePath}${issue.field ? ` ${issue.field}.${issue.dependencyName}` : ''}: ${issue.reason} ${issue.spec}`)
		.join('\n');
	throw new Error(`Stable release still contains internal Git or dev dependency references; production package.json files must use plain semver npm versions.\n${rendered}`);
}
