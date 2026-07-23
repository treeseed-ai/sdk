import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Octokit } from 'octokit';
import { createTreeseedManagedToolEnv, resolveTreeseedToolBinary } from '../../../managed-dependencies.ts';
import { resolveTreeseedGitHubToken } from '../../../service-credentials.ts';
import { GitHubApiClient, GitHubWorkflowCancellationResult, GitHubWorkflowDispatchResult, GitHubWorkflowFailureSummary, GitHubWorkflowFailureSummaryInput, GitHubWorkflowFileStatus, GitHubWorkflowJobSummary, GitHubWorkflowRunSummary, normalizeGitHubApiError, parseGitHubRepositorySlug, resolveGitHubApiToken } from './require.ts';
import { createGitHubApiClient } from './create-git-hub-api-client.ts';

export function upsertGitHubRepositoryVariableWithGhCli(
	repository: string | { owner: string; name: string },
	name: string,
	value: string,
	{
		env = process.env,
	}: {
		env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
	} = {},
) {
	const token = resolveGitHubApiToken(env);
	if (!token) {
		throw new Error('Configure TREESEED_GITHUB_TOKEN before using Treeseed GitHub automation.');
	}
	const { owner, name: repo } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const ghEnv = {
		...process.env,
		...env,
		GH_TOKEN: token,
		GITHUB_TOKEN: token,
	};
	const gh = resolveTreeseedToolBinary('gh', { env: ghEnv });
	if (!gh) {
		throw new Error('GitHub CLI `gh` is unavailable.');
	}
	const create = spawnSync(
		gh,
		[
			'api',
			`repos/${owner}/${repo}/actions/variables`,
			'--method',
			'POST',
			'-f',
			`name=${name}`,
			'-f',
			`value=${value}`,
		],
		{ encoding: 'utf8', env: createTreeseedManagedToolEnv(ghEnv) },
	);
	if (create.status === 0) {
		return;
	}
	const combinedCreateOutput = `${create.stdout ?? ''}\n${create.stderr ?? ''}`.trim();
	if (!/already exists|HTTP 409|HTTP 422/iu.test(combinedCreateOutput)) {
		throw new Error(combinedCreateOutput || `gh api exited with status ${create.status ?? 1}`);
	}
	const update = spawnSync(
		gh,
		[
			'api',
			`repos/${owner}/${repo}/actions/variables/${name}`,
			'--method',
			'PATCH',
			'-f',
			`name=${name}`,
			'-f',
			`value=${value}`,
		],
		{ encoding: 'utf8', env: createTreeseedManagedToolEnv(ghEnv) },
	);
	if (update.status === 0) {
		return;
	}
	const combinedUpdateOutput = `${update.stdout ?? ''}\n${update.stderr ?? ''}`.trim();
	throw new Error(combinedUpdateOutput || `gh api exited with status ${update.status ?? 1}`);
}

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

export function normalizeWorkflowJob(job: Record<string, any>): GitHubWorkflowJobSummary {
	return {
		id: Number(job.id ?? 0),
		name: String(job.name ?? ''),
		status: typeof job.status === 'string' ? job.status : null,
		conclusion: typeof job.conclusion === 'string' ? job.conclusion : null,
		url: typeof job.html_url === 'string' ? job.html_url : null,
		steps: Array.isArray(job.steps)
			? job.steps.map((step: Record<string, any>) => ({
				name: String(step.name ?? ''),
				status: typeof step.status === 'string' ? step.status : null,
				conclusion: typeof step.conclusion === 'string' ? step.conclusion : null,
			}))
			: [],
	};
}

export function workflowInspectCommand(repository: string | null, runId: number | null) {
	return repository && runId ? `gh run view ${runId} --repo ${repository} --log-failed` : null;
}

export function formatGitHubWorkflowFailure(input: GitHubWorkflowFailureSummaryInput = {}): GitHubWorkflowFailureSummary {
	const repository = typeof input.repository === 'string' && input.repository.trim() ? input.repository.trim() : null;
	const workflow = typeof input.workflow === 'string' && input.workflow.trim() ? input.workflow.trim() : null;
	const numericRunId = Number(input.runId);
	const runId = Number.isFinite(numericRunId) && numericRunId > 0 ? numericRunId : null;
	const runUrl = typeof input.runUrl === 'string' && input.runUrl.trim() ? input.runUrl.trim() : null;
	const conclusion = typeof input.conclusion === 'string' && input.conclusion.trim() ? input.conclusion.trim() : null;
	const failedJobName = typeof input.failedJobName === 'string' && input.failedJobName.trim() ? input.failedJobName.trim() : null;
	const lastActiveStep = typeof input.lastActiveStep === 'string' && input.lastActiveStep.trim() ? input.lastActiveStep.trim() : null;
	const blockerCode = typeof input.blockerCode === 'string' && input.blockerCode.trim()
		? input.blockerCode.trim()
		: conclusion === 'cancelled'
			? 'github_workflow_cancelled'
			: conclusion === 'timed_out'
				? 'github_workflow_timed_out'
				: 'github_workflow_failed';
	const detail = failedJobName
		? ` Failed job: ${failedJobName}.`
		: lastActiveStep
			? ` Last active step: ${lastActiveStep}.`
			: '';
	const summary = typeof input.message === 'string' && input.message.trim()
		? input.message.trim()
		: `${workflow ?? 'GitHub workflow'} ${conclusion ? `completed with conclusion ${conclusion}` : 'failed'}.${detail}`;
	return {
		summary,
		provider: 'github',
		repository,
		workflow,
		runId,
		runUrl,
		inspectCommand: workflowInspectCommand(repository, runId),
		failedJobName,
		lastActiveStep,
		conclusion,
		retrySafe: input.retrySafe ?? true,
		resumeSafe: input.resumeSafe ?? false,
		blockerCode,
	};
}

export async function dispatchGitHubWorkflowRun(
	repository: string | { owner: string; name: string },
	{
		client = createGitHubApiClient(),
		workflow = 'deploy-web.yml',
		branch,
		inputs,
	}: {
		client?: GitHubApiClient;
		workflow?: string;
		branch: string;
		inputs?: Record<string, string>;
	},
): Promise<GitHubWorkflowDispatchResult> {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const result = await client.rest.actions.createWorkflowDispatch({
			owner,
			repo: name,
			workflow_id: workflow,
			ref: branch,
			inputs,
		});
		return {
			repository: `${owner}/${name}`,
			workflow,
			branch,
			inputs,
			status: typeof result.status === 'number' ? result.status : null,
			dispatchedAt: new Date().toISOString(),
		};
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to dispatch GitHub workflow ${workflow} in ${owner}/${name}`);
	}
}

export async function cancelGitHubWorkflowRun(
	repository: string | { owner: string; name: string } | null | undefined,
	runId: number | string | null | undefined,
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
): Promise<GitHubWorkflowCancellationResult> {
	if (!repository || !runId) {
		return {
			ok: false,
			supported: false,
			repository: typeof repository === 'string' ? repository : null,
			runId: null,
			message: 'GitHub workflow cancellation requires a repository and run id.',
		};
	}
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const numericRunId = Number(runId);
	if (!Number.isFinite(numericRunId) || numericRunId <= 0) {
		return {
			ok: false,
			supported: false,
			repository: `${owner}/${name}`,
			runId: null,
			message: 'GitHub workflow cancellation requires a numeric run id.',
		};
	}
	try {
		await client.rest.actions.cancelWorkflowRun({
			owner,
			repo: name,
			run_id: numericRunId,
		});
		return {
			ok: true,
			supported: true,
			repository: `${owner}/${name}`,
			runId: numericRunId,
			url: `https://github.com/${owner}/${name}/actions/runs/${numericRunId}`,
			message: 'GitHub workflow cancellation requested.',
			cancelledAt: new Date().toISOString(),
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error ?? '');
		if (/not supported|not found|404/iu.test(message)) {
			return {
				ok: false,
				supported: false,
				repository: `${owner}/${name}`,
				runId: numericRunId,
				message: 'GitHub workflow cancellation is not supported for this run.',
			};
		}
		throw normalizeGitHubApiError(error, `Unable to cancel GitHub workflow run ${numericRunId} in ${owner}/${name}`);
	}
}

export async function getGitHubWorkflowFileStatus(
	repository: string | { owner: string; name: string },
	workflow = 'deploy-web.yml',
	{ client = createGitHubApiClient() }: { client?: GitHubApiClient } = {},
): Promise<GitHubWorkflowFileStatus> {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const normalizedWorkflow = workflow.replace(/^\.github\/workflows\//u, '');
	const path = `.github/workflows/${normalizedWorkflow}`;
	try {
		const result = await client.rest.repos.getContent({
			owner,
			repo: name,
			path,
		});
		const data = result.data as Record<string, any>;
		return {
			ok: true,
			exists: true,
			repository: `${owner}/${name}`,
			workflow: normalizedWorkflow,
			url: typeof data.html_url === 'string' ? data.html_url : `https://github.com/${owner}/${name}/blob/HEAD/${path}`,
			message: `${normalizedWorkflow} is present.`,
		};
	} catch (error) {
		const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : null;
		if (status === 404) {
			return {
				ok: true,
				exists: false,
				repository: `${owner}/${name}`,
				workflow: normalizedWorkflow,
				url: null,
				message: `${normalizedWorkflow} is missing from ${owner}/${name}.`,
			};
		}
		throw normalizeGitHubApiError(error, `Unable to inspect GitHub workflow file ${path} in ${owner}/${name}`);
	}
}
