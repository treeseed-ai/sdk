import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	inspectSceneRun,
	resumeScene,
	runScene,
	validateScene,
	type SceneBrowserAdapter,
	type SceneBrowserLaunchInput,
	type SceneBrowserSession,
	type SceneLocator,
	type ScenePage,
} from '../../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-long-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeScene(root: string, name: string, source: string) {
	writeFileSync(resolve(root, 'scenes', `${name}.yaml`), source, 'utf8');
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
	visible = true;
	keyboard = { press: async () => {} };
	async goto(url: string) { this.currentUrl = url; }
	url() { return this.currentUrl; }
	locator() { return new FakeLocator(this.visible); }
	getByTestId() { return new FakeLocator(this.visible); }
	getByRole() { return new FakeLocator(this.visible); }
	getByText() { return new FakeLocator(this.visible); }
	async screenshot(options: { path: string }) { writeFileSync(options.path, 'shot', 'utf8'); }
	on() {}
}

class FakeAdapter implements SceneBrowserAdapter {
	page = new FakePage();
	launches: SceneBrowserLaunchInput[] = [];
	async launch(input: SceneBrowserLaunchInput): Promise<SceneBrowserSession> {
		this.launches.push(input);
		return { page: this.page, close: async () => {} };
	}
}

function longScene(extra = '') {
	return `schemaVersion: treeseed.scene/v1
id: long-demo
title: Long Demo
mode:
  test: false
  demo: true
runtime:
  mode: demo
  timeouts:
    stepSeconds: 1
  checkpoints:
    defaultResumable: true
  progress:
    heartbeatSeconds: 1
  failure:
    continueOnFailure: true
target:
  app: market
  baseUrl: http://example.test
chapters:
  - id: intro
    title: Intro
    startsAt: open
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
    checkpoint:
      resumable: true
  - id: pause
    title: Pause
    action:
      pause:
        mode: timed
        durationSeconds: 0.001
    demoOnly: true
${extra}`;
}

describe('scene long workflow runtime', () => {
	it('normalizes runtime config defaults and validates invalid runtime values', () => {
		const root = workspace();
		writeScene(root, 'defaults', `schemaVersion: treeseed.scene/v1
id: defaults
title: Defaults
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
`);
		const valid = validateScene({ projectRoot: root, scene: 'defaults' });
		expect(valid.ok).toBe(true);
		expect(valid.scene?.runtime.mode).toBe('acceptance');
		expect(valid.scene?.runtime.timeouts.stepSeconds).toBe(120);

		writeScene(root, 'bad-runtime', `schemaVersion: treeseed.scene/v1
id: bad-runtime
title: Bad
runtime:
  mode: invalid
  timeouts:
    stepSeconds: -1
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
`);
		const invalid = validateScene({ projectRoot: root, scene: 'bad-runtime' });
		expect(invalid.diagnostics.map((entry) => entry.code)).toContain('scene.invalid_runtime_mode');
		expect(invalid.diagnostics.map((entry) => entry.code)).toContain('scene.invalid_number');
	});

	it('writes progress, chapters, segments, checkpoints, and inspectable artifacts', async () => {
		const root = workspace();
		writeScene(root, 'long-demo', longScene());
		const events: string[] = [];
		const report = await runScene({
			projectRoot: root,
			scene: 'long-demo',
			browserAdapter: new FakeAdapter(),
			sleep: async () => {},
			onProgress: (event) => events.push(event.type),
			timestamp: '20260614T120000Z',
			runId: 'longrun',
		});
		expect(report.ok).toBe(true);
		expect(report.phase).toBe(5);
		expect(report.chapters.map((chapter) => chapter.id)).toEqual(['intro']);
		expect(report.segments.length).toBeGreaterThan(0);
		expect(report.checkpoints.some((checkpoint) => checkpoint.id === 'open' && checkpoint.resumable)).toBe(true);
		expect(events).toContain('scene.run.started');
		expect(events).toContain('step.started');
		expect(events).toContain('checkpoint.written');
		expect(events).toContain('scene.run.finished');
		expect(existsSync(report.progressPath!)).toBe(true);
		expect(readFileSync(report.progressPath!, 'utf8')).toContain('checkpoint.written');
		const inspected = inspectSceneRun({ projectRoot: root, run: report.artifacts!.runRoot, stepId: 'open' });
		expect(inspected.ok).toBe(true);
		expect(inspected.selectedStep?.id).toBe('open');
	});

	it('blocks manual pause in non-interactive runs and supports injected pause controllers', async () => {
		const root = workspace();
		writeScene(root, 'manual', longScene(`  - id: manual
    title: Manual
    action:
      pause:
        mode: manual
        prompt: Continue?
    demoOnly: true
`));
		const blocked = await runScene({ projectRoot: root, scene: 'manual', browserAdapter: new FakeAdapter(), sleep: async () => {} });
		expect(blocked.ok).toBe(false);
		expect(blocked.diagnostics.some((entry) => entry.code === 'scene.manual_pause_requires_tty')).toBe(true);
		const passed = await runScene({
			projectRoot: root,
			scene: 'manual',
			browserAdapter: new FakeAdapter(),
			sleep: async () => {},
			interactive: true,
			pauseController: async () => ({ ok: true, diagnostics: [] }),
		});
		expect(passed.ok).toBe(true);
	});

	it('resumes from a resumable checkpoint and rejects non-resumable checkpoints', async () => {
		const root = workspace();
		writeScene(root, 'long-demo', longScene());
		const first = await runScene({ projectRoot: root, scene: 'long-demo', browserAdapter: new FakeAdapter(), sleep: async () => {}, timestamp: '20260614T120000Z', runId: 'source' });
		const resumed = await resumeScene({
			projectRoot: root,
			run: first.artifacts!.runRoot,
			fromCheckpoint: 'open',
			browserAdapter: new FakeAdapter(),
			sleep: async () => {},
			timestamp: '20260614T130000Z',
			runId: 'resumed',
		});
		expect(resumed.resumedFrom?.checkpointId).toBe('open');
		expect(resumed.artifacts?.runRoot).toContain('20260614T130000Z-resumed');

		writeScene(root, 'not-resumable', `schemaVersion: treeseed.scene/v1
id: not-resumable
title: Not Resumable
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
`);
		const second = await runScene({ projectRoot: root, scene: 'not-resumable', browserAdapter: new FakeAdapter() });
		const rejected = await resumeScene({ projectRoot: root, run: second.artifacts!.runRoot, fromCheckpoint: 'open', browserAdapter: new FakeAdapter() });
		expect(rejected.diagnostics[0]?.code).toBe('scene.checkpoint_not_resumable');
	});
});
