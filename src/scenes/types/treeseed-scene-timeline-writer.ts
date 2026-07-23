
import { TreeseedSceneBrowserSession, TreeseedSceneLocator, TreeseedSceneRunReport, TreeseedSceneTimelineEvent } from './treeseed-scene-publish-plan-paths.ts';
import { TreeseedSceneDiagram, TreeseedSceneManifest, TreeseedSceneTrainingNarrationStyle } from './treeseed-scene-diagram.ts';
import { TreeseedSceneAction, TreeseedSceneDiagnostic, TreeseedSceneEnvironment, TreeseedScenePhase, TreeseedSceneSelector, TreeseedSceneWorkflowStep } from './treeseed-scene-schema-version.ts';
import { TreeseedSceneAssertionRunReport, TreeseedSceneRunArtifacts } from './treeseed-scene-visual-audit-finding.ts';
import { TreeseedSceneAuthReport, TreeseedSceneAuthResolveOptions, TreeseedSceneBaseUrlResolution, TreeseedSceneEnvironmentPrepareOptions, TreeseedSceneEnvironmentPrepareReport, TreeseedSceneOperationWaitReport, TreeseedSceneOperationWaiter, TreeseedScenePauseController, TreeseedScenePluginStatus, TreeseedScenePluginSummary, TreeseedSceneProgressEvent, TreeseedSceneProgressEventType, TreeseedSceneSeedOptions, TreeseedSceneSeedReport } from './treeseed-scene-checkpoint.ts';
import { TreeseedSceneNarrationScriptEntry, TreeseedSceneTranscriptEntry } from './treeseed-scene-render-input.ts';

export type TreeseedSceneTimelineWriter = {
	events: TreeseedSceneTimelineEvent[];
	push(type: TreeseedSceneTimelineEvent['type'], data: Record<string, unknown>, stepId?: string): TreeseedSceneTimelineEvent;
};

export type TreeseedSceneRuntimePluginContext = {
	projectRoot: string;
	scene: TreeseedSceneManifest;
	environment: TreeseedSceneEnvironment;
	baseUrl: string;
	session: TreeseedSceneBrowserSession;
	timeline: TreeseedSceneTimelineWriter;
	artifacts: TreeseedSceneRunArtifacts;
	linkedOperationIds: string[];
	operationReports: TreeseedSceneOperationWaitReport[];
	operationWaiter: TreeseedSceneOperationWaiter;
	interactive: boolean;
	pauseController?: TreeseedScenePauseController;
	sleep: (ms: number) => Promise<void>;
	progress?: {
		push(type: TreeseedSceneProgressEventType, data?: Record<string, unknown>, options?: {
			chapterId?: string | null;
			segmentId?: string | null;
			stepId?: string | null;
			checkpointId?: string | null;
			status?: string;
		}): TreeseedSceneProgressEvent;
	};
	resolveSelector(selector: TreeseedSceneSelector): TreeseedSceneLocator;
	resolveUrl(value: string): string;
};

export type TreeseedSceneRuntimePluginContextInput = Omit<TreeseedSceneRuntimePluginContext, 'resolveSelector' | 'resolveUrl'>;

export type TreeseedSceneActionHandlerInput = {
	action: TreeseedSceneAction;
	actionKind: string;
	step: TreeseedSceneWorkflowStep;
	context: TreeseedSceneRuntimePluginContext;
};

export type TreeseedSceneActionHandlerResult = {
	ok: boolean;
	operationReport?: TreeseedSceneOperationWaitReport | null;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneAssertionHandlerInput = {
	kind: string;
	value: unknown;
	step: TreeseedSceneWorkflowStep;
	context: TreeseedSceneRuntimePluginContext;
};

export type TreeseedSceneActionHandler = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
	run(input: TreeseedSceneActionHandlerInput): Promise<TreeseedSceneActionHandlerResult>;
};

export type TreeseedSceneAssertionHandler = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
	run(input: TreeseedSceneAssertionHandlerInput): Promise<TreeseedSceneAssertionRunReport>;
};

export type TreeseedSceneEnvironmentProvider = {
	prepare?(input: TreeseedSceneEnvironmentPrepareOptions): Promise<TreeseedSceneEnvironmentPrepareReport>;
	resolveAuth?(input: TreeseedSceneAuthResolveOptions): TreeseedSceneAuthReport;
	prepareSeed?(input: TreeseedSceneSeedOptions): Promise<TreeseedSceneSeedReport>;
	resolveBaseUrl?(input: {
		projectRoot: string;
		scene: TreeseedSceneManifest;
		environment: TreeseedSceneEnvironment;
		environmentReport?: TreeseedSceneEnvironmentPrepareReport | null;
	}): TreeseedSceneBaseUrlResolution;
};

export type TreeseedSceneCaptureProvider = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
};

export type TreeseedSceneArtifactWriter = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
};

export type TreeseedSceneRenderer = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
};

export type TreeseedSceneDiagramRenderKind =
	| 'operation-lifecycle'
	| 'reconciliation-lifecycle'
	| 'dev-runtime-topology'
	| 'scene-execution-timeline';

export type TreeseedSceneDiagramDefinition = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
	component: string;
	kind: TreeseedSceneDiagramRenderKind;
	defaultDurationSeconds: number;
	validateProps(input: {
		diagram: TreeseedSceneDiagram;
		path: string;
	}): TreeseedSceneDiagnostic[];
	normalizeProps(input: {
		diagram: TreeseedSceneDiagram;
		scene: TreeseedSceneManifest;
		run?: TreeseedSceneRunReport | null;
	}): Record<string, unknown>;
};

export type TreeseedSceneDiagramProvider = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
	diagrams: Record<string, TreeseedSceneDiagramDefinition>;
};

export type TreeseedSceneNarrationProvider = {
	id: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
	generate(input: {
		scene: TreeseedSceneManifest;
		run: TreeseedSceneRunReport;
		transcript: TreeseedSceneTranscriptEntry[];
		style: TreeseedSceneTrainingNarrationStyle;
	}): TreeseedSceneNarrationScriptEntry[];
};

export interface TreeseedScenePlugin {
	id: string;
	version: string;
	phase: TreeseedScenePhase;
	status: TreeseedScenePluginStatus;
	summary: string;
	actions?: Record<string, TreeseedSceneActionHandler>;
	assertions?: Record<string, TreeseedSceneAssertionHandler>;
	environment?: TreeseedSceneEnvironmentProvider;
	captures?: Record<string, TreeseedSceneCaptureProvider>;
	artifacts?: Record<string, TreeseedSceneArtifactWriter>;
	renderers?: Record<string, TreeseedSceneRenderer>;
	diagrams?: Record<string, TreeseedSceneDiagramProvider>;
	narration?: Record<string, TreeseedSceneNarrationProvider>;
}

export type TreeseedScenePluginRegistry = {
	plugins: TreeseedScenePlugin[];
	actions: Map<string, TreeseedSceneActionHandler>;
	actionPlugins: Map<string, string>;
	assertions: Map<string, TreeseedSceneAssertionHandler>;
	assertionPlugins: Map<string, string>;
	environmentProviders: TreeseedSceneEnvironmentProvider[];
	captures: Map<string, TreeseedSceneCaptureProvider>;
	capturePlugins: Map<string, string>;
	artifacts: Map<string, TreeseedSceneArtifactWriter>;
	artifactPlugins: Map<string, string>;
	renderers: Map<string, TreeseedSceneRenderer>;
	rendererPlugins: Map<string, string>;
	diagrams: Map<string, TreeseedSceneDiagramProvider>;
	diagramPlugins: Map<string, string>;
	narration: Map<string, TreeseedSceneNarrationProvider>;
	narrationPlugins: Map<string, string>;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedScenePluginResolution = {
	ok: boolean;
	registry: TreeseedScenePluginRegistry;
	diagnostics: TreeseedSceneDiagnostic[];
	summaries: TreeseedScenePluginSummary[];
};

export type TreeseedSceneRenderProgressEventType =
	| 'scene.render.started'
	| 'scene.render.input.loaded'
	| 'scene.render.bundle.started'
	| 'scene.render.bundle.finished'
	| 'scene.render.composition.selected'
	| 'scene.render.media.started'
	| 'scene.render.media.progress'
	| 'scene.render.media.finished'
	| 'scene.render.finished';

export type TreeseedSceneRenderProgressEvent = {
	type: TreeseedSceneRenderProgressEventType;
	sceneId: string | null;
	runId: string | null;
	renderId: string | null;
	timestamp: string;
	offsetMs: number;
	data: Record<string, unknown>;
};
