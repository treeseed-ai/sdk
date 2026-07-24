import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { MarketClient, resolveMarketProfile, resolveMarketSession } from '../../entrypoints/clients/market-client.ts';
import { loadAndPlanSeed } from '../../seeds/index.ts';
import { findNearestRoot } from '../../operations/workflow-support.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import type { SceneSeedOptions, SceneSeedReport } from '../types.ts';

type LocalSeedRunner = (input: Record<string, unknown>) => Promise<{ plan?: unknown; result?: unknown } & Record<string, unknown>>;

function redacted(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(redacted);
	if (value && typeof value === 'object') {
		const out: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
			out[key] = /token|secret|key|password/iu.test(key) ? '<redacted>' : redacted(entry);
		}
		return out;
	}
	return value;
}

async function loadLocalSeedRunner(projectRoot: string): Promise<LocalSeedRunner | null> {
	const applyModulePath = resolve(projectRoot, 'src', 'lib', 'market', 'seeds', 'apply.js');
	if (!existsSync(applyModulePath)) return null;
	const module = await import(pathToFileURL(applyModulePath).href) as {
		applyLocalSeedViaApiFromCli?: LocalSeedRunner;
		applyLocalSeedFromCli?: LocalSeedRunner;
	};
	return module.applyLocalSeedViaApiFromCli ?? module.applyLocalSeedFromCli ?? null;
}

export async function planOrApplySceneSeed(input: SceneSeedOptions): Promise<SceneSeedReport> {
	const setup = input.scene.setup.seed;
	if (!setup?.name) {
		return { ok: true, requested: false, seedName: null, mode: 'none', environments: [], plan: null, result: null, diagnostics: [] };
	}
	const environments = setup.environments.length > 0 ? setup.environments : [input.environment];
	const mode = setup.apply ? 'apply' : 'plan';
	const planned = loadAndPlanSeed({
		projectRoot: input.projectRoot,
		seedName: setup.name,
		environments: environments.join(','),
		mode,
	});
	const diagnostics = [...planned.diagnostics.map((entry) => ({
		severity: entry.severity,
		code: entry.code.startsWith('scene.') ? entry.code : `seed.${entry.code}`,
		message: entry.message,
		path: entry.path ? `setup.seed.${entry.path}` : 'setup.seed',
	}))];
	if (!planned.plan) {
		diagnostics.push(sceneErrorDiagnostic('scene.seed_plan_failed', `Seed "${setup.name}" could not be planned.`, 'setup.seed'));
		return { ok: false, requested: true, seedName: setup.name, mode, environments, plan: null, result: null, diagnostics };
	}
	if (!setup.apply) {
		return { ok: !diagnostics.some((entry) => entry.severity === 'error'), requested: true, seedName: setup.name, mode: 'plan', environments, plan: planned.plan, result: null, diagnostics };
	}
	try {
		if (environments.some((environment) => environment !== 'local')) {
			const profile = resolveMarketProfile(input.scene.setup.auth?.profile ?? null);
			const authRoot = findNearestRoot(input.projectRoot) ?? input.projectRoot;
			const session = resolveMarketSession(authRoot, profile.id);
			if (!session?.accessToken) {
				throw sceneErrorDiagnostic('scene.auth_required', `Not logged in to market "${profile.id}". Run treeseed auth:login --market ${profile.id}.`, 'setup.auth');
			}
			const client = new MarketClient({ profile, accessToken: session.accessToken, userAgent: 'treeseed-scene' });
			const result = await client.applySeed(setup.name, { environments });
			return { ok: true, requested: true, seedName: setup.name, mode: 'apply', environments, plan: planned.plan, result: redacted(result), diagnostics };
		}
		const runner = await loadLocalSeedRunner(input.projectRoot);
		if (!runner) {
			diagnostics.push(sceneErrorDiagnostic('scene.seed_apply_failed', 'Local seed apply service is not available in this project.', 'setup.seed'));
			return { ok: false, requested: true, seedName: setup.name, mode: 'apply', environments, plan: planned.plan, result: null, diagnostics };
		}
		const applied = await runner({
			projectRoot: input.projectRoot,
			seedName: setup.name,
			environments: environments.join(','),
			plan: planned.plan,
			env: input.env,
		});
		return { ok: true, requested: true, seedName: setup.name, mode: 'apply', environments, plan: applied.plan ?? planned.plan, result: redacted(applied.result ?? applied), diagnostics };
	} catch (error) {
		const diagnostic = error && typeof error === 'object' && 'code' in error
			? error as ReturnType<typeof sceneErrorDiagnostic>
			: sceneErrorDiagnostic('scene.seed_apply_failed', error instanceof Error ? error.message : String(error ?? 'Seed apply failed.'), 'setup.seed');
		return { ok: false, requested: true, seedName: setup.name, mode: 'apply', environments, plan: planned.plan, result: null, diagnostics: [...diagnostics, diagnostic] };
	}
}
