import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	getContent: vi.fn(),
	createGitHubApiClient: vi.fn(() => ({ rest: { repos: { getContent: mocks.getContent } } })),
	dispatchGitHubWorkflowRun: vi.fn(),
	getLatestGitHubWorkflowRun: vi.fn(),
	waitForGitHubWorkflowRunCompletion: vi.fn(),
}));

vi.mock('../../../../src/operations/services/repositories/github-api.ts', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../../../src/operations/services/repositories/github-api.ts')>();
	return {
		...actual,
		createGitHubApiClient: mocks.createGitHubApiClient,
		dispatchGitHubWorkflowRun: mocks.dispatchGitHubWorkflowRun,
		getLatestGitHubWorkflowRun: mocks.getLatestGitHubWorkflowRun,
		waitForGitHubWorkflowRunCompletion: mocks.waitForGitHubWorkflowRunCompletion,
	};
});

const { dispatchReconcileGitHubWorkflow, observeReconcileGitHubWorkflow } = await import('../../../../src/reconcile/providers/github-private.ts');

describe('GitHub private reconciliation workflow dispatch', () => {
	it('treats GitHub empty-repository content responses as missing workflow source', async () => {
		mocks.getContent.mockRejectedValueOnce(new Error('This repository is empty.'));

		await expect(observeReconcileGitHubWorkflow(
			'treeseed-ai/market-content',
			'publish-content.yml',
			'staging',
			{ TREESEED_GITHUB_TOKEN: 'token' },
		)).resolves.toMatchObject({
			exists: false,
			authAvailable: true,
			repository: 'treeseed-ai/market-content',
			workflow: 'publish-content.yml',
			ref: 'staging',
		});
	});

	it('fails closed when a waited workflow completes unsuccessfully', async () => {
		mocks.dispatchGitHubWorkflowRun.mockResolvedValue({
			status: 204,
			repository: 'acme/widget',
			workflow: 'deploy.yml',
			branch: 'main',
			dispatchedAt: '2026-07-03T12:00:00.000Z',
		});
		mocks.getLatestGitHubWorkflowRun.mockResolvedValue({ id: 42, status: 'queued', conclusion: null });
		mocks.waitForGitHubWorkflowRunCompletion.mockResolvedValue({
			status: 'completed',
			repository: 'acme/widget',
			workflow: 'deploy.yml',
			runId: 42,
			headSha: 'abc123',
			branch: 'main',
			conclusion: 'failure',
			url: 'https://github.com/acme/widget/actions/runs/42',
			jobs: [{
				id: 99,
				name: 'deploy',
				status: 'completed',
				conclusion: 'failure',
				url: 'https://github.com/acme/widget/actions/runs/42/job/99',
				steps: [{ name: 'deploy image', status: 'completed', conclusion: 'failure' }],
			}],
			failedJobs: [{
				id: 99,
				name: 'deploy',
				status: 'completed',
				conclusion: 'failure',
				url: 'https://github.com/acme/widget/actions/runs/42/job/99',
				steps: [{ name: 'deploy image', status: 'completed', conclusion: 'failure' }],
			}],
		});

		await expect(dispatchReconcileGitHubWorkflow({
			repository: 'acme/widget',
			workflow: 'deploy.yml',
			branch: 'main',
			wait: true,
			env: { TREESEED_GITHUB_TOKEN: 'token' },
		})).rejects.toThrow(/completed with conclusion failure[\s\S]*actions\/runs\/42[\s\S]*gh run view 42/u);
	});
});
