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
import { DEVICE_BROWSER_CHROME, DEVICE_ORIENTATIONS, FILESYSTEM_SAFE_SCENE_ID, arrayField, asString, booleanField, isRecord, objectField, optionalString, parseBrowser, parseEnvironment, parseSelector, positiveNumberField, requireString, stringArrayField } from './filesystem-safe-scene-id.ts';

export function parseAction(value: unknown, path: string, diagnostics: SceneDiagnostic[]): SceneAction | null {
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_action', 'Expected action to be an object.', path));
		return null;
	}
	const keys = Object.keys(value).filter((key) => value[key] !== undefined);
	const supported = keys.filter((key) => findBuiltInSceneAction(key));
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
		return selector ? { select: { ...selector, ...(optionValue ? { value: optionValue } : {}), ...(optionLabel ? { label: optionLabel } : {}) } as SceneSelector & { value?: string; label?: string } } : null;
	}
	const fillValue = isRecord(value.fill) ? value.fill : {};
	const selector = parseSelector(fillValue, `${path}.fill`, diagnostics);
	const fillText = asString(fillValue.value);
	if (!fillText) diagnostics.push(sceneErrorDiagnostic('scene.missing_field', 'Missing required field: value.', `${path}.fill.value`));
	return selector ? { fill: { ...selector, value: fillText } as SceneSelector & { value: string } } : null;
}

export function parseExpectation(value: unknown, path: string, diagnostics: SceneDiagnostic[]): SceneExpectation | undefined {
	if (value === undefined) return undefined;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_expectation', 'Expected expect to be an object.', path));
		return undefined;
	}
	const expectation: SceneExpectation = {};
	for (const key of Object.keys(value)) {
		if (!findBuiltInSceneAssertion(key)) {
			diagnostics.push(sceneWarningDiagnostic('scene.unknown_expectation', `Unknown expectation key: ${key}.`, `${path}.${key}`));
		}
	}
	if (value.visible !== undefined) {
		const visible = arrayField(value, 'visible', path, diagnostics) ?? [];
		expectation.visible = visible.map((entry, index) => parseSelector(entry, `${path}.visible[${index}]`, diagnostics)).filter((entry): entry is SceneSelector => Boolean(entry));
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

export function expectationKeys(expectation: SceneExpectation | undefined) {
	if (!expectation) return [];
	return ['visible', 'text', 'urlIncludes', 'operation'].filter((key) => expectation[key as keyof SceneExpectation] !== undefined);
}

export function actionCanOmitExpectation(action: SceneAction | null) {
	return Boolean(action && ('fill' in action || 'select' in action || 'keyboard' in action));
}

export function parseMode(value: unknown, diagnostics: SceneDiagnostic[]): SceneMode {
	const record = isRecord(value) ? value : {};
	return {
		test: booleanField(record, 'test', true, 'mode', diagnostics),
		demo: booleanField(record, 'demo', false, 'mode', diagnostics),
		training: booleanField(record, 'training', false, 'mode', diagnostics),
	};
}

export function parseTarget(value: unknown, diagnostics: SceneDiagnostic[]): SceneTarget {
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

export function parseDimensionPair(value: unknown, path: string, diagnostics: SceneDiagnostic[], defaults: { width: number; height: number }) {
	const record = isRecord(value) ? value : {};
	if (value !== undefined && !isRecord(value)) diagnostics.push(sceneErrorDiagnostic('scene.invalid_object', `Expected ${path} to be an object.`, path));
	return {
		width: positiveNumberField(record, 'width', defaults.width, path, diagnostics) ?? defaults.width,
		height: positiveNumberField(record, 'height', defaults.height, path, diagnostics) ?? defaults.height,
	};
}

export function defaultSceneDeviceConfig(): SceneDeviceConfig {
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

export function parseDevices(value: unknown, target: SceneTarget, diagnostics: SceneDiagnostic[]): SceneDeviceConfig {
	const defaults = defaultSceneDeviceConfig();
	if (value === undefined) return defaults;
	if (!isRecord(value)) {
		diagnostics.push(sceneErrorDiagnostic('scene.invalid_object', 'Expected devices to be an object.', 'devices'));
		return defaults;
	}
	for (const key of Object.keys(value)) {
		if (!['defaultProfile', 'profiles'].includes(key)) diagnostics.push(sceneWarningDiagnostic('scene.unknown_device_field', `Unknown devices field: ${key}.`, `devices.${key}`));
	}
	const entries = arrayField(value, 'profiles', 'devices', diagnostics) ?? [];
	const profiles: SceneDeviceProfile[] = [];
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
		const orientation = orientationValue && (DEVICE_ORIENTATIONS as readonly string[]).includes(orientationValue) ? orientationValue as SceneDeviceProfile['orientation'] : undefined;
		if (orientationValue && !orientation) diagnostics.push(sceneErrorDiagnostic('scene.device_orientation_invalid', `Unknown device orientation: ${orientationValue}.`, `${path}.orientation`));
		const browserFrame = objectField(entry, 'browserFrame', path, diagnostics);
		const chromeValue = browserFrame ? optionalString(browserFrame, 'chrome') : undefined;
		const chrome = chromeValue && (DEVICE_BROWSER_CHROME as readonly string[]).includes(chromeValue) ? chromeValue as 'desktop' | 'tablet' | 'mobile' : undefined;
		if (chromeValue && !chrome) diagnostics.push(sceneErrorDiagnostic('scene.device_browser_chrome_invalid', `Unknown browser frame chrome: ${chromeValue}.`, `${path}.browserFrame.chrome`));
		const profile: SceneDeviceProfile = {
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

export function parseSetup(value: unknown, targetEnvironment: SceneEnvironment, diagnostics: SceneDiagnostic[]): SceneSetup {
	const record = isRecord(value) ? value : {};
	const setup: SceneSetup = {};
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

export function parseArtifacts(value: unknown, diagnostics: SceneDiagnostic[]): SceneArtifacts {
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
