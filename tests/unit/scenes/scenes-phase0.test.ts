import { describe, expect, it } from 'vitest';
import {
	createTreeseedScenePhase0Report,
	planTreeseedSceneArtifactPaths,
} from '../../../src/scenes/index.ts';

describe('scene Phase 0 foundation', () => {
	it('reports the installed Phase 0 scene platform capability', () => {
		const report = createTreeseedScenePhase0Report();

		expect(report.ok).toBe(true);
		expect(report.phase).toBe(0);
		expect(report.status).toBe('foundation_ready');
		expect(report.name).toBe('central TreeSeed acceptance test harness and demo / educational video generator');
		expect(report.commandSurface).toContain('trsd scene status --json');
		expect(report.commandSurface).toContain('trsd scene validate <scene.yaml> --json');
		expect(report.commandSurface).toContain('trsd scene plan <scene.yaml> --json');
		expect(report.commandSurface).toContain('trsd scene run <scene.yaml> --environment local|staging|prod --record --json');
		expect(report.sdkExports).toContain('@treeseed/sdk/scenes');
		expect(report.deferredDependencies).toEqual([]);
		expect(report.activeOptionalDependencies).toEqual(['remotion', '@remotion/renderer', '@remotion/bundler']);
		expect(report.capabilities.map((capability) => capability.id)).toContain('scene.sdk-foundation');
		expect(report.capabilities.map((capability) => capability.id)).toContain('scene.schema-validation');
		expect(report.capabilities.map((capability) => capability.id)).toContain('scene.plan-compiler');
		expect(report.capabilities.find((capability) => capability.id === 'scene.playwright-runner')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.environment-integration')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.seed-integration')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.auth-integration')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.operation-polling')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.log-collection')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.plugin-contract')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.internal-action-plugins')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.internal-assertion-plugins')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.internal-environment-plugin')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.plugin-plan-diagnostics')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.long-workflow-runtime')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.checkpoints')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.resume')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.inspect')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.progress-jsonl')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.remotion-renderer')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.render-command')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.render-only-from-artifacts')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.screenshot-slideshow-rendering')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.diagram-system')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.diagram-plugin-provider')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.diagram-prop-validation')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.diagram-only-rendering')?.status).toBe('available');
		expect(report.commandSurface).toContain('trsd scene render <scene.yaml> --from <run-id-or-path> --renderer remotion --format mp4 --json');
		expect(report.commandSurface).toContain('trsd scene render <scene.yaml> --from <run-id-or-path> --mode diagram-only --json');
		expect(report.commandSurface).toContain('trsd scene training <scene.yaml> --from <run-id-or-path> --format json|markdown|vtt|srt --json');
		expect(report.capabilities.find((capability) => capability.id === 'scene.training-outputs')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.caption-generation')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.transcript-generation')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.narration-scripts')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.glossary-enrichment')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.chapter-clip-manifests')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.training-command')?.status).toBe('available');
		expect(report.commandSurface).toContain('trsd scene evidence <scene.yaml> --from <run-id-or-path> --target local|ci|release --bundle metadata-only|sanitized --json');
		expect(report.commandSurface).toContain('trsd scene publish <scene.yaml> --from <run-id-or-path> --target local|release --redaction-policy <path> --json');
		expect(report.commandSurface).toContain('trsd scene publish-plan <scene.yaml> --from <run-id-or-path> --target docs,training,release-evidence,artifact-store --json');
		expect(report.commandSurface).toContain('trsd scene export <scene.yaml> --from <run-id-or-path> --target docs,training,release-evidence,artifact-store --json');
		expect(report.commandSurface).toContain('trsd scene visual-audit <scene.yaml> --roles anonymous,owner,admin,member --device desktop|tablet|mobile|all --path-root /app,/auth,/market --path /app/projects/** --exclude-path **/delete --json');
		expect(report.capabilities.find((capability) => capability.id === 'scene.evidence-manifest')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.evidence-command')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.sanitized-evidence-bundle')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.evidence-recommendations')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.ci-scene-verification')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.release-evidence-summary')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.evidence-hashing')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.evidence-publishing')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.scene-publish-command')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.redaction-policy-engine')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.deny-by-default-redaction')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.local-publish-bundle')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.release-evidence-export')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.publish-report')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.publish-plan-command')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.publication-export-command')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.docs-publication-plan')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.training-publication-plan')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.release-evidence-publication-plan')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.artifact-store-publication-plan')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.reconciliation-publication-intents')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.local-publication-export')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.visual-audit-command')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.visual-audit-route-discovery')?.status).toBe('available');
		expect(report.capabilities.find((capability) => capability.id === 'scene.visual-audit-device-matrix')?.status).toBe('available');
		expect(report.nextPhase.phase).toBe(12);
	});

	it('plans deterministic scene artifact paths without creating files', () => {
		const plan = planTreeseedSceneArtifactPaths({
			workspaceRoot: '/workspace/market',
			sceneId: 'market-project-deploy-demo',
			timestamp: '20260614T120000Z',
			runId: 'abc123',
		});

		expect(plan.runRoot).toBe('/workspace/market/.treeseed/scenes/runs/market-project-deploy-demo/20260614T120000Z-abc123');
		expect(plan.normalizedScenePath).toBe(`${plan.runRoot}/scene.normalized.json`);
		expect(plan.planPath).toBe(`${plan.runRoot}/scene.plan.json`);
		expect(plan.runPath).toBe(`${plan.runRoot}/run.json`);
		expect(plan.timelinePath).toBe(`${plan.runRoot}/timeline.json`);
		expect(plan.markdownReportPath).toBe(`${plan.runRoot}/report.md`);
		expect(plan.htmlReportPath).toBe(`${plan.runRoot}/report.html`);
		expect(plan.playwrightRoot).toBe(`${plan.runRoot}/playwright`);
		expect(plan.logsRoot).toBe(`${plan.runRoot}/logs`);
		expect(plan.segmentsRoot).toBe(`${plan.runRoot}/segments`);
		expect(plan.renderRoot).toBe(`${plan.runRoot}/render`);
		expect(plan.trainingRoot).toBe(`${plan.runRoot}/training`);
		expect(plan.evidenceRoot).toBe(`${plan.runRoot}/evidence`);
		expect(plan.publishRoot).toBe(`${plan.runRoot}/publish`);
		expect(plan.publishPlanRoot).toBe(`${plan.runRoot}/publish-plan`);
		expect(plan.progressPath).toBe(`${plan.runRoot}/progress.jsonl`);
		expect(plan.checkpointsRoot).toBe(`${plan.runRoot}/checkpoints`);
	});

	it('rejects scene ids that are not safe for artifact paths', () => {
		expect(() => planTreeseedSceneArtifactPaths({
			workspaceRoot: '/workspace/market',
			sceneId: '../unsafe',
			timestamp: '20260614T120000Z',
			runId: 'abc123',
		})).toThrow(/Invalid scene id/iu);
	});
});
