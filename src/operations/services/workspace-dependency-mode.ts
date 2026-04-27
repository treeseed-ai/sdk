import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { workspacePackages, workspaceRoot } from './workspace-tools.ts';

export type DependencyResolutionMode = 'local-workspace' | 'git-dev' | 'stable-registry';
export type WorkspaceLinksMode = 'auto' | 'off';

type WorkspaceLink = {
	packageName: string;
	linkPath: string;
	targetPath: string;
	scope: 'root' | 'package';
	ownerPath: string;
};

export type WorkspaceDependencyModeReport = {
	mode: DependencyResolutionMode;
	enabled: boolean;
	root: string;
	links: Array<WorkspaceLink & { exists: boolean; linked: boolean; targetMatches: boolean; currentTarget: string | null }>;
	created: string[];
	removed: string[];
	issues: string[];
};

const METADATA_VERSION = 1;
const INTERNAL_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];

function metadataPath(root: string) {
	return resolve(root, '.treeseed', 'workspace-links.json');
}

function workspaceLinksEnabled(mode: WorkspaceLinksMode | undefined = 'auto', env: NodeJS.ProcessEnv = process.env) {
	if (mode === 'off') return false;
	const envMode = String(env.TREESEED_WORKSPACE_LINKS ?? 'auto').trim().toLowerCase();
	return envMode !== 'off' && envMode !== 'false' && envMode !== '0';
}

function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function packageDirName(packageName: string) {
	const parts = packageName.split('/');
	return parts.at(-1) ?? packageName;
}

function linkPathFor(ownerPath: string, packageName: string) {
	const scope = packageName.startsWith('@') ? packageName.split('/')[0] : null;
	const name = packageDirName(packageName);
	return scope
		? resolve(ownerPath, 'node_modules', scope, name)
		: resolve(ownerPath, 'node_modules', name);
}

function safeLstat(path: string) {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}

function safeReadlink(path: string) {
	try {
		const link = readlinkSync(path);
		return resolve(dirname(path), link);
	} catch {
		return null;
	}
}

function pathKey(path: string) {
	return resolve(path);
}

function readMetadata(root: string) {
	const filePath = metadataPath(root);
	if (!existsSync(filePath)) return new Set<string>();
	try {
		const value = readJson(filePath);
		const links = Array.isArray(value.links) ? value.links : [];
		return new Set(links
			.map((entry) => entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).linkPath ?? '') : '')
			.filter(Boolean)
			.map(pathKey));
	} catch {
		return new Set<string>();
	}
}

function writeMetadata(root: string, links: WorkspaceLink[]) {
	const filePath = metadataPath(root);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify({
		version: METADATA_VERSION,
		root,
		updatedAt: new Date().toISOString(),
		links,
	}, null, 2)}\n`, 'utf8');
}

function gitInfoExcludePath(repoPath: string) {
	const gitPath = resolve(repoPath, '.git');
	const stat = safeLstat(gitPath);
	if (!stat) return null;
	if (stat.isDirectory()) {
		return resolve(gitPath, 'info', 'exclude');
	}
	if (stat.isFile()) {
		try {
			const content = readFileSync(gitPath, 'utf8').trim();
			const match = /^gitdir:\s*(.+)$/iu.exec(content);
			if (!match) return null;
			const gitDir = resolve(repoPath, match[1]);
			return resolve(gitDir, 'info', 'exclude');
		} catch {
			return null;
		}
	}
	return null;
}

function ensureGitInfoExcludes(root: string, links: WorkspaceLink[]) {
	const patternsByRepo = new Map<string, Set<string>>();
	const addPattern = (repoPath: string, pattern: string) => {
		const set = patternsByRepo.get(repoPath) ?? new Set<string>();
		set.add(pattern.replaceAll('\\', '/'));
		patternsByRepo.set(repoPath, set);
	};
	addPattern(root, '.treeseed/workspace-links.json');
	for (const link of links) {
		addPattern(link.ownerPath, relative(link.ownerPath, link.linkPath));
	}
	for (const [repoPath, patterns] of patternsByRepo) {
		const excludePath = gitInfoExcludePath(repoPath);
		if (!excludePath) continue;
		mkdirSync(dirname(excludePath), { recursive: true });
		const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
		const currentLines = new Set(current.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean));
		const missing = [...patterns].filter((pattern) => !currentLines.has(pattern));
		if (missing.length === 0) continue;
		const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
		writeFileSync(excludePath, `${current}${prefix}${missing.join('\n')}\n`, 'utf8');
	}
}

function internalDependencyNames(packageJson: Record<string, unknown>, packageNames: Set<string>) {
	const names = new Set<string>();
	for (const field of INTERNAL_DEPENDENCY_FIELDS) {
		const deps = packageJson[field];
		if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
		for (const name of Object.keys(deps)) {
			if (packageNames.has(name)) names.add(name);
		}
	}
	return [...names].sort();
}

export function discoverWorkspaceLinks(root = workspaceRoot()) {
	if (!existsSync(resolve(root, 'package.json'))) {
		return [];
	}
	const packages = workspacePackages(root).filter((pkg) => typeof pkg.name === 'string' && pkg.name.startsWith('@treeseed/'));
	const packageByName = new Map(packages.map((pkg) => [String(pkg.name), pkg]));
	const packageNames = new Set(packageByName.keys());
	const links: WorkspaceLink[] = [];

	for (const pkg of packages) {
		links.push({
			packageName: String(pkg.name),
			linkPath: linkPathFor(root, String(pkg.name)),
			targetPath: pkg.dir,
			scope: 'root',
			ownerPath: root,
		});
	}

	for (const owner of packages) {
		for (const dependencyName of internalDependencyNames(owner.packageJson, packageNames)) {
			const dependency = packageByName.get(dependencyName);
			if (!dependency) continue;
			links.push({
				packageName: dependencyName,
				linkPath: linkPathFor(owner.dir, dependencyName),
				targetPath: dependency.dir,
				scope: 'package',
				ownerPath: owner.dir,
			});
		}
	}

	return links;
}

function isInstalledTreeseedPackage(path: string, packageName: string) {
	try {
		const packageJson = readJson(resolve(path, 'package.json'));
		return packageJson.name === packageName;
	} catch {
		return false;
	}
}

function removeLinkCandidate(link: WorkspaceLink, managedLinks: Set<string>) {
	const stat = safeLstat(link.linkPath);
	if (!stat) return true;
	const currentTarget = stat.isSymbolicLink() ? safeReadlink(link.linkPath) : null;
	const managed = managedLinks.has(pathKey(link.linkPath)) || currentTarget === pathKey(link.targetPath);
	if (stat.isSymbolicLink()) {
		if (!managed && currentTarget !== pathKey(link.targetPath)) {
			throw new Error(`Refusing to remove unmanaged workspace link ${link.linkPath}.`);
		}
		unlinkSync(link.linkPath);
		return true;
	}
	if (isInstalledTreeseedPackage(link.linkPath, link.packageName)) {
		rmSync(link.linkPath, { recursive: true, force: true });
		return true;
	}
	throw new Error(`Refusing to replace unmanaged path ${link.linkPath}.`);
}

function createLink(link: WorkspaceLink) {
	mkdirSync(dirname(link.linkPath), { recursive: true });
	const relativeTarget = relative(dirname(link.linkPath), link.targetPath) || '.';
	symlinkSync(relativeTarget, link.linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

export function ensureLocalWorkspaceLinks(root = workspaceRoot(), options: { mode?: WorkspaceLinksMode; env?: NodeJS.ProcessEnv } = {}) {
	const enabled = workspaceLinksEnabled(options.mode, options.env);
	const links = discoverWorkspaceLinks(root);
	const report = inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env });
	if (!enabled) return { ...report, enabled: false, created: [], removed: [] };
	ensureGitInfoExcludes(root, links);
	const managedLinks = readMetadata(root);
	const created: string[] = [];
	for (const link of links) {
		const stat = safeLstat(link.linkPath);
		const currentTarget = stat?.isSymbolicLink() ? safeReadlink(link.linkPath) : null;
		if (stat?.isSymbolicLink() && currentTarget === pathKey(link.targetPath)) continue;
		removeLinkCandidate(link, managedLinks);
		createLink(link);
		created.push(link.linkPath);
	}
	writeMetadata(root, links);
	return {
		...inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env }),
		created,
		removed: [],
	};
}

export function unlinkLocalWorkspaceLinks(root = workspaceRoot(), options: { mode?: WorkspaceLinksMode; env?: NodeJS.ProcessEnv } = {}) {
	const enabled = workspaceLinksEnabled(options.mode, options.env);
	const links = discoverWorkspaceLinks(root);
	const managedLinks = readMetadata(root);
	const removed: string[] = [];
	if (!enabled) return { ...inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env }), enabled: false, removed };
	for (const link of links) {
		const stat = safeLstat(link.linkPath);
		if (!stat) continue;
		const currentTarget = stat.isSymbolicLink() ? safeReadlink(link.linkPath) : null;
		const managed = managedLinks.has(pathKey(link.linkPath)) || currentTarget === pathKey(link.targetPath);
		if (!stat.isSymbolicLink() || !managed) continue;
		unlinkSync(link.linkPath);
		removed.push(link.linkPath);
	}
	return {
		...inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env }),
		removed,
		created: [],
	};
}

export function collectDeploymentLockfileWorkspaceIssues(root = workspaceRoot()) {
	if (!existsSync(resolve(root, 'package.json'))) {
		return [];
	}
	const packageNames = new Set(workspacePackages(root)
		.filter((pkg) => typeof pkg.name === 'string' && pkg.name.startsWith('@treeseed/'))
		.map((pkg) => String(pkg.name)));
	const lockRoots = [root, ...workspacePackages(root).map((pkg) => pkg.dir)];
	const issues: Array<{ filePath: string; packageName: string; reason: string }> = [];
	for (const dir of lockRoots) {
		const filePath = resolve(dir, 'package-lock.json');
		if (!existsSync(filePath)) continue;
		let lock: Record<string, unknown>;
		try {
			lock = readJson(filePath);
		} catch {
			continue;
		}
		const packages = lock.packages && typeof lock.packages === 'object' && !Array.isArray(lock.packages)
			? lock.packages as Record<string, Record<string, unknown>>
			: {};
		for (const packageName of packageNames) {
			const entry = packages[`node_modules/${packageName}`];
			if (!entry) continue;
			const resolvedValue = String(entry.resolved ?? '');
			if (entry.link === true) {
				issues.push({ filePath, packageName, reason: 'workspace-link-lock-entry' });
			} else if (/^(?:\.\.?\/|packages\/|file:)/u.test(resolvedValue)) {
				issues.push({ filePath, packageName, reason: `local-lock-resolved:${resolvedValue}` });
			}
		}
	}
	return issues;
}

export function assertNoWorkspaceLinksInDeploymentLockfiles(root = workspaceRoot()) {
	const issues = collectDeploymentLockfileWorkspaceIssues(root);
	if (issues.length === 0) return;
	throw new Error(`Deployment install resolved internal packages from local workspace links.\n${issues.map((issue) => `${issue.filePath}: ${issue.packageName} ${issue.reason}`).join('\n')}`);
}

export function inspectWorkspaceDependencyMode(root = workspaceRoot(), options: { mode?: WorkspaceLinksMode; env?: NodeJS.ProcessEnv } = {}): WorkspaceDependencyModeReport {
	const enabled = workspaceLinksEnabled(options.mode, options.env);
	const links = discoverWorkspaceLinks(root);
	const inspected = links.map((link) => {
		const stat = safeLstat(link.linkPath);
		const currentTarget = stat?.isSymbolicLink() ? safeReadlink(link.linkPath) : null;
		const targetMatches = currentTarget === pathKey(link.targetPath);
		return {
			...link,
			exists: Boolean(stat),
			linked: stat?.isSymbolicLink() === true,
			targetMatches,
			currentTarget,
		};
	});
	const lockIssues = collectDeploymentLockfileWorkspaceIssues(root).map((issue) => `${issue.filePath}: ${issue.packageName} ${issue.reason}`);
	const allLinked = inspected.length > 0 && inspected.every((link) => link.linked && link.targetMatches);
	return {
		mode: allLinked ? 'local-workspace' : 'git-dev',
		enabled,
		root,
		links: inspected,
		created: [],
		removed: [],
		issues: [
			...inspected
				.filter((link) => link.exists && (!link.linked || !link.targetMatches))
				.map((link) => `${link.linkPath} is not linked to ${link.targetPath}.`),
			...lockIssues,
		],
	};
}
