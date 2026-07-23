
import { TreeseedSceneRunStatus } from './treeseed-scene-validation-report.ts';
import { TreeseedSceneDiagnostic, TreeseedSceneEnvironment } from './treeseed-scene-schema-version.ts';
import { TreeseedSceneEvidenceBundlePolicy, TreeseedSceneEvidencePhase, TreeseedSceneEvidenceTarget } from './treeseed-scene-render-input.ts';

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
