import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { classifyTreeseedGitMode, runTreeseedGitText } from '../git-runner.ts';
import {
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
	type GitRemoteWriteMode,
} from '../git-remote-policy.ts';
import {
	generateRepositoryCommitMessage,
	type CommitMessageDependencyUpdate,
	type CommitMessageContext,
	type CommitMessagePackageChange,
	type CommitMessageProvider,
	type CommitMessageProviderMode,
	type CommitMessageSubmodulePointer,
} from '../commit-message-provider.ts';
import {
	createPackageDependencyReference,
	type DevDependencyReferenceMode,
	type GitDependencyProtocol,
	normalizeGitRemoteForDependency,
	type PackageDependencyReference,
	type RewrittenDevReference,
	updateInternalDependencySpecs,
} from '../package-reference-policy.ts';
import {
	PRODUCTION_BRANCH,
	branchExists,
	checkoutBranch,
	headCommit,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
} from '../git-workflow.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	repoRoot,
} from '../workspace-save.ts';
import {
	hasCompleteTreeseedPackageCheckout,
	run,
	sortWorkspacePackages,
	workspacePackages,
} from '../workspace-tools.ts';
import { collectDeploymentLockfileWorkspaceIssues, ensureLocalWorkspaceLinks } from '../workspace-dependency-mode.ts';
import {
	createBuildWarningSummary,
	formatAllowedBuildWarnings,
	type BuildWarningPolicyOptions,
} from '../build-warning-policy.js';
import {
	readTreeseedVerificationCache,
	writeTreeseedVerificationCache,
} from '../verification-cache.ts';
import {
	discoverTreeseedPackageAdapters,
	type TreeseedPackageCommand,
} from '../package-adapters.ts';
import {
	discoverTreeseedManagedRepositories,
	parseGitmodulesPaths,
	readTreeseedTemplateRepositoryManifest,
	type TreeseedManagedRepositoryKind,
} from '../managed-repositories.ts';
import { RepositorySaveError, RepositorySaveNode, RepositorySaveOptions, RepositorySaveReport, RepositoryVerificationResult, SaveState, SaveVerifyMode, emitProgress, runGit } from './repo-kind.ts';
import { runCapturedCommand, runStreamingCommand } from './with-short-process-temp-env.ts';
import { hasAnyVerificationCommand, hasScript, manifestVerifyCommand, runGitDependencySmoke, runProjectVerificationInstallWithRetry } from './sync-root-workspace-lockfile-metadata.ts';
import { remoteBranchExistsSafe } from './discover-repository-save-nodes.ts';
import { ensureWritableRemote } from './classify-repo-kind.ts';
import { assertTagStateMatchesHead, tagState } from './tag-state.ts';

export async function runScript(node: RepositorySaveNode, options: RepositorySaveOptions, scriptName: string) {
	await runStreamingCommand(node, options, 'verify', 'npm', ['run', scriptName]);
}

export async function runManifestVerifyCommand(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	verifyMode: SaveVerifyMode,
	key: 'fast' | 'local' | 'release',
) {
	const manifestCommand = manifestVerifyCommand(node, key);
	if (!manifestCommand) {
		throw new RepositorySaveError(`${node.name} is missing a ${key} verification command in treeseed.package.yaml.`);
	}
	const command = `${manifestCommand.command} ${manifestCommand.args.join(' ')}`;
	const cacheInput = {
		workspaceRoot: options.root,
		repoName: node.name,
		repoPath: node.path,
		command,
		verifyMode,
		env: process.env,
	};
	const cached = readTreeseedVerificationCache(cacheInput);
	if (cached) {
		emitProgress(options, node, 'verify', `[verify][cache] Reused ${node.name} ${manifestCommand.label} for ${cached.headSha.slice(0, 12)}.`);
		return { cached: true };
	}
	const started = Date.now();
	await runStreamingCommand(node, options, 'verify', manifestCommand.command, manifestCommand.args, { cwd: manifestCommand.cwd });
	writeTreeseedVerificationCache(cacheInput, Date.now() - started);
	return { cached: false };
}

export async function runCachedScript(node: RepositorySaveNode, options: RepositorySaveOptions, verifyMode: SaveVerifyMode, scriptName: string) {
	const command = `npm run ${scriptName}`;
	const cacheInput = {
		workspaceRoot: options.root,
		repoName: node.name,
		repoPath: node.path,
		command,
		verifyMode,
		env: process.env,
	};
	const cached = readTreeseedVerificationCache(cacheInput);
	if (cached) {
		emitProgress(options, node, 'verify', `[verify][cache] Reused ${node.name} ${scriptName} for ${cached.headSha.slice(0, 12)}.`);
		return { cached: true };
	}
	const started = Date.now();
	await runScript(node, options, scriptName);
	writeTreeseedVerificationCache(cacheInput, Date.now() - started);
	return { cached: false };
}

export async function runRepoVerification(node: RepositorySaveNode, options: RepositorySaveOptions, verifyMode: SaveVerifyMode): Promise<RepositoryVerificationResult> {
	if (verifyMode === 'skip') {
		emitProgress(options, node, 'verify', 'Skipped verification by request.');
		return { mode: verifyMode, status: 'skipped', primary: null, fallbackUsed: false, error: null };
	}
	if (node.kind !== 'package' && !hasAnyVerificationCommand(node)) {
		emitProgress(options, node, 'verify', 'Skipped verification because project repository does not declare a Treeseed verify script.');
		return { mode: verifyMode, status: 'skipped', primary: null, fallbackUsed: false, error: null };
	}
	await runProjectVerificationInstallWithRetry(node, options);
	if (verifyMode === 'local-only') {
		if (hasScript(node, 'verify:local')) {
			await runCachedScript(node, options, verifyMode, 'verify:local');
			return { mode: verifyMode, status: 'passed', primary: 'verify:local', fallbackUsed: false, error: null };
		}
		if (manifestVerifyCommand(node, 'local')) {
			await runManifestVerifyCommand(node, options, verifyMode, 'local');
			return { mode: verifyMode, status: 'passed', primary: 'manifest:local', fallbackUsed: false, error: null };
		}
		if (manifestVerifyCommand(node, 'fast')) {
			await runManifestVerifyCommand(node, options, verifyMode, 'fast');
			return { mode: verifyMode, status: 'passed', primary: 'manifest:fast', fallbackUsed: false, error: null };
		}
		if (!hasScript(node, 'verify:local')) {
			throw new RepositorySaveError(`${node.kind === 'package' ? 'Package' : 'Project'} ${node.name} is missing required verify:local script.`);
		}
	}
	if (!hasAnyVerificationCommand(node)) {
		throw new RepositorySaveError(`${node.kind === 'package' ? 'Package' : 'Project'} ${node.name} is missing required verify:action, verify:local, or verify script.`);
	}
	if (hasScript(node, 'verify:action')) {
		try {
			await runCachedScript(node, options, verifyMode, 'verify:action');
			return { mode: verifyMode, status: 'passed', primary: 'verify:action', fallbackUsed: false, error: null };
		} catch (error) {
			if (!hasScript(node, 'verify:local')) {
				throw error;
			}
			emitProgress(options, node, 'verify', 'verify:action failed; falling back to verify:local.', 'stderr');
			await runCachedScript(node, options, verifyMode, 'verify:local');
			return {
				mode: verifyMode,
				status: 'passed',
				primary: 'verify:action',
				fallbackUsed: true,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}
	if (hasScript(node, 'verify:local')) {
		await runCachedScript(node, options, verifyMode, 'verify:local');
		return { mode: verifyMode, status: 'passed', primary: 'verify:local', fallbackUsed: true, error: null };
	}
	if (manifestVerifyCommand(node, 'local')) {
		await runManifestVerifyCommand(node, options, verifyMode, 'local');
		return { mode: verifyMode, status: 'passed', primary: 'manifest:local', fallbackUsed: true, error: null };
	}
	if (manifestVerifyCommand(node, 'fast')) {
		await runManifestVerifyCommand(node, options, verifyMode, 'fast');
		return { mode: verifyMode, status: 'passed', primary: 'manifest:fast', fallbackUsed: true, error: null };
	}
	await runCachedScript(node, options, verifyMode, 'verify');
	return { mode: verifyMode, status: 'passed', primary: 'verify:local', fallbackUsed: true, error: null };
}

export function pullRebaseFromOrigin(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string) {
	if (!remoteBranchExistsSafe(node.path, branch)) {
		emitProgress(options, node, 'rebase', `Skipped pull --rebase because origin/${branch} does not exist.`);
		return {
			remoteBranchExisted: false,
			pulledRebase: false,
		};
	}
	try {
		runCapturedCommand(node, options, 'rebase', 'git', ['fetch', 'origin', `refs/heads/${branch}:refs/remotes/origin/${branch}`]);
		runCapturedCommand(node, options, 'rebase', 'git', ['rebase', `refs/remotes/origin/${branch}`]);
		return {
			remoteBranchExisted: true,
			pulledRebase: true,
		};
	} catch (error) {
		const report = collectMergeConflictReport(node.path);
		throw new RepositorySaveError(formatMergeConflictReport(report, node.path, branch), {
			exitCode: 12,
			details: { branch, report, originalError: error instanceof Error ? error.message : String(error) },
		});
	}
}

export function pushCurrentBranch(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string, tagName?: string | null) {
	ensureWritableRemote(node, options);
	const remoteBranchExists = remoteBranchExistsSafe(node.path, branch);
	let pushedTag = false;
	const args = remoteBranchExists
		? ['push', 'origin', branch]
		: ['push', '-u', 'origin', branch];
	if (tagName) {
		const state = tagState(node.path, tagName);
		assertTagStateMatchesHead(node, tagName, state, headCommit(node.path));
		if (!state.remoteExists) {
			args.push(tagName);
			pushedTag = true;
		}
	}
	runCapturedCommand(node, options, 'push', 'git', args);
	return {
		createdRemoteBranch: !remoteBranchExists,
		pushed: true,
		pushedTag,
		combinedBranchAndTagPush: pushedTag,
	};
}

export async function finishRepositorySavePublish(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	state: SaveState,
	report: RepositorySaveReport,
	input: {
		branch: string;
		rebase: Record<string, unknown>;
		reference?: PackageDependencyReference | null;
		tagName?: string | null;
	},
) {
	const reference = input.reference ?? null;
	const tagName = input.tagName ?? reference?.tagName ?? null;
	const shouldDeferPush = options.deferPushUntilVerified === true;
	if (shouldDeferPush) {
		state.deferredPushes.push({
			node,
			report,
			branch: input.branch,
			tagName,
			rebase: input.rebase,
			reference,
		});
		report.pushed = false;
		report.publishWait = {
			...input.rebase,
			deferredPush: true,
		};
		return;
	}
	const push = pushCurrentBranch(node, options, input.branch, tagName);
	if (reference) {
		await runGitDependencySmoke(node, options, reference);
		report.dependencySpec = reference.spec;
	}
	report.pushed = push.pushed;
	report.publishWait = {
		...input.rebase,
		...push,
	};
}

export async function publishDeferredRepositoryPushes(options: RepositorySaveOptions, state: SaveState) {
	if (state.deferredPushes.length === 0) return;
	for (const deferred of state.deferredPushes) {
		const push = pushCurrentBranch(deferred.node, options, deferred.branch, deferred.tagName);
		if (deferred.reference) {
			await runGitDependencySmoke(deferred.node, options, deferred.reference);
			deferred.report.dependencySpec = deferred.reference.spec;
		}
		deferred.report.pushed = push.pushed;
		deferred.report.publishWait = {
			...deferred.rebase,
			...push,
			deferredPush: true,
		};
	}
	state.deferredPushes = [];
}

export function tagExists(repoDir: string, tagName: string) {
	try {
		runGit(['rev-parse', '--verify', `refs/tags/${tagName}`], { cwd: repoDir, capture: true });
		return true;
	} catch {
		return false;
	}
}

export function localTagCommit(repoDir: string, tagName: string) {
	try {
		return runGit(['rev-list', '-n', '1', tagName], { cwd: repoDir, capture: true }).trim();
	} catch {
		return null;
	}
}

export function remoteTagCommit(repoDir: string, tagName: string) {
	try {
		const output = runGit(['ls-remote', '--tags', 'origin', `refs/tags/${tagName}*`], { cwd: repoDir, capture: true });
		const lines = output.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
		const dereferenced = lines.find((line) => line.endsWith(`refs/tags/${tagName}^{}`));
		const exact = lines.find((line) => line.endsWith(`refs/tags/${tagName}`));
		const selected = dereferenced ?? exact;
		return selected ? selected.split(/\s+/u)[0] ?? null : null;
	} catch {
		return null;
	}
}

export function localTagMessage(repoDir: string, tagName: string) {
	try {
		return runGit(['tag', '-l', tagName, '--format=%(contents)'], { cwd: repoDir, capture: true }).trim();
	} catch {
		return null;
	}
}
