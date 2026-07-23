import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../git-runner.ts';
import { workspacePackages, workspaceRoot } from '../workspace-tools.ts';
import { packageBinEntries } from './collect-package-lock-consistency-issues.ts';

export type DependencyResolutionMode = 'local-workspace' | 'git-dev' | 'stable-registry';

export type WorkspaceLinksMode = 'auto' | 'off';

export type WorkspaceLink = {
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
	preserved: string[];
	issues: string[];
};

export type DeploymentLockfileWorkspaceIssue = {
	filePath: string;
	packageName: string;
	reason: string;
};

export const METADATA_VERSION = 1;

export const INTERNAL_DEPENDENCY_FIELDS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies'];

export function metadataPath(root: string) {
	return resolve(root, '.treeseed', 'workspace-links.json');
}

export function workspaceLinksEnabled(mode: WorkspaceLinksMode | undefined = 'auto', env: NodeJS.ProcessEnv = process.env) {
	if (mode === 'off') return false;
	const envMode = String(env.TREESEED_WORKSPACE_LINKS ?? 'auto').trim().toLowerCase();
	return envMode !== 'off' && envMode !== 'false' && envMode !== '0';
}

export function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function packageDirName(packageName: string) {
	const parts = packageName.split('/');
	return parts.at(-1) ?? packageName;
}

export function linkPathFor(ownerPath: string, packageName: string) {
	const scope = packageName.startsWith('@') ? packageName.split('/')[0] : null;
	const name = packageDirName(packageName);
	return scope
		? resolve(ownerPath, 'node_modules', scope, name)
		: resolve(ownerPath, 'node_modules', name);
}

export function safeLstat(path: string) {
	try {
		return lstatSync(path);
	} catch {
		return null;
	}
}

export function safeReadlink(path: string) {
	try {
		const link = readlinkSync(path);
		return resolve(dirname(path), link);
	} catch {
		return null;
	}
}

export function pathKey(path: string) {
	return resolve(path);
}

export function readMetadata(root: string) {
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

export function writeMetadata(root: string, links: WorkspaceLink[]) {
	const filePath = metadataPath(root);
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify({
		version: METADATA_VERSION,
		root,
		updatedAt: new Date().toISOString(),
		links,
	}, null, 2)}\n`, 'utf8');
}

export function gitInfoExcludePath(repoPath: string) {
	const result = runTreeseedGit(['rev-parse', '--git-common-dir'], {
		cwd: repoPath,
		mode: 'read',
		allowFailure: true,
	});
	if (result.status !== 0) return null;
	const gitDir = result.stdout.trim();
	if (!gitDir) return null;
	return resolve(repoPath, gitDir, 'info', 'exclude');
}

export function ensureGitInfoExcludes(root: string, links: WorkspaceLink[]) {
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

export function internalDependencyNames(packageJson: Record<string, unknown>, packageNames: Set<string>) {
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

export function operatorWorkspacePackageNames(packages: ReturnType<typeof workspacePackages>) {
	const packageByName = new Map(packages.map((pkg) => [String(pkg.name), pkg]));
	const packageNames = new Set(packageByName.keys());
	const roots = packages
		.filter((pkg) => {
			const name = String(pkg.name ?? '');
			if (name === '@treeseed/cli') return true;
			return packageBinEntries(pkg.packageJson).some(([binName]) => binName === 'trsd' || binName === 'treeseed');
		})
		.map((pkg) => String(pkg.name));
	const closure = new Set<string>();
	const visit = (packageName: string) => {
		if (closure.has(packageName)) return;
		const pkg = packageByName.get(packageName);
		if (!pkg) return;
		closure.add(packageName);
		for (const dependencyName of internalDependencyNames(pkg.packageJson, packageNames)) {
			visit(dependencyName);
		}
	};
	for (const rootName of roots) visit(rootName);
	return closure;
}

export function dependencyNames(packageJson: Record<string, unknown> | null, filter: (name: string) => boolean) {
	const names = new Set<string>();
	if (!packageJson) return names;
	for (const field of INTERNAL_DEPENDENCY_FIELDS) {
		const deps = packageJson[field];
		if (!deps || typeof deps !== 'object' || Array.isArray(deps)) continue;
		for (const name of Object.keys(deps)) {
			if (filter(name)) names.add(name);
		}
	}
	return names;
}

export function dependencySpec(packageJson: Record<string, unknown>, field: string, packageName: string) {
	const deps = packageJson[field];
	if (!deps || typeof deps !== 'object' || Array.isArray(deps)) return null;
	const value = (deps as Record<string, unknown>)[packageName];
	return typeof value === 'string' ? value : null;
}

export function dependencySpecsMatch(manifestSpec: string, lockSpec: string) {
	if (lockSpec === manifestSpec) return true;
	const manifestVersion = manifestSpec.replace(/^[~^]/u, '');
	const lockRef = lockSpec.includes('#') ? lockSpec.slice(lockSpec.lastIndexOf('#') + 1) : null;
	return Boolean(
		lockRef
		&& manifestVersion.includes('-dev.')
		&& lockRef === manifestVersion
		&& /^(?:github:|git\+https:\/\/github\.com\/|git\+ssh:\/\/git@github\.com[:/])/u.test(lockSpec),
	);
}

export function normalizedPathValue(value: string) {
	return value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/$/u, '');
}

export function rootLockfileAllowsWorkspaceLink(
	root: string,
	filePath: string,
	packageName: string,
	entry: Record<string, unknown>,
	workspacePackageByName: Map<string, { relativeDir: string }>,
) {
	if (filePath !== resolve(root, 'package-lock.json')) return false;
	const workspacePackage = workspacePackageByName.get(packageName);
	if (!workspacePackage) return false;
	return normalizedPathValue(String(entry.resolved ?? '')) === normalizedPathValue(workspacePackage.relativeDir);
}
