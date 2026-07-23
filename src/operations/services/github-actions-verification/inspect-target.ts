import { Buffer } from 'node:buffer';
import {
	createGitHubApiClient,
	parseGitHubRepositorySlug,
	type GitHubApiClient,
	type GitHubWorkflowProgressEvent,
} from '../github-api.ts';
import { GitHubActionsRepositoryInspection, GitHubActionsVerificationOptions, GitHubActionsVerificationReport, GitHubActionsVerificationTarget, GitHubActionsWorkflowGate, aggregateWorkflowState } from './git-hub-actions-workflow-state.ts';
import { collectFailures, inspectCommand, inspectWorkflow, resolveRemoteBranchHead, summarize, workflowMessage } from './resolve-remote-branch-head.ts';

export async function inspectTarget(
	client: GitHubApiClient,
	target: GitHubActionsVerificationTarget,
	options: { includeLogs: boolean; logLines: number },
): Promise<GitHubActionsRepositoryInspection> {
	if (!target.repository || !target.branch || !target.headSha) {
		return {
			name: target.name,
			repoPath: target.repoPath,
			repository: target.repository,
			kind: target.kind ?? 'package',
			branch: target.branch,
			headSha: target.headSha,
			remoteHeadSha: null,
			remoteSynced: false,
			state: 'error',
			message: 'Repository, branch, or head SHA is unavailable.',
			workflows: [],
			missingIsFailure: target.missingIsFailure ?? true,
		};
	}
	const missingIsFailure = target.missingIsFailure ?? true;
	try {
		const remoteHeadSha = await resolveRemoteBranchHead(client, target.repository, target.branch);
		if (remoteHeadSha !== target.headSha) {
			return {
				name: target.name,
				repoPath: target.repoPath,
				repository: target.repository,
				kind: target.kind ?? 'package',
				branch: target.branch,
				headSha: target.headSha,
				remoteHeadSha,
				remoteSynced: false,
				state: 'not_pushed',
				message: `Local HEAD ${target.headSha.slice(0, 12)} does not match origin/${target.branch} ${remoteHeadSha.slice(0, 12)}.`,
				missingIsFailure,
				workflows: target.workflows.map((workflow) => ({
					workflow,
					state: 'not_pushed',
					status: null,
					conclusion: null,
					runId: null,
					url: null,
					headSha: target.headSha,
					branch: target.branch,
					createdAt: null,
					updatedAt: null,
					jobs: [],
					failedJobs: [],
					inspectCommand: null,
					message: workflowMessage(workflow, 'not_pushed', null),
				})),
			};
		}
		const workflows = await Promise.all(target.workflows.map((workflow) => inspectWorkflow(client, target, workflow, options)));
		return {
			name: target.name,
			repoPath: target.repoPath,
			repository: target.repository,
			kind: target.kind ?? 'package',
			branch: target.branch,
			headSha: target.headSha,
			remoteHeadSha,
			remoteSynced: true,
			state: aggregateWorkflowState(workflows.map((workflow) => workflow.state)),
			message: null,
			workflows,
			missingIsFailure,
		};
	} catch (error) {
		return {
			name: target.name,
			repoPath: target.repoPath,
			repository: target.repository,
			kind: target.kind ?? 'package',
			branch: target.branch,
			headSha: target.headSha,
			remoteHeadSha: null,
			remoteSynced: false,
			state: 'error',
			message: error instanceof Error ? error.message : String(error),
			workflows: [],
			missingIsFailure,
		};
	}
}

export async function inspectGitHubActionsVerification(
	targets: GitHubActionsVerificationTarget[],
	{
		client = createGitHubApiClient(),
		includeLogs = false,
		logLines = 120,
	}: GitHubActionsVerificationOptions = {},
): Promise<GitHubActionsVerificationReport> {
	const resolvedLogLines = Math.max(20, Math.min(1000, Math.floor(logLines)));
	const repositories = await Promise.all(targets.map((target) => inspectTarget(client, target, {
		includeLogs,
		logLines: resolvedLogLines,
	})));
	const failures = collectFailures(repositories);
	return {
		checkedAt: new Date().toISOString(),
		repositories,
		failures,
		summary: summarize(repositories, failures),
	};
}

export function skippedGitHubActionsGate(gate: GitHubActionsWorkflowGate, reason: string) {
	return {
		name: gate.name,
		repository: gate.repository ?? null,
		workflow: gate.workflow,
		branch: gate.branch,
		headSha: gate.headSha,
		status: 'skipped',
		reason,
		conclusion: null,
		runId: null,
		url: null,
		createdAt: null,
		updatedAt: null,
		timeoutSeconds: gate.timeoutSeconds ?? null,
		cached: false,
	};
}

export function formatGitHubActionsGateFailure(gate: GitHubActionsWorkflowGate, result: Record<string, unknown>) {
	const repository = String(result.repository ?? gate.repository ?? gate.name);
	const runId = typeof result.runId === 'number' || typeof result.runId === 'string' ? String(result.runId) : '';
	const url = typeof result.url === 'string' && result.url ? `\n${result.url}` : '';
	const failedJobs = Array.isArray(result.failedJobs)
		? result.failedJobs
			.map((job) => typeof (job as Record<string, unknown>)?.name === 'string' ? String((job as Record<string, unknown>).name) : '')
			.filter(Boolean)
		: [];
	const jobLine = failedJobs.length > 0 ? `\nFailed jobs: ${failedJobs.join(', ')}` : '';
	const command = runId ? `\nInspect with: gh run view ${runId} --repo ${repository} --log-failed` : '';
	return `${gate.name} ${gate.workflow} completed with conclusion ${String(result.conclusion ?? 'unknown')} in ${repository}.${url}${jobLine}${command}`;
}

export function isRetryableGitHubActionsSetupFailure(result: Record<string, unknown>) {
	const failedJobs = Array.isArray(result.failedJobs) ? result.failedJobs as Array<Record<string, unknown>> : [];
	return failedJobs.length > 0 && failedJobs.every((job) => {
		const steps = Array.isArray(job.steps) ? job.steps as Array<Record<string, unknown>> : [];
		return steps.length === 1
			&& steps[0]?.name === 'Set up job'
			&& steps[0]?.conclusion === 'failure';
	});
}

export async function rerunGitHubActionsFailedJobs(
	result: Record<string, unknown>,
	env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
	const repository = String(result.repository ?? '');
	const runId = Number(result.runId);
	if (!repository || !Number.isSafeInteger(runId) || runId <= 0) {
		throw new Error('Cannot retry GitHub Actions setup failure without a repository and run ID.');
	}
	const { owner, name: repo } = parseGitHubRepositorySlug(repository);
	const client = createGitHubApiClient({ env });
	await client.request('POST /repos/{owner}/{repo}/actions/runs/{run_id}/rerun-failed-jobs', {
		owner,
		repo,
		run_id: runId,
	});
	return { repository, runId };
}

export function formatElapsed(seconds: number) {
	const safe = Math.max(0, Math.round(seconds));
	if (safe < 60) return `${safe}s`;
	const minutes = Math.floor(safe / 60);
	const remainder = safe % 60;
	return remainder === 0 ? `${minutes}m` : `${minutes}m${remainder}s`;
}

export function shortSha(value: string | null | undefined) {
	return value ? value.slice(0, 12) : '(unknown)';
}

export function activeJobSummaries(event: GitHubWorkflowProgressEvent) {
	const activeJobs = event.activeJobs ?? [];
	return activeJobs.slice(0, 2).map((job) => {
		const activeStep = (job.steps ?? []).find((step) => step.status && step.status !== 'completed');
		return activeStep?.name ? `${job.name} > ${activeStep.name}` : job.name;
	}).filter(Boolean);
}

export function activeJobSummary(event: GitHubWorkflowProgressEvent) {
	const summaries = activeJobSummaries(event);
	return summaries.length > 0 ? `; active: ${summaries.join(', ')}` : '';
}

export function failedJobSummary(event: GitHubWorkflowProgressEvent) {
	const failedJobs = event.failedJobs ?? [];
	if (failedJobs.length === 0) return '';
	const names = failedJobs.slice(0, 3).map((job) => job.name).filter(Boolean);
	return names.length > 0 ? `; failed: ${names.join(', ')}` : '';
}

export function formatGitHubActionsGateProgress(
	gate: GitHubActionsWorkflowGate,
	event: GitHubWorkflowProgressEvent,
	operation: string,
) {
	const prefix = `[${operation}][gate][${gate.name}] ${event.workflow}`;
	if (event.type === 'waiting') {
		return `${prefix} on ${event.branch ?? gate.branch}: waiting for run for ${shortSha(event.headSha ?? gate.headSha)} (${formatElapsed(event.elapsedSeconds)} elapsed)`;
	}
	if (event.type === 'completed') {
		const conclusion = event.conclusion === 'success' ? 'successfully' : `with conclusion ${event.conclusion ?? 'unknown'}`;
		const url = event.url ? `: ${event.url}` : '';
		return `${prefix} completed ${conclusion}${failedJobSummary(event)} in ${formatElapsed(event.elapsedSeconds)}${url}`;
	}
	const status = event.status ?? 'waiting';
	const url = event.url ? `: ${event.url}` : '';
	const run = event.runId ? ` run ${event.runId}` : '';
	return `${prefix}${run} ${status}${activeJobSummary(event)}${url} (${formatElapsed(event.elapsedSeconds)} elapsed)`;
}

export function progressCompactKey(gate: GitHubActionsWorkflowGate, event: GitHubWorkflowProgressEvent) {
	const active = activeJobSummaries(event).join(',');
	return [
		gate.name,
		event.workflow,
		event.runId ?? 'none',
		event.type,
		event.status ?? 'none',
		event.conclusion ?? 'none',
		active,
	].join('|');
}

export function formatCompactedGitHubActionsGateProgress(
	gate: GitHubActionsWorkflowGate,
	event: GitHubWorkflowProgressEvent,
	operation: string,
	repeatedPolls: number,
	lastChangeSeconds: number,
) {
	const prefix = `[${operation}][gate][${gate.name}] ${event.workflow}`;
	const run = event.runId ? ` run ${event.runId}` : '';
	const active = activeJobSummaries(event);
	const activeText = active.length > 0 ? active.join(', ') : event.status ?? 'waiting';
	const url = event.url ? `: ${event.url}` : '';
	return `${prefix}${run} still active: ${activeText} (${repeatedPolls} polls, ${formatElapsed(lastChangeSeconds)} since last change)${url}`;
}
