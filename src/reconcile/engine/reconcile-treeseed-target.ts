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
import { planTreeseedReconciliation } from './refresh-treeseed-units.ts';
import { createRunContext, formatVerificationFailure, persistResult, runByDependencyLevel, wrapAdapterFailure } from './now-iso.ts';

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
