
import { SceneVisualAuditReviewDetail, SceneVisualAuditRole } from './scene-validation-report.ts';
import { SceneMotion, SceneOverlayVariant, SceneVisualObject, SceneVisualPoint, SceneVisualRegion, SceneVisualSize, SceneVisualStyle } from './scene-diagram.ts';

export const SCENE_SCHEMA_VERSION = 'treeseed.scene/v1' as const;

export const SCENE_ENVIRONMENTS = ['local', 'staging', 'prod'] as const;

export const SCENE_BROWSERS = ['chromium', 'firefox', 'webkit'] as const;

export type SceneSchemaVersion = typeof SCENE_SCHEMA_VERSION;

export type SceneEnvironment = typeof SCENE_ENVIRONMENTS[number];

export type SceneBrowser = typeof SCENE_BROWSERS[number];

export type ScenePhase = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export type SceneCapabilityStatus = 'available' | 'deferred' | 'planned' | 'blocked';

export type SceneCapabilityOwner =
	| '@treeseed/sdk'
	| '@treeseed/cli'
	| '@treeseed/market'
	| '@treeseed/ui'
	| '@treeseed/admin'
	| '@treeseed/core'
	| '@treeseed/api'
	| '@treeseed/agent';

export type SceneCapability = {
	id: string;
	status: SceneCapabilityStatus;
	owner: SceneCapabilityOwner;
	summary: string;
};

export type SceneArtifactPathPlan = {
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

export type SceneDiagnosticSeverity = 'error' | 'warning';

export type SceneDiagnostic = {
	severity: SceneDiagnosticSeverity;
	code: string;
	message: string;
	path?: string;
};

export type SceneMode = {
	test: boolean;
	demo: boolean;
	training: boolean;
};

export type SceneDeviceProfileId =
	| 'desktop'
	| 'tablet'
	| 'mobile'
	| string;

export type SceneDeviceOrientation =
	| 'landscape'
	| 'portrait';

export type SceneDeviceProfile = {
	id: SceneDeviceProfileId;
	title?: string;
	orientation?: SceneDeviceOrientation;
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

export type SceneDeviceConfig = {
	defaultProfile: SceneDeviceProfileId;
	profiles: SceneDeviceProfile[];
};

export type SceneTarget = {
	app: string;
	environment: SceneEnvironment;
	baseUrl: string | 'auto';
	viewport: {
		width: number;
		height: number;
	};
	browser: SceneBrowser;
};

export type SceneSetup = {
	dev?: {
		required: boolean;
		command?: string;
		reuseExisting: boolean;
	};
	auth?: {
		profile?: string;
		required: boolean;
		role?: SceneVisualAuditRole;
		seedOnly?: boolean;
	};
	seed?: {
		name?: string;
		environments: SceneEnvironment[];
		apply: boolean;
	};
};

export type SceneArtifacts = {
	trace: boolean;
	video: boolean;
	screenshots: boolean;
	console: boolean;
	network: boolean;
	timeline: boolean;
	appLogs: boolean;
};

export type SceneVisualAuditConfig = {
	enabled: boolean;
	roles: SceneVisualAuditRole[];
	pathRoots: string[];
	pathGlobs: string[];
	excludePathGlobs: string[];
	includeFullPage: boolean;
	review: {
		enabled: boolean;
		detail: SceneVisualAuditReviewDetail;
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

export type SceneSelector =
	| { scene: string }
	| { testId: string }
	| { role: string; name?: string }
	| { text: string }
	| { css: string; brittle?: boolean; internal?: boolean };

export type SceneOperationWaitSpec = {
	id?: string;
	kind?: string;
	status: string[];
	timeoutSeconds?: number;
	pollIntervalSeconds?: number;
	source?: 'linked' | 'latestMatching' | 'explicit';
};

export type SceneAction =
	| { goto: string }
	| { click: SceneSelector }
	| { fill: SceneSelector & { value: string } }
	| { select: SceneSelector & { value?: string; label?: string } }
	| { keyboard: string }
	| { pause: { mode: 'manual' | 'timed'; prompt?: string; durationSeconds?: number } }
	| { mailpitConfirmLatest: { mailpitUrl: string; email: string; subjectIncludes?: string; displayInboxSeconds?: number; displayMessageSeconds?: number } }
	| { apiRequest: Record<string, unknown> }
	| { waitForOperation: SceneOperationWaitSpec };

export type SceneExpectation = {
	visible?: SceneSelector[];
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

export type SceneWorkflowStep = {
	id: string;
	title: string;
	action: SceneAction;
	expect?: SceneExpectation;
	demoOnly?: boolean;
	timeoutSeconds?: number;
	continueOnFailure?: boolean;
	checkpoint?: {
		id?: string;
		resumable?: boolean;
	};
};

export type SceneChapter = {
	id: string;
	title: string;
	startsAt: string;
};

export type SceneOverlay = {
	id: string;
	at: string;
	renderer: string;
	type: string;
	text?: string;
	anchor?: SceneSelector;
	variant?: SceneOverlayVariant;
	region?: SceneVisualRegion;
	position?: SceneVisualPoint;
	size?: SceneVisualSize;
	style?: SceneVisualStyle;
	motion?: SceneMotion;
	objects?: SceneVisualObject[];
	durationSeconds?: number;
};

export type SceneDiagramPlacement = 'overlay' | 'interstitial' | 'standalone';
