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


export const FILESYSTEM_SAFE_SCENE_ID = /^[a-z0-9][a-z0-9._-]*$/u;

export const TOP_LEVEL_FIELDS = new Set(['schemaVersion', 'id', 'title', 'description', 'audience', 'journey', 'mode', 'target', 'devices', 'setup', 'artifacts', 'workflow', 'chapters', 'overlays', 'diagrams', 'render', 'runtime', 'training', 'visualAudit', 'xScenario']);

export const FILESYSTEM_SAFE_CHECKPOINT_ID = /^[a-z0-9][a-z0-9._-]*$/u;

export const DIAGRAM_PLACEMENTS = ['overlay', 'interstitial', 'standalone'] as const;

export const CAPTION_FORMATS = ['vtt', 'srt'] as const;

export const TRANSCRIPT_FORMATS = ['json', 'markdown'] as const;

export const NARRATION_STYLES = ['concise', 'instructional', 'operator'] as const;

export const EVIDENCE_FITS = ['fixed-browser', 'contain', 'cover'] as const;

export const DEVICE_ORIENTATIONS = ['landscape', 'portrait'] as const;

export const DEVICE_BROWSER_CHROME = ['desktop', 'tablet', 'mobile'] as const;

export const VISUAL_UNITS = ['px', 'percent'] as const;

export const VISUAL_REGIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;

export const VISUAL_TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'brand'] as const;

export const VISUAL_SHADOWS = ['none', 'soft', 'medium', 'strong'] as const;

export const MOTION_UNITS = ['seconds', 'progress'] as const;

export const MOTION_EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;

export const VISUAL_OBJECT_TYPES = ['text', 'box', 'circle', 'line', 'arrow', 'badge', 'cursor', 'spotlight'] as const;

export const OVERLAY_VARIANTS = ['callout', 'spotlight', 'label', 'panel', 'lower-third', 'badge', 'cursor', 'custom'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

export function requireString(record: Record<string, unknown>, field: string, path: string, diagnostics: SceneDiagnostic[]) {
	const value = asString(record[field]);
	if (!value) {
		diagnostics.push(sceneErrorDiagnostic('scene.missing_field', `Missing required field: ${field}.`, `${path}.${field}`));
	}
	return value;
}

export function optionalString(record: Record<string, unknown>, field: string) {
	return asString(record[field]) || undefined;
}

export function booleanField(record: Record<string, unknown>, field: string, defaultValue: boolean, path: string, diagnostics: SceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (typeof value !== 'boolean') {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_boolean', `Expected ${field} to be a boolean.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

export function positiveNumberField(record: Record<string, unknown>, field: string, defaultValue: number | undefined, path: string, diagnostics: SceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_number', `Expected ${field} to be a positive finite number.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

export function finiteNumberField(record: Record<string, unknown>, field: string, defaultValue: number | undefined, path: string, diagnostics: SceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_number', `Expected ${field} to be a finite number.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

export function nullablePositiveNumberField(record: Record<string, unknown>, field: string, defaultValue: number | null, path: string, diagnostics: SceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_number', `Expected ${field} to be a positive finite number or null.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

export function objectField(record: Record<string, unknown>, field: string, path: string, diagnostics: SceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_object', `Expected ${field} to be an object.`, `${path}.${field}`));
		return undefined;
	}
	return value;
}

export function arrayField(record: Record<string, unknown>, field: string, path: string, diagnostics: SceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_array', `Expected ${field} to be an array.`, `${path}.${field}`));
		return undefined;
	}
	return value;
}

export function stringArrayField(record: Record<string, unknown>, field: string, path: string, diagnostics: SceneDiagnostic[]) {
	const value = arrayField(record, field, path, diagnostics);
	if (!value) return [];
	const strings: string[] = [];
	value.forEach((entry, index) => {
		const text = asString(entry);
		if (!text) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_string', `Expected ${field} entry to be a non-empty string.`, `${path}.${field}[${index}]`));
			return;
		}
		strings.push(text);
	});
	return strings;
}

export function stateRefArray(record: Record<string, unknown>, field: string, path: string, diagnostics: SceneDiagnostic[]) {
	const value = arrayField(record, field, path, diagnostics);
	if (!value) return undefined;
	const refs: Array<{ key: string; kind: string }> = [];
	value.forEach((entry, index) => {
		const entryPath = `${path}.${field}[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_state_ref', `Expected ${field} entry to be an object.`, entryPath));
			return;
		}
		refs.push({ key: requireString(entry, 'key', entryPath, diagnostics), kind: requireString(entry, 'kind', entryPath, diagnostics) });
	});
	return refs;
}

export function parseJourney(record: Record<string, unknown>, diagnostics: SceneDiagnostic[]) {
	const journey = objectField(record, 'journey', 'manifest', diagnostics);
	if (!journey) return undefined;
	const kind = optionalString(journey, 'kind');
	if (kind && !['service', 'page', 'visual-audit'].includes(kind)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_journey_kind', `Unsupported journey kind: ${kind}.`, 'journey.kind'));
	return {
		kind: (kind === 'page' || kind === 'visual-audit' ? kind : 'service') as 'service' | 'page' | 'visual-audit',
		proves: stringArrayField(journey, 'proves', 'journey', diagnostics),
		minimumSteps: positiveNumberField(journey, 'minimumSteps', undefined, 'journey', diagnostics),
		requiresInteractiveAction: booleanField(journey, 'requiresInteractiveAction', false, 'journey', diagnostics),
		producesState: stateRefArray(journey, 'producesState', 'journey', diagnostics),
		consumesState: stateRefArray(journey, 'consumesState', 'journey', diagnostics),
	};
}

export function enumArrayField<T extends readonly string[]>(record: Record<string, unknown>, field: string, allowed: T, defaultValue: T[number][], path: string, diagnostics: SceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (!Array.isArray(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_array', `Expected ${field} to be an array.`, `${path}.${field}`));
		return defaultValue;
	}
	const result: T[number][] = [];
	value.forEach((entry, index) => {
		const text = asString(entry);
		if (!(allowed as readonly string[]).includes(text)) {
			diagnostics.push(sceneErrorDiagnostic('scene.training_invalid_config', `Unsupported ${field} entry: ${text}.`, `${path}.${field}[${index}]`));
			return;
		}
		result.push(text as T[number]);
	});
	return result.length > 0 ? [...new Set(result)] : defaultValue;
}

export function parseEnvironment(value: unknown, path: string, diagnostics: SceneDiagnostic[], defaultValue: SceneEnvironment): SceneEnvironment {
	const environment = asString(value) || defaultValue;
	if (!(SCENE_ENVIRONMENTS as readonly string[]).includes(environment)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_environment', `Unknown environment: ${environment}.`, path));
		return defaultValue;
	}
	return environment as SceneEnvironment;
}

export function parseBrowser(value: unknown, path: string, diagnostics: SceneDiagnostic[]): SceneBrowser {
	const browser = asString(value) || 'chromium';
	if (!(SCENE_BROWSERS as readonly string[]).includes(browser)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_browser', `Unknown browser: ${browser}.`, path));
		return 'chromium';
	}
	return browser as SceneBrowser;
}

export function parseSelector(value: unknown, path: string, diagnostics: SceneDiagnostic[]): SceneSelector | null {
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_selector', 'Expected selector to be an object.', path));
		return null;
	}
	const keys = ['scene', 'testId', 'role', 'text', 'css'].filter((key) => value[key] !== undefined);
	if (keys.length !== 1) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_selector', 'Expected selector to define exactly one of scene, testId, role, text, or css.', path));
		return null;
	}
	if (value.scene !== undefined) return { scene: requireString(value, 'scene', path, diagnostics) };
	if (value.testId !== undefined) return { testId: requireString(value, 'testId', path, diagnostics) };
	if (value.role !== undefined) return { role: requireString(value, 'role', path, diagnostics), ...(optionalString(value, 'name') ? { name: optionalString(value, 'name') } : {}) };
	if (value.text !== undefined) return { text: requireString(value, 'text', path, diagnostics) };
	const css = requireString(value, 'css', path, diagnostics);
	const brittle = booleanField(value, 'brittle', false, path, diagnostics);
	const internal = booleanField(value, 'internal', false, path, diagnostics);
	if (!brittle && !internal) {
		diagnostics.push(sceneWarningDiagnostic('scene.raw_css_selector', 'CSS selector should be marked brittle or internal.', `${path}.css`));
	}
	return { css, ...(brittle ? { brittle } : {}), ...(internal ? { internal } : {}) };
}
