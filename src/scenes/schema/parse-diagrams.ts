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
import { CAPTION_FORMATS, DIAGRAM_PLACEMENTS, EVIDENCE_FITS, FILESYSTEM_SAFE_SCENE_ID, NARRATION_STYLES, TRANSCRIPT_FORMATS, arrayField, asString, booleanField, enumArrayField, isRecord, nullablePositiveNumberField, objectField, optionalString, positiveNumberField, requireString, stringArrayField } from './filesystem-safe-scene-id.ts';
import { parseMotion, parseVisualObjects, parseVisualStyle } from './parse-workflow.ts';

export function parseDiagrams(value: unknown, stepIds: Set<string>, diagnostics: SceneDiagnostic[]) {
	const diagrams: SceneDiagram[] = [];
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
		const placement = (DIAGRAM_PLACEMENTS as readonly string[]).includes(placementValue) ? placementValue as SceneDiagram['placement'] : 'interstitial';
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

export function parseRender(value: unknown, diagnostics: SceneDiagnostic[]): SceneRenderConfig {
	const record = isRecord(value) ? value : {};
	const remotion = objectField(record, 'remotion', 'render', diagnostics);
	if (!remotion) return {};
	const output = objectField(remotion, 'output', 'render.remotion', diagnostics);
	const resolution = output ? objectField(output, 'resolution', 'render.remotion.output', diagnostics) : undefined;
	const capture = objectField(remotion, 'capture', 'render.remotion', diagnostics);
	const captureViewport = capture ? objectField(capture, 'viewport', 'render.remotion.capture', diagnostics) : undefined;
	const captureVideo = capture ? objectField(capture, 'video', 'render.remotion.capture', diagnostics) : undefined;
	const evidenceFitValue = capture ? optionalString(capture, 'evidenceFit') ?? 'fixed-browser' : 'fixed-browser';
	const evidenceFit = (EVIDENCE_FITS as readonly string[]).includes(evidenceFitValue) ? evidenceFitValue as SceneRenderEvidenceFit : 'fixed-browser';
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

export function parseRuntime(value: unknown, mode: SceneMode, diagnostics: SceneDiagnostic[]): SceneRuntimeConfig {
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
		mode: runtimeMode as SceneRuntimeConfig['mode'],
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

export function defaultSceneTrainingConfig(): SceneTrainingConfig {
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

export function parseTraining(value: unknown, stepIds: Set<string>, diagnostics: SceneDiagnostic[]): SceneTrainingConfig {
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
	const style = (NARRATION_STYLES as readonly string[]).includes(styleValue) ? styleValue as SceneTrainingConfig['narration']['style'] : 'instructional';
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

export function defaultSceneVisualAuditConfig(): SceneVisualAuditConfig {
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
