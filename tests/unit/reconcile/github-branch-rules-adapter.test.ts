import { beforeEach, describe, expect, it, vi } from 'vitest';

const { observeBranch, observeRules, ensureRules } = vi.hoisted(() => ({
	observeBranch: vi.fn(),
	observeRules: vi.fn(),
	ensureRules: vi.fn(),
}));

vi.mock('../../../src/reconcile/providers/github-private.ts', () => ({
	observeReconcileGitHubBranch: observeBranch,
	observeReconcileGitHubBranchRules: observeRules,
	ensureReconcileGitHubBranchRules: ensureRules,
}));
vi.mock('../../../src/reconcile/builtin-adapters/treedx/graph/build-graph-only-adapter.ts', () => ({
	buildGitHubEnv: () => ({ TREESEED_GITHUB_TOKEN: 'redacted' }),
	repositoryFromUnit: (input: any) => input.unit.spec.repository,
}));

const { buildGitHubBranchRulesAdapter } = await import('../../../src/reconcile/builtin-adapters/repositories/build-github-branch-rules-adapter.ts');

function input() {
	return {
		unit: {
			unitId: 'github-branch-rules:treeseed-ai/platform:main',
			spec: { repository: 'treeseed-ai/platform', branch: 'main' },
		},
		context: {},
	};
}

describe('GitHub branch protection reconciliation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		observeBranch.mockResolvedValue({ exists: true, branch: 'main', authAvailable: true });
	});

	it('reports field-specific drift for unsafe branch settings', async () => {
		observeRules.mockResolvedValue({
			exists: true,
			authAvailable: true,
			enforceAdmins: false,
			allowForcePushes: true,
			allowDeletions: true,
		});
		const adapter = buildGitHubBranchRulesAdapter();
		const observed = await adapter.refresh(input() as never);
		const diff = adapter.diff({ ...input(), observed } as never);

		expect(diff).toMatchObject({ action: 'update' });
		expect(diff.reasons[0]).toContain('enforce admins');
	});

	it('applies and converges on the exact retained safety policy', async () => {
		ensureRules.mockResolvedValue({ enforceAdmins: true, allowForcePushes: false, allowDeletions: false });
		const adapter = buildGitHubBranchRulesAdapter();
		const observed = {
			exists: true,
			status: 'drifted',
			warnings: [],
			locators: {},
			live: { branchExists: true, enforceAdmins: false, allowForcePushes: true, allowDeletions: false },
		};
		await adapter.apply({ ...input(), observed, diff: adapter.diff({ ...input(), observed } as never) } as never);

		expect(ensureRules).toHaveBeenCalledWith(
			'treeseed-ai/platform',
			'main',
			expect.objectContaining({ TREESEED_GITHUB_TOKEN: 'redacted' }),
		);
		const converged = { ...observed, live: { branchExists: true, enforceAdmins: true, allowForcePushes: false, allowDeletions: false } };
		expect(adapter.diff({ ...input(), observed: converged } as never)).toMatchObject({ action: 'noop' });
		expect(adapter.verify({ ...input(), observed: converged } as never)).toMatchObject({ verified: true, drifted: [] });
	});

	it('blocks branch protection until source migration creates the branch', async () => {
		observeBranch.mockResolvedValue({ exists: false, branch: 'main', authAvailable: true });
		observeRules.mockResolvedValue({ exists: false, authAvailable: true });
		const adapter = buildGitHubBranchRulesAdapter();
		const observed = await adapter.refresh(input() as never);

		expect(adapter.diff({ ...input(), observed } as never)).toMatchObject({
			action: 'blocked',
			reasons: [expect.stringContaining('before the protected branch exists')],
		});
	});

	it('reports private-repository plan limits as blocked provider drift', async () => {
		observeRules.mockResolvedValue({ exists: false, authAvailable: true, providerLimitation: 'Upgrade to GitHub Pro to enable this feature.' });
		const adapter = buildGitHubBranchRulesAdapter();
		const observed = await adapter.refresh(input() as never);

		expect(adapter.diff({ ...input(), observed } as never)).toMatchObject({
			action: 'blocked',
			reasons: [expect.stringContaining('GitHub provider limitation')],
		});
	});
});
