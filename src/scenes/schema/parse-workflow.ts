import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../diagnostics.ts';
import { findBuiltInTreeseedSceneAction, findBuiltInTreeseedSceneAssertion } from '../registry.ts';
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
} from '../types.ts';
import { FILESYSTEM_SAFE_CHECKPOINT_ID, FILESYSTEM_SAFE_SCENE_ID, MOTION_EASINGS, MOTION_UNITS, OVERLAY_VARIANTS, VISUAL_OBJECT_TYPES, VISUAL_REGIONS, VISUAL_SHADOWS, VISUAL_TONES, VISUAL_UNITS, arrayField, asString, booleanField, finiteNumberField, isRecord, objectField, optionalString, parseSelector, positiveNumberField, requireString } from './filesystem-safe-scene-id.ts';
import { actionCanOmitExpectation, expectationKeys, parseAction, parseExpectation } from './parse-action.ts';

export function parseWorkflow(value: unknown, diagnostics: TreeseedSceneDiagnostic[]) {
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

export function parseChapters(value: unknown, stepIds: Set<string>, diagnostics: TreeseedSceneDiagnostic[]) {
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

export function enumValue<T extends readonly string[]>(value: unknown, allowed: T, defaultValue: T[number] | undefined, path: string, code: string, diagnostics: TreeseedSceneDiagnostic[]) {
	const text = asString(value);
	if (!text) return defaultValue;
	if ((allowed as readonly string[]).includes(text)) return text as T[number];
	diagnostics.push(sceneErrorDiagnostic(code, `Unsupported value: ${text}.`, path));
	return defaultValue;
}

export function parseVisualPoint(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualPoint | undefined {
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

export function parseVisualSize(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualSize | undefined {
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

export function parseVisualStyle(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualStyle | undefined {
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

export function parseMotion(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneMotion | undefined {
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

export function parseVisualObjects(value: unknown, path: string, diagnostics: TreeseedSceneDiagnostic[]): TreeseedSceneVisualObject[] | undefined {
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

export function parseOverlays(value: unknown, stepIds: Set<string>, diagnostics: TreeseedSceneDiagnostic[]) {
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
