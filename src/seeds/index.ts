import { errorDiagnostic,hasSeedErrors } from './errors.js';
import { loadSeedManifest } from './loader.js';
import { resolveSelectedSeedEnvironments } from './normalize.js';
import { createSeedPlan } from './planner.js';
import { parseSeedManifest } from './schema.js';
import type { SeedPlan } from './types.js';
import { parseDocument } from 'yaml';
import { compileSeedRepositoryUnits } from './reconciliation/repository-units.js';

export { formatSeedDiagnostics,hasSeedErrors } from './errors.js';
export { formatSeedPlan } from './planner.js';
export { compileSeedRepositoryUnits };
export { applySeedContentRepositoryHistory, planSeedContentRepositoryHistory } from './repositories/repository-history.js';
export { classifyContentCutover, planContentCutover, recordContentCutover, removeVerifiedSoftwareContent, type ContentCutoverEvidence, type ContentCutoverPlan } from './repositories/content-cutover.js';
export type { ContentRepositoryHistoryPlan } from './repositories/repository-history.js';
export { applySeedSourceRepositoryHistory, planSeedSourceRepositoryHistory } from './repositories/source-repository-history.js';
export type { SourceRepositoryHistoryPlan } from './repositories/source-repository-history.js';
export { applySupportRepositoryWorkflow, planSupportRepositoryWorkflow } from './repositories/support-repository-workflow.js';
export type { SupportWorkflowPlan } from './repositories/support-repository-workflow.js';
export { applyOrganizationReferenceMigration, planOrganizationReferenceMigration } from './repositories/organization-reference-migration.js';
export { applyPlatformWorkspace, planPlatformWorkspace } from './workspaces/platform-workspace-history.js';
export type { PlatformWorkspacePlan } from './workspaces/platform-workspace-history.js';
export { applyAdminDescriptorMigration, planAdminDescriptorMigration } from './workspaces/admin-descriptor-migration.js';
export type { AdminDescriptorMigrationPlan } from './workspaces/admin-descriptor-migration.js';
export { applyPortfolioLicense, planPortfolioLicense } from './licensing/portfolio-license.js';
export type { PortfolioLicensePlan } from './licensing/portfolio-license.js';
export type * from './types.js';

export function validateSeedSource(source: string) {
	const diagnostics = [] as import('./types.js').SeedDiagnostic[];
	const document = parseDocument(source, { prettyErrors: false });
	for (const issue of document.errors) diagnostics.push(errorDiagnostic('seed.yaml_parse_error', issue.message, 'manifest'));
	const manifest = diagnostics.length ? null : parseSeedManifest(document.toJSON(), diagnostics);
	return { ok: Boolean(manifest) && !hasSeedErrors(diagnostics), manifest: hasSeedErrors(diagnostics) ? null : manifest, diagnostics };
}

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

export function loadAndCompileSeedRepositoryUnits(input: {
	projectRoot: string;
	seedName: string;
	environment: import('./types.js').SeedEnvironment;
}) {
	const loaded = loadSeedManifest(input.projectRoot, input.seedName);
	const diagnostics = [...loaded.diagnostics];
	const manifest = parseSeedManifest(loaded.value, diagnostics);
	if (!manifest || hasSeedErrors(diagnostics)) return { ok: false, manifest: null, units: [], diagnostics, manifestPath: loaded.path };
	if (!manifest.environments.includes(input.environment)) {
		diagnostics.push(errorDiagnostic('seed.environment_selection', `Seed ${manifest.name} does not declare environment: ${input.environment}.`, 'environments'));
		return { ok: false, manifest: null, units: [], diagnostics, manifestPath: loaded.path };
	}
	return {
		ok: true,
		manifest,
		units: compileSeedRepositoryUnits(manifest, input.environment),
		diagnostics,
		manifestPath: loaded.path,
	};
}
