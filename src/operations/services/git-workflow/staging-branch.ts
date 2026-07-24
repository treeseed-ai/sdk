import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { run, workspaceRoot } from '../treedx/workspaces/workspace-tools.ts';
import { collectMergeConflictReport, currentBranch, formatMergeConflictReport, gitStatusPorcelain, repoRoot } from '../treedx/workspaces/workspace-save.ts';
import { ensureSshPushUrlForOrigin } from '../repositories/git-remote-policy.ts';
import { runRepositoryGit, type GitRunnerMode } from '../operations/git-runner.ts';
import { createManagedToolEnv, resolveToolBinary } from '../../../entrypoints/runtime/managed-dependencies.ts';


export const STAGING_BRANCH = 'staging';

export const PRODUCTION_BRANCH = 'main';

export const RESERVED_BRANCHES = new Set([STAGING_BRANCH, PRODUCTION_BRANCH]);

export function gitMode(args: string[]): GitRunnerMode {
	const command = args[0] ?? '';
	return new Set([
		'add',
		'checkout',
		'commit',
		'merge',
		'pull',
		'push',
		'rebase',
		'reset',
		'restore',
		'switch',
		'tag',
		'update-index',
		'worktree',
	]).has(command) ? 'mutate' : 'read';
}

export function runGit(args: string[], { cwd, capture = false }: { cwd?: string; capture?: boolean } = {}) {
	const result = runRepositoryGit(args, {
		cwd: cwd ?? workspaceRoot(),
		mode: gitMode(args),
		allowFailure: false,
	});
	return capture ? result.stdout : result.stdout;
}

export function runGitAllowFailure(args: string[], { cwd }: { cwd: string }) {
	return runRepositoryGit(args, {
		cwd,
		mode: gitMode(args),
		allowFailure: true,
	});
}

export function abortInProgressMerge(repoDir: string) {
	const mergeHead = runGitAllowFailure(['rev-parse', '--git-path', 'MERGE_HEAD'], { cwd: repoDir })
		.stdout
		.trim();
	const mergeHeadPath = mergeHead && (isAbsolute(mergeHead) ? mergeHead : resolve(repoDir, mergeHead));
	if (!mergeHeadPath || (!existsSync(mergeHeadPath) && conflictedFiles(repoDir).length === 0)) {
		return false;
	}
	const abort = runGitAllowFailure(['merge', '--abort'], { cwd: repoDir });
	if (abort.status === 0) {
		return true;
	}
	return runGitAllowFailure(['reset', '--merge'], { cwd: repoDir }).status === 0;
}

export function ensureWritableOrigin(repoDir) {
	try {
		const remoteUrl = runGit(['remote', 'get-url', 'origin'], { cwd: repoDir, capture: true }).trim();
		ensureSshPushUrlForOrigin(repoDir, remoteUrl);
	} catch {
		// Repositories without an origin will fail at the existing push call site.
	}
}

export function repoHasStagedChanges(repoDir) {
	try {
		runGit(['diff', '--cached', '--quiet'], { cwd: repoDir });
		return false;
	} catch {
		return true;
	}
}

export function conflictedFiles(repoDir) {
	return runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function isGeneratedPackageMetadataFile(filePath: string) {
	return filePath === 'package.json' || filePath === 'package-lock.json';
}

export function isPackagePointerConflict(repoDir: string, filePath: string) {
	if (!/^packages\/[^/]+$/u.test(filePath)) {
		return false;
	}
	const stagedEntries = runGit(['ls-files', '-u', '--', filePath], { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	return stagedEntries.length > 0 && stagedEntries.every((line) => line.startsWith('160000 '));
}

export function releaseSideConflictSha(repoDir: string, filePath: string) {
	const stagedEntries = runGit(['ls-files', '-u', '--', filePath], { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	for (const entry of stagedEntries) {
		const match = /^(\d+)\s+([0-9a-f]{40})\s+3\t(.+)$/u.exec(entry);
		if (match && match[1] === '160000' && match[3] === filePath) {
			return match[2];
		}
	}
	return null;
}

export function materializeReleaseSideFile(repoDir: string, filePath: string) {
	const content = runGit(['show', `:3:${filePath}`], { cwd: repoDir, capture: true });
	writeFileSync(resolve(repoDir, filePath), content);
	runGit(['add', '--', filePath], { cwd: repoDir });
}

export function stageReleaseSidePackagePointer(repoDir: string, filePath: string) {
	const sha = releaseSideConflictSha(repoDir, filePath);
	if (!sha) {
		throw new Error(`Unable to resolve release-side package pointer for ${filePath}.`);
	}
	runGit(['update-index', '--cacheinfo', '160000', sha, filePath], { cwd: repoDir });
}

export function isReleaseSideOnlyTextConflict(repoDir: string, filePath: string) {
	if (isGeneratedPackageMetadataFile(filePath) || isPackagePointerConflict(repoDir, filePath)) {
		return false;
	}
	const content = readFileSync(resolve(repoDir, filePath), 'utf8');
	const conflictBlocks = content.match(/<<<<<<< [\s\S]*?>>>>>>> .+/gu) ?? [];
	if (conflictBlocks.length === 0) {
		return false;
	}
	return conflictBlocks.every((block) => {
		const middle = block.indexOf('=======');
		if (middle === -1) {
			return false;
		}
		const ours = block.slice(block.indexOf('\n') + 1, middle).trim();
		return ours.length === 0;
	});
}

export function isReleaseSidePreferredWorkflowConflict(filePath: string) {
	return [
		'src/operations/services/git-workflow.ts',
		'src/workflow/operations.ts',
	].includes(filePath);
}

export function resolveGeneratedPackageMetadataConflicts(repoDir) {
	const files = conflictedFiles(repoDir);
	if (files.length === 0) {
		return {
			resolved: false,
			repoDir,
			targetBranch: STAGING_BRANCH,
			reconciledFiles: [],
			allConflictsWereGeneratedMetadata: false,
		};
	}
	const allConflictsWereGeneratedMetadata = files.every((file) => (
		isGeneratedPackageMetadataFile(file)
		|| isPackagePointerConflict(repoDir, file)
		|| isReleaseSideOnlyTextConflict(repoDir, file)
		|| isReleaseSidePreferredWorkflowConflict(file)
	));
	if (!allConflictsWereGeneratedMetadata) {
		return {
			resolved: false,
			repoDir,
			targetBranch: STAGING_BRANCH,
			reconciledFiles: files,
			allConflictsWereGeneratedMetadata: false,
		};
	}
	for (const file of files) {
		if (isGeneratedPackageMetadataFile(file)) {
			materializeReleaseSideFile(repoDir, file);
			continue;
		}
		if (isReleaseSideOnlyTextConflict(repoDir, file)) {
			materializeReleaseSideFile(repoDir, file);
			continue;
		}
		if (isReleaseSidePreferredWorkflowConflict(file)) {
			materializeReleaseSideFile(repoDir, file);
			continue;
		}
		stageReleaseSidePackagePointer(repoDir, file);
	}
	return {
		resolved: true,
		repoDir,
		targetBranch: STAGING_BRANCH,
		reconciledFiles: files,
		allConflictsWereGeneratedMetadata,
	};
}

export function headCommit(repoDir, ref = 'HEAD') {
	return runGit(['rev-parse', ref], { cwd: repoDir, capture: true }).trim();
}

export function maybeHeadCommit(repoDir, ref = 'HEAD') {
	try {
		return headCommit(repoDir, ref);
	} catch {
		return null;
	}
}
