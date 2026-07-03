import { describe, expect, it } from 'vitest';
import {
	cancelGitHubWorkflowRun,
	dispatchGitHubWorkflowRun,
	formatGitHubWorkflowFailure,
	getGitHubWorkflowFileStatus,
	getLatestGitHubWorkflowRun,
	waitForGitHubWorkflowRunCompletion,
	type GitHubWorkflowProgressEvent,
} from '../../src/operations/services/github-api.ts';

describe('GitHub workflow wait progress', () => {
	it('emits waiting, running, and completion heartbeats while preserving the gate result', async () => {
		const events: GitHubWorkflowProgressEvent[] = [];
		let listCalls = 0;
		let getCalls = 0;
		const client = {
			rest: {
				actions: {
					listWorkflowRuns: async () => {
						listCalls += 1;
						return {
							data: {
								workflow_runs: listCalls === 1
									? []
									: [{
										id: 123,
										status: 'queued',
										conclusion: null,
										html_url: 'https://github.com/acme/widget/actions/runs/123',
										head_sha: '2105baac5e2c999',
										head_branch: '0.6.23',
										created_at: '2026-05-07T01:00:00Z',
										updated_at: '2026-05-07T01:00:05Z',
									}],
							},
						};
					},
					getWorkflowRun: async () => {
						getCalls += 1;
						return {
							data: {
								id: 123,
								status: getCalls === 1 ? 'in_progress' : 'completed',
								conclusion: getCalls === 1 ? null : 'success',
								html_url: 'https://github.com/acme/widget/actions/runs/123',
								head_sha: '2105baac5e2c999',
								head_branch: '0.6.23',
								created_at: '2026-05-07T01:00:00Z',
								updated_at: getCalls === 1 ? '2026-05-07T01:00:10Z' : '2026-05-07T01:00:30Z',
							},
						};
					},
					listJobsForWorkflowRun: async () => ({
						data: {
							jobs: getCalls === 1
								? [{
									id: 1,
									name: 'verify',
									status: 'in_progress',
									conclusion: null,
									html_url: 'https://github.com/acme/widget/actions/runs/123/job/1',
									steps: [{ name: 'npm run verify:local', status: 'in_progress', conclusion: null }],
								}]
								: [{
									id: 1,
									name: 'verify',
									status: 'completed',
									conclusion: 'success',
									html_url: 'https://github.com/acme/widget/actions/runs/123/job/1',
									steps: [{ name: 'npm run verify:local', status: 'completed', conclusion: 'success' }],
								}],
						},
					}),
				},
			},
		};

		const result = await waitForGitHubWorkflowRunCompletion('acme/widget', {
			client: client as any,
			workflow: 'publish.yml',
			headSha: '2105baac5e2c999',
			branch: '0.6.23',
			pollSeconds: 0,
			onProgress: (event) => events.push(event),
		});

		expect(result).toMatchObject({
			status: 'completed',
			repository: 'acme/widget',
			workflow: 'publish.yml',
			runId: 123,
			conclusion: 'success',
			url: 'https://github.com/acme/widget/actions/runs/123',
			createdAt: '2026-05-07T01:00:00Z',
			updatedAt: '2026-05-07T01:00:30Z',
		});
		expect(events.map((event) => event.type)).toEqual(['waiting', 'running', 'completed']);
		expect(events[0]).toMatchObject({ runId: null, status: null, branch: '0.6.23' });
		expect(events[1]).toMatchObject({ runId: 123, status: 'in_progress', url: 'https://github.com/acme/widget/actions/runs/123' });
		expect(events[1].activeJobs?.[0]?.name).toBe('verify');
		expect(events[1].activeJobs?.[0]?.steps?.[0]?.name).toBe('npm run verify:local');
		expect(events[2]).toMatchObject({ runId: 123, status: 'completed', conclusion: 'success' });
		expect(events[2].completedJobs?.[0]?.name).toBe('verify');
	});

	it('includes the last known workflow run state and URL in timeout errors', async () => {
		const client = {
			rest: {
				actions: {
					listWorkflowRuns: async () => ({
						data: {
							workflow_runs: [{
								id: 456,
								status: 'queued',
								conclusion: null,
								html_url: 'https://github.com/acme/widget/actions/runs/456',
								head_sha: 'abc123',
								head_branch: 'main',
							}],
						},
					}),
					getWorkflowRun: async () => ({
						data: {
							id: 456,
							status: 'in_progress',
							conclusion: null,
							html_url: 'https://github.com/acme/widget/actions/runs/456',
							head_sha: 'abc123',
							head_branch: 'main',
						},
					}),
					listJobsForWorkflowRun: async () => ({ data: { jobs: [] } }),
				},
			},
		};

		await expect(waitForGitHubWorkflowRunCompletion('acme/widget', {
			client: client as any,
			workflow: 'verify.yml',
			headSha: 'abc123',
			branch: 'main',
			timeoutSeconds: 0.01,
			pollSeconds: 0,
		})).rejects.toThrow(/Last known state: run 456 in_progress.*actions\/runs\/456/u);
	});

	it('retries transient monitor errors while the workflow is still running', async () => {
		let getCalls = 0;
		const client = {
			rest: {
				actions: {
					listWorkflowRuns: async () => ({
						data: {
							workflow_runs: [{
								id: 457,
								status: 'queued',
								conclusion: null,
								html_url: 'https://github.com/acme/widget/actions/runs/457',
								head_sha: 'def456',
								head_branch: 'staging',
							}],
						},
					}),
					getWorkflowRun: async () => {
						getCalls += 1;
						if (getCalls === 1) {
							const error = new Error('Bad credentials') as Error & { status?: number };
							error.status = 401;
							throw error;
						}
						return {
							data: {
								id: 457,
								status: 'completed',
								conclusion: 'success',
								html_url: 'https://github.com/acme/widget/actions/runs/457',
								head_sha: 'def456',
								head_branch: 'staging',
							},
						};
					},
					listJobsForWorkflowRun: async () => ({ data: { jobs: [] } }),
				},
			},
		};

		const result = await waitForGitHubWorkflowRunCompletion('acme/widget', {
			client: client as any,
			workflow: 'release-gate.yml',
			headSha: 'def456',
			branch: 'staging',
			pollSeconds: 0,
		});

		expect(getCalls).toBe(2);
		expect(result).toMatchObject({ runId: 457, conclusion: 'success' });
	});

	it('returns a matching failed workflow immediately even when another matching run is active', async () => {
		const client = {
			rest: {
				actions: {
					listWorkflowRuns: async () => ({
						data: {
							workflow_runs: [
								{
									id: 458,
									status: 'in_progress',
									conclusion: null,
									html_url: 'https://github.com/acme/widget/actions/runs/458',
									head_sha: 'def456',
									head_branch: 'staging',
									created_at: '2026-05-07T01:01:00Z',
									updated_at: '2026-05-07T01:02:00Z',
								},
								{
									id: 459,
									status: 'completed',
									conclusion: 'failure',
									html_url: 'https://github.com/acme/widget/actions/runs/459',
									head_sha: 'def456',
									head_branch: 'staging',
									created_at: '2026-05-07T01:00:00Z',
									updated_at: '2026-05-07T01:03:00Z',
								},
							],
						},
					}),
					getWorkflowRun: async () => {
						throw new Error('waiter should not poll an active sibling after seeing a failed run');
					},
					listJobsForWorkflowRun: async () => ({
						data: {
							jobs: [{
								id: 1,
								name: 'deploy',
								status: 'completed',
								conclusion: 'failure',
								html_url: 'https://github.com/acme/widget/actions/runs/459/job/1',
								steps: [{ name: 'deploy app', status: 'completed', conclusion: 'failure' }],
							}],
						},
					}),
				},
			},
		};

		const result = await waitForGitHubWorkflowRunCompletion('acme/widget', {
			client: client as any,
			workflow: 'release-gate.yml',
			headSha: 'def456',
			branch: 'staging',
			pollSeconds: 0,
		});

		expect(result).toMatchObject({
			runId: 459,
			status: 'completed',
			conclusion: 'failure',
			failedJobs: [{ name: 'deploy', conclusion: 'failure' }],
		});
	});

	it('dispatches a workflow once when no pushed run appears for the requested head', async () => {
		const dispatches: Array<Record<string, unknown>> = [];
		let listCalls = 0;
		const client = {
			rest: {
				actions: {
					listWorkflowRuns: async () => {
						listCalls += 1;
						return {
							data: {
								workflow_runs: listCalls < 3
									? []
									: [{
										id: 789,
										status: 'completed',
										conclusion: 'success',
										html_url: 'https://github.com/acme/widget/actions/runs/789',
										head_sha: 'missing-head',
										head_branch: 'staging',
										created_at: '2026-05-07T01:00:00Z',
										updated_at: '2026-05-07T01:00:30Z',
									}],
							},
						};
					},
					createWorkflowDispatch: async (params: Record<string, unknown>) => {
						dispatches.push(params);
						return { status: 204 };
					},
					getWorkflowRun: async () => ({
						data: {
							id: 789,
							status: 'completed',
							conclusion: 'success',
							html_url: 'https://github.com/acme/widget/actions/runs/789',
							head_sha: 'missing-head',
							head_branch: 'staging',
							created_at: '2026-05-07T01:00:00Z',
							updated_at: '2026-05-07T01:00:30Z',
						},
					}),
					listJobsForWorkflowRun: async () => ({ data: { jobs: [] } }),
				},
			},
		};

		const result = await waitForGitHubWorkflowRunCompletion('acme/widget', {
			client: client as any,
			workflow: 'verify.yml',
			headSha: 'missing-head',
			branch: 'staging',
			dispatchIfMissing: true,
			dispatchAfterSeconds: 0,
			pollSeconds: 0,
		});

		expect(result).toMatchObject({ runId: 789, conclusion: 'success' });
		expect(dispatches).toEqual([{
			owner: 'acme',
			repo: 'widget',
			workflow_id: 'verify.yml',
			ref: 'staging',
			inputs: undefined,
		}]);
	});

	it('dispatches and cancels workflow runs through explicit helpers', async () => {
		const calls: Array<Record<string, unknown>> = [];
		const client = {
			rest: {
				actions: {
					createWorkflowDispatch: async (params: Record<string, unknown>) => {
						calls.push({ kind: 'dispatch', ...params });
						return { status: 204 };
					},
					cancelWorkflowRun: async (params: Record<string, unknown>) => {
						calls.push({ kind: 'cancel', ...params });
						return { status: 202 };
					},
				},
			},
		};

		const dispatched = await dispatchGitHubWorkflowRun('acme/widget', {
			client: client as any,
			workflow: 'deploy-web.yml',
			branch: 'staging',
			inputs: { deployment_id: 'dep-1' },
		});
		const cancelled = await cancelGitHubWorkflowRun('acme/widget', 123, { client: client as any });

		expect(dispatched).toMatchObject({
			repository: 'acme/widget',
			workflow: 'deploy-web.yml',
			branch: 'staging',
			status: 204,
		});
		expect(cancelled).toMatchObject({
			ok: true,
			supported: true,
			repository: 'acme/widget',
			runId: 123,
			message: 'GitHub workflow cancellation requested.',
		});
		expect(calls).toEqual([
			{
				kind: 'dispatch',
				owner: 'acme',
				repo: 'widget',
				workflow_id: 'deploy-web.yml',
				ref: 'staging',
				inputs: { deployment_id: 'dep-1' },
			},
			{
				kind: 'cancel',
				owner: 'acme',
				repo: 'widget',
				run_id: 123,
			},
		]);
	});

	it('formats workflow failures with an inspect command and stable retry guidance', () => {
		const failure = formatGitHubWorkflowFailure({
			repository: 'acme/widget',
			workflow: 'deploy-web.yml',
			runId: 987,
			runUrl: 'https://github.com/acme/widget/actions/runs/987',
			conclusion: 'failure',
			failedJobName: 'deploy',
		});

		expect(failure).toMatchObject({
			provider: 'github',
			repository: 'acme/widget',
			workflow: 'deploy-web.yml',
			runId: 987,
			runUrl: 'https://github.com/acme/widget/actions/runs/987',
			inspectCommand: 'gh run view 987 --repo acme/widget --log-failed',
			failedJobName: 'deploy',
			retrySafe: true,
			resumeSafe: false,
			blockerCode: 'github_workflow_failed',
		});
		expect(failure.summary).toContain('deploy-web.yml');
	});

	it('checks workflow file presence through GitHub content metadata', async () => {
		const requested: Array<Record<string, unknown>> = [];
		const client = {
			rest: {
				repos: {
					getContent: async (params: Record<string, unknown>) => {
						requested.push(params);
						return {
							data: {
								html_url: 'https://github.com/acme/widget/blob/main/.github/workflows/deploy-web.yml',
							},
						};
					},
				},
			},
		};

		const present = await getGitHubWorkflowFileStatus('acme/widget', 'deploy-web.yml', { client: client as any });

		expect(present).toMatchObject({
			ok: true,
			exists: true,
			repository: 'acme/widget',
			workflow: 'deploy-web.yml',
			url: 'https://github.com/acme/widget/blob/main/.github/workflows/deploy-web.yml',
		});
		expect(requested).toEqual([{
			owner: 'acme',
			repo: 'widget',
			path: '.github/workflows/deploy-web.yml',
		}]);
	});

	it('normalizes missing workflow files without throwing', async () => {
		const client = {
			rest: {
				repos: {
					getContent: async () => {
						const error = new Error('Not Found') as Error & { status?: number };
						error.status = 404;
						throw error;
					},
				},
			},
		};

		await expect(getGitHubWorkflowFileStatus('acme/widget', 'missing.yml', { client: client as any }))
			.resolves.toMatchObject({
				ok: true,
				exists: false,
				repository: 'acme/widget',
				workflow: 'missing.yml',
			});
	});

	it('reads the latest workflow run for monitor state', async () => {
		const requested: Array<Record<string, unknown>> = [];
		const client = {
			rest: {
				actions: {
					listWorkflowRuns: async (params: Record<string, unknown>) => {
						requested.push(params);
						return {
							data: {
								workflow_runs: [{
									id: 321,
									status: 'completed',
									conclusion: 'failure',
									html_url: 'https://github.com/acme/widget/actions/runs/321',
									head_sha: 'abc123',
									head_branch: 'staging',
									created_at: '2026-05-01T10:00:00Z',
									updated_at: '2026-05-01T10:04:00Z',
								}],
							},
						};
					},
				},
			},
		};

		const latest = await getLatestGitHubWorkflowRun('acme/widget', {
			client: client as any,
			workflow: 'deploy-web.yml',
			branch: 'staging',
		});

		expect(latest).toMatchObject({
			id: 321,
			status: 'completed',
			conclusion: 'failure',
			url: 'https://github.com/acme/widget/actions/runs/321',
			headSha: 'abc123',
			headBranch: 'staging',
		});
		expect(requested).toEqual([{
			owner: 'acme',
			repo: 'widget',
			workflow_id: 'deploy-web.yml',
			branch: 'staging',
			per_page: 1,
		}]);
	});
});
