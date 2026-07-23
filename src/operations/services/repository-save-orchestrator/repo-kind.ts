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


export type RepoKind = 'package' | 'project' | 'template' | 'fixture';

export type RepoBranchMode = 'package-release-main' | 'package-dev-save' | 'project-save';

export type SaveVerifyMode = 'action-first' | 'local-only' | 'skip';

export function runGit(args: string[], options: { cwd: string; capture?: boolean; timeoutMs?: number; maxBuffer?: number }) {
	return runTreeseedGitText(args, {
		cwd: options.cwd,
		mode: classifyTreeseedGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

export function sleepMs(durationMs: number) {
	return new Promise((resolvePromise) => {
		setTimeout(resolvePromise, durationMs);
	});
}

export type SaveCommitMessageMode = CommitMessageProviderMode;

export type SaveDevVersionStrategy = 'prerelease';

export type ReleaseBumpLevel = 'major' | 'minor' | 'patch';

export type RepositorySaveNode = {
	id: string;
	name: string;
	path: string;
	relativePath: string;
	kind: RepoKind;
	branch: string | null;
	branchMode: RepoBranchMode;
	packageJsonPath: string | null;
	packageJson: Record<string, unknown> | null;
	scripts: Record<string, string>;
	manifestVerifyCommands: Record<'fast' | 'local' | 'release', TreeseedPackageCommand | null>;
	remoteUrl: string | null;
	dependencies: string[];
	dependents: string[];
	submoduleDependencies: string[];
	plannedVersion: string | null;
	plannedTag: string | null;
	plannedDependencySpec: string | null;
};

export type RepositorySaveReport = {
	name: string;
	path: string;
	branch: string | null;
	dirty: boolean;
	created: boolean;
	resumed: boolean;
	merged: boolean;
	verified: boolean;
	committed: boolean;
	pushed: boolean;
	deletedLocal: boolean;
	deletedRemote: boolean;
	tagName: string | null;
	commitSha: string | null;
	skippedReason: string | null;
	publishWait: Record<string, unknown> | null;
	version: string | null;
	dependencySpec: string | null;
	branchMode: RepoBranchMode;
	verification: RepositoryVerificationResult | null;
	install: RepositoryInstallResult | null;
	lockfileValidation: RepositoryLockfileValidationResult | null;
	commitMessage: string | null;
	commitMessageProvider: 'cloudflare-workers-ai' | 'fallback' | null;
	commitMessageFallbackUsed: boolean;
	commitMessageError: string | null;
};

export type RepositoryVerificationResult = {
	mode: SaveVerifyMode;
	status: 'passed' | 'failed' | 'skipped';
	primary: 'verify:action' | 'verify:local' | 'manifest:fast' | 'manifest:local' | 'manifest:release' | null;
	fallbackUsed: boolean;
	error: string | null;
};

export type RepositoryInstallResult = {
	status: 'completed' | 'skipped';
	attempts: number;
	reason: string | null;
};

export type RepositoryLockfileValidationResult = {
	status: 'passed' | 'failed' | 'skipped';
	command: string | null;
	issues: string[];
	error: string | null;
};

export type RepositoryCommitMessageContext = CommitMessageContext;

export type RepositoryCommitMessageProvider = CommitMessageProvider;

export type RepositorySaveResult = {
	mode: 'root-only' | 'recursive-workspace';
	branch: string;
	scope: 'local' | 'staging' | 'prod';
	repos: RepositorySaveReport[];
	rootRepo: RepositorySaveReport;
	waves: string[][];
	plannedVersions: Record<string, string>;
	workflowGates?: Array<Record<string, unknown>>;
};

export type RepositorySavePlanRepo = {
	id: string;
	name: string;
	path: string;
	relativePath: string;
	kind: RepoKind;
	currentBranch: string | null;
	targetBranch: string;
	branchMode: RepoBranchMode;
	dirty: boolean;
	dependencies: string[];
	dependents: string[];
	submoduleDependencies: string[];
	currentVersion: string | null;
	plannedVersion: string | null;
	plannedTag: string | null;
	plannedDependencySpec: string | null;
	remoteUrl: string | null;
	commands: string[];
	notes: string[];
};

export type RepositorySavePlanWave = {
	index: number;
	parallel: boolean;
	repos: string[];
	commands: Array<{
		repo: string;
		commands: string[];
	}>;
};

export type RepositorySavePlan = {
	mode: 'root-only' | 'recursive-workspace';
	branch: string;
	scope: 'local' | 'staging' | 'prod';
	devDependencyReferenceMode: DevDependencyReferenceMode;
	gitDependencyProtocol: GitDependencyProtocol;
	verifyMode: SaveVerifyMode;
	commitMessageMode: SaveCommitMessageMode;
	repos: RepositorySavePlanRepo[];
	rootRepo: RepositorySavePlanRepo;
	waves: RepositorySavePlanWave[];
	plannedVersions: Record<string, string>;
	plannedSteps: Array<{ id: string; description: string }>;
};

export type RepositorySaveOptions = {
	root: string;
	gitRoot: string;
	branch: string;
	message?: string;
	bump?: ReleaseBumpLevel;
	devVersionStrategy?: SaveDevVersionStrategy;
	devDependencyReferenceMode?: DevDependencyReferenceMode;
	gitDependencyProtocol?: GitDependencyProtocol;
	gitRemoteWriteMode?: GitRemoteWriteMode;
	verifyMode?: SaveVerifyMode;
	commitMessageMode?: SaveCommitMessageMode;
	commitMessageProvider?: RepositoryCommitMessageProvider;
	workflowRunId?: string | null;
	includeRoot?: boolean;
	deferPushUntilVerified?: boolean;
	stablePackageRelease?: boolean;
	onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
	onWaveSaved?: (wave: {
		index: number;
		nodes: RepositorySaveNode[];
		reports: RepositorySaveReport[];
		allReports: RepositorySaveReport[];
		rootRepo: RepositorySaveReport | null;
	}) => Promise<Array<Record<string, unknown>> | void> | Array<Record<string, unknown>> | void;
};

export type SaveState = {
	finalizedVersions: Map<string, string>;
	finalizedReferences: Map<string, PackageDependencyReference>;
	finalizedCommits: Map<string, string>;
	reports: Map<string, RepositorySaveReport>;
	remoteAccessChecked: Set<string>;
	workflowGates: Array<Record<string, unknown>>;
	deferredPushes: DeferredRepositoryPush[];
};

export type DeferredRepositoryPush = {
	node: RepositorySaveNode;
	report: RepositorySaveReport;
	branch: string;
	tagName: string | null;
	rebase: Record<string, unknown>;
	reference: PackageDependencyReference | null;
};

export class RepositorySaveError extends Error {
	exitCode?: number;
	details?: Record<string, unknown>;

	constructor(message: string, options: { exitCode?: number; details?: Record<string, unknown> } = {}) {
		super(message);
		this.name = 'RepositorySaveError';
		this.exitCode = options.exitCode;
		this.details = options.details;
	}
}

export function readJson(filePath: string) {
	return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

export function writeJson(filePath: string, value: Record<string, unknown>) {
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function progressPrefix(node: Pick<RepositorySaveNode, 'name'>, phase: string) {
	return `[${node.name}][${phase}]`;
}

export function emitProgress(options: Pick<RepositorySaveOptions, 'onProgress'>, node: Pick<RepositorySaveNode, 'name'>, phase: string, message: string, stream: 'stdout' | 'stderr' = 'stdout') {
	const lines = String(message ?? '').split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
	for (const line of lines) {
		options.onProgress?.(`${progressPrefix(node, phase)} ${line}`, stream);
	}
}

export function prefixedOutput(node: Pick<RepositorySaveNode, 'name'>, phase: string, output: string) {
	return String(output ?? '')
		.split(/\r?\n/u)
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => `${progressPrefix(node, phase)} ${line}`)
		.join('\n');
}
