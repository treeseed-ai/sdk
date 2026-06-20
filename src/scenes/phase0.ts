import { join } from 'node:path';
import type { TreeseedSceneArtifactPathPlan, TreeseedScenePhase0Report } from './types.ts';

export const TREESEED_SCENE_PLATFORM_NAME = 'central TreeSeed acceptance test harness and demo / educational video generator' as const;

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

export function createTreeseedScenePhase0Report(): TreeseedScenePhase0Report {
	return {
		ok: true,
		phase: 0,
		status: 'foundation_ready',
		name: TREESEED_SCENE_PLATFORM_NAME,
		commandSurface: [...PHASE0_COMMAND_SURFACE],
		sdkExports: [...PHASE0_SDK_EXPORTS],
		capabilities: [
			{
				id: 'scene.sdk-foundation',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'SDK-owned scene foundation types, Phase 0 report, and artifact path planning are available.',
			},
			{
				id: 'scene.cli-status',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'CLI-owned scene status command can report installed Phase 0 capability without running workflows.',
			},
			{
				id: 'scene.manifest-loader',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'YAML scene manifests can be loaded and parsed through the SDK scene module.',
			},
			{
				id: 'scene.schema-validation',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene manifests can be validated and normalized with stable diagnostics.',
			},
			{
				id: 'scene.plan-compiler',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene manifests can compile into deterministic non-mutating plan reports.',
			},
			{
				id: 'scene.playwright-runner',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Playwright browser execution is available for browser-safe actions and assertions.',
			},
			{
				id: 'scene.environment-integration',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs can prepare Treeseed readiness and managed local dev through canonical SDK services.',
			},
			{
				id: 'scene.seed-integration',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs can plan and explicitly apply seeds through canonical Treeseed seed services.',
			},
			{
				id: 'scene.auth-integration',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs can resolve market auth profiles and block clearly when required sessions are missing.',
			},
			{
				id: 'scene.operation-polling',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs can wait for linked or explicit Treeseed platform operations.',
			},
			{
				id: 'scene.log-collection',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs collect bounded managed-dev logs into run artifacts when available.',
			},
			{
				id: 'scene.plugin-contract',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Formal SDK plugin contracts and static built-in plugin resolution are available.',
			},
			{
				id: 'scene.internal-action-plugins',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Built-in actions execute through internal action plugin handlers.',
			},
			{
				id: 'scene.internal-assertion-plugins',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Built-in assertions execute through internal assertion plugin handlers.',
			},
			{
				id: 'scene.internal-environment-plugin',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Environment, auth, seed, and base URL setup are exposed through an internal environment plugin.',
			},
			{
				id: 'scene.plugin-plan-diagnostics',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene plan reports include plugin summaries, enabled plugin ids, and plugin diagnostics.',
			},
			{
				id: 'scene.dynamic-plugin-discovery',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Dynamic package-local plugin discovery is planned after static built-in plugins.',
			},
			{
				id: 'scene.remotion-renderer',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Remotion rendering is available through the SDK renderer plugin boundary.',
			},
			{
				id: 'scene.long-workflow-runtime',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Chapters, segments, checkpoints, resume, inspect, progress events, pauses, and timeout hierarchy are available.',
			},
			{
				id: 'scene.chapter-runtime',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs report chapter boundaries and chapter-local status for long workflows.',
			},
			{
				id: 'scene.segment-runtime',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs write segment metadata for future render-from-partial-artifacts workflows.',
			},
			{
				id: 'scene.checkpoints',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs write durable checkpoints after successful steps.',
			},
			{
				id: 'scene.resume',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runs can resume from resumable checkpoints using checkpoint replay.',
			},
			{
				id: 'scene.inspect',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene run artifacts can be inspected by run id or path.',
			},
			{
				id: 'scene.progress-jsonl',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Long scene runs write progress.jsonl and stream JSONL progress events from the CLI.',
			},
			{
				id: 'scene.pause-action',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Timed and manual pause actions are available through the control action runtime.',
			},
			{
				id: 'scene.timeout-hierarchy',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene runtime supports normalized scene, chapter, and step timeout configuration.',
			},
			{
				id: 'scene.render-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can render previous scene run artifacts with `trsd scene render`.',
			},
			{
				id: 'scene.render-only-from-artifacts',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Rendering consumes existing scene artifacts without rerunning browser workflows.',
			},
			{
				id: 'scene.remotion-composition-registry',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Built-in Remotion compositions are registered for demo, training, failure review, and diagram-only videos.',
			},
			{
				id: 'scene.video-overlays',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Render input carries overlay and callout metadata anchored to scene timeline steps.',
			},
			{
				id: 'scene.chapter-title-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Remotion renders chapter title context from long workflow artifacts.',
			},
			{
				id: 'scene.failure-review-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Failure review videos can focus failed steps, diagnostics, and evidence artifacts.',
			},
			{
				id: 'scene.screenshot-slideshow-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Render falls back to screenshot slideshow output when a run has no browser video.',
			},
			{
				id: 'scene.diagram-system',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Typed animated diagram providers render operation, reconciliation, dev runtime, and scene timeline diagrams.',
			},
			{
				id: 'scene.diagram-plugin-provider',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Built-in diagram provider plugin treeseed.scene.diagrams.remotion is available.',
			},
			{
				id: 'scene.diagram-prop-validation',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene validate and plan check typed diagram component props before render.',
			},
			{
				id: 'scene.diagram-render-input',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Render input includes normalized renderDiagrams from provider definitions and run artifacts.',
			},
			{
				id: 'scene.diagram-remotion-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Remotion compositions render built-in diagrams through the adapter-hosted render path.',
			},
			{
				id: 'scene.diagram-only-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Diagram-only rendering is available from existing run artifacts.',
			},
			{
				id: 'scene.diagram-overlay-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Overlay diagrams can render alongside browser evidence in demo and training videos.',
			},
			{
				id: 'scene.diagram-interstitial-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Interstitial and standalone diagrams can render as full-screen video sequences.',
			},
			{
				id: 'scene.training-outputs',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Deterministic captions, transcripts, narration scripts, glossary output, and chapter clip manifests are available.',
			},
			{
				id: 'scene.caption-generation',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene training outputs include deterministic VTT and SRT captions.',
			},
			{
				id: 'scene.caption-rendering',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Training Remotion renders can display generated captions.',
			},
			{
				id: 'scene.transcript-generation',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene training outputs include JSON and Markdown transcripts.',
			},
			{
				id: 'scene.narration-scripts',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene training outputs include deterministic narration scripts without AI or TTS.',
			},
			{
				id: 'scene.glossary-enrichment',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene training outputs include explicit and built-in Treeseed glossary terms.',
			},
			{
				id: 'scene.chapter-clip-manifests',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene training outputs include chapter clip manifests for future export workflows.',
			},
			{
				id: 'scene.training-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can generate deterministic training outputs with `trsd scene training`.',
			},
			{
				id: 'scene.training-artifacts',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene training artifacts are written under the existing run root training directory.',
			},
			{
				id: 'scene.evidence-manifest',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene run artifacts can be summarized into deterministic local, CI, and release evidence manifests.',
			},
			{
				id: 'scene.evidence-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can generate downstream scene evidence with `trsd scene evidence`.',
			},
			{
				id: 'scene.sanitized-evidence-bundle',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Evidence generation can copy a bounded sanitized bundle while excluding raw traces, videos, network captures, and app logs by default.',
			},
			{
				id: 'scene.evidence-recommendations',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Evidence manifests include deterministic follow-up recommendations for inspect, resume, training, and render workflows.',
			},
			{
				id: 'scene.ci-scene-verification',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene evidence reports expose CI-ready summaries, artifact inventory, and hashes without rerunning browser workflows.',
			},
			{
				id: 'scene.release-evidence-summary',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Release-target evidence marks failed workflows as blocking recommendations while staying local until a later publish phase.',
			},
			{
				id: 'scene.evidence-hashing',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Included evidence artifacts are hashed with SHA-256 for reproducible proof.',
			},
			{
				id: 'scene.ai-narration-provider',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Optional AI narration providers are planned after deterministic training outputs.',
			},
			{
				id: 'scene.evidence-publishing',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Scene evidence can be published into local redacted bundles and local release-evidence export records.',
			},
			{
				id: 'scene.redaction-policy-engine',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Deny-by-default redaction policies validate and control published scene evidence artifacts.',
			},
			{
				id: 'scene.scene-publish-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can publish local and release-target redacted evidence bundles with `trsd scene publish`.',
			},
			{
				id: 'scene.deny-by-default-redaction',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Evidence publishing excludes artifacts unless an explicit redaction policy rule includes them.',
			},
			{
				id: 'scene.local-publish-bundle',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Selected evidence artifacts are copied into a local publish bundle under the source run root.',
			},
			{
				id: 'scene.release-evidence-export',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Release-target publishing writes a local release-evidence export record without mutating external providers.',
			},
			{
				id: 'scene.publish-report',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Publish manifests and Markdown reports record redaction decisions, hashes, sizes, and bundle paths.',
			},
			{
				id: 'scene.publish-plan-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can produce docs, training, release-evidence, and artifact-store publication plans with `trsd scene publish-plan`.',
			},
			{
				id: 'scene.publication-export-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can create local publication export bundles from redacted Phase 10 publish artifacts with `trsd scene export`.',
			},
			{
				id: 'scene.docs-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Documentation publication destinations and selected artifacts are planned without mutating docs stores.',
			},
			{
				id: 'scene.training-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Training publication destinations and selected captions, transcripts, narration, glossary, and clip manifests are planned locally.',
			},
			{
				id: 'scene.release-evidence-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Release-evidence publication plans are generated from redacted publish manifests and block failed workflows.',
			},
			{
				id: 'scene.artifact-store-publication-plan',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Artifact-store publication is represented as plan-only metadata without remote upload.',
			},
			{
				id: 'scene.reconciliation-publication-intents',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Phase 11 manifests include plan-only reconciliation intent records for future canonical apply workflows.',
			},
			{
				id: 'scene.local-publication-export',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Selected redacted publish artifacts can be copied into local docs, training, and release-evidence export folders.',
			},
			{
				id: 'scene.visual-audit-command',
				status: 'available',
				owner: '@treeseed/cli',
				summary: 'The CLI can generate role and device screenshot review matrices with `trsd scene visual-audit`.',
			},
			{
				id: 'scene.visual-audit-route-discovery',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Visual audits discover user-facing core, admin, tenant override, and content-backed routes.',
			},
			{
				id: 'scene.visual-audit-role-fixtures',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Visual audits model anonymous and deterministic local fixture-backed owner, admin, and member roles.',
			},
			{
				id: 'scene.visual-audit-device-matrix',
				status: 'available',
				owner: '@treeseed/sdk',
				summary: 'Visual audits reuse scene device profiles to capture desktop, tablet, and mobile screenshots.',
			},
				{
					id: 'scene.visual-audit-screenshot-report',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audits write grouped viewport screenshots plus JSON and Markdown review reports.',
				},
				{
					id: 'scene.visual-audit-review',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audits generate deterministic functional, client-error, display, and architecture findings by default.',
				},
				{
					id: 'scene.visual-audit-client-error-capture',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit captures browser console, page, request, and HTTP errors for each reviewed route.',
				},
				{
					id: 'scene.visual-audit-functional-findings',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review flags failed captures, auth redirects, protected anonymous access, and seeded fixture visibility issues.',
				},
				{
					id: 'scene.visual-audit-display-findings',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review flags default-looking controls, horizontal overflow, visible error text, and low-content captures.',
				},
				{
					id: 'scene.visual-audit-agent-brief',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review writes an agent-focused repair brief that prioritizes reusable package architecture.',
				},
				{
					id: 'scene.visual-audit-contact-sheets',
					status: 'available',
					owner: '@treeseed/sdk',
					summary: 'Visual audit review writes local HTML contact sheets grouped by path root and flagged screenshots.',
				},
				{
				id: 'scene.remote-publication-apply',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Applying Phase 11 publication intents to external providers is deferred to Phase 12.',
			},
			{
				id: 'scene.remote-artifact-store-apply',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Remote artifact-store upload remains deferred until provider selection and retention policy are finalized.',
			},
			{
				id: 'scene.docs-training-publishing',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Docs and training-site external publication remains deferred to reconciled remote apply workflows.',
			},
			{
				id: 'scene.tts-audio-generation',
				status: 'planned',
				owner: '@treeseed/sdk',
				summary: 'Optional text-to-speech audio generation is planned after deterministic training outputs.',
			},
		],
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

export function planTreeseedSceneArtifactPaths(input: {
	workspaceRoot: string;
	sceneId: string;
	runId?: string;
	timestamp?: string;
}): TreeseedSceneArtifactPathPlan {
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
