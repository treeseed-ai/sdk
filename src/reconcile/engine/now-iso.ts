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


export function nowIso() {
	return new Date().toISOString();
}

export function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export function wrapAdapterFailure(
	stage: 'refresh' | 'diff' | 'validate' | 'apply' | 'verify' | 'destroy',
	provider: string,
	unitType: string,
	unitId: string,
	error: unknown,
): never {
	const message = `Treeseed reconcile adapter failed during ${stage} for ${provider}:${unitType} (${unitId}): ${toErrorMessage(error)}`;
	const wrapped = new Error(message);
	if (error instanceof Error && 'stack' in error && typeof error.stack === 'string') {
		wrapped.stack = error.stack;
	}
	throw wrapped;
}

export function formatVerificationFailure(verification: TreeseedUnitVerificationResult) {
	const details = [
		verification.missing.length > 0 ? `missing: ${verification.missing.join('; ')}` : null,
		verification.drifted.length > 0 ? `drifted: ${verification.drifted.join('; ')}` : null,
		verification.warnings.length > 0 ? `warnings: ${verification.warnings.join('; ')}` : null,
	].filter(Boolean);
	return details.length > 0
		? `Verification failed (${details.join(' | ')})`
		: 'Verification failed.';
}

export function createRunContext(
	tenantRoot: string,
	target: TreeseedReconcileTarget,
	launchEnv: NodeJS.ProcessEnv,
	write?: (line: string) => void,
	planOnly = false,
	session?: Map<string, unknown>,
): TreeseedReconcileRunContext {
	const { deployConfig } = deriveTreeseedDesiredUnits({ tenantRoot, target, env: launchEnv });
	return {
		tenantRoot,
		target,
		deployConfig,
		launchEnv,
		planOnly,
		write,
		session: session ?? new Map<string, unknown>(),
	};
}

export function normalizeSelectorValues(values: string[] | undefined) {
	return new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
}

export function unitSelectorValues(unit: TreeseedDesiredUnit) {
	const metadata = unit.metadata ?? {};
	const spec = unit.spec ?? {};
	const serviceKey = typeof metadata.serviceKey === 'string' ? metadata.serviceKey : null;
	const placement = typeof metadata.placement === 'string' ? metadata.placement : null;
	const appId = typeof metadata.applicationId === 'string'
		? metadata.applicationId
		: typeof metadata.appId === 'string'
			? metadata.appId
			: typeof (spec as Record<string, unknown>).applicationId === 'string'
				? (spec as Record<string, string>).applicationId
				: null;
	const packageId = typeof metadata.packageId === 'string' ? metadata.packageId : appId;
	const serviceName = typeof spec.serviceName === 'string' ? spec.serviceName : null;
	const serviceId = typeof metadata.serviceId === 'string'
		? metadata.serviceId
		: typeof (spec as Record<string, unknown>).serviceId === 'string'
			? (spec as Record<string, string>).serviceId
			: null;
	return {
		provider: unit.provider,
		unitType: unit.unitType,
		unitId: unit.unitId,
		serviceIds: [
			unit.logicalName,
			serviceId,
			serviceKey,
			serviceName,
			unit.unitType.startsWith('railway-service:') ? unit.unitType.slice('railway-service:'.length) : null,
			unit.unitType.endsWith('-runtime') ? unit.logicalName : null,
		].filter((value): value is string => Boolean(value)),
		serviceTypes: [unit.unitType],
		placements: [placement].filter((value): value is string => Boolean(value)),
		appIds: [appId].filter((value): value is string => Boolean(value)),
		packageIds: [packageId].filter((value): value is string => Boolean(value)),
	};
}

export function unitMatchesSelector(unit: TreeseedDesiredUnit, selector?: TreeseedReconcileSelector) {
	if (!selector) return true;
	const values = unitSelectorValues(unit);
	const provider = normalizeSelectorValues(selector.provider ?? selector.host);
	const unitIds = normalizeSelectorValues(selector.unitId);
	const unitTypes = normalizeSelectorValues([
		...(selector.unitType ?? []),
		...(selector.resourceKind ?? []),
	]);
	const serviceIds = normalizeSelectorValues(selector.serviceId);
	const serviceTypes = normalizeSelectorValues(selector.serviceType);
	const placements = normalizeSelectorValues(selector.placement);
	const appIds = normalizeSelectorValues(selector.appId);
	const packageIds = normalizeSelectorValues(selector.packageId);
	const has = (needle: Set<string>, haystack: string[]) => needle.size === 0 || haystack.some((entry) => needle.has(entry));
	return has(provider, [values.provider])
		&& has(unitIds, [values.unitId])
		&& has(unitTypes, [values.unitType])
		&& has(serviceIds, values.serviceIds)
		&& has(serviceTypes, values.serviceTypes)
		&& has(placements, values.placements)
		&& has(appIds, values.appIds)
		&& has(packageIds, values.packageIds);
}

export function includeDependencies(units: TreeseedDesiredUnit[], selected: TreeseedDesiredUnit[]) {
	const byId = new Map(units.map((unit) => [unit.unitId, unit]));
	const included = new Map(selected.map((unit) => [unit.unitId, unit]));
	const visit = (unit: TreeseedDesiredUnit) => {
		for (const dependencyId of unit.dependencies) {
			const dependency = byId.get(dependencyId);
			if (!dependency || included.has(dependency.unitId)) continue;
			included.set(dependency.unitId, dependency);
			visit(dependency);
		}
	};
	for (const unit of selected) visit(unit);
	return units.filter((unit) => included.has(unit.unitId));
}

export function filterUnitsBySelector(units: TreeseedDesiredUnit[], selector?: TreeseedReconcileSelector) {
	if (!selector) return units;
	const selected = units.filter((unit) => unitMatchesSelector(unit, selector));
	return includeDependencies(units, selected);
}

export function dependencyLevels(units: ReturnType<typeof topologicallySortDesiredUnits>) {
	const remaining = new Map(units.map((unit) => [unit.unitId, unit]));
	const completed = new Set<string>();
	const levels: typeof units[] = [];

	while (remaining.size > 0) {
		const ready = [...remaining.values()].filter((unit) =>
			unit.dependencies.every((dependencyId) => completed.has(dependencyId) || !remaining.has(dependencyId)),
		);
		if (ready.length === 0) {
			topologicallySortDesiredUnits(units);
			throw new Error('Treeseed reconcile dependency graph could not be scheduled.');
		}
		for (const unit of ready) {
			remaining.delete(unit.unitId);
			completed.add(unit.unitId);
		}
		levels.push(ready);
	}

	return levels;
}

export async function runByDependencyLevel<T>(
	units: ReturnType<typeof topologicallySortDesiredUnits>,
	action: (unit: ReturnType<typeof topologicallySortDesiredUnits>[number]) => Promise<T>,
) {
	const results: T[] = [];
	for (const level of dependencyLevels(units)) {
		results.push(...await Promise.all(level.map((unit) => action(unit))));
	}
	return results;
}

export function persistResult(
	reconcileState: TreeseedReconcileStateRecord,
	previous: TreeseedUnitPersistedState,
	result: TreeseedReconcileResult,
) {
	updateTreeseedPersistedUnitState(reconcileState, {
		...previous,
		desiredSpecHash: desiredUnitSpecHash(result.unit),
		lastObservedAt: nowIso(),
		lastReconciledAt: nowIso(),
		lastVerifiedAt: result.verification?.verified ? nowIso() : previous.lastVerifiedAt,
		lastStatus: result.verification?.verified ? 'ready' : result.observed.status,
		lastObservedState: result.observed.live,
		lastReconciledState: result.state,
		lastDiff: result.diff,
		lastVerification: result.verification,
		lastAction: result.action,
		resourceLocators: result.resourceLocators,
		warnings: [...result.warnings, ...(result.verification?.warnings ?? [])],
		error: result.verification?.verified === false ? formatVerificationFailure(result.verification) : null,
	});
}

export async function verifyPlanUnits({
	plans,
	registry,
	context,
	state,
	write,
}: {
	plans: TreeseedReconcilePlan[];
	registry: ReturnType<typeof createTreeseedReconcileRegistry>;
	context: TreeseedReconcileRunContext;
	state: TreeseedReconcileStateRecord;
	write?: (line: string) => void;
}) {
	const verificationMap = new Map<string, TreeseedUnitVerificationResult>();
	context.session.set('treeseed:verification-results', verificationMap);
	const verificationResults = new Map<string, { postconditions: TreeseedUnitPostcondition[]; verification: TreeseedUnitVerificationResult }>();
	for (const plan of plans) {
		write?.(`Verifying ${plan.unit.provider}:${plan.unit.unitType}...`);
		const adapter = registry.get(plan.unit.unitType, plan.unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(state, plan.unit);
		const postconditions = await Promise.resolve(adapter.requiredPostconditions?.({
			context,
			unit: plan.unit,
			persistedState: persisted,
		}) ?? []);
		let verification;
		try {
			verification = await Promise.resolve(adapter.verify({
				context,
				unit: plan.unit,
				persistedState: persisted,
				observed: plan.observed,
				diff: plan.diff,
				result: null,
				postconditions,
			}));
		} catch (error) {
			wrapAdapterFailure('verify', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
		}
		verificationMap.set(plan.unit.unitId, verification as TreeseedUnitVerificationResult);
		verificationResults.set(plan.unit.unitId, {
			postconditions,
			verification: verification as TreeseedUnitVerificationResult,
		});
	}
	return verificationResults;
}
