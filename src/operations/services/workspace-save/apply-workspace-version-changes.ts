import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { changedWorkspacePackages, publishableWorkspacePackages, sortWorkspacePackages, workspacePackages, workspaceRoot } from '../workspace-tools.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../git-runner.ts';
import { TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES, compareVersionLines, firstAvailablePatchVersionOnLine, incrementVersion, internalDependencyFields, nextLineFor, parseVersionLine, readPackageJson, runGit, versionForLine, versionLine, writePackageJson } from './run-git.ts';

export function applyWorkspaceVersionChanges(plan) {
	for (const pkg of plan.packages) {
		if (!plan.touched.has(pkg.name)) {
			continue;
		}
		writePackageJson(pkg.packageJsonPath, pkg.packageJson);
	}
	return plan;
}

export function planWorkspaceReleaseBump(level = 'patch', root = workspaceRoot(), options = {}) {
	const packages = workspacePackages(root).map((pkg) => ({
		...pkg,
		packageJsonPath: resolve(pkg.dir, 'package.json'),
		packageJson: readPackageJson(resolve(pkg.dir, 'package.json')),
	}));
	const publishable = new Set(publishableWorkspacePackages(root).map((pkg) => pkg.name));
	const baseSelected = options.selectedPackageNames
		? new Set(
			[...options.selectedPackageNames]
				.map((name) => String(name))
				.filter((name) => publishable.has(name)),
		)
		: new Set(publishable);
	const publicPackages = sortWorkspacePackages(packages)
		.filter((pkg) => TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES.includes(pkg.name))
		.filter((pkg) => publishable.has(pkg.name));
	const publicLines = publicPackages.map((pkg) => versionLine(pkg.packageJson.version));
	const highestPublicLine = publicLines.sort(compareVersionLines).at(-1) ?? { major: 0, minor: 0, label: '0.0' };
	const repairVersionLine = options.repairVersionLine === true;
	const explicitTargetLine = options.targetVersionLine ? parseVersionLine(options.targetVersionLine) : null;
	let targetLine = explicitTargetLine ?? highestPublicLine;

	if (repairVersionLine) {
		if (explicitTargetLine && compareVersionLines(explicitTargetLine, highestPublicLine) !== 0) {
			throw new Error(`Release line repair target must match the highest current public package line (${highestPublicLine.label}). Received ${explicitTargetLine.label}.`);
		}
	} else if (level === 'major' || level === 'minor') {
		targetLine = nextLineFor(level, highestPublicLine);
	}

	const selected = new Set(baseSelected);
	if (repairVersionLine) {
		selected.clear();
		for (const pkg of publicPackages) {
			if (versionLine(pkg.packageJson.version).label !== targetLine.label) {
				selected.add(pkg.name);
			}
		}
	} else if (level === 'major' || level === 'minor') {
		for (const pkg of publicPackages) {
			selected.add(pkg.name);
		}
	}
	const touched = new Set();
	const versions = new Map();

	for (const pkg of packages) {
		if (!publishable.has(pkg.name) || !selected.has(pkg.name)) {
			continue;
		}
		const isPublicReleasePackage = TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES.includes(pkg.name);
		const nextVersion = repairVersionLine && isPublicReleasePackage
			? firstAvailablePatchVersionOnLine(pkg, targetLine)
			: (isPublicReleasePackage && (level === 'major' || level === 'minor')
				? versionForLine(targetLine, 0)
				: incrementVersion(pkg.packageJson.version, level));
		pkg.packageJson.version = nextVersion;
		versions.set(pkg.name, nextVersion);
		touched.add(pkg.name);
	}

	for (const pkg of packages) {
		if (!selected.has(pkg.name)) {
			continue;
		}
		for (const field of internalDependencyFields(pkg.packageJson)) {
			for (const depName of Object.keys(pkg.packageJson[field] ?? {})) {
				if (!versions.has(depName)) {
					continue;
				}
				pkg.packageJson[field][depName] = `${versions.get(depName)}`;
				touched.add(pkg.name);
			}
		}
	}

	return {
		packages,
		touched,
		versions,
		level,
		selected,
		releaseLine: {
			group: TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES.filter((name) => publishable.has(name)),
			repair: repairVersionLine,
			targetLine: targetLine.label,
			highestCurrentLine: highestPublicLine.label,
			alignedBefore: new Set(publicLines.map((line) => line.label)).size <= 1,
		},
	};
}

export function collectWorkspaceVersionConsistencyIssues(root = workspaceRoot()) {
	const packages = workspacePackages(root).map((pkg) => ({
		...pkg,
		packageJson: readPackageJson(resolve(pkg.dir, 'package.json')),
	}));
	const versions = new Map(packages.map((pkg) => [pkg.name, pkg.packageJson.version]));
	const issues = [];

	for (const pkg of packages) {
		for (const field of internalDependencyFields(pkg.packageJson)) {
			for (const [depName, currentSpec] of Object.entries(pkg.packageJson[field] ?? {})) {
				if (!versions.has(depName)) {
					continue;
				}
				const expectedSpec = `${versions.get(depName)}`;
				if (currentSpec !== expectedSpec) {
					issues.push({
						packageName: pkg.name,
						dependencyName: depName,
						field,
						currentSpec,
						expectedSpec,
					});
				}
			}
		}
	}

	return issues;
}

export function assertWorkspaceVersionConsistency(root = workspaceRoot()) {
	const issues = collectWorkspaceVersionConsistencyIssues(root);
	if (issues.length === 0) {
		return;
	}

	const rendered = issues
		.map((issue) => `${issue.packageName} ${issue.field}.${issue.dependencyName}=${issue.currentSpec} expected ${issue.expectedSpec}`)
		.join('\n');
	throw new Error(
		[
			'Treeseed save found inconsistent checked-out package dependency versions.',
			'Resolve the package manifest drift before saving.',
			rendered,
		].join('\n'),
	);
}

export function repoRoot(cwd = workspaceRoot()) {
	return runGit(['rev-parse', '--show-toplevel'], { cwd, capture: true }).trim();
}

export function currentBranch(repoDir) {
	return runGit(['branch', '--show-current'], { cwd: repoDir, capture: true }).trim();
}

export function originRemoteUrl(repoDir) {
	return runGit(['remote', 'get-url', 'origin'], { cwd: repoDir, capture: true }).trim();
}

export function gitStatusPorcelain(repoDir) {
	return runGit(['status', '--porcelain'], { cwd: repoDir, capture: true }).trim();
}

export function hasMeaningfulChanges(repoDir) {
	return gitStatusPorcelain(repoDir).length > 0;
}

export function countConflictMarkers(source) {
	return {
		start: (source.match(/^<{7} /gm) ?? []).length,
		middle: (source.match(/^={7}$/gm) ?? []).length,
		end: (source.match(/^>{7} /gm) ?? []).length,
	};
}

export function gitPathExists(repoDir, gitPath) {
	try {
		const resolved = runGit(['rev-parse', '--git-path', gitPath], {
			cwd: repoDir,
			capture: true,
		}).trim();
		const fullPath = resolved && (isAbsolute(resolved) ? resolved : resolve(repoDir, resolved));
		return Boolean(fullPath) && existsSync(fullPath);
	} catch {
		return false;
	}
}

export function collectMergeConflictReport(repoDir) {
	const branch = currentBranch(repoDir);
	const conflictedFiles = runGit(['diff', '--name-only', '--diff-filter=U'], {
		cwd: repoDir,
		capture: true,
	})
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	const status = runGit(['status', '--short'], { cwd: repoDir, capture: true });
	const perFile = conflictedFiles.map((filePath) => {
		const fullPath = resolve(repoDir, filePath);
		const source = existsSync(fullPath) && !lstatSync(fullPath).isDirectory()
			? readFileSync(fullPath, 'utf8')
			: '';
		return {
			filePath,
			markers: countConflictMarkers(source),
			diff: runGit(['diff', '--', filePath], { cwd: repoDir, capture: true }),
		};
	});

	return {
		branch,
		mergeInProgress: gitPathExists(repoDir, 'MERGE_HEAD'),
		rebaseInProgress: gitPathExists(repoDir, 'rebase-merge') || gitPathExists(repoDir, 'rebase-apply'),
		conflictedFiles,
		status,
		perFile,
	};
}

export function formatMergeConflictReport(report, repoDir, targetBranch = 'main') {
	const lines = [
		`Treeseed workflow failed due to Git integration conflicts while updating ${targetBranch}.`,
		`Repository root: ${repoDir}`,
		`Branch: ${report.branch}`,
		`Merge in progress: ${report.mergeInProgress ? 'yes' : 'no'}`,
		`Rebase in progress: ${report.rebaseInProgress ? 'yes' : 'no'}`,
		'Git status:',
		report.status || '(no git status output)',
		'Conflicted files:',
	];

	for (const file of report.perFile) {
		lines.push(`- ${file.filePath}`);
		lines.push(`  markers: start=${file.markers.start} middle=${file.markers.middle} end=${file.markers.end}`);
		lines.push('  diff:');
		lines.push(file.diff || '  (no diff output)');
	}

	lines.push('Next steps:');
	lines.push('- Inspect conflicted files and reconcile local vs target-branch changes on your task branch.');
	lines.push('- Save the resolved task branch, then retry the interrupted Treeseed workflow.');
	lines.push('- If a Git merge or rebase is still active, abort it before retrying.');

	return lines.join('\n');
}
