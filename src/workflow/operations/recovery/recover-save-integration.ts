import { existsSync } from 'node:fs';
import { classifyGitMode, runGitText } from '../../../operations/services/operations/git-runner.ts';
import { currentBranch, gitPathExists } from '../../../operations/services/treedx/workspaces/workspace-save.ts';
import type { WorkflowRunJournal } from '../../runs.ts';

type IntegrationRecovery = {
	runId: string;
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
	const partialFailure = record(details?.partialFailure) ?? record(record(details?.details)?.partialFailure);
	return typeof partialFailure?.failingRepo === 'string' ? partialFailure.failingRepo : null;
}

export function recoverFailedSaveRebases(journals: WorkflowRunJournal[]) {
	const recovered: IntegrationRecovery[] = [];
	const blocked: Array<IntegrationRecovery & { reason: string }> = [];
	for (const journal of journals) {
		if (journal.command !== 'save' || journal.status !== 'failed') continue;
		const repositoryName = failingRepository(journal);
		if (!repositoryName) continue;
		const repository = journal.session.repos.find((entry) => entry.name === repositoryName);
		if (!repository || !existsSync(repository.path) || !gitPathExists(repository.path, 'rebase-merge') && !gitPathExists(repository.path, 'rebase-apply')) continue;
		const branch = repository.branchName ?? journal.session.branchName;
		if (!branch) continue;
		try {
			const originalHead = runGit(repository.path, ['rev-parse', 'ORIG_HEAD']);
			const branchHead = runGit(repository.path, ['rev-parse', '--verify', `refs/heads/${branch}`]);
			if (originalHead !== branchHead) {
				blocked.push({ runId: journal.runId, repository: repositoryName, path: repository.path, branch, restoredRevision: originalHead, reason: 'ORIG_HEAD does not match the recorded task branch head' });
				continue;
			}
			runGit(repository.path, ['rebase', '--abort']);
			const restoredRevision = runGit(repository.path, ['rev-parse', 'HEAD']);
			if (currentBranch(repository.path) !== branch || restoredRevision !== originalHead) {
				blocked.push({ runId: journal.runId, repository: repositoryName, path: repository.path, branch, restoredRevision, reason: 'Git did not restore the recorded branch and revision' });
				continue;
			}
			recovered.push({ runId: journal.runId, repository: repositoryName, path: repository.path, branch, restoredRevision });
		} catch (error) {
			blocked.push({ runId: journal.runId, repository: repositoryName, path: repository.path, branch, restoredRevision: '', reason: error instanceof Error ? error.message : String(error) });
		}
	}
	return { recovered, blocked };
}
