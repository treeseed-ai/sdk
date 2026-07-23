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
import { createRunContext, filterUnitsBySelector, runByDependencyLevel, wrapAdapterFailure } from './now-iso.ts';

export async function refreshTreeseedUnits({
	tenantRoot,
	target,
	env = process.env,
	systems,
	selector,
	units: explicitUnits,
	write,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
	selector?: TreeseedReconcileSelector;
	units?: TreeseedDesiredUnit[];
	write?: (line: string) => void;
}) {
	const derived = deriveTreeseedDesiredUnits({ tenantRoot, target, env });
	const baseUnits = explicitUnits ?? filterTreeseedDesiredUnitsByBootstrapSystems(derived.units, systems);
	const units = filterUnitsBySelector(baseUnits, selector);
	const deployConfig = derived.deployConfig;
	const registry = createTreeseedReconcileRegistry(deployConfig);
	const reconcileState = loadTreeseedReconcileState(tenantRoot, target, env);
	const context = createRunContext(tenantRoot, target, env, write);
	const observations = new Map<string, TreeseedObservedUnitState>();
	await runByDependencyLevel(topologicallySortDesiredUnits(units), async (unit) => {
		write?.(`Refreshing ${unit.provider}:${unit.unitType}...`);
		const adapter = registry.get(unit.unitType, unit.provider);
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
		observations.set(unit.unitId, observed as TreeseedObservedUnitState);
	});
	return {
		units,
		observations,
		state: reconcileState,
		deployConfig,
	};
}

export async function planTreeseedReconciliation({
	tenantRoot,
	target,
	env = process.env,
	systems,
	selector,
	units,
	write,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
	selector?: TreeseedReconcileSelector;
	units?: TreeseedDesiredUnit[];
	write?: (line: string) => void;
}) {
	const observed = await refreshTreeseedUnits({ tenantRoot, target, env, systems, selector, units, write });
	const registry = createTreeseedReconcileRegistry(observed.deployConfig);
	const context = createRunContext(tenantRoot, target, env, write);
	const plans: TreeseedReconcilePlan[] = [];
	await runByDependencyLevel(topologicallySortDesiredUnits(observed.units), async (unit) => {
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(observed.state, unit);
		const observation = observed.observations.get(unit.unitId)!;
		let diff;
		try {
			diff = await Promise.resolve(adapter.diff({
				context,
				unit,
				persistedState: persisted,
				observed: observation,
			}));
		} catch (error) {
			wrapAdapterFailure('diff', unit.provider, unit.unitType, unit.unitId, error);
		}
		plans.push({
			unit,
			observed: observation,
			diff: diff as any,
			persisted,
		});
	});
	return {
		...observed,
		plans,
	};
}
