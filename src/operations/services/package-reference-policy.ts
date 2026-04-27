import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run, workspacePackages, workspaceRoot } from './workspace-tools.ts';

export type DevDependencyReferenceMode = 'git-tag' | 'registry-prerelease';
export type DevTagCleanupMode = 'safe-after-release' | 'off';
export type GitDependencyProtocol = 'preserve-origin' | 'https' | 'ssh';

export type PackageDependencyReference = {
	packageName: string;
	version: string;
	spec: string;
	manifestSpec: string;
	installSpec: string;
	tagName: string | null;
	remoteUrl: string | null;
	mode: 'stable-semver' | 'dev-git-tag' | 'dev-registry-prerelease';
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
	return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+$/u.test(String(version).trim());
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
	if ((input.devDependencyReferenceMode ?? 'git-tag') === 'registry-prerelease') {
		return {
			packageName: input.packageName,
			version: input.version,
			spec: input.version,
			manifestSpec: input.version,
			installSpec: input.version,
			tagName: input.version,
			remoteUrl: input.remoteUrl ?? null,
			mode: 'dev-registry-prerelease',
		};
	}
	const installRemote = normalizeGitRemoteForDependency(input.remoteUrl ?? '', input.gitDependencyProtocol ?? 'preserve-origin');
	const manifestRemote = normalizeGitRemoteForManifest(input.remoteUrl ?? '', input.gitDependencyProtocol ?? 'preserve-origin');
	if (!installRemote || !manifestRemote) {
		throw new Error(`Unable to create Git-tag dependency for ${input.packageName}; origin remote is missing.`);
	}
	const manifestSpec = `${manifestRemote}#${input.version}`;
	return {
		packageName: input.packageName,
		version: input.version,
		spec: manifestSpec,
		manifestSpec,
		installSpec: manifestSpec,
		tagName: input.version,
		remoteUrl: input.remoteUrl ?? null,
		mode: 'dev-git-tag',
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

export function rewriteInternalDependenciesToStableVersions(root = workspaceRoot(), versions: Map<string, string>) {
	const rewrites: Array<RewrittenDevReference & { repoName: string; packageJsonPath: string }> = [];
	for (const pkg of workspacePackages(root)) {
		const packageJsonPath = resolve(pkg.dir, 'package.json');
		const packageJson = readJson(packageJsonPath);
		const changed = updateInternalDependencySpecs(
			packageJson,
			new Map([...versions.entries()].map(([packageName, version]) => [packageName, {
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

export function collectInternalDevReferenceIssues(root = workspaceRoot(), packageNames = new Set(workspacePackages(root).map((pkg) => pkg.name))) {
	const issues: Array<{ repoName: string; filePath: string; field?: string; dependencyName?: string; spec: string; reason: string }> = [];
	for (const pkg of workspacePackages(root)) {
		const packageJsonPath = resolve(pkg.dir, 'package.json');
		const packageJson = readJson(packageJsonPath);
		for (const field of internalDependencyFields(packageJson)) {
			const values = packageJson[field] as Record<string, unknown>;
			for (const [depName, specValue] of Object.entries(values)) {
				if (!packageNames.has(depName)) continue;
				const spec = String(specValue);
				if (isGitDependencySpec(spec) || devTagFromDependencySpec(spec)) {
					issues.push({ repoName: pkg.name, filePath: packageJsonPath, field, dependencyName: depName, spec, reason: 'git-dev-ref' });
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
			const source = readFileSync(lockPath, 'utf8');
			for (const packageName of packageNames) {
				if (source.includes(`${packageName}.git#`) || source.includes(`${packageName}#`) || /-dev\.[0-9A-Za-z.-]+/u.test(source)) {
					issues.push({ repoName: lockRoot.name, filePath: lockPath, spec: packageName, reason: 'lockfile-dev-ref' });
				}
			}
		}
	}
	return issues;
}

export function assertNoInternalDevReferences(root = workspaceRoot(), packageNames?: Set<string>) {
	const issues = collectInternalDevReferenceIssues(root, packageNames);
	if (issues.length === 0) return;
	const rendered = issues
		.map((issue) => `${issue.filePath}${issue.field ? ` ${issue.field}.${issue.dependencyName}` : ''}: ${issue.reason} ${issue.spec}`)
		.join('\n');
	throw new Error(`Stable release still contains internal Git/dev dependency references.\n${rendered}`);
}

export function createDevTagMessage(input: {
	packageName: string;
	version: string;
	branch: string;
	commitSha: string;
	workflowRunId?: string | null;
	createdAt?: string;
}) {
	const branchSlug = input.branch
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40) || 'dev';
	return [
		`save: ${input.packageName} ${input.version}`,
		'',
		'treeseed-dev-tag: true',
		`package: ${input.packageName}`,
		`version: ${input.version}`,
		`branch: ${input.branch}`,
		`branchSlug: ${branchSlug}`,
		`createdAt: ${input.createdAt ?? new Date().toISOString()}`,
		`workflowRunId: ${input.workflowRunId ?? ''}`,
		`commitSha: ${input.commitSha}`,
	].join('\n');
}

export function gitTagMessage(repoDir: string, tagName: string) {
	try {
		return run('git', ['tag', '-l', tagName, '--format=%(contents)'], { cwd: repoDir, capture: true });
	} catch {
		return '';
	}
}

export function tagHasTreeseedDevMetadata(repoDir: string, tagName: string) {
	return gitTagMessage(repoDir, tagName).includes('treeseed-dev-tag: true');
}

export function cleanupDevTags(repoDir: string, tagNames: string[], activeReferences: string[] = []) {
	const active = new Set(activeReferences.filter(Boolean));
	const cleaned: string[] = [];
	const skipped: Array<{ tagName: string; reason: string }> = [];
	for (const tagName of [...new Set(tagNames.filter(Boolean))].sort()) {
		if (!tagName.includes('-dev.')) {
			skipped.push({ tagName, reason: 'not-dev-tag' });
			continue;
		}
		if (active.has(tagName)) {
			skipped.push({ tagName, reason: 'still-referenced' });
			continue;
		}
		if (!tagHasTreeseedDevMetadata(repoDir, tagName)) {
			skipped.push({ tagName, reason: 'missing-treeseed-metadata' });
			continue;
		}
		try {
			run('git', ['tag', '-d', tagName], { cwd: repoDir });
			run('git', ['push', 'origin', `:refs/tags/${tagName}`], { cwd: repoDir });
			cleaned.push(tagName);
		} catch (error) {
			skipped.push({ tagName, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return { cleaned, skipped };
}
