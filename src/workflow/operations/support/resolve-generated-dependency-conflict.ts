import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyGitMode, runRepositoryGit } from '../../../operations/services/operations/git-runner.ts';

const GENERATED_FILES = new Set(['package.json', 'package-lock.json']);
const DEPENDENCY_FIELDS = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']);

function git(repoDir: string, args: string[], allowFailure = false) {
	return runRepositoryGit(args, { cwd: repoDir, mode: classifyGitMode(args), allowFailure });
}

function jsonAtRef(repoDir: string, ref: string) {
	const result = git(repoDir, ['show', `${ref}:package.json`], true);
	if (result.status !== 0) return null;
	try {
		return JSON.parse(result.stdout) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function revisionAtIndexStage(repoDir: string, stage: 2 | 3, path: string) {
	const result = git(repoDir, ['rev-parse', `:${stage}:${path}`], true);
	return result.status === 0 ? result.stdout.trim() : null;
}

function revisionAtRef(repoDir: string, ref: string, path: string) {
	const result = git(repoDir, ['ls-tree', ref, '--', path], true);
	if (result.status !== 0) return null;
	const match = /^160000 commit ([0-9a-f]{40})\t/u.exec(result.stdout.trim());
	return match?.[1] ?? null;
}

function childContainsBothConflictSides(repoDir: string, path: string, mergeHead: string) {
	const childDir = resolve(repoDir, path);
	if (!existsSync(childDir) || !existsSync(resolve(childDir, '.git'))) return false;
	const taskRevision = revisionAtIndexStage(repoDir, 2, path);
	const incomingRevision = revisionAtIndexStage(repoDir, 3, path) ?? revisionAtRef(repoDir, mergeHead, path);
	if (!taskRevision || !incomingRevision) return false;
	const childHeadResult = git(childDir, ['rev-parse', 'HEAD'], true);
	if (childHeadResult.status !== 0) return false;
	const childHead = childHeadResult.stdout.trim();
	return [taskRevision, incomingRevision].every((revision) =>
		git(childDir, ['merge-base', '--is-ancestor', revision, childHead], true).status === 0,
	);
}

function equal(left: unknown, right: unknown) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function incomingManifestChangesAreGenerated(base: Record<string, unknown>, incoming: Record<string, unknown>) {
	for (const key of new Set([...Object.keys(base), ...Object.keys(incoming)])) {
		if (equal(base[key], incoming[key])) continue;
		if (key === 'version') continue;
		if (!DEPENDENCY_FIELDS.has(key)) return false;
		const baseDependencies = base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
			? base[key] as Record<string, unknown>
			: {};
		const incomingDependencies = incoming[key] && typeof incoming[key] === 'object' && !Array.isArray(incoming[key])
			? incoming[key] as Record<string, unknown>
			: {};
		for (const dependency of new Set([...Object.keys(baseDependencies), ...Object.keys(incomingDependencies)])) {
			if (equal(baseDependencies[dependency], incomingDependencies[dependency])) continue;
			if (!dependency.startsWith('@treeseed/')) return false;
			if (typeof incomingDependencies[dependency] !== 'string' || !incomingDependencies[dependency].startsWith('github:treeseed-ai/')) return false;
		}
	}
	return true;
}

export function resolveGeneratedDependencyMergeConflict(repoDir: string, conflictedFiles: string[]) {
	if (conflictedFiles.length === 0) return null;
	const mergeHead = git(repoDir, ['rev-parse', '--verify', 'MERGE_HEAD'], true).stdout.trim();
	if (!mergeHead) return null;
	const mergeBase = git(repoDir, ['merge-base', 'HEAD', mergeHead], true).stdout.trim();
	if (!mergeBase) return null;
	const incomingFiles = git(repoDir, ['diff', '--name-only', mergeBase, mergeHead], true).stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	if (incomingFiles.length === 0) return null;
	const verifiedGitlinks = new Set(conflictedFiles.filter((path) =>
		!GENERATED_FILES.has(path) && childContainsBothConflictSides(repoDir, path, mergeHead),
	));
	if (conflictedFiles.some((path) => !GENERATED_FILES.has(path) && !verifiedGitlinks.has(path))) return null;
	if (incomingFiles.some((path) => !GENERATED_FILES.has(path) && !revisionAtRef(repoDir, mergeHead, path))) return null;
	const baseManifest = jsonAtRef(repoDir, mergeBase);
	const incomingManifest = jsonAtRef(repoDir, mergeHead);
	if (!baseManifest || !incomingManifest || !incomingManifestChangesAreGenerated(baseManifest, incomingManifest)) return null;
	const generatedConflicts = conflictedFiles.filter((path) => GENERATED_FILES.has(path));
	if (generatedConflicts.length > 0) git(repoDir, ['checkout', '--ours', '--', ...generatedConflicts]);
	git(repoDir, ['add', '--', ...conflictedFiles]);
	git(repoDir, ['commit', '--no-edit']);
	return {
		resolved: true,
		strategy: 'preserve-verified-task-generated-state' as const,
		conflictedFiles,
		incomingFiles,
		verifiedGitlinks: [...verifiedGitlinks],
	};
}
