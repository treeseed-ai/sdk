import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import { resolveTreeseedSceneRunRoot } from './inspect.ts';
import { validateTreeseedScene } from './planner.ts';
import { defaultTreeseedSceneTrainingConfig } from './schema.ts';
import { buildTreeseedSceneCaptionCues, formatTreeseedSceneCaptionsSrt, formatTreeseedSceneCaptionsVtt } from './training-captions.ts';
import { appendTreeseedSceneTrainingOutputPaths, writeTreeseedSceneTrainingOutputs } from './training-report.ts';
import {
	buildTreeseedSceneChapterClips,
	buildTreeseedSceneGlossary,
	buildTreeseedSceneNarrationEntries,
	buildTreeseedSceneTranscriptEntries,
	formatTreeseedSceneNarrationMarkdown,
	formatTreeseedSceneTranscriptMarkdown,
} from './training-transcript.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneManifest,
	TreeseedSceneRunReport,
	TreeseedSceneTimelineEvent,
	TreeseedSceneTrainingOutputFormat,
	TreeseedSceneTrainingOutputOptions,
	TreeseedSceneTrainingOutputReport,
	TreeseedSceneTrainingOutputs,
} from './types.ts';

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function nowIso() {
	return new Date().toISOString();
}

function normalizeScene(scene: TreeseedSceneManifest): TreeseedSceneManifest {
	return {
		...scene,
		training: scene.training ?? defaultTreeseedSceneTrainingConfig(),
	};
}

function applyFormatFilter(scene: TreeseedSceneManifest, formats: TreeseedSceneTrainingOutputFormat[] | undefined): TreeseedSceneManifest {
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

export function buildTreeseedSceneTrainingOutputs(input: {
	scene: TreeseedSceneManifest;
	run: TreeseedSceneRunReport;
	timeline: TreeseedSceneTimelineEvent[];
}): TreeseedSceneTrainingOutputs {
	const scene = normalizeScene(input.scene);
	const transcript = scene.training.transcript.enabled || scene.training.narration.enabled || scene.training.glossary.enabled
		? buildTreeseedSceneTranscriptEntries({ scene, run: input.run, timeline: input.timeline })
		: [];
	const captions = scene.training.captions.enabled
		? buildTreeseedSceneCaptionCues({ scene, run: input.run, timeline: input.timeline })
		: [];
	const narration = scene.training.narration.enabled
		? buildTreeseedSceneNarrationEntries({ scene, run: input.run, transcript, style: scene.training.narration.style })
		: [];
	const glossary = scene.training.glossary.enabled
		? buildTreeseedSceneGlossary({ scene, transcript })
		: [];
	const chapterClips = scene.training.chapterClips.enabled
		? buildTreeseedSceneChapterClips({ scene, run: input.run, timeline: input.timeline })
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
	diagnostics: TreeseedSceneDiagnostic[];
	warnings?: TreeseedSceneDiagnostic[];
	blockers?: TreeseedSceneDiagnostic[];
}): TreeseedSceneTrainingOutputReport {
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

export function generateTreeseedSceneTrainingOutputs(input: TreeseedSceneTrainingOutputOptions): TreeseedSceneTrainingOutputReport {
	const resolved = resolveTreeseedSceneRunRoot(input.projectRoot, input.from);
	if (!resolved.runRoot) return failedReport({ scenePath: input.scene, runRoot: null, diagnostics: resolved.diagnostics });
	const scenePath = join(resolved.runRoot, 'scene.normalized.json');
	const runPath = join(resolved.runRoot, 'run.json');
	const timelinePath = join(resolved.runRoot, 'timeline.json');
	const blockers: TreeseedSceneDiagnostic[] = [];
	if (!existsSync(scenePath)) blockers.push(sceneErrorDiagnostic('scene.training_missing_scene', `Normalized scene artifact not found: ${scenePath}.`, 'scene'));
	if (!existsSync(runPath)) blockers.push(sceneErrorDiagnostic('scene.training_missing_run', `Run report artifact not found: ${runPath}.`, 'from'));
	if (!existsSync(timelinePath)) blockers.push(sceneErrorDiagnostic('scene.training_missing_timeline', `Timeline artifact not found: ${timelinePath}.`, 'from'));
	if (blockers.length > 0) return failedReport({ scenePath: input.scene, runRoot: resolved.runRoot, diagnostics: [...resolved.diagnostics, ...blockers], blockers });

	const sourceScene = normalizeScene(readJson<TreeseedSceneManifest>(scenePath));
	const run = readJson<TreeseedSceneRunReport>(runPath);
	const timeline = readJson<TreeseedSceneTimelineEvent[]>(timelinePath);
	const validation = validateTreeseedScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.ok) return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: validation.diagnostics });
	if (validation.scene?.id !== sourceScene.id) {
		const diagnostic = sceneErrorDiagnostic('scene.training_scene_mismatch', `Scene manifest "${validation.scene?.id ?? '(unknown)'}" does not match source run scene "${sourceScene.id}".`, 'scene');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], blockers: [diagnostic] });
	}
	const scene = applyFormatFilter(sourceScene, input.formats);
	try {
		const outputs = buildTreeseedSceneTrainingOutputs({ scene, run, timeline });
		const paths = writeTreeseedSceneTrainingOutputs({ runRoot: resolved.runRoot, scene, outputs });
		const updateWarnings = appendTreeseedSceneTrainingOutputPaths({ runPath, paths });
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
	formatTreeseedSceneCaptionsSrt,
	formatTreeseedSceneCaptionsVtt,
	formatTreeseedSceneNarrationMarkdown,
	formatTreeseedSceneTranscriptMarkdown,
};
