import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { changedWorkspacePackages, publishableWorkspacePackages, sortWorkspacePackages, workspacePackages, workspaceRoot } from './workspace-tools.ts';
import { classifyTreeseedGitMode, runTreeseedGitText } from './git-runner.ts';

function runGit(args, options) {
	return runTreeseedGitText(args, {
		cwd: options.cwd,
		mode: classifyTreeseedGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

export const MERGE_CONFLICT_EXIT_CODE = 12;
export const TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES = ['@treeseed/sdk', '@treeseed/ui', '@treeseed/core', '@treeseed/admin', '@treeseed/cli', '@treeseed/agent'];

function parseSemver(version) {
	const match = String(version).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/);
	if (!match) {
		throw new Error(`Unsupported version "${version}". Expected x.y.z.`);
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: String(version).includes('-'),
	};
}

function versionLine(version) {
	const parsed = parseSemver(version);
	return {
		major: parsed.major,
		minor: parsed.minor,
		label: `${parsed.major}.${parsed.minor}`,
	};
}

function compareVersionLines(left, right) {
	if (left.major !== right.major) return left.major - right.major;
	return left.minor - right.minor;
}

function parseVersionLine(input) {
	const match = String(input ?? '').trim().match(/^(\d+)\.(\d+)$/);
	if (!match) {
		throw new Error(`Unsupported release version line "${input}". Expected major.minor, for example 0.10.`);
	}
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		label: `${Number(match[1])}.${Number(match[2])}`,
	};
}

function nextLineFor(level, highestLine) {
	if (level === 'major') {
		return {
			major: highestLine.major + 1,
			minor: 0,
			label: `${highestLine.major + 1}.0`,
		};
	}
	if (level === 'minor') {
		return {
			major: highestLine.major,
			minor: highestLine.minor + 1,
			label: `${highestLine.major}.${highestLine.minor + 1}`,
		};
	}
	return highestLine;
}

function versionForLine(line, patch = 0) {
	return `${line.major}.${line.minor}.${patch}`;
}

function localGitTagExists(repoDir, tagName) {
	try {
		return runGit(['tag', '--list', tagName], { cwd: repoDir, capture: true }).trim() === tagName;
	} catch {
		return false;
	}
}

export function highestStableGitTagOnLine(repoDir, lineLabel) {
	const line = parseVersionLine(lineLabel);
	try {
		const tags = runGit(['tag', '--list', `${line.label}.*`], { cwd: repoDir, capture: true })
			.split(/\r?\n/u)
			.map((tag) => tag.trim())
			.filter(Boolean)
			.map((tag) => {
				try {
					const parsed = parseSemver(tag);
					if (parsed.prerelease || parsed.major !== line.major || parsed.minor !== line.minor) return null;
					return { tag, patch: parsed.patch };
				} catch {
					return null;
				}
			})
			.filter((entry) => entry != null)
			.sort((left, right) => right.patch - left.patch);
		return tags[0]?.tag ?? null;
	} catch {
		return null;
	}
}

function firstAvailablePatchVersionOnLine(pkg, line) {
	for (let patch = 0; patch < 1000; patch += 1) {
		const candidate = versionForLine(line, patch);
		if (!localGitTagExists(pkg.dir, candidate)) {
			return candidate;
		}
	}
	throw new Error(`Unable to find an available ${line.label}.x version for ${pkg.name}.`);
}

export function incrementPatchVersion(version) {
	const parsed = parseSemver(version);
	return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

export function incrementVersion(version, level = 'patch') {
	const parsed = parseSemver(version);
	if (level === 'major') {
		return `${parsed.major + 1}.0.0`;
	}
	if (level === 'minor') {
		return `${parsed.major}.${parsed.minor + 1}.0`;
	}
	if (level === 'patch') {
		if (parsed.prerelease) {
			return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
		}
		return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
	}
	throw new Error(`Unsupported release bump "${level}". Expected major, minor, or patch.`);
}

export function collectPublicPackageReleaseLineState(root = workspaceRoot()) {
	const publishable = new Set(publishableWorkspacePackages(root).map((pkg) => pkg.name));
	const packages = sortWorkspacePackages(workspacePackages(root))
		.filter((pkg) => TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES.includes(pkg.name))
		.filter((pkg) => publishable.has(pkg.name))
		.map((pkg) => {
			const packageJson = readPackageJson(resolve(pkg.dir, 'package.json'));
			const line = versionLine(packageJson.version);
			return {
				name: pkg.name,
				path: pkg.relativeDir,
				version: String(packageJson.version ?? ''),
				line: line.label,
				major: line.major,
				minor: line.minor,
			};
		});
	const lineMap = new Map(packages.map((pkg) => [pkg.line, { major: pkg.major, minor: pkg.minor, label: pkg.line }]));
	const lines = [...lineMap.values()].sort(compareVersionLines);
	const highestLine = lines.at(-1) ?? null;
	return {
		group: TREESEED_PUBLIC_RELEASE_PACKAGE_NAMES.filter((name) => packages.some((pkg) => pkg.name === name)),
		packages,
		lines: lines.map((line) => line.label),
		highestLine: highestLine?.label ?? null,
		aligned: lines.length <= 1,
		drifted: lines.length > 1,
	};
}

function readPackageJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writePackageJson(filePath, value) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function internalDependencyFields(packageJson) {
	return ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
		.filter((field) => packageJson[field] && typeof packageJson[field] === 'object');
}

export function planWorkspaceVersionChanges(root = workspaceRoot()) {
	const packages = workspacePackages(root).map((pkg) => ({
		...pkg,
		packageJsonPath: resolve(pkg.dir, 'package.json'),
		packageJson: readPackageJson(resolve(pkg.dir, 'package.json')),
	}));
	const orderedPackages = sortWorkspacePackages(packages);
	const publishable = new Set(publishableWorkspacePackages(root).map((pkg) => pkg.name));
	const changedPublishable = new Set(
		changedWorkspacePackages({
			root,
			packages: orderedPackages.filter((pkg) => publishable.has(pkg.name)),
			includeDependents: false,
		}).map((pkg) => pkg.name),
	);

	const versions = new Map(orderedPackages.map((pkg) => [pkg.name, pkg.packageJson.version]));
	const bumped = new Set(changedPublishable);
	const touched = new Set();

	for (const name of changedPublishable) {
		versions.set(name, incrementPatchVersion(versions.get(name)));
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const pkg of orderedPackages) {
			let packageDependencyChanged = false;
			for (const field of internalDependencyFields(pkg.packageJson)) {
				for (const depName of Object.keys(pkg.packageJson[field] ?? {})) {
					if (!versions.has(depName)) {
						continue;
					}
					const nextSpec = `${versions.get(depName)}`;
					if (pkg.packageJson[field][depName] === nextSpec) {
						continue;
					}
					pkg.packageJson[field][depName] = nextSpec;
					packageDependencyChanged = true;
					touched.add(pkg.name);
				}
			}

			if (packageDependencyChanged && publishable.has(pkg.name) && !bumped.has(pkg.name)) {
				bumped.add(pkg.name);
				versions.set(pkg.name, incrementPatchVersion(versions.get(pkg.name)));
				changed = true;
			}
		}
	}

	for (const pkg of orderedPackages) {
		if (!bumped.has(pkg.name)) {
			continue;
		}
		const nextVersion = versions.get(pkg.name);
		if (pkg.packageJson.version !== nextVersion) {
			pkg.packageJson.version = nextVersion;
			touched.add(pkg.name);
		}
	}

	return {
		packages: orderedPackages,
		publishable,
		bumped,
		touched,
	};
}

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

function gitPathExists(repoDir, gitPath) {
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
