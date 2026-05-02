import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
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
	classification?: TreeseedWorkflowRunClassification | null;
	gateCache?: TreeseedWorkflowGateCacheEntry[];
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
const WORKTREE_METADATA_PATH = '.treeseed/worktree.json';
const LOCK_STALE_AFTER_MS = 4 * 60 * 60 * 1000;
const WORKFLOW_RUN_STORAGE_ROOTS = new Map<string, string>();

function nowIso() {
	return new Date().toISOString();
}

function managedWorktreePrimaryRoot(root: string) {
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

function workflowStorageRoot(root: string, runId?: string | null) {
	if (runId && WORKFLOW_RUN_STORAGE_ROOTS.has(runId)) {
		return WORKFLOW_RUN_STORAGE_ROOTS.get(runId) as string;
	}
	const storageRoot = managedWorktreePrimaryRoot(root) ?? root;
	if (runId) {
		WORKFLOW_RUN_STORAGE_ROOTS.set(runId, storageRoot);
	}
	return storageRoot;
}

function workflowControlRoot(root: string, runId?: string | null) {
	return resolve(workflowStorageRoot(root, runId), WORKFLOW_CONTROL_DIR);
}

function workflowRunsRoot(root: string, runId?: string | null) {
	return resolve(workflowStorageRoot(root, runId), WORKFLOW_RUNS_DIR);
}

function workflowLockPath(root: string, runId?: string | null) {
	return resolve(workflowStorageRoot(root, runId), WORKFLOW_CONTROL_DIR, 'lock.json');
}

function workflowRunPath(root: string, runId: string) {
	return resolve(workflowStorageRoot(root, runId), WORKFLOW_RUNS_DIR, `${runId}.json`);
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
	mkdirSync(dirname(excludePath), { recursive: true });
	writeFileSync(excludePath, `${current}${current.endsWith('\n') || current.length === 0 ? '' : '\n'}${pattern}\n`, 'utf8');
}

function ensureWorkflowControlDirs(root: string, runId?: string | null) {
	const controlDir = workflowControlRoot(root, runId);
	const runsDir = workflowRunsRoot(root, runId);
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
	const dirs = ensureWorkflowControlDirs(root, runId);
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
	const path = workflowLockPath(root, runId);
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
	const path = workflowLockPath(root, runId);
	const lock = safeJsonParse<TreeseedWorkflowLockRecord>(path);
	if (!lock || lock.runId !== runId) {
		return false;
	}
	rmSync(path, { force: true });
	return true;
}

export function writeWorkflowRunJournal(root: string, journal: TreeseedWorkflowRunJournal) {
	ensureWorkflowControlDirs(root, journal.runId);
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

function stringRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Record<string, unknown>
		: null;
}

function journalReleasePlanHead(plan: Record<string, unknown>, repoName: string) {
	if (repoName === '@treeseed/market') {
		const rootRepo = stringRecord(plan.rootRepo);
		return typeof rootRepo?.commitSha === 'string' ? rootRepo.commitSha : null;
	}
	const repos = Array.isArray(plan.repos) ? plan.repos : [];
	for (const repo of repos) {
		const record = stringRecord(repo);
		if (record?.name === repoName) {
			return typeof record.commitSha === 'string' ? record.commitSha : null;
		}
	}
	return null;
}

function selectedReleasePackageNames(plan: Record<string, unknown>) {
	const selection = stringRecord(plan.packageSelection);
	const selected = Array.isArray(selection?.selected)
		? selection.selected.filter((name): name is string => typeof name === 'string')
		: [];
	return selected;
}

export function classifyWorkflowRunJournal(
	journal: TreeseedWorkflowRunJournal,
	options: {
		currentBranch?: string | null;
		currentHeads?: Record<string, string | null | undefined>;
		now?: string;
	} = {},
): TreeseedWorkflowRunClassification {
	const reasons: string[] = [];
	const now = options.now ?? nowIso();
	if (journal.classification?.archivedAt) {
		return {
			state: 'obsolete',
			reasons: journal.classification.reasons.length > 0 ? journal.classification.reasons : ['workflow run was archived'],
			classifiedAt: now,
			archivedAt: journal.classification.archivedAt,
		};
	}
	if (journal.status !== 'failed') {
		return {
			state: 'obsolete',
			reasons: [`workflow run status is ${journal.status}`],
			classifiedAt: now,
		};
	}
	if (!journal.resumable) {
		return {
			state: 'obsolete',
			reasons: ['workflow run is not marked resumable'],
			classifiedAt: now,
		};
	}
	if (options.currentBranch && journal.session.branchName && options.currentBranch !== journal.session.branchName) {
		reasons.push(`current branch ${options.currentBranch} does not match journal branch ${journal.session.branchName}`);
	}
	if (journal.command === 'release' && options.currentHeads) {
		const releasePlan = stringRecord(journal.steps.find((step) => step.id === 'release-plan')?.data);
		if (releasePlan) {
			const rootHead = options.currentHeads['@treeseed/market'];
			const plannedRootHead = journalReleasePlanHead(releasePlan, '@treeseed/market');
			if (rootHead && plannedRootHead && rootHead !== plannedRootHead) {
				reasons.push(`market head changed from ${plannedRootHead} to ${rootHead}`);
			}
			for (const name of selectedReleasePackageNames(releasePlan)) {
				const currentHead = options.currentHeads[name];
				const plannedHead = journalReleasePlanHead(releasePlan, name);
				if (currentHead && plannedHead && currentHead !== plannedHead) {
					reasons.push(`${name} head changed from ${plannedHead} to ${currentHead}`);
				}
			}
		}
	}
	return {
		state: reasons.length > 0 ? 'stale' : 'resumable',
		reasons: reasons.length > 0 ? reasons : ['workflow run can be resumed'],
		classifiedAt: now,
	};
}

export function classifyWorkflowRunJournals(
	root: string,
	options: Parameters<typeof classifyWorkflowRunJournal>[1] = {},
) {
	return listWorkflowRunJournals(root).map((journal) => ({
		journal,
		classification: classifyWorkflowRunJournal(journal, options),
	}));
}

export function archiveWorkflowRun(root: string, runId: string, classification: TreeseedWorkflowRunClassification) {
	const archivedAt = nowIso();
	return updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		resumable: false,
		classification: {
			...classification,
			state: classification.state === 'resumable' ? 'stale' : classification.state,
			archivedAt,
			classifiedAt: archivedAt,
		},
	}));
}

function gateCacheMatches(entry: TreeseedWorkflowGateCacheEntry, gate: {
	repository?: string | null;
	workflow: string;
	headSha: string;
	branch?: string | null;
}) {
	return entry.workflow === gate.workflow
		&& entry.headSha === gate.headSha
		&& (gate.repository == null || entry.repo === gate.repository)
		&& (gate.branch == null || entry.branch === gate.branch);
}

export function getCachedSuccessfulWorkflowGate(
	root: string,
	runId: string,
	gate: {
		repository?: string | null;
		workflow: string;
		headSha: string;
		branch?: string | null;
	},
) {
	const journal = readWorkflowRunJournal(root, runId);
	const cache = journal?.gateCache ?? [];
	return cache.find((entry) =>
		gateCacheMatches(entry, gate)
		&& entry.status === 'completed'
		&& entry.conclusion === 'success') ?? null;
}

export function cacheWorkflowGateResult(root: string, runId: string, result: Record<string, unknown>) {
	const workflow = typeof result.workflow === 'string' ? result.workflow : null;
	const headSha = typeof result.headSha === 'string' ? result.headSha : null;
	if (!workflow || !headSha) {
		return null;
	}
	const entry: TreeseedWorkflowGateCacheEntry = {
		repo: typeof result.repository === 'string' ? result.repository : null,
		workflow,
		headSha,
		branch: typeof result.branch === 'string' ? result.branch : null,
		status: typeof result.status === 'string' ? result.status : 'unknown',
		conclusion: typeof result.conclusion === 'string' ? result.conclusion : null,
		runId: typeof result.runId === 'string' || typeof result.runId === 'number' ? result.runId : null,
		url: typeof result.url === 'string' ? result.url : null,
		cachedAt: nowIso(),
		result,
	};
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		gateCache: [
			...(journal.gateCache ?? []).filter((candidate) => !gateCacheMatches(candidate, {
				repository: entry.repo,
				workflow: entry.workflow,
				headSha: entry.headSha,
				branch: entry.branch,
			})),
			entry,
		],
	}));
	return entry;
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
