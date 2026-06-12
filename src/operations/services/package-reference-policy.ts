import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { discoverTreeseedPackageAdapters } from './package-adapters.ts';
import { run, workspacePackages, workspaceRoot } from './workspace-tools.ts';

export type DevDependencyReferenceMode = 'git-tag' | 'registry-prerelease';
export type DevTagCleanupMode = 'safe-after-release' | 'off';
export type GitDependencyProtocol = 'preserve-origin' | 'https' | 'ssh';
export type DevTagBranchScope = 'staging' | 'preview' | 'all';

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

export type TreeseedDevTagInfo = {
	tagName: string;
	stableVersion: string;
	branchSlug: string;
	timestamp: string;
	metadata: Record<string, string>;
	branch: string | null;
	packageName: string | null;
	version: string | null;
};

export type StaleDevTagClassification = {
	tagName: string;
	action: 'delete' | 'skip';
	reason: string;
	info: TreeseedDevTagInfo | null;
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

function stableVersionBase(version: string) {
	const match = String(version).trim().match(/^(\d+\.\d+\.\d+)(?:-|$)/u);
	return match?.[1] ?? null;
}

function compareStableVersions(left: string, right: string) {
	const leftParts = left.split('.').map((part) => Number(part));
	const rightParts = right.split('.').map((part) => Number(part));
	for (let index = 0; index < 3; index += 1) {
		const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
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

export function installableInternalDependencyVersions(root = workspaceRoot(), versions: Map<string, string>) {
	const publishTargets = new Map<string, string>();
	for (const adapter of discoverTreeseedPackageAdapters(root)) {
		const publishTarget = adapter.publishTarget ?? 'npm';
		publishTargets.set(adapter.id, publishTarget);
		publishTargets.set(adapter.name, publishTarget);
	}
	return new Map([...versions.entries()].filter(([packageName]) => (publishTargets.get(packageName) ?? 'npm') === 'npm'));
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

export function rewriteProjectInternalDependenciesToStableVersions(root = workspaceRoot(), versions: Map<string, string>) {
	const rewrites: Array<RewrittenDevReference & { repoName: string; packageJsonPath: string }> = [];
	const installableVersions = installableInternalDependencyVersions(root, versions);
	const targets = [
		{ name: '@treeseed/market', dir: root },
		...workspacePackages(root).map((pkg) => ({ name: pkg.name, dir: pkg.dir })),
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
				if (isGitDependencySpec(spec) && !releaseTagFromDependencySpec(spec)) {
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
						(isGitDependencySpec(value) && !releaseTagFromDependencySpec(value)) || devTagFromDependencySpec(value) || isPrereleaseVersion(value),
					);
					if (spec) {
						issues.push({ repoName: lockRoot.name, filePath: lockPath, spec, reason: 'lockfile-dev-ref', dependencyName: packageName });
					}
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

function gitRemoteTagMessage(repoDir: string, tagName: string) {
	try {
		run('git', ['fetch', '--no-tags', 'origin', `refs/tags/${tagName}`], { cwd: repoDir, capture: true });
		return run('git', ['cat-file', '-p', 'FETCH_HEAD'], { cwd: repoDir, capture: true });
	} catch {
		return '';
	}
}

function gitDevTagMessage(repoDir: string, tagName: string) {
	const local = gitTagMessage(repoDir, tagName);
	if (local.trim()) return local;
	return gitRemoteTagMessage(repoDir, tagName);
}

export function tagHasTreeseedDevMetadata(repoDir: string, tagName: string) {
	return gitTagMessage(repoDir, tagName).includes('treeseed-dev-tag: true');
}

export function parseTreeseedDevTag(tagName: string, message: string): TreeseedDevTagInfo | null {
	const match = String(tagName).match(/^(\d+\.\d+\.\d+)-dev\.([0-9A-Za-z.-]+)\.(\d{8}T\d{6}Z)$/u);
	if (!match) return null;
	const metadata = Object.fromEntries(
		String(message)
			.split(/\r?\n/u)
			.map((line) => line.match(/^([^:]+):\s*(.*)$/u))
			.filter((lineMatch): lineMatch is RegExpMatchArray => Boolean(lineMatch))
			.map((lineMatch) => [String(lineMatch[1]).trim(), String(lineMatch[2] ?? '').trim()]),
	);
	if (metadata['treeseed-dev-tag'] !== 'true') return null;
	return {
		tagName,
		stableVersion: match[1],
		branchSlug: match[2],
		timestamp: match[3],
		metadata,
		branch: metadata.branch || null,
		packageName: metadata.package || null,
		version: metadata.version || null,
	};
}

function devTagScope(info: TreeseedDevTagInfo): 'staging' | 'preview' | 'main' {
	const branch = info.branch ?? info.branchSlug;
	if (branch === 'staging' || info.branchSlug === 'staging') return 'staging';
	if (branch === 'main' || branch === 'prod' || branch === 'production' || info.branchSlug === 'main' || info.branchSlug === 'prod' || info.branchSlug === 'production') return 'main';
	return 'preview';
}

export function classifyStaleTreeseedDevTag(input: {
	tagName: string;
	message: string;
	currentVersion: string;
	activeReferences?: string[];
	branchScope?: DevTagBranchScope;
	expectedPackageName?: string | null;
}): StaleDevTagClassification {
	const tagName = String(input.tagName).trim();
	if (!tagName.includes('-dev.')) return { tagName, action: 'skip', reason: 'not-dev-tag', info: null };
	if (tagName.startsWith('deprecated/')) return { tagName, action: 'skip', reason: 'deprecated-tag', info: null };
	const info = parseTreeseedDevTag(tagName, input.message);
	if (!info) return { tagName, action: 'skip', reason: input.message.includes('treeseed-dev-tag: true') ? 'malformed-dev-tag' : 'missing-treeseed-metadata', info: null };
	if (input.expectedPackageName && info.packageName && info.packageName !== input.expectedPackageName) {
		return { tagName, action: 'skip', reason: 'package-mismatch', info };
	}
	if ((input.activeReferences ?? []).includes(tagName)) return { tagName, action: 'skip', reason: 'still-referenced', info };
	const scope = devTagScope(info);
	if (scope === 'main') return { tagName, action: 'skip', reason: 'main-or-production-tag', info };
	const branchScope = input.branchScope ?? 'all';
	if (branchScope !== 'all' && branchScope !== scope) return { tagName, action: 'skip', reason: `scope-${scope}`, info };
	const currentStableVersion = stableVersionBase(input.currentVersion);
	if (!currentStableVersion) return { tagName, action: 'skip', reason: 'invalid-current-version', info };
	const comparison = compareStableVersions(info.stableVersion, currentStableVersion);
	if (comparison >= 0) {
		return { tagName, action: 'skip', reason: comparison === 0 ? 'current-version' : 'newer-version', info };
	}
	return { tagName, action: 'delete', reason: 'stale-before-current-version', info };
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

function localDevTags(repoDir: string) {
	return run('git', ['tag', '-l', '*-dev.*'], { cwd: repoDir, capture: true })
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

function remoteDevTags(repoDir: string) {
	try {
		return run('git', ['ls-remote', '--tags', 'origin', '*-dev.*'], { cwd: repoDir, capture: true })
			.split(/\r?\n/u)
			.map((line) => line.trim())
			.filter(Boolean)
			.filter((line) => !line.endsWith('^{}'))
			.map((line) => line.split(/\s+/u)[1] ?? '')
			.filter((ref) => ref.startsWith('refs/tags/'))
			.map((ref) => ref.slice('refs/tags/'.length));
	} catch {
		return [];
	}
}

export function collectTreeseedDevTagCleanupPlan(input: {
	repoDir: string;
	packageName: string;
	currentVersion: string;
	activeReferences?: string[];
	branchScope?: DevTagBranchScope;
}) {
	const tagNames = [...new Set([...localDevTags(input.repoDir), ...remoteDevTags(input.repoDir)])].sort();
	const classifications = tagNames.map((tagName) =>
		classifyStaleTreeseedDevTag({
			tagName,
			message: gitDevTagMessage(input.repoDir, tagName),
			currentVersion: input.currentVersion,
			activeReferences: input.activeReferences ?? [],
			branchScope: input.branchScope ?? 'all',
			expectedPackageName: input.packageName,
		}));
	return {
		packageName: input.packageName,
		currentVersion: input.currentVersion,
		branchScope: input.branchScope ?? 'all',
		candidates: classifications.filter((classification) => classification.action === 'delete'),
		skipped: classifications.filter((classification) => classification.action === 'skip'),
		tags: classifications,
	};
}

export function cleanupStaleTreeseedDevTags(input: {
	repoDir: string;
	packageName: string;
	currentVersion: string;
	activeReferences?: string[];
	branchScope?: DevTagBranchScope;
	dryRun?: boolean;
}) {
	const plan = collectTreeseedDevTagCleanupPlan(input);
	const cleaned: string[] = [];
	const skipped = [...plan.skipped.map((entry) => ({ tagName: entry.tagName, reason: entry.reason }))];
	for (const candidate of plan.candidates) {
		if (input.dryRun) continue;
		try {
			run('git', ['tag', '-d', candidate.tagName], { cwd: input.repoDir });
		} catch {
			// Missing local tags can still have a stale remote counterpart.
		}
		try {
			run('git', ['push', 'origin', `:refs/tags/${candidate.tagName}`], { cwd: input.repoDir });
			cleaned.push(candidate.tagName);
		} catch (error) {
			skipped.push({ tagName: candidate.tagName, reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return {
		status: input.dryRun ? 'planned' : 'completed',
		packageName: input.packageName,
		currentVersion: input.currentVersion,
		branchScope: input.branchScope ?? 'all',
		candidates: plan.candidates.map((entry) => ({ tagName: entry.tagName, reason: entry.reason, branch: entry.info?.branch, branchSlug: entry.info?.branchSlug, version: entry.info?.version })),
		candidateCount: plan.candidates.length,
		cleaned,
		cleanedCount: cleaned.length,
		skipped,
		skippedCount: skipped.length,
	};
}
