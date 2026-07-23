
import { TreeseedSceneVisualAuditReviewDetail, TreeseedSceneVisualAuditRole } from './treeseed-scene-validation-report.ts';
import { TreeseedSceneMotion, TreeseedSceneOverlayVariant, TreeseedSceneVisualObject, TreeseedSceneVisualPoint, TreeseedSceneVisualRegion, TreeseedSceneVisualSize, TreeseedSceneVisualStyle } from './treeseed-scene-diagram.ts';

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
		seedOnly?: boolean;
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
