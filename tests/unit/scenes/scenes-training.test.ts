import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildTreeseedSceneTrainingOutputs,
	formatTreeseedSceneCaptionsSrt,
	formatTreeseedSceneCaptionsVtt,
	formatTreeseedSceneNarrationMarkdown,
	formatTreeseedSceneTranscriptMarkdown,
	generateTreeseedSceneTrainingOutputs,
	runTreeseedScene,
	type TreeseedSceneBrowserAdapter,
	type TreeseedSceneBrowserLaunchInput,
	type TreeseedSceneBrowserSession,
	type TreeseedSceneLocator,
	type TreeseedScenePage,
} from '../../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-training-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeScene(root: string, source: string) {
	const path = resolve(root, 'scenes', 'training-demo.yaml');
	writeFileSync(path, source, 'utf8');
	return path;
}

function sceneYaml(extra = '') {
	return `schemaVersion: treeseed.scene/v1
id: training-demo
title: Training Demo
description: Deterministic training output proof.
audience:
  - operator
mode:
  test: false
  training: true
runtime:
  mode: training
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
    text: This operation checkpoint is ready.
diagrams:
  - id: lifecycle
    renderer: remotion
    component: OperationLifecycleDiagram
    at: open
    placement: interstitial
    props:
      states:
        - queued
        - running
        - completed
training:
  glossary:
    terms:
      - term: operation
        definition: Explicit operation definition.
        sourceStep: open
${extra}
workflow:
  - id: open
    title: Open training view
    action:
      goto: /
    expect:
      urlIncludes: example.test
  - id: verify
    title: Verify checkpoint
    action:
      click:
        role: button
        name: Verify
    expect:
      text: Verify
`;
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
	async screenshot(options: { path: string }) { writeFileSync(options.path, 'shot', 'utf8'); }
	on() {}
}

class FakeBrowserAdapter implements TreeseedSceneBrowserAdapter {
	async launch(input: TreeseedSceneBrowserLaunchInput): Promise<TreeseedSceneBrowserSession> {
		return {
			page: new FakePage(),
			videoPaths: async () => input.recordVideoDir ? [resolve(input.recordVideoDir, 'video.webm')] : [],
			close: async () => {},
		};
	}
}

async function createRun(root: string) {
	writeScene(root, sceneYaml());
	return runTreeseedScene({
		projectRoot: root,
		scene: 'training-demo',
		browserAdapter: new FakeBrowserAdapter(),
		timestamp: '20260615T120000Z',
		runId: 'training',
	});
}

describe('scene training outputs', () => {
	it('builds deterministic captions, transcript, narration, glossary, and chapter clip manifests', async () => {
		const root = workspace();
		const run = await createRun(root);
		const scene = JSON.parse(readFileSync(run.artifacts!.normalizedScenePath, 'utf8'));
		const runJson = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		const timeline = JSON.parse(readFileSync(run.artifacts!.timelinePath, 'utf8'));
		const outputs = buildTreeseedSceneTrainingOutputs({ scene, run: runJson, timeline });
		expect(outputs.schemaVersion).toBe('treeseed.scene.training-output/v1');
		expect(outputs.captions.map((cue) => cue.id)).toEqual([...outputs.captions.map((cue) => cue.id)].sort((a, b) => {
			const left = outputs.captions.find((cue) => cue.id === a)!;
			const right = outputs.captions.find((cue) => cue.id === b)!;
			return left.startMs - right.startMs || left.id.localeCompare(right.id);
		}));
		expect(outputs.captions.some((cue) => cue.id === 'chapter-intro')).toBe(true);
		expect(outputs.captions.some((cue) => cue.id === 'overlay-callout')).toBe(true);
		expect(outputs.captions.some((cue) => cue.id === 'diagram-lifecycle')).toBe(true);
		expect(outputs.transcript.some((entry) => entry.type === 'scene')).toBe(true);
		expect(outputs.transcript.some((entry) => entry.type === 'diagram')).toBe(true);
		expect(outputs.narration.some((entry) => entry.script.includes('proves'))).toBe(true);
		expect(outputs.glossary.find((entry) => entry.term === 'operation')?.definition).toBe('Explicit operation definition.');
		expect(outputs.glossary.some((entry) => entry.term === 'checkpoint')).toBe(true);
		expect(outputs.chapterClips[0]).toMatchObject({ chapterId: 'intro', suggestedOutputName: 'training-demo-intro.mp4' });
	});

	it('formats captions and Markdown outputs deterministically', async () => {
		const root = workspace();
		const run = await createRun(root);
		const report = generateTreeseedSceneTrainingOutputs({ projectRoot: root, scene: 'training-demo', from: run.artifacts!.runRoot });
		expect(report.ok).toBe(true);
		const vtt = readFileSync(report.paths!.captionsVttPath!, 'utf8');
		const srt = readFileSync(report.paths!.captionsSrtPath!, 'utf8');
		expect(vtt.startsWith('WEBVTT')).toBe(true);
		expect(srt).toMatch(/1\n\d\d:\d\d:\d\d,\d\d\d --> \d\d:\d\d:\d\d,\d\d\d/u);
		expect(formatTreeseedSceneCaptionsVtt(report.outputs!.captions)).toBe(vtt);
		expect(formatTreeseedSceneCaptionsSrt(report.outputs!.captions)).toBe(srt);
		expect(formatTreeseedSceneTranscriptMarkdown(report.outputs!.transcript)).toContain('# Training Demo');
		expect(formatTreeseedSceneNarrationMarkdown(report.outputs!.narration)).toContain('# Treeseed Scene Narration Script');
	});

	it('writes all training artifacts and updates run.json additively', async () => {
		const root = workspace();
		const run = await createRun(root);
		const report = generateTreeseedSceneTrainingOutputs({ projectRoot: root, scene: 'training-demo', from: run.artifacts!.runRoot });
		expect(report.ok).toBe(true);
		expect(existsSync(report.paths!.inputPath)).toBe(true);
		expect(existsSync(report.paths!.reportPath)).toBe(true);
		expect(existsSync(report.paths!.captionsVttPath!)).toBe(true);
		expect(existsSync(report.paths!.captionsSrtPath!)).toBe(true);
		expect(existsSync(report.paths!.transcriptJsonPath!)).toBe(true);
		expect(existsSync(report.paths!.transcriptMarkdownPath!)).toBe(true);
		expect(existsSync(report.paths!.narrationJsonPath!)).toBe(true);
		expect(existsSync(report.paths!.narrationMarkdownPath!)).toBe(true);
		expect(existsSync(report.paths!.glossaryJsonPath!)).toBe(true);
		expect(existsSync(report.paths!.glossaryMarkdownPath!)).toBe(true);
		expect(existsSync(report.paths!.chapterClipsPath!)).toBe(true);
		const updatedRun = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		expect(updatedRun.trainingOutputPaths.trainingRoot).toBe(report.paths!.trainingRoot);
		expect(updatedRun.renderedVideoPaths).toEqual([]);
	});

	it('can filter output formats', async () => {
		const root = workspace();
		const run = await createRun(root);
		const report = generateTreeseedSceneTrainingOutputs({ projectRoot: root, scene: 'training-demo', from: run.artifacts!.runRoot, formats: ['vtt'] });
		expect(report.ok).toBe(true);
		expect(report.paths!.captionsVttPath).toBeTruthy();
		expect(report.paths!.captionsSrtPath).toBeNull();
		expect(report.paths!.transcriptJsonPath).toBeNull();
		expect(report.paths!.transcriptMarkdownPath).toBeNull();
	});

	it('reports missing run, missing timeline, and scene mismatch diagnostics', async () => {
		const root = workspace();
		writeScene(root, sceneYaml());
		const missing = generateTreeseedSceneTrainingOutputs({ projectRoot: root, scene: 'training-demo', from: 'missing' });
		expect(missing.ok).toBe(false);
		expect(missing.diagnostics.some((entry) => entry.code === 'scene.run_not_found')).toBe(true);

		const run = await createRun(root);
		rmSync(run.artifacts!.timelinePath, { force: true });
		const missingTimeline = generateTreeseedSceneTrainingOutputs({ projectRoot: root, scene: 'training-demo', from: run.artifacts!.runRoot });
		expect(missingTimeline.ok).toBe(false);
		expect(missingTimeline.diagnostics.some((entry) => entry.code === 'scene.training_missing_timeline')).toBe(true);

		const mismatchRun = await createRun(root);
		writeScene(root, sceneYaml().replace('id: training-demo', 'id: other-demo'));
		const mismatch = generateTreeseedSceneTrainingOutputs({ projectRoot: root, scene: 'training-demo', from: mismatchRun.artifacts!.runRoot });
		expect(mismatch.ok).toBe(false);
		expect(mismatch.diagnostics.some((entry) => entry.code === 'scene.training_scene_mismatch')).toBe(true);
	});
});
