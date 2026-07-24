import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runRepositoryGit } from '../operations/git-runner.ts';
import { workspacePackages, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { DeploymentLockfileWorkspaceIssue, WorkspaceDependencyModeReport, WorkspaceLinksMode, dependencyNames, pathKey, readJson, rootLockfileAllowsWorkspaceLink, safeLstat, safeReadlink, workspaceLinksEnabled } from './dependency-resolution-mode.ts';
import { collectPackageLockConsistencyIssues, discoverWorkspaceLinks } from './collect-package-lock-consistency-issues.ts';

export function collectDeploymentLockfileWorkspaceIssues(root = workspaceRoot()): DeploymentLockfileWorkspaceIssue[] {
	if (!existsSync(resolve(root, 'package.json'))) {
		return [];
	}
	const rootPackageJson = readJson(resolve(root, 'package.json'));
	const workspacePkgs = workspacePackages(root)
		.filter((pkg) => typeof pkg.name === 'string' && pkg.name.startsWith('@treeseed/'));
	const workspacePackageByName = new Map(workspacePkgs.map((pkg) => [String(pkg.name), {
		relativeDir: pkg.relativeDir,
		packageJson: pkg.packageJson,
	}]));
	const packageNames = workspacePackageByName.size > 0
		? new Set(workspacePackageByName.keys())
		: dependencyNames(rootPackageJson, (name) => name.startsWith('@treeseed/'));
	const lockRoots = workspacePkgs.length > 0 ? [root, ...workspacePkgs.map((pkg) => pkg.dir)] : [root];
	const issues: DeploymentLockfileWorkspaceIssue[] = [];
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
		if (dir === root && workspacePackageByName.size > 0) {
			issues.push(...collectPackageLockConsistencyIssues(filePath, rootPackageJson, packages, workspacePackageByName));
		}
		const checkedPackageNames = dir === root ? packageNames : dependencyNames(
			existsSync(resolve(dir, 'package.json')) ? readJson(resolve(dir, 'package.json')) : null,
			(name) => name.startsWith('@treeseed/'),
		);
		const lockPackageNames = new Set(Object.keys(packages)
			.map((key) => /^node_modules\/(@treeseed\/[^/]+)$/u.exec(key)?.[1] ?? null)
			.filter((name): name is string => Boolean(name)));
		for (const packageName of new Set([...packageNames, ...checkedPackageNames, ...lockPackageNames])) {
			const entry = packages[`node_modules/${packageName}`];
			if (!entry) continue;
			const resolvedValue = String(entry.resolved ?? '');
			if (entry.link === true) {
				if (!rootLockfileAllowsWorkspaceLink(root, filePath, packageName, entry, workspacePackageByName)) {
					issues.push({ filePath, packageName, reason: 'workspace-link-lock-entry' });
				}
			} else if (/^(?:\.\.?\/|packages\/|file:)/u.test(resolvedValue)) {
				issues.push({ filePath, packageName, reason: `local-lock-resolved:${resolvedValue}` });
			}
		}
	}
	return issues.filter((issue, index, all) =>
		all.findIndex((candidate) =>
			candidate.filePath === issue.filePath
			&& candidate.packageName === issue.packageName
			&& candidate.reason === issue.reason) === index);
}

export function assertNoWorkspaceLinksInDeploymentLockfiles(root = workspaceRoot()) {
	const issues = collectDeploymentLockfileWorkspaceIssues(root);
	if (issues.length === 0) return;
	throw new Error(`Deployment lockfile validation failed.\n${issues.map((issue) => `${issue.filePath}: ${issue.packageName} ${issue.reason}`).join('\n')}`);
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
		preserved: [],
		issues: [
			...inspected
				.filter((link) => link.exists && (!link.linked || !link.targetMatches))
				.map((link) => `${link.linkPath} is not linked to ${link.targetPath}.`),
			...lockIssues,
		],
	};
}
