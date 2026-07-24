
import { SceneExecutionMode, SceneManifest } from './scene-diagram.ts';
import { SceneArtifactPathPlan, SceneBrowser, SceneDeviceProfileId, SceneDiagnostic, SceneEnvironment } from './scene-schema-version.ts';
import { SceneAuthResolver, SceneEnvironmentAdapter, SceneLogCollector, SceneOperationWaiter, ScenePauseController, ScenePluginSummary, SceneProgressEvent, SceneSeedRunner } from './scene-checkpoint.ts';
import { SceneBrowserAdapter, SceneRunReport } from './scene-publish-plan-paths.ts';
import { ScenePlugin } from './scene-timeline-writer.ts';

export type SceneValidationReport = {
	ok: boolean;
	scenePath: string;
	scene: SceneManifest | null;
	diagnostics: SceneDiagnostic[];
};

export type ScenePlanStep = {
	id: string;
	title: string;
	actionKind: string;
	assertionKinds: string[];
	chapterId: string | null;
	demoOnly: boolean;
};

export type ScenePlanReport = {
	ok: boolean;
	phase: 1;
	scenePath: string;
	sceneId: string | null;
	title: string | null;
	environment: SceneEnvironment;
	baseUrl: string | 'auto';
	browser: SceneBrowser | null;
	viewport: { width: number; height: number } | null;
	workflowSteps: ScenePlanStep[];
	enabledActions: string[];
	enabledAssertions: string[];
	enabledRenderers: string[];
	enabledDiagrams: string[];
	enabledDiagramPlugins: string[];
	enabledTrainingOutputs: string[];
	enabledNarrationPlugins: string[];
	enabledDeviceProfiles: string[];
	enabledPlugins: string[];
	plugins: ScenePluginSummary[];
	pluginDiagnostics: SceneDiagnostic[];
	artifactPaths: SceneArtifactPathPlan | null;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
	estimatedDurationSeconds: number | null;
};

export type SceneRunStatus = 'passed' | 'failed' | 'blocked';

export type SceneStepStatus = 'passed' | 'failed' | 'skipped';

export type SceneRunPhase = 2 | 3 | 4 | 5;

export type SceneRenderPhase = 6;

export type SceneVisualAuditPhase = 11;

export type SceneRenderFormat = 'mp4';

export type SceneRenderMode =
	| 'demo'
	| 'training'
	| 'failure-review'
	| 'chapter'
	| 'diagram-only';

export type SceneRunOptions = {
	projectRoot: string;
	scene: string | SceneManifest;
	environment?: SceneEnvironment;
	device?: SceneDeviceProfileId;
	browser?: SceneBrowser;
	authRole?: SceneVisualAuditRole;
	record?: boolean;
	artifactMode?: 'full' | 'screenshots';
	runId?: string;
	timestamp?: string;
	browserAdapter?: SceneBrowserAdapter;
	environmentAdapter?: SceneEnvironmentAdapter;
	authResolver?: SceneAuthResolver;
	seedRunner?: SceneSeedRunner;
	operationWaiter?: SceneOperationWaiter;
	logCollector?: SceneLogCollector;
	plugins?: ScenePlugin[];
	mode?: SceneExecutionMode;
	interactive?: boolean;
	pauseController?: ScenePauseController;
	onProgress?: (event: SceneProgressEvent) => void;
	sleep?: (ms: number) => Promise<void>;
};

export type SceneDeviceMatrixOptions = {
	projectRoot: string;
	scene: string;
	environment?: SceneEnvironment;
	devices?: SceneDeviceProfileId[];
	browser?: SceneBrowser;
	authRole?: SceneVisualAuditRole;
	record?: boolean;
	artifactMode?: 'full' | 'screenshots';
	mode?: SceneExecutionMode;
	timestamp?: string;
	browserAdapter?: SceneBrowserAdapter;
};

export type SceneDeviceMatrixReport = {
	ok: boolean;
	phase: 11;
	sceneId: string | null;
	matrixId: string | null;
	scenePath: string;
	devices: SceneDeviceProfileId[];
	runReports: SceneRunReport[];
	matrixRoot: string | null;
	matrixPath: string | null;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type SceneVisualAuditRole =
	| 'anonymous'
	| 'owner'
	| 'admin'
	| 'member'
	| string;

export type SceneVisualAuditRouteSource =
	| 'core-route-registry'
	| 'admin-route-registry'
	| 'tenant-page-override'
	| 'content-collection'
	| 'explicit-manifest';

export type SceneVisualAuditReviewDetail =
	| 'summary'
	| 'standard'
	| 'full';

export type SceneVisualAuditReviewCategory =
	| 'functional'
	| 'client-error'
	| 'display'
	| 'content'
	| 'architecture';

export type SceneVisualAuditFindingSeverity =
	| 'blocking'
	| 'high'
	| 'medium'
	| 'low'
	| 'info';

export type SceneVisualAuditFindingOwner =
	| '@treeseed/ui'
	| '@treeseed/admin'
	| '@treeseed/core'
	| '@treeseed/market'
	| '@treeseed/api'
	| '@treeseed/sdk'
	| '@treeseed/cli'
	| 'unknown';

export type SceneVisualAuditRoute = {
	id: string;
	path: string;
	pathRoot: string;
	title?: string | null;
	source: SceneVisualAuditRouteSource;
	requiresAuth: boolean;
	roles: SceneVisualAuditRole[];
	dynamic: boolean;
	contentCollection?: string | null;
	contentSlug?: string | null;
	expectedStatus?: number | number[] | null;
	expectedFinalPath?: string | null;
	expectedAuthRedirect?: boolean;
	expectedEmpty?: boolean;
};

export type SceneVisualAuditCapture = {
	id: string;
	routeId: string;
	path: string;
	pathRoot: string;
	role: SceneVisualAuditRole;
	device: SceneDeviceProfileId;
	url: string;
	status: 'captured' | 'failed' | 'skipped';
	httpStatus: number | null;
	finalUrl: string | null;
	screenshotPath: string | null;
	fullPageScreenshotPath: string | null;
	capturedAt: string;
	durationMs: number;
	dom?: SceneVisualAuditDomSummary | null;
	clientErrors?: SceneVisualAuditClientError[];
	diagnostics: SceneDiagnostic[];
};

export type SceneVisualAuditClientError = {
	id: string;
	captureId: string;
	kind: 'console' | 'pageerror' | 'requestfailed' | 'http-error' | 'uncaught-exception';
	severity: 'warning' | 'error';
	message: string;
	url: string | null;
	method?: string | null;
	status?: number | null;
	timestamp: string;
	path?: string;
	pathRoot?: string;
	role?: SceneVisualAuditRole;
	device?: SceneDeviceProfileId;
	screenshotPath?: string | null;
	finalUrl?: string | null;
};

export type SceneVisualAuditDomSummary = {
	title: string | null;
	h1: string | null;
	headings: string[];
	visibleTextSample: string;
	bodyTextLength: number;
	visibleLinkCount: number;
	visibleButtonCount: number;
	visibleInputCount: number;
	visibleFormCount: number;
	appShellDetected: boolean;
	authShellDetected: boolean;
	publicShellDetected: boolean;
	horizontalOverflow: boolean;
	scrollWidth: number;
	scrollHeight: number;
	viewportWidth: number;
	viewportHeight: number;
	defaultStyledLinks: Array<{
		text: string;
		href: string | null;
		selectorHint: string | null;
	}>;
	defaultStyledButtons: Array<{
		text: string;
		selectorHint: string | null;
	}>;
	visibleErrorTexts: string[];
	seededEntityTexts: string[];
};
