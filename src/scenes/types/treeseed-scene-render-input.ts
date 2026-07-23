
import { TreeseedSceneDiagram, TreeseedSceneGlossaryTerm, TreeseedSceneManifest, TreeseedSceneMotion, TreeseedSceneTrainingOutputFormat, TreeseedSceneVisualObject, TreeseedSceneVisualStyle } from './treeseed-scene-diagram.ts';
import { TreeseedSceneRunReport, TreeseedSceneTimelineEvent } from './treeseed-scene-publish-plan-paths.ts';
import { TreeseedSceneCheckpoint, TreeseedSceneRunChapterReport, TreeseedSceneRunSegmentReport } from './treeseed-scene-checkpoint.ts';
import { TreeseedSceneDeviceProfile, TreeseedSceneDeviceProfileId, TreeseedSceneDiagnostic, TreeseedSceneDiagramPlacement, TreeseedSceneOverlay } from './treeseed-scene-schema-version.ts';
import { TreeseedSceneRenderFormat, TreeseedSceneRenderMode } from './treeseed-scene-validation-report.ts';
import { TreeseedSceneDiagramRenderKind, TreeseedScenePlugin, TreeseedSceneRenderProgressEvent } from './treeseed-scene-timeline-writer.ts';

export type TreeseedSceneRenderInput = {
	schemaVersion: 'treeseed.scene.render-input/v1';
	scene: TreeseedSceneManifest;
	run: TreeseedSceneRunReport;
	timeline: TreeseedSceneTimelineEvent[];
	chapters: TreeseedSceneRunChapterReport[];
	segments: TreeseedSceneRunSegmentReport[];
	checkpoints: TreeseedSceneCheckpoint[];
	overlays: TreeseedSceneOverlay[];
	diagrams: TreeseedSceneDiagram[];
	renderDiagrams: TreeseedSceneRenderDiagram[];
	training: {
		captions: TreeseedSceneCaptionCue[];
		transcript: TreeseedSceneTranscriptEntry[];
		narration: TreeseedSceneNarrationScriptEntry[];
		glossary: TreeseedSceneGlossaryTerm[];
		chapterClips: TreeseedSceneChapterClipManifest[];
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
		mode: TreeseedSceneRenderMode;
		composition: string;
		fps: number;
		width: number;
		height: number;
		durationInFrames: number;
		format: TreeseedSceneRenderFormat;
		introFrames?: number;
		evidenceStartFrame?: number;
		evidenceDurationInFrames?: number;
		interstitialFrames?: number;
	};
};

export type TreeseedSceneRenderDiagram = {
	id: string;
	renderer: string;
	component: string;
	kind: TreeseedSceneDiagramRenderKind;
	placement: TreeseedSceneDiagramPlacement;
	at: string;
	startOffsetMs: number | null;
	durationSeconds: number;
	props: Record<string, unknown>;
	objects: TreeseedSceneVisualObject[];
	motion?: TreeseedSceneMotion;
	style?: TreeseedSceneVisualStyle;
};

export type TreeseedSceneRendererAdapter = {
	id: string;
	render(input: {
		entryPoint?: string;
		compositionId: string;
		inputProps: TreeseedSceneRenderInput;
		outputPath: string;
		publicDir?: string;
		codec: 'h264';
		onProgress?: (progress: Record<string, unknown>) => void;
	}): Promise<{ ok: boolean; outputPath: string | null; diagnostics: TreeseedSceneDiagnostic[] }>;
};

export type TreeseedSceneRendererAdapterFactory = (input: {
	renderer: string;
}) => TreeseedSceneRendererAdapter | null;

export type TreeseedSceneRenderOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	device?: TreeseedSceneDeviceProfileId;
	renderer?: string;
	format?: TreeseedSceneRenderFormat;
	mode?: TreeseedSceneRenderMode;
	composition?: string;
	chapterId?: string;
	output?: string;
	runId?: string;
	timestamp?: string;
	plugins?: TreeseedScenePlugin[];
	rendererAdapter?: TreeseedSceneRendererAdapter;
	rendererAdapterFactory?: TreeseedSceneRendererAdapterFactory;
	onProgress?: (event: TreeseedSceneRenderProgressEvent) => void;
};

export type TreeseedSceneRenderReport = {
	ok: boolean;
	phase: 6;
	renderer: string;
	renderId: string | null;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	device?: TreeseedSceneDeviceProfile | null;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	mode: TreeseedSceneRenderMode;
	composition: string | null;
	format: TreeseedSceneRenderFormat;
	outputPath: string | null;
	renderRoot: string | null;
	inputPath: string | null;
	compositionPath: string | null;
	progressPath: string | null;
	renderedVideoPaths: string[];
	trainingOutputPaths: TreeseedSceneTrainingOutputPaths | null;
	sourceArtifacts: {
		runPath: string | null;
		timelinePath: string | null;
		normalizedScenePath: string | null;
		planPath: string | null;
		videoPaths: string[];
		screenshotPaths: string[];
		segmentPaths: string[];
	};
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneCaptionCue = {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	stepId?: string | null;
	chapterId?: string | null;
};

export type TreeseedSceneTranscriptEntry = {
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

export type TreeseedSceneNarrationScriptEntry = {
	id: string;
	order: number;
	chapterId?: string | null;
	stepId?: string | null;
	title: string;
	script: string;
	source: 'scene' | 'chapter' | 'step' | 'overlay' | 'diagram' | 'diagnostic';
};

export type TreeseedSceneChapterClipManifest = {
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

export type TreeseedSceneTrainingOutputs = {
	schemaVersion: 'treeseed.scene.training-output/v1';
	sceneId: string | null;
	runId: string | null;
	generatedAt: string;
	captions: TreeseedSceneCaptionCue[];
	transcript: TreeseedSceneTranscriptEntry[];
	narration: TreeseedSceneNarrationScriptEntry[];
	glossary: TreeseedSceneGlossaryTerm[];
	chapterClips: TreeseedSceneChapterClipManifest[];
};

export type TreeseedSceneTrainingOutputPaths = {
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

export type TreeseedSceneTrainingOutputOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	formats?: TreeseedSceneTrainingOutputFormat[];
	timestamp?: string;
};

export type TreeseedSceneTrainingOutputReport = {
	ok: boolean;
	phase: 8;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	trainingRoot: string | null;
	outputs: TreeseedSceneTrainingOutputs | null;
	paths: TreeseedSceneTrainingOutputPaths | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneEvidencePhase = 9;

export type TreeseedSceneEvidenceTarget = 'local' | 'ci' | 'release';

export type TreeseedSceneEvidenceBundlePolicy = 'metadata-only' | 'sanitized';
