import { describe, expect, it } from 'vitest';
import { buildGitHubEnvironmentAdapter } from '../../../src/reconcile/builtin-adapters/treedx/graph/build-graph-only-adapter.ts';

function input(branchPolicies: Array<{ name: string; type: string }>) {
	return {
		unit: { unitId: 'github-environment:test', spec: { repository: 'treeseed-ai/sdk', environment: 'staging', branch: 'staging' } },
		observed: {
			exists: true,
			status: 'drifted',
			warnings: [],
			locators: {},
			live: {
				authAvailable: true,
				branchExists: true,
				deploymentBranchPolicy: { protected_branches: false, custom_branch_policies: true },
				branchPolicies,
			},
		},
	};
}

describe('GitHub environment branch policy reconciliation', () => {
	it('reports field-specific drift when an environment admits the wrong branch', () => {
		const adapter = buildGitHubEnvironmentAdapter();
		const diff = adapter.diff(input([{ name: 'main', type: 'branch' }]) as never);
		expect(diff).toMatchObject({ action: 'update' });
		expect(diff.reasons[0]).toContain('allow only staging');
	});

	it('converges only when the custom policy admits exactly staging', () => {
		const adapter = buildGitHubEnvironmentAdapter();
		const value = input([{ name: 'staging', type: 'branch' }]);
		expect(adapter.diff(value as never)).toMatchObject({ action: 'noop' });
		expect(adapter.verify(value as never)).toMatchObject({ verified: true, drifted: [] });
	});

	it('blocks environment creation before the deployment branch exists', () => {
		const adapter = buildGitHubEnvironmentAdapter();
		const value = input([]);
		value.observed.exists = false;
		value.observed.live.branchExists = false;
		expect(adapter.diff(value as never)).toMatchObject({ action: 'blocked' });
	});
});
