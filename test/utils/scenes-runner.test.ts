import { createServer, type Server } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
	planTreeseedScene,
	runTreeseedSceneDeviceMatrix,
	runTreeseedScene,
	validateTreeseedScene,
	type TreeseedSceneBrowserAdapter,
	type TreeseedSceneBrowserLaunchInput,
	type TreeseedSceneBrowserSession,
	type TreeseedSceneLocator,
	type TreeseedScenePage,
	type TreeseedScenePlugin,
} from '../../src/scenes/index.ts';

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

class FakeLocator implements TreeseedSceneLocator {
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

class FakePage implements TreeseedScenePage {
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

class FailingAdapter implements TreeseedSceneBrowserAdapter {
	constructor(private readonly error: unknown) {}
	async launch(): Promise<TreeseedSceneBrowserSession> {
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
		expect(report.ok, JSON.stringify(report.diagnostics, null, 2)).toBe(true);
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
			adapter.page.emitConsole('ignored warning', 'warning');
			adapter.page.emitConsole('boom');
			adapter.page.emitRequestFailed('http://example.test/api');
			adapter.page.emitResponse(202, 'http://example.test/v1/operations', { payload: { operation: { id: 'op_123' } } });
			adapter.page.emitResponse(500, 'http://example.test/v1/fail', { ok: false });
			await Promise.resolve();
		};
		const report = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: adapter });
		expect(report.ok, JSON.stringify(report.diagnostics, null, 2)).toBe(true);
		expect(report.steps[0]?.consoleErrors[0]?.message).toBe('boom');
		expect(report.steps[0]?.networkErrors[0]?.url).toBe('http://example.test/api');
		expect(report.steps[0]?.operationIds).toContain('op_123');
		expect(readFileSync(report.artifacts!.consoleLogPath!, 'utf8')).toContain('boom');
		expect(readFileSync(report.artifacts!.networkLogPath!, 'utf8')).toContain('example.test/api');
		expect(readFileSync(report.artifacts!.networkLogPath!, 'utf8')).toContain('HTTP 500');
	});

	it('captures pre-step adapter events, missing request details, and screenshot failures', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const page = new FakePage();
		page.screenshot = async () => { throw new Error('capture unavailable'); };
		const adapter: TreeseedSceneBrowserAdapter = {
			async launch() {
				return {
					page,
					startTracing: async () => {
						page.emitConsole('before first step');
						for (const handler of page.handlers.requestfailed ?? []) handler({ url: () => 'http://example.test/preflight', method: () => 'GET', failure: () => null });
						page.emitResponse(500, 'http://example.test/preflight-response', { operationId: 'op-preflight' });
						page.emitResponse(202, 'http://example.test/duplicate-operation', { operationId: 'op-preflight' });
						await Promise.resolve();
					},
					stopTracing: async (tracePath: string) => writeFileSync(tracePath, 'trace', 'utf8'),
					videoPaths: async () => [],
					close: async () => undefined,
				};
			},
		};
		const report = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: adapter });
		expect(report.ok).toBe(true);
		expect(report.steps.every((entry) => entry.screenshotPath && !existsSync(entry.screenshotPath))).toBe(true);
		expect(readFileSync(report.artifacts!.consoleLogPath!, 'utf8')).toContain('before first step');
		expect(readFileSync(report.artifacts!.networkLogPath!, 'utf8')).toContain('request failed');
		expect(report.steps[0]?.operationIds).toEqual(['op-preflight']);
	});

	it('reports unknown normalized actions without parser mediation', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const normalized = validateTreeseedScene({ projectRoot: root, scene: 'browser-smoke' }).scene!;
		const unknownAction = {
			...normalized,
			workflow: [{ ...normalized.workflow[0]!, action: { unknownAction: {} } as never }],
		};
		const actionReport = await runTreeseedScene({ projectRoot: root, scene: unknownAction, browserAdapter: new FakeAdapter() });
		expect(actionReport.diagnostics.some((entry) => entry.code === 'scene.unknown_runtime_action')).toBe(true);
	});

	it('handles empty action diagnostics and linked operation reports', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const normalized = validateTreeseedScene({ projectRoot: root, scene: 'browser-smoke' }).scene!;
		const plugin: TreeseedScenePlugin = {
			id: 'test.runtime-branches', version: '1.0.0', phase: 4, status: 'available', summary: 'Runtime branch handlers.',
			actions: {
				emptyFailure: { id: 'emptyFailure', phase: 4, status: 'available', summary: 'Fails without diagnostics.', async run() { return { ok: false, diagnostics: [] }; } },
				linkedAction: { id: 'linkedAction', phase: 4, status: 'available', summary: 'Links an operation.', async run() { return { ok: true, operationReport: { ok: true, operationId: 'op-linked', finalStatus: 'completed', diagnostics: [] } as never, diagnostics: [] }; } },
			},
		};
		const failed = await runTreeseedScene({
			projectRoot: root,
			scene: { ...normalized, workflow: [{ ...normalized.workflow[0]!, action: { emptyFailure: {} } as never }] },
			browserAdapter: new FakeAdapter(), plugins: [plugin],
		});
		expect(failed.diagnostics.some((entry) => entry.code === 'scene.step_failed')).toBe(true);

		const linked = await runTreeseedScene({
			projectRoot: root,
			scene: { ...normalized, workflow: [{ ...normalized.workflow[0]!, action: { linkedAction: {} } as never, expect: undefined }] },
			browserAdapter: new FakeAdapter(), plugins: [plugin],
		});
		expect(linked.steps[0]?.operationIds).toContain('op-linked');
		expect(linked.ok).toBe(true);
	});

	it('uses capture fallbacks and continues demo execution after non-Error action failures', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const normalized = validateTreeseedScene({ projectRoot: root, scene: 'browser-smoke' }).scene!;
		const plugin: TreeseedScenePlugin = {
			id: 'test.failure-branches', version: '1.0.0', phase: 4, status: 'available', summary: 'Failure branch handlers.',
			actions: {
				stringFailure: { id: 'stringFailure', phase: 4, status: 'available', summary: 'Throws a string.', async run() { throw 'string action failure'; } },
			},
		};
		const scene = {
			...normalized,
			devices: { defaultProfile: 'empty', profiles: [{ id: 'empty' } as never] },
			render: { remotion: {} },
			runtime: { ...normalized.runtime, mode: 'demo' as const, checkpoints: { ...normalized.runtime.checkpoints, enabled: false, everyStep: false } },
			workflow: [
				{ ...normalized.workflow[0]!, id: 'failure-one', action: { stringFailure: {} } as never, expect: undefined },
				{ ...normalized.workflow[0]!, id: 'failure-two', action: { stringFailure: {} } as never, expect: undefined },
				{ ...normalized.workflow[0]!, id: 'timed-pause', action: { pause: { mode: 'timed', durationSeconds: 0.001 } } as never, expect: undefined, demoOnly: true },
			],
		};
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({ projectRoot: root, scene, browserAdapter: adapter, record: true });
		expect(report.failedStep).toBe('failure-one');
		expect(report.steps).toHaveLength(3);
		expect(report.steps.slice(0, 2).map((entry) => entry.status)).toEqual(['failed', 'failed']);
		expect(adapter.launches[0]?.viewport).toEqual({ width: 1600, height: 900 });
		expect(adapter.launches[0]?.videoSize).toEqual({ width: 1600, height: 900 });
		expect(report.capture?.renderResolution).toBeNull();
		expect(report.checkpoints).toEqual([]);
	});

	it('sets up and signs in an authenticated visual-audit role before executing the workflow', async () => {
		const requests: Array<{ url: string; body: string }> = [];
		const baseUrl = await listen(async (request, response) => {
			const body = await readBody(request);
			requests.push({ url: request.url ?? '/', body });
			response.setHeader('content-type', 'application/json');
			if (request.url === '/v1/acceptance/seed') {
				response.end(JSON.stringify({ ok: true }));
				return;
			}
			if (request.url === '/v1/auth/web/sign-in') {
				response.end(JSON.stringify({ ok: true, payload: { accessToken: 'runner-token', expiresInSeconds: 120 } }));
				return;
			}
			response.statusCode = 404;
			response.end(JSON.stringify({ ok: false }));
		});
		const root = workspace();
		writeFileSync(resolve(root, 'treeseed.site.yaml'), `schemaVersion: treeseed.site/v1
name: Runner Web Test
slug: runner-web-test
siteUrl: ${baseUrl}
contactEmail: ops@example.test
surfaces:
  web:
    environments:
      staging:
        baseUrl: ${baseUrl}
`);
		mkdirSync(resolve(root, 'packages/api'), { recursive: true });
		writeFileSync(resolve(root, 'packages/api/treeseed.site.yaml'), `schemaVersion: treeseed.site/v1
name: Runner API Test
slug: runner-api-test
siteUrl: ${baseUrl}
contactEmail: ops@example.test
services:
  api:
    environments:
      staging:
        baseUrl: ${baseUrl}
`);
		writeScene(root, 'auth-smoke', `schemaVersion: treeseed.scene/v1
id: auth-smoke
title: Auth Smoke
target:
  app: market
  baseUrl: ${baseUrl}
workflow:
  - id: open-app
    title: Open app
    action:
      goto: /app/projects
    expect:
      urlIncludes: /app/projects
`);
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({
			projectRoot: root,
			scene: 'auth-smoke',
			environment: 'staging',
			browserAdapter: adapter,
			authRole: 'owner',
			environmentAdapter: async () => ({ ok: true, environment: 'staging', readiness: null, dev: { requested: false, reused: false, started: false, instances: [], baseUrl: null }, diagnostics: [] }),
		});
		expect(report.ok, JSON.stringify(report.diagnostics, null, 2)).toBe(true);
		expect(adapter.page.cookies).toHaveLength(1);
		expect(adapter.page.cookies[0]).toMatchObject({ name: 'ts_market_api_access', value: 'runner-token' });
		expect(requests.map((entry) => entry.url)).toEqual(expect.arrayContaining(['/v1/acceptance/seed', '/v1/auth/web/sign-in']));
		expect(requests.find((entry) => entry.url === '/v1/acceptance/seed')?.body).toContain('visual.owner@treeseed.io');
		expect(adapter.page.calls).toContain(`goto:${baseUrl}/app/`);
		expect(adapter.page.calls).toContain(`goto:${baseUrl}/app/projects`);
	});

	it('blocks invalid selected device before launching a browser', async () => {
		const root = workspace();
		writeScene(root, 'device-smoke', deviceScene());
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({ projectRoot: root, scene: 'device-smoke', browserAdapter: adapter, device: 'watch' as never });
		expect(report.workflowStatus).toBe('blocked');
		expect(report.diagnostics.some((entry) => entry.code === 'scene.device_unknown')).toBe(true);
		expect(adapter.launches).toEqual([]);
	});

	it('reports browser launch failures with Playwright remediation diagnostics', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const error = new Error('browser executable is missing');
		Object.assign(error, { treeseedSceneCode: 'scene.playwright_browser_missing' });
		const report = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: new FailingAdapter(error) });
		expect(report.workflowStatus).toBe('blocked');
		expect(report.diagnostics.some((entry) => entry.code === 'scene.playwright_browser_missing' && entry.message.includes('playwright install chromium'))).toBe(true);
	});

	it('reports non-Error browser launch failures and suppresses close failures', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const launchReport = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: new FailingAdapter('adapter offline') });
		expect(launchReport.workflowStatus).toBe('blocked');
		expect(launchReport.diagnostics.some((entry) => entry.code === 'scene.playwright_unavailable' && entry.message.includes('adapter offline'))).toBe(true);
		const nullLaunchReport = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: new FailingAdapter(null) });
		expect(nullLaunchReport.diagnostics.some((entry) => entry.message.includes('Playwright unavailable.'))).toBe(true);

		const closeAdapter: TreeseedSceneBrowserAdapter = {
			async launch(input) {
				return {
					page: new FakePage(),
					startTracing: async () => undefined,
					stopTracing: async (tracePath: string) => writeFileSync(tracePath, 'trace', 'utf8'),
					videoPaths: async () => input.recordVideoDir ? [resolve(input.recordVideoDir, 'close-video.webm')] : [],
					close: async () => { throw new Error('close failed'); },
				};
			},
		};
		const closeReport = await runTreeseedScene({ projectRoot: root, scene: 'browser-smoke', browserAdapter: closeAdapter, record: true });
		expect(closeReport.ok).toBe(true);
		expect(closeReport.videoPaths.some((entry) => entry.endsWith('close-video.webm'))).toBe(true);
	});

	it('runs normalized scene input with anonymous auth override, planned seed setup, and disabled screenshots', async () => {
		const root = workspace();
		writeScene(root, 'no-screenshot-smoke', noScreenshotScene());
		const validation = validateTreeseedScene({ projectRoot: root, scene: 'no-screenshot-smoke' });
		expect(validation.ok).toBe(true);
		const adapter = new FakeAdapter();
		const seedCalls: string[] = [];
		const report = await runTreeseedScene({
			projectRoot: root,
			scene: validation.scene!,
			browserAdapter: adapter,
			authRole: 'anonymous',
			timestamp: '20260617T120000Z',
			runId: 'direct',
			seedRunner: async ({ scene }) => {
				seedCalls.push(scene.setup.seed?.apply ? 'apply' : scene.setup.seed?.name ? 'plan' : 'none');
				return { ok: true, requested: true, seedName: scene.setup.seed?.name ?? null, mode: 'plan', environments: ['local'], plan: {}, result: null, diagnostics: [] };
			},
			environmentAdapter: async () => ({ ok: true, environment: 'local', readiness: null, dev: { requested: false, reused: false, started: false, instances: [], baseUrl: null }, diagnostics: [] }),
			authResolver: () => ({ ok: true, required: false, profileId: 'local', authRoot: root, hasSession: false, diagnostics: [] }),
			logCollector: () => ({ diagnostics: [], logs: { dev: null, api: null, operationsRunner: null } }),
		});
		expect(report.ok).toBe(true);
		expect(report.scenePath).toBe('<normalized-scene>');
		expect(seedCalls).toEqual(['plan']);
		expect(adapter.page.calls.some((entry) => entry.startsWith('screenshot:'))).toBe(false);
		expect(report.steps[0]?.screenshotPath).toBeNull();
		expect(report.steps[0]?.viewportScreenshotPath).toBeNull();
		expect(report.playwrightTracePath).toBeNull();
		expect(adapter.launches[0]?.recordVideoDir).toBeNull();
	});

	it('records apply seed mode and blocks invalid explicit plugin plans before launch', async () => {
		const root = workspace();
		writeScene(root, 'apply-seed-smoke', noScreenshotScene(`    apply: true
`));
		const seedModes: string[] = [];
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({
			projectRoot: root,
			scene: 'apply-seed-smoke',
			browserAdapter: adapter,
			seedRunner: async ({ scene }) => {
				seedModes.push(scene.setup.seed?.apply ? 'apply' : 'plan');
				return { ok: true, requested: true, seedName: scene.setup.seed?.name ?? null, mode: 'apply', environments: ['local'], plan: {}, result: {}, diagnostics: [] };
			},
		});
		expect(report.ok).toBe(true);
		expect(seedModes).toEqual(['apply']);

		const invalidPlugin = { id: '', version: '', phase: 4, status: 'available', summary: '' } as TreeseedScenePlugin;
		const blocked = await runTreeseedScene({
			projectRoot: root,
			scene: 'apply-seed-smoke',
			browserAdapter: new FakeAdapter(),
			plugins: [invalidPlugin],
		});
		expect(blocked.workflowStatus).toBe('blocked');
		expect(blocked.diagnostics.some((entry) => entry.code === 'scene.plugin_invalid')).toBe(true);
	});

	it('records unnamed apply seeds and blocks unknown authenticated roles after launch', async () => {
		const root = workspace();
		writeScene(root, 'browser-smoke', executableScene());
		const normalized = validateTreeseedScene({ projectRoot: root, scene: 'browser-smoke' }).scene!;
		const seedNames: Array<string | null> = [];
		const unnamedSeed = await runTreeseedScene({
			projectRoot: root,
			scene: { ...normalized, setup: { ...normalized.setup, seed: { apply: true } as never } },
			browserAdapter: new FakeAdapter(),
			seedRunner: async ({ scene }) => {
				seedNames.push(scene.setup.seed?.name ?? null);
				return { ok: true, requested: true, seedName: null, mode: 'apply', environments: ['local'], plan: {}, result: {}, diagnostics: [] };
			},
		});
		expect(unnamedSeed.ok).toBe(true);
		expect(seedNames).toEqual([null]);

		const unknownRole = await runTreeseedScene({
			projectRoot: root,
			scene: { ...normalized, setup: { ...normalized.setup, auth: { role: 'unknown-role', required: true } as never } },
			browserAdapter: new FakeAdapter(),
		});
		expect(unknownRole.diagnostics.map((entry) => entry.code)).toContain('scene.visual_audit_role_unknown');
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

	it('reports deferred runtime actions and stops non-continuable workflows at the failed step', async () => {
		const root = workspace();
		writeScene(root, 'deferred-action', `schemaVersion: treeseed.scene/v1
id: deferred-action
title: Deferred Action
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: request-api
    title: Request API
    action:
      apiRequest:
        method: POST
        path: /v1/projects
    expect:
      text: Created
  - id: should-not-run
    title: Should not run
    action:
      goto: /after
    expect:
      text: After
`);
		const adapter = new FakeAdapter();
		const report = await runTreeseedScene({ projectRoot: root, scene: 'deferred-action', browserAdapter: adapter });
		expect(report.ok).toBe(false);
		expect(report.failedStep).toBe('request-api');
		expect(report.steps.map((step) => step.id)).toEqual(['request-api']);
		expect(report.diagnostics.some((entry) => entry.code === 'scene.unsupported_runtime_action')).toBe(true);
		expect(adapter.page.calls).not.toContain('goto:http://example.test/after');
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

	it('writes chapters, resumable checkpoints, and segment artifacts across chapter changes', async () => {
		const root = workspace();
		writeScene(root, 'chapter-checkpoints', `schemaVersion: treeseed.scene/v1
id: chapter-checkpoints
title: Chapter Checkpoints
runtime:
  checkpoints:
    enabled: true
    everyStep: true
    defaultResumable: true
target:
  app: market
  baseUrl: http://example.test
workflow:
  - id: open
    title: Open
    checkpoint:
      id: open-ready
      resumable: true
    action:
      goto: /
    expect:
      urlIncludes: example.test
  - id: click
    title: Click
    action:
      click:
        role: button
        name: Continue
    expect:
      text: Continue
  - id: finish
    title: Finish
    checkpoint:
      resumable: false
    action:
      keyboard: Enter
    expect:
      text: Done
chapters:
  - id: intro
    title: Intro
    startsAt: open
  - id: finish
    title: Finish
    startsAt: finish
`);
		const report = await runTreeseedScene({
			projectRoot: root,
			scene: 'chapter-checkpoints',
			browserAdapter: new FakeAdapter(),
			timestamp: '20260618T120000Z',
			runId: 'chapters',
		});
		expect(report.ok).toBe(true);
		expect(report.chapters.map((chapter) => [chapter.id, chapter.status, chapter.stepIds])).toEqual([
			['intro', 'passed', ['open', 'click']],
			['finish', 'passed', ['finish']],
		]);
		expect(report.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint.resumable])).toEqual([
			['open-ready', true],
			['click', true],
			['finish', false],
		]);
		expect(report.segments.length).toBeGreaterThanOrEqual(4);
		for (const segment of report.segments) {
			expect(existsSync(segment.segmentPath)).toBe(true);
			expect(existsSync(segment.stepsPath)).toBe(true);
			expect(existsSync(segment.timelinePath)).toBe(true);
		}
		expect(readFileSync(report.artifacts!.timelinePath, 'utf8')).toContain('checkpoint.write');
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

	it('blocks invalid device matrix input and defaults to all scene device profiles', async () => {
		const root = workspace();
		writeScene(root, 'device-smoke', deviceScene());
		const defaultMatrix = await runTreeseedSceneDeviceMatrix({
			projectRoot: root,
			scene: 'device-smoke',
			browserAdapter: new FakeAdapter(),
		});
		expect(defaultMatrix.ok).toBe(true);
		expect(defaultMatrix.devices).toEqual(['desktop', 'tablet', 'mobile']);

		const invalidDevice = await runTreeseedSceneDeviceMatrix({
			projectRoot: root,
			scene: 'device-smoke',
			devices: ['watch' as never],
			browserAdapter: new FakeAdapter(),
		});
		expect(invalidDevice.ok).toBe(false);
		expect(invalidDevice.blockers.some((entry) => entry.code === 'scene.device_unknown')).toBe(true);

		writeScene(root, 'bad', 'schemaVersion: [');
		const invalidScene = await runTreeseedSceneDeviceMatrix({
			projectRoot: root,
			scene: 'bad',
			browserAdapter: new FakeAdapter(),
		});
		expect(invalidScene.ok).toBe(false);
		expect(invalidScene.diagnostics.some((entry) => entry.code === 'scene.yaml_parse_error')).toBe(true);
	});
});
