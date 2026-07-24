import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { appendSceneJsonl } from '../evidence/artifacts.ts';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../reporting/diagnostics.ts';
import { resolveScenePlugins } from '../plugins/registry.ts';
import { createRemotionSceneRendererAdapter, resolveSceneRemotionEntryPoint } from '../../reconciliation/remotion-adapter.ts';
import { listSceneRemotionCompositions } from './remotion-composition-registry.ts';
import { loadSceneRenderInput } from './remotion-input.ts';
import { stageSceneRenderMediaAssets } from './render-media-assets.ts';
import { appendSceneRenderedVideo, writeSceneRenderReport } from './render-report.ts';
import { appendSceneTrainingOutputPaths, writeSceneTrainingOutputs } from '../training/training-report.ts';
import type {
	SceneDiagnostic,
	SceneRenderFormat,
	SceneRenderMode,
	SceneRenderOptions,
	SceneRenderProgressEvent,
	SceneRenderProgressEventType,
	SceneRenderReport,
	SceneRendererAdapter,
} from '../../types.ts';

function renderId(timestamp: string) {
	return timestamp.toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 12) || 'render';
}

function nowIso() {
	return new Date().toISOString();
}

function sourceArtifacts(runRoot: string | null, input: ReturnType<typeof loadSceneRenderInput>['input']) {
	return {
		runPath: runRoot ? join(runRoot, 'run.json') : null,
		timelinePath: runRoot ? join(runRoot, 'timeline.json') : null,
		normalizedScenePath: runRoot ? join(runRoot, 'scene.normalized.json') : null,
		planPath: runRoot ? join(runRoot, 'scene.plan.json') : null,
		videoPaths: input?.media.videoRefs?.map((entry) => entry.path) ?? input?.media.videos ?? [],
		screenshotPaths: input?.media.screenshots.map((screenshot) => screenshot.path) ?? [],
		segmentPaths: input?.segments.map((segment) => segment.segmentPath) ?? [],
	};
}

function progressWriter(input: {
	sceneId: string | null;
	runId: string | null;
	renderId: string | null;
	startedAt: Date;
	progressPath: string | null;
	onProgress?: (event: SceneRenderProgressEvent) => void;
}) {
	return (type: SceneRenderProgressEventType, data: Record<string, unknown> = {}) => {
		const event: SceneRenderProgressEvent = {
			type,
			sceneId: input.sceneId,
			runId: input.runId,
			renderId: input.renderId,
			timestamp: nowIso(),
			offsetMs: Math.max(0, Date.now() - input.startedAt.getTime()),
			data,
		};
		if (input.progressPath) appendSceneJsonl(input.progressPath, event);
		input.onProgress?.(event);
		return event;
	};
}

function report(input: {
	ok: boolean;
	startedAt: Date;
	renderId: string | null;
	scenePath: string;
	runRoot: string | null;
	device?: SceneRenderReport['device'];
	renderRoot: string | null;
	inputPath: string | null;
	compositionPath: string | null;
	progressPath: string | null;
	outputPath: string | null;
	mode: SceneRenderMode;
	composition: string | null;
	format: SceneRenderFormat;
	sourceRunId: string | null;
	sceneId: string | null;
	renderedVideoPaths: string[];
	trainingOutputPaths: SceneRenderReport['trainingOutputPaths'];
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
	sourceArtifacts: SceneRenderReport['sourceArtifacts'];
	renderer: string;
}): SceneRenderReport {
	const finishedAt = new Date();
	return {
		ok: input.ok,
		phase: 6,
		renderer: input.renderer,
		renderId: input.renderId,
		sceneId: input.sceneId,
		sourceRunId: input.sourceRunId,
		scenePath: input.scenePath,
		runRoot: input.runRoot,
		device: input.device ?? null,
		startedAt: input.startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()),
		mode: input.mode,
		composition: input.composition,
		format: input.format,
		outputPath: input.outputPath,
		renderRoot: input.renderRoot,
		inputPath: input.inputPath,
		compositionPath: input.compositionPath,
		progressPath: input.progressPath,
		renderedVideoPaths: input.renderedVideoPaths,
		trainingOutputPaths: input.trainingOutputPaths,
		sourceArtifacts: input.sourceArtifacts,
		diagnostics: input.diagnostics,
		warnings: input.warnings,
		blockers: input.blockers,
	};
}

function createDefaultRendererAdapter(renderer: string): SceneRendererAdapter | null {
	if (renderer === 'remotion') return createRemotionSceneRendererAdapter();
	return null;
}

function renderEntrypoint(renderer: string) {
	return renderer === 'remotion' ? resolveSceneRemotionEntryPoint() : undefined;
}

function compositionDescription(renderer: string, compositionId: string | null) {
	if (renderer !== 'remotion' || !compositionId) return null;
	return listSceneRemotionCompositions().find((entry) => entry.id === compositionId) ?? null;
}

export async function renderScene(input: SceneRenderOptions): Promise<SceneRenderReport> {
	const startedAt = new Date();
	const timestamp = input.timestamp ?? startedAt.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
	const id = input.runId ?? renderId(timestamp);
	const renderer = input.renderer ?? 'remotion';
	const format = input.format ?? 'mp4';
	const initialMode = input.mode ?? 'demo';
	if (format !== 'mp4') {
		const diagnostic = sceneErrorDiagnostic('scene.render_format_unsupported', `Unsupported scene render format: ${format}.`, 'format');
		return report({ ok: false, startedAt, renderId: id, scenePath: input.scene, runRoot: null, renderRoot: null, inputPath: null, compositionPath: null, progressPath: null, outputPath: null, mode: initialMode, composition: input.composition ?? null, format: 'mp4', sourceRunId: null, sceneId: null, renderedVideoPaths: [], trainingOutputPaths: null, diagnostics: [diagnostic], warnings: [], blockers: [diagnostic], sourceArtifacts: sourceArtifacts(null, null), renderer });
	}
	const resolution = resolveScenePlugins({ plugins: input.plugins });
	const rendererDefinition = resolution.registry.renderers.get(renderer);
	if (!rendererDefinition) {
		const diagnostic = sceneErrorDiagnostic('scene.renderer_unknown', `Unknown scene renderer: ${renderer}.`, 'renderer');
		return report({ ok: false, startedAt, renderId: id, scenePath: input.scene, runRoot: null, renderRoot: null, inputPath: null, compositionPath: null, progressPath: null, outputPath: null, mode: initialMode, composition: input.composition ?? null, format, sourceRunId: null, sceneId: null, renderedVideoPaths: [], trainingOutputPaths: null, diagnostics: [diagnostic], warnings: [], blockers: [diagnostic], sourceArtifacts: sourceArtifacts(null, null), renderer });
	}
	if (rendererDefinition.status !== 'available') {
		const diagnostic = sceneErrorDiagnostic('scene.renderer_unavailable', `The scene renderer "${renderer}" is ${rendererDefinition.status} until Phase ${rendererDefinition.phase}.`, 'renderer');
		return report({ ok: false, startedAt, renderId: id, scenePath: input.scene, runRoot: null, renderRoot: null, inputPath: null, compositionPath: null, progressPath: null, outputPath: null, mode: initialMode, composition: input.composition ?? null, format, sourceRunId: null, sceneId: null, renderedVideoPaths: [], trainingOutputPaths: null, diagnostics: [diagnostic], warnings: [], blockers: [diagnostic], sourceArtifacts: sourceArtifacts(null, null), renderer });
	}

	const loaded = loadSceneRenderInput({
		projectRoot: input.projectRoot,
		scene: input.scene,
		from: input.from,
		mode: input.mode,
		composition: input.composition,
		format,
		chapterId: input.chapterId,
		renderer,
		device: input.device,
	});
	const renderRoot = loaded.runRoot ? join(loaded.runRoot, 'render', renderer) : null;
	const inputPath = renderRoot ? join(renderRoot, 'input.json') : null;
	const compositionPath = renderRoot ? join(renderRoot, 'composition.json') : null;
	const progressPath = renderRoot ? join(renderRoot, 'progress.jsonl') : null;
	const outputPath = input.output ? resolve(input.projectRoot, input.output) : renderRoot ? join(renderRoot, 'output.mp4') : null;
	if (renderRoot) mkdirSync(renderRoot, { recursive: true });
	const pushProgress = progressWriter({
		sceneId: loaded.input?.scene.id ?? null,
		runId: loaded.input?.run.runId ?? null,
		renderId: id,
		startedAt,
		progressPath,
		onProgress: input.onProgress,
	});
	pushProgress('scene.render.started', { renderer, format });
	if (!loaded.ok || !loaded.input || !outputPath) {
		const failed = report({ ok: false, startedAt, renderId: id, scenePath: input.scene, runRoot: loaded.runRoot, renderRoot, inputPath, compositionPath, progressPath, outputPath, mode: loaded.input?.render.mode ?? initialMode, composition: loaded.input?.render.composition ?? input.composition ?? null, format, sourceRunId: loaded.input?.run.runId ?? null, sceneId: loaded.input?.scene.id ?? null, renderedVideoPaths: [], trainingOutputPaths: null, diagnostics: loaded.diagnostics, warnings: loaded.warnings, blockers: loaded.blockers, sourceArtifacts: sourceArtifacts(loaded.runRoot, loaded.input), renderer });
		writeSceneRenderReport({ report: failed, input: loaded.input, composition: null });
		pushProgress('scene.render.finished', { ok: false });
		return failed;
	}
	let renderInput = loaded.input;
	const stagedMedia = renderRoot && renderer === 'remotion'
		? stageSceneRenderMediaAssets({ renderRoot, renderInput })
		: null;
	if (stagedMedia) renderInput = stagedMedia.renderInput;
	pushProgress('scene.render.input.loaded', { runRoot: loaded.runRoot, stagedVideos: renderInput.media.videoRefs?.filter((entry) => entry.staticPath).length ?? 0 });
	const composition = compositionDescription(renderer, renderInput.render.composition);
	const adapter = input.rendererAdapter
		?? input.rendererAdapterFactory?.({ renderer })
		?? createDefaultRendererAdapter(renderer);
	if (!adapter) {
		const diagnostic = sceneErrorDiagnostic('scene.renderer_unavailable', `No adapter is available for scene renderer "${renderer}".`, 'renderer');
		const failed = report({ ok: false, startedAt, renderId: id, scenePath: input.scene, runRoot: loaded.runRoot, renderRoot, inputPath, compositionPath, progressPath, outputPath, mode: renderInput.render.mode, composition: renderInput.render.composition, format, sourceRunId: renderInput.run.runId, sceneId: renderInput.scene.id, renderedVideoPaths: [], trainingOutputPaths: null, diagnostics: [...loaded.diagnostics, ...(stagedMedia?.warnings ?? []), diagnostic], warnings: [...loaded.warnings, ...(stagedMedia?.warnings ?? [])], blockers: [diagnostic], sourceArtifacts: sourceArtifacts(loaded.runRoot, renderInput), renderer });
		writeSceneRenderReport({ report: failed, input: renderInput, composition });
		pushProgress('scene.render.finished', { ok: false });
		return failed;
	}
	const adapterResult = await adapter.render({
		entryPoint: renderEntrypoint(renderer),
		compositionId: renderInput.render.composition,
		inputProps: renderInput,
		outputPath,
		publicDir: stagedMedia?.publicDir,
		codec: 'h264',
		onProgress(progress) {
			const type = progress.type === 'bundle.started' ? 'scene.render.bundle.started'
				: progress.type === 'bundle.finished' ? 'scene.render.bundle.finished'
					: progress.type === 'composition.selected' ? 'scene.render.composition.selected'
						: progress.type === 'media.started' ? 'scene.render.media.started'
							: progress.type === 'media.finished' ? 'scene.render.media.finished'
								: 'scene.render.media.progress';
			pushProgress(type, progress);
		},
	});
	const updateWarnings = adapterResult.ok && adapterResult.outputPath
		? appendSceneRenderedVideo({ runPath: join(loaded.runRoot!, 'run.json'), outputPath: adapterResult.outputPath })
		: [];
	let trainingOutputPaths: SceneRenderReport['trainingOutputPaths'] = null;
	let trainingWarnings: SceneDiagnostic[] = [];
	if (adapterResult.ok && renderInput.render.mode === 'training' && loaded.runRoot) {
		try {
			const outputs = {
				schemaVersion: 'treeseed.scene.training-output/v1' as const,
				sceneId: renderInput.scene.id,
				runId: renderInput.run.runId,
				generatedAt: nowIso(),
				...renderInput.training,
			};
			trainingOutputPaths = writeSceneTrainingOutputs({ runRoot: loaded.runRoot, scene: renderInput.scene, outputs });
			trainingWarnings = appendSceneTrainingOutputPaths({ runPath: join(loaded.runRoot, 'run.json'), paths: trainingOutputPaths });
		} catch (error) {
			trainingWarnings = [sceneWarningDiagnostic('scene.training_write_failed', `Training outputs could not be written. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'training')];
		}
	}
	const warnings = [...loaded.warnings, ...(stagedMedia?.warnings ?? []), ...updateWarnings, ...trainingWarnings.filter((entry) => entry.severity === 'warning')];
	const diagnostics = [...loaded.diagnostics, ...(stagedMedia?.warnings ?? []), ...adapterResult.diagnostics, ...updateWarnings, ...trainingWarnings];
	const blockers = adapterResult.ok ? loaded.blockers : adapterResult.diagnostics.filter((entry) => entry.severity === 'error');
	const renderedVideoPaths = adapterResult.ok && adapterResult.outputPath ? [adapterResult.outputPath] : [];
	const finalReport = report({
		ok: adapterResult.ok,
		startedAt,
		renderId: id,
		scenePath: input.scene,
		runRoot: loaded.runRoot,
		device: renderInput.run.device ?? null,
		renderRoot,
		inputPath,
		compositionPath,
		progressPath,
		outputPath: adapterResult.outputPath ?? outputPath,
		mode: renderInput.render.mode,
		composition: renderInput.render.composition,
		format,
		sourceRunId: renderInput.run.runId,
		sceneId: renderInput.scene.id,
		renderedVideoPaths,
		trainingOutputPaths,
		diagnostics,
		warnings,
		blockers,
		sourceArtifacts: sourceArtifacts(loaded.runRoot, renderInput),
		renderer,
	});
	writeSceneRenderReport({ report: finalReport, input: renderInput, composition: composition ?? null });
	pushProgress('scene.render.finished', { ok: finalReport.ok, outputPath: finalReport.outputPath });
	return finalReport;
}
