
import { TreeseedSceneRunStatus } from './treeseed-scene-validation-report.ts';
import { TreeseedSceneDiagnostic, TreeseedSceneEnvironment, TreeseedSceneOperationWaitSpec, TreeseedScenePhase } from './treeseed-scene-schema-version.ts';
import { TreeseedSceneManifest } from './treeseed-scene-diagram.ts';
import { TreeseedSceneRunArtifacts } from './treeseed-scene-visual-audit-finding.ts';

export type TreeseedSceneCheckpoint = {
	id: string;
	sceneId: string;
	runId: string;
	stepId: string;
	chapterId: string;
	segmentId: string;
	createdAt: string;
	resumable: boolean;
	completedStepIds: string[];
	nextStepId: string | null;
	artifactPaths: {
		checkpointPath: string;
		runRoot: string;
		timelinePath: string;
		reportPath: string;
	};
};

export type TreeseedSceneRunChapterReport = {
	id: string;
	title: string;
	startedAt: string;
	finishedAt: string | null;
	durationMs: number;
	status: TreeseedSceneRunStatus;
	stepIds: string[];
	segmentIds: string[];
};

export type TreeseedSceneRunSegmentReport = {
	id: string;
	chapterId: string;
	startedAt: string;
	finishedAt: string | null;
	durationMs: number;
	status: TreeseedSceneRunStatus;
	stepIds: string[];
	timelinePath: string;
	stepsPath: string;
	segmentPath: string;
	videoRefs: Array<{
		path: string;
		startOffsetMs: number;
		endOffsetMs: number;
	}>;
};

export type TreeseedSceneProgressEventType =
	| 'scene.run.started'
	| 'scene.run.heartbeat'
	| 'scene.run.finished'
	| 'setup.started'
	| 'setup.finished'
	| 'chapter.started'
	| 'chapter.finished'
	| 'segment.started'
	| 'segment.finished'
	| 'step.started'
	| 'step.finished'
	| 'checkpoint.written'
	| 'pause.waiting'
	| 'pause.resumed'
	| 'resume.started'
	| 'resume.replay.started'
	| 'resume.replay.finished'
	| 'resume.finished';

export type TreeseedSceneProgressEvent = {
	type: TreeseedSceneProgressEventType;
	sceneId: string | null;
	runId: string | null;
	timestamp: string;
	offsetMs: number;
	chapterId?: string | null;
	segmentId?: string | null;
	stepId?: string | null;
	checkpointId?: string | null;
	status?: string;
	data: Record<string, unknown>;
};

export type TreeseedScenePauseController = (input: {
	sceneId: string;
	stepId: string;
	title: string;
	prompt?: string;
}) => Promise<{ ok: boolean; diagnostics: TreeseedSceneDiagnostic[] }>;

export type TreeseedSceneEnvironmentPrepareReport = {
	ok: boolean;
	environment: TreeseedSceneEnvironment;
	readiness: unknown | null;
	dev: {
		requested: boolean;
		reused: boolean;
		started: boolean;
		instances: unknown[];
		baseUrl: string | null;
	};
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneAuthReport = {
	ok: boolean;
	required: boolean;
	profileId: string | null;
	authRoot: string | null;
	hasSession: boolean;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneSeedReport = {
	ok: boolean;
	requested: boolean;
	seedName: string | null;
	mode: 'none' | 'validate' | 'plan' | 'apply';
	environments: TreeseedSceneEnvironment[];
	plan: unknown | null;
	result: unknown | null;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneOperationWaitReport = {
	ok: boolean;
	operationId: string | null;
	kind: string | null;
	finalStatus: string | null;
	acceptedStatuses: string[];
	events: unknown[];
	durationMs: number;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneRunSetupReport = {
	environment: TreeseedSceneEnvironmentPrepareReport | null;
	auth: TreeseedSceneAuthReport | null;
	seed: TreeseedSceneSeedReport | null;
};

export type TreeseedSceneEnvironmentPrepareOptions = {
	projectRoot: string;
	scene: TreeseedSceneManifest;
	environment: TreeseedSceneEnvironment;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type TreeseedSceneAuthResolveOptions = {
	projectRoot: string;
	scene: TreeseedSceneManifest;
	environment: TreeseedSceneEnvironment;
};

export type TreeseedSceneSeedOptions = {
	projectRoot: string;
	scene: TreeseedSceneManifest;
	environment: TreeseedSceneEnvironment;
	auth: TreeseedSceneAuthReport | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type TreeseedSceneOperationWaitOptions = {
	projectRoot: string;
	scene: TreeseedSceneManifest;
	environment: TreeseedSceneEnvironment;
	runId: string;
	baseUrl: string;
	spec: TreeseedSceneOperationWaitSpec;
	linkedOperationIds?: string[];
	onUpdate?: (report: TreeseedSceneOperationWaitReport) => void;
	fetchOperation?: (operationId: string) => Promise<Record<string, unknown>>;
	fetchEvents?: (operationId: string) => Promise<unknown[]>;
	sleep?: (ms: number) => Promise<void>;
};

export type TreeseedSceneLogCollectOptions = {
	projectRoot: string;
	artifacts: TreeseedSceneRunArtifacts;
	environmentReport?: TreeseedSceneEnvironmentPrepareReport | null;
};

export type TreeseedSceneEnvironmentAdapter = (input: TreeseedSceneEnvironmentPrepareOptions) => Promise<TreeseedSceneEnvironmentPrepareReport>;

export type TreeseedSceneAuthResolver = (input: TreeseedSceneAuthResolveOptions) => TreeseedSceneAuthReport;

export type TreeseedSceneSeedRunner = (input: TreeseedSceneSeedOptions) => Promise<TreeseedSceneSeedReport>;

export type TreeseedSceneOperationWaiter = (input: TreeseedSceneOperationWaitOptions) => Promise<TreeseedSceneOperationWaitReport>;

export type TreeseedSceneLogCollector = (input: TreeseedSceneLogCollectOptions) => TreeseedSceneLogReport;

export type TreeseedSceneLogReport = {
	ok: boolean;
	logs: Record<string, string | null>;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneBaseUrlResolution = {
	ok: boolean;
	baseUrl: string | null;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedScenePluginStatus = 'available' | 'planned' | 'deferred';

export type TreeseedScenePluginCategory =
	| 'action'
	| 'assertion'
	| 'environment'
	| 'capture'
	| 'artifact'
	| 'renderer'
	| 'diagram'
	| 'narration';

export type TreeseedScenePluginSummary = {
	id: string;
	version: string;
	status: TreeseedScenePluginStatus;
	categories: TreeseedScenePluginCategory[];
	phase: TreeseedScenePhase;
	summary: string;
};

export type TreeseedSceneActionDefinition = {
	id: string;
	phase: TreeseedScenePhase;
	pluginId: string;
	status: TreeseedScenePluginStatus;
	summary: string;
};

export type TreeseedSceneAssertionDefinition = {
	id: string;
	phase: TreeseedScenePhase;
	pluginId: string;
	status: TreeseedScenePluginStatus;
	summary: string;
};

export type TreeseedSceneRendererDefinition = {
	id: string;
	phase: TreeseedScenePhase;
	pluginId: string;
	status: TreeseedScenePluginStatus;
	summary: string;
};

export type TreeseedScenePluginDiagnostic = TreeseedSceneDiagnostic & {
	pluginId?: string;
	category?: TreeseedScenePluginCategory;
};
