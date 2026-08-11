import { beforeEach, describe, expect, it, vi } from 'vitest';

const { observeBranch, ensureBranch } = vi.hoisted(() => ({
	observeBranch: vi.fn(),
	ensureBranch: vi.fn(),
}));

vi.mock('../../../src/reconcile/providers/github-private.ts', () => ({
	observeReconcileGitHubBranch: observeBranch,
	ensureReconcileGitHubBranch: ensureBranch,
}));
vi.mock('../../../src/reconcile/builtin-adapters/treedx/graph/build-graph-only-adapter.ts', () => ({
	buildGitHubEnv: () => ({ TREESEED_GITHUB_TOKEN: 'redacted' }),
	repositoryFromUnit: (input: any) => input.unit.spec.repository,
}));

const { buildGitHubBranchAdapter } = await import('../../../src/reconcile/builtin-adapters/repositories/build-github-branch-adapter.ts');

function input() {
	return {
		unit: {
			unitId: 'github-branch:treeseed-ai/platform:staging',
			spec: { repository: 'treeseed-ai/platform', branch: 'staging', baseBranch: 'main' },
		},
		context: {},
	};
}

describe('GitHub branch reconciliation recovery', () => {
	beforeEach(() => vi.clearAllMocks());

	it('blocks staging creation until migrated bootstrap history exists', async () => {
		observeBranch
			.mockResolvedValueOnce({ exists: false, branch: 'staging', sha: null, authAvailable: true })
			.mockResolvedValueOnce({ exists: false, branch: 'main', sha: null, authAvailable: true });
		const adapter = buildGitHubBranchAdapter();
		const observed = await adapter.refresh(input() as never);
		const diff = adapter.diff({ ...input(), observed } as never);

		expect(diff).toMatchObject({ action: 'blocked' });
		expect(diff.reasons[0]).toContain('base branch main is missing');
	});

	it('creates staging from the observed main ref after bootstrap', async () => {
		observeBranch
			.mockResolvedValueOnce({ exists: false, branch: 'staging', sha: null, authAvailable: true })
			.mockResolvedValueOnce({ exists: true, branch: 'main', sha: 'main-sha', authAvailable: true });
		const adapter = buildGitHubBranchAdapter();
		const observed = await adapter.refresh(input() as never);
		const diff = adapter.diff({ ...input(), observed } as never);

		expect(diff).toMatchObject({ action: 'create' });
	});
});
