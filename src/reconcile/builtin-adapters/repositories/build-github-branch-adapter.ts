import { ensureReconcileGitHubBranch, observeReconcileGitHubBranch } from '../../providers/github-private.ts';
import type { ReconcileAdapter, ReconcileAdapterInput } from '../../support/contracts/contracts.ts';
import { genericResult, noopDiff } from '../hosting/to-deploy-target.ts';
import { buildGitHubEnv, repositoryFromUnit } from '../treedx/graph/build-graph-only-adapter.ts';

function desired(input: ReconcileAdapterInput) {
	return {
		repository: repositoryFromUnit(input),
		branch: String(input.unit.spec.branch ?? ''),
		baseBranch: String(input.unit.spec.baseBranch ?? 'main'),
	};
}

function buildAdapter(unitType: 'github-repository-bootstrap' | 'github-branch'): ReconcileAdapter {
	return {
		providerId: 'github',
		unitTypes: [unitType],
		supports(candidate, provider) {
			return candidate === unitType && provider === 'github';
		},
		async refresh(input) {
			const expected = desired(input);
			const env = buildGitHubEnv(input);
			const [observed, base] = await Promise.all([
				observeReconcileGitHubBranch(expected.repository, expected.branch, env),
				expected.branch === expected.baseBranch
					? Promise.resolve(null)
					: observeReconcileGitHubBranch(expected.repository, expected.baseBranch, env),
			]);
			return {
				exists: observed.exists,
				status: observed.authAvailable === false ? 'error' : observed.exists ? 'ready' : 'drifted',
				live: { ...observed, baseBranch: expected.baseBranch, baseExists: base?.exists ?? observed.exists, baseSha: base?.sha ?? observed.sha },
				locators: { repository: expected.repository, branch: expected.branch },
				warnings: observed.authAvailable === false ? [String(observed.error ?? 'GitHub authentication is unavailable')] : [],
			};
		},
		diff(input) {
			const expected = desired(input);
			if (input.observed.warnings.length) return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			if (input.observed.exists) return noopDiff();
			if (unitType === 'github-repository-bootstrap') {
				return {
					action: 'blocked',
					reasons: [`Repository ${expected.repository} has no ${expected.branch} bootstrap commit. Migrate source history through the journaled repository migration before branch reconciliation.`],
					before: input.observed.live,
					after: input.unit.spec,
				};
			}
			if (input.observed.live.baseExists !== true) {
				return {
					action: 'blocked',
					reasons: [`GitHub branch ${expected.branch} cannot be created because base branch ${expected.baseBranch} is missing from ${expected.repository}.`],
					before: input.observed.live,
					after: input.unit.spec,
				};
			}
			return { action: 'create', reasons: [`GitHub branch ${expected.branch} is missing from ${expected.repository}.`], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action !== 'create') return genericResult(input);
			const expected = desired(input);
			const result = await ensureReconcileGitHubBranch(expected.repository, expected.branch, expected.baseBranch, buildGitHubEnv(input));
			return genericResult(input, result as unknown as Record<string, unknown>);
		},
		verify(input) {
			const expected = desired(input);
			const verified = input.observed.exists && input.observed.live.branch === expected.branch;
			return {
				unitId: input.unit.unitId,
				supported: true,
				exists: input.observed.exists,
				configured: verified,
				ready: verified,
				verified,
				checks: [{ key: `github.branch.${expected.branch}`, description: `GitHub branch ${expected.branch} exists`, source: 'api', exists: input.observed.exists, configured: verified, ready: verified, verified, expected, observed: input.observed.live, issues: verified ? [] : [`Branch ${expected.branch} is missing.`] }],
				missing: input.observed.exists ? [] : [`github.branch.${expected.branch}`],
				drifted: [],
				warnings: input.observed.warnings,
			};
		},
		destroy(input) {
			return genericResult({ ...input, diff: { action: 'retain', reasons: ['Repository branches are retained during portfolio reconciliation.'], before: input.observed.live, after: input.observed.live } });
		},
		importOrAdopt(input) {
			return genericResult({ ...input, diff: { action: 'adopt', reasons: ['Observed GitHub branch adopted into reconcile state.'], before: input.observed.live, after: input.unit.spec } }, input.observed.live);
		},
	};
}

export function buildGitHubRepositoryBootstrapAdapter() {
	return buildAdapter('github-repository-bootstrap');
}

export function buildGitHubBranchAdapter() {
	return buildAdapter('github-branch');
}
