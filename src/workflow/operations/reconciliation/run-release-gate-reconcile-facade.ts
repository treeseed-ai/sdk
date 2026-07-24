import { compileDesiredResourceGraph, compileDesiredUnitsFromGraph } from "../../../platform/reconciliation/desired-state.ts";
import { planReconciliation, reconcileTarget, type DesiredUnit, type ReconcileSelector, type ReconcileTarget } from "../../../reconcile/index.ts";
import { WorkflowOperationHelpers } from '../recovery/workflow-write.ts';
import { buildWorkflowResult, normalizeExecutionMode } from '../support/create-repo-report.ts';
import { withContextEnv, workflowError } from '../commerce/catalog/run-release-production-guarantees.ts';
import { createNextSteps } from '../packages/release-admin-message.ts';

export async function runReleaseGateReconcileFacade(
	operation: 'stage' | 'release',
	helpers: WorkflowOperationHelpers,
	root: string,
	target: ReconcileTarget,
	input: { plan?: boolean; execute?: boolean; verifyDeployedResources?: boolean; releaseImageRefs?: Record<string, string>; includeHostedReleaseGates?: boolean },
	extraPayload: Record<string, unknown> = {},
) {
	const executionMode = normalizeExecutionMode(input);
	const reconcileEnv = { ...helpers.context.env, ...(input.releaseImageRefs ?? {}) };
	const includeHostedReleaseGates = input.includeHostedReleaseGates === true;
	const selector: ReconcileSelector = {
		environment: target.kind === 'persistent' ? target.scope : 'staging',
		resourceKind: ['release-gate'],
		provider: ['treeseed'],
	};
	const desiredGraph = await withContextEnv(reconcileEnv, () =>
		compileDesiredResourceGraph({ tenantRoot: root, target }));
	const rawUnits = compileDesiredUnitsFromGraph(desiredGraph)
		.filter((unit) => (
			unit.provider === 'treeseed'
			&& (unit.unitType === 'package-manifest' || unit.unitType.startsWith('release-gate:'))
			&& unit.unitType !== 'release-gate:npm-publish'
			&& unit.unitType !== 'release-gate:image-publish'
			&& (
				includeHostedReleaseGates
				|| (unit.unitType !== 'release-gate:hosted-reconcile' && unit.unitType !== 'release-gate:live-verify')
			)
		) || (
			unit.provider === 'github'
			&& (
				unit.unitType === 'github-environment'
				|| unit.unitType === 'github-secret-binding'
				|| unit.unitType === 'github-variable-binding'
			)
		));
	const unitsWithReleaseImageRefs = appendReleaseImageRefGitHubVariableBindings(rawUnits, input.releaseImageRefs ?? {});
	const rawUnitIds = new Set(unitsWithReleaseImageRefs.map((unit) => unit.unitId));
	const units = unitsWithReleaseImageRefs.map((unit) => ({
		...unit,
		dependencies: unit.dependencies.filter((dependency) => rawUnitIds.has(dependency)),
	}));
	const unitSelector: ReconcileSelector = {
		environment: selector.environment,
		unitId: units.map((unit) => unit.unitId),
	};
	const plan = await planReconciliation({
		tenantRoot: root,
		target,
		env: reconcileEnv,
		units,
		selector: unitSelector,
		write: (line) => helpers.write(`[${operation}][reconcile] ${line}`, 'stderr'),
	});
	const blockers = Array.isArray(extraPayload.blockers)
		? extraPayload.blockers.map((blocker) => String(blocker)).filter(Boolean)
		: [];
	if (executionMode === 'execute' && blockers.length > 0) {
		workflowError(operation, 'validation_failed', `${operation} is blocked:\n${blockers.join('\n')}`, {
			details: {
				blockers, 				target,
				plannedSteps: plan.plans.map((entry) => ({
					id: entry.unit.unitId, 					action: entry.diff.action, 					reasons: entry.diff.reasons,
				})),
			},
		});
	}
	const result = executionMode === 'execute'
		? await reconcileTarget({
			tenantRoot: root, 			target, 			env: reconcileEnv, 			units, 			selector: unitSelector, 			planOnly: false,
			write: (line) => helpers.write(`[${operation}][reconcile] ${line}`, 'stderr'),
		})
		: null;
	const payload = {
		...extraPayload,
		mode: 'reconcile-release-gates',
		target,
		executionMode,
		verifyDeployedResources: input.verifyDeployedResources === true,
		releaseImageRefs: input.releaseImageRefs ?? {},
		includeHostedReleaseGates,
		desiredGraph,
		units: units.map((unit) => ({
			unitId: unit.unitId, 			unitType: unit.unitType, 			provider: unit.provider, 			logicalName: unit.logicalName, 			dependencies: unit.dependencies,
		})),
		plannedSteps: plan.plans.map((entry) => ({
			id: entry.unit.unitId,
			description: `${entry.unit.provider}:${entry.unit.unitType} ${entry.unit.logicalName}`,
			action: entry.diff.action, 			reasons: entry.diff.reasons,
		})),
		reconcile: result,
		legacyMutationPathDisabled: true,
	};
	return buildWorkflowResult(operation, root, payload, {
		executionMode,
		summary: executionMode === 'execute'
			? `${operation} release gates reconciled through the canonical adapter path.`
			: `${operation} release gate plan ready.`,
		nextSteps: createNextSteps([
			operation === 'stage'
				? { operation: 'release', reason: 'Promote production after the staging release-gate candidate is green.', input: { bump: 'patch', plan: true } }
				: { operation: 'status', reason: 'Inspect production readiness after release gates complete.' },
		]),
	});
}

export function appendReleaseImageRefGitHubVariableBindings(units: DesiredUnit[], releaseImageRefs: Record<string, string>): DesiredUnit[] {
	const entries = Object.entries(releaseImageRefs)
		.map(([name, value]) => [name.trim(), value.trim()] as const)
		.filter(([name, value]) => name.length > 0 && value.length > 0);
	if (entries.length === 0) return units;
	const apiProductionEnvironment = units.find((unit) =>
		unit.provider === 'github'
		&& unit.unitType === 'github-environment'
		&& unit.unitId === 'github-environment:@treeseed/api:production');
	if (!apiProductionEnvironment) return units;
	const existingUnitIds = new Set(units.map((unit) => unit.unitId));
	const additions = entries
		.map(([variableName]) => {
			const unitId = `github-variable-binding:@treeseed/api:production:${variableName}`;
			if (existingUnitIds.has(unitId)) return null;
			return {
				...apiProductionEnvironment, 				unitId, 				unitType: 'github-variable-binding' as const,
				logicalName: `@treeseed/api production ${variableName}`,
				dependencies: [apiProductionEnvironment.unitId],
				spec: {
					packageId: '@treeseed/api', 					packageRoot: apiProductionEnvironment.spec.packageRoot, 					repository: apiProductionEnvironment.spec.repository, 					environment: 'production', 					variableName, 					envName: variableName,
				},
				secrets: {},
				metadata: {
					...apiProductionEnvironment.metadata, 					releaseImageRef: true,
				},
			} satisfies DesiredUnit;
		})
		.filter((unit): unit is DesiredUnit => Boolean(unit));
	return additions.length > 0 ? [...units, ...additions] : units;
}
