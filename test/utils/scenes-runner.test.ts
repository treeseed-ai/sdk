import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	planTreeseedScene,
	runTreeseedSceneDeviceMatrix,
	runTreeseedScene,
	type TreeseedSceneBrowserAdapter,
	type TreeseedSceneBrowserLaunchInput,
	type TreeseedSceneBrowserSession,
	type TreeseedSceneLocator,
	type TreeseedScenePage,
} from '../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-runner-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeScene(root: string, name: string, source: string) {
	const path = resolve(root, 'scenes', `${name}.yaml`);
	writeFileSync(path, source, 'utf8');
	return path;
}

function executableScene(extraStep = '') {
	return `schemaVersion: treeseed.scene/v1
id: browser-smoke
title: Browser Smoke
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: open-home
    title: Open home
    action:
      goto: /
    expect:
      urlIncludes: example.test
  - id: click-projects
    title: Click projects
    action:
      click:
        role: link
        name: Projects
    expect:
      visible:
        - scene: projects.index
  - id: fill-search
    title: Fill search
    action:
      fill:
        testId: project-search
        value: Market
    expect:
      text: Market
  - id: keyboard
    title: Press enter
    action:
      keyboard: Enter
    expect:
      urlIncludes: example.test
${extraStep}`;
}

function captureScene() {
	return `schemaVersion: treeseed.scene/v1
id: capture-smoke
title: Capture Smoke
runtime:
  mode: training
target:
  app: market
  baseUrl: http://example.test
  viewport:
    width: 1440
    height: 1000
render:
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
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
`;
}

function deviceScene() {
	return `schemaVersion: treeseed.scene/v1
id: device-smoke
title: Device Smoke
runtime:
  mode: training
target:
  app: market
  baseUrl: http://example.test
devices:
  defaultProfile: desktop
  profiles:
    - id: desktop
      viewport: { width: 1600, height: 900 }
      video: { width: 1600, height: 900 }
      output: { width: 1920, height: 1080 }
      deviceScaleFactor: 1
      isMobile: false
      hasTouch: false
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
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
`;
}

class FakeLocator implements TreeseedSceneLocator {
	constructor(private readonly selector: string, private readonly page: FakePage) {}
	async waitFor() {
		this.page.calls.push(`wait:${this.selector}`);
	}
	async click() {
		this.page.calls.push(`click:${this.selector}`);
	}
	async fill(value: string) {
		this.page.calls.push(`fill:${this.selector}:${value}`);
	}
	async selectOption(option: string | { label: string }) {
		this.page.calls.push(`select:${this.selector}:${typeof option === 'string' ? option : `label:${option.label}`}`);
	}
	async isVisible() {
		this.page.calls.push(`visible:${this.selector}`);
		return this.page.visible;
	}
}

class FakePage implements TreeseedScenePage {
	calls: string[] = [];
	visible = true;
	currentUrl = 'about:blank';
	handlers: Record<string, Function[]> = {};
	keyboard = {
		press: async (key: string) => {
			this.calls.push(`key:${key}`);
		},
	};
	async goto(url: string) {
		this.currentUrl = url;
		this.calls.push(`goto:${url}`);
	}
	url() {
		return this.currentUrl;
	}
	locator(selector: string) {
		this.calls.push(`locator:${selector}`);
		return new FakeLocator(selector, this);
	}
	getByTestId(testId: string) {
		this.calls.push(`testId:${testId}`);
		return new FakeLocator(`testId:${testId}`, this);
	}
	getByRole(role: string, options?: { name?: string }) {
		this.calls.push(`role:${role}:${options?.name ?? ''}`);
		return new FakeLocator(`role:${role}:${options?.name ?? ''}`, this);
	}
	getByText(text: string) {
		this.calls.push(`text:${text}`);
		return new FakeLocator(`text:${text}`, this);
	}
	async screenshot(options: { path: string; fullPage?: boolean }) {
		writeFileSync(options.path, 'fake screenshot', 'utf8');
		this.calls.push(`screenshot:${options.fullPage === false ? 'viewport' : 'full-page'}:${options.path}`);
	}
	on(event: 'console' | 'requestfailed' | 'response', handler: Function) {
		this.handlers[event] = [...(this.handlers[event] ?? []), handler];
	}
	emitConsoleError(message: string) {
		for (const handler of this.handlers.console ?? []) handler({ type: () => 'error', text: () => message });
	}
	emitRequestFailed(url: string) {
		for (const handler of this.handlers.requestfailed ?? []) handler({ url: () => url, method: () => 'GET', failure: () => ({ errorText: 'failed' }) });
	}
}

class FakeAdapter implements TreeseedSceneBrowserAdapter {
	page = new FakePage();
	launches: TreeseedSceneBrowserLaunchInput[] = [];
	async launch(input: TreeseedSceneBrowserLaunchInput): Promise<TreeseedSceneBrowserSession> {
		this.launches.push(input);
		return {
			page: this.page,
			startTracing: async () => {
				this.page.calls.push('trace:start');
			},
			stopTracing: async (tracePath: string) => {
				writeFileSync(tracePath, 'trace', 'utf8');
				this.page.calls.push(`trace:stop:${tracePath}`);
			},
			videoPaths: async () => input.recordVideoDir ? [resolve(input.recordVideoDir, 'video.webm')] : [],
			close: async () => {
				this.page.calls.push('close');
			},
		};
	}
}

describe('scene Playwright runner foundation', () => {
	it('returns blocked diagnostics for invalid YAML without launching a browser', async () => {
		const root = workspace();
		writeScene(root, 'bad', 'schemaVersion: [');
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({ projectRoot: root, scene: 'bad', browserAdapter: adapter });
		expect(report.workflowStatus).toBe('blocked');
		expect(report.diagnostics[0]?.code).toBe('scene.yaml_parse_error');
		expect(adapter.launches).toEqual([]);
	});

	it('blocks auto local base URL when no managed dev web instance is running', async () => {
		const root = workspace();
		writeScene(root, 'auto', `schemaVersion: treeseed.scene/v1
id: auto
title: Auto
target:
  app: market
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      text: Home
`);
		const report = await runTreeseedScene({ projectRoot: root, scene: 'auto', browserAdapter: new FakeAdapter() });
		expect(report.workflowStatus).toBe('blocked');
		expect(report.diagnostics.some((entry) => entry.code === 'scene.local_dev_not_running')).toBe(true);
	});

	it('runs browser-safe actions and writes Phase 5 artifacts', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene(`  - id: choose-role
    title: Choose role
    action:
      select:
        css: select[name="roleKey"]
        internal: true
        value: project_lead
    expect:
      text: Project lead
`));
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({
			projectRoot: root,
			scene: 'browser-smoke',
			browserAdapter: adapter,
			record: true,
			timestamp: '20260614T120000Z',
			runId: 'run123',
		});
		expect(report.ok).toBe(true);
		expect(report.phase).toBe(5);
		expect(report.workflowStatus).toBe('passed');
		expect(report.artifacts?.runRoot).toContain('.treeseed/scenes/runs/browser-smoke/20260614T120000Z-run123');
		expect(report.steps.map((step) => step.actionKind)).toEqual(['goto', 'click', 'fill', 'keyboard', 'select']);
		expect(adapter.page.calls).toContain('goto:http://example.test/');
		expect(adapter.page.calls).toContain('role:link:Projects');
		expect(adapter.page.calls).toContain('testId:project-search');
		expect(adapter.page.calls).toContain('fill:testId:project-search:Market');
		expect(adapter.page.calls).toContain('key:Enter');
		expect(adapter.page.calls).toContain('select:select[name="roleKey"]:project_lead');
		expect(existsSync(report.artifacts!.runPath)).toBe(true);
		expect(existsSync(report.artifacts!.timelinePath)).toBe(true);
		expect(existsSync(report.artifacts!.markdownReportPath)).toBe(true);
		expect(existsSync(report.artifacts!.normalizedScenePath)).toBe(true);
		expect(existsSync(report.artifacts!.planPath)).toBe(true);
		expect(readFileSync(report.artifacts!.timelinePath, 'utf8')).toContain('scene.start');
	});

	it('records console and network failures in reports and jsonl artifacts', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const adapter = new FakeAdapter();
		const originalGoto = adapter.page.goto.bind(adapter.page);
		adapter.page.goto = async (url: string) => {
			await originalGoto(url);
			adapter.page.emitConsoleError('boom');
			adapter.page.emitRequestFailed('http://example.test/api');
		};
		const report = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: adapter });
		expect(report.ok).toBe(true);
		expect(report.steps[0]?.consoleErrors[0]?.message).toBe('boom');
		expect(report.steps[0]?.networkErrors[0]?.url).toBe('http://example.test/api');
		expect(readFileSync(report.artifacts!.consoleLogPath!, 'utf8')).toContain('boom');
		expect(readFileSync(report.artifacts!.networkLogPath!, 'utf8')).toContain('example.test/api');
	});

	it('fails unresolved operation actions and assertions with clear diagnostics', async () => {
		const root = workspace();
		writeScene(root, 'unsupported-action', executableScene(`  - id: wait
    title: Wait for operation
    action:
      waitForOperation:
        kind: project.web_deployment
        status:
          - completed
    expect:
      text: Done
`));
		const actionReport = await runTreeseedScene({ projectRoot: root, scene: 'unsupported-action', browserAdapter: new FakeAdapter() });
		expect(actionReport.ok).toBe(false);
		expect(actionReport.failedStep).toBe('wait');
		expect(actionReport.diagnostics.some((entry) => entry.code === 'scene.operation_id_unresolved')).toBe(true);

		writeScene(root, 'unsupported-assertion', `schemaVersion: treeseed.scene/v1
id: unsupported-assertion
title: Unsupported Assertion
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      operation:
        kind: project.web_deployment
        status:
          - completed
`);
		const assertionReport = await runTreeseedScene({ projectRoot: root, scene: 'unsupported-assertion', browserAdapter: new FakeAdapter() });
		expect(assertionReport.ok).toBe(false);
		expect(assertionReport.failedStep).toBe('open');
		expect(assertionReport.diagnostics.some((entry) => entry.code === 'scene.operation_id_unresolved')).toBe(true);
		expect(assertionReport.steps[0]?.screenshotPath).toBeTruthy();
		expect(assertionReport.steps[0]?.viewportScreenshotPath).toBeTruthy();
		expect(assertionReport.artifacts?.screenshotPaths).toContain(assertionReport.steps[0]?.screenshotPath);
		expect(assertionReport.artifacts?.viewportScreenshotPaths).toContain(assertionReport.steps[0]?.viewportScreenshotPath);
		expect(existsSync(assertionReport.steps[0]!.screenshotPath!)).toBe(true);
		expect(existsSync(assertionReport.steps[0]!.viewportScreenshotPath!)).toBe(true);
		expect(readFileSync(assertionReport.artifacts!.markdownReportPath, 'utf8')).toContain('Failed Step');
	});

	it('keeps plan non-mutating while run creates artifacts', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const plan = planTreeseedScene({ projectRoot: root, scene: 'browser-smoke', timestamp: '20260614T120000Z', runId: 'run123' });
		expect(plan.artifactPaths?.runRoot).toBeTruthy();
		expect(existsSync(plan.artifactPaths!.runRoot)).toBe(false);
		const report = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: new FakeAdapter(), timestamp: '20260614T120000Z', runId: 'run123' });
		expect(existsSync(report.artifacts!.runRoot)).toBe(true);
	});

	it('uses fixed capture viewport and video size for recorded training runs', async () => {
		const root = workspace();
		writeScene(root, 'capture-smoke', captureScene());
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({ projectRoot: root, scene: 'capture-smoke', browserAdapter: adapter, record: true });
		expect(adapter.launches[0]?.viewport).toEqual({ width: 1600, height: 900 });
		expect(adapter.launches[0]?.videoSize).toEqual({ width: 1600, height: 900 });
		expect(report.capture).toEqual({
			viewport: { width: 1600, height: 900 },
			videoSize: { width: 1600, height: 900 },
			renderResolution: { width: 1920, height: 1080 },
			evidenceFit: 'fixed-browser',
		});
	});

	it('uses the default device profile viewport for non-recorded acceptance runs', async () => {
		const root = workspace();
		writeScene(root, 'capture-smoke', captureScene());
		const adapter = new FakeAdapter();
		await runTreeseedScene({ projectRoot: root, scene: 'capture-smoke', browserAdapter: adapter, mode: 'acceptance' });
		expect(adapter.launches[0]?.viewport).toEqual({ width: 1600, height: 900 });
		expect(adapter.launches[0]?.videoSize).toBeNull();
	});

	it('passes selected device profile settings into browser launch and run report', async () => {
		const root = workspace();
		writeScene(root, 'device-smoke', deviceScene());
		const desktop = new FakeAdapter();
		const desktopReport = await runTreeseedScene({ projectRoot: root, scene: 'device-smoke', browserAdapter: desktop, record: true, device: 'desktop' });
		expect(desktop.launches[0]?.viewport).toEqual({ width: 1600, height: 900 });
		expect(desktop.launches[0]?.videoSize).toEqual({ width: 1600, height: 900 });
		expect(desktopReport.device?.id).toBe('desktop');

		const tablet = new FakeAdapter();
		const tabletReport = await runTreeseedScene({ projectRoot: root, scene: 'device-smoke', browserAdapter: tablet, record: true, device: 'tablet' });
		expect(tablet.launches[0]?.viewport).toEqual({ width: 1024, height: 768 });
		expect(tablet.launches[0]?.videoSize).toEqual({ width: 1024, height: 768 });
		expect(tablet.launches[0]?.isMobile).toBe(true);
		expect(tablet.launches[0]?.hasTouch).toBe(true);
		expect(tabletReport.device?.id).toBe('tablet');

		const mobile = new FakeAdapter();
		const mobileReport = await runTreeseedScene({ projectRoot: root, scene: 'device-smoke', browserAdapter: mobile, record: true, device: 'mobile' });
		expect(mobile.launches[0]?.viewport).toEqual({ width: 390, height: 844 });
		expect(mobile.launches[0]?.videoSize).toEqual({ width: 390, height: 844 });
		expect(mobile.launches[0]?.deviceScaleFactor).toBe(2);
		expect(mobile.launches[0]?.isMobile).toBe(true);
		expect(mobile.launches[0]?.hasTouch).toBe(true);
		expect(mobileReport.device?.id).toBe('mobile');
	});

	it('runs a device matrix and writes matrix metadata', async () => {
		const root = workspace();
		writeScene(root, 'device-smoke', deviceScene());
		const report = await runTreeseedSceneDeviceMatrix({
			projectRoot: root,
			scene: 'device-smoke',
			devices: ['desktop', 'mobile'],
			record: true,
			timestamp: '20260616T120000Z',
			browserAdapter: new FakeAdapter(),
		});
		expect(report.ok).toBe(true);
		expect(report.devices).toEqual(['desktop', 'mobile']);
		expect(report.runReports.map((entry) => entry.device?.id)).toEqual(['desktop', 'mobile']);
		expect(report.matrixPath).toContain('.treeseed/scenes/matrix/device-smoke/20260616T120000Z-');
		expect(existsSync(report.matrixPath!)).toBe(true);
		expect(readFileSync(report.matrixPath!, 'utf8')).toContain('"devices"');
	});
});
