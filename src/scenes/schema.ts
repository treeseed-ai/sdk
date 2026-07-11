import { sceneErrorDiagnostic, sceneWarningDiagnostic } from './diagnostics.ts';
import { findBuiltInTreeseedSceneAction, findBuiltInTreeseedSceneAssertion } from './registry.ts';
import {
	TREESEED_SCENE_BROWSERS,
	TREESEED_SCENE_ENVIRONMENTS,
	TREESEED_SCENE_SCHEMA_VERSION,
	type TreeseedSceneAction,
	type TreeseedSceneArtifacts,
	type TreeseedSceneBrowser,
	type TreeseedSceneChapter,
	type TreeseedSceneDeviceConfig,
	type TreeseedSceneDeviceProfile,
	type TreeseedSceneDiagram,
	type TreeseedSceneDiagnostic,
	type TreeseedSceneEnvironment,
	type TreeseedSceneExpectation,
	type TreeseedSceneManifest,
	type TreeseedSceneMode,
	type TreeseedSceneMotion,
	type TreeseedSceneOverlay,
	type TreeseedSceneOverlayVariant,
	type TreeseedSceneRenderConfig,
	type TreeseedSceneRenderEvidenceFit,
	type TreeseedSceneRuntimeConfig,
	type TreeseedSceneSelector,
	type TreeseedSceneSetup,
	type TreeseedSceneTarget,
	type TreeseedSceneTrainingConfig,
	type TreeseedSceneVisualAuditConfig,
	type TreeseedSceneVisualObject,
	type TreeseedSceneVisualPoint,
	type TreeseedSceneVisualRegion,
	type TreeseedSceneVisualSize,
	type TreeseedSceneVisualStyle,
	type TreeseedSceneWorkflowStep,
} from './types.ts';

const FILESYSTEM_SAFE_SCENE_ID = /^[a-z0-9][a-z0-9._-]*$/u;
const TOP_LEVEL_FIELDS = new Set(['schemaVersion', 'id', 'title', 'description', 'audience', 'journey', 'mode', 'target', 'devices', 'setup', 'artifacts', 'workflow', 'chapters', 'overlays', 'diagrams', 'render', 'runtime', 'training', 'visualAudit', 'xScenario']);
const FILESYSTEM_SAFE_CHECKPOINT_ID = /^[a-z0-9][a-z0-9._-]*$/u;
const DIAGRAM_PLACEMENTS = ['overlay', 'interstitial', 'standalone'] as const;
const CAPTION_FORMATS = ['vtt', 'srt'] as const;
const TRANSCRIPT_FORMATS = ['json', 'markdown'] as const;
const NARRATION_STYLES = ['concise', 'instructional', 'operator'] as const;
const EVIDENCE_FITS = ['fixed-browser', 'contain', 'cover'] as const;
const DEVICE_ORIENTATIONS = ['landscape', 'portrait'] as const;
const DEVICE_BROWSER_CHROME = ['desktop', 'tablet', 'mobile'] as const;
const VISUAL_UNITS = ['px', 'percent'] as const;
const VISUAL_REGIONS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'] as const;
const VISUAL_TONES = ['neutral', 'info', 'success', 'warning', 'danger', 'brand'] as const;
const VISUAL_SHADOWS = ['none', 'soft', 'medium', 'strong'] as const;
const MOTION_UNITS = ['seconds', 'progress'] as const;
const MOTION_EASINGS = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;
const VISUAL_OBJECT_TYPES = ['text', 'box', 'circle', 'line', 'arrow', 'badge', 'cursor', 'spotlight'] as const;
const OVERLAY_VARIANTS = ['callout', 'spotlight', 'label', 'panel', 'lower-third', 'badge', 'cursor', 'custom'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

function requireString(record: Record<string, unknown>, field: string, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const value = asString(record[field]);
	if (!value) {
		diagnostics.push(sceneErrorDiagnostic('scene.missing_field', `Missing required field: ${field}.`, `${path}.${field}`));
	}
	return value;
}

function optionalString(record: Record<string, unknown>, field: string) {
	return asString(record[field]) || undefined;
}

function booleanField(record: Record<string, unknown>, field: string, defaultValue: boolean, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (typeof value !== 'boolean') {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_boolean', `Expected ${field} to be a boolean.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

function positiveNumberField(record: Record<string, unknown>, field: string, defaultValue: number | undefined, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_number', `Expected ${field} to be a positive finite number.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

function finiteNumberField(record: Record<string, unknown>, field: string, defaultValue: number | undefined, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_number', `Expected ${field} to be a finite number.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

function nullablePositiveNumberField(record: Record<string, unknown>, field: string, defaultValue: number | null, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return defaultValue;
	if (value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_number', `Expected ${field} to be a positive finite number or null.`, `${path}.${field}`));
		return defaultValue;
	}
	return value;
}

function objectField(record: Record<string, unknown>, field: string, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_object', `Expected ${field} to be an object.`, `${path}.${field}`));
		return undefined;
	}
	return value;
}

function arrayField(record: Record<string, unknown>, field: string, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const value = record[field];
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_array', `Expected ${field} to be an array.`, `${path}.${field}`));
		return undefined;
	}
	return value;
}

function stringArrayField(record: Record<string, unknown>, field: string, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
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

function stateRefArray(record: Record<string, unknown>, field: string, path: string, diagnostics: TreeseedSceneDiagnostic[]) {
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

function parseJourney(record: Record<string, unknown>, diagnostics: TreeseedSceneDiagnostic[]) {
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

function enumArrayField<T extends readonly string[]>(record: Record<string, unknown>, field: string, allowed: T, defaultValue: T[number][], path: string, diagnostics: TreeseedSceneDiagnostic[]) {
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

function parseEnvironment(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[], defaultValue: TreeseedSceneEnvironment): TreeseedSceneEnvironment {
	const environment = asString(value) || defaultValue;
	if (!(TREESEED_SCENE_ENVIRONMENTS as readonly string[]).includes(environment)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_environment', `Unknown environment: ${environment}.`, path));
		return defaultValue;
	}
	return environment as TreeseedSceneEnvironment;
}

function parseBrowser(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneBrowser {
	const browser = asString(value) || 'chromium';
	if (!(TREESEED_SCENE_BROWSERS as readonly string[]).includes(browser)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_browser', `Unknown browser: ${browser}.`, path));
		return 'chromium';
	}
	return browser as TreeseedSceneBrowser;
}

function parseSelector(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneSelector | null {
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

function parseAction(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneAction | null {
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_action', 'Expected action to be an object.', path));
		return null;
	}
	const keys = Object.keys(value).filter((key) => value[key] !== undefined);
	const supported = keys.filter((key) => findBuiltInTreeseedSceneAction(key));
	if (keys.length !== 1 || supported.length !== 1) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_action', `Expected exactly one supported action key. Supported actions: goto, click, fill, select, keyboard, pause, mailpitConfirmLatest, apiRequest, waitForOperation.`, path));
		return null;
	}
	const key = supported[0]!;
	if (key === 'goto') return { goto: asString(value.goto) || '' };
	if (key === 'keyboard') return { keyboard: asString(value.keyboard) || '' };
	if (key === 'apiRequest') return { apiRequest: isRecord(value.apiRequest) ? value.apiRequest : {} };
	if (key === 'waitForOperation') {
		const operation = isRecord(value.waitForOperation) ? value.waitForOperation : {};
		const status = stringArrayField(operation, 'status', `${path}.waitForOperation`, diagnostics);
		return {
			waitForOperation: {
				...(optionalString(operation, 'id') ? { id: optionalString(operation, 'id') } : {}),
				...(optionalString(operation, 'kind') ? { kind: optionalString(operation, 'kind') } : {}),
				status,
				timeoutSeconds: positiveNumberField(operation, 'timeoutSeconds', undefined, `${path}.waitForOperation`, diagnostics),
				pollIntervalSeconds: positiveNumberField(operation, 'pollIntervalSeconds', undefined, `${path}.waitForOperation`, diagnostics),
				...(asString(operation.source) ? { source: asString(operation.source) as 'linked' | 'latestMatching' | 'explicit' } : {}),
			},
		};
	}
	if (key === 'pause') {
		const pause = isRecord(value.pause) ? value.pause : {};
		const mode = asString(pause.mode) === 'timed' ? 'timed' : 'manual';
		const durationSeconds = positiveNumberField(pause, 'durationSeconds', undefined, `${path}.pause`, diagnostics);
		if (mode === 'timed' && durationSeconds === undefined) diagnostics.push(sceneErrorDiagnostic('scene.missing_field', 'Timed pause actions must define durationSeconds.', `${path}.pause.durationSeconds`));
		return { pause: { mode, ...(optionalString(pause, 'prompt') ? { prompt: optionalString(pause, 'prompt') } : {}), ...(durationSeconds ? { durationSeconds } : {}) } };
	}
	if (key === 'mailpitConfirmLatest') {
		const spec = isRecord(value.mailpitConfirmLatest) ? value.mailpitConfirmLatest : {};
		return {
			mailpitConfirmLatest: {
				mailpitUrl: requireString(spec, 'mailpitUrl', `${path}.mailpitConfirmLatest`, diagnostics),
				email: requireString(spec, 'email', `${path}.mailpitConfirmLatest`, diagnostics),
				...(optionalString(spec, 'subjectIncludes') ? { subjectIncludes: optionalString(spec, 'subjectIncludes') } : {}),
				...(spec.displayInboxSeconds !== undefined ? { displayInboxSeconds: positiveNumberField(spec, 'displayInboxSeconds', undefined, `${path}.mailpitConfirmLatest`, diagnostics) } : {}),
				...(spec.displayMessageSeconds !== undefined ? { displayMessageSeconds: positiveNumberField(spec, 'displayMessageSeconds', undefined, `${path}.mailpitConfirmLatest`, diagnostics) } : {}),
			},
		};
	}
	if (key === 'click') {
		const selector = parseSelector(value.click, `${path}.click`, diagnostics);
		return selector ? { click: selector } : null;
	}
	if (key === 'select') {
		const selectValue = isRecord(value.select) ? value.select : {};
		const selector = parseSelector(selectValue, `${path}.select`, diagnostics);
		const optionValue = asString(selectValue.value);
		const optionLabel = asString(selectValue.label);
		if (!optionValue && !optionLabel) diagnostics.push(sceneErrorDiagnostic('scene.missing_field', 'Select actions must define value or label.', `${path}.select.value`));
		return selector ? { select: { ...selector, ...(optionValue ? { value: optionValue } : {}), ...(optionLabel ? { label: optionLabel } : {}) } as TreeseedSceneSelector & { value?: string; label?: string } } : null;
	}
	const fillValue = isRecord(value.fill) ? value.fill : {};
	const selector = parseSelector(fillValue, `${path}.fill`, diagnostics);
	const fillText = asString(fillValue.value);
	if (!fillText) diagnostics.push(sceneErrorDiagnostic('scene.missing_field', 'Missing required field: value.', `${path}.fill.value`));
	return selector ? { fill: { ...selector, value: fillText } as TreeseedSceneSelector & { value: string } } : null;
}

function parseExpectation(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneExpectation | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_expectation', 'Expected expect to be an object.', path));
		return undefined;
	}
	const expectation: TreeseedSceneExpectation = {};
	for (const key of Object.keys(value)) {
		if (!findBuiltInTreeseedSceneAssertion(key)) {
			diagnostics.push(sceneWarningDiagnostic('scene.unknown_expectation', `Unknown expectation key: ${key}.`, `${path}.${key}`));
		}
	}
	if (value.visible !== undefined) {
		const visible = arrayField(value, 'visible', path, diagnostics) ?? [];
		expectation.visible = visible.map((entry, index) => parseSelector(entry, `${path}.visible[${index}]`, diagnostics)).filter((entry): entry is TreeseedSceneSelector => Boolean(entry));
	}
	if (value.text !== undefined) expectation.text = asString(value.text);
	if (value.urlIncludes !== undefined) expectation.urlIncludes = asString(value.urlIncludes);
	if (value.operation !== undefined) {
		if (!isRecord(value.operation)) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_operation_expectation', 'Expected operation expectation to be an object.', `${path}.operation`));
		} else {
			expectation.operation = {
				...(optionalString(value.operation, 'id') ? { id: optionalString(value.operation, 'id') } : {}),
				kind: requireString(value.operation, 'kind', `${path}.operation`, diagnostics),
				status: stringArrayField(value.operation, 'status', `${path}.operation`, diagnostics),
				timeoutSeconds: positiveNumberField(value.operation, 'timeoutSeconds', undefined, `${path}.operation`, diagnostics),
				pollIntervalSeconds: positiveNumberField(value.operation, 'pollIntervalSeconds', undefined, `${path}.operation`, diagnostics),
				...(asString(value.operation.source) ? { source: asString(value.operation.source) as 'linked' | 'latestMatching' | 'explicit' } : {}),
			};
		}
	}
	return expectation;
}

function expectationKeys(expectation: TreeseedSceneExpectation | undefined) {
	if (!expectation) return [];
	return ['visible', 'text', 'urlIncludes', 'operation'].filter((key) => expectation[key as keyof TreeseedSceneExpectation] !== undefined);
}

function actionCanOmitExpectation(action: TreeseedSceneAction | null) {
	return Boolean(action && ('fill' in action || 'select' in action || 'keyboard' in action));
}

function parseMode(value: unknown, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneMode {
	const record = isRecord(value) ? value : {};
	return {
		test: booleanField(record, 'test', true, 'mode', diagnostics),
		demo: booleanField(record, 'demo', false, 'mode', diagnostics),
		training: booleanField(record, 'training', false, 'mode', diagnostics),
	};
}

function parseTarget(value: unknown, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneTarget {
	const record = isRecord(value) ? value : {};
	if (!isRecord(value)) diagnostics.push(sceneErrorDiagnostic('scene.missing_field', 'Missing required field: target.', 'target'));
	const viewport = isRecord(record.viewport) ? record.viewport : {};
	return {
		app: requireString(record, 'app', 'target', diagnostics),
		environment: parseEnvironment(record.environment, 'target.environment', diagnostics, 'local'),
		baseUrl: asString(record.baseUrl) || 'auto',
		viewport: {
			width: positiveNumberField(viewport, 'width', 1440, 'target.viewport', diagnostics) ?? 1440,
			height: positiveNumberField(viewport, 'height', 1000, 'target.viewport', diagnostics) ?? 1000,
		},
		browser: parseBrowser(record.browser, 'target.browser', diagnostics),
	};
}

function parseDimensionPair(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[], defaults: { width: number; height: number }) {
	const record = isRecord(value) ? value : {};
	if (value !== undefined && !isRecord(value)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_object', `Expected ${path} to be an object.`, path));
	return {
		width: positiveNumberField(record, 'width', defaults.width, path, diagnostics) ?? defaults.width,
		height: positiveNumberField(record, 'height', defaults.height, path, diagnostics) ?? defaults.height,
	};
}

export function defaultTreeseedSceneDeviceConfig(): TreeseedSceneDeviceConfig {
	return {
		defaultProfile: 'desktop',
		profiles: [
			{
				id: 'desktop',
				title: 'Desktop',
				orientation: 'landscape',
				viewport: { width: 1600, height: 900 },
				video: { width: 1600, height: 900 },
				output: { width: 1920, height: 1080 },
				deviceScaleFactor: 1,
				isMobile: false,
				hasTouch: false,
			},
		],
	};
}

function parseDevices(value: unknown, target: TreeseedSceneTarget, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneDeviceConfig {
	const defaults = defaultTreeseedSceneDeviceConfig();
	if (value === undefined) return defaults;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_object', 'Expected devices to be an object.', 'devices'));
		return defaults;
	}
	for (const key of Object.keys(value)) {
		if (!['defaultProfile', 'profiles'].includes(key)) diagnostics.push(sceneWarningDiagnostic('scene.unknown_device_field', `Unknown devices field: ${key}.`, `devices.${key}`));
	}
	const entries = arrayField(value, 'profiles', 'devices', diagnostics) ?? [];
	const profiles: TreeseedSceneDeviceProfile[] = [];
	const seen = new Set<string>();
	entries.forEach((entry, index) => {
		const path = `devices.profiles[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_device_profile', 'Expected device profile to be an object.', path));
			return;
		}
		for (const key of Object.keys(entry)) {
			if (!['id', 'title', 'orientation', 'viewport', 'video', 'output', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch', 'browserFrame'].includes(key)) diagnostics.push(sceneWarningDiagnostic('scene.unknown_device_field', `Unknown device profile field: ${key}.`, `${path}.${key}`));
		}
		const id = requireString(entry, 'id', path, diagnostics);
		if (id && !FILESYSTEM_SAFE_SCENE_ID.test(id)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_id', `Invalid device profile id: ${id}.`, `${path}.id`));
		if (id && seen.has(id)) diagnostics.push(sceneErrorDiagnostic('scene.device_duplicate', `Duplicate device profile id: ${id}.`, `${path}.id`));
		seen.add(id);
		const orientationValue = optionalString(entry, 'orientation');
		const orientation = orientationValue && (DEVICE_ORIENTATIONS as readonly string[]).includes(orientationValue) ? orientationValue as TreeseedSceneDeviceProfile['orientation'] : undefined;
		if (orientationValue && !orientation) diagnostics.push(sceneErrorDiagnostic('scene.device_orientation_invalid', `Unknown device orientation: ${orientationValue}.`, `${path}.orientation`));
		const browserFrame = objectField(entry, 'browserFrame', path, diagnostics);
		const chromeValue = browserFrame ? optionalString(browserFrame, 'chrome') : undefined;
		const chrome = chromeValue && (DEVICE_BROWSER_CHROME as readonly string[]).includes(chromeValue) ? chromeValue as 'desktop' | 'tablet' | 'mobile' : undefined;
		if (chromeValue && !chrome) diagnostics.push(sceneErrorDiagnostic('scene.device_browser_chrome_invalid', `Unknown browser frame chrome: ${chromeValue}.`, `${path}.browserFrame.chrome`));
		const profile: TreeseedSceneDeviceProfile = {
			id,
			...(optionalString(entry, 'title') ? { title: optionalString(entry, 'title') } : {}),
			...(orientation ? { orientation } : {}),
			viewport: parseDimensionPair(entry.viewport, `${path}.viewport`, diagnostics, target.viewport),
			...(entry.video !== undefined ? { video: parseDimensionPair(entry.video, `${path}.video`, diagnostics, target.viewport) } : {}),
			...(entry.output !== undefined ? { output: parseDimensionPair(entry.output, `${path}.output`, diagnostics, { width: 1920, height: 1080 }) } : {}),
			...(optionalString(entry, 'userAgent') ? { userAgent: optionalString(entry, 'userAgent') } : {}),
			...(entry.deviceScaleFactor !== undefined ? { deviceScaleFactor: positiveNumberField(entry, 'deviceScaleFactor', 1, path, diagnostics) ?? 1 } : {}),
			...(entry.isMobile !== undefined ? { isMobile: booleanField(entry, 'isMobile', false, path, diagnostics) } : {}),
			...(entry.hasTouch !== undefined ? { hasTouch: booleanField(entry, 'hasTouch', false, path, diagnostics) } : {}),
			...(browserFrame ? { browserFrame: { enabled: booleanField(browserFrame, 'enabled', false, `${path}.browserFrame`, diagnostics), ...(optionalString(browserFrame, 'title') ? { title: optionalString(browserFrame, 'title') } : {}), ...(chrome ? { chrome } : {}) } } : {}),
		};
		profiles.push(profile);
	});
	if (profiles.length === 0) return defaults;
	const defaultProfile = optionalString(value, 'defaultProfile') ?? profiles[0]!.id;
	if (!profiles.some((profile) => profile.id === defaultProfile)) diagnostics.push(sceneErrorDiagnostic('scene.device_unknown', `Default device profile not found: ${defaultProfile}.`, 'devices.defaultProfile'));
	return { defaultProfile, profiles };
}

function parseSetup(value: unknown, targetEnvironment: TreeseedSceneEnvironment, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneSetup {
	const record = isRecord(value) ? value : {};
	const setup: TreeseedSceneSetup = {};
	const dev = objectField(record, 'dev', 'setup', diagnostics);
	if (dev) setup.dev = { required: booleanField(dev, 'required', false, 'setup.dev', diagnostics), command: optionalString(dev, 'command'), reuseExisting: booleanField(dev, 'reuseExisting', true, 'setup.dev', diagnostics) };
	const auth = objectField(record, 'auth', 'setup', diagnostics);
	if (auth) setup.auth = { profile: optionalString(auth, 'profile'), required: booleanField(auth, 'required', false, 'setup.auth', diagnostics), seedOnly: booleanField(auth, 'seedOnly', false, 'setup.auth', diagnostics), ...(optionalString(auth, 'role') ? { role: optionalString(auth, 'role') } : {}) };
	const seed = objectField(record, 'seed', 'setup', diagnostics);
	if (seed) {
		const environments = (arrayField(seed, 'environments', 'setup.seed', diagnostics) ?? [targetEnvironment])
			.map((entry, index) => parseEnvironment(entry, `setup.seed.environments[${index}]`, diagnostics, targetEnvironment));
		setup.seed = { name: optionalString(seed, 'name'), environments: [...new Set(environments)], apply: booleanField(seed, 'apply', false, 'setup.seed', diagnostics) };
	}
	return setup;
}

function parseArtifacts(value: unknown, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneArtifacts {
	const record = isRecord(value) ? value : {};
	return {
		trace: booleanField(record, 'trace', true, 'artifacts', diagnostics),
		video: booleanField(record, 'video', false, 'artifacts', diagnostics),
		screenshots: booleanField(record, 'screenshots', true, 'artifacts', diagnostics),
		console: booleanField(record, 'console', true, 'artifacts', diagnostics),
		network: booleanField(record, 'network', true, 'artifacts', diagnostics),
		timeline: booleanField(record, 'timeline', true, 'artifacts', diagnostics),
		appLogs: booleanField(record, 'appLogs', true, 'artifacts', diagnostics),
	};
}

function parseWorkflow(value: unknown, diagnostics: TreeseedSceneDiagnostic[]) {
	if (!Array.isArray(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.missing_field', 'Missing required field: workflow.', 'workflow'));
		return [];
	}
	const steps: TreeseedSceneWorkflowStep[] = [];
	const seen = new Set<string>();
	const checkpointIds = new Set<string>();
	value.forEach((entry, index) => {
		const path = `workflow[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_workflow_step', 'Expected workflow step to be an object.', path));
			return;
		}
		const id = requireString(entry, 'id', path, diagnostics);
		if (id && !FILESYSTEM_SAFE_SCENE_ID.test(id)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_id', `Invalid workflow step id: ${id}.`, `${path}.id`));
		if (id && seen.has(id)) diagnostics.push(sceneErrorDiagnostic('scene.duplicate_step_id', `Duplicate workflow step id: ${id}.`, `${path}.id`));
		seen.add(id);
		const action = parseAction(entry.action, `${path}.action`, diagnostics);
		const expect = parseExpectation(entry.expect, `${path}.expect`, diagnostics);
		const demoOnly = booleanField(entry, 'demoOnly', false, path, diagnostics);
		const timeoutSeconds = positiveNumberField(entry, 'timeoutSeconds', undefined, path, diagnostics);
		const continueOnFailure = entry.continueOnFailure === undefined ? undefined : booleanField(entry, 'continueOnFailure', false, path, diagnostics);
		const checkpointRecord = objectField(entry, 'checkpoint', path, diagnostics);
		const checkpoint = checkpointRecord
			? {
				...(optionalString(checkpointRecord, 'id') ? { id: optionalString(checkpointRecord, 'id') } : {}),
				...(checkpointRecord.resumable === undefined ? {} : { resumable: booleanField(checkpointRecord, 'resumable', false, `${path}.checkpoint`, diagnostics) }),
			}
			: undefined;
		const checkpointId = checkpoint?.id ?? id;
		if (checkpoint?.id && !FILESYSTEM_SAFE_CHECKPOINT_ID.test(checkpoint.id)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_id', `Invalid checkpoint id: ${checkpoint.id}.`, `${path}.checkpoint.id`));
		if (checkpointIds.has(checkpointId)) diagnostics.push(sceneErrorDiagnostic('scene.duplicate_checkpoint_id', `Duplicate checkpoint id: ${checkpointId}.`, `${path}.checkpoint.id`));
		checkpointIds.add(checkpointId);
		if ('pause' in (action ?? {}) && (action as { pause?: { mode?: string } }).pause?.mode === 'manual' && !demoOnly && !expectationKeys(expect).length) {
			diagnostics.push(sceneErrorDiagnostic('scene.manual_pause_requires_demo_only', 'Manual pause steps must be demoOnly or define explicit expectations.', path));
		}
		if (!expectationKeys(expect).length && !demoOnly && !actionCanOmitExpectation(action)) diagnostics.push(sceneErrorDiagnostic('scene.missing_assertion', 'Workflow step must define expect or set demoOnly: true.', path));
		if (action) steps.push({
			id,
			title: requireString(entry, 'title', path, diagnostics),
			action,
			...(expect ? { expect } : {}),
			demoOnly,
			...(timeoutSeconds ? { timeoutSeconds } : {}),
			...(continueOnFailure !== undefined ? { continueOnFailure } : {}),
			...(checkpoint ? { checkpoint } : {}),
		});
	});
	return steps;
}

function parseChapters(value: unknown, stepIds: Set<string>, diagnostics: TreeseedSceneDiagnostic[]) {
	const chapters: TreeseedSceneChapter[] = [];
	const entries = Array.isArray(value) ? value : [];
	entries.forEach((entry, index) => {
		const path = `chapters[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_chapter', 'Expected chapter to be an object.', path));
			return;
		}
		const id = requireString(entry, 'id', path, diagnostics);
		const startsAt = requireString(entry, 'startsAt', path, diagnostics);
		if (id && !FILESYSTEM_SAFE_SCENE_ID.test(id)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_id', `Invalid chapter id: ${id}.`, `${path}.id`));
		if (startsAt && !stepIds.has(startsAt)) diagnostics.push(sceneErrorDiagnostic('scene.unknown_step_reference', `Unknown workflow step reference: ${startsAt}.`, `${path}.startsAt`));
		chapters.push({ id, title: requireString(entry, 'title', path, diagnostics), startsAt });
	});
	return chapters;
}

function enumValue<T extends readonly string[]>(value: unknown, allowed: T, defaultValue: T[number] | undefined, path: string, code: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const text = asString(value);
	if (!text) return defaultValue;
	if ((allowed as readonly string[]).includes(text)) return text as T[number];
	diagnostics.push(sceneErrorDiagnostic(code, `Unsupported value: ${text}.`, path));
	return defaultValue;
}

function parseVisualPoint(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualPoint | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_point', 'Expected visual point to be an object.', path));
		return undefined;
	}
	const unit = enumValue(value.unit, VISUAL_UNITS, 'px', `${path}.unit`, 'scene.visual_invalid_unit', diagnostics);
	const x = typeof value.x === 'number' && Number.isFinite(value.x) ? value.x : null;
	const y = typeof value.y === 'number' && Number.isFinite(value.y) ? value.y : null;
	if (x === null) diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_point', 'Expected x to be a finite number.', `${path}.x`));
	if (y === null) diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_point', 'Expected y to be a finite number.', `${path}.y`));
	if (unit === 'percent') {
		if (typeof x === 'number' && (x < 0 || x > 100)) diagnostics.push(sceneWarningDiagnostic('scene.visual_percent_out_of_range', 'Percent x is outside 0..100.', `${path}.x`));
		if (typeof y === 'number' && (y < 0 || y > 100)) diagnostics.push(sceneWarningDiagnostic('scene.visual_percent_out_of_range', 'Percent y is outside 0..100.', `${path}.y`));
	}
	if (x === null || y === null) return undefined;
	return { x, y, ...(unit ? { unit } : {}) };
}

function parseVisualSize(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualSize | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_size', 'Expected visual size to be an object.', path));
		return undefined;
	}
	const unit = enumValue(value.unit, VISUAL_UNITS, 'px', `${path}.unit`, 'scene.visual_invalid_unit', diagnostics);
	const width = typeof value.width === 'number' && Number.isFinite(value.width) && value.width > 0 ? value.width : null;
	const height = typeof value.height === 'number' && Number.isFinite(value.height) && value.height > 0 ? value.height : null;
	if (width === null) diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_size', 'Expected width to be a positive finite number.', `${path}.width`));
	if (height === null) diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_size', 'Expected height to be a positive finite number.', `${path}.height`));
	if (unit === 'percent') {
		if (typeof width === 'number' && width > 100) diagnostics.push(sceneWarningDiagnostic('scene.visual_percent_out_of_range', 'Percent width is greater than 100.', `${path}.width`));
		if (typeof height === 'number' && height > 100) diagnostics.push(sceneWarningDiagnostic('scene.visual_percent_out_of_range', 'Percent height is greater than 100.', `${path}.height`));
	}
	if (width === null || height === null) return undefined;
	return { width, height, ...(unit ? { unit } : {}) };
}

function parseVisualStyle(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualStyle | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_style', 'Expected visual style to be an object.', path));
		return undefined;
	}
	for (const key of Object.keys(value)) {
		if (!['tone', 'background', 'color', 'borderColor', 'borderWidth', 'radius', 'shadow', 'opacity'].includes(key)) diagnostics.push(sceneWarningDiagnostic('scene.visual_unknown_style_field', `Unknown visual style field: ${key}.`, `${path}.${key}`));
	}
	const opacity = value.opacity === undefined ? undefined : finiteNumberField(value, 'opacity', undefined, path, diagnostics);
	if (opacity !== undefined && opacity > 1) diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_opacity', 'Opacity must be between 0 and 1.', `${path}.opacity`));
	const tone = enumValue(value.tone, VISUAL_TONES, undefined, `${path}.tone`, 'scene.visual_invalid_tone', diagnostics) as TreeseedSceneVisualStyle['tone'] | undefined;
	const shadow = enumValue(value.shadow, VISUAL_SHADOWS, undefined, `${path}.shadow`, 'scene.visual_invalid_shadow', diagnostics) as TreeseedSceneVisualStyle['shadow'] | undefined;
	return {
		...(tone ? { tone } : {}),
		...(optionalString(value, 'background') ? { background: optionalString(value, 'background') } : {}),
		...(optionalString(value, 'color') ? { color: optionalString(value, 'color') } : {}),
		...(optionalString(value, 'borderColor') ? { borderColor: optionalString(value, 'borderColor') } : {}),
		...(value.borderWidth !== undefined ? { borderWidth: positiveNumberField(value, 'borderWidth', undefined, path, diagnostics) ?? 0 } : {}),
		...(value.radius !== undefined ? { radius: positiveNumberField(value, 'radius', undefined, path, diagnostics) ?? 0 } : {}),
		...(shadow ? { shadow } : {}),
		...(opacity !== undefined ? { opacity } : {}),
	};
}

function parseMotion(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneMotion | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.motion_invalid', 'Expected motion to be an object.', path));
		return undefined;
	}
	const entries = arrayField(value, 'keyframes', path, diagnostics) ?? [];
	let previous = -Infinity;
	const keyframes = entries.map((entry, index) => {
		const framePath = `${path}.keyframes[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.motion_invalid_keyframe', 'Expected keyframe to be an object.', framePath));
			return null;
		}
		const at = typeof entry.at === 'number' && Number.isFinite(entry.at) ? entry.at : null;
		if (at === null) diagnostics.push(sceneErrorDiagnostic('scene.motion_invalid_keyframe', 'Expected at to be a finite number.', `${framePath}.at`));
		if (at !== null && at < previous) diagnostics.push(sceneErrorDiagnostic('scene.motion_keyframes_unsorted', 'Motion keyframes must be sorted by at.', `${framePath}.at`));
		if (at !== null) previous = at;
		const unit = enumValue(entry.unit, MOTION_UNITS, 'seconds', `${framePath}.unit`, 'scene.motion_invalid_unit', diagnostics);
		if (unit === 'progress' && at !== null && (at < 0 || at > 1)) diagnostics.push(sceneErrorDiagnostic('scene.motion_invalid_progress', 'Progress keyframes must use at between 0 and 1.', `${framePath}.at`));
		const opacity = entry.opacity === undefined ? undefined : finiteNumberField(entry, 'opacity', undefined, framePath, diagnostics);
		if (opacity !== undefined && opacity > 1) diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_opacity', 'Opacity must be between 0 and 1.', `${framePath}.opacity`));
		const scale = entry.scale === undefined ? undefined : positiveNumberField(entry, 'scale', undefined, framePath, diagnostics);
		if (at === null) return null;
		const position = parseVisualPoint(entry.position, `${framePath}.position`, diagnostics);
		const size = parseVisualSize(entry.size, `${framePath}.size`, diagnostics);
		const motionEasing = enumValue(entry.easing, MOTION_EASINGS, undefined, `${framePath}.easing`, 'scene.motion_invalid_easing', diagnostics) as TreeseedSceneMotion['keyframes'][number]['easing'] | undefined;
		return {
			at,
			...(unit ? { unit } : {}),
			...(position ? { position } : {}),
			...(size ? { size } : {}),
			...(opacity !== undefined ? { opacity } : {}),
			...(scale !== undefined ? { scale } : {}),
			...(typeof entry.rotateDeg === 'number' && Number.isFinite(entry.rotateDeg) ? { rotateDeg: entry.rotateDeg } : {}),
			...(motionEasing ? { easing: motionEasing } : {}),
		};
	}).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
	if (keyframes.length === 0) diagnostics.push(sceneErrorDiagnostic('scene.motion_invalid', 'Motion must define at least one keyframe.', `${path}.keyframes`));
	return { keyframes, ...(value.loop !== undefined ? { loop: booleanField(value, 'loop', false, path, diagnostics) } : {}) };
}

function parseVisualObjects(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualObject[] | undefined {
	if (value === undefined) return undefined;
	const entries = arrayField({ objects: value }, 'objects', path.replace(/\.objects$/u, ''), diagnostics) ?? [];
	const objects: TreeseedSceneVisualObject[] = [];
	const seen = new Set<string>();
	entries.forEach((entry, index) => {
		const objectPath = `${path}[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.visual_invalid_object', 'Expected visual object to be an object.', objectPath));
			return;
		}
		const id = requireString(entry, 'id', objectPath, diagnostics);
		if (id && seen.has(id)) diagnostics.push(sceneErrorDiagnostic('scene.visual_duplicate_object', `Duplicate visual object id: ${id}.`, `${objectPath}.id`));
		seen.add(id);
		const type = enumValue(entry.type, VISUAL_OBJECT_TYPES, undefined, `${objectPath}.type`, 'scene.visual_invalid_object_type', diagnostics);
		if (!type) return;
		const region = enumValue(entry.region, VISUAL_REGIONS, undefined, `${objectPath}.region`, 'scene.visual_invalid_region', diagnostics);
		const position = parseVisualPoint(entry.position, `${objectPath}.position`, diagnostics);
		const size = parseVisualSize(entry.size, `${objectPath}.size`, diagnostics);
		const style = parseVisualStyle(entry.style, `${objectPath}.style`, diagnostics);
		const motion = parseMotion(entry.motion, `${objectPath}.motion`, diagnostics);
		const from = parseVisualPoint(entry.from, `${objectPath}.from`, diagnostics);
		const to = parseVisualPoint(entry.to, `${objectPath}.to`, diagnostics);
		objects.push({
			id,
			type,
			...(optionalString(entry, 'text') ? { text: optionalString(entry, 'text') } : {}),
			...(position ? { position } : {}),
			...(size ? { size } : {}),
			...(region ? { region: region as TreeseedSceneVisualRegion } : {}),
			...(style ? { style } : {}),
			...(motion ? { motion } : {}),
			...(from ? { from } : {}),
			...(to ? { to } : {}),
		});
	});
	return objects;
}

function parseOverlays(value: unknown, stepIds: Set<string>, diagnostics: TreeseedSceneDiagnostic[]) {
	const overlays: TreeseedSceneOverlay[] = [];
	const entries = Array.isArray(value) ? value : [];
	entries.forEach((entry, index) => {
		const path = `overlays[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_overlay', 'Expected overlay to be an object.', path));
			return;
		}
		const id = requireString(entry, 'id', path, diagnostics);
		const at = requireString(entry, 'at', path, diagnostics);
		if (id && !FILESYSTEM_SAFE_SCENE_ID.test(id)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_id', `Invalid overlay id: ${id}.`, `${path}.id`));
		if (at && !stepIds.has(at)) diagnostics.push(sceneErrorDiagnostic('scene.unknown_step_reference', `Unknown workflow step reference: ${at}.`, `${path}.at`));
		const anchor = entry.anchor === undefined ? null : parseSelector(entry.anchor, `${path}.anchor`, diagnostics);
		const variant = enumValue(entry.variant, OVERLAY_VARIANTS, undefined, `${path}.variant`, 'scene.overlay_invalid_variant', diagnostics) as TreeseedSceneOverlayVariant | undefined;
		const region = enumValue(entry.region, VISUAL_REGIONS, undefined, `${path}.region`, 'scene.visual_invalid_region', diagnostics) as TreeseedSceneVisualRegion | undefined;
		const position = parseVisualPoint(entry.position, `${path}.position`, diagnostics);
		const size = parseVisualSize(entry.size, `${path}.size`, diagnostics);
		const style = parseVisualStyle(entry.style, `${path}.style`, diagnostics);
		const motion = parseMotion(entry.motion, `${path}.motion`, diagnostics);
		const objects = parseVisualObjects(entry.objects, `${path}.objects`, diagnostics);
		overlays.push({
			id,
			at,
			renderer: requireString(entry, 'renderer', path, diagnostics),
			type: requireString(entry, 'type', path, diagnostics),
			...(optionalString(entry, 'text') ? { text: optionalString(entry, 'text') } : {}),
			...(anchor ? { anchor } : {}),
			...(variant ? { variant } : {}),
			...(region ? { region } : {}),
			...(position ? { position } : {}),
			...(size ? { size } : {}),
			...(style ? { style } : {}),
			...(motion ? { motion } : {}),
			...(objects ? { objects } : {}),
			...(entry.durationSeconds !== undefined ? { durationSeconds: positiveNumberField(entry, 'durationSeconds', undefined, path, diagnostics) } : {}),
		});
	});
	return overlays;
}

function parseDiagrams(value: unknown, stepIds: Set<string>, diagnostics: TreeseedSceneDiagnostic[]) {
	const diagrams: TreeseedSceneDiagram[] = [];
	const entries = Array.isArray(value) ? value : [];
	entries.forEach((entry, index) => {
		const path = `diagrams[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.invalid_diagram', 'Expected diagram to be an object.', path));
			return;
		}
		const id = requireString(entry, 'id', path, diagnostics);
		const at = requireString(entry, 'at', path, diagnostics);
		if (id && !FILESYSTEM_SAFE_SCENE_ID.test(id)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_id', `Invalid diagram id: ${id}.`, `${path}.id`));
		if (at && !stepIds.has(at)) diagnostics.push(sceneErrorDiagnostic('scene.unknown_step_reference', `Unknown workflow step reference: ${at}.`, `${path}.at`));
		const placementValue = optionalString(entry, 'placement') ?? 'interstitial';
		const placement = (DIAGRAM_PLACEMENTS as readonly string[]).includes(placementValue) ? placementValue as TreeseedSceneDiagram['placement'] : 'interstitial';
		if (placementValue && placementValue !== placement) diagnostics.push(sceneErrorDiagnostic('scene.diagram_invalid_placement', `Unknown diagram placement: ${placementValue}.`, `${path}.placement`));
		const objects = parseVisualObjects(entry.objects, `${path}.objects`, diagnostics);
		const motion = parseMotion(entry.motion, `${path}.motion`, diagnostics);
		const style = parseVisualStyle(entry.style, `${path}.style`, diagnostics);
		diagrams.push({
			id,
			at,
			renderer: requireString(entry, 'renderer', path, diagnostics),
			component: requireString(entry, 'component', path, diagnostics),
			durationSeconds: positiveNumberField(entry, 'durationSeconds', undefined, path, diagnostics),
			placement,
			props: objectField(entry, 'props', path, diagnostics),
			...(objects ? { objects } : {}),
			...(motion ? { motion } : {}),
			...(style ? { style } : {}),
		});
	});
	return diagrams;
}

function parseRender(value: unknown, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneRenderConfig {
	const record = isRecord(value) ? value : {};
	const remotion = objectField(record, 'remotion', 'render', diagnostics);
	if (!remotion) return {};
	const output = objectField(remotion, 'output', 'render.remotion', diagnostics);
	const resolution = output ? objectField(output, 'resolution', 'render.remotion.output', diagnostics) : undefined;
	const capture = objectField(remotion, 'capture', 'render.remotion', diagnostics);
	const captureViewport = capture ? objectField(capture, 'viewport', 'render.remotion.capture', diagnostics) : undefined;
	const captureVideo = capture ? objectField(capture, 'video', 'render.remotion.capture', diagnostics) : undefined;
	const evidenceFitValue = capture ? optionalString(capture, 'evidenceFit') ?? 'fixed-browser' : 'fixed-browser';
	const evidenceFit = (EVIDENCE_FITS as readonly string[]).includes(evidenceFitValue) ? evidenceFitValue as TreeseedSceneRenderEvidenceFit : 'fixed-browser';
	if (capture && evidenceFitValue !== evidenceFit) diagnostics.push(sceneErrorDiagnostic('scene.render_capture_fit_invalid', `Unknown scene render evidence fit: ${evidenceFitValue}.`, 'render.remotion.capture.evidenceFit'));
	const browserFrame = objectField(remotion, 'browserFrame', 'render.remotion', diagnostics);
	return {
		remotion: {
			composition: optionalString(remotion, 'composition'),
			...(output
				? {
					output: {
						format: optionalString(output, 'format'),
						fps: positiveNumberField(output, 'fps', undefined, 'render.remotion.output', diagnostics),
						...(resolution
							? { resolution: { width: positiveNumberField(resolution, 'width', 1920, 'render.remotion.output.resolution', diagnostics) ?? 1920, height: positiveNumberField(resolution, 'height', 1080, 'render.remotion.output.resolution', diagnostics) ?? 1080 } }
							: {}),
					},
				}
				: {}),
			...(capture
				? {
					capture: {
						...(captureViewport
							? { viewport: { width: positiveNumberField(captureViewport, 'width', 1600, 'render.remotion.capture.viewport', diagnostics) ?? 1600, height: positiveNumberField(captureViewport, 'height', 900, 'render.remotion.capture.viewport', diagnostics) ?? 900 } }
							: {}),
						...(captureVideo
							? { video: { width: positiveNumberField(captureVideo, 'width', 1600, 'render.remotion.capture.video', diagnostics) ?? 1600, height: positiveNumberField(captureVideo, 'height', 900, 'render.remotion.capture.video', diagnostics) ?? 900 } }
							: {}),
						evidenceFit,
					},
				}
				: {}),
			...(browserFrame
				? {
					browserFrame: {
						enabled: booleanField(browserFrame, 'enabled', false, 'render.remotion.browserFrame', diagnostics),
						...(optionalString(browserFrame, 'title') ? { title: optionalString(browserFrame, 'title') } : {}),
					},
				}
				: {}),
		},
	};
}

function parseRuntime(value: unknown, mode: TreeseedSceneMode, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneRuntimeConfig {
	const record = isRecord(value) ? value : {};
	const modeValue = asString(record.mode);
	let runtimeMode = modeValue || (mode.test ? 'acceptance' : mode.training ? 'training' : mode.demo ? 'demo' : 'acceptance');
	if (!['acceptance', 'demo', 'training', 'record-only'].includes(runtimeMode)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_runtime_mode', `Unknown runtime mode: ${runtimeMode}.`, 'runtime.mode'));
		runtimeMode = 'acceptance';
	}
	const timeouts = objectField(record, 'timeouts', 'runtime', diagnostics) ?? {};
	const checkpoints = objectField(record, 'checkpoints', 'runtime', diagnostics) ?? {};
	const progress = objectField(record, 'progress', 'runtime', diagnostics) ?? {};
	const failure = objectField(record, 'failure', 'runtime', diagnostics) ?? {};
	return {
		mode: runtimeMode as TreeseedSceneRuntimeConfig['mode'],
		timeouts: {
			sceneSeconds: nullablePositiveNumberField(timeouts, 'sceneSeconds', null, 'runtime.timeouts', diagnostics),
			chapterSeconds: nullablePositiveNumberField(timeouts, 'chapterSeconds', null, 'runtime.timeouts', diagnostics),
			stepSeconds: positiveNumberField(timeouts, 'stepSeconds', 120, 'runtime.timeouts', diagnostics) ?? 120,
		},
		checkpoints: {
			enabled: booleanField(checkpoints, 'enabled', true, 'runtime.checkpoints', diagnostics),
			defaultResumable: booleanField(checkpoints, 'defaultResumable', false, 'runtime.checkpoints', diagnostics),
			everyStep: booleanField(checkpoints, 'everyStep', true, 'runtime.checkpoints', diagnostics),
		},
		progress: {
			heartbeatSeconds: positiveNumberField(progress, 'heartbeatSeconds', 15, 'runtime.progress', diagnostics) ?? 15,
		},
		failure: {
			continueOnFailure: booleanField(failure, 'continueOnFailure', false, 'runtime.failure', diagnostics),
		},
	};
}

export function defaultTreeseedSceneTrainingConfig(): TreeseedSceneTrainingConfig {
	return {
		enabled: true,
		captions: {
			enabled: true,
			formats: ['vtt', 'srt'],
			maxCueSeconds: 6,
			renderInTrainingVideo: true,
		},
		transcript: {
			enabled: true,
			formats: ['json', 'markdown'],
		},
		narration: {
			enabled: true,
			style: 'instructional',
			includeDiagnostics: true,
		},
		glossary: {
			enabled: true,
			terms: [],
		},
		chapterClips: {
			enabled: true,
			format: 'manifest',
		},
	};
}

function parseTraining(value: unknown, stepIds: Set<string>, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneTrainingConfig {
	const record = isRecord(value) ? value : {};
	for (const key of Object.keys(record)) {
		if (!['enabled', 'captions', 'transcript', 'narration', 'glossary', 'chapterClips'].includes(key)) diagnostics.push(sceneWarningDiagnostic('scene.unknown_training_field', `Unknown training field: ${key}.`, `training.${key}`));
	}
	const captions = objectField(record, 'captions', 'training', diagnostics) ?? {};
	const transcript = objectField(record, 'transcript', 'training', diagnostics) ?? {};
	const narration = objectField(record, 'narration', 'training', diagnostics) ?? {};
	const glossary = objectField(record, 'glossary', 'training', diagnostics) ?? {};
	const chapterClips = objectField(record, 'chapterClips', 'training', diagnostics) ?? {};
	const styleValue = asString(narration.style) || 'instructional';
	const style = (NARRATION_STYLES as readonly string[]).includes(styleValue) ? styleValue as TreeseedSceneTrainingConfig['narration']['style'] : 'instructional';
	if (styleValue !== style) diagnostics.push(sceneErrorDiagnostic('scene.training_invalid_config', `Unknown narration style: ${styleValue}.`, 'training.narration.style'));
	const terms = (arrayField(glossary, 'terms', 'training.glossary', diagnostics) ?? []).map((entry, index) => {
		const path = `training.glossary.terms[${index}]`;
		if (!isRecord(entry)) {
			diagnostics.push(sceneErrorDiagnostic('scene.training_invalid_config', 'Glossary term entries must be objects.', path));
			return null;
		}
		const term = requireString(entry, 'term', path, diagnostics);
		const sourceStep = optionalString(entry, 'sourceStep');
		if (sourceStep && !stepIds.has(sourceStep)) diagnostics.push(sceneErrorDiagnostic('scene.unknown_step_reference', `Unknown workflow step reference: ${sourceStep}.`, `${path}.sourceStep`));
		const tags = stringArrayField(entry, 'tags', path, diagnostics);
		return {
			term,
			...(optionalString(entry, 'definition') ? { definition: optionalString(entry, 'definition') } : {}),
			...(sourceStep ? { sourceStep } : {}),
			...(tags.length > 0 ? { tags } : {}),
		};
	}).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
	const clipFormat = asString(chapterClips.format) || 'manifest';
	if (clipFormat !== 'manifest') diagnostics.push(sceneErrorDiagnostic('scene.training_invalid_config', `Unsupported chapter clip format: ${clipFormat}.`, 'training.chapterClips.format'));
	return {
		enabled: booleanField(record, 'enabled', true, 'training', diagnostics),
		captions: {
			enabled: booleanField(captions, 'enabled', true, 'training.captions', diagnostics),
			formats: enumArrayField(captions, 'formats', CAPTION_FORMATS, ['vtt', 'srt'], 'training.captions', diagnostics) as Array<'vtt' | 'srt'>,
			maxCueSeconds: positiveNumberField(captions, 'maxCueSeconds', 6, 'training.captions', diagnostics) ?? 6,
			renderInTrainingVideo: booleanField(captions, 'renderInTrainingVideo', true, 'training.captions', diagnostics),
		},
		transcript: {
			enabled: booleanField(transcript, 'enabled', true, 'training.transcript', diagnostics),
			formats: enumArrayField(transcript, 'formats', TRANSCRIPT_FORMATS, ['json', 'markdown'], 'training.transcript', diagnostics) as Array<'json' | 'markdown'>,
		},
		narration: {
			enabled: booleanField(narration, 'enabled', true, 'training.narration', diagnostics),
			style,
			includeDiagnostics: booleanField(narration, 'includeDiagnostics', true, 'training.narration', diagnostics),
		},
		glossary: {
			enabled: booleanField(glossary, 'enabled', true, 'training.glossary', diagnostics),
			terms,
		},
		chapterClips: {
			enabled: booleanField(chapterClips, 'enabled', true, 'training.chapterClips', diagnostics),
			format: 'manifest',
		},
	};
}

function defaultTreeseedSceneVisualAuditConfig(): TreeseedSceneVisualAuditConfig {
	return {
		enabled: true,
		roles: ['anonymous', 'owner', 'admin', 'member'],
		pathRoots: [],
		pathGlobs: [],
		excludePathGlobs: [],
		includeFullPage: false,
		review: {
			enabled: true,
			detail: 'standard',
			maxFindings: 250,
			contactSheets: true,
		},
		routeDiscovery: {
			core: true,
			admin: true,
			tenantOverrides: true,
			contentCollections: true,
		},
	};
}

function parseVisualAudit(value: unknown, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualAuditConfig {
	const defaults = defaultTreeseedSceneVisualAuditConfig();
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
	const reviewDetail = ['summary', 'standard', 'full'].includes(rawReviewDetail) ? rawReviewDetail as TreeseedSceneVisualAuditConfig['review']['detail'] : defaults.review.detail;
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

function actionKind(action: TreeseedSceneAction) {
	return Object.keys(action)[0] ?? '';
}

export function sceneActionKind(action: TreeseedSceneAction) {
	return actionKind(action);
}

export function sceneExpectationKinds(expectation: TreeseedSceneExpectation | undefined) {
	return expectationKeys(expectation);
}

export function parseTreeseedSceneManifest(value: unknown, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneManifest | null {
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_manifest', 'Expected scene manifest to be an object.', 'manifest'));
		return null;
	}
	for (const key of Object.keys(value)) {
		if (!TOP_LEVEL_FIELDS.has(key)) diagnostics.push(sceneWarningDiagnostic('scene.unknown_field', `Unknown top-level field: ${key}.`, key));
	}
	const schemaVersion = requireString(value, 'schemaVersion', 'manifest', diagnostics);
	if (schemaVersion && schemaVersion !== TREESEED_SCENE_SCHEMA_VERSION) diagnostics.push(sceneErrorDiagnostic('scene.unsupported_schema_version', `Unsupported scene schema version: ${schemaVersion}.`, 'schemaVersion'));
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
		schemaVersion: TREESEED_SCENE_SCHEMA_VERSION,
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
