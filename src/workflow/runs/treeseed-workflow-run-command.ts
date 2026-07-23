import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { TreeseedWorkflowMode } from '../session.ts';
import { readWorkflowRunJournal, releaseWorkflowLock } from './ensure-workflow-exclude-rule.ts';
import { updateWorkflowRunJournal } from './update-workflow-run-journal.ts';

export type TreeseedWorkflowRunCommand =
	| 'switch'
	| 'save'
	| 'update'
	| 'close'
	| 'stage'
	| 'release'
	| 'destroy';

export type TreeseedWorkflowExecutionMode = 'execute' | 'plan';

export type TreeseedWorkflowLockScope = 'worktree' | 'shared';

export type TreeseedWorkflowRunStatus = 'running' | 'failed' | 'completed';

export type TreeseedWorkflowRunClassificationState = 'resumable' | 'stale' | 'obsolete';

export type TreeseedWorkflowRunClassification = {
	state: TreeseedWorkflowRunClassificationState;
	reasons: string[];
	classifiedAt: string;
	archivedAt?: string | null;
};

export type TreeseedWorkflowGateCacheEntry = {
	repo: string | null;
	workflow: string;
	headSha: string;
	branch: string | null;
	status: string;
	conclusion: string | null;
	runId: string | number | null;
	url: string | null;
	cachedAt: string;
	result: Record<string, unknown>;
};

export type TreeseedWorkflowRunStep = {
	id: string;
	description: string;
	repoName: string | null;
	repoPath: string | null;
	branch: string | null;
	resumable: boolean;
	status: 'pending' | 'completed' | 'skipped';
	startedAt?: string | null;
	completedAt: string | null;
	elapsedMs?: number | null;
	retryCount?: number;
	lastFailure?: string | null;
	data: Record<string, unknown> | null;
};

export type TreeseedWorkflowRunJournal = {
	schemaVersion: 1;
	kind: 'treeseed.workflow.run';
	runId: string;
	command: TreeseedWorkflowRunCommand;
	executionMode: TreeseedWorkflowExecutionMode;
	status: TreeseedWorkflowRunStatus;
	createdAt: string;
	updatedAt: string;
	resumable: boolean;
	input: Record<string, unknown>;
	session: {
		root: string;
		mode: TreeseedWorkflowMode;
		branchName: string | null;
		repos: Array<{
			name: string;
			path: string;
			branchName: string | null;
		}>;
	};
	steps: TreeseedWorkflowRunStep[];
	failure: null | {
		code: string;
		message: string;
		details: Record<string, unknown> | null;
		at: string;
	};
	result: Record<string, unknown> | null;
	classification?: TreeseedWorkflowRunClassification | null;
	gateCache?: TreeseedWorkflowGateCacheEntry[];
};

export type TreeseedWorkflowLockRecord = {
	schemaVersion: 1;
	kind: 'treeseed.workflow.lock';
	scope?: TreeseedWorkflowLockScope;
	runId: string;
	command: TreeseedWorkflowRunCommand;
	root: string;
	host: string;
	pid: number | null;
	createdAt: string;
	updatedAt: string;
	stale: boolean;
	staleReason: string | null;
};

export type TreeseedWorkflowLockInspection = {
	lock: TreeseedWorkflowLockRecord | null;
	active: boolean;
	stale: boolean;
	staleReason: string | null;
};

export const WORKFLOW_CONTROL_DIR = '.treeseed/workflow';

export const WORKFLOW_RUNS_DIR = `${WORKFLOW_CONTROL_DIR}/runs`;

export const WORKTREE_METADATA_PATH = '.treeseed/worktree.json';

export const LOCK_STALE_AFTER_MS = 4 * 60 * 60 * 1000;

export const WORKFLOW_RUN_STORAGE_ROOTS = new Map<string, string>();

export const SHARED_LOCK_COMMANDS = new Set<TreeseedWorkflowRunCommand>(['stage', 'release']);

export const ACTIVE_WORKFLOW_RUNS = new Map<string, string>();

export let SIGNAL_HANDLERS_INSTALLED = false;

export function nowIso() {
	return new Date().toISOString();
}

export function markActiveWorkflowRunsInterrupted(signal: NodeJS.Signals | string) {
	const interrupted: string[] = [];
	for (const [runId, root] of ACTIVE_WORKFLOW_RUNS) {
		const journal = readWorkflowRunJournal(root, runId);
		if (journal?.status === 'running') {
			updateWorkflowRunJournal(root, runId, (current) => ({
				...current,
				status: 'failed',
				failure: {
					code: 'interrupted',
					message: `Treeseed workflow was interrupted by ${signal}.`,
					details: {
						resumable: true,
						recoverCommand: 'treeseed recover',
						resumeCommand: `treeseed resume ${runId}`,
					},
					at: nowIso(),
				},
			}));
		}
		releaseWorkflowLock(root, runId);
		interrupted.push(runId);
	}
	ACTIVE_WORKFLOW_RUNS.clear();
	return interrupted;
}

export function installWorkflowSignalHandlers() {
	if (SIGNAL_HANDLERS_INSTALLED) return;
	SIGNAL_HANDLERS_INSTALLED = true;
	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.once(signal, () => {
			markActiveWorkflowRunsInterrupted(signal);
			process.kill(process.pid, signal);
		});
	}
}

export function managedWorktreePrimaryRoot(root: string) {
	const metadataPath = resolve(root, WORKTREE_METADATA_PATH);
	if (!existsSync(metadataPath)) return null;
	try {
		const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as Record<string, unknown>;
		return metadata.kind === 'treeseed.workflow.worktree' && typeof metadata.primaryRoot === 'string'
			? metadata.primaryRoot
			: null;
	} catch {
		return null;
	}
}

export function workflowLockScopeForCommand(command: TreeseedWorkflowRunCommand): TreeseedWorkflowLockScope {
	return SHARED_LOCK_COMMANDS.has(command) ? 'shared' : 'worktree';
}

export function isSharedWorkflowCommand(command?: string | null): command is TreeseedWorkflowRunCommand {
	return command === 'stage' || command === 'release';
}

export function workflowCommandFromRunId(runId?: string | null): TreeseedWorkflowRunCommand | null {
	if (!runId) return null;
	const prefix = runId.split('-', 1)[0];
	return ['switch', 'save', 'update', 'close', 'stage', 'release', 'destroy'].includes(prefix)
		? prefix as TreeseedWorkflowRunCommand
		: null;
}

export function workflowStorageRootForScope(root: string, scope: TreeseedWorkflowLockScope) {
	return scope === 'shared' ? managedWorktreePrimaryRoot(root) ?? root : root;
}

export function workflowStorageRoot(root: string, runId?: string | null, scope?: TreeseedWorkflowLockScope) {
	const storageKey = runId ? `${resolve(root)}\0${runId}` : null;
	if (storageKey && WORKFLOW_RUN_STORAGE_ROOTS.has(storageKey)) {
		return WORKFLOW_RUN_STORAGE_ROOTS.get(storageKey) as string;
	}
	const command = workflowCommandFromRunId(runId);
	const resolvedScope = scope ?? (command ? workflowLockScopeForCommand(command) : 'worktree');
	const storageRoot = workflowStorageRootForScope(root, resolvedScope);
	if (storageKey) {
		WORKFLOW_RUN_STORAGE_ROOTS.set(storageKey, storageRoot);
	}
	return storageRoot;
}

export function workflowControlRoot(root: string, runId?: string | null, scope?: TreeseedWorkflowLockScope) {
	return resolve(workflowStorageRoot(root, runId, scope), WORKFLOW_CONTROL_DIR);
}

export function workflowRunsRoot(root: string, runId?: string | null, scope?: TreeseedWorkflowLockScope) {
	return resolve(workflowStorageRoot(root, runId, scope), WORKFLOW_RUNS_DIR);
}

export function workflowLockPath(root: string, runId?: string | null, scope?: TreeseedWorkflowLockScope) {
	return resolve(workflowStorageRoot(root, runId, scope), WORKFLOW_CONTROL_DIR, 'lock.json');
}

export function workflowRunPath(root: string, runId: string) {
	return resolve(workflowStorageRoot(root, runId), WORKFLOW_RUNS_DIR, `${runId}.json`);
}

export function resolveGitDir(root: string) {
	const gitPath = resolve(root, '.git');
	if (existsSync(resolve(gitPath, 'info'))) {
		return gitPath;
	}
	if (!existsSync(gitPath)) {
		return null;
	}
	try {
		const gitFile = readFileSync(gitPath, 'utf8').trim();
		const match = gitFile.match(/^gitdir:\s*(.+)$/u);
		return match ? resolve(root, match[1]) : null;
	} catch {
		return null;
	}
}
