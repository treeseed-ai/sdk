import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PRODUCTION_BRANCH, remoteHeadCommit, STAGING_BRANCH } from "../../operations/services/git-workflow.ts";
import { currentBranch, hasMeaningfulChanges } from "../../operations/services/workspace-save.ts";
import { acquireWorkflowLock, archiveWorkflowRun, classifyWorkflowRunJournal, createWorkflowRunJournal, generateWorkflowRunId, listInterruptedWorkflowRuns, readWorkflowRunJournal, refreshWorkflowLock, releaseWorkflowLock, updateWorkflowRunJournal, type TreeseedWorkflowRunCommand, type TreeseedWorkflowRunJournal, type TreeseedWorkflowRunStep } from ".././runs.ts";
import { checkedOutWorkspacePackageRepos, type TreeseedWorkflowSession } from ".././session.ts";
import type { TreeseedWorkflowContext } from "../../workflow.ts";
import { WorkflowRepoReport, workflowError } from './run-release-production-guarantees.ts';
import { releasePlanHead, releasePlanMatchesCurrentHeads, releaseRunHasCompletedMutation, stringRecord } from './gates-for-saved-repository-reports.ts';
import { ActiveWorkflowRun, nextPendingJournalStep, workflowSessionSnapshot } from './connect-treeseed-market-project.ts';
import { tagCommitSha } from './fail-workflow-run.ts';
import { remoteTagCommit } from './plan-root-package-version.ts';

export function prepareFreshReleaseRun(
	root: string,
	branch: string | null,
	rootRepo: WorkflowRepoReport,
	packageReports: WorkflowRepoReport[],
) {
	if (branch !== STAGING_BRANCH) return { archived: [], blockers: [] };
	const currentHeads = Object.fromEntries([
		[rootRepo.name, rootRepo.commitSha ?? null],
		...packageReports.map((report) => [report.name, report.commitSha ?? null] as const),
	]);
	const archived: Array<{ runId: string; reasons: string[] }> = [];
	const blockers: string[] = [];
	for (const journal of listInterruptedWorkflowRuns(root, { recentLimit: 50 }).filter((entry) => entry.command === 'release')) {
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch, 			currentHeads,
		});
		if (classification.state === 'stale') {
			archiveWorkflowRun(root, journal.runId, {
				...classification,
				reasons: ['fresh release superseded stale failed release', ...classification.reasons],
			});
			archived.push({ runId: journal.runId, reasons: classification.reasons });
			continue;
		}
		if (classification.state === 'resumable' && releaseRunHasCompletedMutation(journal)) {
			blockers.push(`${journal.runId}: completed release mutations and is still safe to resume. Mark it obsolete with \`npx trsd recover --obsolete ${journal.runId} --reason "superseded by fresh release"\` before using --fresh.`);
		}
	}
	if (blockers.length > 0) {
		workflowError('release', 'validation_failed', [
			'Treeseed release --fresh will not bypass a resumable partial release that already completed release mutations.', 			...blockers,
		].join('\n'), {
			details: { archived, blockers },
		});
	}
	return { archived, blockers };
}

export function findAutoResumableReleaseRun(
	root: string,
	branch: string | null,
	rootRepo: WorkflowRepoReport,
	packageReports: WorkflowRepoReport[],
	options: { archiveStale?: boolean } = {},
) {
	if (branch !== STAGING_BRANCH) return null;
	const currentHeads = Object.fromEntries([
		[rootRepo.name, rootRepo.commitSha ?? null],
		...packageReports.map((report) => [report.name, report.commitSha ?? null] as const),
	]);
	return listInterruptedWorkflowRuns(root, { recentLimit: 50 }).find((journal) => {
		if (journal.command !== 'release' || !journal.resumable || journal.session.branchName !== STAGING_BRANCH) {
			return false;
		}
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch, 			currentHeads, 			acceptedReleaseHeads: acceptedPublishedReleaseHeads(root, journal, currentHeads),
		});
		if (classification.state !== 'resumable') {
			if (options.archiveStale && classification.state === 'stale') {
				archiveWorkflowRun(root, journal.runId, {
					...classification,
					reasons: ['release auto-resume skipped stale failed release', ...classification.reasons],
				});
			}
			return false;
		}
		const releasePlan = stringRecord(journal.steps.find((step) => step.id === 'release-plan')?.data);
		const nextStep = nextPendingJournalStep(journal);
		if (releaseRunHasCompletedMutation(journal)) {
			if (nextStep?.id === 'release-root' && releasePlanHead(releasePlan ?? {}, rootRepo.name) !== rootRepo.commitSha) {
				return false;
			}
			return true;
		}
		return releasePlan ? releasePlanMatchesCurrentHeads(releasePlan, rootRepo, packageReports) : true;
	}) ?? null;
}

export function acceptedPublishedReleaseHeads(
	root: string,
	journal: TreeseedWorkflowRunJournal,
	currentHeads: Record<string, string | null | undefined>,
) {
	if (journal.command !== 'release') return {};
	const plan = stringRecord(journal.steps.find((step) => step.id === 'release-plan')?.data);
	const plannedVersions = stringRecord(plan?.plannedVersions);
	if (!plannedVersions) return {};
	const repos = new Map(checkedOutWorkspacePackageRepos(root).map((repo) => [repo.name, repo.dir]));
	const accepted: Record<string, string> = {};
	for (const [name, versionValue] of Object.entries(plannedVersions)) {
		if (name === '@treeseed/market' || typeof versionValue !== 'string') continue;
		const repoDir = repos.get(name);
		const currentHead = currentHeads[name];
		if (!repoDir || !currentHead) continue;
		let manifestVersion: string | null = null;
		try {
			manifestVersion = JSON.parse(readFileSync(resolve(repoDir, 'package.json'), 'utf8')).version ?? null;
		} catch {
			continue;
		}
		const tagHead = tagCommitSha(repoDir, versionValue);
		const remoteTagHead = remoteTagCommit(repoDir, versionValue);
		const productionHead = remoteHeadCommit(repoDir, PRODUCTION_BRANCH);
		const stagingHead = remoteHeadCommit(repoDir, STAGING_BRANCH);
		const exactPublishedHead = tagHead === currentHead
			&& productionHead === currentHead
			&& stagingHead === currentHead;
		const boundedInterruptedRetry = tagHead.length > 0
			&& remoteTagHead === tagHead
			&& !hasMeaningfulChanges(repoDir)
			&& [productionHead, stagingHead].every((head) => head === currentHead || head === tagHead);
		if (manifestVersion !== versionValue || (!exactPublishedHead && !boundedInterruptedRetry)) {
			if (process.env.TREESEED_RECONCILE_TRACE === '1') {
				process.stderr.write(`[release][resume-adoption] package=${name} accepted=false manifest=${manifestVersion === versionValue} tag=${tagHead === currentHead} remoteTag=${remoteTagHead === tagHead} main=${productionHead === currentHead} staging=${stagingHead === currentHead} bounded=${boundedInterruptedRetry}\n`);
			}
			continue;
		}
		accepted[name] = currentHead;
		if (process.env.TREESEED_RECONCILE_TRACE === '1') {
			process.stderr.write(`[release][resume-adoption] package=${name} accepted=true\n`);
		}
	}
	return accepted;
}

export async function executeJournalStep<T extends Record<string, unknown> | null>(
	root: string,
	runId: string,
	stepId: string,
	action: () => Promise<T> | T,
	options: { rerunCompleted?: boolean } = {},
) {
	const current = readWorkflowRunJournal(root, runId);
	const step = current?.steps.find((entry) => entry.id === stepId) ?? null;
	if (!current || !step) {
		throw new Error(`Unknown workflow step "${stepId}" for run ${runId}.`);
	}
	if (step.status === 'completed' && !options.rerunCompleted) {
		return (step.data ?? null) as T;
	}
	const startedAt = new Date();
	const retryCount = Number(step.retryCount ?? 0) + (step.startedAt ? 1 : 0);
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		steps: journal.steps.map((entry) => entry.id === stepId
			? { ...entry, startedAt: startedAt.toISOString(), retryCount, lastFailure: null }
			: entry),
	}));
	refreshWorkflowLock(root, runId);
	const lockHeartbeat = setInterval(() => refreshWorkflowLock(root, runId), 15_000);
	lockHeartbeat.unref();
	process.stderr.write(`[workflow][step] start ${stepId} attempt=${retryCount + 1}\n`);
	let data: T;
	try {
		data = await Promise.resolve(action());
	} catch (error) {
		clearInterval(lockHeartbeat);
		const elapsedMs = Date.now() - startedAt.getTime();
		const message = error instanceof Error ? error.message : String(error);
		updateWorkflowRunJournal(root, runId, (journal) => ({
			...journal,
			steps: journal.steps.map((entry) => entry.id === stepId
				? { ...entry, elapsedMs, lastFailure: message }
				: entry),
		}));
		process.stderr.write(`[workflow][step] fail ${stepId} elapsed=${Math.ceil(elapsedMs / 1000)}s retries=${retryCount}\n`);
		throw error;
	}
	clearInterval(lockHeartbeat);
	const elapsedMs = Date.now() - startedAt.getTime();
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		steps: journal.steps.map((entry) =>
			entry.id === stepId
				? {
					...entry, 					status: 'completed', 					completedAt: new Date().toISOString(), 					elapsedMs, 					lastFailure: null, 					data: data ?? null,
				}
				: entry),
	}));
	refreshWorkflowLock(root, runId);
	process.stderr.write(`[workflow][step] complete ${stepId} elapsed=${Math.ceil(elapsedMs / 1000)}s retries=${retryCount}\n`);
	return data;
}

export function skipJournalStep(root: string, runId: string, stepId: string, data: Record<string, unknown> | null = null) {
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		steps: journal.steps.map((entry) =>
			entry.id === stepId
				? {
					...entry, 					status: 'skipped', 					completedAt: new Date().toISOString(), 					data,
				}
				: entry),
	}));
	refreshWorkflowLock(root, runId);
}

export function acquireWorkflowRun(
	operation: TreeseedWorkflowRunCommand,
	session: TreeseedWorkflowSession,
	input: Record<string, unknown>,
	steps: Omit<TreeseedWorkflowRunStep, 'status' | 'completedAt' | 'data'>[],
	context: TreeseedWorkflowContext,
) {
	const resumeRunId = context.workflow?.resumeRunId;
	if (resumeRunId) {
		const existing = readWorkflowRunJournal(session.root, resumeRunId);
		if (!existing || existing.command !== operation) {
			workflowError(operation, 'resume_unavailable', `Treeseed ${operation} cannot resume run ${resumeRunId}.`, {
				details: { runId: resumeRunId, command: operation },
			});
		}
		const lockResult = acquireWorkflowLock(session.root, operation, resumeRunId);
		if (!lockResult.acquired) {
			workflowError(operation, 'workflow_locked', `Treeseed ${operation} is blocked by active run ${lockResult.lock.runId}.`, {
				details: {
					lock: lockResult.lock,
					recovery: {
						resumable: true, 						runId: lockResult.lock.runId, 						command: lockResult.lock.command, 						recoverCommand: 'treeseed recover',
						resumeCommand: `treeseed resume ${lockResult.lock.runId}`,
					},
				},
			});
		}
		return {
			runId: resumeRunId, 			session, 			journal: existing, 			resumed: true,
		} satisfies ActiveWorkflowRun;
	}

	const runId = generateWorkflowRunId(operation);
	const lockResult = acquireWorkflowLock(session.root, operation, runId);
	if (!lockResult.acquired) {
		workflowError(operation, 'workflow_locked', `Treeseed ${operation} is blocked by active run ${lockResult.lock.runId}.`, {
			details: {
				lock: lockResult.lock,
				recovery: {
					resumable: true, 					runId: lockResult.lock.runId, 					command: lockResult.lock.command, 					recoverCommand: 'treeseed recover',
					resumeCommand: `treeseed resume ${lockResult.lock.runId}`,
				},
			},
		});
	}
	const journal = createWorkflowRunJournal(session.root, {
		runId,
		command: operation,
		input,
		session: workflowSessionSnapshot(session),
		steps,
	});
	return {
		runId,
		session,
		journal,
		resumed: false,
	} satisfies ActiveWorkflowRun;
}

export function completeWorkflowRun(root: string, runId: string, result: Record<string, unknown>) {
	updateWorkflowRunJournal(root, runId, (journal) => ({
		...journal,
		status: 'completed',
		result,
		failure: null,
	}));
	releaseWorkflowLock(root, runId);
}
