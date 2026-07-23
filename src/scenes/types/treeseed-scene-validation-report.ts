
import { TreeseedSceneExecutionMode, TreeseedSceneManifest } from './treeseed-scene-diagram.ts';
import { TreeseedSceneArtifactPathPlan, TreeseedSceneBrowser, TreeseedSceneDeviceProfileId, TreeseedSceneDiagnostic, TreeseedSceneEnvironment } from './treeseed-scene-schema-version.ts';
import { TreeseedSceneAuthResolver, TreeseedSceneEnvironmentAdapter, TreeseedSceneLogCollector, TreeseedSceneOperationWaiter, TreeseedScenePauseController, TreeseedScenePluginSummary, TreeseedSceneProgressEvent, TreeseedSceneSeedRunner } from './treeseed-scene-checkpoint.ts';
import { TreeseedSceneBrowserAdapter, TreeseedSceneRunReport } from './treeseed-scene-publish-plan-paths.ts';
import { TreeseedScenePlugin } from './treeseed-scene-timeline-writer.ts';

export type TreeseedSceneValidationReport = {
	ok: boolean;
	scenePath: string;
	scene: TreeseedSceneManifest | null;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedScenePlanStep = {
	id: string;
	title: string;
	actionKind: string;
	assertionKinds: string[];
	chapterId: string | null;
	demoOnly: boolean;
};

export type TreeseedScenePlanReport = {
	ok: boolean;
	phase: 1;
	scenePath: string;
	sceneId: string | null;
	title: string | null;
	environment: TreeseedSceneEnvironment;
	baseUrl: string | 'auto';
	browser: TreeseedSceneBrowser | null;
	viewport: { width: number; height: number } | null;
	workflowSteps: TreeseedScenePlanStep[];
	enabledActions: string[];
	enabledAssertions: string[];
	enabledRenderers: string[];
	enabledDiagrams: string[];
	enabledDiagramPlugins: string[];
	enabledTrainingOutputs: string[];
	enabledNarrationPlugins: string[];
	enabledDeviceProfiles: string[];
	enabledPlugins: string[];
	plugins: TreeseedScenePluginSummary[];
	pluginDiagnostics: TreeseedSceneDiagnostic[];
	artifactPaths: TreeseedSceneArtifactPathPlan | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
	estimatedDurationSeconds: number | null;
};

export type TreeseedSceneRunStatus = 'passed' | 'failed' | 'blocked';

export type TreeseedSceneStepStatus = 'passed' | 'failed' | 'skipped';

export type TreeseedSceneRunPhase = 2 | 3 | 4 | 5;

export type TreeseedSceneRenderPhase = 6;

export type TreeseedSceneVisualAuditPhase = 11;

export type TreeseedSceneRenderFormat = 'mp4';

export type TreeseedSceneRenderMode =
	| 'demo'
	| 'training'
	| 'failure-review'
	| 'chapter'
	| 'diagram-only';

export type TreeseedSceneRunOptions = {
	projectRoot: string;
	scene: string | TreeseedSceneManifest;
	environment?: TreeseedSceneEnvironment;
	device?: TreeseedSceneDeviceProfileId;
	browser?: TreeseedSceneBrowser;
	authRole?: TreeseedSceneVisualAuditRole;
	record?: boolean;
	artifactMode?: 'full' | 'screenshots';
	runId?: string;
	timestamp?: string;
	browserAdapter?: TreeseedSceneBrowserAdapter;
	environmentAdapter?: TreeseedSceneEnvironmentAdapter;
	authResolver?: TreeseedSceneAuthResolver;
	seedRunner?: TreeseedSceneSeedRunner;
	operationWaiter?: TreeseedSceneOperationWaiter;
	logCollector?: TreeseedSceneLogCollector;
	plugins?: TreeseedScenePlugin[];
	mode?: TreeseedSceneExecutionMode;
	interactive?: boolean;
	pauseController?: TreeseedScenePauseController;
	onProgress?: (event: TreeseedSceneProgressEvent) => void;
	sleep?: (ms: number) => Promise<void>;
};

export type TreeseedSceneDeviceMatrixOptions = {
	projectRoot: string;
	scene: string;
	environment?: TreeseedSceneEnvironment;
	devices?: TreeseedSceneDeviceProfileId[];
	browser?: TreeseedSceneBrowser;
	authRole?: TreeseedSceneVisualAuditRole;
	record?: boolean;
	artifactMode?: 'full' | 'screenshots';
	mode?: TreeseedSceneExecutionMode;
	timestamp?: string;
	browserAdapter?: TreeseedSceneBrowserAdapter;
};

export type TreeseedSceneDeviceMatrixReport = {
	ok: boolean;
	phase: 11;
	sceneId: string | null;
	matrixId: string | null;
	scenePath: string;
	devices: TreeseedSceneDeviceProfileId[];
	runReports: TreeseedSceneRunReport[];
	matrixRoot: string | null;
	matrixPath: string | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneVisualAuditRole =
	| 'anonymous'
	| 'owner'
	| 'admin'
	| 'member'
	| string;

export type TreeseedSceneVisualAuditRouteSource =
	| 'core-route-registry'
	| 'admin-route-registry'
	| 'tenant-page-override'
	| 'content-collection'
	| 'explicit-manifest';

export type TreeseedSceneVisualAuditReviewDetail =
	| 'summary'
	| 'standard'
	| 'full';

export type TreeseedSceneVisualAuditReviewCategory =
	| 'functional'
	| 'client-error'
	| 'display'
	| 'content'
	| 'architecture';

export type TreeseedSceneVisualAuditFindingSeverity =
	| 'blocking'
	| 'high'
	| 'medium'
	| 'low'
	| 'info';

export type TreeseedSceneVisualAuditFindingOwner =
	| '@treeseed/ui'
	| '@treeseed/admin'
	| '@treeseed/core'
	| '@treeseed/market'
	| '@treeseed/api'
	| '@treeseed/sdk'
	| '@treeseed/cli'
	| 'unknown';

export type TreeseedSceneVisualAuditRoute = {
	id: string;
	path: string;
	pathRoot: string;
	title?: string | null;
	source: TreeseedSceneVisualAuditRouteSource;
	requiresAuth: boolean;
	roles: TreeseedSceneVisualAuditRole[];
	dynamic: boolean;
	contentCollection?: string | null;
	contentSlug?: string | null;
	expectedStatus?: number | number[] | null;
	expectedFinalPath?: string | null;
	expectedAuthRedirect?: boolean;
	expectedEmpty?: boolean;
};

export type TreeseedSceneVisualAuditCapture = {
	id: string;
	routeId: string;
	path: string;
	pathRoot: string;
	role: TreeseedSceneVisualAuditRole;
	device: TreeseedSceneDeviceProfileId;
	url: string;
	status: 'captured' | 'failed' | 'skipped';
	httpStatus: number | null;
	finalUrl: string | null;
	screenshotPath: string | null;
	fullPageScreenshotPath: string | null;
	capturedAt: string;
	durationMs: number;
	dom?: TreeseedSceneVisualAuditDomSummary | null;
	clientErrors?: TreeseedSceneVisualAuditClientError[];
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneVisualAuditClientError = {
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
	role?: TreeseedSceneVisualAuditRole;
	device?: TreeseedSceneDeviceProfileId;
	screenshotPath?: string | null;
	finalUrl?: string | null;
};

export type TreeseedSceneVisualAuditDomSummary = {
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
