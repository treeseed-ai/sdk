import { Buffer } from 'node:buffer';
import {
	createGitHubApiClient,
	parseGitHubRepositorySlug,
	type GitHubApiClient,
	type GitHubWorkflowProgressEvent,
} from './github-api.ts';

export type GitHubActionsWorkflowState = 'success' | 'failure' | 'pending' | 'missing' | 'not_pushed' | 'error';

export type GitHubActionsVerificationTarget = {
	name: string;
	repoPath: string;
	repository: string | null;
	branch: string | null;
	headSha: string | null;
	workflows: string[];
	kind?: 'root' | 'package';
};

export type GitHubActionsWorkflowGate = {
	name: string;
	repoPath: string;
	repository?: string;
	workflow: string;
	branch: string;
	headSha: string;
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

type GitHubActionsVerificationOptions = {
	client?: GitHubApiClient;
	includeLogs?: boolean;
	logLines?: number;
};

type GitHubWorkflowRunSummary = {
	id: number;
	status: string | null;
	conclusion: string | null;
	url: string | null;
	headSha: string | null;
	headBranch: string | null;
	createdAt: string | null;
	updatedAt: string | null;
};

function normalizeWorkflowRun(run: Record<string, any>): GitHubWorkflowRunSummary {
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

function normalizeWorkflowJobStep(step: Record<string, any>): GitHubActionsWorkflowJobStep {
	return {
		name: String(step.name ?? ''),
		number: typeof step.number === 'number' ? step.number : null,
		status: typeof step.status === 'string' ? step.status : null,
		conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
		startedAt: typeof step.started_at === 'string' ? step.started_at : null,
		completedAt: typeof step.completed_at === 'string' ? step.completed_at : null,
	};
}

function isSuccessfulConclusion(conclusion: string | null | undefined) {
	return conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral';
}

function isFailedConclusion(conclusion: string | null | undefined) {
	return Boolean(conclusion && !isSuccessfulConclusion(conclusion));
}

function normalizeWorkflowJob(job: Record<string, any>): GitHubActionsWorkflowJob {
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

function workflowStateForRun(run: GitHubWorkflowRunSummary | null) {
	if (!run) return 'missing' as const;
	if (run.status !== 'completed') return 'pending' as const;
	return isSuccessfulConclusion(run.conclusion) ? 'success' as const : 'failure' as const;
}

function aggregateWorkflowState(states: GitHubActionsWorkflowState[]): GitHubActionsWorkflowState {
	if (states.includes('error')) return 'error';
	if (states.includes('not_pushed')) return 'not_pushed';
	if (states.includes('failure')) return 'failure';
	if (states.includes('missing')) return 'missing';
	if (states.includes('pending')) return 'pending';
	return 'success';
}

function cappedLogExcerpt(value: unknown, maxLines: number) {
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

async function downloadJobLogExcerpt(
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

async function loadWorkflowJobs(
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

async function resolveRemoteBranchHead(
	client: GitHubApiClient,
	repository: string,
	branch: string,
) {
	const { owner, name } = parseGitHubRepositorySlug(repository);
	const remote = await client.rest.repos.getBranch({
		owner,
		repo: name,
		branch,
	});
	return remote.data.commit.sha;
}

async function findWorkflowRun(
	client: GitHubApiClient,
	repository: string,
	workflow: string,
	branch: string | null,
	headSha: string | null,
) {
	const { owner, name } = parseGitHubRepositorySlug(repository);
	const listed = await client.rest.actions.listWorkflowRuns({
		owner,
		repo: name,
		workflow_id: workflow,
		branch: branch ?? undefined,
		head_sha: headSha ?? undefined,
		per_page: 20,
	} as any);
	const runs = listed.data.workflow_runs
		.map((run) => normalizeWorkflowRun(run as Record<string, any>))
		.filter((run) => (!headSha || run.headSha === headSha) && (!branch || run.headBranch === branch));
	return runs[0] ?? null;
}

function inspectCommand(repository: string | null, runId: number | null) {
	return repository && runId ? `gh run view ${runId} --repo ${repository} --log-failed` : null;
}

function workflowMessage(workflow: string, state: GitHubActionsWorkflowState, conclusion: string | null) {
	switch (state) {
		case 'success':
			return `${workflow} completed successfully.`;
		case 'failure':
			return `${workflow} completed with conclusion ${conclusion ?? 'unknown'}.`;
		case 'pending':
			return `${workflow} is still running or queued.`;
		case 'missing':
			return `${workflow} has no run for this branch HEAD.`;
		case 'not_pushed':
			return `${workflow} cannot be checked because the local HEAD is not the remote branch HEAD.`;
		case 'error':
			return `${workflow} could not be inspected.`;
	}
}

function isGitHubNotFoundError(error: unknown) {
	const status = typeof (error as { status?: unknown })?.status === 'number'
		? Number((error as { status: number }).status)
		: null;
	const message = error instanceof Error ? error.message : String(error ?? '');
	return status === 404 || /not found/iu.test(message);
}

async function inspectWorkflow(
	client: GitHubApiClient,
	target: GitHubActionsVerificationTarget,
	workflow: string,
	options: { includeLogs: boolean; logLines: number },
): Promise<GitHubActionsWorkflowRunInspection> {
	if (!target.repository || !target.branch || !target.headSha) {
		return {
			workflow,
			state: 'error',
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
			message: 'Repository, branch, or head SHA is unavailable.',
		};
	}

	try {
		const run = await findWorkflowRun(client, target.repository, workflow, target.branch, target.headSha);
		const state = workflowStateForRun(run);
		const jobs = run?.id && run.status === 'completed'
			? await loadWorkflowJobs(client, target.repository, run.id, options)
			: [];
		const failedJobs = jobs.filter((job) => isFailedConclusion(job.conclusion));
		return {
			workflow,
			state,
			status: run?.status ?? null,
			conclusion: run?.conclusion ?? null,
			runId: run?.id ?? null,
			url: run?.url ?? null,
			headSha: run?.headSha ?? target.headSha,
			branch: run?.headBranch ?? target.branch,
			createdAt: run?.createdAt ?? null,
			updatedAt: run?.updatedAt ?? null,
			jobs,
			failedJobs,
			inspectCommand: inspectCommand(target.repository, run?.id ?? null),
			message: workflowMessage(workflow, state, run?.conclusion ?? null),
		};
	} catch (error) {
		if (isGitHubNotFoundError(error)) {
			return {
				workflow,
				state: 'missing',
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
				message: `${workflow} is missing or has no run for this branch HEAD.`,
			};
		}
		return {
			workflow,
			state: 'error',
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
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function repositoryFailure(target: GitHubActionsRepositoryInspection): GitHubActionsVerificationFailure {
	return {
		type: 'repository',
		repository: target.repository,
		repoName: target.name,
		workflow: null,
		runId: null,
		jobId: null,
		jobName: null,
		state: target.state,
		conclusion: null,
		url: null,
		inspectCommand: null,
		message: target.message ?? `${target.name} requires attention.`,
		failedSteps: [],
	};
}

function workflowFailure(
	repo: GitHubActionsRepositoryInspection,
	workflow: GitHubActionsWorkflowRunInspection,
): GitHubActionsVerificationFailure {
	return {
		type: 'workflow',
		repository: repo.repository,
		repoName: repo.name,
		workflow: workflow.workflow,
		runId: workflow.runId,
		jobId: null,
		jobName: null,
		state: workflow.state,
		conclusion: workflow.conclusion,
		url: workflow.url,
		inspectCommand: workflow.inspectCommand,
		message: workflow.message ?? `${repo.name} ${workflow.workflow} requires attention.`,
		failedSteps: [],
	};
}

function jobFailure(
	repo: GitHubActionsRepositoryInspection,
	workflow: GitHubActionsWorkflowRunInspection,
	job: GitHubActionsWorkflowJob,
): GitHubActionsVerificationFailure {
	return {
		type: 'job',
		repository: repo.repository,
		repoName: repo.name,
		workflow: workflow.workflow,
		runId: workflow.runId,
		jobId: job.id,
		jobName: job.name,
		state: workflow.state,
		conclusion: job.conclusion,
		url: job.url ?? workflow.url,
		inspectCommand: workflow.inspectCommand,
		message: `${repo.name} ${workflow.workflow} job ${job.name || job.id} completed with conclusion ${job.conclusion ?? 'unknown'}.`,
		failedSteps: job.failedSteps,
		logExcerpt: job.logExcerpt ?? null,
	};
}

function collectFailures(repositories: GitHubActionsRepositoryInspection[]) {
	const failures: GitHubActionsVerificationFailure[] = [];
	for (const repo of repositories) {
		if (repo.state === 'not_pushed' || repo.state === 'error') {
			failures.push(repositoryFailure(repo));
			continue;
		}
		for (const workflow of repo.workflows) {
			if (workflow.state === 'failure' && workflow.failedJobs.length > 0) {
				failures.push(...workflow.failedJobs.map((job) => jobFailure(repo, workflow, job)));
				continue;
			}
			if (workflow.state === 'failure' || workflow.state === 'missing' || workflow.state === 'error') {
				failures.push(workflowFailure(repo, workflow));
			}
		}
	}
	return failures;
}

function summarize(repositories: GitHubActionsRepositoryInspection[], failures: GitHubActionsVerificationFailure[]): GitHubActionsVerificationSummary {
	const workflows = repositories.flatMap((repo) => repo.workflows);
	return {
		repositories: repositories.length,
		workflows: workflows.length,
		success: workflows.filter((workflow) => workflow.state === 'success').length,
		failure: workflows.filter((workflow) => workflow.state === 'failure').length,
		pending: workflows.filter((workflow) => workflow.state === 'pending').length,
		missing: workflows.filter((workflow) => workflow.state === 'missing').length,
		notPushed: repositories.filter((repo) => repo.state === 'not_pushed').length,
		error: workflows.filter((workflow) => workflow.state === 'error').length + repositories.filter((repo) => repo.state === 'error').length,
		failures: failures.length,
	};
}

async function inspectTarget(
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
		};
	}
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

function formatElapsed(seconds: number) {
	const safe = Math.max(0, Math.round(seconds));
	if (safe < 60) return `${safe}s`;
	const minutes = Math.floor(safe / 60);
	const remainder = safe % 60;
	return remainder === 0 ? `${minutes}m` : `${minutes}m${remainder}s`;
}

function shortSha(value: string | null | undefined) {
	return value ? value.slice(0, 12) : '(unknown)';
}

function formatGitHubActionsGateProgress(
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
		return `${prefix} completed ${conclusion} in ${formatElapsed(event.elapsedSeconds)}${url}`;
	}
	const status = event.status ?? 'waiting';
	const url = event.url ? `: ${event.url}` : '';
	const run = event.runId ? ` run ${event.runId}` : '';
	return `${prefix}${run} ${status}${url} (${formatElapsed(event.elapsedSeconds)} elapsed)`;
}

export async function waitForGitHubActionsGate(
	gate: GitHubActionsWorkflowGate,
	options: {
		timeoutSeconds?: number;
		pollSeconds?: number;
		operation?: string;
		onProgress?: (message: string, stream?: 'stdout' | 'stderr') => void;
	} = {},
) {
	const { waitForGitHubWorkflowCompletion } = await import('./github-automation.ts');
	return await waitForGitHubWorkflowCompletion(gate.repoPath, {
		repository: gate.repository,
		workflow: gate.workflow,
		headSha: gate.headSha,
		branch: gate.branch,
		timeoutSeconds: options.timeoutSeconds,
		pollSeconds: options.pollSeconds,
		onProgress: (event: GitHubWorkflowProgressEvent) => {
			options.onProgress?.(formatGitHubActionsGateProgress(gate, event, options.operation ?? 'workflow'));
		},
	}) as Record<string, unknown>;
}
