import { resolve } from 'node:path';
import { compileDesiredResourceGraph,compileDesiredUnitsFromGraph } from '../../platform/reconciliation/desired-state.ts';
import { reconcileTarget } from '../../reconcile/index.ts';
import type { DesiredUnit } from '../../reconcile/index.ts';
import { projectRepositoryName } from '../../treedx/accounts/repository-name.ts';

function text(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : '';
}

export function visualAuditRepositoryId(state: Record<string, unknown> | undefined, projectSlug: string) {
	const synced = Array.isArray(state?.syncedProjects) ? state.syncedProjects : [];
	const observed = Array.isArray(state?.repositoryObservations) ? state.repositoryObservations : [];
	const repository = [...synced, ...observed]
		.find((entry) => text((entry as Record<string, unknown>).project) === projectSlug) as Record<string, unknown> | undefined;
	return text(repository?.repositoryId);
}

function fixtureProject(input: { projectRoot: string; projectId: string; projectSlug: string; teamSlug: string }) {
	const repositoryName = projectRepositoryName(input.projectSlug);
	return {
		projectKey: input.projectId,
		teamSlug: input.teamSlug,
		slug: input.projectSlug,
		repositoryName,
		repositoryId: repositoryName,
		localRoot: input.projectRoot,
		contentPath: '.treeseed/scenes/fixtures/visual-audit/content',
		defaultRef: 'refs/heads/main',
		seedPaths: [
			'.treeseed/agents/signals',
			'.treeseed/governance/proposal-types',
		],
	};
}

export function withVisualAuditTreeDxProject(unit: DesiredUnit, input: {
	projectRoot: string;
	projectId: string;
	projectSlug: string;
	teamSlug: string;
}) {
	if (unit.unitId !== 'local-treedx:team-primary') return unit;
	return {
		...unit,
		spec: {
			...unit.spec,
			projects: [fixtureProject(input)],
			syncSeedContent: true,
		},
	};
}

export async function reconcileVisualAuditTreeDxProject(input: {
	projectRoot: string;
	projectId: string;
	projectSlug: string;
	teamSlug: string;
	env?: NodeJS.ProcessEnv;
}) {
	const target = { kind: 'persistent' as const, scope: 'local' as const };
	const unitIds = ['local-docker-compose:treedx', 'local-treedx:team-primary'];
	const selector = { environment: 'local' as const, unitId: unitIds };
	const graph = compileDesiredResourceGraph({ tenantRoot: input.projectRoot, target, localContent: 'edit' });
	const units = compileDesiredUnitsFromGraph(graph, selector)
		.filter((unit) => unitIds.includes(unit.unitId))
		.map((unit) => withVisualAuditTreeDxProject(unit, input));
	if (units.length !== unitIds.length) throw new Error('Visual-audit TreeDX reconciliation could not resolve the managed local units.');
	const result = await reconcileTarget({
		tenantRoot: resolve(input.projectRoot),
		target,
		env: input.env,
		selector,
		units,
	});
	const failed = result.results?.filter((entry) => entry.error || entry.verification?.verified === false) ?? [];
	if (failed.length) throw new Error(`Visual-audit TreeDX reconciliation failed for ${failed.map((entry) => entry.unit.unitId).join(', ')}.`);
	const treeDx = result.results?.find((entry) => entry.unit.unitId === 'local-treedx:team-primary');
	const repositoryId = visualAuditRepositoryId(treeDx?.state, input.projectSlug);
	if (!repositoryId) throw new Error('Visual-audit TreeDX reconciliation did not return a verified repository identity.');
	return { repositoryId };
}
