import { existsSync } from 'node:fs';
import { classifyGitMode, runGitText } from '../../../operations/services/operations/git-runner.ts';
import { currentBranch, gitPathExists } from '../../../operations/services/treedx/workspaces/workspace-save.ts';
import type { WorkflowRunJournal } from '../../runs.ts';

type IntegrationRecovery = {
	runId: string;
	operation: 'save' | 'update';
	repository: string;
	path: string;
	branch: string;
	restoredRevision: string;
};

function runGit(repoDir: string, args: string[]) {
	return runGitText(args, { cwd: repoDir, mode: classifyGitMode(args) }).trim();
}

function record(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function failingRepository(journal: WorkflowRunJournal) {
	const details = record(journal.failure?.details);
	if (journal.command === 'update' && typeof details?.repo === 'string') return details.repo;
	const partialFailure = record(details?.partialFailure) ?? record(record(details?.details)?.partialFailure);
	return typeof partialFailure?.failingRepo === 'string' ? partialFailure.failingRepo : null;
}

export function recoverFailedWorkflowIntegrations(journals: WorkflowRunJournal[]) {
	const recovered: IntegrationRecovery[] = [];
	const blocked: Array<IntegrationRecovery & { reason: string }> = [];
	for (const journal of journals) {
		if (!['save', 'update'].includes(journal.command) || journal.status !== 'failed') continue;
		const repositoryName = failingRepository(journal);
		if (!repositoryName) continue;
		const repository = journal.session.repos.find((entry) => entry.name === repositoryName);
		const rebaseInProgress = repository && (gitPathExists(repository.path, 'rebase-merge') || gitPathExists(repository.path, 'rebase-apply'));
		const mergeInProgress = repository && gitPathExists(repository.path, 'MERGE_HEAD');
		if (!repository || !existsSync(repository.path) || journal.command === 'save' && !rebaseInProgress || journal.command === 'update' && !mergeInProgress) continue;
		const branch = repository.branchName ?? journal.session.branchName;
		if (!branch) continue;
		try {
			const originalHead = runGit(repository.path, ['rev-parse', 'ORIG_HEAD']);
			const branchHead = runGit(repository.path, ['rev-parse', '--verify', `refs/heads/${branch}`]);
			if (originalHead !== branchHead) {
				blocked.push({ runId: journal.runId, operation: journal.command as 'save' | 'update', repository: repositoryName, path: repository.path, branch, restoredRevision: originalHead, reason: 'ORIG_HEAD does not match the recorded task branch head' });
				continue;
			}
			runGit(repository.path, [journal.command === 'save' ? 'rebase' : 'merge', '--abort']);
			const restoredRevision = runGit(repository.path, ['rev-parse', 'HEAD']);
			if (currentBranch(repository.path) !== branch || restoredRevision !== originalHead) {
				blocked.push({ runId: journal.runId, operation: journal.command as 'save' | 'update', repository: repositoryName, path: repository.path, branch, restoredRevision, reason: 'Git did not restore the recorded branch and revision' });
				continue;
			}
			recovered.push({ runId: journal.runId, operation: journal.command as 'save' | 'update', repository: repositoryName, path: repository.path, branch, restoredRevision });
		} catch (error) {
			blocked.push({ runId: journal.runId, operation: journal.command as 'save' | 'update', repository: repositoryName, path: repository.path, branch, restoredRevision: '', reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return { recovered, blocked };
}
