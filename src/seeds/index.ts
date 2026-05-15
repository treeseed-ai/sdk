import { errorDiagnostic, hasSeedErrors } from './errors.js';
import { loadSeedManifest } from './loader.js';
import { resolveSelectedSeedEnvironments } from './normalize.js';
import { createSeedPlan } from './planner.js';
import { parseSeedManifest } from './schema.js';
import type { SeedPlan } from './types.js';

export { formatSeedDiagnostics, hasSeedErrors } from './errors.js';
export { formatSeedPlan } from './planner.js';
export type * from './types.js';

export function loadAndPlanSeed(input: {
	projectRoot: string;
	seedName: string;
	environments?: string;
	mode: SeedPlan['mode'];
}) {
	const loaded = loadSeedManifest(input.projectRoot, input.seedName);
	const diagnostics = [...loaded.diagnostics];
	const manifest = parseSeedManifest(loaded.value, diagnostics);
	if (!manifest) {
		return {
			ok: false,
			plan: null,
			diagnostics,
			manifestPath: loaded.path,
		};
	}
	if (manifest.name !== input.seedName) {
		diagnostics.push(errorDiagnostic('seed.name_mismatch', `Manifest name ${manifest.name} does not match requested seed ${input.seedName}.`, 'name'));
	}
	const selected = resolveSelectedSeedEnvironments(manifest, input.environments);
	for (const message of selected.errors) {
		diagnostics.push(errorDiagnostic('seed.environment_selection', message, 'environments'));
	}
	if (hasSeedErrors(diagnostics)) {
		return {
			ok: false,
			plan: null,
			diagnostics,
			manifestPath: loaded.path,
		};
	}
	return {
		ok: true,
		plan: createSeedPlan({
			manifest,
			manifestPath: loaded.path,
			environments: selected.environments,
			mode: input.mode,
			diagnostics,
		}),
		diagnostics,
		manifestPath: loaded.path,
	};
}
