import { Buffer } from 'node:buffer';
import {
	createGitHubApiClient,
	parseGitHubRepositorySlug,
	type GitHubApiClient,
	type GitHubWorkflowProgressEvent,
} from '../repositories/github-api.ts';
import { inspectCommand } from './resolve-remote-branch-head.ts';

export type GitHubActionsWorkflowState = 'success' | 'failure' | 'pending' | 'missing' | 'not_pushed' | 'error';

export type GitHubActionsVerificationTarget = {
	name: string;
	repoPath: string;
	repository: string | null;
	branch: string | null;
	headSha: string | null;
	workflows: string[];
	kind?: 'root' | 'package';
	missingIsFailure?: boolean;
};

export type GitHubActionsWorkflowGate = {
	name: string;
	repoPath: string;
	repository?: string;
	workflow: string;
	branch: string;
	headSha: string;
	timeoutSeconds?: number;
	pollSeconds?: number;
	dispatchIfMissing?: boolean;
	dispatchAfterSeconds?: number;
	dispatchInputs?: Record<string, string>;
};

export type GitHubActionsWorkflowJobStep = {
	name: string;
	number: number | null;
	status: string | null;
	conclusion: string | null;
	startedAt: string | null;
	completedAt: string | null;
};

export type GitHubActionsWorkflowJob = {
	id: number;
	name: string;
	status: string | null;
	conclusion: string | null;
	url: string | null;
	steps: GitHubActionsWorkflowJobStep[];
	failedSteps: GitHubActionsWorkflowJobStep[];
	logExcerpt?: string | null;
};

export type GitHubActionsWorkflowRunInspection = {
	workflow: string;
	state: GitHubActionsWorkflowState;
	status: string | null;
	conclusion: string | null;
	runId: number | null;
	url: string | null;
	headSha: string | null;
	branch: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	jobs: GitHubActionsWorkflowJob[];
	failedJobs: GitHubActionsWorkflowJob[];
	inspectCommand: string | null;
	message: string | null;
};

export type GitHubActionsRepositoryInspection = {
	name: string;
	repoPath: string;
	repository: string | null;
	kind: 'root' | 'package';
	branch: string | null;
	headSha: string | null;
	remoteHeadSha: string | null;
	remoteSynced: boolean;
	state: GitHubActionsWorkflowState;
	message: string | null;
	workflows: GitHubActionsWorkflowRunInspection[];
	missingIsFailure: boolean;
};

export type GitHubActionsVerificationFailure = {
	type: 'repository' | 'workflow' | 'job';
	repository: string | null;
	repoName: string;
	workflow: string | null;
	runId: number | null;
	jobId: number | null;
	jobName: string | null;
	state: GitHubActionsWorkflowState;
	conclusion: string | null;
	url: string | null;
	inspectCommand: string | null;
	message: string;
	failedSteps: GitHubActionsWorkflowJobStep[];
	logExcerpt?: string | null;
};

export type GitHubActionsVerificationSummary = {
	repositories: number;
	workflows: number;
	success: number;
	failure: number;
	pending: number;
	missing: number;
	notPushed: number;
	error: number;
	failures: number;
};

export type GitHubActionsVerificationReport = {
	checkedAt: string;
	repositories: GitHubActionsRepositoryInspection[];
	failures: GitHubActionsVerificationFailure[];
	summary: GitHubActionsVerificationSummary;
};

export type GitHubActionsVerificationOptions = {
	client?: GitHubApiClient;
	includeLogs?: boolean;
	logLines?: number;
};

export type GitHubWorkflowRunSummary = {
	id: number;
	status: string | null;
	conclusion: string | null;
	url: string | null;
	headSha: string | null;
	headBranch: string | null;
	createdAt: string | null;
	updatedAt: string | null;
};

export function normalizeWorkflowRun(run: Record<string, any>): GitHubWorkflowRunSummary {
	return {
		id: Number(run.id ?? 0),
		status: typeof run.status === 'string' ? run.status : null,
		conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
		url: typeof run.html_url === 'string' ? run.html_url : null,
		headSha: typeof run.head_sha === 'string' ? run.head_sha : null,
		headBranch: typeof run.head_branch === 'string' ? run.head_branch : null,
		createdAt: typeof run.created_at === 'string' ? run.created_at : null,
		updatedAt: typeof run.updated_at === 'string' ? run.updated_at : null,
	};
}

export function normalizeWorkflowJobStep(step: Record<string, any>): GitHubActionsWorkflowJobStep {
	return {
		name: String(step.name ?? ''),
		number: typeof step.number === 'number' ? step.number : null,
		status: typeof step.status === 'string' ? step.status : null,
		conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
		startedAt: typeof step.started_at === 'string' ? step.started_at : null,
		completedAt: typeof step.completed_at === 'string' ? step.completed_at : null,
	};
}

export function isSuccessfulConclusion(conclusion: string | null | undefined) {
	return conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral';
}

export function isFailedConclusion(conclusion: string | null | undefined) {
	return Boolean(conclusion && !isSuccessfulConclusion(conclusion));
}

export function normalizeWorkflowJob(job: Record<string, any>): GitHubActionsWorkflowJob {
	const steps = Array.isArray(job.steps)
		? job.steps.map((step) => normalizeWorkflowJobStep(step as Record<string, any>))
		: [];
	return {
		id: Number(job.id ?? 0),
		name: String(job.name ?? ''),
		status: typeof job.status === 'string' ? job.status : null,
		conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
		url: typeof job.html_url === 'string' ? job.html_url : null,
		steps,
		failedSteps: steps.filter((step) => isFailedConclusion(step.conclusion)),
	};
}

export function workflowStateForRun(run: GitHubWorkflowRunSummary | null) {
	if (!run) return 'missing' as const;
	if (run.status !== 'completed') return 'pending' as const;
	return isSuccessfulConclusion(run.conclusion) ? 'success' as const : 'failure' as const;
}

export function aggregateWorkflowState(states: GitHubActionsWorkflowState[]): GitHubActionsWorkflowState {
	if (states.includes('error')) return 'error';
	if (states.includes('not_pushed')) return 'not_pushed';
	if (states.includes('failure')) return 'failure';
	if (states.includes('missing')) return 'missing';
	if (states.includes('pending')) return 'pending';
	return 'success';
}

export function cappedLogExcerpt(value: unknown, maxLines: number) {
	const text = typeof value === 'string'
		? value
		: value instanceof Uint8Array
			? Buffer.from(value).toString('utf8')
			: Buffer.isBuffer(value)
				? value.toString('utf8')
				: String(value ?? '');
	const lines = text.split(/\r?\n/u);
	return lines.slice(Math.max(0, lines.length - maxLines)).join('\n').trim();
}

export async function downloadJobLogExcerpt(
	client: GitHubApiClient,
	repository: string,
	jobId: number,
	maxLines: number,
) {
	const { owner, name } = parseGitHubRepositorySlug(repository);
	const response = await client.request('GET /repos/{owner}/{repo}/actions/jobs/{job_id}/logs', {
		owner,
		repo: name,
		job_id: jobId,
	} as any);
	return cappedLogExcerpt((response as Record<string, any>).data, maxLines);
}

export async function loadWorkflowJobs(
	client: GitHubApiClient,
	repository: string,
	runId: number,
	options: { includeLogs: boolean; logLines: number },
) {
	const { owner, name } = parseGitHubRepositorySlug(repository);
	const jobs = await client.rest.actions.listJobsForWorkflowRun({
		owner,
		repo: name,
		run_id: runId,
		per_page: 100,
	});
	const normalized = jobs.data.jobs.map((job) => normalizeWorkflowJob(job as Record<string, any>));
	if (!options.includeLogs) {
		return normalized;
	}
	await Promise.all(normalized.filter((job) => isFailedConclusion(job.conclusion) && job.id > 0).map(async (job) => {
		try {
			job.logExcerpt = await downloadJobLogExcerpt(client, repository, job.id, options.logLines);
		} catch (error) {
			job.logExcerpt = `Unable to fetch job log: ${error instanceof Error ? error.message : String(error)}`;
		}
	}));
	return normalized;
}
