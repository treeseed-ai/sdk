import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkoutBranch, headCommit, PRODUCTION_BRANCH, remoteHeadCommit, remoteBranchExists, STAGING_BRANCH } from "../../../operations/services/operations/git-workflow.ts";
import { collectReleaseHistoryCommits, upsertReleaseChangelog, type ReleaseHistoryCommit } from "../../../operations/services/packages/release-history.ts";
import { currentBranch, hasMeaningfulChanges, incrementVersion } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { rewriteProjectInternalDependenciesToStableVersions } from "../../../operations/services/packages/package-reference-policy.ts";
import { workspacePackages } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { runGit } from '../recovery/workflow-write.ts';
import { tagCommitSha } from '../recovery/fail-workflow-run.ts';
import { verifyPublishedReleaseArtifacts } from './collect-published-release-artifact-checks.ts';

export function planRootPackageVersion(root: string, level: string) {
	const packageJsonPath = resolve(root, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
	return incrementVersion(String(packageJson.version ?? '0.0.0'), level);
}

export function setRootPackageJsonVersion(root: string, version: string) {
	const packageJsonPath = resolve(root, 'package.json');
	const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
	packageJson.version = version;
	writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
	return String(packageJson.version);
}

export function writeJsonFile(path: string, value: Record<string, unknown>) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function updatePackageLockRootVersion(root: string, version: string) {
	const packageLockPath = resolve(root, 'package-lock.json');
	if (!existsSync(packageLockPath)) return { status: 'skipped', reason: 'no package-lock.json' };
	const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8')) as Record<string, unknown>;
	let changed = false;
	if (packageLock.version !== version) {
		packageLock.version = version;
		changed = true;
	}
	const packages = packageLock.packages;
	if (packages && typeof packages === 'object' && !Array.isArray(packages)) {
		const rootPackage = (packages as Record<string, unknown>)[''];
		if (rootPackage && typeof rootPackage === 'object' && !Array.isArray(rootPackage)) {
			if ((rootPackage as Record<string, unknown>).version !== version) {
				(rootPackage as Record<string, unknown>).version = version;
				changed = true;
			}
		}
	}
	if (changed) {
		writeJsonFile(packageLockPath, packageLock);
	}
	return { status: changed ? 'updated' : 'unchanged', path: 'package-lock.json' };
}

export function applyStableWorkspaceVersionChanges(
	root: string,
	versions: Map<string, string>,
	targetPackageNames: ReadonlySet<string>,
) {
	const targets = [
		{ name: '@treeseed/market', dir: root },
		...workspacePackages(root)
			.filter((pkg) => targetPackageNames.has(pkg.name))
			.map((pkg) => ({ name: pkg.name, dir: pkg.dir })),
	];
	for (const target of targets) {
		const packageJsonPath = resolve(target.dir, 'package.json');
		if (!existsSync(packageJsonPath)) continue;
		const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<string, unknown>;
		let changed = false;
		const plannedVersion = versions.get(target.name);
		if (plannedVersion && packageJson.version !== plannedVersion) {
			packageJson.version = plannedVersion;
			changed = true;
		}
		for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']) {
			const values = packageJson[field];
			if (!values || typeof values !== 'object' || Array.isArray(values)) continue;
			for (const [dependencyName, version] of versions.entries()) {
				if (!(dependencyName in values)) continue;
				const dependencySpec = version;
				if (String((values as Record<string, unknown>)[dependencyName]) === dependencySpec) continue;
				(values as Record<string, unknown>)[dependencyName] = dependencySpec;
				changed = true;
			}
		}
		if (changed) {
			writeJsonFile(packageJsonPath, packageJson);
		}
	}
	rewriteProjectInternalDependenciesToStableVersions(root, versions, targetPackageNames);
}

export function gitObjectCommit(repoDir: string, ref: string) {
	try {
		return runGit(['rev-list', '-n', '1', ref], { cwd: repoDir, capture: true }).trim() || null;
	} catch {
		return null;
	}
}

export function remoteTagCommit(repoDir: string, tagName: string) {
	const output = runGit(['ls-remote', 'origin', `refs/tags/${tagName}`, `refs/tags/${tagName}^{}`], { cwd: repoDir, capture: true }).trim();
	if (!output) return null;
	const peeled = output.split('\n').find((line) => line.endsWith(`refs/tags/${tagName}^{}`));
	const direct = output.split('\n').find((line) => line.endsWith(`refs/tags/${tagName}`));
	return (peeled ?? direct)?.split(/\s+/u)[0] ?? null;
}

export function releaseTagExists(repoDir: string, tagName: string) {
	if (gitObjectCommit(repoDir, tagName)) return true;
	try {
		return remoteTagCommit(repoDir, tagName) !== null;
	} catch {
		return false;
	}
}

export function ensureReleaseTag(repoDir: string, tagName: string, commitSha: string, message?: string) {
	const localCommit = gitObjectCommit(repoDir, tagName);
	if (localCommit && localCommit !== commitSha) {
		throw new Error(`Release tag ${tagName} already exists locally at ${localCommit}, expected ${commitSha}.`);
	}
	if (!localCommit) {
		runGit(['tag', '-a', tagName, commitSha, '-m', message ?? `release: ${tagName}`], { cwd: repoDir });
	}
	const remoteCommit = remoteTagCommit(repoDir, tagName);
	if (remoteCommit && remoteCommit !== commitSha) {
		throw new Error(`Release tag ${tagName} already exists on origin at ${remoteCommit}, expected ${commitSha}.`);
	}
	if (!remoteCommit) {
		runGit(['push', 'origin', tagName], { cwd: repoDir });
	}
	return {
		tagName,
		local: localCommit ? 'existing' : 'created',
		remote: remoteCommit ? 'existing' : 'pushed',
	};
}

export async function adoptPublishedPackageRelease(
	pkg: { name: string; dir: string },
	version: string,
): Promise<Record<string, unknown> | null> {
	const commitSha = tagCommitSha(pkg.dir, version);
	if (!commitSha) return null;
	const remoteCommit = remoteTagCommit(pkg.dir, version);
	if (remoteCommit !== commitSha) {
		throw new Error(`Release tag ${version} for ${pkg.name} is inconsistent: local=${commitSha}, origin=${remoteCommit ?? '(missing)'}.`);
	}
	let taggedManifest: Record<string, unknown>;
	try {
		taggedManifest = JSON.parse(runGit(['show', `${commitSha}:package.json`], { cwd: pkg.dir, capture: true })) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`Release tag ${version} for ${pkg.name} does not contain a valid package.json: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (taggedManifest.name !== pkg.name || taggedManifest.version !== version) {
		throw new Error(`Release tag ${version} does not identify ${pkg.name}@${version}.`);
	}
	if (hasMeaningfulChanges(pkg.dir)) {
		throw new Error(`Cannot adopt published ${pkg.name}@${version} while ${pkg.dir} has uncommitted changes.`);
	}
	const publishedArtifacts = await verifyPublishedReleaseArtifacts(new Map([[pkg.name, version]]));
	const previousStagingHead = remoteHeadCommit(pkg.dir, STAGING_BRANCH);
	if (previousStagingHead !== commitSha) {
		runGit([
			'push',
			`--force-with-lease=refs/heads/${STAGING_BRANCH}:${previousStagingHead}`,
			'origin',
			`${commitSha}:refs/heads/${STAGING_BRANCH}`,
		], { cwd: pkg.dir });
	}
	const previousProductionHead = remoteHeadCommit(pkg.dir, PRODUCTION_BRANCH);
	if (previousProductionHead !== commitSha) {
		promoteCommitToProductionBranch(pkg.dir, commitSha);
	}
	if (currentBranch(pkg.dir) !== STAGING_BRANCH) {
		checkoutBranch(pkg.dir, STAGING_BRANCH);
	}
	if (headCommit(pkg.dir) !== commitSha) {
		runGit(['reset', '--hard', commitSha], { cwd: pkg.dir });
	}
	const observedStagingHead = remoteHeadCommit(pkg.dir, STAGING_BRANCH);
	const observedProductionHead = remoteHeadCommit(pkg.dir, PRODUCTION_BRANCH);
	if (headCommit(pkg.dir) !== commitSha || observedStagingHead !== commitSha || observedProductionHead !== commitSha) {
		throw new Error(`Published release adoption failed for ${pkg.name}@${version}; local=${headCommit(pkg.dir)}, staging=${observedStagingHead}, main=${observedProductionHead}, expected=${commitSha}.`);
	}
	return {
		name: pkg.name,
		version,
		commit: { commitSha, status: 'adopted-published-tag' },
		tag: { tagName: version, local: 'existing', remote: 'existing' },
		branches: {
			staging: previousStagingHead === commitSha ? 'existing' : 'restored', 			production: previousProductionHead === commitSha ? 'existing' : 'restored',
		},
		publishedArtifacts,
	};
}

export function promoteCommitToProductionBranch(repoDir: string, commitSha: string) {
	const expectedBefore = remoteBranchExists(repoDir, PRODUCTION_BRANCH) ? remoteHeadCommit(repoDir, PRODUCTION_BRANCH) : null;
	const lease = expectedBefore
		? `--force-with-lease=refs/heads/${PRODUCTION_BRANCH}:${expectedBefore}`
		: '--force-with-lease';
	runGit(['push', lease, 'origin', `${commitSha}:refs/heads/${PRODUCTION_BRANCH}`], { cwd: repoDir });
	const observed = remoteHeadCommit(repoDir, PRODUCTION_BRANCH);
	if (observed !== commitSha) {
		throw new Error(`Production promotion verification failed; expected ${commitSha}, observed ${observed}.`);
	}
	return {
		targetBranch: PRODUCTION_BRANCH,
		expectedBefore,
		commitSha,
		pushed: true,
		verified: true,
	};
}

export function commitAllIfChanged(repoDir: string, message: string) {
	runGit(['add', '-A'], { cwd: repoDir });
	if (!hasMeaningfulChanges(repoDir)) {
		return { committed: false, commitSha: headCommit(repoDir) };
	}
	runGit(['commit', '-m', message], { cwd: repoDir });
	return { committed: true, commitSha: headCommit(repoDir) };
}

export function releaseHistoryCommits(repoDir: string, sourceRef = `origin/${PRODUCTION_BRANCH}`, targetRef = 'HEAD') {
	try {
		return collectReleaseHistoryCommits(repoDir, sourceRef, targetRef);
	} catch {
		return [] as ReleaseHistoryCommit[];
	}
}

export function versionLines(versions: Map<string, string> | null | undefined) {
	return [...(versions ?? new Map()).entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, version]) => `${name}: ${version}`);
}

export function updateReleaseChangelog(repoDir: string, input: {
	version: string;
	sourceRef?: string;
	targetRef?: string;
	commits?: ReleaseHistoryCommit[];
	extraDependencyBullets?: string[];
}) {
	const sourceRef = input.sourceRef ?? `origin/${PRODUCTION_BRANCH}`;
	const targetRef = input.targetRef ?? 'HEAD';
	const commits = input.commits ?? releaseHistoryCommits(repoDir, sourceRef, targetRef);
	return upsertReleaseChangelog(repoDir, {
		version: input.version,
		sourceRef,
		targetRef,
		commits,
		extraBullets: input.extraDependencyBullets?.length
			? { Dependencies: input.extraDependencyBullets }
			: undefined,
	});
}
