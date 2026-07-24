import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
	runScene,
	waitForSceneOperation,
	type SceneBrowserAdapter,
	type SceneBrowserLaunchInput,
	type SceneBrowserSession,
	type SceneEnvironmentPrepareReport,
	type SceneLocator,
	type ScenePage,
} from '../../../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-env-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function writeScene(root: string, name: string, source: string) {
	writeFileSync(resolve(root, 'scenes', `${name}.yaml`), source, 'utf8');
}

function sceneWithSetup(setup = '', workflow = '') {
	return `schemaVersion: treeseed.scene/v1
id: phase-three
title: Phase Three
target:
  app: market
  baseUrl: http://example.test
${setup}
workflow:
${workflow || `  - id: open
    title: Open
    action:
      goto: /
    expect:
      urlIncludes: example.test
`}
`;
}

function okEnvironment(partial: Partial<SceneEnvironmentPrepareReport> = {}): SceneEnvironmentPrepareReport {
	return {
		ok: true,
		environment: 'local',
		readiness: { ok: true },
		dev: { requested: false, reused: false, started: false, instances: [], baseUrl: null },
		diagnostics: [],
		...partial,
	};
}

class FakeLocator implements SceneLocator {
	async waitFor() {}
	async click() {}
	async fill() {}
	async isVisible() { return true; }
}

class FakePage implements ScenePage {
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

class FakeAdapter implements SceneBrowserAdapter {
	launches: SceneBrowserLaunchInput[] = [];
	async launch(input: SceneBrowserLaunchInput): Promise<SceneBrowserSession> {
		this.launches.push(input);
		return { page: new FakePage(), close: async () => {} };
	}
}

describe('scene Phase 3 environment integration', () => {
	it('does not request local dev when setup.dev.required is false', async () => {
		const root = workspace();
		writeScene(root, 'phase-three', sceneWithSetup());
		const adapter = new FakeAdapter();
		const report = await runScene({
			projectRoot: root,
			scene: 'phase-three',
			browserAdapter: adapter,
			environmentAdapter: async () => okEnvironment(),
		});
		expect(report.ok).toBe(true);
		expect(report.setup?.environment?.dev.requested).toBe(false);
		expect(adapter.launches.length).toBe(1);
	});

	it('reports reused and started dev setup from the SDK environment adapter', async () => {
		const root = workspace();
		writeScene(root, 'phase-three', sceneWithSetup(`setup:
  dev:
    required: true
    command: trsd dev start --web-runtime local --json
    reuseExisting: true
`));
		const reused = await runScene({
			projectRoot: root,
			scene: 'phase-three',
			browserAdapter: new FakeAdapter(),
			environmentAdapter: async () => okEnvironment({ dev: { requested: true, reused: true, started: false, instances: [{ id: 'web' }], baseUrl: 'http://127.0.0.1:4321' } }),
		});
		expect(reused.setup?.environment?.dev.reused).toBe(true);
		expect(reused.baseUrl).toBe('http://example.test');

		const started = await runScene({
			projectRoot: root,
			scene: 'phase-three',
			browserAdapter: new FakeAdapter(),
			environmentAdapter: async () => okEnvironment({ dev: { requested: true, reused: false, started: true, instances: [{ id: 'web' }], baseUrl: 'http://127.0.0.1:4322' } }),
		});
		expect(started.setup?.environment?.dev.started).toBe(true);
	});

	it('blocks setup failures before launching the browser', async () => {
		const root = workspace();
		writeScene(root, 'phase-three', sceneWithSetup());
		const adapter = new FakeAdapter();
		const report = await runScene({
			projectRoot: root,
			scene: 'phase-three',
			browserAdapter: adapter,
			environmentAdapter: async () => okEnvironment({
				ok: false,
				diagnostics: [{ severity: 'error', code: 'scene.readiness_failed', message: 'readiness failed', path: 'setup.readiness' }],
			}),
		});
		expect(report.workflowStatus).toBe('blocked');
		expect(adapter.launches).toEqual([]);
		expect(existsSync(report.artifacts!.runPath)).toBe(true);
		expect(existsSync(report.artifacts!.setupPath!)).toBe(true);
	});

	it('blocks required auth and seed failures before browser launch', async () => {
		const root = workspace();
		writeScene(root, 'phase-three', sceneWithSetup(`setup:
  auth:
    profile: local
    required: true
  seed:
    name: treeseed
    apply: true
`));
		const adapter = new FakeAdapter();
		const report = await runScene({
			projectRoot: root,
			scene: 'phase-three',
			browserAdapter: adapter,
			environmentAdapter: async () => okEnvironment(),
			authResolver: () => ({ ok: false, required: true, profileId: 'local', authRoot: root, hasSession: false, diagnostics: [{ severity: 'error', code: 'scene.auth_required', message: 'missing', path: 'setup.auth' }] }),
			seedRunner: async () => ({ ok: false, requested: true, seedName: 'treeseed', mode: 'apply', environments: ['local'], plan: null, result: null, diagnostics: [{ severity: 'error', code: 'scene.seed_apply_failed', message: 'failed', path: 'setup.seed' }] }),
		});
		expect(report.workflowStatus).toBe('blocked');
		expect(report.diagnostics.map((entry) => entry.code)).toContain('scene.auth_required');
		expect(report.diagnostics.map((entry) => entry.code)).toContain('scene.seed_apply_failed');
		expect(adapter.launches).toEqual([]);
	});

	it('waits for explicit operations and fails timeout or failed statuses', async () => {
		const passed = await waitForSceneOperation({
			projectRoot: workspace(),
			scene: {} as any,
			environment: 'local',
			baseUrl: 'http://example.test',
			spec: { id: 'op_1', kind: 'project.web_deployment', status: ['completed'], pollIntervalSeconds: 0.001, timeoutSeconds: 1 },
			fetchOperation: async () => ({ operation: { id: 'op_1', kind: 'project.web_deployment', status: 'completed' } }),
			sleep: async () => {},
		});
		expect(passed.ok).toBe(true);
		expect(passed.operationId).toBe('op_1');

		const failed = await waitForSceneOperation({
			projectRoot: workspace(),
			scene: {} as any,
			environment: 'local',
			baseUrl: 'http://example.test',
			spec: { id: 'op_2', status: ['completed'], pollIntervalSeconds: 0.001, timeoutSeconds: 1 },
			fetchOperation: async () => ({ operation: { id: 'op_2', status: 'failed' } }),
			sleep: async () => {},
		});
		expect(failed.ok).toBe(false);
		expect(failed.diagnostics[0]?.code).toBe('scene.operation_failed');
	});

	it('runs operation actions and assertions through linked operation ids', async () => {
		const root = workspace();
		writeScene(root, 'phase-three', sceneWithSetup('', `  - id: wait
    title: Wait
    action:
      waitForOperation:
        status:
          - completed
    expect:
      operation:
        kind: project.web_deployment
        status:
          - completed
`));
		const report = await runScene({
			projectRoot: root,
			scene: 'phase-three',
			browserAdapter: new FakeAdapter(),
			environmentAdapter: async () => okEnvironment(),
			operationWaiter: async (input) => ({
				ok: true,
				operationId: input.linkedOperationIds?.at(-1) ?? 'op_linked',
				kind: input.spec.kind ?? 'project.web_deployment',
				finalStatus: 'completed',
				acceptedStatuses: input.spec.status,
				events: [],
				durationMs: 1,
				diagnostics: [],
			}),
		});
		expect(report.ok).toBe(true);
		expect(report.operations.length).toBe(2);
		expect(report.steps[0]?.operationIds).toContain('op_linked');
	});

	it('collects log paths without failing the run', async () => {
		const root = workspace();
		writeScene(root, 'phase-three', sceneWithSetup());
		const report = await runScene({
			projectRoot: root,
			scene: 'phase-three',
			browserAdapter: new FakeAdapter(),
			environmentAdapter: async () => okEnvironment(),
			logCollector: (input) => {
				writeFileSync(input.artifacts.devLogPath!, 'dev log\n', 'utf8');
				return { ok: true, logs: { dev: input.artifacts.devLogPath!, api: input.artifacts.apiLogPath!, operationsRunner: input.artifacts.operationsRunnerLogPath! }, diagnostics: [] };
			},
		});
		expect(report.ok).toBe(true);
		expect(report.logs.dev).toContain('dev.jsonl');
		expect(existsSync(report.logs.dev!)).toBe(true);
	});
});
