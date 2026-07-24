import { createServer, type Server } from 'node:http';

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { resolve } from 'node:path';

import { mkdtempSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import {
	planScene,
	runSceneDeviceMatrix,
	runScene,
	validateScene,
	type SceneBrowserAdapter,
	type SceneBrowserLaunchInput,
	type SceneBrowserSession,
	type SceneLocator,
	type ScenePage,
	type ScenePlugin,
} from '../../../../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-runner-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

const servers: Server[] = [];

afterEach(async () => {
	await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))));
});

async function listen(handler: Parameters<typeof createServer>[0]) {
	const server = createServer(handler);
	servers.push(server);
	return new Promise<string>((resolvePromise) => {
		server.listen(0, '127.0.0.1', () => {
			const address = server.address();
			if (!address || typeof address === 'string') throw new Error('Unexpected test server address.');
			resolvePromise(`http://127.0.0.1:${address.port}`);
		});
	});
}

function readBody(request: import('node:http').IncomingMessage) {
	return new Promise<string>((resolvePromise) => {
		let body = '';
		request.on('data', (chunk) => {
			body += String(chunk);
		});
		request.on('end', () => resolvePromise(body));
	});
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

class FakeLocator implements SceneLocator {
	constructor(private readonly selector: string, private readonly page: FakePage) {}
	first() {
		this.page.calls.push(`first:${this.selector}`);
		return this;
	}
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

class FakePage implements ScenePage {
	calls: string[] = [];
	cookies: unknown[] = [];
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
	context() {
		return {
			addCookies: async (cookies: unknown[]) => {
				this.cookies.push(...cookies);
			},
		};
	}
	async waitForLoadState() {
		this.calls.push('load-state');
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
	emitConsole(message: string, type = 'error') {
		for (const handler of this.handlers.console ?? []) handler({ type: () => type, text: () => message });
	}
	emitRequestFailed(url: string) {
		for (const handler of this.handlers.requestfailed ?? []) handler({ url: () => url, method: () => 'GET', failure: () => ({ errorText: 'failed' }) });
	}
	emitResponse(status: number, url: string, payload: unknown) {
		for (const handler of this.handlers.response ?? []) {
			handler({
				status: () => status,
				url: () => url,
				request: () => ({ method: () => 'POST' }),
				json: async () => payload,
			});
		}
	}
}

class FakeAdapter implements SceneBrowserAdapter {
	page = new FakePage();
	launches: SceneBrowserLaunchInput[] = [];
	async launch(input: SceneBrowserLaunchInput): Promise<SceneBrowserSession> {
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

class FailingAdapter implements SceneBrowserAdapter {
	constructor(private readonly error: unknown) {}
	async launch(): Promise<SceneBrowserSession> {
		throw this.error;
	}
}

function noScreenshotScene(extra = '') {
	return `schemaVersion: treeseed.scene/v1
id: no-screenshot-smoke
title: No Screenshot Smoke
target:
  app: market
  baseUrl: http://example.test
artifacts:
  trace: false
  screenshots: false
setup:
  seed:
    name: scene-seed
${extra}
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
`;
}
describe('scene Playwright runner foundation', () => {
it('passes selected device profile settings into browser launch and run report', async () => {
		const root = workspace();
		writeScene(root, 'device-smoke', deviceScene());
		const desktop = new FakeAdapter();
		const desktopReport = await runScene({ projectRoot: root, scene: 'device-smoke', browserAdapter: desktop, record: true, device: 'desktop' });
		expect(desktop.launches[0]?.viewport).toEqual({ width: 1600, height: 900 });
		expect(desktop.launches[0]?.videoSize).toEqual({ width: 1600, height: 900 });
		expect(desktopReport.device?.id).toBe('desktop');

		const tablet = new FakeAdapter();
		const tabletReport = await runScene({ projectRoot: root, scene: 'device-smoke', browserAdapter: tablet, record: true, device: 'tablet' });
		expect(tablet.launches[0]?.viewport).toEqual({ width: 1024, height: 768 });
		expect(tablet.launches[0]?.videoSize).toEqual({ width: 1024, height: 768 });
		expect(tablet.launches[0]?.isMobile).toBe(true);
		expect(tablet.launches[0]?.hasTouch).toBe(true);
		expect(tabletReport.device?.id).toBe('tablet');

		const mobile = new FakeAdapter();
		const mobileReport = await runScene({ projectRoot: root, scene: 'device-smoke', browserAdapter: mobile, record: true, device: 'mobile' });
		expect(mobile.launches[0]?.viewport).toEqual({ width: 390, height: 844 });
		expect(mobile.launches[0]?.videoSize).toEqual({ width: 390, height: 844 });
		expect(mobile.launches[0]?.deviceScaleFactor).toBe(2);
		expect(mobile.launches[0]?.isMobile).toBe(true);
		expect(mobile.launches[0]?.hasTouch).toBe(true);
		expect(mobileReport.device?.id).toBe('mobile');
	});
});
