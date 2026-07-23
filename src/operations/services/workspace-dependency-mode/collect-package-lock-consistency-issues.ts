import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../git-runner.ts';
import { workspacePackages, workspaceRoot } from '../workspace-tools.ts';
import { DeploymentLockfileWorkspaceIssue, INTERNAL_DEPENDENCY_FIELDS, WorkspaceLink, WorkspaceLinksMode, dependencySpec, dependencySpecsMatch, ensureGitInfoExcludes, internalDependencyNames, linkPathFor, normalizedPathValue, operatorWorkspacePackageNames, packageDirName, pathKey, readJson, readMetadata, safeLstat, safeReadlink, workspaceLinksEnabled, writeMetadata } from './dependency-resolution-mode.ts';
import { inspectWorkspaceDependencyMode } from './collect-deployment-lockfile-workspace-issues.ts';

export function collectPackageLockConsistencyIssues(
	filePath: string,
	packageJson: Record<string, unknown>,
	packages: Record<string, Record<string, unknown>>,
	workspacePackageByName: Map<string, { relativeDir: string; packageJson: Record<string, unknown> }>,
) {
	const issues: DeploymentLockfileWorkspaceIssue[] = [];
	const rootLockEntry = packages[''];
	const declaredWorkspaces = Array.isArray(packageJson.workspaces)
		? packageJson.workspaces.map(String)
		: [];
	if (declaredWorkspaces.length > 0) {
		const lockWorkspaces = Array.isArray(rootLockEntry?.workspaces)
			? rootLockEntry.workspaces.map(String)
			: [];
		if (JSON.stringify(lockWorkspaces) !== JSON.stringify(declaredWorkspaces)) {
			issues.push({
				filePath,
				packageName: String(packageJson.name ?? '(root)'),
				reason: `root-workspaces-mismatch:package.json=${JSON.stringify(declaredWorkspaces)} lockfile=${JSON.stringify(lockWorkspaces)}`,
			});
		}
	}
	for (const [packageName, workspacePackage] of workspacePackageByName) {
		const relativeDir = normalizedPathValue(workspacePackage.relativeDir);
		const packageEntry = packages[relativeDir];
		if (!packageEntry) {
			issues.push({ filePath, packageName, reason: `missing-workspace-package-entry:${relativeDir}` });
			continue;
		}
		if (packageEntry.name !== packageName) {
			issues.push({ filePath, packageName, reason: `workspace-package-name-mismatch:${relativeDir}` });
		}
		const expectedVersion = workspacePackage.packageJson.version;
		if (typeof expectedVersion === 'string' && packageEntry.version !== expectedVersion) {
			issues.push({ filePath, packageName, reason: `workspace-package-version-mismatch:${packageEntry.version ?? '(missing)'}!=${expectedVersion}` });
		}
		const linkEntry = packages[`node_modules/${packageName}`];
		if (!linkEntry || linkEntry.link !== true || normalizedPathValue(String(linkEntry.resolved ?? '')) !== relativeDir) {
			issues.push({ filePath, packageName, reason: `workspace-link-entry-mismatch:${relativeDir}` });
		}
	}
	for (const field of INTERNAL_DEPENDENCY_FIELDS) {
		for (const packageName of workspacePackageByName.keys()) {
			const manifestSpec = dependencySpec(packageJson, field, packageName);
			if (!manifestSpec) continue;
			const lockSpec = dependencySpec(rootLockEntry ?? {}, field, packageName);
			if (!lockSpec || !dependencySpecsMatch(manifestSpec, lockSpec)) {
				issues.push({
					filePath,
					packageName,
					reason: `root-dependency-spec-mismatch:${field}:${lockSpec ?? '(missing)'}!=${manifestSpec}`,
				});
			}
		}
	}
	return issues;
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

export function isInstalledTreeseedPackage(path: string, packageName: string) {
	try {
		const packageJson = readJson(resolve(path, 'package.json'));
		return packageJson.name === packageName;
	} catch {
		return false;
	}
}

export function isEmptyDirectory(path: string) {
	try {
		return safeLstat(path)?.isDirectory() === true && readdirSync(path).length === 0;
	} catch {
		return false;
	}
}

export function removeLinkCandidate(link: WorkspaceLink, managedLinks: Set<string>) {
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
	if (managed) {
		rmSync(link.linkPath, { recursive: true, force: true });
		return true;
	}
	if (isInstalledTreeseedPackage(link.linkPath, link.packageName)) {
		rmSync(link.linkPath, { recursive: true, force: true });
		return true;
	}
	if (isEmptyDirectory(link.linkPath)) {
		rmSync(link.linkPath, { recursive: true, force: true });
		return true;
	}
	throw new Error(`Refusing to replace unmanaged path ${link.linkPath}.`);
}

export function createLink(link: WorkspaceLink) {
	mkdirSync(dirname(link.linkPath), { recursive: true });
	const relativeTarget = relative(dirname(link.linkPath), link.targetPath) || '.';
	symlinkSync(relativeTarget, link.linkPath, process.platform === 'win32' ? 'junction' : 'dir');
}

export function packageBinEntries(packageJson: Record<string, unknown>) {
	const bin = packageJson.bin;
	if (typeof bin === 'string' && typeof packageJson.name === 'string') {
		return [[packageDirName(packageJson.name), bin]] as Array<[string, string]>;
	}
	if (!bin || typeof bin !== 'object' || Array.isArray(bin)) return [];
	return Object.entries(bin)
		.filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

export function syncPackageBinLinks(link: WorkspaceLink) {
	const packageJson = readJson(resolve(link.targetPath, 'package.json'));
	const binEntries = packageBinEntries(packageJson);
	if (binEntries.length === 0) return [];
	const binDir = resolve(link.ownerPath, 'node_modules', '.bin');
	mkdirSync(binDir, { recursive: true });
	const created: string[] = [];
	for (const [binName, binTarget] of binEntries) {
		const linkPath = resolve(binDir, binName);
		const targetPath = resolve(link.linkPath, binTarget);
		const relativeTarget = relative(dirname(linkPath), targetPath) || targetPath;
		const stat = safeLstat(linkPath);
		if (stat?.isSymbolicLink()) {
			const currentTarget = readlinkSync(linkPath);
			if (currentTarget === relativeTarget || resolve(dirname(linkPath), currentTarget) === targetPath) {
				continue;
			}
			unlinkSync(linkPath);
		} else if (stat) {
			continue;
		}
		symlinkSync(relativeTarget, linkPath);
		created.push(linkPath);
	}
	return created;
}

export function ensureLocalWorkspaceLinks(root = workspaceRoot(), options: { mode?: WorkspaceLinksMode; env?: NodeJS.ProcessEnv } = {}) {
	const enabled = workspaceLinksEnabled(options.mode, options.env);
	const links = discoverWorkspaceLinks(root);
	const report = inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env });
	if (!enabled) return { ...report, enabled: false, created: [], removed: [], preserved: [] };
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
	for (const link of links) {
		created.push(...syncPackageBinLinks(link));
	}
	writeMetadata(root, links);
	return {
		...inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env }),
		created,
		removed: [],
		preserved: [],
	};
}

export function unlinkLocalWorkspaceLinks(root = workspaceRoot(), options: { mode?: WorkspaceLinksMode; env?: NodeJS.ProcessEnv; preserveOperatorLinks?: boolean } = {}) {
	const enabled = workspaceLinksEnabled(options.mode, options.env);
	const links = discoverWorkspaceLinks(root);
	const managedLinks = readMetadata(root);
	const removed: string[] = [];
	const preserved: string[] = [];
	const packages = workspacePackages(root).filter((pkg) => typeof pkg.name === 'string' && pkg.name.startsWith('@treeseed/'));
	const packageNameByDir = new Map(packages.map((pkg) => [pathKey(pkg.dir), String(pkg.name)]));
	const operatorPackageNames = options.preserveOperatorLinks ? operatorWorkspacePackageNames(packages) : new Set<string>();
	if (!enabled) return { ...inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env }), enabled: false, removed, preserved };
	for (const link of links) {
		const stat = safeLstat(link.linkPath);
		if (!stat) continue;
		const currentTarget = stat.isSymbolicLink() ? safeReadlink(link.linkPath) : null;
		const managed = managedLinks.has(pathKey(link.linkPath)) || currentTarget === pathKey(link.targetPath);
		if (!stat.isSymbolicLink() || !managed) continue;
		const ownerPackageName = packageNameByDir.get(pathKey(link.ownerPath)) ?? null;
		if (operatorPackageNames.has(link.packageName) || (ownerPackageName && operatorPackageNames.has(ownerPackageName))) {
			preserved.push(link.linkPath);
			continue;
		}
		unlinkSync(link.linkPath);
		removed.push(link.linkPath);
	}
	return {
		...inspectWorkspaceDependencyMode(root, { mode: options.mode, env: options.env }),
		removed,
		created: [],
		preserved,
	};
}
