import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, resolve } from 'node:path';
import type { TreeseedWorkflowMode } from '../session.ts';
import { archivedWorkflowRunSummary, readWorkflowRunJournal, safeJsonParse, writeWorkflowRunJournal } from './ensure-workflow-exclude-rule.ts';
import { gateCacheMatches, updateWorkflowRunJournal } from './update-workflow-run-journal.ts';
import { TreeseedWorkflowExecutionMode, TreeseedWorkflowGateCacheEntry, TreeseedWorkflowLockScope, TreeseedWorkflowRunCommand, TreeseedWorkflowRunJournal, TreeseedWorkflowRunStep, nowIso, workflowRunsRoot } from './treeseed-workflow-run-command.ts';

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
			startedAt: null,
			completedAt: null,
			elapsedMs: null,
			retryCount: 0,
			lastFailure: null,
			data: null,
		})),
		failure: null,
		result: null,
	});
}

export function listWorkflowRunJournalsForScope(root: string, scope: TreeseedWorkflowLockScope) {
	const runsDir = workflowRunsRoot(root, null, scope);
	if (!existsSync(runsDir)) {
		return [] as TreeseedWorkflowRunJournal[];
	}
	return readdirSync(runsDir)
		.filter((entry) => entry.endsWith('.json'))
		.map((entry) => {
			const path = resolve(runsDir, entry);
			try {
				if (statSync(path).size > 5 * 1024 * 1024) {
					const archivedSummary = archivedWorkflowRunSummary(path);
					if (archivedSummary) return archivedSummary;
				}
			} catch {
				return null;
			}
			return safeJsonParse<TreeseedWorkflowRunJournal>(path);
		})
		.filter((entry): entry is TreeseedWorkflowRunJournal => entry != null)
		.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listWorkflowRunJournals(root: string) {
	const local = listWorkflowRunJournalsForScope(root, 'worktree');
	const shared = listWorkflowRunJournalsForScope(root, 'shared');
	const byId = new Map<string, TreeseedWorkflowRunJournal>();
	for (const journal of [...local, ...shared]) {
		byId.set(journal.runId, journal);
	}
	return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function listRecentWorkflowRunJournalsForScope(root: string, scope: TreeseedWorkflowLockScope, limit: number) {
	const runsDir = workflowRunsRoot(root, null, scope);
	if (!existsSync(runsDir)) {
		return [] as TreeseedWorkflowRunJournal[];
	}
	return readdirSync(runsDir)
		.filter((entry) => entry.endsWith('.json'))
		.map((entry) => {
			const path = resolve(runsDir, entry);
			try {
				return { path, mtimeMs: statSync(path).mtimeMs };
			} catch {
				return null;
			}
		})
		.filter((entry): entry is { path: string; mtimeMs: number } => entry != null)
		.sort((left, right) => right.mtimeMs - left.mtimeMs)
		.slice(0, Math.max(1, limit))
		.map((entry) => {
			try {
				if (statSync(entry.path).size > 5 * 1024 * 1024) {
					const archivedSummary = archivedWorkflowRunSummary(entry.path);
					if (archivedSummary) return archivedSummary;
				}
			} catch {
				return null;
			}
			return safeJsonParse<TreeseedWorkflowRunJournal>(entry.path);
		})
		.filter((entry): entry is TreeseedWorkflowRunJournal => entry != null);
}

export function listRecentWorkflowRunJournals(root: string, limit = 50) {
	const local = listRecentWorkflowRunJournalsForScope(root, 'worktree', limit);
	const shared = listRecentWorkflowRunJournalsForScope(root, 'shared', limit);
	const byId = new Map<string, TreeseedWorkflowRunJournal>();
	for (const journal of [...local, ...shared]) {
		byId.set(journal.runId, journal);
	}
	return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, Math.max(1, limit));
}

export function listInterruptedWorkflowRuns(root: string, options: { recentLimit?: number } = {}) {
	const journals = options.recentLimit
		? listRecentWorkflowRunJournals(root, options.recentLimit)
		: listWorkflowRunJournals(root);
	return journals.filter((journal) => journal.status === 'failed' && journal.resumable);
}
