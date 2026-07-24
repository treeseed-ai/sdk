import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	createDefaultSceneRedactionPolicy,
	generateSceneEvidence,
	generateSceneTrainingOutputs,
	publishSceneEvidence,
	runScene,
	validateSceneRedactionPolicy,
	type SceneBrowserAdapter,
	type SceneBrowserLaunchInput,
	type SceneBrowserSession,
	type SceneLocator,
	type ScenePage,
} from '../../../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-publish-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeFile(path: string, value: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, 'utf8');
}

function sceneYaml() {
	return `schemaVersion: treeseed.scene/v1
id: publish-demo
title: Publish Demo
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
    title: Open publish view
    action:
      goto: /
    expect:
      urlIncludes: example.test
    checkpoint:
      resumable: true
  - id: fail
    title: Fail for publish
    action:
      click:
        role: button
        name: Fail
    expect:
      text: Missing text
`;
}

function writeScene(root: string, source = sceneYaml()) {
	const path = resolve(root, 'scenes', 'publish-demo.yaml');
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

async function createRun(root: string) {
	writeScene(root);
	const run = await runScene({
		projectRoot: root,
		scene: 'publish-demo',
		browserAdapter: new FakeBrowserAdapter(),
		timestamp: '20260615T140000Z',
		runId: 'publish',
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

describe('scene evidence publishing', () => {
	it('validates deny-by-default redaction policies', () => {
		const policy = createDefaultSceneRedactionPolicy('local');
		expect(policy.mode).toBe('deny-by-default');
		expect(policy.rules.some((rule) => rule.artifactKind === 'run-report' && rule.include)).toBe(true);
		expect(validateSceneRedactionPolicy({ policy })).toEqual([]);
		expect(validateSceneRedactionPolicy({ policy: { ...policy, schemaVersion: 'wrong' } }).some((entry) => entry.code === 'scene.publish_redaction_policy_invalid')).toBe(true);
		expect(validateSceneRedactionPolicy({
			policy: {
				...policy,
				rules: [
					{ id: 'duplicate', artifactKind: 'run-report', include: true, reason: 'ok' },
					{ id: 'duplicate', artifactKind: 'not-real', include: true, reason: 'bad' },
				],
			},
		}).filter((entry) => entry.code === 'scene.publish_redaction_policy_invalid').length).toBeGreaterThan(1);
	});

	it('publishes from existing evidence with a redacted local bundle and run update', async () => {
		const root = workspace();
		const run = await createRun(root);
		expect(generateSceneTrainingOutputs({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot }).ok).toBe(true);
		expect(generateSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot }).ok).toBe(true);

		const report = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot, target: 'local' });
		expect(report.ok).toBe(true);
		expect(report.phase).toBe(10);
		expect(report.status).toBe('published');
		expect(existsSync(report.paths!.manifestPath)).toBe(true);
		expect(existsSync(report.paths!.reportPath)).toBe(true);
		expect(existsSync(resolve(report.paths!.bundleRoot, 'run.json'))).toBe(true);
		expect(existsSync(resolve(report.paths!.bundleRoot, 'timeline.json'))).toBe(true);
		expect(existsSync(resolve(report.paths!.bundleRoot, 'render', 'remotion', 'report.json'))).toBe(true);
		expect(existsSync(resolve(report.paths!.bundleRoot, 'playwright', 'trace.zip'))).toBe(false);
		const manifest = JSON.parse(readFileSync(report.paths!.manifestPath, 'utf8'));
		expect(manifest.schemaVersion).toBe('treeseed.scene.publish/v1');
		expect(manifest.artifacts.some((artifact: { kind: string; decision: string; sha256: string | null; bytes: number | null }) => artifact.kind === 'run-report' && artifact.decision === 'include' && artifact.sha256 && artifact.bytes > 0)).toBe(true);
		expect(manifest.artifacts.some((artifact: { kind: string; decision: string }) => artifact.kind === 'render-video' && artifact.decision !== 'include')).toBe(true);
		expect(manifest.artifacts.some((artifact: { kind: string; decision: string }) => artifact.kind === 'log-summary' && artifact.decision !== 'include')).toBe(true);
		const updatedRun = JSON.parse(readFileSync(run.artifacts!.runPath, 'utf8'));
		expect(updatedRun.publishPaths.publishRoot).toBe(report.publishRoot);
	});

	it('auto-generates evidence when needed and blocks failed release publish', async () => {
		const root = workspace();
		const run = await createRun(root);
		rmSync(resolve(run.artifacts!.runRoot, 'evidence'), { recursive: true, force: true });
		const local = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot, target: 'local' });
		expect(local.ok).toBe(true);
		expect(local.warnings.some((entry) => entry.code === 'scene.publish_generated_evidence')).toBe(true);

		const release = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot, target: 'release' });
		expect(release.ok).toBe(false);
		expect(release.diagnostics.some((entry) => entry.code === 'scene.publish_release_blocked')).toBe(true);
	});

	it('reports missing run, scene mismatch, invalid policy, and no included artifacts', async () => {
		const root = workspace();
		writeScene(root);
		const missing = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: 'missing' });
		expect(missing.ok).toBe(false);
		expect(missing.diagnostics.some((entry) => entry.code === 'scene.run_not_found')).toBe(true);

		const run = await createRun(root);
		writeScene(root, sceneYaml().replace('id: publish-demo', 'id: other-demo'));
		const mismatch = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot });
		expect(mismatch.ok).toBe(false);
		expect(mismatch.diagnostics.some((entry) => entry.code === 'scene.publish_scene_mismatch')).toBe(true);

		writeScene(root);
		const invalidPolicyPath = resolve(root, 'bad-redaction.json');
		writeFile(invalidPolicyPath, JSON.stringify({ schemaVersion: 'wrong', rules: [] }));
		const invalidPolicy = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot, redactionPolicyPath: invalidPolicyPath });
		expect(invalidPolicy.ok).toBe(false);
		expect(invalidPolicy.diagnostics.some((entry) => entry.code === 'scene.publish_redaction_policy_invalid')).toBe(true);

		const emptyPolicyPath = resolve(root, 'empty-redaction.yaml');
		writeFile(emptyPolicyPath, `schemaVersion: treeseed.scene.redaction-policy/v1
id: empty
mode: deny-by-default
rules: []
`);
		const noArtifacts = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot, redactionPolicyPath: emptyPolicyPath });
		expect(noArtifacts.ok).toBe(false);
		expect(noArtifacts.diagnostics.some((entry) => entry.code === 'scene.publish_no_artifacts')).toBe(true);
	});

	it('keeps publish output ok when run.json cannot be updated', async () => {
		const root = workspace();
		const run = await createRun(root);
		chmodSync(run.artifacts!.runPath, 0o444);
		const report = await publishSceneEvidence({ projectRoot: root, scene: 'publish-demo', from: run.artifacts!.runRoot });
		chmodSync(run.artifacts!.runPath, 0o644);
		expect(report.ok).toBe(true);
		expect(report.warnings.some((entry) => entry.code === 'scene.publish_run_update_failed')).toBe(true);
	});
});
