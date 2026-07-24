
import { SceneArtifacts, SceneChapter, SceneDeviceConfig, SceneDiagnostic, SceneDiagramPlacement, SceneMode, SceneOverlay, SceneSchemaVersion, SceneSetup, SceneTarget, SceneVisualAuditConfig, SceneWorkflowStep } from './scene-schema-version.ts';

export type SceneDiagram = {
	id: string;
	renderer: string;
	at: string;
	component: string;
	durationSeconds?: number;
	placement: SceneDiagramPlacement;
	props?: Record<string, unknown>;
	objects?: SceneVisualObject[];
	motion?: SceneMotion;
	style?: SceneVisualStyle;
};

export type SceneVisualUnit = 'px' | 'percent';

export type SceneVisualPoint = {
	x: number;
	y: number;
	unit?: SceneVisualUnit;
};

export type SceneVisualSize = {
	width: number;
	height: number;
	unit?: SceneVisualUnit;
};

export type SceneVisualRegion =
	| 'top-left'
	| 'top'
	| 'top-right'
	| 'left'
	| 'center'
	| 'right'
	| 'bottom-left'
	| 'bottom'
	| 'bottom-right';

export type SceneVisualTone =
	| 'neutral'
	| 'info'
	| 'success'
	| 'warning'
	| 'danger'
	| 'brand';

export type SceneMotionEasing =
	| 'linear'
	| 'ease'
	| 'ease-in'
	| 'ease-out'
	| 'ease-in-out';

export type SceneMotionKeyframe = {
	at: number;
	unit?: 'seconds' | 'progress';
	position?: SceneVisualPoint;
	size?: SceneVisualSize;
	opacity?: number;
	scale?: number;
	rotateDeg?: number;
	easing?: SceneMotionEasing;
};

export type SceneMotion = {
	keyframes: SceneMotionKeyframe[];
	loop?: boolean;
};

export type SceneVisualStyle = {
	tone?: SceneVisualTone;
	background?: string;
	color?: string;
	borderColor?: string;
	borderWidth?: number;
	radius?: number;
	shadow?: 'none' | 'soft' | 'medium' | 'strong';
	opacity?: number;
};

export type SceneVisualObjectType =
	| 'text'
	| 'box'
	| 'circle'
	| 'line'
	| 'arrow'
	| 'badge'
	| 'cursor'
	| 'spotlight';

export type SceneVisualObject = {
	id: string;
	type: SceneVisualObjectType;
	text?: string;
	position?: SceneVisualPoint;
	size?: SceneVisualSize;
	region?: SceneVisualRegion;
	style?: SceneVisualStyle;
	motion?: SceneMotion;
	from?: SceneVisualPoint;
	to?: SceneVisualPoint;
};

export type SceneOverlayVariant =
	| 'callout'
	| 'spotlight'
	| 'label'
	| 'panel'
	| 'lower-third'
	| 'badge'
	| 'cursor'
	| 'custom';

export type SceneRenderEvidenceFit =
	| 'fixed-browser'
	| 'contain'
	| 'cover';

export type SceneRenderCaptureConfig = {
	viewport?: {
		width: number;
		height: number;
	};
	video?: {
		width: number;
		height: number;
	};
	evidenceFit: SceneRenderEvidenceFit;
};

export type SceneRenderConfig = {
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
		capture?: SceneRenderCaptureConfig;
		browserFrame?: {
			enabled: boolean;
			title?: string;
		};
	};
};

export type SceneTrainingOutputFormat =
	| 'json'
	| 'markdown'
	| 'vtt'
	| 'srt';

export type SceneTrainingNarrationStyle =
	| 'concise'
	| 'instructional'
	| 'operator';

export type SceneGlossaryTerm = {
	term: string;
	definition?: string;
	sourceStep?: string;
	tags?: string[];
};

export type SceneTrainingConfig = {
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
		style: SceneTrainingNarrationStyle;
		includeDiagnostics: boolean;
	};
	glossary: {
		enabled: boolean;
		terms: SceneGlossaryTerm[];
	};
	chapterClips: {
		enabled: boolean;
		format: 'manifest';
	};
};

export type SceneExecutionMode =
	| 'acceptance'
	| 'demo'
	| 'training'
	| 'record-only';

export type SceneRuntimeConfig = {
	mode: SceneExecutionMode;
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

export type SceneManifest = {
	schemaVersion: SceneSchemaVersion;
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
	mode: SceneMode;
	target: SceneTarget;
	devices: SceneDeviceConfig;
	setup: SceneSetup;
	artifacts: SceneArtifacts;
	workflow: SceneWorkflowStep[];
	chapters: SceneChapter[];
	overlays: SceneOverlay[];
	diagrams: SceneDiagram[];
	render: SceneRenderConfig;
	runtime: SceneRuntimeConfig;
	training: SceneTrainingConfig;
	visualAudit: SceneVisualAuditConfig;
};

export type LoadedSceneDocument = {
	path: string;
	value: unknown;
	diagnostics: SceneDiagnostic[];
};
