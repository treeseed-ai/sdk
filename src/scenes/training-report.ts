import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sceneWarningDiagnostic } from './diagnostics.ts';
import { formatTreeseedSceneCaptionsSrt, formatTreeseedSceneCaptionsVtt } from './training-captions.ts';
import {
	formatTreeseedSceneGlossaryMarkdown,
	formatTreeseedSceneNarrationMarkdown,
	formatTreeseedSceneTranscriptMarkdown,
} from './training-transcript.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneManifest,
	TreeseedSceneRunReport,
	TreeseedSceneTrainingOutputPaths,
	TreeseedSceneTrainingOutputs,
} from './types.ts';

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path: string, value: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, 'utf8');
}

export function writeTreeseedSceneTrainingOutputs(input: {
	runRoot: string;
	scene: TreeseedSceneManifest;
	outputs: TreeseedSceneTrainingOutputs;
}): TreeseedSceneTrainingOutputPaths {
	const trainingRoot = join(input.runRoot, 'training');
	const paths: TreeseedSceneTrainingOutputPaths = {
		trainingRoot,
		inputPath: join(trainingRoot, 'input.json'),
		reportPath: join(trainingRoot, 'report.json'),
		captionsVttPath: input.scene.training.enabled && input.scene.training.captions.enabled && input.scene.training.captions.formats.includes('vtt') ? join(trainingRoot, 'captions.vtt') : null,
		captionsSrtPath: input.scene.training.enabled && input.scene.training.captions.enabled && input.scene.training.captions.formats.includes('srt') ? join(trainingRoot, 'captions.srt') : null,
		transcriptJsonPath: input.scene.training.enabled && input.scene.training.transcript.enabled && input.scene.training.transcript.formats.includes('json') ? join(trainingRoot, 'transcript.json') : null,
		transcriptMarkdownPath: input.scene.training.enabled && input.scene.training.transcript.enabled && input.scene.training.transcript.formats.includes('markdown') ? join(trainingRoot, 'transcript.md') : null,
		narrationJsonPath: input.scene.training.enabled && input.scene.training.narration.enabled ? join(trainingRoot, 'narration.json') : null,
		narrationMarkdownPath: input.scene.training.enabled && input.scene.training.narration.enabled ? join(trainingRoot, 'narration.md') : null,
		glossaryJsonPath: input.scene.training.enabled && input.scene.training.glossary.enabled ? join(trainingRoot, 'glossary.json') : null,
		glossaryMarkdownPath: input.scene.training.enabled && input.scene.training.glossary.enabled ? join(trainingRoot, 'glossary.md') : null,
		chapterClipsPath: input.scene.training.enabled && input.scene.training.chapterClips.enabled ? join(trainingRoot, 'chapter-clips.json') : null,
	};
	writeJson(paths.inputPath, input.outputs);
	writeJson(paths.reportPath, {
		ok: true,
		phase: 8,
		sceneId: input.outputs.sceneId,
		runId: input.outputs.runId,
		generatedAt: input.outputs.generatedAt,
		counts: {
			captions: input.outputs.captions.length,
			transcript: input.outputs.transcript.length,
			narration: input.outputs.narration.length,
			glossary: input.outputs.glossary.length,
			chapterClips: input.outputs.chapterClips.length,
		},
		paths,
	});
	if (paths.captionsVttPath) writeText(paths.captionsVttPath, formatTreeseedSceneCaptionsVtt(input.outputs.captions));
	if (paths.captionsSrtPath) writeText(paths.captionsSrtPath, formatTreeseedSceneCaptionsSrt(input.outputs.captions));
	if (paths.transcriptJsonPath) writeJson(paths.transcriptJsonPath, input.outputs.transcript);
	if (paths.transcriptMarkdownPath) writeText(paths.transcriptMarkdownPath, formatTreeseedSceneTranscriptMarkdown(input.outputs.transcript));
	if (paths.narrationJsonPath) writeJson(paths.narrationJsonPath, input.outputs.narration);
	if (paths.narrationMarkdownPath) writeText(paths.narrationMarkdownPath, formatTreeseedSceneNarrationMarkdown(input.outputs.narration));
	if (paths.glossaryJsonPath) writeJson(paths.glossaryJsonPath, input.outputs.glossary);
	if (paths.glossaryMarkdownPath) writeText(paths.glossaryMarkdownPath, formatTreeseedSceneGlossaryMarkdown(input.outputs.glossary));
	if (paths.chapterClipsPath) writeJson(paths.chapterClipsPath, input.outputs.chapterClips);
	return paths;
}

export function appendTreeseedSceneTrainingOutputPaths(input: {
	runPath: string;
	paths: TreeseedSceneTrainingOutputPaths;
}): TreeseedSceneDiagnostic[] {
	try {
		const run = JSON.parse(readFileSync(input.runPath, 'utf8')) as TreeseedSceneRunReport & {
			trainingOutputPaths?: TreeseedSceneTrainingOutputPaths;
			logs?: Record<string, string | null>;
		};
		writeJson(input.runPath, {
			...run,
			trainingOutputPaths: input.paths,
			logs: run.logs ? { ...run.logs, training: input.paths.trainingRoot } : run.logs,
		});
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic('scene.training_run_update_failed', `Training outputs were written but run.json could not be updated. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'run.json')];
	}
}
