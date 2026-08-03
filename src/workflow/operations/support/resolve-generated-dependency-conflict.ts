import { runRepositoryGit } from '../../../operations/services/operations/git-runner.ts';

const GENERATED_FILES = new Set(['package.json', 'package-lock.json']);
const DEPENDENCY_FIELDS = new Set(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']);

function git(repoDir: string, args: string[], allowFailure = false) {
	return runRepositoryGit(args, { cwd: repoDir, mode: args[0] === 'show' || args[0] === 'diff' || args[0] === 'merge-base' ? 'read' : 'mutate', allowFailure });
}

function jsonAtStage(repoDir: string, stage: 1 | 3) {
	const result = git(repoDir, ['show', `:${stage}:package.json`], true);
	if (result.status !== 0) return null;
	try {
		return JSON.parse(result.stdout) as Record<string, unknown>;
	} catch {
		return null;
	}
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
	if (conflictedFiles.length === 0 || conflictedFiles.some((path) => !GENERATED_FILES.has(path))) return null;
	const mergeHead = git(repoDir, ['rev-parse', '--verify', 'MERGE_HEAD'], true).stdout.trim();
	if (!mergeHead) return null;
	const mergeBase = git(repoDir, ['merge-base', 'HEAD', mergeHead], true).stdout.trim();
	if (!mergeBase) return null;
	const incomingFiles = git(repoDir, ['diff', '--name-only', mergeBase, mergeHead], true).stdout
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
	if (incomingFiles.length === 0 || incomingFiles.some((path) => !GENERATED_FILES.has(path))) return null;
	const baseManifest = jsonAtStage(repoDir, 1);
	const incomingManifest = jsonAtStage(repoDir, 3);
	if (!baseManifest || !incomingManifest || !incomingManifestChangesAreGenerated(baseManifest, incomingManifest)) return null;
	git(repoDir, ['checkout', '--ours', '--', ...conflictedFiles]);
	git(repoDir, ['add', '--', ...conflictedFiles]);
	git(repoDir, ['commit', '--no-edit']);
	return {
		resolved: true,
		strategy: 'preserve-descendant-task-dependency-pins' as const,
		conflictedFiles,
		incomingFiles,
	};
}
