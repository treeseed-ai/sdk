import { describe, expect, it } from 'vitest';
import {
	createGitHubActionsGateProgressReporter,
	formatGitHubActionsGateFailure,
	inspectGitHubActionsVerification,
	isRetryableGitHubActionsSetupFailure,
	type GitHubActionsVerificationTarget,
} from '../../../../src/operations/services/repositories/github-actions-verification.ts';

function fakeClient(options: {
	remoteHead?: string;
	runs?: Record<string, Array<Record<string, unknown>>>;
	jobs?: Record<number, Array<Record<string, unknown>>>;
	logs?: Record<number, string>;
}) {
	return {
		async request(_route: string, params: Record<string, unknown>) {
			return {
				data: options.logs?.[Number(params.job_id)] ?? '',
			};
		},
		rest: {
			repos: {
				async getBranch() {
					return { data: { commit: { sha: options.remoteHead ?? 'abc123' } } };
				},
			},
			actions: {
				async listWorkflowRuns(params: Record<string, unknown>) {
					return {
						data: {
							workflow_runs: options.runs?.[String(params.workflow_id)] ?? [],
						},
					};
				},
				async listJobsForWorkflowRun(params: Record<string, unknown>) {
					return {
						data: {
							jobs: options.jobs?.[Number(params.run_id)] ?? [],
						},
					};
				},
			},
		},
	} as any;
}

function target(overrides: Partial<GitHubActionsVerificationTarget> = {}): GitHubActionsVerificationTarget {
	return {
		name: '@treeseed/core',
		repoPath: '/repo/packages/core',
		repository: 'treeseed-ai/core',
		branch: 'staging',
		headSha: 'abc123',
		workflows: ['verify.yml'],
		kind: 'package',
		...overrides,
	};
}

describe('GitHub Actions verification', () => {
	it('reports failed jobs, failed steps, inspect commands, and capped log excerpts', async () => {
		const report = await inspectGitHubActionsVerification([target()], {
			client: fakeClient({
				remoteHead: 'abc123',
				runs: {
					'verify.yml': [{
						id: 42,
						status: 'completed',
						conclusion: 'failure',
						html_url: 'https://github.com/treeseed-ai/core/actions/runs/42',
						head_sha: 'abc123',
						head_branch: 'staging',
						created_at: '2026-05-05T00:00:00Z',
						updated_at: '2026-05-05T00:01:00Z',
					}],
				},
				jobs: {
					42: [{
						id: 9001,
						name: 'verify',
						status: 'completed',
						conclusion: 'failure',
						html_url: 'https://github.com/treeseed-ai/core/actions/runs/42/job/9001',
						steps: [
							{ name: 'Install', number: 1, status: 'completed', conclusion: 'success' },
							{ name: 'Verify package', number: 2, status: 'completed', conclusion: 'failure' },
						],
					}],
				},
				logs: {
					9001: Array.from({ length: 25 }, (_, index) => `line ${index + 1}`).join('\n'),
				},
			}),
			includeLogs: true,
			logLines: 20,
		});

		expect(report.summary.failure).toBe(1);
		expect(report.failures).toHaveLength(1);
		expect(report.failures[0]).toMatchObject({
			type: 'job',
			repository: 'treeseed-ai/core',
			repoName: '@treeseed/core',
			workflow: 'verify.yml',
			runId: 42,
			jobId: 9001,
			jobName: 'verify',
			inspectCommand: 'gh run view 42 --repo treeseed-ai/core --log-failed',
		});
		expect(report.failures[0]?.failedSteps.map((step) => step.name)).toEqual(['Verify package']);
		expect(report.failures[0]?.logExcerpt?.split('\n')).toHaveLength(20);
		expect(report.failures[0]?.logExcerpt?.split('\n')[0]).toBe('line 6');
	});

	it('marks unsynced branch heads as not pushed without inspecting workflows', async () => {
		const report = await inspectGitHubActionsVerification([target()], {
			client: fakeClient({ remoteHead: 'def456' }),
		});

		expect(report.summary.notPushed).toBe(1);
		expect(report.repositories[0]?.state).toBe('not_pushed');
		expect(report.failures[0]).toMatchObject({
			type: 'repository',
			state: 'not_pushed',
		});
	});

	it('normalizes missing and pending workflow runs', async () => {
		const report = await inspectGitHubActionsVerification([target({ workflows: ['verify.yml', 'deploy-web.yml'] })], {
			client: fakeClient({
				remoteHead: 'abc123',
				runs: {
					'deploy-web.yml': [{
						id: 77,
						status: 'in_progress',
						conclusion: null,
						html_url: 'https://github.com/treeseed-ai/core/actions/runs/77',
						head_sha: 'abc123',
						head_branch: 'staging',
					}],
				},
			}),
		});

		expect(report.summary.missing).toBe(1);
		expect(report.summary.pending).toBe(1);
		expect(report.repositories[0]?.state).toBe('missing');
		expect(report.failures.map((failure) => failure.state)).toEqual(['missing']);
	});

	it('reports non-fatal missing workflow runs for default CI discovery targets', async () => {
		const report = await inspectGitHubActionsVerification([target({
			missingIsFailure: false,
			workflows: ['release-gate.yml'],
		})], {
			client: fakeClient({ remoteHead: 'abc123' }),
		});

		expect(report.summary.missing).toBe(1);
		expect(report.repositories[0]?.state).toBe('missing');
		expect(report.failures).toEqual([]);
	});

	it('formats gate failures with failed job names and inspect command', () => {
		const message = formatGitHubActionsGateFailure({
			name: '@treeseed/core',
			repoPath: '/repo/packages/core',
			repository: 'treeseed-ai/core',
			workflow: 'verify.yml',
			branch: 'staging',
			headSha: 'abc123',
		}, {
			repository: 'treeseed-ai/core',
			conclusion: 'failure',
			runId: 42,
			url: 'https://github.com/treeseed-ai/core/actions/runs/42',
			failedJobs: [{ name: 'verify' }],
		});

		expect(message).toContain('Failed jobs: verify');
		expect(message).toContain('gh run view 42 --repo treeseed-ai/core --log-failed');
	});

	it('retries only failures confined to GitHub hosted job setup', () => {
		expect(isRetryableGitHubActionsSetupFailure({
			failedJobs: [{ steps: [{ name: 'Set up job', conclusion: 'failure' }] }],
		})).toBe(true);
		expect(isRetryableGitHubActionsSetupFailure({
			failedJobs: [{ steps: [{ name: 'Set up job', conclusion: 'failure' }, { name: 'Verify package', conclusion: 'failure' }] }],
		})).toBe(false);
		expect(isRetryableGitHubActionsSetupFailure({
			failedJobs: [{ steps: [{ name: 'Verify package', conclusion: 'failure' }] }],
		})).toBe(false);
		expect(isRetryableGitHubActionsSetupFailure({ failedJobs: [] })).toBe(false);
	});

	it('compacts repeated hosted gate progress for unchanged active steps', () => {
		let now = 0;
		const lines: string[] = [];
		const report = createGitHubActionsGateProgressReporter({
			name: '@treeseed/market',
			repoPath: '/repo',
			repository: 'knowledge-coop/market',
			workflow: 'deploy-web.yml',
			branch: 'main',
			headSha: 'abc123',
		}, {
			operation: 'release',
			now: () => now,
			minRepeatMs: 60_000,
			onProgress: (line) => lines.push(line),
		});
		const event = {
			type: 'running' as const,
			repository: 'knowledge-coop/market',
			workflow: 'deploy-web.yml',
			branch: 'main',
			headSha: 'abc123',
			elapsedSeconds: 10,
			runId: 123,
			url: 'https://github.com/knowledge-coop/market/actions/runs/123',
			status: 'in_progress',
			conclusion: null,
			jobs: [],
			activeJobs: [{
				id: 1,
				name: 'deploy-web',
				status: 'in_progress',
				conclusion: null,
				url: null,
				startedAt: null,
				completedAt: null,
				steps: [{ name: 'Deploy Treeseed platform', number: 1, status: 'in_progress', conclusion: null, startedAt: null, completedAt: null }],
			}],
			completedJobs: [],
			failedJobs: [],
		};

		report(event);
		now = 10_000;
		report({ ...event, elapsedSeconds: 20 });
		now = 20_000;
		report({ ...event, elapsedSeconds: 30 });
		now = 61_000;
		report({ ...event, elapsedSeconds: 70 });

		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('deploy-web.yml run 123 in_progress; active: deploy-web > Deploy Treeseed platform');
		expect(lines[1]).toContain('still active: deploy-web > Deploy Treeseed platform');
		expect(lines[1]).toContain('3 polls');
	});
});
