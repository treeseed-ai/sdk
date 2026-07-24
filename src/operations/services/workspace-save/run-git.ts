import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { changedWorkspacePackages, publishableWorkspacePackages, sortWorkspacePackages, workspacePackages, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { classifyGitMode, runGitText } from '../operations/git-runner.ts';


export function runGit(args, options) {
	return runGitText(args, {
		cwd: options.cwd,
		mode: classifyGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

export const MERGE_CONFLICT_EXIT_CODE = 12;

export const PUBLIC_RELEASE_PACKAGE_NAMES = ['@treeseed/sdk', '@treeseed/ui', '@treeseed/core', '@treeseed/admin', '@treeseed/cli', '@treeseed/agent'];

export function parseSemver(version) {
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

export function versionLine(version) {
	const parsed = parseSemver(version);
	return {
		major: parsed.major,
		minor: parsed.minor,
		label: `${parsed.major}.${parsed.minor}`,
	};
}

export function compareVersionLines(left, right) {
	if (left.major !== right.major) return left.major - right.major;
	return left.minor - right.minor;
}

export function parseVersionLine(input) {
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

export function nextLineFor(level, highestLine) {
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

export function versionForLine(line, patch = 0) {
	return `${line.major}.${line.minor}.${patch}`;
}

export function localGitTagExists(repoDir, tagName) {
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

export function firstAvailablePatchVersionOnLine(pkg, line) {
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
		.filter((pkg) => PUBLIC_RELEASE_PACKAGE_NAMES.includes(pkg.name))
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
		group: PUBLIC_RELEASE_PACKAGE_NAMES.filter((name) => packages.some((pkg) => pkg.name === name)),
		packages,
		lines: lines.map((line) => line.label),
		highestLine: highestLine?.label ?? null,
		aligned: lines.length <= 1,
		drifted: lines.length > 1,
	};
}

export function readPackageJson(filePath) {
	return JSON.parse(readFileSync(filePath, 'utf8'));
}

export function writePackageJson(filePath, value) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function internalDependencyFields(packageJson) {
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
