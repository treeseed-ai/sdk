import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type {
	ObservedUnitState,
	ReconcileAdapter,
	ReconcileAdapterInput,
	ReconcileResult,
	UnitDiff,
	UnitVerificationResult,
} from '../support/contracts/contracts.ts';

type LocalSeedModule = {
	planLocalSeedFromCli(input: Record<string, unknown>): Promise<Record<string, unknown>>;
	applyLocalSeedFromCli(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

function text(value: unknown) {
	return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function count(summary: Record<string, unknown>, key: string) {
	const value = Number(summary[key] ?? 0);
	return Number.isFinite(value) && value >= 0 ? value : 0;
}

function pendingMutations(summary: Record<string, unknown>) {
	return count(summary, 'create') + count(summary, 'update') + count(summary, 'error');
}

async function loadSeedModule(input: ReconcileAdapterInput): Promise<LocalSeedModule> {
	const modulePath = text(input.unit.spec.applyModulePath);
	if (!modulePath || !existsSync(modulePath)) throw new Error(`Local seed apply module is missing: ${modulePath ?? '<unset>'}.`);
	let loaded: Partial<LocalSeedModule>;
	try {
		if (modulePath.endsWith('.ts')) {
			const tsxApiModule = 'tsx/esm/api';
			const api = await import(tsxApiModule) as { tsImport(path: string, parent: string): Promise<unknown> };
			loaded = await api.tsImport(modulePath, import.meta.url) as Partial<LocalSeedModule>;
		} else {
			loaded = await import(pathToFileURL(modulePath).href) as Partial<LocalSeedModule>;
		}
	} catch (sourceError) {
		const compiledPath = text(input.unit.spec.compiledApplyModulePath);
		if (!compiledPath || !existsSync(compiledPath)) throw sourceError;
		loaded = await import(pathToFileURL(compiledPath).href) as Partial<LocalSeedModule>;
	}
	if (typeof loaded.planLocalSeedFromCli !== 'function' || typeof loaded.applyLocalSeedFromCli !== 'function') {
		throw new Error(`Local seed module ${modulePath} does not expose the canonical plan/apply operations.`);
	}
	return loaded as LocalSeedModule;
}

function seedInput(input: ReconcileAdapterInput) {
	return {
		projectRoot: input.context.tenantRoot,
		seedName: text(input.unit.spec.seedName) ?? 'treeseed',
		environments: text(input.unit.spec.environments) ?? 'local',
		env: input.context.launchEnv,
	};
}

async function observe(input: ReconcileAdapterInput): Promise<ObservedUnitState> {
	try {
		const module = await loadSeedModule(input);
		const planned = record(await module.planLocalSeedFromCli({ ...seedInput(input), mode: 'plan' }));
		const plan = record(planned.plan);
		const summary = record(plan.summary);
		const pending = pendingMutations(summary);
		return {
			exists: true,
			status: pending === 0 ? 'ready' : 'drifted',
			live: {
				seedName: text(input.unit.spec.seedName) ?? 'treeseed',
				manifestDigest: text(input.unit.spec.manifestDigest),
				summary,
				pendingMutations: pending,
			},
			locators: { manifestPath: text(input.unit.spec.manifestPath) },
			warnings: [],
		};
	} catch (error) {
		return {
			exists: false,
			status: 'error',
			live: {},
			locators: { manifestPath: text(input.unit.spec.manifestPath) },
			warnings: [error instanceof Error ? error.message : String(error)],
		};
	}
}

function result(
	input: ReconcileAdapterInput & { observed: ObservedUnitState; diff: UnitDiff },
	state: Record<string, unknown>,
): ReconcileResult {
	return {
		unit: input.unit,
		observed: input.observed,
		diff: input.diff,
		action: input.diff.action,
		warnings: input.observed.warnings,
		resourceLocators: input.observed.locators,
		state,
		verification: null,
	};
}

export function createLocalSeedBootstrapAdapter(): ReconcileAdapter {
	return {
		providerId: 'local',
		unitTypes: ['local-seed-bootstrap'],
		supports: (unitType, providerId) => unitType === 'local-seed-bootstrap' && providerId === 'local',
		refresh: observe,
		diff(input) {
			if (input.observed.status === 'error') {
				return { action: 'blocked', reasons: input.observed.warnings, before: input.observed.live, after: input.unit.spec };
			}
			const pending = Number(input.observed.live.pendingMutations ?? 0);
			return pending > 0
				? { action: 'update', reasons: [`${pending} local seed mutations remain`], before: input.observed.live, after: input.unit.spec }
				: { action: 'noop', reasons: [], before: input.observed.live, after: input.unit.spec };
		},
		async apply(input) {
			if (input.diff.action === 'noop' || input.diff.action === 'blocked') return result(input, input.observed.live);
			const module = await loadSeedModule(input);
			const applied = await module.applyLocalSeedFromCli({
				...seedInput(input),
				mode: 'apply',
				localOnly: true,
				actor: { actorType: 'service', id: 'local-seed-reconciler' },
			});
			const converged = await observe(input);
			if (converged.status !== 'ready' || Number(converged.live.pendingMutations ?? 0) !== 0) {
				throw new Error(`Local seed apply did not converge: ${Number(converged.live.pendingMutations ?? 0)} mutation(s) remain.`);
			}
			return result(input, { ...converged.live, applied: record(applied.result) });
		},
		async verify(input): Promise<UnitVerificationResult> {
			const pending = Number(input.observed.live.pendingMutations ?? 0);
			const verified = input.observed.status === 'ready' && pending === 0;
			return {
				unitId: input.unit.unitId,
				supported: true,
				exists: input.observed.exists,
				configured: true,
				ready: verified,
				verified,
				checks: [{
					key: 'local-seed.converged',
					description: 'Local seed desired state is fully converged',
					source: 'sdk',
					exists: input.observed.exists,
					configured: true,
					ready: verified,
					verified,
					expected: 0,
					observed: pending,
					issues: verified ? [] : [`${pending} seed mutations remain.`],
				}],
				missing: input.observed.exists ? [] : ['Local seed plan is unavailable.'],
				drifted: verified ? [] : ['Local seed desired state is not converged.'],
				warnings: input.observed.warnings,
			};
		},
	};
}
