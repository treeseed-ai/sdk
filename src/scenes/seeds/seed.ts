import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ControlPlaneClient, resolveControlPlaneServer, resolveControlPlaneServerSession } from '../../entrypoints/clients/control-plane-client.ts';
import { findNearestRoot } from '../../operations/workflow-support.ts';
import { loadAndPlanSeed } from '../../seeds/index.ts';
import type { SeedPlan } from '../../seeds/types.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import type { SceneSeedOptions, SceneSeedReport } from '../types.ts';

type LocalSeedRunner = (input: Record<string, unknown>) => Promise<{ plan?: SeedPlan; result?: unknown } & Record<string, unknown>>;

function redacted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redacted);
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.map(([key, entry]) => [key, /token|secret|password|credential/iu.test(key) ? '<redacted>' : redacted(entry)]));
	return value;
}

function digest(path: string) {
	return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : null;
}

async function loadLocalSeedRunner(projectRoot: string): Promise<LocalSeedRunner | null> {
	const paths = [
		resolve(projectRoot, 'src/lib/market/seeds/apply.js'),
		resolve(projectRoot, 'packages/api/dist/market/seeds/apply.js'),
		resolve(projectRoot, 'packages/api/src/market/seeds/apply.ts'),
	];
	const path = paths.find(existsSync);
	if (!path) return null;
	const loaded = path.endsWith('.ts')
		? await (await import('tsx/esm/api')).tsImport(path, import.meta.url) as Record<string, unknown>
		: await import(pathToFileURL(path).href) as Record<string, unknown>;
	return (loaded.applyLocalSeedViaApiFromCli ?? loaded.applyLocalSeedFromCli) as LocalSeedRunner | null;
}

function conflictDiagnostics(plans: SeedPlan[]) {
	const resources = new Map<string, string>();
	const diagnostics = [];
	for (const plan of plans) for (const action of plan.actions) {
		const identity = `${action.kind}:${action.key}`;
		const normalized = JSON.stringify(action.payload, Object.keys(action.payload).sort());
		const prior = resources.get(identity);
		if (prior && prior !== normalized) diagnostics.push(sceneErrorDiagnostic('scene.seed_resource_conflict', `Seed ${plan.seed} conflicts with an earlier prerequisite for ${identity}.`, 'setup.seeds'));
		else resources.set(identity, normalized);
	}
	return diagnostics;
}

export async function planOrApplySceneSeed(input: SceneSeedOptions): Promise<SceneSeedReport> {
	const requested = input.scene.setup.seeds ?? [];
	if (!requested.length) return { ok: true, requested: false, seedName: null, mode: 'none', environments: [], plan: null, result: null, diagnostics: [], seeds: [] };
	const planned = requested.map((seed) => ({ seed, loaded: loadAndPlanSeed({
		projectRoot: input.projectRoot, seedName: seed.name,
		environments: (seed.environments.length ? seed.environments : [input.environment]).join(','), mode: seed.apply ? 'apply' : 'plan',
	}) }));
	const diagnostics = planned.flatMap(({ seed, loaded }) => loaded.diagnostics.map((entry) => ({ ...entry, path: entry.path ? `setup.seeds.${seed.name}.${entry.path}` : `setup.seeds.${seed.name}` })));
	const plans = planned.flatMap((entry) => entry.loaded.plan ? [entry.loaded.plan] : []);
	diagnostics.push(...conflictDiagnostics(plans));
	if (plans.length !== requested.length || diagnostics.some((entry) => entry.severity === 'error')) {
		return { ok: false, requested: true, seedName: requested.map((entry) => entry.name).join(','), mode: requested.some((entry) => entry.apply) ? 'apply' : 'plan', environments: [...new Set(requested.flatMap((entry) => entry.environments))], plan: plans, result: null, diagnostics, seeds: [] };
	}
	const reports: NonNullable<SceneSeedReport['seeds']> = [];
	const projectRoot = findNearestRoot(input.projectRoot) ?? input.projectRoot;
	const profile = resolveControlPlaneServer(input.scene.setup.auth?.profile ?? input.environment);
	const authRoot = resolve(projectRoot, '.treeseed/auth');
	const session = resolveControlPlaneServerSession(authRoot, profile.serverId);
	const localToken = input.env?.TREESEED_CAPACITY_ACCEPTANCE_ADMIN_TOKEN?.trim() || 'tsk_local_treeseed_acceptance_admin';
	try {
		for (let index = 0; index < planned.length; index += 1) {
			const { seed, loaded } = planned[index]!;
			const plan = loaded.plan!;
			let result: unknown = null;
			if (seed.apply && input.environment !== 'local') {
				if (!session?.accessToken) throw new Error(`Not logged in to server "${profile.serverId}".`);
				result = await new ControlPlaneClient({ profile, accessToken: session.accessToken, userAgent: 'treeseed-scene' }).call({ method: 'POST', path: `/v1/seeds/${encodeURIComponent(seed.name)}/apply`, input: { environments: seed.environments } });
			} else if (seed.apply) {
				const runner = await loadLocalSeedRunner(projectRoot);
				if (!runner) throw new Error('Local seed apply service is not available in this project.');
				const applied = await runner({ projectRoot, seedName: seed.name, environments: seed.environments.join(','), plan, env: input.env, accessToken: localToken });
				result = applied.result && typeof applied.result === 'object' ? applied.result : { apply: applied.result };
			}
			reports.push({ seedName: seed.name, mode: seed.apply ? 'apply' : 'plan', environments: seed.environments, manifestDigest: digest(loaded.manifestPath), plan, result: redacted(result) });
		}
		return { ok: true, requested: true, seedName: reports.map((entry) => entry.seedName).join(','), mode: requested.some((entry) => entry.apply) ? 'apply' : 'plan', environments: [...new Set(reports.flatMap((entry) => entry.environments))], plan: plans, result: reports.map((entry) => entry.result), diagnostics, seeds: reports };
	} catch (error) {
		diagnostics.push(sceneErrorDiagnostic('scene.seed_apply_failed', error instanceof Error ? error.message : String(error), 'setup.seeds'));
		return { ok: false, requested: true, seedName: requested.map((entry) => entry.name).join(','), mode: requested.some((entry) => entry.apply) ? 'apply' : 'plan', environments: [...new Set(requested.flatMap((entry) => entry.environments))], plan: plans, result: reports.map((entry) => entry.result), diagnostics, seeds: reports };
	}
}
