import { createTreeseedReconcileRegistry } from './registry.ts';
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
} from './contracts.ts';
import { deriveTreeseedDesiredUnits } from './desired-state.ts';
import { ensureTreeseedPersistedUnitState, desiredUnitSpecHash, loadTreeseedReconcileState, updateTreeseedPersistedUnitState, writeTreeseedReconcileState } from './state.ts';
import { reverseTopologicallySortedUnits, topologicallySortDesiredUnits } from './units.ts';
import { filterTreeseedDesiredUnitsByBootstrapSystems, type TreeseedRunnableBootstrapSystem } from './bootstrap-systems.ts';
import { elapsedMs, formatDurationMs, type TreeseedTimingEntry } from '../timing.ts';

function nowIso() {
	return new Date().toISOString();
}

function toErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function wrapAdapterFailure(
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

function normalizeSelectorValues(values: string[] | undefined) {
	return new Set((values ?? []).map((value) => value.trim()).filter(Boolean));
}

function unitSelectorValues(unit: TreeseedDesiredUnit) {
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

function unitMatchesSelector(unit: TreeseedDesiredUnit, selector?: TreeseedReconcileSelector) {
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

function includeDependencies(units: TreeseedDesiredUnit[], selected: TreeseedDesiredUnit[]) {
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

function filterUnitsBySelector(units: TreeseedDesiredUnit[], selector?: TreeseedReconcileSelector) {
	if (!selector) return units;
	const selected = units.filter((unit) => unitMatchesSelector(unit, selector));
	return includeDependencies(units, selected);
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

export async function reconcileTreeseedTarget({
	tenantRoot,
	target,
	env = process.env,
	systems,
	selector,
	units,
	write,
	planOnly = false,
	session,
}: {
	tenantRoot: string;
	target: TreeseedReconcileTarget;
	env?: NodeJS.ProcessEnv;
	systems?: TreeseedRunnableBootstrapSystem[];
	selector?: TreeseedReconcileSelector;
	units?: TreeseedDesiredUnit[];
	write?: (line: string) => void;
	planOnly?: boolean;
	session?: Map<string, unknown>;
}) {
	const planned = await planTreeseedReconciliation({ tenantRoot, target, env, systems, selector, units, write });
	const registry = createTreeseedReconcileRegistry(planned.deployConfig);
	const context = createRunContext(tenantRoot, target, env, write, planOnly, session);
	const results: TreeseedReconcileResult[] = [];
	const verificationMap = new Map<string, TreeseedUnitVerificationResult>();
	const timingEntries: TreeseedTimingEntry[] = [];
	context.session.set('treeseed:verification-results', verificationMap);
	context.session.set('treeseed:timings', timingEntries);
	const planByUnitId = new Map(planned.plans.map((plan) => [plan.unit.unitId, plan]));
	let persistChain = Promise.resolve();
	const persistVerifiedResult = async (persisted: TreeseedUnitPersistedState, verifiedResult: TreeseedReconcileResult) => {
		persistChain = persistChain.then(() => {
			persistResult(planned.state, persisted, verifiedResult);
			writeTreeseedReconcileState(tenantRoot, planned.state, env);
		});
		await persistChain;
	};
	await runByDependencyLevel(topologicallySortDesiredUnits(planned.units), async (unit) => {
		let plan = planByUnitId.get(unit.unitId)!;
		const adapter = registry.get(plan.unit.unitType, plan.unit.provider);
		const persisted = ensureTreeseedPersistedUnitState(planned.state, plan.unit);
		const unitTiming: TreeseedTimingEntry = {
			name: `apply:${plan.unit.provider}:${plan.unit.unitType}:${plan.unit.logicalName}`,
			durationMs: 0,
			status: 'running',
			children: [],
			metadata: { unitId: plan.unit.unitId, action: plan.diff.action },
		};
		const unitStartMs = performance.now();
		timingEntries.push(unitTiming);
		if (!planOnly && plan.unit.dependencies.length > 0) {
			write?.(`Refreshing ${plan.unit.provider}:${plan.unit.unitType} after dependencies (${plan.unit.logicalName})...`);
			let observedAfterDependencies;
			try {
				const stageStartMs = performance.now();
				observedAfterDependencies = await Promise.resolve(adapter.refresh({
					context,
					unit: plan.unit,
					persistedState: persisted,
				}));
				unitTiming.children?.push({
					name: `${unitTiming.name}:refresh-after-dependencies`,
					durationMs: elapsedMs(stageStartMs),
					status: 'success',
				});
			} catch (error) {
				unitTiming.children?.push({
					name: `${unitTiming.name}:refresh-after-dependencies`,
					durationMs: elapsedMs(unitStartMs),
					status: 'failed',
				});
				unitTiming.durationMs = elapsedMs(unitStartMs);
				unitTiming.status = 'failed';
				wrapAdapterFailure('refresh', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
			}
			let diffAfterDependencies;
			try {
				const stageStartMs = performance.now();
				diffAfterDependencies = await Promise.resolve(adapter.diff({
					context,
					unit: plan.unit,
					persistedState: persisted,
					observed: observedAfterDependencies as TreeseedObservedUnitState,
				}));
				unitTiming.children?.push({
					name: `${unitTiming.name}:diff-after-dependencies`,
					durationMs: elapsedMs(stageStartMs),
					status: 'success',
				});
			} catch (error) {
				unitTiming.children?.push({
					name: `${unitTiming.name}:diff-after-dependencies`,
					durationMs: elapsedMs(unitStartMs),
					status: 'failed',
				});
				unitTiming.durationMs = elapsedMs(unitStartMs);
				unitTiming.status = 'failed';
				wrapAdapterFailure('diff', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
			}
			plan = {
				...plan,
				observed: observedAfterDependencies as TreeseedObservedUnitState,
				diff: diffAfterDependencies as TreeseedReconcileUnitDiff,
			};
			planByUnitId.set(plan.unit.unitId, plan);
			const plannedIndex = planned.plans.findIndex((entry) => entry.unit.unitId === plan.unit.unitId);
			if (plannedIndex >= 0) planned.plans[plannedIndex] = plan;
			if (unitTiming.metadata) unitTiming.metadata.action = plan.diff.action;
		}
		write?.(`${planOnly ? 'Planning' : 'Applying'} ${plan.unit.provider}:${plan.unit.unitType} (${plan.unit.logicalName})...`);
		try {
			const stageStartMs = performance.now();
			await Promise.resolve(adapter.validate?.({
				context,
				unit: plan.unit,
				persistedState: persisted,
			}));
			unitTiming.children?.push({
				name: `${unitTiming.name}:validate`,
				durationMs: elapsedMs(stageStartMs),
				status: 'success',
			});
		} catch (error) {
			unitTiming.children?.push({
				name: `${unitTiming.name}:validate`,
				durationMs: elapsedMs(unitStartMs),
				status: 'failed',
			});
			unitTiming.durationMs = elapsedMs(unitStartMs);
			unitTiming.status = 'failed';
			wrapAdapterFailure('validate', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
		}
		let result;
		try {
			const stageStartMs = performance.now();
			if (planOnly) {
				result = {
					unit: plan.unit,
					observed: plan.observed,
					diff: plan.diff,
					action: plan.diff.action,
					warnings: [...plan.observed.warnings, 'plan mode: apply skipped'],
					resourceLocators: plan.observed.locators,
					state: plan.observed.live,
					verification: null,
				};
			} else {
				result = await Promise.resolve(adapter.apply({
					context,
					unit: plan.unit,
					persistedState: persisted,
					observed: plan.observed,
					diff: plan.diff,
				}));
			}
			unitTiming.children?.push({
				name: `${unitTiming.name}:apply`,
				durationMs: elapsedMs(stageStartMs),
				status: planOnly ? 'skipped' : 'success',
			});
		} catch (error) {
			unitTiming.children?.push({
				name: `${unitTiming.name}:apply`,
				durationMs: elapsedMs(unitStartMs),
				status: 'failed',
			});
			unitTiming.durationMs = elapsedMs(unitStartMs);
			unitTiming.status = 'failed';
			wrapAdapterFailure('apply', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
		}
		if (planOnly) {
			const plannedResult = { ...(result as TreeseedReconcileResult), verification: null };
			unitTiming.durationMs = elapsedMs(unitStartMs);
			unitTiming.status = 'success';
			write?.(`Finished plan for ${plan.unit.provider}:${plan.unit.unitType} (${plan.unit.logicalName}) in ${formatDurationMs(unitTiming.durationMs)}.`);
			results.push(plannedResult);
			return;
		}
		let refreshedObserved = (result as TreeseedReconcileResult).observed;
		try {
				const stageStartMs = performance.now();
				refreshedObserved = await Promise.resolve(adapter.refresh({
					context,
					unit: plan.unit,
					persistedState: persisted,
				}));
				result = {
					...(result as TreeseedReconcileResult),
					observed: refreshedObserved,
				};
				unitTiming.children?.push({
					name: `${unitTiming.name}:refresh-after-apply`,
					durationMs: elapsedMs(stageStartMs),
					status: 'success',
				});
		} catch (error) {
				unitTiming.children?.push({
					name: `${unitTiming.name}:refresh-after-apply`,
					durationMs: elapsedMs(unitStartMs),
					status: 'failed',
				});
				unitTiming.durationMs = elapsedMs(unitStartMs);
				unitTiming.status = 'failed';
				wrapAdapterFailure('refresh', plan.unit.provider, plan.unit.unitType, plan.unit.unitId, error);
		}
		write?.(`Verifying ${plan.unit.provider}:${plan.unit.unitType} (${plan.unit.logicalName})...`);
		const postconditions = await Promise.resolve(adapter.requiredPostconditions?.({
			context,
			unit: plan.unit,
			persistedState: persisted,
		}) ?? []);
		let verification;
		try {
			const stageStartMs = performance.now();
			verification = await Promise.resolve(adapter.verify({
				context,
				unit: plan.unit,
				persistedState: persisted,
				observed: refreshedObserved,
				diff: plan.diff,
				result: result as TreeseedReconcileResult,
				postconditions,
			}));
			unitTiming.children?.push({
				name: `${unitTiming.name}:verify`,
				durationMs: elapsedMs(stageStartMs),
				status: (verification as TreeseedUnitVerificationResult).verified ? 'success' : 'failed',
			});
		} catch (error) {
			unitTiming.children?.push({
				name: `${unitTiming.name}:verify`,
				durationMs: elapsedMs(unitStartMs),
				status: 'failed',
			});
			unitTiming.durationMs = elapsedMs(unitStartMs);
			unitTiming.status = 'failed';
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
		unitTiming.durationMs = elapsedMs(unitStartMs);
		unitTiming.status = (verification as TreeseedUnitVerificationResult).verified ? 'success' : 'failed';
		write?.(`Finished ${plan.unit.provider}:${plan.unit.unitType} (${plan.unit.logicalName}) in ${formatDurationMs(unitTiming.durationMs)}.`);
		if (!(verification as TreeseedUnitVerificationResult).verified) {
			if (!planOnly) {
				await persistVerifiedResult(persisted, verifiedResult);
			}
			throw new Error(`Treeseed reconcile verification failed for ${plan.unit.provider}:${plan.unit.unitType} (${plan.unit.unitId}): ${formatVerificationFailure(verification as TreeseedUnitVerificationResult)}`);
		}
		if (!planOnly) {
			await persistVerifiedResult(persisted, verifiedResult);
		}
		results.push(verifiedResult);
	});
	if (!planOnly) {
		writeTreeseedReconcileState(tenantRoot, planned.state, env);
	}
	return {
		target,
		units: planned.units,
		plans: planned.plans,
		results,
		state: planned.state,
		timings: timingEntries,
	};
}

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
