import { createTreeseedReconcileRegistry } from '../registry.ts';
import type {
	TreeseedDesiredUnit,
	TreeseedObservedUnitState,
	TreeseedReconcilePlan,
	TreeseedReconcileResult,
	TreeseedReconcileRunContext,
	TreeseedReconcileSelector,
	TreeseedReconcileStateRecord,
	TreeseedReconcileTarget,
	TreeseedReconcileUnitDiff,
	TreeseedUnitPostcondition,
	TreeseedUnitPersistedState,
	TreeseedUnitVerificationResult,
} from '../contracts.ts';
import { deriveTreeseedDesiredUnits } from '../desired-state.ts';
import { ensureTreeseedPersistedUnitState, desiredUnitSpecHash, loadTreeseedReconcileState, updateTreeseedPersistedUnitState, writeTreeseedReconcileState } from '../state.ts';
import { reverseTopologicallySortedUnits, topologicallySortDesiredUnits } from '../units.ts';
import { filterTreeseedDesiredUnitsByBootstrapSystems, type TreeseedRunnableBootstrapSystem } from '../bootstrap-systems.ts';
import { elapsedMs, formatDurationMs, type TreeseedTimingEntry } from '../../timing.ts';
import { createRunContext, filterUnitsBySelector, formatVerificationFailure, verifyPlanUnits, wrapAdapterFailure } from './now-iso.ts';
import { refreshTreeseedUnits } from './refresh-treeseed-units.ts';
import { reconcileTreeseedTarget } from './reconcile-treeseed-target.ts';

export async function destroyTreeseedTargetUnits({
	tenantRoot,
	target,
	env = process.env,
	selector,
	units: explicitUnits,
	write,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	selector?: TreeseedReconcileSelector;
	units?: TreeseedDesiredUnit[];
	write?: (line: string) => void;
}) {
	const { units: allUnits, deployConfig } = deriveTreeseedDesiredUnits({ tenantRoot, target, env });
	const units = filterUnitsBySelector(explicitUnits ?? allUnits, selector);
	const registry = createTreeseedReconcileRegistry(deployConfig);
	const reconcileState = loadTreeseedReconcileState(tenantRoot, target, env);
	const context = createRunContext(tenantRoot, target, env, write);
	const results: TreeseedReconcileResult[] = [];
	for (const unit of reverseTopologicallySortedUnits(units)) {
		const adapter = registry.get(unit.unitType, unit.provider);
		if (!adapter.destroy) {
			continue;
		}
		write?.(`Destroying ${unit.provider}:${unit.unitType}...`);
		const persisted = ensureTreeseedPersistedUnitState(reconcileState, unit);
		let observed;
		try {
			observed = await Promise.resolve(adapter.refresh({
				context,
				unit,
				persistedState: persisted,
			}));
		} catch (error) {
			wrapAdapterFailure('refresh', unit.provider, unit.unitType, unit.unitId, error);
		}
		let result;
		try {
			result = await Promise.resolve(adapter.destroy({
				context,
				unit,
				persistedState: persisted,
				observed: observed as TreeseedObservedUnitState,
			}));
		} catch (error) {
			wrapAdapterFailure('destroy', unit.provider, unit.unitType, unit.unitId, error);
		}
		results.push(result as TreeseedReconcileResult);
	}
	return { target, results };
}

export async function collectTreeseedReconcileStatus({
	tenantRoot,
	target,
	env = process.env,
	systems,
	selector,
	units,
	session,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
	selector?: TreeseedReconcileSelector;
	units?: TreeseedDesiredUnit[];
	session?: Map<string, unknown>;
}) {
	const observed = await refreshTreeseedUnits({ tenantRoot, target, env, systems, selector, units });
	const registry = createTreeseedReconcileRegistry(observed.deployConfig);
	const context = createRunContext(tenantRoot, target, env, undefined, false, session);
	const plans = await Promise.all(observed.units.map(async (unit) => {
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(observed.state, unit);
		const observation = observed.observations.get(unit.unitId)!;
		const diff = await Promise.resolve(adapter.diff({
			context,
			unit,
			persistedState: persisted,
			observed: observation,
		}));
		return {
			unit,
			observed: observation,
			diff,
			persisted,
		};
	}));
	const verificationResults = await verifyPlanUnits({
		plans,
		registry,
		context,
		state: observed.state,
	});
	const unitStatuses = observed.units.map((unit) => {
		const observation = observed.observations.get(unit.unitId)!;
		const verification = verificationResults.get(unit.unitId)?.verification ?? null;
		return {
			unitId: unit.unitId,
			unitType: unit.unitType,
			provider: unit.provider,
			status: observation.status,
			exists: observation.exists,
			locators: observation.locators,
			warnings: [...observation.warnings, ...(verification?.warnings ?? [])],
			verification,
		};
	});
	const ready = unitStatuses.every((unit) => unit.verification?.verified === true);
	const blockers = unitStatuses
		.filter((unit) => unit.verification?.verified !== true)
		.map((unit) => `Reconcile unit ${unit.provider}:${unit.unitType} is unverified: ${formatVerificationFailure(unit.verification as TreeseedUnitVerificationResult)}.`);
	const warnings = unitStatuses.flatMap((unit) => unit.warnings);
	return {
		target,
		ready,
		blockers,
		warnings,
		units: unitStatuses,
	};
}

export async function reconcileTreeseedNestedTarget({
	parentContext,
	selector,
	target,
	planOnly,
}: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
	planOnly: boolean;
}) {
	const previousVerificationResults = parentContext.session.get('treeseed:verification-results');
	const previousTimings = parentContext.session.get('treeseed:timings');
	try {
		return await reconcileTreeseedTarget({
			tenantRoot: parentContext.tenantRoot,
			target,
			env: parentContext.launchEnv,
			selector,
			write: parentContext.write,
			planOnly,
			session: parentContext.session,
		});
	} finally {
		if (previousVerificationResults === undefined) {
			parentContext.session.delete('treeseed:verification-results');
		} else {
			parentContext.session.set('treeseed:verification-results', previousVerificationResults);
		}
		if (previousTimings === undefined) {
			parentContext.session.delete('treeseed:timings');
		} else {
			parentContext.session.set('treeseed:timings', previousTimings);
		}
	}
}

export async function verifyTreeseedNestedTarget({
	parentContext,
	selector,
	target,
}: {
	parentContext: TreeseedReconcileRunContext;
	selector: TreeseedReconcileSelector;
	target: TreeseedReconcileTarget;
}) {
	const previousVerificationResults = parentContext.session.get('treeseed:verification-results');
	try {
		return await collectTreeseedReconcileStatus({
			tenantRoot: parentContext.tenantRoot,
			target,
			env: parentContext.launchEnv,
			selector,
			session: parentContext.session,
		});
	} finally {
		if (previousVerificationResults === undefined) {
			parentContext.session.delete('treeseed:verification-results');
		} else {
			parentContext.session.set('treeseed:verification-results', previousVerificationResults);
		}
	}
}
