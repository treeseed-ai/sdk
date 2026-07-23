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
import { RepoBranchMode, RepositorySaveNode, RepositorySaveOptions, RepositorySaveReport, SaveState, emitProgress, readJson } from './repo-kind.ts';
import { packageVersionEligibleForBranch, remoteBranchCommitSafe } from './classify-repo-kind.ts';
import { assertTagStateMatchesHead, ensurePackageTagReady, ensureRemoteAccessBeforeVerification, finalizePackageReference, tagState } from './tag-state.ts';
import { checkoutCommandFor, remoteBranchExistsSafe } from './discover-repository-save-nodes.ts';
import { hasNpmLockfile } from './has-staged-changes.ts';
import { hasScript, manifestVerifyCommand, runNpmInstallWithRetry, validateRepositoryLockfile } from './sync-root-workspace-lockfile-metadata.ts';
import { finishRepositorySavePublish, pullRebaseFromOrigin, runRepoVerification } from './run-script.ts';

export async function finalizeCleanPackageVersion(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	state: SaveState,
	report: RepositorySaveReport,
	branch: string,
) {
	const version = typeof node.packageJson?.version === 'string' ? node.packageJson.version : null;
	if (!version || !packageVersionEligibleForBranch(node, version, options)) {
		return false;
	}

	const head = headCommit(node.path);
	const reference = finalizePackageReference(node, version, options);
	const currentTagState = reference.tagName ? tagState(node.path, reference.tagName) : null;
	if (reference.tagName && currentTagState) {
		assertTagStateMatchesHead(node, reference.tagName, currentTagState, head);
	}
	const remoteBranchExists = remoteBranchExistsSafe(node.path, branch);
	const remoteBranchCommit = remoteBranchCommitSafe(node.path, branch);
	const finalizedRemotely = remoteBranchExists
		&& remoteBranchCommit === head
		&& (!reference.tagName || (currentTagState?.localCommit === head && currentTagState?.remoteCommit === head));

	report.version = version;
	report.tagName = reference.tagName;
	report.commitSha = head;
	report.dependencySpec = reference.spec;
	state.finalizedVersions.set(node.name, version);
	state.finalizedReferences.set(node.name, reference);
	state.finalizedCommits.set(node.relativePath, head);

	if (finalizedRemotely) {
		report.pushed = true;
		report.skippedReason = 'already-finalized';
		report.publishWait = { recoveredPartialSave: true, remoteBranchExisted: true, tagAlreadyPushed: Boolean(reference.tagName) };
		emitProgress(options, node, 'finalize', `Using existing finalized package version ${version}.`);
		return true;
	}

	emitProgress(options, node, 'finalize', `Finalizing interrupted package version ${version}.`);
	if (hasNpmLockfile(node.path)) {
		report.install = await runNpmInstallWithRetry(node, options);
		report.lockfileValidation = await validateRepositoryLockfile(node, options);
	}
	const rebase = pullRebaseFromOrigin(node, options, branch);
	ensureRemoteAccessBeforeVerification(node, options, state);
	report.verification = await runRepoVerification(node, options, options.verifyMode ?? 'action-first');
	report.verified = report.verification.status === 'passed';
	const tagMessage = reference.tagName ? ensurePackageTagReady(node, options, reference.tagName, branch, options.workflowRunId) : null;
	void tagMessage;
	report.dependencySpec = reference.spec;
	report.skippedReason = 'finalized-partial-save';
	report.commitSha = headCommit(node.path);
	state.finalizedCommits.set(node.relativePath, report.commitSha);
	await finishRepositorySavePublish(node, options, state, report, {
		branch,
		rebase: {
			...rebase,
			recoveredPartialSave: true,
		},
		reference,
		tagName: reference.tagName,
	});
	return true;
}

export function branchModeLabel(branchMode: RepoBranchMode) {
	switch (branchMode) {
		case 'package-release-main':
			return 'stable package release';
		case 'package-dev-save':
			return 'dev package save';
		case 'project-save':
			return 'project save';
	}
}

export function repoPlanCommands(
	node: RepositorySaveNode,
	options: RepositorySaveOptions,
	plannedVersion: string | null,
	plannedDependencySpec: string | null,
	dependencyUpdates: string[],
) {
	const branch = node.branch || options.branch;
	const remoteExists = remoteBranchExistsSafe(node.path, branch);
	const commands = [
		checkoutCommandFor(node.path, branch),
	];
	const sshPushUrl = (options.gitRemoteWriteMode ?? 'ssh-pushurl') === 'off'
		? null
		: sshPushUrlForRemote(node.remoteUrl);
	if (sshPushUrl) {
		commands.push(`git remote set-url --push origin ${sshPushUrl} # keep ${node.remoteUrl} for reads`);
	}
	if (dependencyUpdates.length > 0) {
		commands.push(`update package.json internal dependencies: ${dependencyUpdates.join(', ')}`);
	}
	if (node.submoduleDependencies.length > 0) {
		commands.push(`refresh submodule pointers: ${node.submoduleDependencies.join(', ')}`);
	}
	const packageJson = node.packageJson ?? (existsSync(resolve(node.path, 'package.json')) ? readJson(resolve(node.path, 'package.json')) : null);
	const rootWorkspaceInstall = node.path === options.root && Array.isArray(packageJson?.workspaces);
	if (node.kind === 'package' && plannedVersion) {
		commands.push(`update package.json version to ${plannedVersion}`);
		commands.push('npm install --workspaces=false # explicitly refresh changed git commit dependencies with --force; retry up to 5 times with 60s delay');
	} else if (node.kind === 'project' && (dependencyUpdates.length > 0 || (rootWorkspaceInstall && node.submoduleDependencies.length > 0)) && hasNpmLockfile(node.path)) {
		commands.push(rootWorkspaceInstall
			? 'npm install --package-lock-only --ignore-scripts # refresh root workspace lockfile without installing git dependencies'
			: 'npm install --workspaces=false # refresh project lockfile after internal dependency updates');
	}
	if (hasNpmLockfile(node.path) && (node.kind === 'project' || plannedVersion || dependencyUpdates.length > 0 || node.submoduleDependencies.length > 0)) {
		commands.push(rootWorkspaceInstall
			? 'npm ci --ignore-scripts --plan # validate root manifest, workspaces, and lockfile before commit'
			: 'npm ci --ignore-scripts --plan --workspaces=false # validate deployment lockfile before commit');
	}
	commands.push('git add -A');
	commands.push('generate commit message # Cloudflare AI when configured, fallback otherwise');
	commands.push('git commit -m <generated-message>');
	commands.push(
		remoteExists
			? `git pull --rebase --recurse-submodules=no origin ${branch}`
			: `skip pull --rebase # origin/${branch} does not exist yet`,
	);
	const verifyMode = options.verifyMode ?? 'action-first';
	if (verifyMode === 'skip') {
		commands.push(node.kind === 'package' ? 'skip package verification' : 'skip project verification');
	} else if (hasScript(node, 'verify:action') || hasScript(node, 'verify:local') || hasScript(node, 'verify')) {
		if (verifyMode === 'local-only') {
			commands.push('npm run verify:local');
		} else if (hasScript(node, 'verify:action')) {
			commands.push('npm run verify:action # fallback to npm run verify:local on failure');
		} else if (hasScript(node, 'verify:local')) {
			commands.push('npm run verify:local');
		} else {
			commands.push('npm run verify');
		}
	} else if (manifestVerifyCommand(node, 'local') || manifestVerifyCommand(node, 'fast')) {
		const command = verifyMode === 'local-only'
			? manifestVerifyCommand(node, 'local') ?? manifestVerifyCommand(node, 'fast')
			: manifestVerifyCommand(node, 'local') ?? manifestVerifyCommand(node, 'fast');
		if (command) commands.push(`${command.command} ${command.args.join(' ')} # treeseed.package.yaml verification`);
	} else if (node.kind !== 'package') {
		commands.push('skip verification # project repository has no Treeseed verify script');
	}
	if (node.kind === 'package') {
		const plansTag = plannedVersion && node.branchMode === 'package-release-main';
		if (plannedVersion && plansTag) {
			commands.push(`git tag -a ${plannedVersion} -m <release>`);
			commands.push(remoteExists ? `git push origin ${branch} ${plannedVersion}` : `git push -u origin ${branch} ${plannedVersion}`);
		} else if (plannedVersion) {
			commands.push(remoteExists ? `git push origin ${branch}` : `git push -u origin ${branch}`);
			if (plannedDependencySpec && node.branchMode === 'package-dev-save') {
				commands.push(`npm install ${node.name}@${plannedDependencySpec} --package-lock-only --ignore-scripts --force # validate dependency commit reachability`);
			}
		} else {
			commands.push(remoteExists ? `git push origin ${branch}` : `git push -u origin ${branch}`);
		}
	} else {
		commands.push(remoteExists ? `git push origin ${branch}` : `git push -u origin ${branch}`);
	}
	return commands;
}
