import { observeReconcileGitHubWorkflow } from '../../providers/github-private.ts';
import type { ReconcileAdapter, ReconcileAdapterInput } from '../../support/contracts/contracts.ts';
import { genericResult, noopDiff } from '../hosting/to-deploy-target.ts';
import { buildGitHubEnv, repositoryFromUnit } from '../treedx/graph/build-graph-only-adapter.ts';

function desired(input: ReconcileAdapterInput) {
	return {
		repository: repositoryFromUnit(input),
		workflow: String(input.unit.spec.workflow ?? ''),
		ref: String(input.unit.spec.ref ?? 'staging'),
	};
}

export function buildGitHubWorkflowObservationAdapter(): ReconcileAdapter {
	return {
		providerId: 'github',
		unitTypes: ['github-workflow-observation'],
		supports(unitType, provider) {
			return unitType === 'github-workflow-observation' && provider === 'github';
		},
		async refresh(input) {
			const expected = desired(input);
			const observed = await observeReconcileGitHubWorkflow(expected.repository, expected.workflow, expected.ref, buildGitHubEnv(input));
			return {
				exists: observed.exists,
				status: observed.authAvailable === false ? 'error' : observed.exists ? 'ready' : 'drifted',
				live: observed,
				locators: { repository: expected.repository, workflow: expected.workflow, ref: expected.ref },
				warnings: observed.authAvailable === false ? [String(observed.error ?? 'GitHub authentication is unavailable')] : [],
			};
		},
		diff(input) {
			const expected = desired(input);
			if (input.observed.warnings.length) return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			return input.observed.exists
				? noopDiff()
				: { action: 'blocked', reasons: [`Required workflow .github/workflows/${expected.workflow} is absent from ${expected.repository}@${expected.ref}. Source migration must provide workflows; reconciliation does not fabricate them.`], before: input.observed.live, after: input.unit.spec };
		},
		apply(input) {
			return genericResult(input);
		},
		verify(input) {
			const expected = desired(input);
			const verified = input.observed.exists;
			return {
				unitId: input.unit.unitId, supported: true, exists: verified, configured: verified, ready: verified, verified,
				checks: [{ key: `github.workflow.${expected.workflow}`, description: `Workflow ${expected.workflow} exists at ${expected.ref}`, source: 'api', exists: verified, configured: verified, ready: verified, verified, expected, observed: input.observed.live, issues: verified ? [] : ['Required workflow is missing.'] }],
				missing: verified ? [] : [`github.workflow.${expected.workflow}`], drifted: [], warnings: input.observed.warnings,
			};
		},
		destroy(input) {
			return genericResult({ ...input, diff: { action: 'retain', reasons: ['Workflow source is retained.'], before: input.observed.live, after: input.observed.live } });
		},
		importOrAdopt(input) {
			return genericResult({ ...input, diff: { action: 'adopt', reasons: ['Observed workflow adopted into reconcile state.'], before: input.observed.live, after: input.unit.spec } }, input.observed.live);
		},
	};
}
