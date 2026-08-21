import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureActVerificationTooling,getMachineConfigPaths,loadMachineConfig,resolveRemoteSession,setRemoteSession,writeMachineConfig } from "../../../operations/services/configuration/config-runtime.ts";
import { STAGING_BRANCH } from "../../../operations/services/operations/git-workflow.ts";
import { discoverPackageAdapters } from "../../../operations/services/reconciliation/package-adapters.ts";
import { type RepositorySaveReport } from "../../../operations/services/repositories/repository-save-orchestrator.ts";
import { collectCliPreflight } from "../../../operations/services/treedx/workspaces/workspace-preflight.ts";
import { hasMeaningfulChanges,repoRoot } from "../../../operations/services/treedx/workspaces/workspace-save.ts";
import type { ConfigInput,WorkflowOperationId } from "../../../operations/workflow.ts";
import { archiveWorkflowRun,classifyWorkflowRunJournal,listInterruptedWorkflowRuns,type WorkflowRunJournal } from "../../runs.ts";
import { checkedOutWorkspacePackageRepos,type WorkflowSession } from "../../session.ts";
import { normalizeConfigScopes,workflowError } from '../release-support/helpers/run-release-production-guarantees.ts';
import { createNextSteps,normalizeOptionalString } from '../packages/release-admin-message.ts';
import { WorkflowError,WorkflowOperationHelpers,WorkflowWrite,runGit } from '../recovery/workflow-write.ts';
import { packageHostedVerifyWorkflow } from '../repositories/gates-for-saved-repository-reports.ts';
import { buildWorkflowResult } from '../../support/create-repo-report.ts';

export function maybePrint(write: WorkflowWrite, line: string, stream: 'stdout' | 'stderr' = 'stdout') {
	if (!line) return;
	write(line, stream);
}

export function ensureMessage(operation: WorkflowOperationId, message: string | undefined, label: string) {
	const value = String(message ?? '').trim();
	if (!value) {
		workflowError(operation, 'validation_failed', `Treeseed ${operation} requires ${label}.`);
	}
	return value;
}

export function toError(operation: WorkflowOperationId, error: unknown): never {
	if (error instanceof WorkflowError) {
		throw error;
	}
	if (error instanceof Error) {
		throw new WorkflowError(operation, 'unsupported_state', error.message, {
			details: { name: error.name },
			exitCode: (error as { exitCode?: number }).exitCode,
		});
	}
	throw new WorkflowError(operation, 'unsupported_state', String(error));
}

export type ActiveWorkflowRun = {
	runId: string;
	session: WorkflowSession;
	journal: WorkflowRunJournal;
	resumed: boolean;
};

export function workflowSessionSnapshot(session: WorkflowSession): WorkflowRunJournal['session'] {
	return {
		root: session.root,
		mode: session.mode,
		branchName: session.branchName,
		repos: [session.rootRepo, ...session.packageRepos].map((repo) => ({
			name: repo.name, 			path: repo.path, 			branchName: repo.branchName,
		})),
	};
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function nextPendingJournalStep(journal: WorkflowRunJournal) {
	return journal.steps.find((step) => step.status === 'pending') ?? null;
}

export function findAutoResumableSaveRun(root: string, branch: string | null, selectedRepositoryPath?: string | null) {
	if (!branch) return null;
	if (branch === STAGING_BRANCH
		&& (hasMeaningfulChanges(repoRoot(root)) || checkedOutWorkspacePackageRepos(root).some((repo) => hasMeaningfulChanges(repo.dir)))) {
		return null;
	}
	const currentHeads = Object.fromEntries([
		['@treeseed/market', runGit(['rev-parse', 'HEAD'], { cwd: repoRoot(root), capture: true }).trim()],
		...checkedOutWorkspacePackageRepos(root).map((repo) => [
			repo.name,
			runGit(['rev-parse', 'HEAD'], { cwd: repo.dir, capture: true }).trim(),
		] as const),
	]);
	return listInterruptedWorkflowRuns(root).find((journal) => {
		if (journal.command !== 'save' || !journal.resumable || journal.session.branchName !== branch) {
			return false;
		}
		if (selectedRepositoryPath && !journal.session.repos.some((repo) => resolve(repo.path) === resolve(selectedRepositoryPath))) return false;
		const classification = classifyWorkflowRunJournal(journal, {
			currentBranch: branch, 			currentHeads,
		});
		if (classification.state === 'resumable') {
			return true;
		}
		if (classification.state === 'stale') {
			archiveWorkflowRun(root, journal.runId, {
				...classification,
				reasons: ['save auto-resume skipped stale failed save', ...classification.reasons],
			});
		}
		return false;
	}) ?? null;
}

export function workflowFileExists(repoPath: string, workflow: string) {
	return existsSync(resolve(repoPath, '.github', 'workflows', workflow));
}

export type DiscoveredPackageAdapter = ReturnType<typeof discoverPackageAdapters>[number];

export function hostedWorkflowsForSavedRepository(root: string, repo: RepositorySaveReport, adapter?: DiscoveredPackageAdapter) {
	const workflows: string[] = [];
	const addWorkflow = (workflow: string | null | undefined) => {
		if (!workflow) return;
		const normalized = workflow.trim().replace(/^\.github\/workflows\//u, '');
		if (/^deploy(?:[-.]|$)/u.test(normalized)) return;
		if (normalized && !workflows.includes(normalized)) {
			workflows.push(normalized);
		}
	};
	const fallbackAdapter = adapter ?? new Map(discoverPackageAdapters(root).map((entry) => [resolve(entry.dir), entry])).get(resolve(repo.path));
	const adapterWorkflow = packageHostedVerifyWorkflow(fallbackAdapter);
	addWorkflow(adapterWorkflow);
	if (workflows.length === 0 && workflowFileExists(repo.path, 'verify.yml')) addWorkflow('verify.yml');
	return workflows;
}
