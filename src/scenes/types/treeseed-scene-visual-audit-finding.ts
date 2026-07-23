
import { TreeseedSceneStepStatus, TreeseedSceneVisualAuditCapture, TreeseedSceneVisualAuditClientError, TreeseedSceneVisualAuditFindingOwner, TreeseedSceneVisualAuditFindingSeverity, TreeseedSceneVisualAuditReviewCategory, TreeseedSceneVisualAuditReviewDetail, TreeseedSceneVisualAuditRole, TreeseedSceneVisualAuditRoute } from './treeseed-scene-validation-report.ts';
import { TreeseedSceneDeviceProfileId, TreeseedSceneDiagnostic, TreeseedSceneEnvironment, TreeseedSceneSelector } from './treeseed-scene-schema-version.ts';

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
