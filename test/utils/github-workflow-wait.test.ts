import { describe, expect, it } from 'vitest';
import { waitForGitHubWorkflowRunCompletion, type GitHubWorkflowProgressEvent } from '../../src/operations/services/github-api.ts';

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
							},
						};
					},
					listJobsForWorkflowRun: async () => ({ data: { jobs: [] } }),
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
		});
		expect(events.map((event) => event.type)).toEqual(['waiting', 'running', 'completed']);
		expect(events[0]).toMatchObject({ runId: null, status: null, branch: '0.6.23' });
		expect(events[1]).toMatchObject({ runId: 123, status: 'in_progress', url: 'https://github.com/acme/widget/actions/runs/123' });
		expect(events[2]).toMatchObject({ runId: 123, status: 'completed', conclusion: 'success' });
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
});
