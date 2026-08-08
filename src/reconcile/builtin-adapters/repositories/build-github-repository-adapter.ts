import { parseGitHubRepositorySlug } from '../../../operations/services/repositories/github-api.ts';
import { ensureReconcileGitHubRepository, observeReconcileGitHubRepository, setReconcileGitHubRepositoryArchived } from '../../providers/github-private.ts';
import type { ReconcileAdapter, ReconcileAdapterInput } from '../../support/contracts/contracts.ts';
import { genericResult, noopDiff } from '../hosting/to-deploy-target.ts';
import { buildGitHubEnv, repositoryFromUnit } from '../treedx/graph/build-graph-only-adapter.ts';

function desired(input: ReconcileAdapterInput) {
	const repository = repositoryFromUnit(input);
	const { owner, name } = parseGitHubRepositorySlug(repository);
	return {
		repository,
		owner,
		name,
		description: typeof input.unit.spec.description === 'string' ? input.unit.spec.description : null,
		homepageUrl: typeof input.unit.spec.homepageUrl === 'string' ? input.unit.spec.homepageUrl : null,
		visibility: input.unit.spec.visibility === 'public' ? 'public' as const : 'private' as const,
		lifecycle: input.unit.spec.lifecycle === 'adopt-only' ? 'adopt-only' as const : 'create-or-adopt' as const,
		deletionPolicy: input.unit.spec.deletionPolicy === 'archive' ? 'archive' as const : 'retain' as const,
		hasIssues: input.unit.spec.issues !== false,
		hasProjects: input.unit.spec.projects === true,
		hasWiki: input.unit.spec.wiki === true,
		actionsEnabled: input.unit.spec.actions !== false,
	};
}

function matches(live: Record<string, unknown>, expected: ReturnType<typeof desired>) {
	return live.slug === expected.repository
		&& live.visibility === expected.visibility
		&& live.description === expected.description
		&& live.homepageUrl === expected.homepageUrl
		&& live.hasIssues === expected.hasIssues
		&& live.hasProjects === expected.hasProjects
		&& live.hasWiki === expected.hasWiki
		&& live.actionsEnabled === expected.actionsEnabled
		&& live.archived !== true;
}

export function buildGitHubRepositoryAdapter(): ReconcileAdapter {
	return {
		providerId: 'github',
		unitTypes: ['github-repository'],
		supports(unitType, providerId) {
			return unitType === 'github-repository' && providerId === 'github';
		},
		async refresh(input) {
			const expected = desired(input);
			const observed = await observeReconcileGitHubRepository(expected.repository, buildGitHubEnv(input));
			const authBlocked = Boolean(observed && 'authAvailable' in observed && observed.authAvailable === false);
			const exists = Boolean(observed && !authBlocked);
			return {
				exists,
				status: authBlocked ? 'error' : exists && matches(observed as Record<string, unknown>, expected) ? 'ready' : 'drifted',
				live: observed ? { ...observed } : {},
				locators: { repository: expected.repository },
				warnings: authBlocked ? [String((observed as { error?: unknown }).error ?? 'GitHub authentication is unavailable')] : [],
			};
		},
		diff(input) {
			const expected = desired(input);
			if (input.observed.warnings.length > 0) return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			if (!input.observed.exists) {
				return expected.lifecycle === 'adopt-only'
					? { action: 'blocked', reasons: [`GitHub repository ${expected.repository} must already exist for adopt-only lifecycle.`], before: {}, after: input.unit.spec }
					: { action: 'create', reasons: [`GitHub repository ${expected.repository} is missing.`], before: {}, after: input.unit.spec };
			}
			return matches(input.observed.live, expected)
				? noopDiff()
				: { action: 'update', reasons: ['GitHub repository metadata drifted.'], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'noop' || input.diff.action === 'blocked') return genericResult(input);
			const expected = desired(input);
			const result = await ensureReconcileGitHubRepository(expected, buildGitHubEnv(input));
			return genericResult(input, result as unknown as Record<string, unknown>);
		},
		verify(input) {
			const expected = desired(input);
			const verified = input.observed.exists && matches(input.observed.live, expected);
			return {
				unitId: input.unit.unitId,
				supported: true,
				exists: input.observed.exists,
				configured: verified,
				ready: verified,
				verified,
				checks: [{ key: 'github.repository', description: 'GitHub repository identity and settings match desired state', source: 'api', exists: input.observed.exists, configured: verified, ready: verified, verified, expected, observed: input.observed.live, issues: verified ? [] : ['GitHub repository is missing or drifted.'] }],
				missing: input.observed.exists ? [] : ['github.repository'],
				drifted: input.observed.exists && !verified ? ['github.repository'] : [],
				warnings: input.observed.warnings,
			};
		},
		async destroy(input) {
			const expected = desired(input);
			if (expected.deletionPolicy === 'retain') {
				return genericResult({ ...input, diff: { action: 'retain', reasons: ['Repository deletion policy is retain.'], before: input.observed.live, after: input.observed.live } });
			}
			const result = await setReconcileGitHubRepositoryArchived(expected.repository, true, buildGitHubEnv(input));
			return genericResult({ ...input, diff: { action: 'update', reasons: ['Repository deletion policy is archive.'], before: input.observed.live, after: result as unknown as Record<string, unknown> } }, result as unknown as Record<string, unknown>);
		},
		importOrAdopt(input) {
			return genericResult({ ...input, diff: { action: 'adopt', reasons: ['Observed GitHub repository adopted into reconcile state.'], before: input.observed.live, after: input.unit.spec } }, input.observed.live);
		},
	};
}
