import { beforeEach, describe, expect, it, vi } from 'vitest';

const { observeWorkflow } = vi.hoisted(() => ({ observeWorkflow: vi.fn() }));

vi.mock('../../../src/reconcile/providers/github-private.ts', () => ({
	observeReconcileGitHubWorkflow: observeWorkflow,
}));
vi.mock('../../../src/reconcile/builtin-adapters/treedx/graph/build-graph-only-adapter.ts', () => ({
	buildGitHubEnv: () => ({ TREESEED_GITHUB_TOKEN: 'redacted' }),
	repositoryFromUnit: (input: any) => input.unit.spec.repository,
}));

const { buildGitHubWorkflowObservationAdapter } = await import('../../../src/reconcile/builtin-adapters/repositories/build-github-workflow-observation-adapter.ts');

function input() {
	return {
		unit: {
			unitId: 'github-workflow-observation:treeseed-ai/platform:staging:verify.yml',
			spec: { repository: 'treeseed-ai/platform', workflow: 'verify.yml', ref: 'staging' },
		},
		context: {},
	};
}

describe('GitHub workflow source observation', () => {
	beforeEach(() => vi.clearAllMocks());

	it('blocks when migrated source does not contain the required workflow', async () => {
		observeWorkflow.mockResolvedValue({ exists: false, authAvailable: true, sha: null });
		const adapter = buildGitHubWorkflowObservationAdapter();
		const observed = await adapter.refresh(input() as never);
		const diff = adapter.diff({ ...input(), observed } as never);

		expect(diff).toMatchObject({ action: 'blocked' });
		expect(diff.reasons[0]).toContain('.github/workflows/verify.yml');
		expect(diff.reasons[0]).toContain('does not fabricate');
	});

	it('is a read-only noop when the exact workflow exists on staging', async () => {
		observeWorkflow.mockResolvedValue({ exists: true, authAvailable: true, sha: 'workflow-sha' });
		const adapter = buildGitHubWorkflowObservationAdapter();
		const observed = await adapter.refresh(input() as never);

		expect(observeWorkflow).toHaveBeenCalledWith(
			'treeseed-ai/platform',
			'verify.yml',
			'staging',
			expect.objectContaining({ TREESEED_GITHUB_TOKEN: 'redacted' }),
		);
		expect(adapter.diff({ ...input(), observed } as never)).toMatchObject({ action: 'noop' });
		expect(adapter.verify({ ...input(), observed } as never)).toMatchObject({ verified: true, missing: [] });
	});
});
