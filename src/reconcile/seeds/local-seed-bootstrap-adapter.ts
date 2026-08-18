import { existsSync,readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type {
ObservedUnitState,
ReconcileAdapter,
ReconcileAdapterInput,
ReconcileResult,
UnitDiff,
UnitVerificationResult,
} from '../support/contracts/contracts.ts';
import { reconcileLocalSeedRuntime,type LocalSeedRuntimeResult } from '../../seeds/runtime/local-capacity.ts';
import type { SeedPlan } from '../../seeds/types.ts';

type LocalSeedModule = {
	planLocalSeedFromCli(input: Record<string, unknown>): Promise<Record<string, unknown>>;
	applyLocalSeedFromCli(input: Record<string, unknown>): Promise<Record<string, unknown>>;
};

const LOCAL_SEED_ACCESS_TOKEN = 'tsk_local_treeseed_acceptance_admin';

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

function providerManifestDrift(input:ReconcileAdapterInput) {
	const configured=Array.isArray(input.unit.spec.providerManifests)?input.unit.spec.providerManifests:[];
	return configured.flatMap((candidate)=>{
		const item=record(candidate); const basePath=resolve(input.context.tenantRoot,text(item.baseManifestPath)??'');
		const runtimePath=resolve(input.context.tenantRoot,text(item.runtimeManifestPath)??'');
		const seedName=text(item.seedName);
		if(!existsSync(basePath)||!existsSync(runtimePath)) return [{basePath,runtimePath,seedName,reason:'runtime_manifest_missing'}];
		try {
			const runtime=parseYaml(readFileSync(runtimePath,'utf8')) as Record<string,unknown>;
			const observed=text(record(runtime.configuration).sourceManifestDigest);
			const expected=text(item.manifestDigest);
			return observed===expected?[]:[{basePath,runtimePath,seedName,reason:'runtime_manifest_stale',expected,observed}];
		} catch(error) { return [{basePath,runtimePath,seedName,reason:'runtime_manifest_invalid',error:error instanceof Error?error.message:String(error)}]; }
	});
}

function localSeedAccessToken(input:ReconcileAdapterInput) {
	return text(input.context.launchEnv.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN) ?? LOCAL_SEED_ACCESS_TOKEN;
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
	const accessToken=localSeedAccessToken(input);
	return {
		projectRoot: input.context.tenantRoot,
		seedName: text(input.unit.spec.seedName) ?? 'treeseed',
		environments: text(input.unit.spec.environments) ?? 'local',
		env: {
			...input.context.launchEnv,
			TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN: accessToken,
		},
		accessToken,
	};
}

async function applySeed(input: ReconcileAdapterInput, module: LocalSeedModule, seedName: string) {
	let applied: Record<string, unknown>;
	try {
		applied = record(await module.applyLocalSeedFromCli({
			...seedInput(input),
			seedName,
			mode: 'apply',
			localOnly: true,
			actor: { actorType: 'service', id: 'local-seed-reconciler' },
		}));
	} catch (error) {
		throw new Error(`Local seed content reconciliation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
	}
	const plan = applied.plan as SeedPlan | undefined;
	let runtime: LocalSeedRuntimeResult = { providers: [], servicePrincipals: [] };
	if (plan) {
		try {
			runtime = await reconcileLocalSeedRuntime({
			projectRoot: input.context.tenantRoot,
			plan,
			accessToken: localSeedAccessToken(input),
			apiUrl: localSeedHostApiUrl(input),
			env: seedInput(input).env,
			});
		} catch (error) {
			throw new Error(`Local seed capacity runtime reconciliation failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	}
	return { seedName, result: record(applied.result), runtime };
}

export function localSeedHostApiUrl(input:ReconcileAdapterInput){
	return text(input.unit.spec.apiUrl) ?? 'http://127.0.0.1:3000';
}

async function observe(input: ReconcileAdapterInput): Promise<ObservedUnitState> {
	try {
		const module = await loadSeedModule(input);
		const planned = record(await module.planLocalSeedFromCli({ ...seedInput(input), mode: 'plan' }));
		const plan = record(planned.plan);
		const summary = record(plan.summary);
		const pending = pendingMutations(summary);
		const providerManifestDrifts=providerManifestDrift(input);
		return {
			exists: true,
			status: pending === 0&&providerManifestDrifts.length===0 ? 'ready' : 'drifted',
			live: {
				seedName: text(input.unit.spec.seedName) ?? 'treeseed',
				manifestDigest: text(input.unit.spec.manifestDigest),
				summary,
				pendingMutations: pending+providerManifestDrifts.length,
				seedPendingMutations: pending,providerManifestDrifts,
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
			const primarySeedName = text(input.unit.spec.seedName) ?? 'treeseed';
			const providerSeedNames = (Array.isArray(input.observed.live.providerManifestDrifts)
				? input.observed.live.providerManifestDrifts : [])
				.map((entry) => text(record(entry).seedName))
				.filter((seedName): seedName is string => Boolean(seedName));
			const seedNames = [...new Set([primarySeedName, ...providerSeedNames])];
			const applications = [];
			for (const seedName of seedNames) applications.push(await applySeed(input, module, seedName));
			const converged = await observe(input);
			if (converged.status !== 'ready' || Number(converged.live.pendingMutations ?? 0) !== 0) {
				throw new Error(`Local seed apply did not converge: ${Number(converged.live.pendingMutations ?? 0)} mutation(s) remain.`);
			}
			const primary = applications.find((entry) => entry.seedName === primarySeedName);
			return result(input, { ...converged.live, applied: primary?.result ?? {}, runtime: primary?.runtime ?? { providers: [] }, applications });
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
