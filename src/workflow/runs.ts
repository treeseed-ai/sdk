import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import type { TreeseedWorkflowMode } from './session.ts';

export type TreeseedWorkflowRunCommand =
	| 'switch'
	| 'save'
	| 'close'
	| 'stage'
	| 'release'
	| 'destroy';

export type TreeseedWorkflowExecutionMode = 'execute' | 'plan';

export type TreeseedWorkflowRunStatus = 'running' | 'failed' | 'completed';

export type TreeseedWorkflowRunStep = {
	id: string;
	description: string;
	repoName: string | null;
	repoPath: string | null;
	branch: string | null;
	resumable: boolean;
	status: 'pending' | 'completed' | 'skipped';
	completedAt: string | null;
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
};

export type TreeseedWorkflowLockRecord = {
	schemaVersion: 1;
	kind: 'treeseed.workflow.lock';
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

const WORKFLOW_CONTROL_DIR = '.treeseed/workflow';
const WORKFLOW_RUNS_DIR = `${WORKFLOW_CONTROL_DIR}/runs`;
const LOCK_STALE_AFTER_MS = 4 * 60 * 60 * 1000;

function nowIso() {
	return new Date().toISOString();
}

function workflowControlRoot(root: string) {
	return resolve(root, WORKFLOW_CONTROL_DIR);
}

function workflowRunsRoot(root: string) {
	return resolve(root, WORKFLOW_RUNS_DIR);
}

function workflowLockPath(root: string) {
	return resolve(root, WORKFLOW_CONTROL_DIR, 'lock.json');
}

function workflowRunPath(root: string, runId: string) {
	return resolve(root, WORKFLOW_RUNS_DIR, `${runId}.json`);
}

function resolveGitDir(root: string) {
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

function ensureWorkflowExcludeRule(root: string) {
	const gitDir = resolveGitDir(root);
	if (!gitDir) {
		return;
	}
	const excludePath = resolve(gitDir, 'info', 'exclude');
	const pattern = '/.treeseed/workflow/';
	const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
	if (current.includes(pattern)) {
		return;
	}
	writeFileSync(excludePath, `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${pattern}\n`, 'utf8');
}

function ensureWorkflowControlDirs(root: string) {
	const controlDir = workflowControlRoot(root);
	const runsDir = workflowRunsRoot(root);
	mkdirSync(runsDir, { recursive: true });
	ensureWorkflowExcludeRule(root);
	writeFileSync(resolve(controlDir, '.gitignore'), '*\n!.gitignore\n!runs/\nruns/*\n!runs/.gitignore\n', 'utf8');
	writeFileSync(resolve(runsDir, '.gitignore'), '*\n!.gitignore\n', 'utf8');
	return {
		controlDir,
		runsDir,
		lockPath: workflowLockPath(root),
	};
}

function safeJsonParse<T>(filePath: string): T | null {
	if (!existsSync(filePath)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as T;
	} catch {
		return null;
	}
}

function pidIsAlive(pid: number | null) {
	if (!Number.isInteger(pid) || (pid ?? 0) <= 0) {
		return false;
	}
	try {
		process.kill(pid as number, 0);
		return true;
	} catch {
		return false;
	}
}

export function generateWorkflowRunId(command: TreeseedWorkflowRunCommand) {
	return `${command}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function inspectWorkflowLock(root: string): TreeseedWorkflowLockInspection {
	const lock = safeJsonParse<TreeseedWorkflowLockRecord>(workflowLockPath(root));
	if (!lock) {
		return {
			lock: null,
			active: false,
			stale: false,
			staleReason: null,
		};
	}

	let staleReason: string | null = null;
	if (lock.host === hostname() && lock.pid != null && !pidIsAlive(lock.pid)) {
		staleReason = `process ${lock.pid} is no longer running`;
	} else if ((Date.now() - Date.parse(lock.updatedAt)) > LOCK_STALE_AFTER_MS) {
		staleReason = 'lock heartbeat expired';
	}

	return {
		lock: {
			...lock,
			stale: staleReason != null,
			staleReason,
		},
		active: staleReason == null,
		stale: staleReason != null,
		staleReason,
	};
}

export function acquireWorkflowLock(root: string, command: TreeseedWorkflowRunCommand, runId: string) {
	const dirs = ensureWorkflowControlDirs(root);
	const inspection = inspectWorkflowLock(root);
	if (inspection.active && inspection.lock && inspection.lock.runId !== runId) {
		return {
			acquired: false,
			lock: inspection.lock,
		} as const;
	}
	if (inspection.stale) {
		rmSync(dirs.lockPath, { force: true });
	}
	const timestamp = nowIso();
	const lock: TreeseedWorkflowLockRecord = {
		schemaVersion: 1,
		kind: 'treeseed.workflow.lock',
		runId,
		command,
		root,
		host: hostname(),
		pid: process.pid,
		createdAt: inspection.lock?.runId === runId ? inspection.lock.createdAt : timestamp,
		updatedAt: timestamp,
		stale: false,
		staleReason: null,
	};
	writeFileSync(dirs.lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
	return {
		acquired: true,
		lock,
		replacedStale: inspection.stale,
	} as const;
}

export function refreshWorkflowLock(root: string, runId: string) {
	const path = workflowLockPath(root);
	const lock = safeJsonParse<TreeseedWorkflowLockRecord>(path);
	if (!lock || lock.runId !== runId) {
		return null;
	}
	const updated: TreeseedWorkflowLockRecord = {
		...lock,
		updatedAt: nowIso(),
		stale: false,
		staleReason: null,
	};
	writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
	return updated;
}

export function releaseWorkflowLock(root: string, runId: string) {
	const path = workflowLockPath(root);
	const lock = safeJsonParse<TreeseedWorkflowLockRecord>(path);
	if (!lock || lock.runId !== runId) {
		return false;
	}
	rmSync(path, { force: true });
	return true;
}

export function writeWorkflowRunJournal(root: string, journal: TreeseedWorkflowRunJournal) {
	ensureWorkflowControlDirs(root);
	writeFileSync(workflowRunPath(root, journal.runId), `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
	return journal;
}

export function readWorkflowRunJournal(root: string, runId: string) {
	return safeJsonParse<TreeseedWorkflowRunJournal>(workflowRunPath(root, runId));
}

export function updateWorkflowRunJournal(
	root: string,
	runId: string,
	updater: (journal: TreeseedWorkflowRunJournal) => TreeseedWorkflowRunJournal,
) {
	const current = readWorkflowRunJournal(root, runId);
	if (!current) {
		return null;
	}
	const updated = updater(current);
	writeWorkflowRunJournal(root, {
		...updated,
		updatedAt: nowIso(),
	});
	return readWorkflowRunJournal(root, runId);
}

export function createWorkflowRunJournal(
	root: string,
	options: {
		runId: string;
		command: TreeseedWorkflowRunCommand;
		executionMode?: TreeseedWorkflowExecutionMode;
		input: Record<string, unknown>;
		session: TreeseedWorkflowRunJournal['session'];
		steps: Omit<TreeseedWorkflowRunStep, 'status' | 'completedAt' | 'data'>[];
	},
) {
	const timestamp = nowIso();
	return writeWorkflowRunJournal(root, {
		schemaVersion: 1,
		kind: 'treeseed.workflow.run',
		runId: options.runId,
		command: options.command,
		executionMode: options.executionMode ?? 'execute',
		status: 'running',
		createdAt: timestamp,
		updatedAt: timestamp,
		resumable: options.steps.every((step) => step.resumable),
		input: options.input,
		session: options.session,
		steps: options.steps.map((step) => ({
			...step,
			status: 'pending',
			completedAt: null,
			data: null,
		})),
		failure: null,
		result: null,
	});
}

export function listWorkflowRunJournals(root: string) {
	const runsDir = workflowRunsRoot(root);
	if (!existsSync(runsDir)) {
		return [] as TreeseedWorkflowRunJournal[];
	}
	return readdirSync(runsDir)
		.filter((entry) => entry.endsWith('.json'))
		.map((entry) => safeJsonParse<TreeseedWorkflowRunJournal>(resolve(runsDir, entry)))
		.filter((entry): entry is TreeseedWorkflowRunJournal => entry != null)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listInterruptedWorkflowRuns(root: string) {
	return listWorkflowRunJournals(root).filter((journal) => journal.status === 'failed' && journal.resumable);
}
