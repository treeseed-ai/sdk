import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	loadTreeseedSceneRenderInput,
	renderTreeseedScene,
	type TreeseedSceneBrowserAdapter,
	type TreeseedSceneBrowserLaunchInput,
	type TreeseedSceneBrowserSession,
	type TreeseedSceneLocator,
	type TreeseedScenePage,
	type TreeseedScenePlugin,
	type TreeseedSceneRendererAdapter,
} from '../../src/scenes/index.ts';
import { resolveEvidenceViewport } from '../../src/scenes/remotion-compositions.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-render-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeScene(root: string, name: string, source: string) {
	const path = resolve(root, 'scenes', `${name}.yaml`);
	writeFileSync(path, source, 'utf8');
	return path;
}

function sceneYaml(extra = '') {
	return `schemaVersion: treeseed.scene/v1
id: render-demo
title: Render Demo
description: Render existing scene evidence.
mode:
  test: false
  demo: true
runtime:
  mode: demo
target:
  app: market
  baseUrl: http://example.test
chapters:
  - id: intro
    title: Intro
    startsAt: open
overlays:
  - id: callout
    at: open
    renderer: remotion
    type: callout
    text: Rendered from evidence.
${extra}
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
  - id: review
    title: Review
    action:
      click:
        role: button
        name: Review
    expect:
      text: Review
`;
}

function deviceRenderScene() {
	return sceneYaml(`devices:
  defaultProfile: desktop
  profiles:
    - id: desktop
      viewport: { width: 1600, height: 900 }
      video: { width: 1600, height: 900 }
      output: { width: 1920, height: 1080 }
    - id: tablet
      viewport: { width: 1024, height: 768 }
      video: { width: 1024, height: 768 }
      output: { width: 1440, height: 1080 }
      isMobile: true
      hasTouch: true
    - id: mobile
      viewport: { width: 390, height: 844 }
      video: { width: 390, height: 844 }
      output: { width: 1080, height: 1920 }
      deviceScaleFactor: 2
      isMobile: true
      hasTouch: true
`);
}

class FakeLocator implements TreeseedSceneLocator {
	async waitFor() {}
	async click() {}
	async fill() {}
	async isVisible() { return true; }
}

class FakePage implements TreeseedScenePage {
	currentUrl = 'about:blank';
	keyboard = { press: async () => {} };
	async goto(url: string) { this.currentUrl = url; }
	url() { return this.currentUrl; }
	locator() { return new FakeLocator(); }
	getByTestId() { return new FakeLocator(); }
	getByRole() { return new FakeLocator(); }
	getByText() { return new FakeLocator(); }
	async screenshot(options: { path: string; fullPage?: boolean }) { writeFileSync(options.path, 'shot', 'utf8'); }
	on() {}
}

class FakeBrowserAdapter implements TreeseedSceneBrowserAdapter {
	async launch(input: TreeseedSceneBrowserLaunchInput): Promise<TreeseedSceneBrowserSession> {
		return {
			page: new FakePage(),
			videoPaths: async () => {
				if (!input.recordVideoDir) return [];
				const path = resolve(input.recordVideoDir, 'video.webm');
				writeFileSync(path, 'webm', 'utf8');
				return [path];
			},
			close: async () => {},
		};
	}
}

class FakeRendererAdapter implements TreeseedSceneRendererAdapter {
	id = 'fake';
	calls: Array<{ compositionId: string; outputPath: string; screenshots: number; videos: number; videoRefs: number; staticVideos: number; publicDir?: string; renderDiagrams: number; captions: number }> = [];
	async render(input: Parameters<TreeseedSceneRendererAdapter['render']>[0]) {
		this.calls.push({
			compositionId: input.compositionId,
			outputPath: input.outputPath,
			screenshots: input.inputProps.media.screenshots.length,
			videos: input.inputProps.media.videos.length,
			videoRefs: input.inputProps.media.videoRefs?.length ?? 0,
			staticVideos: input.inputProps.media.videoRefs?.filter((entry) => entry.staticPath).length ?? 0,
			publicDir: input.publicDir,
			renderDiagrams: input.inputProps.renderDiagrams.length,
			captions: input.inputProps.training.captions.length,
		});
		input.onProgress?.({ type: 'bundle.started' });
		input.onProgress?.({ type: 'bundle.finished' });
		input.onProgress?.({ type: 'composition.selected' });
		input.onProgress?.({ type: 'media.started' });
		writeFileSync(input.outputPath, 'mp4', 'utf8');
		input.onProgress?.({ type: 'media.finished' });
		return { ok: true, outputPath: input.outputPath, diagnostics: [] };
	}
}

async function createRun(root: string, options: { record?: boolean; failed?: boolean; diagrams?: boolean; training?: boolean } = {}) {
	const diagrams = options.diagrams ? `diagrams:
  - id: lifecycle
    renderer: remotion
    at: open
    component: OperationLifecycleDiagram
    placement: interstitial
    props:
      states:
        - queued
        - running
        - completed
` : '';
	writeScene(root, 'render-demo', sceneYaml(diagrams));
	const { runTreeseedScene } = await import('../../src/scenes/index.ts');
	const report = await runTreeseedScene({
		projectRoot: root,
		scene: 'render-demo',
		browserAdapter: new FakeBrowserAdapter(),
		record: options.record ?? false,
		timestamp: options.failed ? '20260614T130000Z' : '20260614T120000Z',
		runId: options.failed ? 'failed' : 'rendered',
	});
	if (options.failed) {
		const failed = JSON.parse(readFileSync(report.artifacts!.runPath, 'utf8'));
		failed.ok = false;
		failed.workflowStatus = 'failed';
		failed.failedStep = 'review';
		failed.steps = failed.steps.map((step: Record<string, unknown>) => step.id === 'review'
			? { ...step, status: 'failed', error: { severity: 'error', code: 'scene.assertion_failed', message: 'failed' } }
			: step);
		writeFileSync(report.artifacts!.runPath, `${JSON.stringify(failed, null, 2)}\n`, 'utf8');
		const scene = JSON.parse(readFileSync(report.artifacts!.normalizedScenePath, 'utf8'));
		scene.runtime.mode = 'acceptance';
		writeFileSync(report.artifacts!.normalizedScenePath, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
		return failed;
	}
	if (options.training) {
		const scenePath = report.artifacts!.normalizedScenePath;
		const scene = JSON.parse(readFileSync(scenePath, 'utf8'));
		scene.runtime.mode = 'training';
		writeFileSync(scenePath, `${JSON.stringify(scene, null, 2)}\n`, 'utf8');
	}
	return report;
}

describe('scene Remotion render MVP', () => {
	it('loads render input from existing run artifacts and falls back to screenshots without video', async () => {
		const root = workspace();
		const run = await createRun(root);
		const loaded = loadTreeseedSceneRenderInput({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot });
		expect(loaded.ok).toBe(true);
		expect(loaded.input?.schemaVersion).toBe('treeseed.scene.render-input/v1');
		expect(loaded.input?.render.composition).toBe('treeseed-demo-default');
		expect(loaded.input?.media.screenshots.length).toBeGreaterThan(0);
		expect(loaded.input?.media.screenshots.every((entry) => entry.captureKind === 'viewport')).toBe(true);
		expect(loaded.input?.media.videos).toEqual([]);
		expect(loaded.warnings.some((entry) => entry.code === 'scene.render_video_missing')).toBe(true);
		expect(loaded.input?.overlays[0]?.id).toBe('callout');
	});

	it('uses Playwright video refs as primary media and stages local video for Remotion', async () => {
		const root = workspace();
		const run = await createRun(root, { record: true });
		const loaded = loadTreeseedSceneRenderInput({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot });
		expect(loaded.ok).toBe(true);
		expect(loaded.input?.media.videoRefs?.[0]?.path).toMatch(/video\.webm$/u);
		expect(loaded.input?.media.videos[0]).toMatch(/video\.webm$/u);
		expect(loaded.input?.media.videoRefs?.[0]?.staticPath).toBeUndefined();

		const adapter = new FakeRendererAdapter();
		const report = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, rendererAdapter: adapter });
		expect(report.ok).toBe(true);
		expect(adapter.calls[0]?.videoRefs).toBe(1);
		expect(adapter.calls[0]?.staticVideos).toBe(1);
		expect(adapter.calls[0]?.publicDir).toBe(resolve(report.renderRoot!, 'public'));
		const inputJson = JSON.parse(readFileSync(resolve(report.renderRoot!, 'input.json'), 'utf8'));
		expect(inputJson.media.videoRefs[0].staticPath).toMatch(/^media\/[a-f0-9]+\.webm$/u);
		expect(JSON.stringify(inputJson.media.videoRefs[0])).not.toContain('data:video');
		expect(existsSync(resolve(report.renderRoot!, 'public', inputJson.media.videoRefs[0].staticPath))).toBe(true);
		expect(report.sourceArtifacts.videoPaths[0]).toMatch(/video\.webm$/u);
	});

	it('reports capture aspect mismatch only when source capture differs from output aspect', async () => {
		const mismatchRoot = workspace();
		writeScene(mismatchRoot, 'render-demo', sceneYaml(`devices:
  defaultProfile: tablet
  profiles:
    - id: tablet
      viewport: { width: 1024, height: 768 }
      video: { width: 1024, height: 768 }
      output: { width: 1920, height: 1080 }
      isMobile: true
      hasTouch: true
`));
		const { runTreeseedScene: runMismatchScene } = await import('../../src/scenes/index.ts');
		const mismatchRun = await runMismatchScene({
			projectRoot: mismatchRoot,
			scene: 'render-demo',
			browserAdapter: new FakeBrowserAdapter(),
			record: true,
			timestamp: '20260614T130000Z',
			runId: 'mismatch',
		});
		const mismatch = loadTreeseedSceneRenderInput({ projectRoot: mismatchRoot, scene: 'render-demo', from: mismatchRun.artifacts!.runRoot });
		expect(mismatch.warnings.some((entry) => entry.code === 'scene.render_capture_aspect_mismatch')).toBe(true);

		const matchedRoot = workspace();
		const capture = `render:
  remotion:
    output:
      resolution:
        width: 1920
        height: 1080
    capture:
      viewport:
        width: 1600
        height: 900
      video:
        width: 1600
        height: 900
      evidenceFit: fixed-browser
`;
		writeScene(matchedRoot, 'render-demo', sceneYaml(capture));
		const { runTreeseedScene } = await import('../../src/scenes/index.ts');
		const matchedRun = await runTreeseedScene({
			projectRoot: matchedRoot,
			scene: 'render-demo',
			browserAdapter: new FakeBrowserAdapter(),
			record: true,
			timestamp: '20260614T140000Z',
			runId: 'matched',
		});
		const matched = loadTreeseedSceneRenderInput({ projectRoot: matchedRoot, scene: 'render-demo', from: matchedRun.artifacts!.runRoot });
		expect(matched.warnings.some((entry) => entry.code === 'scene.render_capture_aspect_mismatch')).toBe(false);
		expect(matched.input?.run.capture?.viewport).toEqual({ width: 1600, height: 900 });
	});

	it('resolves a stable evidence viewport independent of screenshot dimensions', async () => {
		const root = workspace();
		const run = await createRun(root, { record: true });
		const loaded = loadTreeseedSceneRenderInput({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot });
		expect(loaded.input).toBeTruthy();
		const viewport = resolveEvidenceViewport(loaded.input!);
		expect(viewport).toEqual({ width: 1920, height: 1080, scale: 1.2, left: 0, top: 0 });
		const withTallScreenshots = {
			...loaded.input!,
			media: {
				...loaded.input!.media,
				screenshots: loaded.input!.media.screenshots.map((entry) => ({ ...entry, width: 1200, height: 8000 })),
			},
		};
		expect(resolveEvidenceViewport(withTallScreenshots)).toEqual(viewport);
	});

	it('uses recorded device metadata for output resolution and render device checks', async () => {
		const root = workspace();
		writeScene(root, 'render-demo', deviceRenderScene());
		const { runTreeseedScene } = await import('../../src/scenes/index.ts');
		const run = await runTreeseedScene({
			projectRoot: root,
			scene: 'render-demo',
			browserAdapter: new FakeBrowserAdapter(),
			record: true,
			device: 'mobile',
			timestamp: '20260616T120000Z',
			runId: 'mobile',
		});
		const loaded = loadTreeseedSceneRenderInput({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot });
		expect(loaded.ok).toBe(true);
		expect(loaded.input?.run.device?.id).toBe('mobile');
		expect(loaded.input?.render.width).toBe(1080);
		expect(loaded.input?.render.height).toBe(1920);

		const matching = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, device: 'mobile', rendererAdapter: new FakeRendererAdapter() });
		expect(matching.ok).toBe(true);
		expect(matching.device?.id).toBe('mobile');
		const mismatch = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, device: 'desktop', rendererAdapter: new FakeRendererAdapter() });
		expect(mismatch.ok).toBe(false);
		expect(mismatch.diagnostics.some((entry) => entry.code === 'scene.render_device_mismatch')).toBe(true);
	});

	it('renders with a fake adapter, writes Remotion artifacts, and appends renderedVideoPaths', async () => {
		const root = workspace();
		const run = await createRun(root);
		const adapter = new FakeRendererAdapter();
		const report = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, rendererAdapter: adapter });
		expect(report.ok).toBe(true);
		expect(report.phase).toBe(6);
		expect(report.composition).toBe('treeseed-demo-default');
		expect(adapter.calls[0]?.compositionId).toBe('treeseed-demo-default');
		expect(existsSync(report.outputPath!)).toBe(true);
		expect(existsSync(resolve(report.renderRoot!, 'input.json'))).toBe(true);
		expect(existsSync(resolve(report.renderRoot!, 'composition.json'))).toBe(true);
		expect(existsSync(resolve(report.renderRoot!, 'progress.jsonl'))).toBe(true);
		expect(existsSync(resolve(report.renderRoot!, 'report.json'))).toBe(true);
		const updatedRun = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		expect(updatedRun.renderedVideoPaths).toContain(report.outputPath);
	});

	it('defaults modes and compositions for training and failure-review renders', async () => {
		const root = workspace();
		const training = await createRun(root, { training: true });
		const trainingReport = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: training.artifacts!.runRoot, rendererAdapter: new FakeRendererAdapter() });
		expect(trainingReport.mode).toBe('training');
		expect(trainingReport.composition).toBe('treeseed-training-default');
		expect(trainingReport.trainingOutputPaths?.captionsVttPath).toBeTruthy();
		expect(existsSync(trainingReport.trainingOutputPaths!.captionsVttPath!)).toBe(true);
		expect(JSON.parse(readFileSync(training.artifacts!.runPath, 'utf8')).trainingOutputPaths.trainingRoot).toBe(trainingReport.trainingOutputPaths?.trainingRoot);

		const failed = await createRun(root, { failed: true });
		const failureReport = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: failed.artifacts!.runRoot, rendererAdapter: new FakeRendererAdapter() });
		expect(failureReport.mode).toBe('failure-review');
		expect(failureReport.composition).toBe('treeseed-failure-review');
	});

	it('supports chapter rendering and reports invalid render requests', async () => {
		const root = workspace();
		const run = await createRun(root);
		const chapter = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, mode: 'chapter', chapterId: 'intro', rendererAdapter: new FakeRendererAdapter() });
		expect(chapter.ok).toBe(true);
		expect(chapter.mode).toBe('chapter');
		const missingChapter = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, mode: 'chapter', chapterId: 'missing', rendererAdapter: new FakeRendererAdapter() });
		expect(missingChapter.ok).toBe(false);
		expect(missingChapter.diagnostics.some((entry) => entry.code === 'scene.render_chapter_not_found')).toBe(true);
		const badRenderer = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, renderer: 'bad', rendererAdapter: new FakeRendererAdapter() });
		expect(badRenderer.diagnostics[0]?.code).toBe('scene.renderer_unknown');
		const badFormat = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, format: 'webm' as 'mp4', rendererAdapter: new FakeRendererAdapter() });
		expect(badFormat.diagnostics[0]?.code).toBe('scene.render_format_unsupported');
	});

	it('renders typed diagrams and supports diagram-only mode without browser media', async () => {
		const root = workspace();
		const run = await createRun(root, { diagrams: true });
		const loaded = loadTreeseedSceneRenderInput({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot });
		expect(loaded.input?.renderDiagrams).toHaveLength(1);
		expect(loaded.input?.training.captions.length).toBeGreaterThan(0);
		expect(loaded.input?.renderDiagrams[0]?.component).toBe('OperationLifecycleDiagram');
		expect(loaded.warnings.some((entry) => entry.code === 'scene.diagram_render_deferred')).toBe(false);
		const diagramReport = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, rendererAdapter: new FakeRendererAdapter() });
		expect(diagramReport.warnings.some((entry) => entry.code === 'scene.diagram_render_deferred')).toBe(false);
		for (const step of run.steps) {
			if (step.screenshotPath) rmSync(step.screenshotPath, { force: true });
			if (step.viewportScreenshotPath) rmSync(step.viewportScreenshotPath, { force: true });
		}
		const runJson = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		runJson.steps = runJson.steps.map((step: Record<string, unknown>) => ({ ...step, screenshotPath: null, viewportScreenshotPath: null }));
		runJson.artifacts.screenshotPaths = [];
		runJson.artifacts.viewportScreenshotPaths = [];
		writeFileSync(run.artifacts!.runPath, `${JSON.stringify(runJson, null, 2)}\n`, 'utf8');
		const adapter = new FakeRendererAdapter();
		const diagramOnly = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, mode: 'diagram-only', rendererAdapter: adapter });
		expect(diagramOnly.ok).toBe(true);
		expect(diagramOnly.composition).toBe('treeseed-diagram-only');
		expect(adapter.calls[0]?.renderDiagrams).toBe(1);
		const missing = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, rendererAdapter: new FakeRendererAdapter() });
		expect(missing.ok).toBe(false);
		expect(missing.diagnostics.some((entry) => entry.code === 'scene.render_missing_media')).toBe(true);
	});

	it('blocks diagram-only rendering when no diagrams exist', async () => {
		const root = workspace();
		const run = await createRun(root);
		const report = await renderTreeseedScene({ projectRoot: root, scene: 'render-demo', from: run.artifacts!.runRoot, mode: 'diagram-only', rendererAdapter: new FakeRendererAdapter() });
		expect(report.ok).toBe(false);
		expect(report.diagnostics.some((entry) => entry.code === 'scene.render_missing_diagram')).toBe(true);
	});

	it('can render through an explicitly supplied non-Remotion renderer adapter', async () => {
		const root = workspace();
		const run = await createRun(root);
		const adapter = new FakeRendererAdapter();
		const plugins: TreeseedScenePlugin[] = [{
			id: 'test.scene.renderer.host',
			version: '1.0.0',
			phase: 6,
			status: 'available',
			summary: 'Test renderer host.',
			renderers: {
				'test-renderer': {
					id: 'test-renderer',
					phase: 6,
					status: 'available',
					summary: 'Test renderer adapter.',
				},
			},
		}];
		const report = await renderTreeseedScene({
			projectRoot: root,
			scene: 'render-demo',
			from: run.artifacts!.runRoot,
			renderer: 'test-renderer',
			plugins,
			rendererAdapterFactory: ({ renderer }) => renderer === 'test-renderer' ? adapter : null,
		});
		expect(report.ok).toBe(true);
		expect(report.renderer).toBe('test-renderer');
		expect(adapter.calls[0]?.compositionId).toBe('treeseed-demo-default');
		expect(existsSync(report.outputPath!)).toBe(true);
	});
});
