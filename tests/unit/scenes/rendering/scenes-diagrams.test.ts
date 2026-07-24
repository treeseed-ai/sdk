import { describe, expect, it } from 'vitest';
import {
	buildSceneRenderDiagrams,
	createBuiltInScenePluginRegistry,
	validateSceneDiagrams,
	type SceneManifest,
	type SceneRunReport,
	type SceneTimelineEvent,
} from '../../../../src/scenes/index.ts';

function scene(diagrams: SceneManifest['diagrams']): SceneManifest {
	return {
		schemaVersion: 'treeseed.scene/v1',
		id: 'diagram-demo',
		title: 'Diagram Demo',
		audience: [],
		mode: { test: true, demo: false, training: false },
		target: { app: 'market', environment: 'local', baseUrl: 'http://example.test', browser: 'chromium', viewport: { width: 1440, height: 1000 } },
		setup: {},
		artifacts: { trace: true, video: false, screenshots: true, console: true, network: true, timeline: true, appLogs: true },
		workflow: [
			{ id: 'open', title: 'Open', action: { goto: '/' }, expect: { urlIncludes: 'example.test' } },
		],
		chapters: [{ id: 'intro', title: 'Intro', startsAt: 'open' }],
		overlays: [],
		diagrams,
		render: {},
		runtime: { mode: 'acceptance', timeouts: { sceneSeconds: null, chapterSeconds: null, stepSeconds: 120 }, checkpoints: { enabled: true, defaultResumable: false, everyStep: true }, progress: { heartbeatSeconds: 15 }, failure: { continueOnFailure: false } },
	};
}

const run = {
	ok: true,
	phase: 5,
	sceneId: 'diagram-demo',
	runId: 'run1',
	scenePath: 'scenes/diagram-demo.yaml',
	startedAt: '2026-06-15T00:00:00.000Z',
	finishedAt: '2026-06-15T00:00:02.000Z',
	durationMs: 2000,
	environment: 'local',
	baseUrl: 'http://example.test',
	browser: 'chromium',
	workflowStatus: 'passed',
	steps: [{ id: 'open', title: 'Open', actionKind: 'goto', startedAt: '', finishedAt: '', durationMs: 1, status: 'passed', retryCount: 0, assertionResults: [], screenshotPath: null, traceLocation: null, consoleErrors: [], networkErrors: [], operationIds: [] }],
	failedStep: null,
	assertions: [],
	artifacts: null,
	timelinePath: null,
	playwrightTracePath: null,
	videoPaths: [],
	renderedVideoPaths: [],
	logs: {},
	warnings: [],
	blockers: [],
	diagnostics: [],
	setup: { environment: null, auth: null, seed: null },
	operations: [],
	chapters: [{ id: 'intro', title: 'Intro', startedAt: '', finishedAt: '', durationMs: 1, status: 'passed', stepIds: ['open'], segmentIds: ['intro-segment-001'] }],
	segments: [{ id: 'intro-segment-001', chapterId: 'intro', startedAt: '', finishedAt: '', durationMs: 1, status: 'passed', stepIds: ['open'], timelinePath: 'segment-timeline.json', stepsPath: 'steps.json', segmentPath: 'segment.json', videoRefs: [] }],
	checkpoints: [{ id: 'open', sceneId: 'diagram-demo', runId: 'run1', stepId: 'open', chapterId: 'intro', segmentId: 'intro-segment-001', createdAt: '', resumable: true, completedStepIds: ['open'], nextStepId: null, artifactPaths: { checkpointPath: 'checkpoint.json', runRoot: '.', timelinePath: 'timeline.json', reportPath: 'report.md' } }],
	progressPath: null,
	resumedFrom: null,
} as SceneRunReport;

const timeline: SceneTimelineEvent[] = [
	{ id: '1', type: 'step.start', sceneId: 'diagram-demo', runId: 'run1', stepId: 'open', timestamp: '2026-06-15T00:00:00.000Z', offsetMs: 250, data: {} },
];

describe('scene diagram providers', () => {
	it('registers built-in diagram provider components', () => {
		const registry = createBuiltInScenePluginRegistry();
		expect(registry.diagrams.get('treeseed-remotion-diagrams')?.diagrams.OperationLifecycleDiagram.kind).toBe('operation-lifecycle');
		expect(registry.diagrams.get('treeseed-remotion-diagrams')?.diagrams.ReconciliationLifecycleDiagram.kind).toBe('reconciliation-lifecycle');
		expect(registry.diagrams.get('treeseed-remotion-diagrams')?.diagrams.DevRuntimeTopologyDiagram.kind).toBe('dev-runtime-topology');
		expect(registry.diagrams.get('treeseed-remotion-diagrams')?.diagrams.SceneExecutionTimelineDiagram.kind).toBe('scene-execution-timeline');
	});

	it('validates operation lifecycle props', () => {
		const valid = scene([{ id: 'op', renderer: 'remotion', at: 'open', component: 'OperationLifecycleDiagram', placement: 'interstitial', props: { states: ['queued', 'running'], activeState: 'running' } }]);
		expect(validateSceneDiagrams({ scene: valid }).filter((entry) => entry.severity === 'error')).toEqual([]);
		const missing = scene([{ id: 'op', renderer: 'remotion', at: 'open', component: 'OperationLifecycleDiagram', placement: 'interstitial', props: {} }]);
		expect(validateSceneDiagrams({ scene: missing }).some((entry) => entry.code === 'scene.diagram_invalid_props')).toBe(true);
		const invalidActive = scene([{ id: 'op', renderer: 'remotion', at: 'open', component: 'OperationLifecycleDiagram', placement: 'interstitial', props: { states: ['queued'], activeState: 'done' } }]);
		expect(validateSceneDiagrams({ scene: invalidActive }).some((entry) => entry.code === 'scene.diagram_invalid_props')).toBe(true);
	});

	it('normalizes reconciliation and scene timeline diagram props', () => {
		const registry = createBuiltInScenePluginRegistry();
		const current = scene([
			{ id: 'reconcile', renderer: 'remotion', at: 'open', component: 'ReconciliationLifecycleDiagram', placement: 'interstitial', props: {} },
			{ id: 'timeline', renderer: 'remotion', at: 'open', component: 'SceneExecutionTimelineDiagram', placement: 'standalone', props: {} },
		]);
		const report = buildSceneRenderDiagrams({ scene: current, run, timeline, registry });
		expect(report.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
		expect(report.diagrams.find((entry) => entry.component === 'ReconciliationLifecycleDiagram')?.props.stages).toEqual(['refresh', 'diff', 'plan', 'validate', 'apply', 'refresh', 'verify', 'persist']);
		expect(report.diagrams.find((entry) => entry.component === 'SceneExecutionTimelineDiagram')?.props.checkpoints).toHaveLength(1);
		expect(report.diagrams[0]?.startOffsetMs).toBe(250);
	});

	it('rejects invalid topology links and unknown components', () => {
		const invalidLink = scene([{ id: 'topology', renderer: 'remotion', at: 'open', component: 'DevRuntimeTopologyDiagram', placement: 'interstitial', props: { surfaces: [{ id: 'web' }], links: [{ from: 'web', to: 'api' }] } }]);
		expect(validateSceneDiagrams({ scene: invalidLink }).some((entry) => entry.code === 'scene.diagram_invalid_props')).toBe(true);
		const unknown = scene([{ id: 'missing', renderer: 'remotion', at: 'open', component: 'MissingDiagram', placement: 'interstitial', props: {} }]);
		expect(validateSceneDiagrams({ scene: unknown }).some((entry) => entry.code === 'scene.diagram_unknown_component')).toBe(true);
	});

	it('warns unknown props and rejects renderer mismatches', () => {
		const current = scene([{ id: 'op', renderer: 'other', at: 'open', component: 'OperationLifecycleDiagram', placement: 'interstitial', props: { states: ['queued'], extra: true } }]);
		const diagnostics = validateSceneDiagrams({ scene: current });
		expect(diagnostics.some((entry) => entry.code === 'scene.diagram_unknown_prop')).toBe(true);
		expect(diagnostics.some((entry) => entry.code === 'scene.diagram_renderer_mismatch')).toBe(true);
	});
});
