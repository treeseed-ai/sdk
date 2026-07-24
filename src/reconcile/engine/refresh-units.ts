import { createReconcileRegistry } from '../support/state/registry.ts';
import type {
	DesiredUnit,
	ObservedUnitState,
	ReconcilePlan,
	ReconcileResult,
	ReconcileRunContext,
	ReconcileSelector,
	ReconcileStateRecord,
	ReconcileTarget,
	ReconcileUnitDiff,
	UnitPostcondition,
	UnitPersistedState,
	UnitVerificationResult,
} from '../support/contracts/contracts.ts';
import { deriveDesiredUnits } from '../reconciliation/desired-state.ts';
import { ensurePersistedUnitState, desiredUnitSpecHash, loadReconcileState, updatePersistedUnitState, writeReconcileState } from '../support/state/state.ts';
import { reverseTopologicallySortedUnits, topologicallySortDesiredUnits } from '../support/engine/units.ts';
import { filterDesiredUnitsByBootstrapSystems, type RunnableBootstrapSystem } from '../support/bootstrap-systems.ts';
import { elapsedMs, formatDurationMs, type TimingEntry } from '../../entrypoints/runtime/timing.ts';
import { createRunContext, filterUnitsBySelector, runByDependencyLevel, wrapAdapterFailure } from './now-iso.ts';

export async function refreshUnits({
	tenantRoot,
	target,
	env = process.env,
	systems,
	selector,
	units: explicitUnits,
	write,
}: {
	tenantRoot: string;
	target: ReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: RunnableBootstrapSystem[];
	selector?: ReconcileSelector;
	units?: DesiredUnit[];
	write?: (line: string) => void;
}) {
	const derived = deriveDesiredUnits({ tenantRoot, target, env });
	const baseUnits = explicitUnits ?? filterDesiredUnitsByBootstrapSystems(derived.units, systems);
	const units = filterUnitsBySelector(baseUnits, selector);
	const deployConfig = derived.deployConfig;
	const registry = createReconcileRegistry(deployConfig);
	const reconcileState = loadReconcileState(tenantRoot, target, env);
	const context = createRunContext(tenantRoot, target, env, write);
	const observations = new Map<string, ObservedUnitState>();
	await runByDependencyLevel(topologicallySortDesiredUnits(units), async (unit) => {
		write?.(`Refreshing ${unit.provider}:${unit.unitType}...`);
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensurePersistedUnitState(reconcileState, unit);
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
		observations.set(unit.unitId, observed as ObservedUnitState);
	});
	return {
		units,
		observations,
		state: reconcileState,
		deployConfig,
	};
}

export async function planReconciliation({
	tenantRoot,
	target,
	env = process.env,
	systems,
	selector,
	units,
	write,
}: {
	tenantRoot: string;
	target: ReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: RunnableBootstrapSystem[];
	selector?: ReconcileSelector;
	units?: DesiredUnit[];
	write?: (line: string) => void;
}) {
	const observed = await refreshUnits({ tenantRoot, target, env, systems, selector, units, write });
	const registry = createReconcileRegistry(observed.deployConfig);
	const context = createRunContext(tenantRoot, target, env, write);
	const plans: ReconcilePlan[] = [];
	await runByDependencyLevel(topologicallySortDesiredUnits(observed.units), async (unit) => {
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensurePersistedUnitState(observed.state, unit);
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
