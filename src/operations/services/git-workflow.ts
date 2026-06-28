import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { run, workspaceRoot } from './workspace-tools.ts';
import { collectMergeConflictReport, currentBranch, formatMergeConflictReport, gitStatusPorcelain, repoRoot } from './workspace-save.ts';
import { ensureSshPushUrlForOrigin } from './git-remote-policy.ts';
import { runTreeseedGit, type TreeseedGitRunnerMode } from './git-runner.ts';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../../managed-dependencies.ts';

export const STAGING_BRANCH = 'staging';
export const PRODUCTION_BRANCH = 'main';
const RESERVED_BRANCHES = new Set([STAGING_BRANCH, PRODUCTION_BRANCH]);

function gitMode(args: string[]): TreeseedGitRunnerMode {
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

function runGit(args: string[], { cwd, capture = false }: { cwd?: string; capture?: boolean } = {}) {
	const result = runTreeseedGit(args, {
		cwd: cwd ?? workspaceRoot(),
		mode: gitMode(args),
		allowFailure: false,
	});
	return capture ? result.stdout : result.stdout;
}

function runGitAllowFailure(args: string[], { cwd }: { cwd: string }) {
	return runTreeseedGit(args, {
		cwd,
		mode: gitMode(args),
		allowFailure: true,
	});
}

function abortInProgressMerge(repoDir: string) {
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

function ensureWritableOrigin(repoDir) {
	try {
		const remoteUrl = runGit(['remote', 'get-url', 'origin'], { cwd: repoDir, capture: true }).trim();
		ensureSshPushUrlForOrigin(repoDir, remoteUrl);
	} catch {
		// Repositories without an origin will fail at the existing push call site.
	}
}

function repoHasStagedChanges(repoDir) {
	try {
		runGit(['diff', '--cached', '--quiet'], { cwd: repoDir });
		return false;
	} catch {
		return true;
	}
}

function conflictedFiles(repoDir) {
	return runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

function isGeneratedPackageMetadataFile(filePath: string) {
	return filePath === 'package.json' || filePath === 'package-lock.json';
}

function isPackagePointerConflict(repoDir: string, filePath: string) {
	if (!/^packages\/[^/]+$/u.test(filePath)) {
		return false;
	}
	const stagedEntries = runGit(['ls-files', '-u', '--', filePath], { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
	return stagedEntries.length > 0 && stagedEntries.every((line) => line.startsWith('160000 '));
}

function releaseSideConflictSha(repoDir: string, filePath: string) {
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

function materializeReleaseSideFile(repoDir: string, filePath: string) {
	const content = runGit(['show', `:3:${filePath}`], { cwd: repoDir, capture: true });
	writeFileSync(resolve(repoDir, filePath), content);
	runGit(['add', '--', filePath], { cwd: repoDir });
}

function stageReleaseSidePackagePointer(repoDir: string, filePath: string) {
	const sha = releaseSideConflictSha(repoDir, filePath);
	if (!sha) {
		throw new Error(`Unable to resolve release-side package pointer for ${filePath}.`);
	}
	runGit(['update-index', '--cacheinfo', '160000', sha, filePath], { cwd: repoDir });
}

function isReleaseSideOnlyTextConflict(repoDir: string, filePath: string) {
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

function isReleaseSidePreferredWorkflowConflict(filePath: string) {
	return [
		'src/operations/services/git-workflow.ts',
		'src/workflow/operations.ts',
	].includes(filePath);
}

function resolveGeneratedPackageMetadataConflicts(repoDir) {
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

function maybeHeadCommit(repoDir, ref = 'HEAD') {
	try {
		return headCommit(repoDir, ref);
	} catch {
		return null;
	}
}

export function inspectDetachedHeadRepair(repoDir, expectedBranches = [STAGING_BRANCH, PRODUCTION_BRANCH]) {
	const branchName = currentBranch(repoDir) || null;
	const headSha = maybeHeadCommit(repoDir);
	const dirty = gitStatusPorcelain(repoDir).length > 0;
	if (branchName) {
		return {
			repoDir,
			branchName,
			detached: false,
			dirty,
			headSha,
			targetBranch: branchName,
			targetSha: headSha,
			repairable: false,
			repaired: false,
			blocker: null,
		};
	}

	for (const branch of expectedBranches) {
		const branchSha = branchExists(repoDir, branch) ? maybeHeadCommit(repoDir, branch) : null;
		if (headSha && branchSha && headSha === branchSha) {
			return {
				repoDir,
				branchName: null,
				detached: true,
				dirty,
				headSha,
				targetBranch: branch,
				targetSha: branchSha,
				repairable: true,
				repaired: false,
				blocker: null,
			};
		}
	}

	const expected = expectedBranches.join(' or ');
	return {
		repoDir,
		branchName: null,
		detached: true,
		dirty,
		headSha,
		targetBranch: null,
		targetSha: null,
		repairable: false,
		repaired: false,
		blocker: `Detached HEAD ${headSha ?? '(unknown)'} does not match ${expected}; review manually before continuing.`,
	};
}

export function reattachDetachedHeadIfSafe(repoDir, expectedBranches = [STAGING_BRANCH, PRODUCTION_BRANCH]) {
	const inspection = inspectDetachedHeadRepair(repoDir, expectedBranches);
	if (!inspection.detached || !inspection.repairable || !inspection.targetBranch) {
		return inspection;
	}
	runGit(['switch', inspection.targetBranch], { cwd: repoDir });
	return {
		...inspection,
		branchName: inspection.targetBranch,
		detached: false,
		repaired: true,
	};
}

export function gitWorkflowRoot(cwd = workspaceRoot()) {
	return repoRoot(cwd);
}

export function assertCleanWorktree(cwd = workspaceRoot()) {
	const root = gitWorkflowRoot(cwd);
	if (gitStatusPorcelain(root).length > 0) {
		throw new Error('Treeseed requires a clean git worktree before changing branches.');
	}
	return root;
}

export function assertCleanWorktrees(repoDirs) {
	for (const repoDir of repoDirs) {
		assertCleanWorktree(repoDir);
	}
	return repoDirs;
}

export function branchExists(repoDir, branchName) {
	try {
		runGit(['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], { cwd: repoDir });
		return true;
	} catch {
		return false;
	}
}

export function remoteBranchExists(repoDir, branchName) {
	try {
		const output = runGit(['ls-remote', '--heads', 'origin', branchName], { cwd: repoDir, capture: true });
		return output.trim().length > 0;
	} catch {
		return false;
	}
}

export function fetchOrigin(repoDir) {
	runGit(['fetch', 'origin'], { cwd: repoDir, capture: true });
}

export function remoteHeadCommit(repoDir, branchName) {
	fetchOrigin(repoDir);
	return runGit(['rev-parse', `origin/${branchName}`], { cwd: repoDir, capture: true }).trim();
}

export function pushCommitToBranch(repoDir, commitSha, branchName, { forceWithLease = false } = {}) {
	ensureWritableOrigin(repoDir);
	const args = forceWithLease
		? ['push', '--force-with-lease', 'origin', `${commitSha}:refs/heads/${branchName}`]
		: ['push', 'origin', `${commitSha}:refs/heads/${branchName}`];
	runGit(args, { cwd: repoDir });
}

export type StageMergeDownResult = {
	repoDir: string;
	featureBranch: string;
	sourceBranch: string;
	beforeHead: string;
	sourceHead: string | null;
	afterHead: string;
	merged: boolean;
	pushed: boolean;
	generatedMetadataReconciliation: Record<string, unknown> | null;
};

export type StageExactPromotionResult = {
	repoDir: string;
	targetBranch: string;
	expectedBefore: string | null;
	actualBefore: string | null;
	commitSha: string;
	pushed: boolean;
	verified: boolean;
};

export function mergeBranchDownIntoFeature(repoDir: string, input: {
	featureBranch: string;
	sourceBranch?: typeof STAGING_BRANCH;
	message: string;
	allowGeneratedMetadataAutoResolution?: boolean;
}): StageMergeDownResult {
	const sourceBranch = input.sourceBranch ?? STAGING_BRANCH;
	assertCleanWorktree(repoDir);
	fetchOrigin(repoDir);
	if (!branchExists(repoDir, input.featureBranch)) {
		if (!remoteBranchExists(repoDir, input.featureBranch)) {
			throw new Error(`Feature branch "${input.featureBranch}" does not exist locally or on origin.`);
		}
		runGit(['branch', input.featureBranch, `origin/${input.featureBranch}`], { cwd: repoDir });
	}
	checkoutBranch(repoDir, input.featureBranch);
	const beforeHead = headCommit(repoDir);
	const sourceHead = remoteBranchExists(repoDir, sourceBranch) ? remoteHeadCommit(repoDir, sourceBranch) : null;
	if (!sourceHead) {
		throw new Error(`Source branch "${sourceBranch}" does not exist on origin.`);
	}
	let generatedMetadataReconciliation: Record<string, unknown> | null = null;
	try {
		runGit(['merge', '--no-ff', `origin/${sourceBranch}`, '-m', input.message], { cwd: repoDir, capture: true });
	} catch (error) {
		const reconciliation = input.allowGeneratedMetadataAutoResolution === false
			? { resolved: false }
			: resolveGeneratedPackageMetadataConflicts(repoDir);
		if (!reconciliation.resolved) {
			const report = collectMergeConflictReport(repoDir);
			const conflictError = new Error(formatMergeConflictReport(report, repoDir, sourceBranch));
			Object.assign(conflictError, {
				cause: error,
				mergeConflictReport: report,
				code: 'conflict_resolution_required',
			});
			throw conflictError;
		}
		generatedMetadataReconciliation = reconciliation as Record<string, unknown>;
		if (repoHasStagedChanges(repoDir)) {
			runGit(['commit', '-m', input.message], { cwd: repoDir });
		}
	}
	const afterHead = headCommit(repoDir);
	const merged = beforeHead !== afterHead;
	if (merged) {
		pushBranch(repoDir, input.featureBranch);
	}
	return {
		repoDir,
		featureBranch: input.featureBranch,
		sourceBranch,
		beforeHead,
		sourceHead,
		afterHead,
		merged,
		pushed: merged,
		generatedMetadataReconciliation,
	};
}

export function promoteCommitToBranchWithExpectedHead(repoDir: string, input: {
	commitSha: string;
	targetBranch?: typeof STAGING_BRANCH;
	expectedBefore: string | null;
}): StageExactPromotionResult {
	const targetBranch = input.targetBranch ?? STAGING_BRANCH;
	fetchOrigin(repoDir);
	const actualBefore = remoteBranchExists(repoDir, targetBranch) ? remoteHeadCommit(repoDir, targetBranch) : null;
	if (actualBefore !== input.expectedBefore) {
		throw new Error(`Refusing to promote ${targetBranch}; origin/${targetBranch} moved from ${input.expectedBefore ?? '(missing)'} to ${actualBefore ?? '(missing)'}.`);
	}
	ensureWritableOrigin(repoDir);
	const lease = actualBefore
		? `--force-with-lease=refs/heads/${targetBranch}:${actualBefore}`
		: '--force-with-lease';
	runGit(['push', lease, 'origin', `${input.commitSha}:refs/heads/${targetBranch}`], { cwd: repoDir });
	fetchOrigin(repoDir);
	const verifiedHead = remoteHeadCommit(repoDir, targetBranch);
	if (verifiedHead !== input.commitSha) {
		throw new Error(`Promotion verification failed for ${targetBranch}; expected ${input.commitSha}, observed ${verifiedHead}.`);
	}
	return {
		repoDir,
		targetBranch,
		expectedBefore: input.expectedBefore,
		actualBefore,
		commitSha: input.commitSha,
		pushed: true,
		verified: true,
	};
}

export function ensureLocalBranchTracking(repoDir, branchName) {
	if (branchExists(repoDir, branchName)) {
		return;
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
		return;
	}

	runGit(['checkout', '--orphan', branchName], { cwd: repoDir });
}

export function checkoutBranch(repoDir, branchName) {
	runGit(['checkout', branchName], { cwd: repoDir, capture: true });
}

export function checkoutTaskBranchFromStaging(
	cwd,
	branchName,
	{ createIfMissing = true, pushIfCreated = false } = {},
) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	const stagingBaseRef = remoteBranchExists(repoDir, STAGING_BRANCH)
		? `origin/${STAGING_BRANCH}`
		: branchExists(repoDir, STAGING_BRANCH)
			? STAGING_BRANCH
			: null;
	if (!stagingBaseRef) {
		throw new Error(`Base branch "${STAGING_BRANCH}" does not exist locally or on origin.`);
	}

	if (currentBranch(repoDir) === branchName) {
		return {
			repoDir,
			branchName,
			baseBranch: STAGING_BRANCH,
			created: false,
			resumed: true,
			remoteBranch: remoteBranchExists(repoDir, branchName),
		};
	}

	if (branchExists(repoDir, branchName)) {
		checkoutBranch(repoDir, branchName);
		if (remoteBranchExists(repoDir, branchName)) {
			runGit(['pull', '--rebase', 'origin', branchName], { cwd: repoDir });
		}
		return {
			repoDir,
			branchName,
			baseBranch: STAGING_BRANCH,
			created: false,
			resumed: true,
			remoteBranch: remoteBranchExists(repoDir, branchName),
		};
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
		runGit(['pull', '--rebase', 'origin', branchName], { cwd: repoDir });
		return {
			repoDir,
			branchName,
			baseBranch: STAGING_BRANCH,
			created: false,
			resumed: true,
			remoteBranch: true,
		};
	}

	if (!createIfMissing) {
		throw new Error(`Branch "${branchName}" does not exist locally or on origin.`);
	}

	runGit(['checkout', '-b', branchName, stagingBaseRef], { cwd: repoDir });
	if (pushIfCreated) {
		pushBranch(repoDir, branchName, { setUpstream: true });
	}
	return {
		repoDir,
		branchName,
		baseBranch: STAGING_BRANCH,
		created: true,
		resumed: false,
		remoteBranch: pushIfCreated,
	};
}

export function syncBranchWithOrigin(repoDir, branchName) {
	fetchOrigin(repoDir);
	if (!branchExists(repoDir, branchName) && remoteBranchExists(repoDir, branchName)) {
		runGit(['checkout', '-b', branchName, `origin/${branchName}`], { cwd: repoDir });
	} else {
		checkoutBranch(repoDir, branchName);
	}

	if (remoteBranchExists(repoDir, branchName)) {
		runGit(['merge', '--ff-only', `origin/${branchName}`], { cwd: repoDir, capture: true });
	}
}

export function checkoutDetachedOriginBranch(repoDir, branchName) {
	fetchOrigin(repoDir);
	if (!remoteBranchExists(repoDir, branchName)) {
		throw new Error(`Remote branch "origin/${branchName}" does not exist.`);
	}
	runGit(['checkout', '--detach', `origin/${branchName}`], { cwd: repoDir });
}

export function pushHeadToBranch(repoDir, branchName) {
	ensureWritableOrigin(repoDir);
	runGit(['push', 'origin', `HEAD:${branchName}`], { cwd: repoDir });
}

export function createFeatureBranchFromStaging(cwd, branchName) {
	const result = checkoutTaskBranchFromStaging(cwd, branchName, {
		createIfMissing: true,
		pushIfCreated: false,
	});
	if (!result.created) {
		throw new Error(`Branch "${branchName}" already exists locally or on origin.`);
	}
	return result;
}

export function pushBranch(repoDir, branchName, { setUpstream = false } = {}) {
	ensureWritableOrigin(repoDir);
	const args = setUpstream ? ['push', '-u', 'origin', branchName] : ['push', 'origin', branchName];
	runGit(args, { cwd: repoDir });
}

export function taskTagSlug(branchName) {
	return String(branchName ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.replace(/[^a-z0-9._-]+/giu, '-')
		.toLowerCase()
		.replace(/-+/gu, '-')
		.replace(/^-|-$/gu, '')
		|| 'task';
}

export function createDeprecatedTaskTag(repoDir, branchName, reason = '') {
	const head = headCommit(repoDir, branchName);
	const tagName = `deprecated/${taskTagSlug(branchName)}/${head.slice(0, 12)}`;
	const message = [
		`Deprecated task branch ${branchName}`,
		String(reason ?? '').trim(),
	].filter(Boolean).join('\n\n');
	runGit(['tag', '-a', tagName, head, '-m', message], { cwd: repoDir });
	ensureWritableOrigin(repoDir);
	runGit(['push', 'origin', tagName], { cwd: repoDir });
	return {
		repoDir,
		branchName,
		tagName,
		head,
		pushed: true,
	};
}

export function ensureRemoteBranchFromBase(
	repoDir,
	branchName,
	{ baseBranch = PRODUCTION_BRANCH } = {},
) {
	fetchOrigin(repoDir);
	if (remoteBranchExists(repoDir, branchName)) {
		return {
			branchName,
			baseBranch,
			createdLocal: branchExists(repoDir, branchName) ? false : (() => {
				runGit(['branch', branchName, `origin/${branchName}`], { cwd: repoDir });
				return true;
			})(),
			pushed: false,
			existed: true,
		};
	}

	const baseRef = remoteBranchExists(repoDir, baseBranch)
		? `origin/${baseBranch}`
		: branchExists(repoDir, baseBranch)
			? baseBranch
			: '';
	if (!baseRef) {
		throw new Error(`Base branch "${baseBranch}" does not exist locally or on origin.`);
	}
	const createdLocal = !branchExists(repoDir, branchName);
	if (createdLocal) {
		runGit(['branch', branchName, baseRef], { cwd: repoDir });
	}
	pushBranch(repoDir, branchName, { setUpstream: true });
	return {
		branchName,
		baseBranch,
		createdLocal,
		pushed: true,
		existed: false,
	};
}

export function deleteLocalBranch(repoDir, branchName) {
	if (!branchExists(repoDir, branchName)) {
		return;
	}
	runGit(['branch', '-D', branchName], { cwd: repoDir });
}

export function deleteRemoteBranch(repoDir, branchName) {
	if (!remoteBranchExists(repoDir, branchName)) {
		return false;
	}
	ensureWritableOrigin(repoDir);
	runGit(['push', 'origin', '--delete', branchName], { cwd: repoDir });
	return true;
}

export function mergeCurrentBranchIntoStaging(cwd, featureBranch) {
	return squashMergeBranchIntoStaging(cwd, featureBranch, `stage: ${featureBranch}`);
}

export function squashMergeBranchIntoStaging(cwd, featureBranch, message, { pushTarget = true, reportGeneratedMetadataReconciliation = true } = {}) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	let generatedMetadataReconciliation = null;
	try {
		runGit(['merge', '--squash', featureBranch], { cwd: repoDir, capture: true });
	} catch (error) {
		const reconciliation = resolveGeneratedPackageMetadataConflicts(repoDir);
		if (!reconciliation.resolved) {
			const report = collectMergeConflictReport(repoDir);
			const mergeAborted = abortInProgressMerge(repoDir);
			const conflictError = new Error(formatMergeConflictReport(report, repoDir, STAGING_BRANCH));
			Object.assign(conflictError, {
				cause: error,
				mergeAborted,
				mergeConflictReport: report,
			});
			throw conflictError;
		}
		if (reportGeneratedMetadataReconciliation) {
			console.log(`Resolving generated package metadata reconciliation for ${reconciliation.reconciledFiles.join(', ')}.`);
		}
		generatedMetadataReconciliation = {
			...reconciliation,
			commitSha: null,
		};
	}
	let committed = false;
	if (repoHasStagedChanges(repoDir)) {
		runGit(['commit', '-m', message], { cwd: repoDir });
		committed = true;
	}
	const commitSha = headCommit(repoDir);
	if (generatedMetadataReconciliation) {
		generatedMetadataReconciliation.commitSha = commitSha;
	}
	if (pushTarget) {
		pushBranch(repoDir, STAGING_BRANCH);
	}
	return {
		repoDir,
		targetBranch: STAGING_BRANCH,
		committed,
		commitSha,
		pushed: pushTarget,
		generatedMetadataReconciliation,
	};
}

export function currentManagedBranch(cwd = workspaceRoot()) {
	return currentBranch(gitWorkflowRoot(cwd));
}

export function isTaskBranch(branchName) {
	return Boolean(branchName)
		&& !RESERVED_BRANCHES.has(branchName)
		&& !branchName.startsWith('deprecated/');
}

export function assertFeatureBranch(cwd = workspaceRoot()) {
	const branchName = currentManagedBranch(cwd);
	if (!branchName) {
		throw new Error('Unable to determine the current git branch.');
	}
	if (!isTaskBranch(branchName)) {
		throw new Error(`Treeseed task commands only work on task branches. Current branch: ${branchName}`);
	}
	return branchName;
}

function gitLines(repoDir, args) {
	return runGit(args, { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function listTaskBranches(repoDir) {
	try {
		runGit(['fetch', 'origin'], { cwd: repoDir, capture: true });
	} catch {
		// Local-only repositories can still report local task branches.
	}
	const local = new Set(
		gitLines(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
			.filter(isTaskBranch),
	);
	const remote = new Set(
		gitLines(repoDir, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin'])
			.filter((branchName) => branchName.startsWith('origin/') && branchName !== 'origin/HEAD')
			.map((branchName) => branchName.replace(/^origin\//, ''))
			.filter(isTaskBranch),
	);
	const current = currentBranch(repoDir);
	const branches = [...new Set([...local, ...remote])].sort((left, right) => left.localeCompare(right));

	return branches.map((branchName) => {
		const ref = local.has(branchName) ? branchName : `origin/${branchName}`;
		return {
			name: branchName,
			head: runGit(['rev-parse', ref], { cwd: repoDir, capture: true }).trim(),
			lastCommitDate: runGit(['log', '-1', '--format=%cI', ref], { cwd: repoDir, capture: true }).trim(),
			lastCommitSubject: runGit(['log', '-1', '--format=%s', ref], { cwd: repoDir, capture: true }).trim(),
			local: local.has(branchName),
			remote: remote.has(branchName),
			current: branchName === current,
		};
	});
}

export function waitForStagingAutomation(repoDir) {
	if (process.env.TREESEED_STAGE_WAIT_MODE === 'skip') {
		return { status: 'skipped', reason: 'disabled' };
	}

	try {
		const gh = resolveTreeseedToolBinary('gh');
		if (!gh) {
			throw new Error('GitHub CLI `gh` is unavailable.');
		}
		run(gh, ['run', 'watch', '--branch', STAGING_BRANCH, '--exit-status'], {
			cwd: repoDir,
			env: createTreeseedManagedToolEnv(process.env),
		});
		return { status: 'completed', branch: STAGING_BRANCH };
	} catch (error) {
		throw new Error([
			'Treeseed stage could not confirm the staging deploy/checks completed.',
			error instanceof Error ? error.message : String(error),
			'Inspect GitHub Actions with `gh run list --branch staging` or your deployment provider logs.',
		].join('\n'));
	}
}

export function prepareReleaseBranches(cwd = workspaceRoot()) {
	const repoDir = assertCleanWorktree(cwd);
	fetchOrigin(repoDir);
	syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	if (remoteBranchExists(repoDir, PRODUCTION_BRANCH) || branchExists(repoDir, PRODUCTION_BRANCH)) {
		syncBranchWithOrigin(repoDir, PRODUCTION_BRANCH);
		syncBranchWithOrigin(repoDir, STAGING_BRANCH);
	}
	return repoDir;
}

export function mergeStagingIntoMain(cwd = workspaceRoot()) {
	return mergeBranchIntoTarget(cwd, {
		sourceBranch: STAGING_BRANCH,
		targetBranch: PRODUCTION_BRANCH,
		message: `release: ${STAGING_BRANCH} -> ${PRODUCTION_BRANCH}`,
		pushTarget: true,
		allowUnrelatedHistories: false,
	});
}

export function mergeBranchIntoTarget(
	cwd = workspaceRoot(),
	{ sourceBranch, targetBranch, message, pushTarget = true, quietMerge = false, allowUnrelatedHistories = false } = {},
) {
	const repoDir = prepareReleaseBranches(cwd);
	checkoutBranch(repoDir, targetBranch);
	if (remoteBranchExists(repoDir, targetBranch)) {
		runGit(['merge', '--ff-only', `origin/${targetBranch}`], { cwd: repoDir });
	}
	const mergeArgs = ['merge', '--no-ff'];
	if (allowUnrelatedHistories) {
		mergeArgs.push('--allow-unrelated-histories');
	}
	mergeArgs.push(sourceBranch, '-m', message);
	runGit(mergeArgs, { cwd: repoDir, capture: quietMerge });
	pushBranch(repoDir, STAGING_BRANCH);
	if (pushTarget) {
		pushBranch(repoDir, targetBranch);
	}
	return {
		repoDir,
		targetBranch,
		commitSha: headCommit(repoDir),
		pushed: pushTarget,
	};
}
