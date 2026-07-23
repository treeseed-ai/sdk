
import { TreeseedSceneArtifacts, TreeseedSceneChapter, TreeseedSceneDeviceConfig, TreeseedSceneDiagnostic, TreeseedSceneDiagramPlacement, TreeseedSceneMode, TreeseedSceneOverlay, TreeseedSceneSchemaVersion, TreeseedSceneSetup, TreeseedSceneTarget, TreeseedSceneVisualAuditConfig, TreeseedSceneWorkflowStep } from './treeseed-scene-schema-version.ts';

export type TreeseedSceneDiagram = {
	id: string;
	renderer: string;
	at: string;
	component: string;
	durationSeconds?: number;
	placement: TreeseedSceneDiagramPlacement;
	props?: Record<string, unknown>;
	objects?: TreeseedSceneVisualObject[];
	motion?: TreeseedSceneMotion;
	style?: TreeseedSceneVisualStyle;
};

export type TreeseedSceneVisualUnit = 'px' | 'percent';

export type TreeseedSceneVisualPoint = {
	x: number;
	y: number;
	unit?: TreeseedSceneVisualUnit;
};

export type TreeseedSceneVisualSize = {
	width: number;
	height: number;
	unit?: TreeseedSceneVisualUnit;
};

export type TreeseedSceneVisualRegion =
	| 'top-left'
	| 'top'
	| 'top-right'
	| 'left'
	| 'center'
	| 'right'
	| 'bottom-left'
	| 'bottom'
	| 'bottom-right';

export type TreeseedSceneVisualTone =
	| 'neutral'
	| 'info'
	| 'success'
	| 'warning'
	| 'danger'
	| 'brand';

export type TreeseedSceneMotionEasing =
	| 'linear'
	| 'ease'
	| 'ease-in'
	| 'ease-out'
	| 'ease-in-out';

export type TreeseedSceneMotionKeyframe = {
	at: number;
	unit?: 'seconds' | 'progress';
	position?: TreeseedSceneVisualPoint;
	size?: TreeseedSceneVisualSize;
	opacity?: number;
	scale?: number;
	rotateDeg?: number;
	easing?: TreeseedSceneMotionEasing;
};

export type TreeseedSceneMotion = {
	keyframes: TreeseedSceneMotionKeyframe[];
	loop?: boolean;
};

export type TreeseedSceneVisualStyle = {
	tone?: TreeseedSceneVisualTone;
	background?: string;
	color?: string;
	borderColor?: string;
	borderWidth?: number;
	radius?: number;
	shadow?: 'none' | 'soft' | 'medium' | 'strong';
	opacity?: number;
};

export type TreeseedSceneVisualObjectType =
	| 'text'
	| 'box'
	| 'circle'
	| 'line'
	| 'arrow'
	| 'badge'
	| 'cursor'
	| 'spotlight';

export type TreeseedSceneVisualObject = {
	id: string;
	type: TreeseedSceneVisualObjectType;
	text?: string;
	position?: TreeseedSceneVisualPoint;
	size?: TreeseedSceneVisualSize;
	region?: TreeseedSceneVisualRegion;
	style?: TreeseedSceneVisualStyle;
	motion?: TreeseedSceneMotion;
	from?: TreeseedSceneVisualPoint;
	to?: TreeseedSceneVisualPoint;
};

export type TreeseedSceneOverlayVariant =
	| 'callout'
	| 'spotlight'
	| 'label'
	| 'panel'
	| 'lower-third'
	| 'badge'
	| 'cursor'
	| 'custom';

export type TreeseedSceneRenderEvidenceFit =
	| 'fixed-browser'
	| 'contain'
	| 'cover';

export type TreeseedSceneRenderCaptureConfig = {
	viewport?: {
		width: number;
		height: number;
	};
	video?: {
		width: number;
		height: number;
	};
	evidenceFit: TreeseedSceneRenderEvidenceFit;
};

export type TreeseedSceneRenderConfig = {
	remotion?: {
		composition?: string;
		output?: {
			format?: string;
			fps?: number;
			resolution?: {
				width: number;
				height: number;
			};
		};
		capture?: TreeseedSceneRenderCaptureConfig;
		browserFrame?: {
			enabled: boolean;
			title?: string;
		};
	};
};

export type TreeseedSceneTrainingOutputFormat =
	| 'json'
	| 'markdown'
	| 'vtt'
	| 'srt';

export type TreeseedSceneTrainingNarrationStyle =
	| 'concise'
	| 'instructional'
	| 'operator';

export type TreeseedSceneGlossaryTerm = {
	term: string;
	definition?: string;
	sourceStep?: string;
	tags?: string[];
};

export type TreeseedSceneTrainingConfig = {
	enabled: boolean;
	captions: {
		enabled: boolean;
		formats: Array<'vtt' | 'srt'>;
		maxCueSeconds: number;
		renderInTrainingVideo: boolean;
	};
	transcript: {
		enabled: boolean;
		formats: Array<'json' | 'markdown'>;
	};
	narration: {
		enabled: boolean;
		style: TreeseedSceneTrainingNarrationStyle;
		includeDiagnostics: boolean;
	};
	glossary: {
		enabled: boolean;
		terms: TreeseedSceneGlossaryTerm[];
	};
	chapterClips: {
		enabled: boolean;
		format: 'manifest';
	};
};

export type TreeseedSceneExecutionMode =
	| 'acceptance'
	| 'demo'
	| 'training'
	| 'record-only';

export type TreeseedSceneRuntimeConfig = {
	mode: TreeseedSceneExecutionMode;
	timeouts: {
		sceneSeconds: number | null;
		chapterSeconds: number | null;
		stepSeconds: number;
	};
	checkpoints: {
		enabled: boolean;
		defaultResumable: boolean;
		everyStep: boolean;
	};
	progress: {
		heartbeatSeconds: number;
	};
	failure: {
		continueOnFailure: boolean;
	};
};

export type TreeseedSceneManifest = {
	schemaVersion: TreeseedSceneSchemaVersion;
	id: string;
	title: string;
	description?: string;
	audience: string[];
	journey?: {
		kind: 'service' | 'page' | 'visual-audit';
		proves?: string[];
		minimumSteps?: number;
		requiresInteractiveAction?: boolean;
		producesState?: Array<{ key: string; kind: string }>;
		consumesState?: Array<{ key: string; kind: string }>;
	};
	mode: TreeseedSceneMode;
	target: TreeseedSceneTarget;
	devices: TreeseedSceneDeviceConfig;
	setup: TreeseedSceneSetup;
	artifacts: TreeseedSceneArtifacts;
	workflow: TreeseedSceneWorkflowStep[];
	chapters: TreeseedSceneChapter[];
	overlays: TreeseedSceneOverlay[];
	diagrams: TreeseedSceneDiagram[];
	render: TreeseedSceneRenderConfig;
	runtime: TreeseedSceneRuntimeConfig;
	training: TreeseedSceneTrainingConfig;
	visualAudit: TreeseedSceneVisualAuditConfig;
};

export type LoadedTreeseedSceneDocument = {
	path: string;
	value: unknown;
	diagnostics: TreeseedSceneDiagnostic[];
};
