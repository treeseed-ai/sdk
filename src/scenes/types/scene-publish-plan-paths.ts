
import { SceneEvidencePaths, SceneExternalPublishTarget, ScenePublishPaths, ScenePublishPlanManifest, ScenePublishPlanMode, ScenePublishPlanPhase } from './scene-evidence-artifact-kind.ts';
import { SceneBrowser, SceneCapability, SceneDeviceProfile, SceneDiagnostic, SceneEnvironment } from './scene-schema-version.ts';
import { SceneRenderInput, SceneTrainingOutputPaths } from './scene-render-input.ts';
import { SceneRenderMode, SceneRunOptions, SceneRunPhase, SceneRunStatus } from './scene-validation-report.ts';
import { SceneRenderEvidenceFit } from './scene-diagram.ts';
import { SceneAssertionRunReport, SceneRunArtifacts, SceneRunStepReport } from './scene-visual-audit-finding.ts';
import { SceneCheckpoint, SceneOperationWaitReport, SceneRunChapterReport, SceneRunSegmentReport, SceneRunSetupReport } from './scene-checkpoint.ts';

export type ScenePublishPlanPaths = {
	publishPlanRoot: string;
	manifestPath: string;
	reportPath: string;
	exportRoot: string | null;
	exportManifestPath: string | null;
};

export type ScenePublishPlanOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	targets?: SceneExternalPublishTarget[];
	mode?: ScenePublishPlanMode;
	timestamp?: string;
};

export type ScenePublishPlanReport = {
	ok: boolean;
	phase: ScenePublishPlanPhase;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	publishRoot: string | null;
	publishPlanRoot: string | null;
	manifest: ScenePublishPlanManifest | null;
	paths: ScenePublishPlanPaths | null;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type SceneRenderInputLoadReport = {
	ok: boolean;
	input: SceneRenderInput | null;
	runRoot: string | null;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type SceneRemotionCompositionDefinition = {
	id: string;
	phase: 6;
	mode: SceneRenderMode;
	summary: string;
};

export type SceneRunReport = {
	ok: boolean;
	phase: SceneRunPhase;
	sceneId: string | null;
	runId: string | null;
	scenePath: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	environment: SceneEnvironment;
	baseUrl: string | null;
	browser: SceneBrowser | null;
	device?: SceneDeviceProfile | null;
	capture?: {
		viewport: { width: number; height: number };
		videoSize: { width: number; height: number } | null;
		renderResolution: { width: number; height: number } | null;
		evidenceFit: SceneRenderEvidenceFit;
	} | null;
	workflowStatus: SceneRunStatus;
	steps: SceneRunStepReport[];
	failedStep: string | null;
	assertions: SceneAssertionRunReport[];
	artifacts: SceneRunArtifacts | null;
	timelinePath: string | null;
	playwrightTracePath: string | null;
	videoPaths: string[];
	renderedVideoPaths: string[];
	trainingOutputPaths?: SceneTrainingOutputPaths | null;
	evidencePaths?: SceneEvidencePaths | null;
	publishPaths?: ScenePublishPaths | null;
	publishPlanPaths?: ScenePublishPlanPaths | null;
	logs: Record<string, string | null>;
	setup: SceneRunSetupReport | null;
	operations: SceneOperationWaitReport[];
	chapters: SceneRunChapterReport[];
	segments: SceneRunSegmentReport[];
	checkpoints: SceneCheckpoint[];
	resumedFrom?: {
		runRoot: string;
		checkpointId: string;
		sourceRunId: string | null;
	} | null;
	progressPath: string | null;
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
	diagnostics: SceneDiagnostic[];
};

export type SceneResumeOptions = Omit<SceneRunOptions, 'scene'> & {
	run: string;
	fromCheckpoint: string;
};

export type SceneInspectOptions = {
	projectRoot: string;
	run: string;
	stepId?: string;
};

export type SceneInspectReport = {
	ok: boolean;
	runRoot: string | null;
	run: SceneRunReport | null;
	timeline: SceneTimelineEvent[];
	chapters: SceneRunChapterReport[];
	segments: SceneRunSegmentReport[];
	checkpoints: SceneCheckpoint[];
	selectedStep: SceneRunStepReport | null;
	diagnostics: SceneDiagnostic[];
};

export type SceneTimelineEvent = {
	id: string;
	type:
		| 'scene.start'
		| 'scene.end'
		| 'step.start'
		| 'step.end'
		| 'action.start'
		| 'action.end'
		| 'assertion.start'
		| 'assertion.end'
		| 'console'
		| 'network'
		| 'screenshot'
		| 'error'
		| 'setup.start'
		| 'setup.end'
		| 'readiness.start'
		| 'readiness.end'
		| 'seed.plan.start'
		| 'seed.plan.end'
		| 'seed.apply.start'
		| 'seed.apply.end'
		| 'auth.resolve'
		| 'operation.detected'
		| 'mailpit.confirm.open'
		| 'operation.poll.start'
		| 'operation.poll.tick'
		| 'operation.poll.end'
		| 'chapter.start'
		| 'chapter.end'
		| 'segment.start'
		| 'segment.end'
		| 'checkpoint.write'
		| 'checkpoint.skip'
		| 'pause.waiting'
		| 'pause.resumed'
		| 'resume.start'
		| 'resume.replay.start'
		| 'resume.replay.end'
		| 'resume.end'
		| 'heartbeat'
		| 'timeout';
	sceneId: string;
	runId: string;
	stepId?: string;
	timestamp: string;
	offsetMs: number;
	data: Record<string, unknown>;
};

export type SceneBrowserLaunchInput = {
	browser: SceneBrowser;
	viewport: { width: number; height: number };
	videoSize?: { width: number; height: number } | null;
	recordVideoDir?: string | null;
	tracePath?: string | null;
	userAgent?: string;
	deviceScaleFactor?: number;
	isMobile?: boolean;
	hasTouch?: boolean;
};

export type SceneLocator = {
	first?(): SceneLocator;
	waitFor(options?: { state?: 'visible'; timeout?: number }): Promise<void>;
	click(): Promise<void>;
	fill(value: string): Promise<void>;
	selectOption?(option: string | { label: string }): Promise<void>;
	isVisible(): Promise<boolean>;
};

export type ScenePage = {
	goto(url: string, options?: { waitUntil?: 'load' | 'domcontentLoaded' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<{ status(): number; url(): string } | null | undefined>;
	url(): string;
	locator(selector: string): SceneLocator;
	getByTestId(testId: string): SceneLocator;
	getByRole(role: string, options?: { name?: string }): SceneLocator;
	getByText(text: string): SceneLocator;
	keyboard: {
		press(key: string): Promise<void>;
	};
	screenshot(options: { path: string; fullPage?: boolean }): Promise<void>;
	on(event: 'console', handler: (message: { type(): string; text(): string }) => void): void;
	on(event: 'requestfailed', handler: (request: { url(): string; method(): string; failure(): { errorText: string } | null }) => void): void;
	on(event: 'response', handler: (response: { url(): string; status(): number; request(): { method(): string }; json?(): Promise<unknown> }) => void): void;
};

export type SceneBrowserSession = {
	page: ScenePage;
	startTracing?(): Promise<void>;
	stopTracing?(tracePath: string): Promise<void>;
	videoPaths?(): Promise<string[]>;
	close(): Promise<void>;
};

export type SceneBrowserAdapter = {
	launch(input: SceneBrowserLaunchInput): Promise<SceneBrowserSession>;
};

export type ScenePhase0Report = {
	ok: boolean;
	phase: 0;
	status: 'foundation_ready';
	name: 'central TreeSeed acceptance test harness and demo / educational video generator';
	commandSurface: string[];
	sdkExports: string[];
	capabilities: SceneCapability[];
	deferredDependencies: string[];
	activeOptionalDependencies?: string[];
	nextPhase: {
		phase: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
		summary: string;
		requiredChanges: string[];
	};
};
