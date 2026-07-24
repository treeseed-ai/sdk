import { existsSync } from 'node:fs';
import { currentBranch } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import { run } from "../../../operations/services/treedx/workspaces/workspace-tools.ts";
import { archiveWorkflowRun, classifyWorkflowRunJournal, inspectWorkflowLock, listWorkflowRunJournals, readWorkflowRunJournal, releaseWorkflowLock, updateWorkflowRunJournal } from "../../runs.ts";
import { resolveWorkflowSession } from "../../session.ts";
import type { CloseInput, DestroyInput, ReleaseInput, RecoverInput, ResumeInput, SaveInput, StageInput, SwitchInput, UpdateInput } from "../../../operations/workflow.ts";
import { WorkflowOperationHelpers } from './workflow-write.ts';
import { resolveProjectRootOrThrow, withContextEnv, workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { buildWorkflowResult, createWorkspacePackageReports, createWorkspaceRootRepoReport } from '../support/create-repo-report.ts';
import { acceptedPublishedReleaseHeads } from '../packages/prepare-fresh-release-run.ts';
import { helpersForCwd } from '../packages/normalize-release-candidate-mode.ts';
import { workflowSwitch } from '../workspace-lifecycle/workflow-switch.ts';
import { workflowSave } from '../workspace-lifecycle/workflow-save.ts';
import { workflowUpdate } from '../workspace-lifecycle/workflow-update.ts';
import { workflowClose } from '../workspace-lifecycle/workflow-close.ts';
import { workflowStage } from '../workspace-lifecycle/workflow-stage.ts';
import { workflowRelease } from '../release/workflow-release.ts';
import { workflowDestroy } from '../coordination/workflow-destroy.ts';
import { nextPendingJournalStep, toError } from '../projects/projects-core/connect-market-project.ts';
import { createNextSteps } from '../packages/release-admin-message.ts';

export async function workflowResume(helpers: WorkflowOperationHelpers, input: ResumeInput) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('resume', helpers.cwd());
			const runId = String(input.runId ?? '').trim();
			if (!runId) {
				workflowError('resume', 'validation_failed', 'Treeseed resume requires a run id.');
			}
			const journal = readWorkflowRunJournal(root, runId);
			if (!journal) {
				workflowError('resume', 'resume_unavailable', `Treeseed resume could not find run ${runId}.`, {
					details: { runId },
				});
			}
			if (journal.status === 'completed') {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is already completed.`, {
					details: { runId, status: journal.status },
				});
			}
			if (!journal.resumable) {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is not resumable.`, {
					details: { runId, status: journal.status },
				});
			}
			const session = resolveWorkflowSession(root);
			const currentHeads = Object.fromEntries(
				[createWorkspaceRootRepoReport(root), ...createWorkspacePackageReports(root)]
					.map((report) => [report.name, report.commitSha ?? null]),
			);
			const classification = classifyWorkflowRunJournal(journal, {
				currentBranch: session.branchName, 				currentHeads, 				acceptedReleaseHeads: acceptedPublishedReleaseHeads(root, journal, currentHeads),
			});
			if (classification.state !== 'resumable') {
				workflowError('resume', 'resume_unavailable', `Run ${runId} is ${classification.state} and is not safe to resume.`, {
					details: { runId, status: journal.status, classification },
				});
			}
			const resumeRoot = typeof journal.session?.root === 'string' && existsSync(journal.session.root)
				? journal.session.root
				: root;
			const resumedHelpers: WorkflowOperationHelpers = helpersForCwd({
				...helpers,
				context: {
					...helpers.context,
					workflow: {
						...(helpers.context.workflow ?? {}),
						resumeRunId: runId,
					},
				},
			}, resumeRoot);
			switch (journal.command) {
				case 'switch':
					return workflowSwitch(resumedHelpers, journal.input as unknown as SwitchInput);
				case 'save':
					return workflowSave(resumedHelpers, journal.input as unknown as SaveInput);
				case 'update':
					return workflowUpdate(resumedHelpers, journal.input as unknown as UpdateInput);
				case 'close':
					return workflowClose(resumedHelpers, journal.input as unknown as CloseInput);
				case 'stage':
					return workflowStage(resumedHelpers, journal.input as unknown as StageInput);
				case 'release':
					return workflowRelease(resumedHelpers, {
						...(journal.input as unknown as ReleaseInput), 						resumeRunId: runId,
					} as ReleaseInput & { resumeRunId: string });
				case 'destroy':
					return workflowDestroy(resumedHelpers, journal.input as unknown as DestroyInput);
				default:
					workflowError('resume', 'resume_unavailable', `Run ${runId} uses unsupported command ${journal.command}.`, {
						details: { runId, command: journal.command },
					});
			}
		});
	} catch (error) {
		toError('resume', error);
	}
}

export async function workflowRecover(helpers: WorkflowOperationHelpers, input: RecoverInput = {}) {
	try {
		return await withContextEnv(helpers.context.env, async () => {
			const root = resolveProjectRootOrThrow('recover', helpers.cwd());
			const initialLocks = (['worktree', 'shared'] as const).map((scope) => ({
				scope, 				inspection: inspectWorkflowLock(root, { scope }),
			}));
			const clearedStaleLocks = initialLocks
				.filter((entry) => entry.inspection.stale && entry.inspection.lock?.runId)
				.map((entry) => ({
					scope: entry.scope, 					runId: entry.inspection.lock!.runId, 					command: entry.inspection.lock!.command, 					staleReason: entry.inspection.staleReason, 					removed: releaseWorkflowLock(root, entry.inspection.lock!.runId),
				}));
			const locks = (['worktree', 'shared'] as const).map((scope) => ({
				scope, 				inspection: inspectWorkflowLock(root, { scope }),
			}));
			const lock = locks.find((entry) => entry.inspection.active)?.inspection
				?? locks.find((entry) => entry.inspection.stale)?.inspection
				?? locks[0]!.inspection;
			const hasActiveLock = locks.some((entry) => entry.inspection.active);
			const orphanedRunningRuns = hasActiveLock
				? []
				: listWorkflowRunJournals(root).filter((journal) => journal.status === 'running');
			const prunedOrphanedRuns = input.pruneStale === true
				? orphanedRunningRuns.map((journal) => {
					const classification = {
						state: 'stale' as const,
						reasons: ['workflow journal was left running without an active workflow lock'],
						classifiedAt: new Date().toISOString(),
					};
					archiveWorkflowRun(root, journal.runId, classification);
					return { runId: journal.runId, command: journal.command, status: journal.status, classification };
				})
				: orphanedRunningRuns.map((journal) => {
					updateWorkflowRunJournal(root, journal.runId, (current) => ({
						...current, 						status: 'failed', 						updatedAt: new Date().toISOString(),
						failure: {
							code: 'interrupted', 							message: 'Workflow process ended without finalizing its journal.',
							details: { recovery: { resumable: current.resumable, runId: current.runId, resumeCommand: `treeseed resume ${current.runId}` } },
							at: new Date().toISOString(),
						},
					}));
					return null;
				}).filter((entry): entry is never => entry !== null);
			const journals = listWorkflowRunJournals(root);
			const actionableJournals = journals.filter((journal) =>
				journal.status !== 'completed' && !journal.classification?.archivedAt);
			const session = resolveWorkflowSession(root);
			const currentHeads = Object.fromEntries(
				[createWorkspaceRootRepoReport(root), ...createWorkspacePackageReports(root)]
					.map((report) => [report.name, report.commitSha ?? null]),
			);
			const classifiedRuns = actionableJournals.map((journal) => ({
				journal, 				classification: classifyWorkflowRunJournal(journal, {
					currentBranch: session.branchName, 					currentHeads,
				}),
			}));
			const markedObsoleteRun = input.obsoleteRunId
				? (() => {
					const journal = journals.find((candidate) => candidate.runId === input.obsoleteRunId);
					if (!journal) {
						workflowError('recover', 'validation_failed', `Treeseed recover could not find workflow run ${input.obsoleteRunId}.`);
					}
					const reason = input.obsoleteReason?.trim() || 'marked obsolete by operator';
					const classification = {
						state: 'obsolete' as const,
						reasons: [reason],
						classifiedAt: new Date().toISOString(),
					};
					archiveWorkflowRun(root, journal.runId, classification);
					return {
						runId: journal.runId, 						command: journal.command, 						reason,
					};
				})()
				: null;
			const effectiveClassifiedRuns = markedObsoleteRun
				? classifiedRuns.filter((entry) => entry.journal.runId !== markedObsoleteRun.runId)
				: classifiedRuns;
			const interruptedRuns = effectiveClassifiedRuns
				.filter((entry) => entry.classification.state === 'resumable')
				.map(({ journal }) => ({
					runId: journal.runId, 					command: journal.command, 					status: journal.status, 					createdAt: journal.createdAt, 					updatedAt: journal.updatedAt, 					nextStep: nextPendingJournalStep(journal)?.description ?? null, 					failure: journal.failure,
					resumeCommand: `treeseed resume ${journal.runId}`,
				}));
			const staleRuns = effectiveClassifiedRuns
				.filter((entry) => entry.classification.state === 'stale')
				.map(({ journal, classification }) => ({
					runId: journal.runId, 					command: journal.command, 					status: journal.status, 					createdAt: journal.createdAt, 					updatedAt: journal.updatedAt, 					nextStep: nextPendingJournalStep(journal)?.description ?? null, 					failure: journal.failure, 					classification,
				}));
			const obsoleteRuns = effectiveClassifiedRuns
				.filter((entry) => entry.classification.state === 'obsolete')
				.map(({ journal, classification }) => ({
					runId: journal.runId, 					command: journal.command, 					status: journal.status, 					createdAt: journal.createdAt, 					updatedAt: journal.updatedAt, 					failure: journal.failure, 					classification,
				}));
			const prunedRuns = input.pruneStale === true
				? staleRuns.map((run) => {
					archiveWorkflowRun(root, run.runId, run.classification);
					return run;
				})
				: [];
			const selectedRun = input.runId ? readWorkflowRunJournal(root, input.runId) : null;
			return buildWorkflowResult(
				'recover', 				root,
				{
					lock,
					locks: locks.map((entry) => ({ scope: entry.scope, ...entry.inspection })),
					clearedStaleLocks, 					interruptedRuns, 					staleRuns, 					obsoleteRuns,
					prunedRuns: [...prunedOrphanedRuns, ...prunedRuns],
					markedObsoleteRun, 					selectedRun, 					runCount: journals.length,
				},
				{
					includeFinalState: false,
					nextSteps: createNextSteps([
						...(interruptedRuns.length > 0
							? [{ operation: 'resume', reason: 'Resume the most recent interrupted workflow run.', input: { runId: interruptedRuns[0].runId } }]
							: staleRuns.length > 0 && input.pruneStale !== true
								? [{ operation: 'recover', reason: 'Archive stale interrupted runs that no longer match current heads.', input: { pruneStale: true } }]
							: [{ operation: 'status', reason: 'No interrupted runs were found; inspect current workflow state instead.' }]),
					]),
				},
			);
		});
	} catch (error) {
		toError('recover', error);
	}
}
