import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	exportScenePublication,
	generateSceneTrainingOutputs,
	planScenePublication,
	publishSceneEvidence,
	runScene,
	type SceneBrowserAdapter,
	type SceneBrowserLaunchInput,
	type SceneBrowserSession,
	type SceneLocator,
	type ScenePage,
} from '../../../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-publish-plan-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeFile(path: string, value: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, 'utf8');
}

function sceneYaml(input: { failing?: boolean } = {}) {
	return `schemaVersion: treeseed.scene/v1
id: publish-plan-demo
title: Publish Plan Demo
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
    title: Open publish plan view
    action:
      goto: /
    expect:
      urlIncludes: example.test
    checkpoint:
      resumable: true
${input.failing === false ? '' : `  - id: fail
    title: Fail for publish plan
    action:
      click:
        role: button
        name: Fail
    expect:
      text: Missing text
`}`;
}

function writeScene(root: string, source = sceneYaml()) {
	const path = resolve(root, 'scenes', 'publish-plan-demo.yaml');
	writeFile(path, source);
	return path;
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

async function createRun(root: string, input: { failing?: boolean } = {}) {
	writeScene(root, sceneYaml(input));
	const run = await runScene({
		projectRoot: root,
		scene: 'publish-plan-demo',
		browserAdapter: new FakeBrowserAdapter(),
		timestamp: input.failing === false ? '20260615T150000Z' : '20260615T140000Z',
		runId: input.failing === false ? 'publishplanpass' : 'publishplan',
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

describe('scene publication planning', () => {
	it('builds a publish plan from an existing Phase 10 local publish manifest', async () => {
		const root = workspace();
		const run = await createRun(root, { failing: false });
		expect(generateSceneTrainingOutputs({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot }).ok).toBe(true);
		expect((await publishSceneEvidence({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot, target: 'local' })).ok).toBe(true);

		const report = await planScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot });
		expect(report.ok).toBe(true);
		expect(report.phase).toBe(11);
		expect(report.manifest?.schemaVersion).toBe('treeseed.scene.publish-plan/v1');
		expect(report.manifest?.destinations.map((destination) => destination.id)).toEqual(['docs', 'training', 'release-evidence']);
		expect(report.manifest?.reconciliationIntents.every((intent) => intent.action === 'plan-only')).toBe(true);
		expect(existsSync(report.paths!.manifestPath)).toBe(true);
		expect(existsSync(report.paths!.reportPath)).toBe(true);
		const updatedRun = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		expect(updatedRun.publishPlanPaths.publishPlanRoot).toBe(report.publishPlanRoot);
	});

	it('auto-generates Phase 10 local publish when missing and supports artifact-store as plan-only', async () => {
		const root = workspace();
		const run = await createRun(root, { failing: false });
		rmSync(resolve(run.artifacts!.runRoot, 'publish'), { recursive: true, force: true });
		const report = await planScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot, targets: ['artifact-store'] });
		expect(report.ok).toBe(true);
		expect(report.warnings.some((entry) => entry.code === 'scene.publish_plan_missing_publish')).toBe(true);
		expect(report.manifest?.destinations[0]?.reconciliationResource.provider).toBe('artifact-store');
		expect(report.manifest?.reconciliationIntents[0]?.action).toBe('plan-only');
	});

	it('reports invalid targets, missing runs, scene mismatches, and failed release-evidence plans', async () => {
		const root = workspace();
		writeScene(root);
		const missing = await planScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: 'missing' });
		expect(missing.ok).toBe(false);
		expect(missing.diagnostics.some((entry) => entry.code === 'scene.run_not_found')).toBe(true);

		const run = await createRun(root);
		const invalid = await planScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot, targets: ['bad-target' as never] });
		expect(invalid.ok).toBe(false);
		expect(invalid.diagnostics.some((entry) => entry.code === 'scene.publish_plan_target_unsupported')).toBe(true);

		writeScene(root, sceneYaml().replace('id: publish-plan-demo', 'id: other-publish-plan-demo'));
		const mismatch = await planScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot, targets: ['docs'] });
		expect(mismatch.ok).toBe(false);
		expect(mismatch.diagnostics.some((entry) => entry.code === 'scene.publish_plan_scene_mismatch')).toBe(true);

		writeScene(root);
		const failedRelease = await planScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot, targets: ['release-evidence'] });
		expect(failedRelease.ok).toBe(false);
		expect(failedRelease.diagnostics.some((entry) => entry.code === 'scene.publish_plan_release_blocked')).toBe(true);
	});

	it('exports selected redacted artifacts without raw trace, video, network, console, or app logs', async () => {
		const root = workspace();
		const run = await createRun(root, { failing: false });
		expect(generateSceneTrainingOutputs({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot }).ok).toBe(true);
		const report = await exportScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot, targets: ['docs', 'training'] });
		expect(report.ok).toBe(true);
		expect(report.manifest?.mode).toBe('local-export');
		expect(existsSync(report.paths!.exportManifestPath!)).toBe(true);
		expect(existsSync(resolve(report.paths!.exportRoot!, 'docs', 'report.md'))).toBe(true);
		expect(existsSync(resolve(report.paths!.exportRoot!, 'training', 'training', 'captions.vtt'))).toBe(true);
		expect(existsSync(resolve(report.paths!.exportRoot!, 'docs', 'playwright', 'trace.zip'))).toBe(false);
		expect(existsSync(resolve(report.paths!.exportRoot!, 'training', 'playwright', 'video.webm'))).toBe(false);
		expect(existsSync(resolve(report.paths!.exportRoot!, 'docs', 'logs', 'console.jsonl'))).toBe(false);
	});

	it('keeps publish-plan output ok when run.json cannot be updated', async () => {
		const root = workspace();
		const run = await createRun(root, { failing: false });
		chmodSync(run.artifacts!.runPath, 0o444);
		const report = await planScenePublication({ projectRoot: root, scene: 'publish-plan-demo', from: run.artifacts!.runRoot, targets: ['docs'] });
		chmodSync(run.artifacts!.runPath, 0o644);
		expect(report.ok).toBe(true);
		expect(report.warnings.some((entry) => entry.code === 'scene.publish_plan_run_update_failed')).toBe(true);
	});
});
