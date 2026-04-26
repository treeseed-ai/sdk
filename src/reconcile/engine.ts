import { createTreeseedReconcileRegistry } from './registry.ts';
import type {
	TreeseedObservedUnitState,
	TreeseedReconcilePlan,
	TreeseedReconcileResult,
	TreeseedReconcileRunContext,
	TreeseedReconcileStateRecord,
	TreeseedReconcileTarget,
	TreeseedUnitPostcondition,
	TreeseedUnitPersistedState,
	TreeseedUnitVerificationResult,
} from './contracts.ts';
import { deriveTreeseedDesiredUnits } from './desired-state.ts';
import { ensureTreeseedPersistedUnitState, desiredUnitSpecHash, loadTreeseedReconcileState, updateTreeseedPersistedUnitState, writeTreeseedReconcileState } from './state.ts';
import { reverseTopologicallySortedUnits, topologicallySortDesiredUnits } from './units.ts';
import { filterTreeseedDesiredUnitsByBootstrapSystems, type TreeseedRunnableBootstrapSystem } from './bootstrap-systems.ts';

function nowIso() {
	return new Date().toISOString();
}

function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function wrapAdapterFailure(
	stage: 'observe' | 'plan' | 'validate' | 'reconcile' | 'verify' | 'destroy',
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

function formatVerificationFailure(verification: TreeseedUnitVerificationResult) {
	const details = [
		verification.missing.length > 0 ? `missing: ${verification.missing.join('; ')}` : null,
		verification.drifted.length > 0 ? `drifted: ${verification.drifted.join('; ')}` : null,
		verification.warnings.length > 0 ? `warnings: ${verification.warnings.join('; ')}` : null,
	].filter(Boolean);
	return details.length > 0
		? `Verification failed (${details.join(' | ')})`
		: 'Verification failed.';
}

function createRunContext(
	tenantRoot: string,
	target: TreeseedReconcileTarget,
	launchEnv: NodeJS.ProcessEnv,
	write?: (line: string) => void,
): TreeseedReconcileRunContext {
	const { deployConfig } = deriveTreeseedDesiredUnits({ tenantRoot, target });
	return {
		tenantRoot,
		target,
		deployConfig,
		launchEnv,
		write,
		session: new Map<string, unknown>(),
	};
}

function dependencyLevels(units: ReturnType<typeof topologicallySortDesiredUnits>) {
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

async function runByDependencyLevel<T>(
	units: ReturnType<typeof topologicallySortDesiredUnits>,
	action: (unit: ReturnType<typeof topologicallySortDesiredUnits>[number]) => Promise<T>,
) {
	const results: T[] = [];
	for (const level of dependencyLevels(units)) {
		results.push(...await Promise.all(level.map((unit) => action(unit))));
	}
	return results;
}

function persistResult(
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

async function verifyPlanUnits({
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

export async function observeTreeseedUnits({
	tenantRoot,
	target,
	env = process.env,
	systems,
	write,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
	write?: (line: string) => void;
}) {
	const derived = deriveTreeseedDesiredUnits({ tenantRoot, target });
	const units = filterTreeseedDesiredUnitsByBootstrapSystems(derived.units, systems);
	const deployConfig = derived.deployConfig;
	const registry = createTreeseedReconcileRegistry(deployConfig);
	const reconcileState = loadTreeseedReconcileState(tenantRoot, target);
	const context = createRunContext(tenantRoot, target, env, write);
	const observations = new Map<string, TreeseedObservedUnitState>();
	await runByDependencyLevel(topologicallySortDesiredUnits(units), async (unit) => {
		write?.(`Observing ${unit.provider}:${unit.unitType}...`);
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(reconcileState, unit);
		let observed;
		try {
			observed = await Promise.resolve(adapter.observe({
				context,
				unit,
				persistedState: persisted,
			}));
		} catch (error) {
			wrapAdapterFailure('observe', unit.provider, unit.unitType, unit.unitId, error);
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
	write,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
	write?: (line: string) => void;
}) {
	const observed = await observeTreeseedUnits({ tenantRoot, target, env, systems, write });
	const registry = createTreeseedReconcileRegistry(observed.deployConfig);
	const context = createRunContext(tenantRoot, target, env, write);
	const plans: TreeseedReconcilePlan[] = [];
	await runByDependencyLevel(topologicallySortDesiredUnits(observed.units), async (unit) => {
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(observed.state, unit);
		const observation = observed.observations.get(unit.unitId)!;
		let diff;
		try {
			diff = await Promise.resolve(adapter.plan({
				context,
				unit,
				persistedState: persisted,
				observed: observation,
			}));
		} catch (error) {
			wrapAdapterFailure('plan', unit.provider, unit.unitType, unit.unitId, error);
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

export async function reconcileTreeseedTarget({
	tenantRoot,
	target,
	env = process.env,
	systems,
	write,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
	write?: (line: string) => void;
}) {
	const planned = await planTreeseedReconciliation({ tenantRoot, target, env, systems, write });
	const registry = createTreeseedReconcileRegistry(planned.deployConfig);
	const context = createRunContext(tenantRoot, target, env, write);
	const results: TreeseedReconcileResult[] = [];
	const verificationMap = new Map<string, TreeseedUnitVerificationResult>();
	context.session.set('treeseed:verification-results', verificationMap);
	const planByUnitId = new Map(planned.plans.map((plan) => [plan.unit.unitId, plan]));
	let persistChain = Promise.resolve();
	const persistVerifiedResult = async (persisted: TreeseedUnitPersistedState, verifiedResult: TreeseedReconcileResult) => {
		persistChain = persistChain.then(() => {
			persistResult(planned.state, persisted, verifiedResult);
			writeTreeseedReconcileState(tenantRoot, planned.state);
		});
		await persistChain;
	};
	await runByDependencyLevel(topologicallySortDesiredUnits(planned.units), async (unit) => {
		const plan = planByUnitId.get(unit.unitId)!;
		write?.(`Reconciling ${plan.unit.provider}:${plan.unit.unitType}...`);
		const adapter = registry.get(plan.unit.unitType, plan.unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(planned.state, plan.unit);
		try {
			await Promise.resolve(adapter.validate?.({
				context,
				unit: plan.unit,
				persistedState: persisted,
			}));
		} catch (error) {
			wrapAdapterFailure('validate', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
		}
		let result;
		try {
			result = await Promise.resolve(adapter.reconcile({
				context,
				unit: plan.unit,
				persistedState: persisted,
				observed: plan.observed,
				diff: plan.diff,
			}));
		} catch (error) {
			wrapAdapterFailure('reconcile', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
		}
		write?.(`Verifying ${plan.unit.provider}:${plan.unit.unitType}...`);
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
				observed: (result as TreeseedReconcileResult).observed,
				diff: plan.diff,
				result: result as TreeseedReconcileResult,
				postconditions,
			}));
		} catch (error) {
			wrapAdapterFailure('verify', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
		}
		const verifiedResult = {
			...(result as TreeseedReconcileResult),
			verification: verification as TreeseedUnitVerificationResult,
			warnings: [
				...(result as TreeseedReconcileResult).warnings,
				...((verification as TreeseedUnitVerificationResult).warnings ?? []),
			],
		};
		verificationMap.set(plan.unit.unitId, verification as TreeseedUnitVerificationResult);
		if (!(verification as TreeseedUnitVerificationResult).verified) {
			await persistVerifiedResult(persisted, verifiedResult);
			throw new Error(`Treeseed reconcile verification failed for ${plan.unit.provider}:${plan.unit.unitType} (${plan.unit.unitId}): ${formatVerificationFailure(verification as TreeseedUnitVerificationResult)}`);
		}
		await persistVerifiedResult(persisted, verifiedResult);
		results.push(verifiedResult);
	});
	writeTreeseedReconcileState(tenantRoot, planned.state);
	return {
		target,
		units: planned.units,
		plans: planned.plans,
		results,
		state: planned.state,
	};
}

export async function destroyTreeseedTargetUnits({
	tenantRoot,
	target,
	env = process.env,
	write,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	write?: (line: string) => void;
}) {
	const { units, deployConfig } = deriveTreeseedDesiredUnits({ tenantRoot, target });
	const registry = createTreeseedReconcileRegistry(deployConfig);
	const reconcileState = loadTreeseedReconcileState(tenantRoot, target);
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
			observed = await Promise.resolve(adapter.observe({
				context,
				unit,
				persistedState: persisted,
			}));
		} catch (error) {
			wrapAdapterFailure('observe', unit.provider, unit.unitType, unit.unitId, error);
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
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
}) {
	const observed = await observeTreeseedUnits({ tenantRoot, target, env, systems });
	const registry = createTreeseedReconcileRegistry(observed.deployConfig);
	const context = createRunContext(tenantRoot, target, env);
	const plans = await Promise.all(observed.units.map(async (unit) => {
		const adapter = registry.get(unit.unitType, unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(observed.state, unit);
		const observation = observed.observations.get(unit.unitId)!;
		const diff = await Promise.resolve(adapter.plan({
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
	const units = observed.units.map((unit) => {
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
	const ready = units.every((unit) => unit.verification?.verified === true);
	const blockers = units
		.filter((unit) => unit.verification?.verified !== true)
		.map((unit) => `Reconcile unit ${unit.provider}:${unit.unitType} is unverified: ${formatVerificationFailure(unit.verification as TreeseedUnitVerificationResult)}.`);
	const warnings = units.flatMap((unit) => unit.warnings);
	return {
		target,
		ready,
		blockers,
		warnings,
		units,
	};
}
