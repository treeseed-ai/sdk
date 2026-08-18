import { ensureReconcileGitHubBranchRules, observeReconcileGitHubBranch, observeReconcileGitHubBranchRules } from '../../providers/github-private.ts';
import type { ReconcileAdapter, ReconcileAdapterInput } from '../../support/contracts/contracts.ts';
import { genericResult, noopDiff } from '../hosting/to-deploy-target.ts';
import { buildGitHubEnv, repositoryFromUnit } from '../treedx/graph/build-graph-only-adapter.ts';

function desired(input: ReconcileAdapterInput) {
	return { repository: repositoryFromUnit(input), branch: String(input.unit.spec.branch ?? 'main') };
}

function matches(live: Record<string, unknown>) {
	return live.enforceAdmins === true && live.allowForcePushes === false && live.allowDeletions === false;
}

export function buildGitHubBranchRulesAdapter(): ReconcileAdapter {
	return {
		providerId: 'github', unitTypes: ['github-branch-rules'],
		supports(unitType, provider) { return unitType === 'github-branch-rules' && provider === 'github'; },
		async refresh(input) {
			const expected = desired(input);
			const env = buildGitHubEnv(input);
			const [observed, branch] = await Promise.all([
				observeReconcileGitHubBranchRules(expected.repository, expected.branch, env),
				observeReconcileGitHubBranch(expected.repository, expected.branch, env),
			]);
			const configured = observed.exists && matches(observed);
			return { exists: observed.exists, status: observed.authAvailable === false ? 'error' : configured ? 'ready' : 'drifted', live: { ...observed, branchExists: branch.exists }, locators: { repository: expected.repository, branch: expected.branch }, warnings: observed.authAvailable === false ? [String(observed.error ?? 'GitHub authentication is unavailable')] : [] };
		},
		diff(input) {
			if (input.observed.warnings.length) return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			if (typeof input.observed.live.providerLimitation === 'string') return { action: 'blocked', reasons: [`GitHub provider limitation: ${input.observed.live.providerLimitation}`], before: input.observed.live, after: input.unit.spec };
			if (input.observed.live.branchExists !== true) return { action: 'blocked', reasons: ['GitHub branch protection cannot be reconciled before the protected branch exists.'], before: input.observed.live, after: input.unit.spec };
			if (!input.observed.exists) return { action: 'create', reasons: ['GitHub branch protection is missing.'], before: input.observed.live, after: input.unit.spec };
			return matches(input.observed.live) ? noopDiff() : { action: 'update', reasons: ['GitHub branch protection must enforce admins and prohibit force pushes and deletions.'], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'noop' || input.diff.action === 'blocked') return genericResult(input);
			const expected = desired(input);
			const result = await ensureReconcileGitHubBranchRules(expected.repository, expected.branch, buildGitHubEnv(input));
			return genericResult(input, result);
		},
		verify(input) {
			const configured = input.observed.exists && matches(input.observed.live);
			return { unitId: input.unit.unitId, supported: true, exists: input.observed.exists, configured, ready: configured, verified: configured, checks: [{ key: 'github.branch-rules', description: 'Branch protection matches desired safety policy', source: 'api', exists: input.observed.exists, configured, ready: configured, verified: configured, expected: { enforceAdmins: true, allowForcePushes: false, allowDeletions: false }, observed: input.observed.live, issues: configured ? [] : ['Branch protection drifted.'] }], missing: input.observed.exists ? [] : ['github.branch-rules'], drifted: input.observed.exists && !configured ? ['github.branch-rules'] : [], warnings: input.observed.warnings };
		},
		destroy(input) { return genericResult({ ...input, diff: { action: 'retain', reasons: ['Branch safety rules are retained.'], before: input.observed.live, after: input.observed.live } }); },
		importOrAdopt(input) { return genericResult({ ...input, diff: { action: 'adopt', reasons: ['Observed branch rules adopted.'], before: input.observed.live, after: input.unit.spec } }, input.observed.live); },
	};
}
