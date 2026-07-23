import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { headCommit, PRODUCTION_BRANCH, STAGING_BRANCH, syncBranchWithOrigin } from "../../operations/services/git-workflow.ts";
import { repoRoot } from "../../operations/services/workspace-save.ts";
import { type SaveVerifyMode } from "../../operations/services/repository-save-orchestrator.ts";
import { ensureLocalWorkspaceLinks, inspectWorkspaceDependencyMode, unlinkLocalWorkspaceLinks, type WorkspaceLinksMode } from "../../operations/services/workspace-dependency-mode.ts";
import { run } from "../../operations/services/workspace-tools.ts";
import { classifyTreeseedGitMode, runTreeseedGitText } from "../../operations/services/git-runner.ts";
import { resolveTreeseedWorkflowState } from "../../workflow-state.ts";
import { checkedOutWorkspacePackageRepos } from ".././session.ts";
import { runTreeseedLocalCleanup } from "../../operations/services/local-cleanup.ts";
import type { TreeseedSaveInput, TreeseedTaskBranchMetadata, TreeseedWorkflowContext, TreeseedWorkflowCiMode, TreeseedWorkflowOperationId, TreeseedWorkflowResult, TreeseedReleaseCandidateMode } from "../../workflow.ts";
import { normalizeExecutionMode } from './create-repo-report.ts';

export type WorkflowWrite = NonNullable<TreeseedWorkflowContext['write']>;

export type WorkflowStatePayload = ReturnType<typeof resolveTreeseedWorkflowState>;

export type ReleaseCandidateMode = TreeseedReleaseCandidateMode;

export type TreeseedWorkflowErrorCode =
	| 'validation_failed'
	| 'merge_conflict'
	| 'missing_runtime_auth'
	| 'deployment_timeout'
	| 'confirmation_required'
	| 'unsupported_transport'
	| 'unsupported_state'
	| 'workflow_locked'
	| 'resume_unavailable'
	| 'workflow_contract_missing'
	| 'github_workflow_failed'
	| 'github_auth_unavailable'
	| 'release_gate_failed'
	| 'hosted_reconcile_failed'
	| 'hosted_live_verification_failed';

export class TreeseedWorkflowError extends Error {
	code: TreeseedWorkflowErrorCode;
	operation: TreeseedWorkflowOperationId;
	details?: Record<string, unknown>;
	exitCode?: number;

	constructor(
		operation: TreeseedWorkflowOperationId,
		code: TreeseedWorkflowErrorCode,
		message: string,
		options: { details?: Record<string, unknown>; exitCode?: number } = {},
	) {
		super(message);
		this.name = 'TreeseedWorkflowError';
		this.operation = operation;
		this.code = code;
		this.details = options.details;
		this.exitCode = options.exitCode;
	}
}

export type WorkflowOperationHelpers = {
	context: TreeseedWorkflowContext;
	cwd(): string;
	write: WorkflowWrite;
	runStatus(): Promise<TreeseedWorkflowResult<ReturnType<typeof resolveTreeseedWorkflowState>>>;
	runTasks(): Promise<TreeseedWorkflowResult<{ tasks: TreeseedTaskBranchMetadata[] }>>;
};

export function defaultWrite(output: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!output) return;
	(stream === 'stderr' ? process.stderr : process.stdout).write(`${output}\n`);
}

export function runGit(args: string[], options: { cwd: string; capture?: boolean; timeoutMs?: number; maxBuffer?: number }) {
	return runTreeseedGitText(args, {
		cwd: options.cwd,
		mode: classifyTreeseedGitMode(args),
		timeoutMs: options.timeoutMs,
		maxBuffer: options.maxBuffer,
	});
}

export function shouldManageWorkspaceLinks(mode: WorkspaceLinksMode | undefined, env: NodeJS.ProcessEnv | undefined = process.env) {
	if (mode === 'off') return false;
	const envMode = String(env?.TREESEED_WORKSPACE_LINKS ?? 'auto').trim().toLowerCase();
	return envMode !== 'off' && envMode !== 'false' && envMode !== '0';
}

export function ensureWorkflowWorkspaceLinks(root: string, helpers: WorkflowOperationHelpers, mode: WorkspaceLinksMode | undefined = 'auto') {
	if (!shouldManageWorkspaceLinks(mode, helpers.context.env)) {
		return inspectWorkspaceDependencyMode(root, { mode: 'off', env: helpers.context.env });
	}
	const report = ensureLocalWorkspaceLinks(root, { mode, env: helpers.context.env });
	if (report.created.length > 0) {
		helpers.write(`[workspace][link] Linked ${report.created.length} local workspace package paths.`);
	}
	ensureWorkflowWorkspacePackageArtifacts(root, helpers);
	ensureWorkflowCommandBins(root, helpers);
	return report;
}

export function readPackageScript(root: string, packageDir: string, scriptName: string) {
	try {
		const packageJson = JSON.parse(readFileSync(resolve(root, packageDir, 'package.json'), 'utf8')) as Record<string, unknown>;
		const scripts = packageJson.scripts && typeof packageJson.scripts === 'object' && !Array.isArray(packageJson.scripts)
			? packageJson.scripts as Record<string, unknown>
			: null;
		const script = scripts?.[scriptName];
		return typeof script === 'string' && script.trim() ? script : null;
	} catch {
		return null;
	}
}

export function ensureWorkflowWorkspacePackageArtifacts(root: string, helpers: WorkflowOperationHelpers) {
	const packages = [
		{ name: '@treeseed/sdk', dir: 'packages/sdk', artifacts: ['dist/index.js', 'dist/workflow-support.js', 'dist/plugin-default.js', 'dist/platform/env.yaml'] },
		{ name: '@treeseed/ui', dir: 'packages/ui', artifacts: ['dist/index.js'] },
		{ name: '@treeseed/agent', dir: 'packages/agent', artifacts: ['dist/api/index.js', 'dist/provider/manager.js', 'dist/provider/runner.js'] },
		{ name: '@treeseed/core', dir: 'packages/core', artifacts: ['dist/plugin-default.js'] },
		{ name: '@treeseed/admin', dir: 'packages/admin', artifacts: ['dist/plugin.js'] },
		{ name: '@treeseed/cli', dir: 'packages/cli', artifacts: ['dist/cli/main.js'] },
	];
	for (const entry of packages) {
		const packageDir = resolve(root, entry.dir);
		if (!existsSync(resolve(packageDir, 'package.json'))) continue;
		if (!readPackageScript(root, entry.dir, 'build:dist')) continue;
		const missing = entry.artifacts.filter((artifact) => !existsSync(resolve(packageDir, artifact)));
		if (missing.length === 0) continue;
		helpers.write(`[workspace][build] Building ${entry.name} artifacts for local workspace links.`);
		run('npm', ['--prefix', packageDir, 'run', 'build:dist'], { cwd: root });
	}
}

export function ensureWorkflowCommandBins(root: string, helpers: WorkflowOperationHelpers) {
	const cliBin = resolve(root, 'node_modules/@treeseed/cli/dist/cli/main.js');
	if (!existsSync(cliBin)) return;
	const binDir = resolve(root, 'node_modules/.bin');
	mkdirSync(binDir, { recursive: true });
	for (const name of ['trsd', 'treeseed']) {
		const linkPath = resolve(binDir, name);
		const target = relative(dirname(linkPath), cliBin) || cliBin;
		try {
			const stat = lstatSync(linkPath);
			if (stat.isSymbolicLink()) {
				const currentTarget = readlinkSync(linkPath);
				if (currentTarget === target || resolve(dirname(linkPath), currentTarget) === cliBin) {
					continue;
				}
				rmSync(linkPath, { force: true });
			} else {
				continue;
			}
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				throw error;
			}
		}
		symlinkSync(target, linkPath);
		helpers.write(`[workspace][link] Linked ${name} command shim.`);
	}
}

export function unresolvedMergePaths(repoDir: string) {
	return runGit(['diff', '--name-only', '--diff-filter=U'], { cwd: repoDir, capture: true })
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function resolveRootReleaseSubmoduleConflicts(root: string, selectedPackageNames: Set<string>) {
	const gitRoot = repoRoot(root);
	const packages = checkedOutWorkspacePackageRepos(root)
		.filter((pkg) => selectedPackageNames.has(pkg.name))
		.map((pkg) => ({
			...pkg, 			repoPath: relative(gitRoot, pkg.dir),
		}));
	const packagePaths = new Set(packages.map((pkg) => pkg.repoPath));
	const unresolved = unresolvedMergePaths(gitRoot);
	if (unresolved.length === 0 || unresolved.some((filePath) => !packagePaths.has(filePath))) {
		return {
			resolved: false, 			allUnresolvedPathsWerePackagePointers: unresolved.length > 0 && unresolved.every((filePath) => packagePaths.has(filePath)), 			unresolvedPaths: unresolved,
			entries: [],
		};
	}
	const entries: Array<Record<string, unknown>> = [];
	for (const pkg of packages) {
		syncBranchWithOrigin(pkg.dir, PRODUCTION_BRANCH);
		runGit(['add', pkg.repoPath], { cwd: gitRoot });
		entries.push({
			packageName: pkg.name, 			path: pkg.repoPath, 			targetBranch: PRODUCTION_BRANCH, 			resolvedCommit: headCommit(pkg.dir),
		});
	}
	return {
		resolved: true,
		allUnresolvedPathsWerePackagePointers: true,
		unresolvedPaths: unresolved,
		entries,
	};
}

export function unlinkWorkflowWorkspaceLinks(root: string, helpers: WorkflowOperationHelpers, mode: WorkspaceLinksMode | undefined = 'auto') {
	if (!shouldManageWorkspaceLinks(mode, helpers.context.env)) {
		return inspectWorkspaceDependencyMode(root, { mode: 'off', env: helpers.context.env });
	}
	const report = unlinkLocalWorkspaceLinks(root, { mode, env: helpers.context.env, preserveOperatorLinks: true });
	if (report.removed.length > 0) {
		helpers.write(`[workspace][unlink] Removed ${report.removed.length} local workspace package links for deployment install.`);
	}
	if (report.preserved.length > 0) {
		helpers.write(`[workspace][unlink] Preserved ${report.preserved.length} operator workspace links so local trsd tooling remains available.`);
	}
	return report;
}

export function normalizeCiMode(mode: TreeseedWorkflowCiMode | undefined, operation: 'save' | 'release') {
	if (mode === 'hosted' || mode === 'off') return mode;
	return operation === 'save' ? 'off' : 'hosted';
}

export function normalizeSaveLane(lane: TreeseedSaveInput['lane'] | undefined) {
	const value = lane ?? process.env.TREESEED_SAVE_LANE;
	return value === 'promotion' ? 'promotion' : 'fast';
}

export function normalizeSceneArtifactsMode(value: unknown): 'full' | 'screenshots' {
	return value === 'screenshots' ? 'screenshots' : 'full';
}

export function maybeRunLocalWorkflowCleanup(
	helpers: WorkflowOperationHelpers,
	root: string,
	operation: 'save' | 'stage' | 'release',
	input: { skipCleanup?: boolean; sceneArtifacts?: 'full' | 'screenshots'; plan?: boolean },
) {
	if (operation !== 'release') return null;
	if (normalizeExecutionMode(input) === 'plan' || input.skipCleanup === true) return null;
	helpers.write('Treeseed release cleanup: pruning disposable local build state while preserving package caches and release evidence.', 'stderr');
	return runTreeseedLocalCleanup({ root, mode: 'standard', docker: false, npmCache: false });
}

export function normalizeSaveCiMode(mode: TreeseedWorkflowCiMode | undefined, branch: string | null | undefined, lane: 'fast' | 'promotion' = 'fast') {
	if (mode === 'hosted' || mode === 'off') return mode;
	if (lane === 'promotion') return branch === STAGING_BRANCH || branch === PRODUCTION_BRANCH ? 'hosted' : 'off';
	return 'off';
}

export function normalizeSaveVerifyMode(mode: TreeseedSaveInput['verifyMode'] | undefined): SaveVerifyMode {
	switch (mode) {
		case 'skip':
		case 'fast':
		case undefined:
			return 'skip';
		case 'local':
		case 'local-only':
			return 'local-only';
		case 'hosted':
			return 'skip';
		case 'both':
		case 'action-first':
			return 'action-first';
		default:
			return 'skip';
	}
}
