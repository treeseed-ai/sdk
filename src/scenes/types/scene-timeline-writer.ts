
import { SceneBrowserSession, SceneLocator, SceneRunReport, SceneTimelineEvent } from './scene-publish-plan-paths.ts';
import { SceneDiagram, SceneManifest, SceneTrainingNarrationStyle } from './scene-diagram.ts';
import { SceneAction, SceneDiagnostic, SceneEnvironment, ScenePhase, SceneSelector, SceneWorkflowStep } from './scene-schema-version.ts';
import { SceneAssertionRunReport, SceneRunArtifacts } from './scene-visual-audit-finding.ts';
import { SceneAuthReport, SceneAuthResolveOptions, SceneBaseUrlResolution, SceneEnvironmentPrepareOptions, SceneEnvironmentPrepareReport, SceneOperationWaitReport, SceneOperationWaiter, ScenePauseController, ScenePluginStatus, ScenePluginSummary, SceneProgressEvent, SceneProgressEventType, SceneSeedOptions, SceneSeedReport } from './scene-checkpoint.ts';
import { SceneNarrationScriptEntry, SceneTranscriptEntry } from './scene-render-input.ts';

export type SceneTimelineWriter = {
	events: SceneTimelineEvent[];
	push(type: SceneTimelineEvent['type'], data: Record<string, unknown>, stepId?: string): SceneTimelineEvent;
};

export type SceneRuntimePluginContext = {
	projectRoot: string;
	scene: SceneManifest;
	environment: SceneEnvironment;
	baseUrl: string;
	session: SceneBrowserSession;
	timeline: SceneTimelineWriter;
	artifacts: SceneRunArtifacts;
	linkedOperationIds: string[];
	operationReports: SceneOperationWaitReport[];
	operationWaiter: SceneOperationWaiter;
	interactive: boolean;
	pauseController?: ScenePauseController;
	sleep: (ms: number) => Promise<void>;
	progress?: {
		push(type: SceneProgressEventType, data?: Record<string, unknown>, options?: {
			chapterId?: string | null;
			segmentId?: string | null;
			stepId?: string | null;
			checkpointId?: string | null;
			status?: string;
		}): SceneProgressEvent;
	};
	resolveSelector(selector: SceneSelector): SceneLocator;
	resolveUrl(value: string): string;
};

export type SceneRuntimePluginContextInput = Omit<SceneRuntimePluginContext, 'resolveSelector' | 'resolveUrl'>;

export type SceneActionHandlerInput = {
	action: SceneAction;
	actionKind: string;
	step: SceneWorkflowStep;
	context: SceneRuntimePluginContext;
};

export type SceneActionHandlerResult = {
	ok: boolean;
	operationReport?: SceneOperationWaitReport | null;
	diagnostics: SceneDiagnostic[];
};

export type SceneAssertionHandlerInput = {
	kind: string;
	value: unknown;
	step: SceneWorkflowStep;
	context: SceneRuntimePluginContext;
};

export type SceneActionHandler = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
	run(input: SceneActionHandlerInput): Promise<SceneActionHandlerResult>;
};

export type SceneAssertionHandler = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
	run(input: SceneAssertionHandlerInput): Promise<SceneAssertionRunReport>;
};

export type SceneEnvironmentProvider = {
	prepare?(input: SceneEnvironmentPrepareOptions): Promise<SceneEnvironmentPrepareReport>;
	resolveAuth?(input: SceneAuthResolveOptions): SceneAuthReport;
	prepareSeed?(input: SceneSeedOptions): Promise<SceneSeedReport>;
	resolveBaseUrl?(input: {
		projectRoot: string;
		scene: SceneManifest;
		environment: SceneEnvironment;
		environmentReport?: SceneEnvironmentPrepareReport | null;
	}): SceneBaseUrlResolution;
};

export type SceneCaptureProvider = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
};

export type SceneArtifactWriter = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
};

export type SceneRenderer = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
};

export type SceneDiagramRenderKind =
	| 'operation-lifecycle'
	| 'reconciliation-lifecycle'
	| 'dev-runtime-topology'
	| 'scene-execution-timeline';

export type SceneDiagramDefinition = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
	component: string;
	kind: SceneDiagramRenderKind;
	defaultDurationSeconds: number;
	validateProps(input: {
		diagram: SceneDiagram;
		path: string;
	}): SceneDiagnostic[];
	normalizeProps(input: {
		diagram: SceneDiagram;
		scene: SceneManifest;
		run?: SceneRunReport | null;
	}): Record<string, unknown>;
};

export type SceneDiagramProvider = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
	diagrams: Record<string, SceneDiagramDefinition>;
};

export type SceneNarrationProvider = {
	id: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
	generate(input: {
		scene: SceneManifest;
		run: SceneRunReport;
		transcript: SceneTranscriptEntry[];
		style: SceneTrainingNarrationStyle;
	}): SceneNarrationScriptEntry[];
};

export interface ScenePlugin {
	id: string;
	version: string;
	phase: ScenePhase;
	status: ScenePluginStatus;
	summary: string;
	actions?: Record<string, SceneActionHandler>;
	assertions?: Record<string, SceneAssertionHandler>;
	environment?: SceneEnvironmentProvider;
	captures?: Record<string, SceneCaptureProvider>;
	artifacts?: Record<string, SceneArtifactWriter>;
	renderers?: Record<string, SceneRenderer>;
	diagrams?: Record<string, SceneDiagramProvider>;
	narration?: Record<string, SceneNarrationProvider>;
}

export type ScenePluginRegistry = {
	plugins: ScenePlugin[];
	actions: Map<string, SceneActionHandler>;
	actionPlugins: Map<string, string>;
	assertions: Map<string, SceneAssertionHandler>;
	assertionPlugins: Map<string, string>;
	environmentProviders: SceneEnvironmentProvider[];
	captures: Map<string, SceneCaptureProvider>;
	capturePlugins: Map<string, string>;
	artifacts: Map<string, SceneArtifactWriter>;
	artifactPlugins: Map<string, string>;
	renderers: Map<string, SceneRenderer>;
	rendererPlugins: Map<string, string>;
	diagrams: Map<string, SceneDiagramProvider>;
	diagramPlugins: Map<string, string>;
	narration: Map<string, SceneNarrationProvider>;
	narrationPlugins: Map<string, string>;
	diagnostics: SceneDiagnostic[];
};

export type ScenePluginResolution = {
	ok: boolean;
	registry: ScenePluginRegistry;
	diagnostics: SceneDiagnostic[];
	summaries: ScenePluginSummary[];
};

export type SceneRenderProgressEventType =
	| 'scene.render.started'
	| 'scene.render.input.loaded'
	| 'scene.render.bundle.started'
	| 'scene.render.bundle.finished'
	| 'scene.render.composition.selected'
	| 'scene.render.media.started'
	| 'scene.render.media.progress'
	| 'scene.render.media.finished'
	| 'scene.render.finished';

export type SceneRenderProgressEvent = {
	type: SceneRenderProgressEventType;
	sceneId: string | null;
	runId: string | null;
	renderId: string | null;
	timestamp: string;
	offsetMs: number;
	data: Record<string, unknown>;
};
