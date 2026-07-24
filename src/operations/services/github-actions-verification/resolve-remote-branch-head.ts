import { Buffer } from 'node:buffer';
import {
	createGitHubApiClient,
	parseGitHubRepositorySlug,
	type GitHubApiClient,
	type GitHubWorkflowProgressEvent,
} from '../repositories/github-api.ts';
import { GitHubActionsRepositoryInspection, GitHubActionsVerificationFailure, GitHubActionsVerificationSummary, GitHubActionsVerificationTarget, GitHubActionsWorkflowJob, GitHubActionsWorkflowRunInspection, GitHubActionsWorkflowState, isFailedConclusion, loadWorkflowJobs, normalizeWorkflowRun, workflowStateForRun } from './git-hub-actions-workflow-state.ts';

export async function resolveRemoteBranchHead(
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

export async function findWorkflowRun(
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

export function inspectCommand(repository: string | null, runId: number | null) {
	return repository && runId ? `gh run view ${runId} --repo ${repository} --log-failed` : null;
}

export function workflowMessage(workflow: string, state: GitHubActionsWorkflowState, conclusion: string | null) {
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

export function isGitHubNotFoundError(error: unknown) {
	const status = typeof (error as { status?: unknown })?.status === 'number'
		? Number((error as { status: number }).status)
		: null;
	const message = error instanceof Error ? error.message : String(error ?? '');
	return status === 404 || /not found/iu.test(message);
}

export async function inspectWorkflow(
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

export function repositoryFailure(target: GitHubActionsRepositoryInspection): GitHubActionsVerificationFailure {
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

export function workflowFailure(
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

export function jobFailure(
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

export function collectFailures(repositories: GitHubActionsRepositoryInspection[]) {
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
			if (workflow.state === 'missing' && !repo.missingIsFailure) {
				continue;
			}
			if (workflow.state === 'failure' || workflow.state === 'missing' || workflow.state === 'error') {
				failures.push(workflowFailure(repo, workflow));
			}
		}
	}
	return failures;
}

export function summarize(repositories: GitHubActionsRepositoryInspection[], failures: GitHubActionsVerificationFailure[]): GitHubActionsVerificationSummary {
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
