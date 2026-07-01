export const TREESEED_SCENE_SCHEMA_VERSION = 'treeseed.scene/v1' as const;
export const TREESEED_SCENE_ENVIRONMENTS = ['local', 'staging', 'prod'] as const;
export const TREESEED_SCENE_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;

export type TreeseedSceneSchemaVersion = typeof TREESEED_SCENE_SCHEMA_VERSION;
export type TreeseedSceneEnvironment = typeof TREESEED_SCENE_ENVIRONMENTS[number];
export type TreeseedSceneBrowser = typeof TREESEED_SCENE_BROWSERS[number];

export type TreeseedScenePhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type TreeseedSceneCapabilityStatus = 'available' | 'deferred' | 'planned' | 'blocked';

export type TreeseedSceneCapabilityOwner =
	| '@treeseed/sdk'
	| '@treeseed/cli'
	| '@treeseed/market'
	| '@treeseed/ui'
	| '@treeseed/admin'
	| '@treeseed/core'
	| '@treeseed/api'
	| '@treeseed/agent';

export type TreeseedSceneCapability = {
	id: string;
	status: TreeseedSceneCapabilityStatus;
	owner: TreeseedSceneCapabilityOwner;
	summary: string;
};

export type TreeseedSceneArtifactPathPlan = {
	workspaceRoot: string;
	sceneId: string;
	runId: string;
	runRoot: string;
	normalizedScenePath: string;
	planPath: string;
	runPath: string;
	timelinePath: string;
	markdownReportPath: string;
	htmlReportPath: string;
	playwrightRoot: string;
	logsRoot: string;
	segmentsRoot: string;
	renderRoot: string;
	trainingRoot: string;
	evidenceRoot: string;
	publishRoot: string;
	publishPlanRoot: string;
	progressPath: string;
	checkpointsRoot: string;
};

export type TreeseedSceneDiagnosticSeverity = 'error' | 'warning';

export type TreeseedSceneDiagnostic = {
	severity: TreeseedSceneDiagnosticSeverity;
	code: string;
	message: string;
	path?: string;
};

export type TreeseedSceneMode = {
	test: boolean;
	demo: boolean;
	training: boolean;
};

export type TreeseedSceneDeviceProfileId =
	| 'desktop'
	| 'tablet'
	| 'mobile'
	| string;

export type TreeseedSceneDeviceOrientation =
	| 'landscape'
	| 'portrait';

export type TreeseedSceneDeviceProfile = {
	id: TreeseedSceneDeviceProfileId;
	title?: string;
	orientation?: TreeseedSceneDeviceOrientation;
	viewport: {
		width: number;
		height: number;
	};
	video?: {
		width: number;
		height: number;
	};
	output?: {
		width: number;
		height: number;
	};
	userAgent?: string;
	deviceScaleFactor?: number;
	isMobile?: boolean;
	hasTouch?: boolean;
	browserFrame?: {
		enabled: boolean;
		title?: string;
		chrome?: 'desktop' | 'tablet' | 'mobile';
	};
};

export type TreeseedSceneDeviceConfig = {
	defaultProfile: TreeseedSceneDeviceProfileId;
	profiles: TreeseedSceneDeviceProfile[];
};

export type TreeseedSceneTarget = {
	app: string;
	environment: TreeseedSceneEnvironment;
	baseUrl: string | 'auto';
	viewport: {
		width: number;
		height: number;
	};
	browser: TreeseedSceneBrowser;
};

export type TreeseedSceneSetup = {
	dev?: {
		required: boolean;
		command?: string;
		reuseExisting: boolean;
	};
	auth?: {
		profile?: string;
		required: boolean;
		role?: TreeseedSceneVisualAuditRole;
	};
	seed?: {
		name?: string;
		environments: TreeseedSceneEnvironment[];
		apply: boolean;
	};
};

export type TreeseedSceneArtifacts = {
	trace: boolean;
	video: boolean;
	screenshots: boolean;
	console: boolean;
	network: boolean;
	timeline: boolean;
	appLogs: boolean;
};

export type TreeseedSceneVisualAuditConfig = {
	enabled: boolean;
	roles: TreeseedSceneVisualAuditRole[];
	pathRoots: string[];
	pathGlobs: string[];
	excludePathGlobs: string[];
	includeFullPage: boolean;
	review: {
		enabled: boolean;
		detail: TreeseedSceneVisualAuditReviewDetail;
		maxFindings: number;
		contactSheets: boolean;
	};
	routeDiscovery: {
		core: boolean;
		admin: boolean;
		tenantOverrides: boolean;
		contentCollections: boolean;
	};
};

export type TreeseedSceneSelector =
	| { scene: string }
	| { testId: string }
	| { role: string; name?: string }
	| { text: string }
	| { css: string; brittle?: boolean; internal?: boolean };

export type TreeseedSceneOperationWaitSpec = {
	id?: string;
	kind?: string;
	status: string[];
	timeoutSeconds?: number;
	pollIntervalSeconds?: number;
	source?: 'linked' | 'latestMatching' | 'explicit';
};

export type TreeseedSceneAction =
	| { goto: string }
	| { click: TreeseedSceneSelector }
	| { fill: TreeseedSceneSelector & { value: string } }
	| { select: TreeseedSceneSelector & { value?: string; label?: string } }
	| { keyboard: string }
	| { pause: { mode: 'manual' | 'timed'; prompt?: string; durationSeconds?: number } }
	| { mailpitConfirmLatest: { mailpitUrl: string; email: string; subjectIncludes?: string; displayInboxSeconds?: number; displayMessageSeconds?: number } }
	| { apiRequest: Record<string, unknown> }
	| { waitForOperation: TreeseedSceneOperationWaitSpec };

export type TreeseedSceneExpectation = {
	visible?: TreeseedSceneSelector[];
	text?: string;
	urlIncludes?: string;
	operation?: {
		id?: string;
		kind: string;
		status: string[];
		timeoutSeconds?: number;
		pollIntervalSeconds?: number;
		source?: 'linked' | 'latestMatching' | 'explicit';
	};
};

export type TreeseedSceneWorkflowStep = {
	id: string;
	title: string;
	action: TreeseedSceneAction;
	expect?: TreeseedSceneExpectation;
	demoOnly?: boolean;
	timeoutSeconds?: number;
	continueOnFailure?: boolean;
	checkpoint?: {
		id?: string;
		resumable?: boolean;
	};
};

export type TreeseedSceneChapter = {
	id: string;
	title: string;
	startsAt: string;
};

export type TreeseedSceneOverlay = {
	id: string;
	at: string;
	renderer: string;
	type: string;
	text?: string;
	anchor?: TreeseedSceneSelector;
	variant?: TreeseedSceneOverlayVariant;
	region?: TreeseedSceneVisualRegion;
	position?: TreeseedSceneVisualPoint;
	size?: TreeseedSceneVisualSize;
	style?: TreeseedSceneVisualStyle;
	motion?: TreeseedSceneMotion;
	objects?: TreeseedSceneVisualObject[];
	durationSeconds?: number;
};

export type TreeseedSceneDiagramPlacement = 'overlay' | 'interstitial' | 'standalone';

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
	record?: boolean;
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
	record?: boolean;
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

export type TreeseedSceneVisualAuditFinding = {
	id: string;
	severity: TreeseedSceneVisualAuditFindingSeverity;
	category: TreeseedSceneVisualAuditReviewCategory;
	code: string;
	title: string;
	message: string;
	path: string;
	pathRoot: string;
	role: TreeseedSceneVisualAuditRole;
	device: TreeseedSceneDeviceProfileId;
	captureId: string;
	screenshotPath: string | null;
	finalUrl: string | null;
	suspectedOwner: TreeseedSceneVisualAuditFindingOwner;
	architectureGuidance: string;
	evidence: Record<string, unknown>;
};

export type TreeseedSceneVisualAuditRootCause = {
	id: string;
	severity: TreeseedSceneVisualAuditFindingSeverity;
	category: TreeseedSceneVisualAuditReviewCategory;
	code: string;
	title: string;
	message: string;
	suspectedOwner: TreeseedSceneVisualAuditFindingOwner;
	count: number;
	pathRoots: string[];
	paths: string[];
	roles: TreeseedSceneVisualAuditRole[];
	devices: TreeseedSceneDeviceProfileId[];
	findingIds: string[];
	captureIds: string[];
	exampleScreenshotPath: string | null;
	architectureGuidance: string;
	recommendedAction: string;
	priorityScore: number;
	priorityRank: number;
	impact: {
		pathCount: number;
		roleCount: number;
		deviceCount: number;
		captureCount: number;
	};
	query: {
		owner: TreeseedSceneVisualAuditFindingOwner;
		severity: TreeseedSceneVisualAuditFindingSeverity;
		code: string;
		pathRoots: string[];
	};
};

export type TreeseedSceneVisualAuditClientErrorIncident = {
	id: string;
	severity: TreeseedSceneVisualAuditFindingSeverity;
	primaryKind: TreeseedSceneVisualAuditClientError['kind'];
	code: string;
	title: string;
	message: string;
	normalizedMessage: string;
	suspectedOwner: TreeseedSceneVisualAuditFindingOwner;
	count: number;
	pathRoots: string[];
	paths: string[];
	roles: TreeseedSceneVisualAuditRole[];
	devices: TreeseedSceneDeviceProfileId[];
	captureIds: string[];
	errorIds: string[];
	exampleScreenshotPath: string | null;
	exampleFinalUrl: string | null;
	status: number | null;
	url: string | null;
	priorityScore: number;
	priorityRank: number;
	recommendedAction: string;
	architectureGuidance: string;
};

export type TreeseedSceneVisualAuditReviewSummary = {
	generatedAt: string;
	detail: TreeseedSceneVisualAuditReviewDetail;
	routeCount: number;
	captureCount: number;
	findingCount: number;
	rootCauseCount: number;
	incidentCount: number;
	clientErrorCount: number;
	highestPriorityScore: number;
	byPriorityBand: {
		critical: number;
		high: number;
		medium: number;
		low: number;
	};
	bySeverity: Record<TreeseedSceneVisualAuditFindingSeverity, number>;
	byCategory: Record<TreeseedSceneVisualAuditReviewCategory, number>;
	byOwner: Record<TreeseedSceneVisualAuditFindingOwner, number>;
	byPathRoot: Record<string, number>;
};

export type TreeseedSceneVisualAuditReview = {
	schemaVersion: 'treeseed.scene.visual-audit-review/v1';
	generatedAt: string;
	auditId: string;
	sceneId: string | null;
	summary: TreeseedSceneVisualAuditReviewSummary;
	findings: TreeseedSceneVisualAuditFinding[];
	rootCauses: TreeseedSceneVisualAuditRootCause[];
	incidents: TreeseedSceneVisualAuditClientErrorIncident[];
	clientErrors: TreeseedSceneVisualAuditClientError[];
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneVisualAuditManifest = {
	schemaVersion: 'treeseed.scene.visual-audit/v1';
	phase: 11;
	generatedAt: string;
	sceneId: string | null;
	auditId: string;
	baseUrl: string | null;
	roles: TreeseedSceneVisualAuditRole[];
	devices: TreeseedSceneDeviceProfileId[];
	routes: TreeseedSceneVisualAuditRoute[];
	captures: TreeseedSceneVisualAuditCapture[];
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneVisualAuditPaths = {
	auditRoot: string;
	manifestPath: string;
	reportPath: string;
	screenshotsRoot: string;
	reviewRoot: string | null;
	reviewSummaryPath: string | null;
	reviewFindingsPath: string | null;
	reviewAgentBriefPath: string | null;
};

export type TreeseedSceneVisualAuditOptions = {
	projectRoot: string;
	scene: string;
	environment?: TreeseedSceneEnvironment;
	roles?: TreeseedSceneVisualAuditRole[];
	devices?: TreeseedSceneDeviceProfileId[];
	pathRoots?: string[];
	pathGlobs?: string[];
	excludePathGlobs?: string[];
	includeFullPage?: boolean;
	review?: boolean;
	reviewDetail?: TreeseedSceneVisualAuditReviewDetail;
	maxFindings?: number;
	preflight?: boolean;
	timestamp?: string;
};

export type TreeseedSceneVisualAuditReport = {
	ok: boolean;
	phase: 11;
	sceneId: string | null;
	auditId: string | null;
	scenePath: string;
	baseUrl: string | null;
	roles: TreeseedSceneVisualAuditRole[];
	devices: TreeseedSceneDeviceProfileId[];
	routeCount: number;
	captureCount: number;
	failedCount: number;
	skippedCount: number;
	auditRoot: string | null;
	paths: TreeseedSceneVisualAuditPaths | null;
	manifest: TreeseedSceneVisualAuditManifest | null;
	review: TreeseedSceneVisualAuditReview | null;
	reviewFindingCount: number;
	rootCauseCount: number;
	incidentCount: number;
	clientErrorCount: number;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneObservedError = {
	message: string;
	timestamp: string;
	stepId?: string;
	url?: string;
	method?: string;
	status?: number;
};

export type TreeseedSceneAssertionRunReport = {
	kind: string;
	status: 'passed' | 'failed';
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	message?: string;
	selector?: TreeseedSceneSelector;
	error?: TreeseedSceneDiagnostic;
	operationId?: string | null;
};

export type TreeseedSceneRunStepReport = {
	id: string;
	title: string;
	actionKind: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	status: TreeseedSceneStepStatus;
	retryCount: 0;
	assertionResults: TreeseedSceneAssertionRunReport[];
	screenshotPath: string | null;
	viewportScreenshotPath?: string | null;
	traceLocation: string | null;
	consoleErrors: TreeseedSceneObservedError[];
	networkErrors: TreeseedSceneObservedError[];
	operationIds: string[];
	error?: TreeseedSceneDiagnostic;
};

export type TreeseedSceneRunArtifacts = {
	runRoot: string;
	normalizedScenePath: string;
	planPath: string;
	runPath: string;
	timelinePath: string;
	markdownReportPath: string;
	playwrightTracePath: string | null;
	screenshotPaths: string[];
	viewportScreenshotPaths?: string[];
	videoPaths: string[];
	consoleLogPath: string | null;
	networkLogPath: string | null;
	errorsLogPath: string | null;
	setupPath?: string | null;
	devLogPath?: string | null;
	apiLogPath?: string | null;
	operationsRunnerLogPath?: string | null;
	progressPath?: string | null;
	checkpointsRoot?: string | null;
};

export type TreeseedSceneCheckpointStatus =
	| 'created'
	| 'skipped'
	| 'not_resumable';

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

export type TreeseedSceneRenderInput = {
	schemaVersion: 'treeseed.scene.render-input/v1';
	scene: TreeseedSceneManifest;
	run: TreeseedSceneRunReport;
	timeline: TreeseedSceneTimelineEvent[];
	chapters: TreeseedSceneRunChapterReport[];
	segments: TreeseedSceneRunSegmentReport[];
	checkpoints: TreeseedSceneCheckpoint[];
	overlays: TreeseedSceneOverlay[];
	diagrams: TreeseedSceneDiagram[];
	renderDiagrams: TreeseedSceneRenderDiagram[];
	training: {
		captions: TreeseedSceneCaptionCue[];
		transcript: TreeseedSceneTranscriptEntry[];
		narration: TreeseedSceneNarrationScriptEntry[];
		glossary: TreeseedSceneGlossaryTerm[];
		chapterClips: TreeseedSceneChapterClipManifest[];
	};
	media: {
		videos: string[];
		videoRefs?: Array<{
			path: string;
			src?: string;
			staticPath?: string;
			mimeType: 'video/webm' | 'video/mp4' | 'video/quicktime';
			source: 'playwright';
		}>;
		videoFrames?: Array<{
			frame: number;
			path: string;
			staticPath: string;
			timestampMs: number;
			width: number;
			height: number;
			source: 'playwright';
		}>;
		screenshots: Array<{
			stepId: string | null;
			path: string;
			src?: string;
			timestamp: string | null;
			offsetMs: number | null;
			captureKind?: 'viewport' | 'full-page';
			width?: number | null;
			height?: number | null;
		}>;
	};
	render: {
		mode: TreeseedSceneRenderMode;
		composition: string;
		fps: number;
		width: number;
		height: number;
		durationInFrames: number;
		format: TreeseedSceneRenderFormat;
		introFrames?: number;
		evidenceStartFrame?: number;
		evidenceDurationInFrames?: number;
		interstitialFrames?: number;
	};
};

export type TreeseedSceneRenderDiagram = {
	id: string;
	renderer: string;
	component: string;
	kind: TreeseedSceneDiagramRenderKind;
	placement: TreeseedSceneDiagramPlacement;
	at: string;
	startOffsetMs: number | null;
	durationSeconds: number;
	props: Record<string, unknown>;
	objects: TreeseedSceneVisualObject[];
	motion?: TreeseedSceneMotion;
	style?: TreeseedSceneVisualStyle;
};

export type TreeseedSceneRendererAdapter = {
	id: string;
	render(input: {
		entryPoint?: string;
		compositionId: string;
		inputProps: TreeseedSceneRenderInput;
		outputPath: string;
		publicDir?: string;
		codec: 'h264';
		onProgress?: (progress: Record<string, unknown>) => void;
	}): Promise<{ ok: boolean; outputPath: string | null; diagnostics: TreeseedSceneDiagnostic[] }>;
};

export type TreeseedSceneRendererAdapterFactory = (input: {
	renderer: string;
}) => TreeseedSceneRendererAdapter | null;

export type TreeseedSceneRenderOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	device?: TreeseedSceneDeviceProfileId;
	renderer?: string;
	format?: TreeseedSceneRenderFormat;
	mode?: TreeseedSceneRenderMode;
	composition?: string;
	chapterId?: string;
	output?: string;
	runId?: string;
	timestamp?: string;
	plugins?: TreeseedScenePlugin[];
	rendererAdapter?: TreeseedSceneRendererAdapter;
	rendererAdapterFactory?: TreeseedSceneRendererAdapterFactory;
	onProgress?: (event: TreeseedSceneRenderProgressEvent) => void;
};

export type TreeseedSceneRenderReport = {
	ok: boolean;
	phase: 6;
	renderer: string;
	renderId: string | null;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	device?: TreeseedSceneDeviceProfile | null;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	mode: TreeseedSceneRenderMode;
	composition: string | null;
	format: TreeseedSceneRenderFormat;
	outputPath: string | null;
	renderRoot: string | null;
	inputPath: string | null;
	compositionPath: string | null;
	progressPath: string | null;
	renderedVideoPaths: string[];
	trainingOutputPaths: TreeseedSceneTrainingOutputPaths | null;
	sourceArtifacts: {
		runPath: string | null;
		timelinePath: string | null;
		normalizedScenePath: string | null;
		planPath: string | null;
		videoPaths: string[];
		screenshotPaths: string[];
		segmentPaths: string[];
	};
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneCaptionCue = {
	id: string;
	startMs: number;
	endMs: number;
	text: string;
	stepId?: string | null;
	chapterId?: string | null;
};

export type TreeseedSceneTranscriptEntry = {
	id: string;
	timestampMs: number;
	type:
		| 'scene'
		| 'chapter'
		| 'step'
		| 'overlay'
		| 'diagram'
		| 'diagnostic';
	title: string;
	text: string;
	stepId?: string | null;
	chapterId?: string | null;
};

export type TreeseedSceneNarrationScriptEntry = {
	id: string;
	order: number;
	chapterId?: string | null;
	stepId?: string | null;
	title: string;
	script: string;
	source: 'scene' | 'chapter' | 'step' | 'overlay' | 'diagram' | 'diagnostic';
};

export type TreeseedSceneChapterClipManifest = {
	id: string;
	chapterId: string;
	title: string;
	startOffsetMs: number;
	endOffsetMs: number;
	durationMs: number;
	stepIds: string[];
	segmentIds: string[];
	suggestedOutputName: string;
};

export type TreeseedSceneTrainingOutputs = {
	schemaVersion: 'treeseed.scene.training-output/v1';
	sceneId: string | null;
	runId: string | null;
	generatedAt: string;
	captions: TreeseedSceneCaptionCue[];
	transcript: TreeseedSceneTranscriptEntry[];
	narration: TreeseedSceneNarrationScriptEntry[];
	glossary: TreeseedSceneGlossaryTerm[];
	chapterClips: TreeseedSceneChapterClipManifest[];
};

export type TreeseedSceneTrainingOutputPaths = {
	trainingRoot: string;
	inputPath: string;
	reportPath: string;
	captionsVttPath: string | null;
	captionsSrtPath: string | null;
	transcriptJsonPath: string | null;
	transcriptMarkdownPath: string | null;
	narrationJsonPath: string | null;
	narrationMarkdownPath: string | null;
	glossaryJsonPath: string | null;
	glossaryMarkdownPath: string | null;
	chapterClipsPath: string | null;
};

export type TreeseedSceneTrainingOutputOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	formats?: TreeseedSceneTrainingOutputFormat[];
	timestamp?: string;
};

export type TreeseedSceneTrainingOutputReport = {
	ok: boolean;
	phase: 8;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	trainingRoot: string | null;
	outputs: TreeseedSceneTrainingOutputs | null;
	paths: TreeseedSceneTrainingOutputPaths | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneEvidencePhase = 9;

export type TreeseedSceneEvidenceTarget = 'local' | 'ci' | 'release';

export type TreeseedSceneEvidenceBundlePolicy = 'metadata-only' | 'sanitized';

export type TreeseedSceneEvidenceArtifactKind =
	| 'run-report'
	| 'markdown-report'
	| 'timeline'
	| 'setup'
	| 'progress'
	| 'segment'
	| 'checkpoint'
	| 'screenshot'
	| 'render-report'
	| 'render-video'
	| 'training-output'
	| 'log-summary';

export type TreeseedSceneEvidenceArtifact = {
	id: string;
	kind: TreeseedSceneEvidenceArtifactKind;
	path: string;
	relativePath: string;
	sha256: string | null;
	bytes: number | null;
	includedInBundle: boolean;
	redactionStatus: 'not-required' | 'sanitized' | 'excluded-sensitive' | 'unknown';
};

export type TreeseedSceneEvidenceSummary = {
	sceneId: string | null;
	runId: string | null;
	workflowStatus: TreeseedSceneRunStatus;
	ok: boolean;
	environment: TreeseedSceneEnvironment | null;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	failedStep: string | null;
	stepCounts: {
		passed: number;
		failed: number;
		skipped: number;
	};
	chapters: number;
	segments: number;
	checkpoints: number;
	renderedVideos: number;
	trainingOutputs: boolean;
};

export type TreeseedSceneEvidenceRecommendation = {
	id: string;
	severity: 'info' | 'warning' | 'blocking';
	command: string;
	reason: string;
};

export type TreeseedSceneEvidenceManifest = {
	schemaVersion: 'treeseed.scene.evidence/v1';
	phase: 9;
	generatedAt: string;
	target: TreeseedSceneEvidenceTarget;
	bundlePolicy: TreeseedSceneEvidenceBundlePolicy;
	runRoot: string;
	summary: TreeseedSceneEvidenceSummary;
	artifacts: TreeseedSceneEvidenceArtifact[];
	recommendations: TreeseedSceneEvidenceRecommendation[];
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedSceneEvidencePaths = {
	evidenceRoot: string;
	manifestPath: string;
	reportPath: string;
	bundleRoot: string | null;
	bundleManifestPath: string | null;
};

export type TreeseedSceneEvidenceOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	target?: TreeseedSceneEvidenceTarget;
	bundlePolicy?: TreeseedSceneEvidenceBundlePolicy;
	bundle?: TreeseedSceneEvidenceBundlePolicy;
	timestamp?: string;
};

export type TreeseedSceneEvidenceReport = {
	ok: boolean;
	phase: TreeseedSceneEvidencePhase;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	evidenceRoot: string | null;
	manifest: TreeseedSceneEvidenceManifest | null;
	paths: TreeseedSceneEvidencePaths | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedScenePublishPhase = 10;

export type TreeseedScenePublishTarget = 'local' | 'release';

export type TreeseedScenePublishStatus = 'published' | 'blocked';

export type TreeseedSceneRedactionDecision =
	| 'include'
	| 'exclude-sensitive'
	| 'exclude-not-allowed'
	| 'missing';

export type TreeseedSceneRedactionRule = {
	id: string;
	artifactKind: TreeseedSceneEvidenceArtifactKind;
	include: boolean;
	reason: string;
	allowWhen?: {
		target?: TreeseedScenePublishTarget[];
		workflowStatus?: TreeseedSceneRunStatus[];
	};
};

export type TreeseedSceneRedactionPolicy = {
	schemaVersion: 'treeseed.scene.redaction-policy/v1';
	id: string;
	mode: 'deny-by-default';
	rules: TreeseedSceneRedactionRule[];
};

export type TreeseedScenePublishedArtifact = {
	id: string;
	kind: TreeseedSceneEvidenceArtifactKind;
	sourcePath: string;
	publishedPath: string | null;
	relativePath: string;
	sha256: string | null;
	bytes: number | null;
	decision: TreeseedSceneRedactionDecision;
	reason: string;
};

export type TreeseedScenePublishManifest = {
	schemaVersion: 'treeseed.scene.publish/v1';
	phase: 10;
	generatedAt: string;
	target: TreeseedScenePublishTarget;
	sourceEvidenceManifestPath: string;
	sourceRunRoot: string;
	sceneId: string | null;
	sourceRunId: string | null;
	workflowStatus: TreeseedSceneRunStatus;
	redactionPolicy: TreeseedSceneRedactionPolicy;
	artifacts: TreeseedScenePublishedArtifact[];
	releaseRecordPath: string | null;
	diagnostics: TreeseedSceneDiagnostic[];
};

export type TreeseedScenePublishPaths = {
	publishRoot: string;
	manifestPath: string;
	reportPath: string;
	bundleRoot: string;
	releaseRecordPath: string | null;
};

export type TreeseedScenePublishOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	target?: TreeseedScenePublishTarget;
	redactionPolicyPath?: string;
	timestamp?: string;
};

export type TreeseedScenePublishReport = {
	ok: boolean;
	phase: TreeseedScenePublishPhase;
	status: TreeseedScenePublishStatus;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	evidenceRoot: string | null;
	publishRoot: string | null;
	manifest: TreeseedScenePublishManifest | null;
	paths: TreeseedScenePublishPaths | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings: TreeseedSceneDiagnostic[];
	blockers: TreeseedSceneDiagnostic[];
};

export type TreeseedScenePublishPlanPhase = 11;

export type TreeseedSceneExternalPublishTarget =
	| 'docs'
	| 'training'
	| 'release-evidence'
	| 'artifact-store';

export type TreeseedScenePublishPlanMode =
	| 'plan'
	| 'local-export';

export type TreeseedScenePublishDestination = {
	id: string;
	target: TreeseedSceneExternalPublishTarget;
	title: string;
	root: string;
	relativePath: string;
	plannedUrl: string | null;
	reconciliationResource: {
		type: 'scene-evidence-publication';
		provider: 'local' | 'github' | 'cloudflare' | 'artifact-store';
		environment: TreeseedSceneEnvironment | 'release' | null;
		desiredState: Record<string, unknown>;
	};
};

export type TreeseedScenePublishPlanArtifact = {
	id: string;
	kind: TreeseedSceneEvidenceArtifactKind;
	sourcePath: string;
	relativePath: string;
	destinationIds: string[];
	sha256: string | null;
	bytes: number | null;
	redactionDecision: TreeseedSceneRedactionDecision;
};

export type TreeseedScenePublishPlanManifest = {
	schemaVersion: 'treeseed.scene.publish-plan/v1';
	phase: 11;
	generatedAt: string;
	sourcePublishManifestPath: string;
	sourceRunRoot: string;
	sceneId: string | null;
	sourceRunId: string | null;
	workflowStatus: TreeseedSceneRunStatus;
	mode: TreeseedScenePublishPlanMode;
	targets: TreeseedSceneExternalPublishTarget[];
	destinations: TreeseedScenePublishDestination[];
	artifacts: TreeseedScenePublishPlanArtifact[];
	reconciliationIntents: Array<{
		id: string;
		target: TreeseedSceneExternalPublishTarget;
		action: 'plan-only';
		reason: string;
		desiredState: Record<string, unknown>;
	}>;
	diagnostics: TreeseedSceneDiagnostic[];
};

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
	waitFor(options?: { state?: 'visible'; timeout?: number }): Promise<void>;
	click(): Promise<void>;
	fill(value: string): Promise<void>;
	selectOption?(option: string | { label: string }): Promise<void>;
	isVisible(): Promise<boolean>;
};

export type TreeseedScenePage = {
	goto(url: string): Promise<void>;
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
