import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { Octokit } from 'octokit';
import { createManagedToolEnv, resolveToolBinary } from '../../../entrypoints/runtime/managed-dependencies.ts';
import { resolveGitHubToken } from '../../../configuration/service-credentials.ts';
import { createGitHubApiClient } from './create-git-hub-api-client.ts';
import { GitHubApiClient, GitHubWorkflowJobSummary, GitHubWorkflowProgressEvent, GitHubWorkflowRunSummary, normalizeGitHubApiError, parseGitHubRepositorySlug } from './require.ts';
import { normalizeWorkflowJob, normalizeWorkflowRun } from './upsert-git-hub-repository-variable-with-gh-cli.ts';

export async function getLatestGitHubWorkflowRun(
	repository: string | { owner: string; name: string },
	{
		client = createGitHubApiClient(),
		workflow = 'deploy-web.yml',
		branch,
	}: {
		client?: GitHubApiClient;
		workflow?: string;
		branch?: string | null;
	} = {},
): Promise<GitHubWorkflowRunSummary | null> {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const listed = await client.rest.actions.listWorkflowRuns({
			owner,
			repo: name,
			workflow_id: workflow,
			...(branch ? { branch } : {}),
			per_page: 1,
		});
		const run = listed.data.workflow_runs[0] ?? null;
		return run ? normalizeWorkflowRun(run as Record<string, any>) : null;
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to inspect latest GitHub workflow run ${workflow} in ${owner}/${name}`);
	}
}

export async function listWorkflowJobsForProgress(client: GitHubApiClient, owner: string, repo: string, runId: number) {
	try {
		const jobs = await client.rest.actions.listJobsForWorkflowRun({
			owner,
			repo,
			run_id: runId,
			per_page: 100,
		});
		return jobs.data.jobs.map((job) => normalizeWorkflowJob(job as Record<string, any>));
	} catch {
		return [];
	}
}

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForGitHubWorkflowRunCompletion(
	repository: string | { owner: string; name: string },
	{
		client = createGitHubApiClient(),
		workflow = 'publish.yml',
		headSha,
		branch,
		timeoutSeconds = 600,
		pollSeconds = 5,
		dispatchIfMissing = false,
		dispatchAfterSeconds = 60,
		dispatchInputs,
		onProgress,
	}: {
		client?: GitHubApiClient;
		workflow?: string;
		headSha?: string | null;
		branch?: string | null;
		timeoutSeconds?: number;
		pollSeconds?: number;
		dispatchIfMissing?: boolean;
		dispatchAfterSeconds?: number;
		dispatchInputs?: Record<string, string>;
		onProgress?: (event: GitHubWorkflowProgressEvent) => void;
	} = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	const startedAt = Date.now();
	let dispatchedMissingRun = false;
	let lastProgress: GitHubWorkflowProgressEvent | null = null;
	let monitorErrorStartedAt: number | null = null;
	let lastMonitorError: Error | null = null;
	const emitProgress = (type: GitHubWorkflowProgressEvent['type'], run: GitHubWorkflowRunSummary | null = null, jobs: GitHubWorkflowJobSummary[] = []) => {
		const completedJobs = jobs.filter((job) => job.status === 'completed');
		const failedJobs = jobs.filter((job) => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped');
		const activeJobs = jobs.filter((job) => job.status && job.status !== 'completed');
		const event: GitHubWorkflowProgressEvent = {
			type,
			repository: `${owner}/${name}`,
			workflow,
			branch: run?.headBranch ?? branch ?? null,
			headSha: run?.headSha ?? headSha ?? null,
			elapsedSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
			runId: run?.id ?? null,
			url: run?.url ?? null,
			status: run?.status ?? null,
			conclusion: run?.conclusion ?? null,
			jobs,
			activeJobs,
			completedJobs,
			failedJobs,
		};
		lastProgress = event;
		onProgress?.(event);
	};
	while ((Date.now() - startedAt) < timeoutSeconds * 1000) {
		try {
			const listed = await client.rest.actions.listWorkflowRuns({
				owner,
				repo: name,
				workflow_id: workflow,
				per_page: 20,
			});
			monitorErrorStartedAt = null;
			lastMonitorError = null;
			const matchingRuns = listed.data.workflow_runs
				.map((run) => normalizeWorkflowRun(run as Record<string, any>))
				.filter((run) => (!headSha || run.headSha === headSha) && (!branch || run.headBranch === branch));
			const match = matchingRuns[0];
			if (!match?.id) {
				emitProgress('waiting');
				if (dispatchIfMissing && branch && !dispatchedMissingRun && (Date.now() - startedAt) >= dispatchAfterSeconds * 1000) {
					try {
						await client.rest.actions.createWorkflowDispatch({
							owner,
							repo: name,
							workflow_id: workflow,
							ref: branch,
							inputs: dispatchInputs,
						});
						dispatchedMissingRun = true;
					} catch (error) {
						throw normalizeGitHubApiError(error, `Unable to dispatch GitHub workflow ${workflow} in ${owner}/${name}`);
					}
				}
				await sleep(pollSeconds * 1000);
				continue;
			}
			for (;;) {
				if ((Date.now() - startedAt) >= timeoutSeconds * 1000 && lastProgress?.runId === match.id) {
					break;
				}
				const current = await client.rest.actions.getWorkflowRun({
					owner,
					repo: name,
					run_id: match.id,
				});
				monitorErrorStartedAt = null;
				lastMonitorError = null;
				const normalized = normalizeWorkflowRun(current.data as Record<string, any>);
				const progressJobs = await listWorkflowJobsForProgress(client, owner, name, match.id);
				if (normalized.status === 'completed') {
					const normalizedJobs = progressJobs;
					emitProgress('completed', normalized, normalizedJobs);
					return {
						status: 'completed',
						repository: `${owner}/${name}`,
						workflow,
						runId: normalized.id,
						headSha: normalized.headSha,
						branch: normalized.headBranch,
						createdAt: normalized.createdAt,
						updatedAt: normalized.updatedAt,
						conclusion: normalized.conclusion,
						url: normalized.url,
						jobs: normalizedJobs,
						failedJobs: normalizedJobs.filter((job) => job.conclusion && job.conclusion !== 'success' && job.conclusion !== 'skipped'),
					};
				}
				emitProgress('running', normalized, progressJobs);
				await sleep(pollSeconds * 1000);
			}
		} catch (error) {
			const normalizedError = normalizeGitHubApiError(error, `Unable to monitor GitHub workflow ${workflow} in ${owner}/${name}`);
			lastMonitorError = normalizedError;
			monitorErrorStartedAt ??= Date.now();
			const toleratedMonitorErrorSeconds = Math.max(pollSeconds * 2, 120);
			if ((Date.now() - monitorErrorStartedAt) < toleratedMonitorErrorSeconds * 1000) {
				await sleep(pollSeconds * 1000);
				continue;
			}
			throw normalizedError;
		}
	}
	const lastState = lastProgress
		? ` Last known state: run ${lastProgress.runId ?? '(not created)'} ${lastProgress.status ?? 'waiting'}${lastProgress.conclusion ? `/${lastProgress.conclusion}` : ''}${lastProgress.url ? ` ${lastProgress.url}` : ''}.`
		: '';
	const monitorErrorState = lastMonitorError ? ` Last monitor error: ${lastMonitorError.message}` : '';
	throw new Error(`Timed out waiting for GitHub workflow ${workflow} in ${owner}/${name}.${lastState}${monitorErrorState}`);
}

export async function ensureGitHubBranchFromBase(
	repository: string | { owner: string; name: string },
	branch: string,
	{
		baseBranch = 'main',
		client = createGitHubApiClient(),
	}: {
		baseBranch?: string;
		client?: GitHubApiClient;
	} = {},
) {
	const { owner, name } = typeof repository === 'string' ? parseGitHubRepositorySlug(repository) : repository;
	try {
		const existing = await client.rest.repos.getBranch({
			owner,
			repo: name,
			branch,
		});
		return {
			branch,
			baseBranch,
			existed: true,
			created: false,
			sha: existing.data.commit.sha,
		};
	} catch (error) {
		if (!/not found/iu.test(error instanceof Error ? error.message : String(error ?? ''))) {
			throw normalizeGitHubApiError(error, `Unable to resolve GitHub branch ${branch} in ${owner}/${name}`);
		}
	}
	try {
		const base = await client.rest.repos.getBranch({
			owner,
			repo: name,
			branch: baseBranch,
		});
		await client.rest.git.createRef({
			owner,
			repo: name,
			ref: `refs/heads/${branch}`,
			sha: base.data.commit.sha,
		});
		return {
			branch,
			baseBranch,
			existed: false,
			created: true,
			sha: base.data.commit.sha,
		};
	} catch (error) {
		throw normalizeGitHubApiError(error, `Unable to create GitHub branch ${branch} from ${baseBranch} in ${owner}/${name}`);
	}
}
