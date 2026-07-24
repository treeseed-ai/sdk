
import { SceneRunStatus } from './scene-validation-report.ts';
import { SceneDiagnostic, SceneEnvironment, SceneOperationWaitSpec, ScenePhase } from './scene-schema-version.ts';
import { SceneManifest } from './scene-diagram.ts';
import { SceneRunArtifacts } from './scene-visual-audit-finding.ts';

export type SceneCheckpoint = {
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

export type SceneRunChapterReport = {
	id: string;
	title: string;
	startedAt: string;
	finishedAt: string | null;
	durationMs: number;
	status: SceneRunStatus;
	stepIds: string[];
	segmentIds: string[];
};

export type SceneRunSegmentReport = {
	id: string;
	chapterId: string;
	startedAt: string;
	finishedAt: string | null;
	durationMs: number;
	status: SceneRunStatus;
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

export type SceneProgressEventType =
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

export type SceneProgressEvent = {
	type: SceneProgressEventType;
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

export type ScenePauseController = (input: {
	sceneId: string;
	stepId: string;
	title: string;
	prompt?: string;
}) => Promise<{ ok: boolean; diagnostics: SceneDiagnostic[] }>;

export type SceneEnvironmentPrepareReport = {
	ok: boolean;
	environment: SceneEnvironment;
	readiness: unknown | null;
	dev: {
		requested: boolean;
		reused: boolean;
		started: boolean;
		instances: unknown[];
		baseUrl: string | null;
	};
	diagnostics: SceneDiagnostic[];
};

export type SceneAuthReport = {
	ok: boolean;
	required: boolean;
	profileId: string | null;
	authRoot: string | null;
	hasSession: boolean;
	diagnostics: SceneDiagnostic[];
};

export type SceneSeedReport = {
	ok: boolean;
	requested: boolean;
	seedName: string | null;
	mode: 'none' | 'validate' | 'plan' | 'apply';
	environments: SceneEnvironment[];
	plan: unknown | null;
	result: unknown | null;
	diagnostics: SceneDiagnostic[];
};

export type SceneOperationWaitReport = {
	ok: boolean;
	operationId: string | null;
	kind: string | null;
	finalStatus: string | null;
	acceptedStatuses: string[];
	events: unknown[];
	durationMs: number;
	diagnostics: SceneDiagnostic[];
};

export type SceneRunSetupReport = {
	environment: SceneEnvironmentPrepareReport | null;
	auth: SceneAuthReport | null;
	seed: SceneSeedReport | null;
};

export type SceneEnvironmentPrepareOptions = {
	projectRoot: string;
	scene: SceneManifest;
	environment: SceneEnvironment;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type SceneAuthResolveOptions = {
	projectRoot: string;
	scene: SceneManifest;
	environment: SceneEnvironment;
};

export type SceneSeedOptions = {
	projectRoot: string;
	scene: SceneManifest;
	environment: SceneEnvironment;
	auth: SceneAuthReport | null;
	env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
};

export type SceneOperationWaitOptions = {
	projectRoot: string;
	scene: SceneManifest;
	environment: SceneEnvironment;
	runId: string;
	baseUrl: string;
	spec: SceneOperationWaitSpec;
	linkedOperationIds?: string[];
	onUpdate?: (report: SceneOperationWaitReport) => void;
	fetchOperation?: (operationId: string) => Promise<Record<string, unknown>>;
	fetchEvents?: (operationId: string) => Promise<unknown[]>;
	sleep?: (ms: number) => Promise<void>;
};

export type SceneLogCollectOptions = {
	projectRoot: string;
	artifacts: SceneRunArtifacts;
	environmentReport?: SceneEnvironmentPrepareReport | null;
};

export type SceneEnvironmentAdapter = (input: SceneEnvironmentPrepareOptions) => Promise<SceneEnvironmentPrepareReport>;

export type SceneAuthResolver = (input: SceneAuthResolveOptions) => SceneAuthReport;

export type SceneSeedRunner = (input: SceneSeedOptions) => Promise<SceneSeedReport>;

export type SceneOperationWaiter = (input: SceneOperationWaitOptions) => Promise<SceneOperationWaitReport>;

export type SceneLogCollector = (input: SceneLogCollectOptions) => SceneLogReport;

export type SceneLogReport = {
	ok: boolean;
	logs: Record<string, string | null>;
	diagnostics: SceneDiagnostic[];
};

export type SceneBaseUrlResolution = {
	ok: boolean;
	baseUrl: string | null;
	diagnostics: SceneDiagnostic[];
};

export type ScenePluginStatus = 'available' | 'planned' | 'deferred';

export type ScenePluginCategory =
	| 'action'
	| 'assertion'
	| 'environment'
	| 'capture'
	| 'artifact'
	| 'renderer'
	| 'diagram'
	| 'narration';

export type ScenePluginSummary = {
	id: string;
	version: string;
	status: ScenePluginStatus;
	categories: ScenePluginCategory[];
	phase: ScenePhase;
	summary: string;
};

export type SceneActionDefinition = {
	id: string;
	phase: ScenePhase;
	pluginId: string;
	status: ScenePluginStatus;
	summary: string;
};

export type SceneAssertionDefinition = {
	id: string;
	phase: ScenePhase;
	pluginId: string;
	status: ScenePluginStatus;
	summary: string;
};

export type SceneRendererDefinition = {
	id: string;
	phase: ScenePhase;
	pluginId: string;
	status: ScenePluginStatus;
	summary: string;
};

export type ScenePluginDiagnostic = SceneDiagnostic & {
	pluginId?: string;
	category?: ScenePluginCategory;
};
