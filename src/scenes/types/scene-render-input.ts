
import { SceneDiagram, SceneGlossaryTerm, SceneManifest, SceneMotion, SceneTrainingOutputFormat, SceneVisualObject, SceneVisualStyle } from './scene-diagram.ts';
import { SceneRunReport, SceneTimelineEvent } from './scene-publish-plan-paths.ts';
import { SceneCheckpoint, SceneRunChapterReport, SceneRunSegmentReport } from './scene-checkpoint.ts';
import { SceneDeviceProfile, SceneDeviceProfileId, SceneDiagnostic, SceneDiagramPlacement, SceneOverlay } from './scene-schema-version.ts';
import { SceneRenderFormat, SceneRenderMode } from './scene-validation-report.ts';
import { SceneDiagramRenderKind, ScenePlugin, SceneRenderProgressEvent } from './scene-timeline-writer.ts';

export type SceneRenderInput = {
	schemaVersion: 'treeseed.scene.render-input/v1';
	scene: SceneManifest;
	run: SceneRunReport;
	timeline: SceneTimelineEvent[];
	chapters: SceneRunChapterReport[];
	segments: SceneRunSegmentReport[];
	checkpoints: SceneCheckpoint[];
	overlays: SceneOverlay[];
	diagrams: SceneDiagram[];
	renderDiagrams: SceneRenderDiagram[];
	training: {
		captions: SceneCaptionCue[];
		transcript: SceneTranscriptEntry[];
		narration: SceneNarrationScriptEntry[];
		glossary: SceneGlossaryTerm[];
		chapterClips: SceneChapterClipManifest[];
	};
	media: {
		videos: string[];
		videoRefs?: Array<{
			path: string;
			src?: string;
			staticPath?: string;
			mimeType: 'video/webm' | 'video/mp4' | 'video/quicktime';
			source: 'playwright';
		}>;
		videoFrames?: Array<{
			frame: number;
			path: string;
			staticPath: string;
			timestampMs: number;
			width: number;
			height: number;
			source: 'playwright';
		}>;
		screenshots: Array<{
			stepId: string | null;
			path: string;
			src?: string;
			timestamp: string | null;
			offsetMs: number | null;
			captureKind?: 'viewport' | 'full-page';
			width?: number | null;
			height?: number | null;
		}>;
	};
	render: {
		mode: SceneRenderMode;
		composition: string;
		fps: number;
		width: number;
		height: number;
		durationInFrames: number;
		format: SceneRenderFormat;
		introFrames?: number;
		evidenceStartFrame?: number;
		evidenceDurationInFrames?: number;
		interstitialFrames?: number;
	};
};

export type SceneRenderDiagram = {
	id: string;
	renderer: string;
	component: string;
	kind: SceneDiagramRenderKind;
	placement: SceneDiagramPlacement;
	at: string;
	startOffsetMs: number | null;
	durationSeconds: number;
	props: Record<string, unknown>;
	objects: SceneVisualObject[];
	motion?: SceneMotion;
	style?: SceneVisualStyle;
};

export type SceneRendererAdapter = {
	id: string;
	render(input: {
		entryPoint?: string;
		compositionId: string;
		inputProps: SceneRenderInput;
		outputPath: string;
		publicDir?: string;
		codec: 'h264';
		onProgress?: (progress: Record<string, unknown>) => void;
	}): Promise<{ ok: boolean; outputPath: string | null; diagnostics: SceneDiagnostic[] }>;
};

export type SceneRendererAdapterFactory = (input: {
	renderer: string;
}) => SceneRendererAdapter | null;

export type SceneRenderOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	device?: SceneDeviceProfileId;
	renderer?: string;
	format?: SceneRenderFormat;
	mode?: SceneRenderMode;
	composition?: string;
	chapterId?: string;
	output?: string;
	runId?: string;
	timestamp?: string;
	plugins?: ScenePlugin[];
	rendererAdapter?: SceneRendererAdapter;
	rendererAdapterFactory?: SceneRendererAdapterFactory;
	onProgress?: (event: SceneRenderProgressEvent) => void;
};

export type SceneRenderReport = {
	ok: boolean;
	phase: 6;
	renderer: string;
	renderId: string | null;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	device?: SceneDeviceProfile | null;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	mode: SceneRenderMode;
	composition: string | null;
	format: SceneRenderFormat;
	outputPath: string | null;
	renderRoot: string | null;
	inputPath: string | null;
	compositionPath: string | null;
	progressPath: string | null;
	renderedVideoPaths: string[];
	trainingOutputPaths: SceneTrainingOutputPaths | null;
	sourceArtifacts: {
		runPath: string | null;
		timelinePath: string | null;
		normalizedScenePath: string | null;
		planPath: string | null;
		videoPaths: string[];
		screenshotPaths: string[];
		segmentPaths: string[];
	};
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type SceneCaptionCue = {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	stepId?: string | null;
	chapterId?: string | null;
};

export type SceneTranscriptEntry = {
	id: string;
	timestampMs: number;
	type:
		| 'scene'
		| 'chapter'
		| 'step'
		| 'overlay'
		| 'diagram'
		| 'diagnostic';
	title: string;
	text: string;
	stepId?: string | null;
	chapterId?: string | null;
};

export type SceneNarrationScriptEntry = {
	id: string;
	order: number;
	chapterId?: string | null;
	stepId?: string | null;
	title: string;
	script: string;
	source: 'scene' | 'chapter' | 'step' | 'overlay' | 'diagram' | 'diagnostic';
};

export type SceneChapterClipManifest = {
	id: string;
	chapterId: string;
	title: string;
	startOffsetMs: number;
	endOffsetMs: number;
	durationMs: number;
	stepIds: string[];
	segmentIds: string[];
	suggestedOutputName: string;
};

export type SceneTrainingOutputs = {
	schemaVersion: 'treeseed.scene.training-output/v1';
	sceneId: string | null;
	runId: string | null;
	generatedAt: string;
	captions: SceneCaptionCue[];
	transcript: SceneTranscriptEntry[];
	narration: SceneNarrationScriptEntry[];
	glossary: SceneGlossaryTerm[];
	chapterClips: SceneChapterClipManifest[];
};

export type SceneTrainingOutputPaths = {
	trainingRoot: string;
	inputPath: string;
	reportPath: string;
	captionsVttPath: string | null;
	captionsSrtPath: string | null;
	transcriptJsonPath: string | null;
	transcriptMarkdownPath: string | null;
	narrationJsonPath: string | null;
	narrationMarkdownPath: string | null;
	glossaryJsonPath: string | null;
	glossaryMarkdownPath: string | null;
	chapterClipsPath: string | null;
};

export type SceneTrainingOutputOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	formats?: SceneTrainingOutputFormat[];
	timestamp?: string;
};

export type SceneTrainingOutputReport = {
	ok: boolean;
	phase: 8;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	trainingRoot: string | null;
	outputs: SceneTrainingOutputs | null;
	paths: SceneTrainingOutputPaths | null;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type SceneEvidencePhase = 9;

export type SceneEvidenceTarget = 'local' | 'ci' | 'release';

export type SceneEvidenceBundlePolicy = 'metadata-only' | 'sanitized';
