
import { SceneStepStatus, SceneVisualAuditCapture, SceneVisualAuditClientError, SceneVisualAuditFindingOwner, SceneVisualAuditFindingSeverity, SceneVisualAuditReviewCategory, SceneVisualAuditReviewDetail, SceneVisualAuditRole, SceneVisualAuditRoute } from './scene-validation-report.ts';
import { SceneDeviceProfileId, SceneDiagnostic, SceneEnvironment, SceneSelector } from './scene-schema-version.ts';

export type SceneVisualAuditFinding = {
	id: string;
	severity: SceneVisualAuditFindingSeverity;
	category: SceneVisualAuditReviewCategory;
	code: string;
	title: string;
	message: string;
	path: string;
	pathRoot: string;
	role: SceneVisualAuditRole;
	device: SceneDeviceProfileId;
	captureId: string;
	screenshotPath: string | null;
	finalUrl: string | null;
	suspectedOwner: SceneVisualAuditFindingOwner;
	architectureGuidance: string;
	evidence: Record<string, unknown>;
};

export type SceneVisualAuditRootCause = {
	id: string;
	severity: SceneVisualAuditFindingSeverity;
	category: SceneVisualAuditReviewCategory;
	code: string;
	title: string;
	message: string;
	suspectedOwner: SceneVisualAuditFindingOwner;
	count: number;
	pathRoots: string[];
	paths: string[];
	roles: SceneVisualAuditRole[];
	devices: SceneDeviceProfileId[];
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
		owner: SceneVisualAuditFindingOwner;
		severity: SceneVisualAuditFindingSeverity;
		code: string;
		pathRoots: string[];
	};
};

export type SceneVisualAuditClientErrorIncident = {
	id: string;
	severity: SceneVisualAuditFindingSeverity;
	primaryKind: SceneVisualAuditClientError['kind'];
	code: string;
	title: string;
	message: string;
	normalizedMessage: string;
	suspectedOwner: SceneVisualAuditFindingOwner;
	count: number;
	pathRoots: string[];
	paths: string[];
	roles: SceneVisualAuditRole[];
	devices: SceneDeviceProfileId[];
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

export type SceneVisualAuditReviewSummary = {
	generatedAt: string;
	detail: SceneVisualAuditReviewDetail;
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
	bySeverity: Record<SceneVisualAuditFindingSeverity, number>;
	byCategory: Record<SceneVisualAuditReviewCategory, number>;
	byOwner: Record<SceneVisualAuditFindingOwner, number>;
	byPathRoot: Record<string, number>;
};

export type SceneVisualAuditReview = {
	schemaVersion: 'treeseed.scene.visual-audit-review/v1';
	generatedAt: string;
	auditId: string;
	sceneId: string | null;
	summary: SceneVisualAuditReviewSummary;
	findings: SceneVisualAuditFinding[];
	rootCauses: SceneVisualAuditRootCause[];
	incidents: SceneVisualAuditClientErrorIncident[];
	clientErrors: SceneVisualAuditClientError[];
	diagnostics: SceneDiagnostic[];
};

export type SceneVisualAuditManifest = {
	schemaVersion: 'treeseed.scene.visual-audit/v1';
	phase: 11;
	generatedAt: string;
	sceneId: string | null;
	auditId: string;
	baseUrl: string | null;
	roles: SceneVisualAuditRole[];
	devices: SceneDeviceProfileId[];
	routes: SceneVisualAuditRoute[];
	captures: SceneVisualAuditCapture[];
	diagnostics: SceneDiagnostic[];
};

export type SceneVisualAuditPaths = {
	auditRoot: string;
	manifestPath: string;
	reportPath: string;
	screenshotsRoot: string;
	reviewRoot: string | null;
	reviewSummaryPath: string | null;
	reviewFindingsPath: string | null;
	reviewAgentBriefPath: string | null;
};

export type SceneVisualAuditOptions = {
	projectRoot: string;
	scene: string;
	environment?: SceneEnvironment;
	roles?: SceneVisualAuditRole[];
	devices?: SceneDeviceProfileId[];
	pathRoots?: string[];
	pathGlobs?: string[];
	excludePathGlobs?: string[];
	includeFullPage?: boolean;
	review?: boolean;
	reviewDetail?: SceneVisualAuditReviewDetail;
	maxFindings?: number;
	preflight?: boolean;
	timestamp?: string;
};

export type SceneVisualAuditReport = {
	ok: boolean;
	phase: 11;
	sceneId: string | null;
	auditId: string | null;
	scenePath: string;
	baseUrl: string | null;
	roles: SceneVisualAuditRole[];
	devices: SceneDeviceProfileId[];
	routeCount: number;
	captureCount: number;
	failedCount: number;
	skippedCount: number;
	auditRoot: string | null;
	paths: SceneVisualAuditPaths | null;
	manifest: SceneVisualAuditManifest | null;
	review: SceneVisualAuditReview | null;
	reviewFindingCount: number;
	rootCauseCount: number;
	incidentCount: number;
	clientErrorCount: number;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type SceneObservedError = {
	message: string;
	timestamp: string;
	stepId?: string;
	url?: string;
	method?: string;
	status?: number;
};

export type SceneAssertionRunReport = {
	kind: string;
	status: 'passed' | 'failed';
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	message?: string;
	selector?: SceneSelector;
	error?: SceneDiagnostic;
	operationId?: string | null;
};

export type SceneRunStepReport = {
	id: string;
	title: string;
	actionKind: string;
	startedAt: string;
	finishedAt: string;
	durationMs: number;
	status: SceneStepStatus;
	retryCount: 0;
	assertionResults: SceneAssertionRunReport[];
	screenshotPath: string | null;
	viewportScreenshotPath?: string | null;
	traceLocation: string | null;
	consoleErrors: SceneObservedError[];
	networkErrors: SceneObservedError[];
	operationIds: string[];
	error?: SceneDiagnostic;
};

export type SceneRunArtifacts = {
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

export type SceneCheckpointStatus =
	| 'created'
	| 'skipped'
	| 'not_resumable';
