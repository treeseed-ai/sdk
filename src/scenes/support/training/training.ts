import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneErrorDiagnostic } from '../reporting/diagnostics.ts';
import { resolveSceneRunRoot } from '../reporting/inspect.ts';
import { validateScene } from '../execution/planner.ts';
import { defaultSceneTrainingConfig } from '../validation/schema.ts';
import { buildSceneCaptionCues, formatSceneCaptionsSrt, formatSceneCaptionsVtt } from './training-captions.ts';
import { appendSceneTrainingOutputPaths, writeSceneTrainingOutputs } from './training-report.ts';
import {
	buildSceneChapterClips,
	buildSceneGlossary,
	buildSceneNarrationEntries,
	buildSceneTranscriptEntries,
	formatSceneNarrationMarkdown,
	formatSceneTranscriptMarkdown,
} from './training-transcript.ts';
import type {
	SceneDiagnostic,
	SceneManifest,
	SceneRunReport,
	SceneTimelineEvent,
	SceneTrainingOutputFormat,
	SceneTrainingOutputOptions,
	SceneTrainingOutputReport,
	SceneTrainingOutputs,
} from '../../types.ts';

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function nowIso() {
	return new Date().toISOString();
}

function normalizeScene(scene: SceneManifest): SceneManifest {
	return {
		...scene,
		training: scene.training ?? defaultSceneTrainingConfig(),
	};
}

function applyFormatFilter(scene: SceneManifest, formats: SceneTrainingOutputFormat[] | undefined): SceneManifest {
	if (!formats || formats.length === 0) return scene;
	const requested = new Set(formats);
	return {
		...scene,
		training: {
			...scene.training,
			captions: {
				...scene.training.captions,
				formats: scene.training.captions.formats.filter((format) => requested.has(format)),
			},
			transcript: {
				...scene.training.transcript,
				formats: scene.training.transcript.formats.filter((format) => requested.has(format)),
			},
		},
	};
}

export function buildSceneTrainingOutputs(input: {
	scene: SceneManifest;
	run: SceneRunReport;
	timeline: SceneTimelineEvent[];
}): SceneTrainingOutputs {
	const scene = normalizeScene(input.scene);
	const transcript = scene.training.transcript.enabled || scene.training.narration.enabled || scene.training.glossary.enabled
		? buildSceneTranscriptEntries({ scene, run: input.run, timeline: input.timeline })
		: [];
	const captions = scene.training.captions.enabled
		? buildSceneCaptionCues({ scene, run: input.run, timeline: input.timeline })
		: [];
	const narration = scene.training.narration.enabled
		? buildSceneNarrationEntries({ scene, run: input.run, transcript, style: scene.training.narration.style })
		: [];
	const glossary = scene.training.glossary.enabled
		? buildSceneGlossary({ scene, transcript })
		: [];
	const chapterClips = scene.training.chapterClips.enabled
		? buildSceneChapterClips({ scene, run: input.run, timeline: input.timeline })
		: [];
	return {
		schemaVersion: 'treeseed.scene.training-output/v1',
		sceneId: scene.id,
		runId: input.run.runId,
		generatedAt: nowIso(),
		captions,
		transcript,
		narration,
		glossary,
		chapterClips,
	};
}

function failedReport(input: {
	scenePath: string;
	runRoot: string | null;
	diagnostics: SceneDiagnostic[];
	warnings?: SceneDiagnostic[];
	blockers?: SceneDiagnostic[];
}): SceneTrainingOutputReport {
	const blockers = input.blockers ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
	return {
		ok: false,
		phase: 8,
		sceneId: null,
		sourceRunId: null,
		scenePath: input.scenePath,
		runRoot: input.runRoot,
		trainingRoot: input.runRoot ? join(input.runRoot, 'training') : null,
		outputs: null,
		paths: null,
		diagnostics: input.diagnostics,
		warnings: input.warnings ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
		blockers,
	};
}

export function generateSceneTrainingOutputs(input: SceneTrainingOutputOptions): SceneTrainingOutputReport {
	const resolved = resolveSceneRunRoot(input.projectRoot, input.from);
	if (!resolved.runRoot) return failedReport({ scenePath: input.scene, runRoot: null, diagnostics: resolved.diagnostics });
	const scenePath = join(resolved.runRoot, 'scene.normalized.json');
	const runPath = join(resolved.runRoot, 'run.json');
	const timelinePath = join(resolved.runRoot, 'timeline.json');
	const blockers: SceneDiagnostic[] = [];
	if (!existsSync(scenePath)) blockers.push(sceneErrorDiagnostic('scene.training_missing_scene', `Normalized scene artifact not found: ${scenePath}.`, 'scene'));
	if (!existsSync(runPath)) blockers.push(sceneErrorDiagnostic('scene.training_missing_run', `Run report artifact not found: ${runPath}.`, 'from'));
	if (!existsSync(timelinePath)) blockers.push(sceneErrorDiagnostic('scene.training_missing_timeline', `Timeline artifact not found: ${timelinePath}.`, 'from'));
	if (blockers.length > 0) return failedReport({ scenePath: input.scene, runRoot: resolved.runRoot, diagnostics: [...resolved.diagnostics, ...blockers], blockers });

	const sourceScene = normalizeScene(readJson<SceneManifest>(scenePath));
	const run = readJson<SceneRunReport>(runPath);
	const timeline = readJson<SceneTimelineEvent[]>(timelinePath);
	const validation = validateScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.ok) return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: validation.diagnostics });
	if (validation.scene?.id !== sourceScene.id) {
		const diagnostic = sceneErrorDiagnostic('scene.training_scene_mismatch', `Scene manifest "${validation.scene?.id ?? '(unknown)'}" does not match source run scene "${sourceScene.id}".`, 'scene');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], blockers: [diagnostic] });
	}
	const scene = applyFormatFilter(sourceScene, input.formats);
	try {
		const outputs = buildSceneTrainingOutputs({ scene, run, timeline });
		const paths = writeSceneTrainingOutputs({ runRoot: resolved.runRoot, scene, outputs });
		const updateWarnings = appendSceneTrainingOutputPaths({ runPath, paths });
		return {
			ok: true,
			phase: 8,
			sceneId: sourceScene.id,
			sourceRunId: run.runId,
			scenePath: validation.scenePath,
			runRoot: resolved.runRoot,
			trainingRoot: paths.trainingRoot,
			outputs,
			paths,
			diagnostics: updateWarnings,
			warnings: updateWarnings,
			blockers: [],
		};
	} catch (error) {
		const diagnostic = sceneErrorDiagnostic('scene.training_write_failed', `Training outputs could not be written. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'training');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], blockers: [diagnostic] });
	}
}

export {
	formatSceneCaptionsSrt,
	formatSceneCaptionsVtt,
	formatSceneNarrationMarkdown,
	formatSceneTranscriptMarkdown,
};
