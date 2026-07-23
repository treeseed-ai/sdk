
import { TreeseedSceneEvidencePaths, TreeseedSceneExternalPublishTarget, TreeseedScenePublishPaths, TreeseedScenePublishPlanManifest, TreeseedScenePublishPlanMode, TreeseedScenePublishPlanPhase } from './treeseed-scene-evidence-artifact-kind.ts';
import { TreeseedSceneBrowser, TreeseedSceneCapability, TreeseedSceneDeviceProfile, TreeseedSceneDiagnostic, TreeseedSceneEnvironment } from './treeseed-scene-schema-version.ts';
import { TreeseedSceneRenderInput, TreeseedSceneTrainingOutputPaths } from './treeseed-scene-render-input.ts';
import { TreeseedSceneRenderMode, TreeseedSceneRunOptions, TreeseedSceneRunPhase, TreeseedSceneRunStatus } from './treeseed-scene-validation-report.ts';
import { TreeseedSceneRenderEvidenceFit } from './treeseed-scene-diagram.ts';
import { TreeseedSceneAssertionRunReport, TreeseedSceneRunArtifacts, TreeseedSceneRunStepReport } from './treeseed-scene-visual-audit-finding.ts';
import { TreeseedSceneCheckpoint, TreeseedSceneOperationWaitReport, TreeseedSceneRunChapterReport, TreeseedSceneRunSegmentReport, TreeseedSceneRunSetupReport } from './treeseed-scene-checkpoint.ts';

export type TreeseedScenePublishPlanPaths = {
	publishPlanRoot: string;
	manifestPath: string;
	reportPath: string;
	exportRoot: string | null;
	exportManifestPath: string | null;
};

export type TreeseedScenePublishPlanOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	targets?: TreeseedSceneExternalPublishTarget[];
	mode?: TreeseedScenePublishPlanMode;
	timestamp?: string;
};

export type TreeseedScenePublishPlanReport = {
	ok: boolean;
	phase: TreeseedScenePublishPlanPhase;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	publishRoot: string | null;
	publishPlanRoot: string | null;
	manifest: TreeseedScenePublishPlanManifest | null;
	paths: TreeseedScenePublishPlanPaths | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneRenderInputLoadReport = {
	ok: boolean;
	input: TreeseedSceneRenderInput | null;
	runRoot: string | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneRemotionCompositionDefinition = {
	id: string;
	phase: 6;
	mode: TreeseedSceneRenderMode;
	summary: string;
};

export type TreeseedSceneRunReport = {
	ok: boolean;
	phase: TreeseedSceneRunPhase;
	sceneId: string | null;
	runId: string | null;
	scenePath: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	environment: TreeseedSceneEnvironment;
	baseUrl: string | null;
	browser: TreeseedSceneBrowser | null;
	device?: TreeseedSceneDeviceProfile | null;
	capture?: {
		viewport: { width: number; height: number };
		videoSize: { width: number; height: number } | null;
		renderResolution: { width: number; height: number } | null;
		evidenceFit: TreeseedSceneRenderEvidenceFit;
	} | null;
	workflowStatus: TreeseedSceneRunStatus;
	steps: TreeseedSceneRunStepReport[];
	failedStep: string | null;
	assertions: TreeseedSceneAssertionRunReport[];
	artifacts: TreeseedSceneRunArtifacts | null;
	timelinePath: string | null;
	playwrightTracePath: string | null;
	videoPaths: string[];
	renderedVideoPaths: string[];
	trainingOutputPaths?: TreeseedSceneTrainingOutputPaths | null;
	evidencePaths?: TreeseedSceneEvidencePaths | null;
	publishPaths?: TreeseedScenePublishPaths | null;
	publishPlanPaths?: TreeseedScenePublishPlanPaths | null;
	logs: Record<string, string | null>;
	setup: TreeseedSceneRunSetupReport | null;
	operations: TreeseedSceneOperationWaitReport[];
	chapters: TreeseedSceneRunChapterReport[];
	segments: TreeseedSceneRunSegmentReport[];
	checkpoints: TreeseedSceneCheckpoint[];
	resumedFrom?: {
		runRoot: string;
		checkpointId: string;
		sourceRunId: string | null;
	} | null;
	progressPath: string | null;
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneResumeOptions = Omit<TreeseedSceneRunOptions, 'scene'> & {
	run: string;
	fromCheckpoint: string;
};

export type TreeseedSceneInspectOptions = {
	projectRoot: string;
	run: string;
	stepId?: string;
};

export type TreeseedSceneInspectReport = {
	ok: boolean;
	runRoot: string | null;
	run: TreeseedSceneRunReport | null;
	timeline: TreeseedSceneTimelineEvent[];
	chapters: TreeseedSceneRunChapterReport[];
	segments: TreeseedSceneRunSegmentReport[];
	checkpoints: TreeseedSceneCheckpoint[];
	selectedStep: TreeseedSceneRunStepReport | null;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneTimelineEvent = {
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

export type TreeseedSceneBrowserLaunchInput = {
	browser: TreeseedSceneBrowser;
	viewport: { width: number; height: number };
	videoSize?: { width: number; height: number } | null;
	recordVideoDir?: string | null;
	tracePath?: string | null;
	userAgent?: string;
	deviceScaleFactor?: number;
	isMobile?: boolean;
	hasTouch?: boolean;
};

export type TreeseedSceneLocator = {
	first?(): TreeseedSceneLocator;
	waitFor(options?: { state?: 'visible'; timeout?: number }): Promise<void>;
	click(): Promise<void>;
	fill(value: string): Promise<void>;
	selectOption?(option: string | { label: string }): Promise<void>;
	isVisible(): Promise<boolean>;
};

export type TreeseedScenePage = {
	goto(url: string, options?: { waitUntil?: 'load' | 'domcontentLoaded' | 'domcontentloaded' | 'networkidle'; timeout?: number }): Promise<{ status(): number; url(): string } | null | undefined>;
	url(): string;
	locator(selector: string): TreeseedSceneLocator;
	getByTestId(testId: string): TreeseedSceneLocator;
	getByRole(role: string, options?: { name?: string }): TreeseedSceneLocator;
	getByText(text: string): TreeseedSceneLocator;
	keyboard: {
		press(key: string): Promise<void>;
	};
	screenshot(options: { path: string; fullPage?: boolean }): Promise<void>;
	on(event: 'console', handler: (message: { type(): string; text(): string }) => void): void;
	on(event: 'requestfailed', handler: (request: { url(): string; method(): string; failure(): { errorText: string } | null }) => void): void;
	on(event: 'response', handler: (response: { url(): string; status(): number; request(): { method(): string }; json?(): Promise<unknown> }) => void): void;
};

export type TreeseedSceneBrowserSession = {
	page: TreeseedScenePage;
	startTracing?(): Promise<void>;
	stopTracing?(tracePath: string): Promise<void>;
	videoPaths?(): Promise<string[]>;
	close(): Promise<void>;
};

export type TreeseedSceneBrowserAdapter = {
	launch(input: TreeseedSceneBrowserLaunchInput): Promise<TreeseedSceneBrowserSession>;
};

export type TreeseedScenePhase0Report = {
	ok: boolean;
	phase: 0;
	status: 'foundation_ready';
	name: 'central TreeSeed acceptance test harness and demo / educational video generator';
	commandSurface: string[];
	sdkExports: string[];
	capabilities: TreeseedSceneCapability[];
	deferredDependencies: string[];
	activeOptionalDependencies?: string[];
	nextPhase: {
		phase: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
		summary: string;
		requiredChanges: string[];
	};
};
