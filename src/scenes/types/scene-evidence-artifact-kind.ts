
import { SceneRunStatus } from './scene-validation-report.ts';
import { SceneDiagnostic, SceneEnvironment } from './scene-schema-version.ts';
import { SceneEvidenceBundlePolicy, SceneEvidencePhase, SceneEvidenceTarget } from './scene-render-input.ts';

export type SceneEvidenceArtifactKind =
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

export type SceneEvidenceArtifact = {
	id: string;
	kind: SceneEvidenceArtifactKind;
	path: string;
	relativePath: string;
	sha256: string | null;
	bytes: number | null;
	includedInBundle: boolean;
	redactionStatus: 'not-required' | 'sanitized' | 'excluded-sensitive' | 'unknown';
};

export type SceneEvidenceSummary = {
	sceneId: string | null;
	runId: string | null;
	workflowStatus: SceneRunStatus;
	ok: boolean;
	environment: SceneEnvironment | null;
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

export type SceneEvidenceRecommendation = {
	id: string;
	severity: 'info' | 'warning' | 'blocking';
	command: string;
	reason: string;
};

export type SceneEvidenceManifest = {
	schemaVersion: 'treeseed.scene.evidence/v1';
	phase: 9;
	generatedAt: string;
	target: SceneEvidenceTarget;
	bundlePolicy: SceneEvidenceBundlePolicy;
	runRoot: string;
	summary: SceneEvidenceSummary;
	artifacts: SceneEvidenceArtifact[];
	recommendations: SceneEvidenceRecommendation[];
	diagnostics: SceneDiagnostic[];
};

export type SceneEvidencePaths = {
	evidenceRoot: string;
	manifestPath: string;
	reportPath: string;
	bundleRoot: string | null;
	bundleManifestPath: string | null;
};

export type SceneEvidenceOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	target?: SceneEvidenceTarget;
	bundlePolicy?: SceneEvidenceBundlePolicy;
	bundle?: SceneEvidenceBundlePolicy;
	timestamp?: string;
};

export type SceneEvidenceReport = {
	ok: boolean;
	phase: SceneEvidencePhase;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	evidenceRoot: string | null;
	manifest: SceneEvidenceManifest | null;
	paths: SceneEvidencePaths | null;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type ScenePublishPhase = 10;

export type ScenePublishTarget = 'local' | 'release';

export type ScenePublishStatus = 'published' | 'blocked';

export type SceneRedactionDecision =
	| 'include'
	| 'exclude-sensitive'
	| 'exclude-not-allowed'
	| 'missing';

export type SceneRedactionRule = {
	id: string;
	artifactKind: SceneEvidenceArtifactKind;
	include: boolean;
	reason: string;
	allowWhen?: {
		target?: ScenePublishTarget[];
		workflowStatus?: SceneRunStatus[];
	};
};

export type SceneRedactionPolicy = {
	schemaVersion: 'treeseed.scene.redaction-policy/v1';
	id: string;
	mode: 'deny-by-default';
	rules: SceneRedactionRule[];
};

export type ScenePublishedArtifact = {
	id: string;
	kind: SceneEvidenceArtifactKind;
	sourcePath: string;
	publishedPath: string | null;
	relativePath: string;
	sha256: string | null;
	bytes: number | null;
	decision: SceneRedactionDecision;
	reason: string;
};

export type ScenePublishManifest = {
	schemaVersion: 'treeseed.scene.publish/v1';
	phase: 10;
	generatedAt: string;
	target: ScenePublishTarget;
	sourceEvidenceManifestPath: string;
	sourceRunRoot: string;
	sceneId: string | null;
	sourceRunId: string | null;
	workflowStatus: SceneRunStatus;
	redactionPolicy: SceneRedactionPolicy;
	artifacts: ScenePublishedArtifact[];
	releaseRecordPath: string | null;
	diagnostics: SceneDiagnostic[];
};

export type ScenePublishPaths = {
	publishRoot: string;
	manifestPath: string;
	reportPath: string;
	bundleRoot: string;
	releaseRecordPath: string | null;
};

export type ScenePublishOptions = {
	projectRoot: string;
	scene: string;
	from: string;
	target?: ScenePublishTarget;
	redactionPolicyPath?: string;
	timestamp?: string;
};

export type ScenePublishReport = {
	ok: boolean;
	phase: ScenePublishPhase;
	status: ScenePublishStatus;
	sceneId: string | null;
	sourceRunId: string | null;
	scenePath: string;
	runRoot: string | null;
	evidenceRoot: string | null;
	publishRoot: string | null;
	manifest: ScenePublishManifest | null;
	paths: ScenePublishPaths | null;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
	blockers: SceneDiagnostic[];
};

export type ScenePublishPlanPhase = 11;

export type SceneExternalPublishTarget =
	| 'docs'
	| 'training'
	| 'release-evidence'
	| 'artifact-store';

export type ScenePublishPlanMode =
	| 'plan'
	| 'local-export';

export type ScenePublishDestination = {
	id: string;
	target: SceneExternalPublishTarget;
	title: string;
	root: string;
	relativePath: string;
	plannedUrl: string | null;
	reconciliationResource: {
		type: 'scene-evidence-publication';
		provider: 'local' | 'github' | 'cloudflare' | 'artifact-store';
		environment: SceneEnvironment | 'release' | null;
		desiredState: Record<string, unknown>;
	};
};

export type ScenePublishPlanArtifact = {
	id: string;
	kind: SceneEvidenceArtifactKind;
	sourcePath: string;
	relativePath: string;
	destinationIds: string[];
	sha256: string | null;
	bytes: number | null;
	redactionDecision: SceneRedactionDecision;
};

export type ScenePublishPlanManifest = {
	schemaVersion: 'treeseed.scene.publish-plan/v1';
	phase: 11;
	generatedAt: string;
	sourcePublishManifestPath: string;
	sourceRunRoot: string;
	sceneId: string | null;
	sourceRunId: string | null;
	workflowStatus: SceneRunStatus;
	mode: ScenePublishPlanMode;
	targets: SceneExternalPublishTarget[];
	destinations: ScenePublishDestination[];
	artifacts: ScenePublishPlanArtifact[];
	reconciliationIntents: Array<{
		id: string;
		target: SceneExternalPublishTarget;
		action: 'plan-only';
		reason: string;
		desiredState: Record<string, unknown>;
	}>;
	diagnostics: SceneDiagnostic[];
};
