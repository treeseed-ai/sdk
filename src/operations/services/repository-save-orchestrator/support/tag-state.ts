import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve, relative } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { classifyGitMode, runGitText } from '../../operations/git-runner.ts';
import {
	ensureSshPushUrlForOrigin,
	remoteWriteUrl,
	sshPushUrlForRemote,
	type GitRemoteWriteMode,
} from '../../repositories/git-remote-policy.ts';
import {
	generateRepositoryCommitMessage,
	type CommitMessageDependencyUpdate,
	type CommitMessageContext,
	type CommitMessagePackageChange,
	type CommitMessageProvider,
	type CommitMessageProviderMode,
	type CommitMessageSubmodulePointer,
} from '../../capacity/providers/commit-message-provider.ts';
import {
	createPackageDependencyReference,
	type DevDependencyReferenceMode,
	type GitDependencyProtocol,
	normalizeGitRemoteForDependency,
	type PackageDependencyReference,
	type RewrittenDevReference,
	updateInternalDependencySpecs,
} from '../../packages/package-reference-policy.ts';
import {
	PRODUCTION_BRANCH,
	branchExists,
	checkoutBranch,
	headCommit,
	pushBranch,
	remoteBranchExists,
	STAGING_BRANCH,
} from '../../operations/git-workflow.ts';
import {
	collectMergeConflictReport,
	currentBranch,
	formatMergeConflictReport,
	gitStatusPorcelain,
	hasMeaningfulChanges,
	incrementVersion,
	originRemoteUrl,
	repoRoot,
} from '../../treedx/workspaces/workspace-save.ts';
import {
	hasCompletePackageCheckout,
	run,
	sortWorkspacePackages,
	workspacePackages,
} from '../../treedx/workspaces/workspace-tools.ts';
import { collectDeploymentLockfileWorkspaceIssues, ensureLocalWorkspaceLinks } from '../../treedx/workspaces/workspace-dependency-mode.ts';
import {
	createBuildWarningSummary,
	formatAllowedBuildWarnings,
	type BuildWarningPolicyOptions,
} from '../../build/build-warning-policy.js';
import {
	readVerificationCache,
	writeVerificationCache,
} from '../../support/verification-cache.ts';
import {
	discoverPackageAdapters,
	type PackageCommand,
} from '../../reconciliation/package-adapters.ts';
import {
	discoverManagedRepositories,
	parseGitmodulesPaths,
	readTemplateRepositoryManifest,
	type ManagedRepositoryKind,
} from '../../support/managed-repositories.ts';
import { localTagCommit, remoteTagCommit } from './run-script.ts';
import { RepositorySaveError, RepositorySaveNode, RepositorySaveOptions, SaveState, emitProgress, readJson, runGit } from './repo-kind.ts';
import { ensureWritableRemote, isGitRepo, originRemoteUrlSafe, repoDisplayName } from './classify-repo-kind.ts';
import { packageScripts, runCapturedCommand, runQuietCommand } from '../runtime/with-short-process-temp-env.ts';
import { checkoutOrCreateBranch, commitSubject } from '../repositories/discover-repository-save-nodes.ts';

export function tagState(repoDir: string, tagName: string) {
	const localCommit = localTagCommit(repoDir, tagName);
	const remoteCommit = remoteTagCommit(repoDir, tagName);
	return {
		tagName,
		localExists: localCommit != null,
		localCommit,
		remoteExists: remoteCommit != null,
		remoteCommit,
	};
}

export function assertTagStateMatchesHead(node: RepositorySaveNode, tagName: string, state: ReturnType<typeof tagState>, head: string) {
	if (state.localCommit && state.localCommit !== head) {
		throw new RepositorySaveError(`Package ${node.name} tag ${tagName} points to ${state.localCommit.slice(0, 12)}, but ${node.name} HEAD is ${head.slice(0, 12)}. Refusing to move an existing tag.`, {
			details: {
				failingRepo: node.name,
				phase: 'tag',
				currentVersion: tagName,
				expectedTag: tagName,
				tagState: state,
			},
		});
	}
	if (state.remoteCommit && state.remoteCommit !== head) {
		throw new RepositorySaveError(`Remote tag ${tagName} for ${node.name} points to ${state.remoteCommit.slice(0, 12)}, but ${node.name} HEAD is ${head.slice(0, 12)}. Refusing to move an existing tag.`, {
			details: {
				failingRepo: node.name,
				phase: 'tag',
				currentVersion: tagName,
				expectedTag: tagName,
				tagState: state,
			},
		});
	}
}

export function createPackageTagMessage(node: RepositorySaveNode, tagName: string, branch: string, workflowRunId?: string | null) {
	void branch;
	void workflowRunId;
	return `release: ${tagName}`;
}

export function ensureRemoteAccessBeforeVerification(node: RepositorySaveNode, options: RepositorySaveOptions, state: SaveState) {
	if (shouldSkipRemoteAccessPreflight()) return;
	if (state.remoteAccessChecked.has(node.path)) return;
	ensureWritableRemote(node, options);
	const writeUrl = remoteWriteUrl(node.path) ?? 'origin';
	emitProgress(options, node, 'preflight', `Checking write remote access before verification (${writeUrl}).`);
	try {
		runQuietCommand(node, 'preflight', 'git', ['ls-remote', '--heads', writeUrl], { timeoutMs: 30_000 });
		state.remoteAccessChecked.add(node.path);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new RepositorySaveError([
			`Cannot access origin remote for ${node.name}; save would fail after verification when pushing branch or tags.`,
			'Fix Git authentication, then rerun `npx trsd save` to resume.',
			detail,
		].join('\n'), {
			exitCode: 13,
			details: {
				failingRepo: node.name,
				phase: 'preflight',
				originalError: detail,
			},
		});
	}
}

export function shouldSkipRemoteAccessPreflight() {
	return process.env.TREESEED_SAVE_REMOTE_PREFLIGHT === 'skip';
}

export function ensurePackageTagReady(node: RepositorySaveNode, options: RepositorySaveOptions, tagName: string, branch: string, workflowRunId?: string | null) {
	let message: string | null = null;
	ensureWritableRemote(node, options);
	const head = headCommit(node.path);
	let state = tagState(node.path, tagName);
	assertTagStateMatchesHead(node, tagName, state, head);

	if (!state.localExists && state.remoteExists && state.remoteCommit === head) {
		runCapturedCommand(node, options, 'tag', 'git', ['fetch', 'origin', `refs/tags/${tagName}:refs/tags/${tagName}`]);
		state = tagState(node.path, tagName);
		assertTagStateMatchesHead(node, tagName, state, head);
	}

	if (!state.localExists) {
		message = createPackageTagMessage(node, tagName, branch, workflowRunId);
		runCapturedCommand(node, options, 'tag', 'git', ['tag', '-a', tagName, '-m', message]);
		state = tagState(node.path, tagName);
		assertTagStateMatchesHead(node, tagName, state, head);
	}

	if (state.remoteExists) {
		emitProgress(options, node, 'tag', `Remote tag ${tagName} already points at HEAD.`);
	}
	return message;
}

export function treeCommitForPath(repoDir: string, ref: string, path: string) {
	try {
		const output = runGit(['ls-tree', ref, '--', path], { cwd: repoDir, capture: true }).trim();
		const match = output.match(/^\d+\s+commit\s+([0-9a-f]{40})\t/u);
		return match?.[1] ?? null;
	} catch {
		return null;
	}
}

export function collectSubmodulePointerChanges(node: RepositorySaveNode, finalizedCommits: Map<string, string>): CommitMessageSubmodulePointer[] {
	const changes: CommitMessageSubmodulePointer[] = [];
	for (const [repoName, finalizedCommit] of finalizedCommits.entries()) {
		const childRelativePath = node.id === '.'
			? repoName
			: repoName.startsWith(`${node.id}/`)
				? repoName.slice(node.id.length + 1)
				: null;
		if (!childRelativePath) continue;
		const childPath = resolve(node.path, childRelativePath);
		if (!existsSync(childPath) || !isGitRepo(childPath)) continue;
		const status = runGit(['status', '--porcelain', '--', childRelativePath], { cwd: node.path, capture: true });
		const oldSha = treeCommitForPath(node.path, 'HEAD', childRelativePath);
		const newSha = finalizedCommit || headCommit(childPath);
		if (status.trim().length > 0 || (oldSha && newSha && oldSha !== newSha)) {
			changes.push({
				path: childRelativePath,
				oldSha,
				newSha,
			});
		}
	}
	return changes;
}

export function commitContextDependencyUpdates(updates: RewrittenDevReference[]): CommitMessageDependencyUpdate[] {
	return updates.map((update) => ({
		packageName: update.packageName,
		field: update.field,
		from: update.from,
		to: update.to,
		tagName: update.tagName,
	}));
}

export function commitContextPackageChanges(
	node: RepositorySaveNode,
	state: SaveState,
	submodulePointers: CommitMessageSubmodulePointer[],
): CommitMessagePackageChange[] {
	const pointersByPath = new Map(submodulePointers.map((pointer) => [pointer.path, pointer]));
	const changes: CommitMessagePackageChange[] = [];
	for (const [relativePath, report] of state.reports.entries()) {
		if (relativePath === node.id || relativePath === '.') continue;
		const childRelativePath = node.id === '.'
			? relativePath
			: relativePath.startsWith(`${node.id}/`)
				? relativePath.slice(node.id.length + 1)
				: null;
		if (!childRelativePath) continue;
		const pointer = pointersByPath.get(childRelativePath);
		if (!pointer && !report.committed && !report.tagName && !report.dependencySpec) continue;
		changes.push({
			name: report.name,
			path: childRelativePath,
			oldSha: pointer?.oldSha ?? null,
			newSha: pointer?.newSha ?? report.commitSha,
			tagName: report.tagName,
			version: report.version,
			dependencySpec: report.dependencySpec,
			commitSubject: commitSubject(report.commitMessage),
		});
		if (pointer) {
			pointer.packageName = report.name;
		}
	}
	return changes;
}

export function syncBranchBeforeSave(node: RepositorySaveNode, options: RepositorySaveOptions, branch: string) {
	checkoutOrCreateBranch(node, options, branch);
}

export function refreshRepositoryNodePackageMetadata(node: RepositorySaveNode) {
	const packageJsonPath = resolve(node.path, 'package.json');
	const packageJson = existsSync(packageJsonPath) ? readJson(packageJsonPath) : null;
	node.packageJsonPath = packageJson ? packageJsonPath : null;
	node.packageJson = packageJson;
	node.scripts = packageScripts(packageJson);
	node.remoteUrl = originRemoteUrlSafe(node.path);
	if (node.kind === 'package' && packageJson) {
		node.name = repoDisplayName(node.path, packageJson);
	}
}

export function finalizePackageReference(node: RepositorySaveNode, version: string, options: RepositorySaveOptions) {
	const reference = createPackageDependencyReference({
		packageName: node.name,
		version,
		branchMode: node.branchMode === 'package-release-main' ? 'package-release-main' : 'package-dev-save',
		remoteUrl: node.remoteUrl,
		commitSha: headCommit(node.path),
		devDependencyReferenceMode: options.devDependencyReferenceMode ?? 'git-commit',
		gitDependencyProtocol: options.gitDependencyProtocol ?? 'preserve-origin',
	});
	node.plannedDependencySpec = reference.spec;
	return reference;
}
