import { deriveDesiredUnits } from '../reconciliation/desired-state.ts';
import { type RunnableBootstrapSystem } from '../support/bootstrap-systems.ts';
import type {
DesiredUnit,
ObservedUnitState,
ReconcileResult,
ReconcileRunContext,
ReconcileSelector,
ReconcileTarget,
UnitVerificationResult
} from '../support/contracts/contracts.ts';
import { reverseTopologicallySortedUnits } from '../support/engine/units.ts';
import { createReconcileRegistry } from '../support/state/registry.ts';
import { ensurePersistedUnitState,loadReconcileState } from '../support/state/state.ts';
import { createRunContext,filterUnitsBySelector,formatVerificationFailure,verifyPlanUnits,wrapAdapterFailure } from './now-iso.ts';
import { reconcileTarget } from './reconcile-target.ts';
import { refreshUnits } from './refresh-units.ts';

export async function destroyTargetUnits({
	tenantRoot,
	target,
	env = process.env,
	selector,
	units: explicitUnits,
	write,
}: {
	tenantRoot: string;
	target: ReconcileTarget;
	env?: NodeJS.ProcessEnv;
	selector?: ReconcileSelector;
	units?: DesiredUnit[];
	write?: (line: string) => void;
}) {
	const { units: allUnits, deployConfig } = deriveDesiredUnits({ tenantRoot, target, env });
	const units = filterUnitsBySelector(explicitUnits ?? allUnits, selector);
	const registry = createReconcileRegistry(deployConfig);
	const reconcileState = loadReconcileState(tenantRoot, target, env);
	const context = createRunContext(tenantRoot, target, env, write);
	const results: ReconcileResult[] = [];
	for (const unit of reverseTopologicallySortedUnits(units)) {
		const adapter = registry.get(unit.unitType, unit.provider);
		if (!adapter.destroy) {
			continue;
		}
		write?.(`Destroying ${unit.provider}:${unit.unitType}...`);
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
		let result;
		try {
			result = await Promise.resolve(adapter.destroy({
				context,
				unit,
				persistedState: persisted,
				observed: observed as ObservedUnitState,
			}));
		} catch (error) {
			wrapAdapterFailure('destroy', unit.provider, unit.unitType, unit.unitId, error);
		}
		results.push(result as ReconcileResult);
	}
	return { target, results };
}

export async function collectReconcileStatus({
	tenantRoot,
	target,
	env = process.env,
	systems,
	selector,
	units,
	session,
	write,
}: {
	tenantRoot: string;
	target: ReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: RunnableBootstrapSystem[];
	selector?: ReconcileSelector;
	units?: DesiredUnit[];
	session?: Map<string, unknown>;
	write?: (line: string) => void;
}) {
	const observed = await refreshUnits({ tenantRoot, target, env, systems, selector, units, write });
	const registry = createReconcileRegistry(observed.deployConfig);
	const context = createRunContext(tenantRoot, target, env, undefined, false, session);
	context.session.set('treeseed:status-only', true);
	const plans = await Promise.all(observed.units.map(async (unit) => {
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensurePersistedUnitState(observed.state, unit);
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
		write,
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
		.map((unit) => `Reconcile unit ${unit.provider}:${unit.unitType} is unverified: ${formatVerificationFailure(unit.verification as UnitVerificationResult)}.`);
	const warnings = unitStatuses.flatMap((unit) => unit.warnings);
	return {
		target,
		ready,
		blockers,
		warnings,
		units: unitStatuses,
	};
}

export async function reconcileNestedTarget({
	parentContext,
	selector,
	target,
	planOnly,
}: {
	parentContext: ReconcileRunContext;
	selector: ReconcileSelector;
	target: ReconcileTarget;
	planOnly: boolean;
}) {
	const previousVerificationResults = parentContext.session.get('treeseed:verification-results');
	const previousTimings = parentContext.session.get('treeseed:timings');
	try {
		return await reconcileTarget({
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

export async function verifyNestedTarget({
	parentContext,
	selector,
	target,
}: {
	parentContext: ReconcileRunContext;
	selector: ReconcileSelector;
	target: ReconcileTarget;
}) {
	const previousVerificationResults = parentContext.session.get('treeseed:verification-results');
	try {
		return await collectReconcileStatus({
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
