import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../support/reporting/diagnostics.ts';
import { findBuiltInSceneAction, findBuiltInSceneAssertion } from '../support/plugins/registry.ts';
import {
	SCENE_BROWSERS,
	SCENE_ENVIRONMENTS,
	SCENE_SCHEMA_VERSION,
	type SceneAction,
	type SceneArtifacts,
	type SceneBrowser,
	type SceneChapter,
	type SceneDeviceConfig,
	type SceneDeviceProfile,
	type SceneDiagram,
	type SceneDiagnostic,
	type SceneEnvironment,
	type SceneExpectation,
	type SceneManifest,
	type SceneMode,
	type SceneMotion,
	type SceneOverlay,
	type SceneOverlayVariant,
	type SceneRenderConfig,
	type SceneRenderEvidenceFit,
	type SceneRuntimeConfig,
	type SceneSelector,
	type SceneSetup,
	type SceneTarget,
	type SceneTrainingConfig,
	type SceneVisualAuditConfig,
	type SceneVisualObject,
	type SceneVisualPoint,
	type SceneVisualRegion,
	type SceneVisualSize,
	type SceneVisualStyle,
	type SceneWorkflowStep,
} from '../types.ts';
import { defaultSceneVisualAuditConfig, parseDiagrams, parseRender, parseRuntime, parseTraining } from './parse-diagrams.ts';
import { FILESYSTEM_SAFE_SCENE_ID, TOP_LEVEL_FIELDS, booleanField, isRecord, objectField, optionalString, parseJourney, requireString, stringArrayField } from './filesystem-safe-scene-id.ts';
import { expectationKeys, parseArtifacts, parseDevices, parseMode, parseSetup, parseTarget } from './parse-action.ts';
import { parseChapters, parseOverlays, parseWorkflow } from './parse-workflow.ts';

export function parseVisualAudit(value: unknown, diagnostics: SceneDiagnostic[]): SceneVisualAuditConfig {
	const defaults = defaultSceneVisualAuditConfig();
	if (value === undefined) return defaults;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_object', 'Expected visualAudit to be an object.', 'visualAudit'));
		return defaults;
	}
	for (const key of Object.keys(value)) {
		if (!['enabled', 'roles', 'pathRoots', 'pathGlobs', 'excludePathGlobs', 'includeFullPage', 'review', 'routeDiscovery'].includes(key)) {
			diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_unknown_field', `Unknown visual audit field: ${key}.`, `visualAudit.${key}`));
		}
	}
	const roles = stringArrayField(value, 'roles', 'visualAudit', diagnostics);
	if (value.roles !== undefined && roles.length === 0) {
		diagnostics.push(sceneErrorDiagnostic('scene.visual_audit_invalid_roles', 'Visual audit roles must include at least one role.', 'visualAudit.roles'));
	}
	const rawPathRoots = stringArrayField(value, 'pathRoots', 'visualAudit', diagnostics);
	const pathRoots = rawPathRoots.filter((entry, index) => {
		const ok = entry.startsWith('/');
		if (!ok) diagnostics.push(sceneErrorDiagnostic('scene.visual_audit_invalid_path_root', `Visual audit path root must start with "/": ${entry}.`, `visualAudit.pathRoots[${index}]`));
		return ok;
	});
	const pathGlobs = stringArrayField(value, 'pathGlobs', 'visualAudit', diagnostics).filter(Boolean);
	const excludePathGlobs = stringArrayField(value, 'excludePathGlobs', 'visualAudit', diagnostics).filter(Boolean);
	const routeDiscovery = objectField(value, 'routeDiscovery', 'visualAudit', diagnostics);
	if (routeDiscovery) {
		for (const key of Object.keys(routeDiscovery)) {
			if (!['core', 'admin', 'tenantOverrides', 'contentCollections'].includes(key)) {
				diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_unknown_field', `Unknown visual audit routeDiscovery field: ${key}.`, `visualAudit.routeDiscovery.${key}`));
			}
		}
	}
	const review = objectField(value, 'review', 'visualAudit', diagnostics);
	if (review) {
		for (const key of Object.keys(review)) {
			if (!['enabled', 'detail', 'maxFindings', 'contactSheets'].includes(key)) {
				diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_unknown_field', `Unknown visual audit review field: ${key}.`, `visualAudit.review.${key}`));
			}
		}
	}
	const rawReviewDetail = review && typeof review.detail === 'string' ? review.detail : defaults.review.detail;
	const reviewDetail = ['summary', 'standard', 'full'].includes(rawReviewDetail) ? rawReviewDetail as SceneVisualAuditConfig['review']['detail'] : defaults.review.detail;
	if (review && review.detail !== undefined && reviewDetail !== review.detail) {
		diagnostics.push(sceneErrorDiagnostic('scene.visual_audit_invalid_review_detail', 'Visual audit review detail must be summary, standard, or full.', 'visualAudit.review.detail'));
	}
	const rawMaxFindings = review?.maxFindings;
	const maxFindings = typeof rawMaxFindings === 'number' && Number.isInteger(rawMaxFindings) && rawMaxFindings > 0 ? rawMaxFindings : defaults.review.maxFindings;
	if (rawMaxFindings !== undefined && maxFindings !== rawMaxFindings) {
		diagnostics.push(sceneErrorDiagnostic('scene.visual_audit_invalid_max_findings', 'Visual audit review maxFindings must be a positive integer.', 'visualAudit.review.maxFindings'));
	}
	return {
		enabled: booleanField(value, 'enabled', defaults.enabled, 'visualAudit', diagnostics),
		roles: value.roles === undefined ? defaults.roles : roles,
		pathRoots: value.pathRoots === undefined ? defaults.pathRoots : pathRoots,
		pathGlobs: value.pathGlobs === undefined ? defaults.pathGlobs : pathGlobs,
		excludePathGlobs: value.excludePathGlobs === undefined ? defaults.excludePathGlobs : excludePathGlobs,
		includeFullPage: booleanField(value, 'includeFullPage', defaults.includeFullPage, 'visualAudit', diagnostics),
		review: {
			enabled: review ? booleanField(review, 'enabled', defaults.review.enabled, 'visualAudit.review', diagnostics) : defaults.review.enabled,
			detail: reviewDetail,
			maxFindings,
			contactSheets: review ? booleanField(review, 'contactSheets', defaults.review.contactSheets, 'visualAudit.review', diagnostics) : defaults.review.contactSheets,
		},
		routeDiscovery: {
			core: routeDiscovery ? booleanField(routeDiscovery, 'core', true, 'visualAudit.routeDiscovery', diagnostics) : defaults.routeDiscovery.core,
			admin: routeDiscovery ? booleanField(routeDiscovery, 'admin', true, 'visualAudit.routeDiscovery', diagnostics) : defaults.routeDiscovery.admin,
			tenantOverrides: routeDiscovery ? booleanField(routeDiscovery, 'tenantOverrides', true, 'visualAudit.routeDiscovery', diagnostics) : defaults.routeDiscovery.tenantOverrides,
			contentCollections: routeDiscovery ? booleanField(routeDiscovery, 'contentCollections', true, 'visualAudit.routeDiscovery', diagnostics) : defaults.routeDiscovery.contentCollections,
		},
	};
}

export function actionKind(action: SceneAction) {
	return Object.keys(action)[0] ?? '';
}

export function sceneActionKind(action: SceneAction) {
	return actionKind(action);
}

export function sceneExpectationKinds(expectation: SceneExpectation | undefined) {
	return expectationKeys(expectation);
}

export function parseSceneManifest(value: unknown, diagnostics: SceneDiagnostic[]): SceneManifest | null {
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_manifest', 'Expected scene manifest to be an object.', 'manifest'));
		return null;
	}
	for (const key of Object.keys(value)) {
		if (!TOP_LEVEL_FIELDS.has(key)) diagnostics.push(sceneWarningDiagnostic('scene.unknown_field', `Unknown top-level field: ${key}.`, key));
	}
	const schemaVersion = requireString(value, 'schemaVersion', 'manifest', diagnostics);
	if (schemaVersion && schemaVersion !== SCENE_SCHEMA_VERSION) diagnostics.push(sceneErrorDiagnostic('scene.unsupported_schema_version', `Unsupported scene schema version: ${schemaVersion}.`, 'schemaVersion'));
	const id = requireString(value, 'id', 'manifest', diagnostics);
	if (id && !FILESYSTEM_SAFE_SCENE_ID.test(id)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_id', `Invalid scene id: ${id}.`, 'id'));
	const title = requireString(value, 'title', 'manifest', diagnostics);
	const target = parseTarget(value.target, diagnostics);
	const devices = parseDevices(value.devices, target, diagnostics);
	const mode = parseMode(value.mode, diagnostics);
	const workflow = parseWorkflow(value.workflow, diagnostics);
	if (workflow.length > 10 && !Array.isArray(value.chapters)) diagnostics.push(sceneErrorDiagnostic('scene.missing_chapters', 'Scenes with more than 10 workflow steps must define chapters.', 'chapters'));
	const stepIds = new Set(workflow.map((step) => step.id));
	return {
		schemaVersion: SCENE_SCHEMA_VERSION,
		id,
		title,
		description: optionalString(value, 'description'),
		audience: stringArrayField(value, 'audience', 'manifest', diagnostics),
		journey: parseJourney(value, diagnostics),
		mode,
		target,
		devices,
		setup: parseSetup(value.setup, target.environment, diagnostics),
		artifacts: parseArtifacts(value.artifacts, diagnostics),
		workflow,
		chapters: parseChapters(value.chapters, stepIds, diagnostics),
		overlays: parseOverlays(value.overlays, stepIds, diagnostics),
		diagrams: parseDiagrams(value.diagrams, stepIds, diagnostics),
		render: parseRender(value.render, diagnostics),
		runtime: parseRuntime(value.runtime, mode, diagnostics),
		training: parseTraining(value.training, stepIds, diagnostics),
		visualAudit: parseVisualAudit(value.visualAudit, diagnostics),
	};
}
