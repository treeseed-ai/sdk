import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from './diagnostics.ts';
import { buildTreeseedSceneRenderDiagrams } from './diagram-validation.ts';
import { resolveTreeseedSceneDeviceProfile } from './devices.ts';
import { resolveTreeseedSceneRunRoot } from './inspect.ts';
import { validateTreeseedScene } from './planner.ts';
import { listTreeseedSceneRemotionCompositions } from './remotion-composition-registry.ts';
import { resolveTreeseedScenePlugins } from './registry.ts';
import { buildTreeseedSceneTrainingOutputs } from './training.ts';
import type {
	TreeseedSceneCheckpoint,
	TreeseedSceneDiagnostic,
	TreeseedSceneManifest,
	TreeseedSceneRenderFormat,
	TreeseedSceneRenderInput,
	TreeseedSceneRenderInputLoadReport,
	TreeseedSceneRenderMode,
	TreeseedSceneRunReport,
	TreeseedSceneRunSegmentReport,
	TreeseedSceneTimelineEvent,
} from './types.ts';

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function hasError(diagnostics: TreeseedSceneDiagnostic[]) {
	return diagnostics.some((entry) => entry.severity === 'error');
}

function defaultRenderMode(scene: TreeseedSceneManifest, run: TreeseedSceneRunReport): TreeseedSceneRenderMode {
	if (scene.runtime.mode === 'training') return 'training';
	if (scene.runtime.mode === 'demo') return 'demo';
	if (run.workflowStatus === 'failed') return 'failure-review';
	return 'demo';
}

export function defaultTreeseedSceneRemotionComposition(mode: TreeseedSceneRenderMode) {
	if (mode === 'training') return 'treeseed-training-default';
	if (mode === 'failure-review') return 'treeseed-failure-review';
	if (mode === 'diagram-only') return 'treeseed-diagram-only';
	return 'treeseed-demo-default';
}

function renderSettings(scene: TreeseedSceneManifest, run: TreeseedSceneRunReport, mode: TreeseedSceneRenderMode, composition: string | undefined, format: TreeseedSceneRenderFormat | undefined, durationMs: number) {
	const remotion = scene.render.remotion;
	const fps = remotion?.output?.fps ?? 30;
	const resolution = run.device?.output ?? remotion?.output?.resolution ?? { width: 1920, height: 1080 };
	const width = resolution.width;
	const height = resolution.height;
	const selectedFormat = format ?? (remotion?.output?.format === 'mp4' ? 'mp4' : 'mp4');
	const durationSeconds = Math.max(4, durationMs / 1000);
	return {
		mode,
		composition: composition ?? remotion?.composition ?? defaultTreeseedSceneRemotionComposition(mode),
		fps,
		width,
		height,
		durationInFrames: Math.max(1, Math.ceil(durationSeconds * fps)),
		format: selectedFormat,
	};
}

function renderSettingsWithLayout(
	settings: ReturnType<typeof renderSettings>,
	mode: TreeseedSceneRenderMode,
	renderDiagrams: ReturnType<typeof buildTreeseedSceneRenderDiagrams>['diagrams'],
) {
	if (mode === 'diagram-only') {
		return {
			...settings,
			durationInFrames: Math.max(1, Math.ceil(renderDiagrams.reduce((sum, diagram) => sum + diagram.durationSeconds, 0) * settings.fps)),
			introFrames: 0,
			interstitialFrames: 0,
			evidenceStartFrame: 0,
			evidenceDurationInFrames: 0,
		};
	}
	const sourceFrames = settings.durationInFrames;
	const introFrames = Math.min(90, Math.floor(settings.fps * 3));
	const interstitialFrames = renderDiagrams
		.filter((entry) => entry.placement !== 'overlay')
		.reduce((sum, diagram) => sum + Math.max(1, Math.ceil(diagram.durationSeconds * settings.fps)), 0);
	const evidenceStartFrame = introFrames + interstitialFrames;
	return {
		...settings,
		introFrames,
		interstitialFrames,
		evidenceStartFrame,
		evidenceDurationInFrames: sourceFrames,
		durationInFrames: evidenceStartFrame + sourceFrames,
	};
}

function captureViewportForRender(scene: TreeseedSceneManifest, run: TreeseedSceneRunReport) {
	return run.capture?.videoSize ?? run.capture?.viewport ?? scene.render.remotion?.capture?.video ?? scene.render.remotion?.capture?.viewport ?? scene.target.viewport;
}

function aspect(value: { width: number; height: number }) {
	return value.width / Math.max(1, value.height);
}

function durationMsFor(input: { run: TreeseedSceneRunReport; timeline: TreeseedSceneTimelineEvent[]; chapterId?: string }) {
	if (input.chapterId) {
		const chapter = input.run.chapters.find((entry) => entry.id === input.chapterId);
		if (chapter) return Math.max(4000, chapter.durationMs);
	}
	const stepStarts = input.run.steps
		.map((step) => input.timeline.find((event) => event.type === 'step.start' && event.stepId === step.id)?.offsetMs ?? null)
		.filter((offset): offset is number => typeof offset === 'number');
	const stepEnds = input.run.steps
		.map((step) => input.timeline.find((event) => event.type === 'step.end' && event.stepId === step.id)?.offsetMs ?? null)
		.filter((offset): offset is number => typeof offset === 'number');
	if (stepStarts.length > 0 && stepEnds.length > 0) {
		return Math.max(4000, Math.max(...stepEnds) - Math.min(...stepStarts) + 3000);
	}
	if (input.run.durationMs > 0) return input.run.durationMs;
	const maxTimeline = Math.max(0, ...input.timeline.map((event) => event.offsetMs));
	if (maxTimeline > 0) return maxTimeline;
	return Math.max(input.run.steps.length * 4000, 8000);
}

function readCheckpoints(run: TreeseedSceneRunReport): TreeseedSceneCheckpoint[] {
	const root = run.artifacts?.checkpointsRoot;
	if (!root || !existsSync(root)) return run.checkpoints ?? [];
	return readdirSync(root)
		.filter((entry) => entry.endsWith('.json'))
		.sort()
		.map((entry) => readJson<TreeseedSceneCheckpoint>(join(root, entry)));
}

function readSegmentPaths(run: TreeseedSceneRunReport) {
	return (run.segments ?? []).map((segment) => segment.segmentPath).filter((path) => typeof path === 'string' && path.length > 0);
}

function imageDimensions(path: string) {
	if (!existsSync(path)) return { width: null, height: null };
	try {
		const buffer = readFileSync(path);
		if (buffer.length >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
			return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
		}
	} catch {
		// Dimensions are optional render hints.
	}
	return { width: null, height: null };
}

function screenshotsFromRun(run: TreeseedSceneRunReport, timeline: TreeseedSceneTimelineEvent[]) {
	const timelineByStep = new Map<string, TreeseedSceneTimelineEvent>();
	for (const event of timeline) {
		if ((event.type === 'screenshot.viewport' || event.type === 'screenshot') && event.stepId && !timelineByStep.has(event.stepId)) timelineByStep.set(event.stepId, event);
	}
	return run.steps
		.map((step) => {
			const viewportPath = step.viewportScreenshotPath && existsSync(step.viewportScreenshotPath) ? step.viewportScreenshotPath : null;
			const fullPagePath = step.screenshotPath && existsSync(step.screenshotPath) ? step.screenshotPath : null;
			const path = viewportPath ?? fullPagePath;
			if (!path) return null;
			const event = timelineByStep.get(step.id);
			const dimensions = imageDimensions(path);
			return {
				stepId: step.id,
				path,
				src: imageDataUri(path),
				timestamp: event?.timestamp ?? null,
				offsetMs: event?.offsetMs ?? null,
				captureKind: viewportPath ? 'viewport' as const : 'full-page' as const,
				width: dimensions.width,
				height: dimensions.height,
			};
		})
		.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
		.sort((a, b) => (a.offsetMs ?? Number.MAX_SAFE_INTEGER) - (b.offsetMs ?? Number.MAX_SAFE_INTEGER));
}

function videoRefFromPath(path: string): NonNullable<TreeseedSceneRenderInput['media']['videoRefs']>[number] | null {
	const lower = path.toLowerCase();
	const mimeType = lower.endsWith('.mp4') ? 'video/mp4'
		: lower.endsWith('.mov') || lower.endsWith('.qt') ? 'video/quicktime'
			: 'video/webm';
	if (/^(https?:|data:)/iu.test(path)) {
		return { path, src: path, mimeType, source: 'playwright' };
	}
	if (existsSync(path)) return { path, mimeType, source: 'playwright' };
	return null;
}

function legacyFullPageScreenshotsFromArtifacts(run: TreeseedSceneRunReport, timeline: TreeseedSceneTimelineEvent[]) {
	const known = new Set(run.steps.map((step) => step.screenshotPath).filter(Boolean));
	return (run.artifacts?.screenshotPaths ?? [])
		.filter((path) => !known.has(path) && existsSync(path))
		.map((step) => {
			const event = timeline.find((entry) => entry.type === 'screenshot' && 'path' in entry.data && entry.data.path === step);
			const dimensions = imageDimensions(step);
			return {
				stepId: event?.stepId ?? null,
				path: step,
				src: imageDataUri(step),
				timestamp: event?.timestamp ?? null,
				offsetMs: event?.offsetMs ?? null,
				captureKind: 'full-page' as const,
				width: dimensions.width,
				height: dimensions.height,
			};
		});
}

function imageDataUri(path: string) {
	if (/^(https?:|data:)/iu.test(path) || !existsSync(path)) return path;
	const extension = path.toLowerCase().endsWith('.jpg') || path.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
	return `data:image/${extension};base64,${readFileSync(path).toString('base64')}`;
}

function filterForChapter(run: TreeseedSceneRunReport, timeline: TreeseedSceneTimelineEvent[], chapterId: string | undefined) {
	if (!chapterId) return { timeline, segments: run.segments ?? [] };
	const chapter = run.chapters.find((entry) => entry.id === chapterId);
	if (!chapter) return null;
	const stepIds = new Set(chapter.stepIds);
	return {
		timeline: timeline.filter((event) => !event.stepId || stepIds.has(event.stepId)),
		segments: (run.segments ?? []).filter((segment) => segment.chapterId === chapterId),
	};
}

function filterDiagramsForChapter(diagrams: ReturnType<typeof buildTreeseedSceneRenderDiagrams>['diagrams'], run: TreeseedSceneRunReport, chapterId: string | undefined) {
	if (!chapterId) return diagrams;
	const chapter = run.chapters.find((entry) => entry.id === chapterId);
	if (!chapter) return diagrams;
	const stepIds = new Set(chapter.stepIds);
	return diagrams.filter((diagram) => stepIds.has(diagram.at));
}

export function loadTreeseedSceneRenderInput(input: {
	projectRoot: string;
	scene: string;
	from: string;
	mode?: TreeseedSceneRenderMode;
	composition?: string;
	format?: TreeseedSceneRenderFormat;
	chapterId?: string;
	renderer?: string;
	device?: string;
}): TreeseedSceneRenderInputLoadReport {
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	const warnings: TreeseedSceneDiagnostic[] = [];
	const blockers: TreeseedSceneDiagnostic[] = [];
	if (input.format && input.format !== 'mp4') {
		blockers.push(sceneErrorDiagnostic('scene.render_format_unsupported', `Unsupported scene render format: ${input.format}.`, 'format'));
		return { ok: false, input: null, runRoot: null, diagnostics: [...diagnostics, ...blockers], warnings, blockers };
	}
	const resolved = resolveTreeseedSceneRunRoot(input.projectRoot, input.from);
	diagnostics.push(...resolved.diagnostics);
	if (!resolved.runRoot) return { ok: false, input: null, runRoot: null, diagnostics, warnings, blockers: resolved.diagnostics.filter((entry) => entry.severity === 'error') };

	const scenePath = join(resolved.runRoot, 'scene.normalized.json');
	const runPath = join(resolved.runRoot, 'run.json');
	const timelinePath = join(resolved.runRoot, 'timeline.json');
	if (!existsSync(scenePath)) blockers.push(sceneErrorDiagnostic('scene.render_missing_scene', `Normalized scene artifact not found: ${scenePath}.`, 'scene'));
	if (!existsSync(runPath)) blockers.push(sceneErrorDiagnostic('scene.render_missing_run', `Run report artifact not found: ${runPath}.`, 'from'));
	if (!existsSync(timelinePath)) blockers.push(sceneErrorDiagnostic('scene.render_missing_timeline', `Timeline artifact not found: ${timelinePath}.`, 'from'));
	if (blockers.length > 0) return { ok: false, input: null, runRoot: resolved.runRoot, diagnostics: [...diagnostics, ...blockers], warnings, blockers };

	const scene = readJson<TreeseedSceneManifest>(scenePath);
	const run = readJson<TreeseedSceneRunReport>(runPath);
	const timeline = readJson<TreeseedSceneTimelineEvent[]>(timelinePath);
	if (input.device && run.device?.id && input.device !== run.device.id) {
		blockers.push(sceneErrorDiagnostic('scene.render_device_mismatch', `Requested render device "${input.device}" does not match source run device "${run.device.id}".`, 'device'));
	}
	if (input.device && !run.device?.id) {
		const resolvedDevice = resolveTreeseedSceneDeviceProfile({ scene, device: input.device });
		blockers.push(...resolvedDevice.diagnostics.filter((entry) => entry.severity === 'error'));
		warnings.push(...resolvedDevice.diagnostics.filter((entry) => entry.severity === 'warning'));
		if (resolvedDevice.profile) run.device = resolvedDevice.profile;
	}
	const validation = validateTreeseedScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.ok) {
		blockers.push(...validation.diagnostics);
	} else if (validation.scene?.id !== scene.id) {
		blockers.push(sceneErrorDiagnostic('scene.render_scene_mismatch', `Scene manifest "${validation.scene?.id ?? '(unknown)'}" does not match source run scene "${scene.id}".`, 'scene'));
	}
	if (input.chapterId && !run.chapters.some((chapter) => chapter.id === input.chapterId)) {
		blockers.push(sceneErrorDiagnostic('scene.render_chapter_not_found', `Scene run chapter not found: ${input.chapterId}.`, 'chapter'));
	}
	const mode = input.mode ?? defaultRenderMode(scene, run);
	let settings = renderSettings(scene, run, mode, input.composition, input.format, durationMsFor({ run, timeline, chapterId: input.chapterId }));
	const renderer = input.renderer ?? 'remotion';
	if (renderer === 'remotion' && !listTreeseedSceneRemotionCompositions().some((composition) => composition.id === settings.composition)) {
		blockers.push(sceneErrorDiagnostic('scene.render_composition_unknown', `Unknown Remotion scene composition: ${settings.composition}.`, 'composition'));
	}
	const filtered = filterForChapter(run, timeline, input.chapterId);
	if (!filtered) blockers.push(sceneErrorDiagnostic('scene.render_chapter_not_found', `Scene run chapter not found: ${input.chapterId}.`, 'chapter'));
	const pluginResolution = resolveTreeseedScenePlugins();
	const renderDiagramReport = buildTreeseedSceneRenderDiagrams({
		scene,
		run,
		timeline: filtered?.timeline ?? timeline,
		registry: pluginResolution.registry,
	});
	const renderDiagrams = filterDiagramsForChapter(renderDiagramReport.diagrams, run, input.chapterId);
	settings = renderSettingsWithLayout(settings, mode, renderDiagrams);
	const captureViewport = captureViewportForRender(scene, run);
	if (Math.abs(aspect(captureViewport) - aspect({ width: settings.width, height: settings.height })) > 0.01) {
		warnings.push(sceneWarningDiagnostic(
			'scene.render_capture_aspect_mismatch',
			`Scene capture viewport ${captureViewport.width}x${captureViewport.height} does not match render output ${settings.width}x${settings.height}; fixed-browser rendering will preserve the browser viewport and may add padding.`,
			'render.remotion.capture',
		));
	}
	const diagramDiagnostics = [...renderDiagramReport.diagnostics, ...pluginResolution.diagnostics];
	warnings.push(...diagramDiagnostics.filter((entry) => entry.severity === 'warning'));
	blockers.push(...diagramDiagnostics.filter((entry) => entry.severity === 'error'));
	if (mode === 'diagram-only' && renderDiagrams.length === 0) blockers.push(sceneErrorDiagnostic('scene.render_missing_diagram', 'Diagram-only rendering requires at least one valid diagram for the selected run or chapter.', 'diagrams'));
	const sourceVideos = [...new Set([...(run.videoPaths ?? []), ...(run.artifacts?.videoPaths ?? [])].filter(Boolean))];
	const videoRefs = sourceVideos.map(videoRefFromPath).filter((path): path is NonNullable<TreeseedSceneRenderInput['media']['videoRefs']>[number] => Boolean(path));
	const videos = videoRefs.map((entry) => entry.src ?? entry.staticPath ?? entry.path);
	const screenshots = [
		...screenshotsFromRun(run, filtered?.timeline ?? timeline),
		...legacyFullPageScreenshotsFromArtifacts(run, filtered?.timeline ?? timeline),
	].sort((a, b) => (a.offsetMs ?? Number.MAX_SAFE_INTEGER) - (b.offsetMs ?? Number.MAX_SAFE_INTEGER));
	if (videoRefs.length === 0 && screenshots.length > 0) {
		const message = sourceVideos.length > 0
			? 'Playwright video artifacts were not directly loadable by the Remotion browser; rendering from screenshots and timeline evidence.'
			: 'No Playwright video was found; rendering from screenshots and timeline evidence.';
		warnings.push(sceneWarningDiagnostic('scene.render_video_missing', message, 'from'));
	}
	if (mode !== 'diagram-only' && videoRefs.length === 0 && screenshots.length === 0) blockers.push(sceneErrorDiagnostic('scene.render_missing_media', 'Scene render requires at least one Playwright video or screenshot artifact.', 'from'));
	if (hasError(blockers)) return { ok: false, input: null, runRoot: resolved.runRoot, diagnostics: [...diagnostics, ...warnings, ...blockers], warnings, blockers };
	const trainingOutputs = buildTreeseedSceneTrainingOutputs({ scene, run, timeline: filtered?.timeline ?? timeline });

	const renderInput: TreeseedSceneRenderInput = {
		schemaVersion: 'treeseed.scene.render-input/v1',
		scene,
		run,
		timeline: filtered?.timeline ?? timeline,
		chapters: input.chapterId ? run.chapters.filter((chapter) => chapter.id === input.chapterId) : run.chapters ?? [],
		segments: filtered?.segments as TreeseedSceneRunSegmentReport[] ?? run.segments ?? [],
		checkpoints: readCheckpoints(run),
		overlays: scene.overlays,
		diagrams: scene.diagrams,
		renderDiagrams,
		training: {
			captions: trainingOutputs.captions,
			transcript: trainingOutputs.transcript,
			narration: trainingOutputs.narration,
			glossary: trainingOutputs.glossary,
			chapterClips: trainingOutputs.chapterClips,
		},
		media: { videos, videoRefs, screenshots },
		render: settings,
	};
	return { ok: true, input: renderInput, runRoot: resolved.runRoot, diagnostics: [...diagnostics, ...warnings], warnings, blockers };
}
