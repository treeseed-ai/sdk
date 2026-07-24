import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	buildSceneEvidenceManifest,
	generateSceneEvidence,
	generateSceneTrainingOutputs,
	runScene,
	type SceneBrowserAdapter,
	type SceneBrowserLaunchInput,
	type SceneBrowserSession,
	type SceneLocator,
	type ScenePage,
} from '../../../../src/scenes/index.ts';
import { createSceneRunArtifacts, writeSceneRunArtifacts } from '../../../../src/scenes/support/evidence/artifacts.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-evidence-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeFile(path: string, value: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, 'utf8');
}

function writeScene(root: string, source = sceneYaml()) {
	const path = resolve(root, 'scenes', 'evidence-demo.yaml');
	writeFile(path, source);
	return path;
}

function sceneYaml() {
	return `schemaVersion: treeseed.scene/v1
id: evidence-demo
title: Evidence Demo
mode:
  test: true
target:
  app: market
  baseUrl: http://example.test
chapters:
  - id: intro
    title: Intro
    startsAt: open
workflow:
  - id: open
    title: Open evidence view
    action:
      goto: /
    expect:
      urlIncludes: example.test
    checkpoint:
      resumable: true
  - id: fail
    title: Fail for evidence
    action:
      click:
        role: button
        name: Fail
    expect:
      text: Missing text
`;
}

class FakeLocator implements SceneLocator {
	constructor(private readonly visible = true) {}
	async waitFor() {}
	async click() {}
	async fill() {}
	async isVisible() { return this.visible; }
}

class FakePage implements ScenePage {
	currentUrl = 'about:blank';
	keyboard = { press: async () => {} };
	async goto(url: string) { this.currentUrl = url; }
	url() { return this.currentUrl; }
	locator() { return new FakeLocator(); }
	getByTestId() { return new FakeLocator(); }
	getByRole() { return new FakeLocator(); }
	getByText(text: string) { return new FakeLocator(text !== 'Missing text'); }
	async screenshot(options: { path: string }) { writeFile(options.path, 'shot'); }
	on() {}
}

class FakeBrowserAdapter implements SceneBrowserAdapter {
	async launch(input: SceneBrowserLaunchInput): Promise<SceneBrowserSession> {
		return {
			page: new FakePage(),
			videoPaths: async () => input.recordVideoDir ? [resolve(input.recordVideoDir, 'video.webm')] : [],
			close: async () => {},
		};
	}
}

async function createRun(root: string) {
	writeScene(root);
	const run = await runScene({
		projectRoot: root,
		scene: 'evidence-demo',
		browserAdapter: new FakeBrowserAdapter(),
		timestamp: '20260615T130000Z',
		runId: 'evidence',
		record: true,
	});
	const runPath = run.artifacts!.runPath;
	const runJson = JSON.parse(readFileSync(runPath, 'utf8'));
	if (runJson.playwrightTracePath) writeFile(runJson.playwrightTracePath, 'trace');
	for (const path of runJson.videoPaths) writeFile(path, 'video');
	writeFile(runJson.artifacts.consoleLogPath, 'console');
	writeFile(runJson.artifacts.networkLogPath, 'network');
	writeFile(runJson.artifacts.errorsLogPath, 'errors');
	writeFile(resolve(run.artifacts!.runRoot, 'render', 'remotion', 'report.json'), JSON.stringify({ ok: true }));
	writeFile(runPath, JSON.stringify(runJson, null, 2) + '\n');
	return run;
}

describe('scene evidence outputs', () => {
	it('builds a deterministic manifest with hashes, exclusions, and recommendations', async () => {
		const root = workspace();
		const run = await createRun(root);
		const training = generateSceneTrainingOutputs({ projectRoot: root, scene: 'evidence-demo', from: run.artifacts!.runRoot });
		expect(training.ok).toBe(true);
		const scene = JSON.parse(readFileSync(run.artifacts!.normalizedScenePath, 'utf8'));
		const runJson = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		const timeline = JSON.parse(readFileSync(run.artifacts!.timelinePath, 'utf8'));
		const manifest = buildSceneEvidenceManifest({
			scene,
			run: runJson,
			timeline,
			runRoot: run.artifacts!.runRoot,
			target: 'release',
			bundlePolicy: 'sanitized',
			timestamp: '2026-06-15T13:00:00.000Z',
		});
		expect(manifest.schemaVersion).toBe('treeseed.scene.evidence/v1');
		expect(manifest.phase).toBe(9);
		expect(manifest.summary.sceneId).toBe('evidence-demo');
		expect(manifest.summary.runId).toBe('evidence');
		expect(manifest.summary.workflowStatus).toBe('failed');
		expect(manifest.summary.failedStep).toBe('fail');
		expect(manifest.summary.stepCounts.failed).toBe(1);
		expect(manifest.summary.chapters).toBe(1);
		expect(manifest.summary.segments).toBeGreaterThan(0);
		expect(manifest.summary.checkpoints).toBeGreaterThan(0);
		expect(manifest.summary.trainingOutputs).toBe(true);
		expect(manifest.artifacts.find((artifact) => artifact.kind === 'run-report')?.sha256).toMatch(/^[a-f0-9]{64}$/u);
		expect(manifest.artifacts.find((artifact) => artifact.kind === 'run-report')?.bytes).toBeGreaterThan(0);
		expect(manifest.artifacts.some((artifact) => artifact.kind === 'log-summary' && artifact.redactionStatus === 'excluded-sensitive')).toBe(true);
		expect(manifest.artifacts.some((artifact) => artifact.kind === 'render-video' && !artifact.includedInBundle)).toBe(true);
		expect(manifest.recommendations.some((entry) => entry.id === 'inspect-failed-run')).toBe(true);
		expect(manifest.recommendations.some((entry) => entry.id === 'resume-from-checkpoint')).toBe(true);
		expect(manifest.recommendations.some((entry) => entry.id === 'release-blocked' && entry.severity === 'blocking')).toBe(true);
		expect(Array.isArray(manifest.diagnostics)).toBe(true);
	});

	it('writes metadata-only and sanitized evidence artifacts and updates run.json', async () => {
		const root = workspace();
		const run = await createRun(root);
		const metadataOnly = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: run.artifacts!.runRoot, bundlePolicy: 'metadata-only' });
		expect(metadataOnly.ok).toBe(true);
		expect(metadataOnly.paths!.bundleRoot).toBeNull();
		expect(existsSync(metadataOnly.paths!.manifestPath)).toBe(true);
		expect(existsSync(metadataOnly.paths!.reportPath)).toBe(true);

		const sanitized = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: run.artifacts!.runRoot, target: 'ci', bundlePolicy: 'sanitized' });
		expect(sanitized.ok).toBe(true);
		expect(existsSync(sanitized.paths!.bundleManifestPath!)).toBe(true);
		expect(existsSync(resolve(sanitized.paths!.bundleRoot!, 'run.json'))).toBe(true);
		expect(existsSync(resolve(sanitized.paths!.bundleRoot!, 'timeline.json'))).toBe(true);
		expect(existsSync(resolve(sanitized.paths!.bundleRoot!, 'report.md'))).toBe(true);
		expect(existsSync(resolve(sanitized.paths!.bundleRoot!, 'playwright', 'trace.zip'))).toBe(false);
		const updatedRun = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		expect(updatedRun.evidencePaths.evidenceRoot).toBe(sanitized.paths!.evidenceRoot);
		expect(readFileSync(sanitized.paths!.reportPath, 'utf8')).toContain('Treeseed Scene Evidence');
	});

	it('reports missing run, missing timeline, and scene mismatch diagnostics', async () => {
		const root = workspace();
		writeScene(root);
		const missing = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: 'missing' });
		expect(missing.ok).toBe(false);
		expect(missing.diagnostics.some((entry) => entry.code === 'scene.run_not_found')).toBe(true);

		const run = await createRun(root);
		rmSync(run.artifacts!.timelinePath, { force: true });
		const missingTimeline = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: run.artifacts!.runRoot });
		expect(missingTimeline.ok).toBe(false);
		expect(missingTimeline.diagnostics.some((entry) => entry.code === 'scene.evidence_missing_timeline')).toBe(true);

		const mismatchRun = await createRun(root);
		writeScene(root, sceneYaml().replace('id: evidence-demo', 'id: other-demo'));
		const mismatch = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: mismatchRun.artifacts!.runRoot });
		expect(mismatch.ok).toBe(false);
		expect(mismatch.diagnostics.some((entry) => entry.code === 'scene.evidence_scene_mismatch')).toBe(true);
	});

	it('keeps evidence output ok when run.json cannot be updated', async () => {
		const root = workspace();
		const run = await createRun(root);
		chmodSync(run.artifacts!.runPath, 0o444);
		const report = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: run.artifacts!.runRoot });
		chmodSync(run.artifacts!.runPath, 0o644);
		expect(report.ok).toBe(true);
		expect(report.warnings.some((entry) => entry.code === 'scene.evidence_run_update_failed')).toBe(true);
	});

	it('builds evidence manifests for sparse successful runs and missing artifact fallbacks', () => {
		const root = workspace();
		const runRoot = resolve(root, '.treeseed', 'scenes', 'runs', 'sparse');
		mkdirSync(runRoot, { recursive: true });
		writeFile(resolve(runRoot, 'run.json'), '{}');
		writeFile(resolve(runRoot, 'timeline.json'), '[]');
		const manifest = buildSceneEvidenceManifest({
			scene: { id: 'sparse-scene' } as never,
			run: {
				ok: true,
				runId: null,
				workflowStatus: 'passed',
				environment: null,
				startedAt: '2026-06-15T13:00:00.000Z',
				finishedAt: '2026-06-15T13:00:01.000Z',
				durationMs: 1000,
				failedStep: null,
				steps: [],
				chapters: [],
				segments: [],
				checkpoints: [],
				renderedVideoPaths: ['rendered.mp4'],
				videoPaths: [],
				logs: {},
				diagnostics: [],
				trainingOutputPaths: ['training/report.json'],
				artifacts: {
					screenshotPaths: [resolve(runRoot, 'missing-shot.png')],
					videoPaths: [],
					playwrightTracePath: resolve(runRoot, 'missing-trace.zip'),
				},
			} as never,
			timeline: [],
			runRoot,
			target: 'local',
			bundlePolicy: 'metadata-only',
			timestamp: '2026-06-15T13:00:00.000Z',
		});
		expect(manifest.summary.ok).toBe(true);
		expect(manifest.summary.environment).toBeNull();
		expect(manifest.summary.renderedVideos).toBe(1);
		expect(manifest.recommendations.map((entry) => entry.id)).not.toContain('render-video');
		expect(manifest.recommendations.map((entry) => entry.id)).not.toContain('generate-training');
		expect(manifest.artifacts.some((artifact) => artifact.kind === 'screenshot' && artifact.redactionStatus === 'unknown')).toBe(true);
		expect(manifest.artifacts.some((artifact) => artifact.kind === 'log-summary' && artifact.redactionStatus === 'unknown')).toBe(true);
	});

	it('reports missing normalized scene and invalid current scene before writing evidence', async () => {
		const root = workspace();
		writeScene(root);
		const run = await createRun(root);

		rmSync(run.artifacts!.normalizedScenePath, { force: true });
		const missingScene = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: run.artifacts!.runRoot });
		expect(missingScene.diagnostics.map((entry) => entry.code)).toContain('scene.evidence_missing_scene');

		const invalidCurrent = await createRun(root);
		writeScene(root, 'schemaVersion: treeseed.scene/v0\nid: evidence-demo\nworkflow: []\n');
		const invalid = generateSceneEvidence({ projectRoot: root, scene: 'evidence-demo', from: invalidCurrent.artifacts!.runRoot });
		expect(invalid.diagnostics.map((entry) => entry.code)).toContain('scene.unsupported_schema_version');
	});

	it('handles sparse artifact collections, missing run files, and artifact writer fallbacks', () => {
		const root = workspace();
		writeScene(root);
		const runRoot = resolve(root, '.treeseed', 'scenes', 'runs', 'missing-run');
		mkdirSync(runRoot, { recursive: true });
		writeFile(resolve(runRoot, 'scene.normalized.json'), JSON.stringify({ id: 'evidence-demo' }));
		writeFile(resolve(runRoot, 'timeline.json'), '[]');
		writeFile(resolve(runRoot, 'run.json'), '{}');
		const manifest = buildSceneEvidenceManifest({
			scene: { id: null } as never,
			run: {
				ok: false, runId: null, workflowStatus: 'failed', environment: 'local',
				startedAt: '2026-01-01T00:00:00.000Z', finishedAt: '2026-01-01T00:00:01.000Z', durationMs: 1000,
				failedStep: null, steps: [], chapters: [], segments: [], checkpoints: [],
				videoPaths: [], renderedVideoPaths: [], logs: undefined, artifacts: undefined, diagnostics: undefined,
			} as never,
			timeline: [], runRoot, bundle: 'metadata-only',
		});
		expect(manifest.diagnostics).toEqual([]);
		expect(manifest.recommendations.find((entry) => entry.id === 'inspect-failed-run')?.command).not.toContain('--step');
		expect(manifest.recommendations.find((entry) => entry.id === 'generate-training')).toBeTruthy();

		writeSceneRunArtifacts({ scene: {} as never, plan: {} as never, report: { artifacts: null } as never, timeline: [] });
		const paths = {
			runRoot, playwrightRoot: resolve(runRoot, 'playwright'), logsRoot: resolve(runRoot, 'logs'), segmentsRoot: resolve(runRoot, 'segments'), checkpointsRoot: resolve(runRoot, 'checkpoints'), renderRoot: resolve(runRoot, 'render'), evidenceRoot: resolve(runRoot, 'evidence'), publishRoot: resolve(runRoot, 'publish'),
			normalizedScenePath: resolve(runRoot, 'normalized.json'), planPath: resolve(runRoot, 'plan.json'), runPath: resolve(runRoot, 'written-run.json'), timelinePath: resolve(runRoot, 'written-timeline.json'), markdownReportPath: resolve(runRoot, 'report.md'), progressPath: resolve(runRoot, 'progress.jsonl'),
		} as never;
		mkdirSync(paths.playwrightRoot, { recursive: true });
		mkdirSync(paths.logsRoot, { recursive: true });
		const artifacts = createSceneRunArtifacts({ paths });
		artifacts.setupPath = null;
		writeSceneRunArtifacts({ scene: {} as never, plan: {} as never, report: { artifacts } as never, timeline: [] });
		expect(existsSync(artifacts.runPath)).toBe(true);
	});
});
