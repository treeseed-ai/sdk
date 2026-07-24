import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { WorkflowMode } from '../session.ts';
import { ACTIVE_WORKFLOW_RUNS, LOCK_STALE_AFTER_MS, WorkflowExecutionMode, WorkflowLockInspection, WorkflowLockRecord, WorkflowLockScope, WorkflowRunCommand, WorkflowRunJournal, WorkflowRunStatus, installWorkflowSignalHandlers, nowIso, resolveGitDir, workflowControlRoot, workflowLockPath, workflowLockScopeForCommand, workflowRunPath, workflowRunsRoot } from './workflow-run-command.ts';
import { updateWorkflowRunJournal } from './update-workflow-run-journal.ts';

export function ensureWorkflowExcludeRule(root: string) {
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
	mkdirSync(dirname(excludePath), { recursive: true });
	writeFileSync(excludePath, `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${pattern}\n`, 'utf8');
}

export function ensureWorkflowControlDirs(root: string, runId?: string | null, scope?: WorkflowLockScope) {
	const controlDir = workflowControlRoot(root, runId, scope);
	const runsDir = workflowRunsRoot(root, runId, scope);
	mkdirSync(runsDir, { recursive: true });
	ensureWorkflowExcludeRule(root);
	writeFileSync(resolve(controlDir, '.gitignore'), '*\n!.gitignore\n!runs/\nruns/*\n!runs/.gitignore\n', 'utf8');
	writeFileSync(resolve(runsDir, '.gitignore'), '*\n!.gitignore\n', 'utf8');
	return {
		controlDir,
		runsDir,
		lockPath: workflowLockPath(root, runId, scope),
	};
}

export function safeJsonParse<T>(filePath: string): T | null {
	if (!existsSync(filePath)) {
		return null;
	}
	try {
		return JSON.parse(readFileSync(filePath, 'utf8')) as T;
	} catch {
		return null;
	}
}

export function pidIsAlive(pid: number | null) {
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

export function generateWorkflowRunId(command: WorkflowRunCommand) {
	return `${command}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function inspectWorkflowLock(root: string, options: { scope?: WorkflowLockScope } = {}): WorkflowLockInspection {
	const scope = options.scope ?? 'worktree';
	const lock = safeJsonParse<WorkflowLockRecord>(workflowLockPath(root, null, scope));
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
			scope: lock.scope ?? scope,
			stale: staleReason != null,
			staleReason,
		},
		active: staleReason == null,
		stale: staleReason != null,
		staleReason,
	};
}

export function acquireWorkflowLock(root: string, command: WorkflowRunCommand, runId: string) {
	const scope = workflowLockScopeForCommand(command);
	const dirs = ensureWorkflowControlDirs(root, runId, scope);
	const inspection = inspectWorkflowLock(root, { scope });
	if (inspection.active && inspection.lock && inspection.lock.runId !== runId) {
		return {
			acquired: false,
			lock: inspection.lock,
		} as const;
	}
	if (inspection.stale) {
		if (inspection.lock?.runId) {
			const staleJournal = readWorkflowRunJournal(root, inspection.lock.runId);
			if (staleJournal?.status === 'running') {
				updateWorkflowRunJournal(root, inspection.lock.runId, (journal) => ({
					...journal,
					status: 'failed',
					failure: {
						code: 'interrupted',
						message: `Workflow lock became stale because ${inspection.staleReason ?? 'the owning process ended'}.`,
						details: { resumable: true, resumeCommand: `treeseed resume ${inspection.lock!.runId}` },
						at: nowIso(),
					},
				}));
			}
		}
		rmSync(dirs.lockPath, { force: true });
	}
	const timestamp = nowIso();
	const lock: WorkflowLockRecord = {
		schemaVersion: 1,
		kind: 'treeseed.workflow.lock',
		scope,
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
	ACTIVE_WORKFLOW_RUNS.set(runId, root);
	installWorkflowSignalHandlers();
	return {
		acquired: true,
		lock,
		replacedStale: inspection.stale,
	} as const;
}

export function refreshWorkflowLock(root: string, runId: string) {
	const path = workflowLockPath(root, runId);
	const lock = safeJsonParse<WorkflowLockRecord>(path);
	if (!lock || lock.runId !== runId) {
		return null;
	}
	const updated: WorkflowLockRecord = {
		...lock,
		updatedAt: nowIso(),
		stale: false,
		staleReason: null,
	};
	writeFileSync(path, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
	return updated;
}

export function releaseWorkflowLock(root: string, runId: string) {
	ACTIVE_WORKFLOW_RUNS.delete(runId);
	const path = workflowLockPath(root, runId);
	const lock = safeJsonParse<WorkflowLockRecord>(path);
	if (!lock || lock.runId !== runId) {
		return false;
	}
	rmSync(path, { force: true });
	return true;
}

export function writeWorkflowRunJournal(root: string, journal: WorkflowRunJournal) {
	ensureWorkflowControlDirs(root, journal.runId);
	writeFileSync(workflowRunPath(root, journal.runId), `${JSON.stringify(journal, null, 2)}\n`, 'utf8');
	return journal;
}

export function readWorkflowRunJournal(root: string, runId: string) {
	return safeJsonParse<WorkflowRunJournal>(workflowRunPath(root, runId));
}

export function jsonStringField(source: string, key: string) {
	const pattern = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`, 'u');
	const match = source.match(pattern);
	if (!match) return null;
	try {
		return JSON.parse(`"${match[1]}"`) as string;
	} catch {
		return match[1];
	}
}

export function jsonBooleanField(source: string, key: string) {
	const pattern = new RegExp(`"${key}"\\s*:\\s*(true|false)`, 'u');
	const match = source.match(pattern);
	return match ? match[1] === 'true' : null;
}

export function readFileEnds(path: string, bytes: number) {
	const fd = openSync(path, 'r');
	try {
		const stat = fstatSync(fd);
		const headLength = Math.min(bytes, stat.size);
		const tailLength = Math.min(bytes, stat.size);
		const head = Buffer.alloc(headLength);
		const tail = Buffer.alloc(tailLength);
		readSync(fd, head, 0, headLength, 0);
		readSync(fd, tail, 0, tailLength, Math.max(0, stat.size - tailLength));
		return { size: stat.size, head: head.toString('utf8'), tail: tail.toString('utf8') };
	} finally {
		closeSync(fd);
	}
}

export function archivedWorkflowRunSummary(path: string) {
	const { head, tail } = readFileEnds(path, 128 * 1024);
	if (!tail.includes('"archivedAt"')) {
		return null;
	}
	const runId = jsonStringField(head, 'runId');
	const command = jsonStringField(head, 'command') as WorkflowRunCommand | null;
	const executionMode = jsonStringField(head, 'executionMode') as WorkflowExecutionMode | null;
	const status = jsonStringField(head, 'status') as WorkflowRunStatus | null;
	const createdAt = jsonStringField(head, 'createdAt');
	const updatedAt = jsonStringField(head, 'updatedAt');
	const archivedAt = jsonStringField(tail, 'archivedAt');
	const classifiedAt = jsonStringField(tail, 'classifiedAt') ?? archivedAt;
	if (!runId || !command || !executionMode || !status || !createdAt || !updatedAt || !archivedAt || !classifiedAt) {
		return null;
	}
	return {
		schemaVersion: 1,
		kind: 'treeseed.workflow.run',
		runId,
		command,
		executionMode,
		status,
		createdAt,
		updatedAt,
		resumable: jsonBooleanField(head, 'resumable') ?? false,
		input: {},
		session: {
			root: '',
			mode: 'root-only',
			branchName: null,
			repos: [],
		},
		steps: [],
		failure: null,
		result: null,
		classification: {
			state: 'obsolete',
			reasons: ['workflow run was archived'],
			classifiedAt,
			archivedAt,
		},
	} satisfies WorkflowRunJournal;
}
