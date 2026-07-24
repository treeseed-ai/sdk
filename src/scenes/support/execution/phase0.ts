import { PHASE0_RUNTIME_CAPABILITIES, PHASE0_MEDIA_EVIDENCE_CAPABILITIES, PHASE0_PUBLICATION_AUDIT_CAPABILITIES } from '../plugins/phase0-capabilities.ts';
import { join } from 'node:path';
import type { SceneArtifactPathPlan, ScenePhase0Report } from '../../types.ts';

export const SCENE_PLATFORM_NAME = 'central TreeSeed acceptance test harness and demo / educational video generator' as const;

const PHASE0_COMMAND_SURFACE = [
	'trsd scene',
	'trsd scene status',
	'trsd scene status --json',
	'trsd scene validate <scene.yaml> --json',
	'trsd scene plan <scene.yaml> --json',
	'trsd scene run <scene.yaml> --environment local|staging|prod --record --json',
	'trsd scene inspect <run-id-or-path> --step <step-id> --json',
	'trsd scene resume <run-id-or-path> --from-checkpoint <checkpoint-id> --json',
	'trsd scene render <scene.yaml> --from <run-id-or-path> --renderer remotion --format mp4 --json',
	'trsd scene render <scene.yaml> --from <run-id-or-path> --mode diagram-only --json',
	'trsd scene training <scene.yaml> --from <run-id-or-path> --format json|markdown|vtt|srt --json',
	'trsd scene evidence <scene.yaml> --from <run-id-or-path> --target local|ci|release --bundle metadata-only|sanitized --json',
	'trsd scene publish <scene.yaml> --from <run-id-or-path> --target local|release --redaction-policy <path> --json',
	'trsd scene publish-plan <scene.yaml> --from <run-id-or-path> --target docs,training,release-evidence,artifact-store --json',
	'trsd scene export <scene.yaml> --from <run-id-or-path> --target docs,training,release-evidence,artifact-store --json',
	'trsd scene visual-audit <scene.yaml> --roles anonymous,owner,admin,member --device desktop|tablet|mobile|all --path-root /app,/auth,/market --path /app/projects/** --exclude-path **/delete --json',
] as const;

const PHASE0_SDK_EXPORTS = [
	'@treeseed/sdk/scenes',
	'createTreeseedScenePhase0Report',
	'planTreeseedSceneArtifactPaths',
	'generateTreeseedSceneTrainingOutputs',
	'buildTreeseedSceneTrainingOutputs',
	'generateTreeseedSceneEvidence',
	'buildTreeseedSceneEvidenceManifest',
	'writeTreeseedSceneEvidence',
	'publishTreeseedSceneEvidence',
	'buildTreeseedScenePublishManifest',
	'createDefaultTreeseedSceneRedactionPolicy',
	'planTreeseedScenePublication',
	'exportTreeseedScenePublication',
	'buildTreeseedScenePublishPlanManifest',
	'runTreeseedSceneVisualAudit',
	'discoverTreeseedSceneVisualAuditRoutes',
] as const;

const FILESYSTEM_SAFE_SCENE_ID = /^[a-z0-9][a-z0-9._-]*$/u;

function compactTimestamp(date = new Date()) {
	return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function defaultRunId(timestamp: string) {
	return timestamp.toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 12) || 'phase0run';
}

export function createScenePhase0Report(): ScenePhase0Report {
	return {
		ok: true,
		phase: 0,
		status: 'foundation_ready',
		name: SCENE_PLATFORM_NAME,
		commandSurface: [...PHASE0_COMMAND_SURFACE],
		sdkExports: [...PHASE0_SDK_EXPORTS],
		capabilities: [...PHASE0_RUNTIME_CAPABILITIES, ...PHASE0_MEDIA_EVIDENCE_CAPABILITIES, ...PHASE0_PUBLICATION_AUDIT_CAPABILITIES],
		deferredDependencies: [],
		activeOptionalDependencies: ['remotion', '@remotion/renderer', '@remotion/bundler'],
		nextPhase: {
			phase: 12,
			summary: 'Remote Publication Apply',
			requiredChanges: [
				'Apply Phase 11 publication intents through canonical reconciliation adapters.',
				'Add provider-backed docs, training, and artifact-store publication once remote retention and redaction policy are finalized.',
			],
		},
	};
}

export function planSceneArtifactPaths(input: {
	workspaceRoot: string;
	sceneId: string;
	runId?: string;
	timestamp?: string;
}): SceneArtifactPathPlan {
	const sceneId = input.sceneId.trim();
	if (!FILESYSTEM_SAFE_SCENE_ID.test(sceneId)) {
		throw new Error(`Invalid scene id "${input.sceneId}". Use lowercase letters, numbers, dots, underscores, or hyphens, and start with a letter or number.`);
	}
	const timestamp = input.timestamp ?? compactTimestamp();
	const runId = input.runId ?? defaultRunId(timestamp);
	const runRoot = join(input.workspaceRoot, '.treeseed', 'scenes', 'runs', sceneId, `${timestamp}-${runId}`);
	return {
		workspaceRoot: input.workspaceRoot,
		sceneId,
		runId,
		runRoot,
		normalizedScenePath: join(runRoot, 'scene.normalized.json'),
		planPath: join(runRoot, 'scene.plan.json'),
		runPath: join(runRoot, 'run.json'),
		timelinePath: join(runRoot, 'timeline.json'),
		markdownReportPath: join(runRoot, 'report.md'),
		htmlReportPath: join(runRoot, 'report.html'),
		playwrightRoot: join(runRoot, 'playwright'),
		logsRoot: join(runRoot, 'logs'),
		segmentsRoot: join(runRoot, 'segments'),
		renderRoot: join(runRoot, 'render'),
		trainingRoot: join(runRoot, 'training'),
		evidenceRoot: join(runRoot, 'evidence'),
		publishRoot: join(runRoot, 'publish'),
		publishPlanRoot: join(runRoot, 'publish-plan'),
		progressPath: join(runRoot, 'progress.jsonl'),
		checkpointsRoot: join(runRoot, 'checkpoints'),
	};
}
