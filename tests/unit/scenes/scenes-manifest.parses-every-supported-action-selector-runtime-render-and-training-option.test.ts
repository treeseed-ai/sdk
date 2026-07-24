import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	loadTreeseedSceneDocument,
	parseTreeseedSceneManifest,
	planTreeseedScene,
	resolveTreeseedSceneBaseUrl,
	resolveTreeseedScenePath,
	validateTreeseedScene,
} from '../../../src/scenes/index.ts';

function workspace() {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-scenes-'));
	mkdirSync(resolve(root, 'scenes'), { recursive: true });
	return root;
}

function validSceneYaml(extra = '') {
	return `schemaVersion: treeseed.scene/v1
id: market-project-deploy-demo
title: Market Project Deployment Demo
description: Guided workflow proving project deployment.
audience:
  - operator
target:
  app: market
workflow:
  - id: open-projects
    title: Open projects
    action:
      goto: /app/projects
    expect:
      visible:
        - scene: projects.index
  - id: open-deploy
    title: Open deploy panel
    action:
      click:
        role: tab
        name: Deploy
    expect:
      text: Staging
chapters:
  - id: context
    title: Project context
    startsAt: open-projects
${extra}`;
}

function writeScene(root: string, name: string, source: string) {
	const path = resolve(root, 'scenes', `${name}.yaml`);
	writeFileSync(path, source, 'utf8');
	return path;
}
describe('scene manifest foundation', () => {
it('parses every supported action, selector, runtime, render, and training option', () => {
		const diagnostics: Array<{ code: string }> = [];
		const scene = parseTreeseedSceneManifest({
			schemaVersion: 'treeseed.scene/v1',
			id: 'complete-contract',
			title: 'Complete Contract',
			description: 'Exercises the complete scene contract.',
			audience: ['operator'],
			journey: {
				kind: 'page',
				proves: ['navigation'],
				minimumSteps: 2,
				requiresInteractiveAction: true,
				producesState: [{ key: 'project', kind: 'created' }],
				consumesState: [{ key: 'account', kind: 'existing' }],
			},
			mode: { test: false, demo: true, training: true },
			target: {
				app: 'market',
				environment: 'staging',
				baseUrl: 'https://preview.example.test',
				browser: 'firefox',
				viewport: { width: 1280, height: 720 },
			},
			devices: {
				defaultProfile: 'mobile',
				profiles: [{
					id: 'mobile', title: 'Mobile', orientation: 'portrait',
					viewport: { width: 390, height: 844 }, video: { width: 390, height: 844 }, output: { width: 1080, height: 1920 },
					userAgent: 'Treeseed Test', deviceScaleFactor: 2, isMobile: true, hasTouch: true,
					browserFrame: { chrome: 'mobile' },
				}],
			},
			setup: { auth: { role: 'owner', required: true }, seed: { name: 'complete', mode: 'apply' } },
			workflow: [
				{ id: 'goto', title: 'Go', action: { goto: '/app' }, expect: { urlIncludes: '/app' }, checkpoint: { id: 'goto-checkpoint', resumable: true } },
				{ id: 'keyboard', title: 'Keyboard', action: { keyboard: 'Enter' }, expect: { text: 'Ready' } },
				{ id: 'api', title: 'API', action: { apiRequest: { method: 'POST', path: '/v1/projects' } }, expect: { text: 'Created' } },
				{ id: 'operation', title: 'Operation', action: { waitForOperation: { id: 'op-1', kind: 'deploy', status: ['completed'], timeoutSeconds: 30, pollIntervalSeconds: 1, source: 'explicit' } }, expect: { operation: { id: 'op-1', kind: 'deploy', status: ['completed'], timeoutSeconds: 30, pollIntervalSeconds: 1, source: 'explicit' } } },
				{ id: 'pause', title: 'Pause', demoOnly: true, action: { pause: { mode: 'manual', prompt: 'Continue' } } },
				{ id: 'mail', title: 'Mail', action: { mailpitConfirmLatest: { mailpitUrl: 'http://localhost:8025', email: 'owner@example.test', subjectIncludes: 'Confirm', displayInboxSeconds: 1, displayMessageSeconds: 1 } }, expect: { text: 'Confirmed' } },
				{ id: 'click-scene', title: 'Click scene', action: { click: { scene: 'project.save' } }, expect: { visible: [{ scene: 'project.saved' }, { testId: 'saved' }, { role: 'status', name: 'Saved' }, { text: 'Saved' }, { css: '.saved', internal: true }] } },
				{ id: 'click-test', title: 'Click test', action: { click: { testId: 'submit' } }, expect: { text: 'Submitted' } },
				{ id: 'select', title: 'Select', action: { select: { role: 'combobox', name: 'Role', value: 'owner', label: 'Owner' } } },
				{ id: 'fill', title: 'Fill', action: { fill: { role: 'textbox', name: 'Name', value: 'TreeSeed' } } },
			],
			chapters: [{ id: 'main', title: 'Main', startsAt: 'goto' }],
			overlays: [{
				id: 'callout', at: 'goto', renderer: 'remotion', type: 'callout', text: 'Hello', anchor: { testId: 'saved' }, variant: 'panel', region: 'top-right',
				position: { x: 10, y: 20, unit: 'percent' }, size: { width: 30, height: 20, unit: 'percent' },
				style: { tone: 'brand', opacity: 0.8, borderColor: '#fff', borderWidth: 1, radius: 2, shadow: 'medium' },
				motion: { loop: true, keyframes: [{ at: 0, unit: 'progress', position: { x: 0, y: 0 }, size: { width: 10, height: 10 }, opacity: 0, scale: 1, rotateDeg: 0, easing: 'linear' }] },
				objects: [{ id: 'box', type: 'box', text: 'Box', position: { x: 1, y: 2 }, size: { width: 3, height: 4 }, style: { tone: 'neutral' } }], durationSeconds: 2,
			}],
			diagrams: [{ id: 'diagram', at: 'goto', renderer: 'remotion', component: 'OperationLifecycleDiagram', durationSeconds: 2, placement: 'interstitial', props: { states: ['ready'] }, objects: [], style: { tone: 'neutral' } }],
			render: { remotion: { composition: 'training', output: { format: 'mp4', fps: 30, resolution: { width: 1920, height: 1080 } }, capture: { viewport: { width: 1600, height: 900 }, video: { width: 1280, height: 720 }, evidenceFit: 'fixed-browser' }, browserFrame: { enabled: true, title: 'TreeSeed' } } },
			runtime: { mode: 'training', timeouts: { sceneSeconds: null, chapterSeconds: 60, stepSeconds: 10 }, checkpoints: { enabled: true, defaultResumable: true, everyStep: false }, progress: { heartbeatSeconds: 5 }, failure: { continueOnFailure: true } },
			training: { enabled: true, captions: { enabled: true, formats: ['vtt'], maxCueSeconds: 4, renderInTrainingVideo: false }, transcript: { enabled: true, formats: ['markdown'] }, narration: { enabled: true, style: 'concise', includeDiagnostics: false }, glossary: { enabled: true, terms: [{ term: 'Project', definition: 'A project', sourceStep: 'goto', tags: ['core'] }] }, chapterClips: { enabled: true, format: 'manifest' } },
			visualAudit: { enabled: true, roles: ['owner'], pathRoots: ['/app'], pathGlobs: ['/app/**'], excludePathGlobs: ['/app/private/**'], includeFullPage: true, review: { enabled: true, detail: 'full', maxFindings: 10, contactSheets: false }, routeDiscovery: { core: false, admin: true, tenantOverrides: false, contentCollections: true } },
		}, diagnostics as never);

		expect(diagnostics).toEqual([]);
		expect(scene?.workflow).toHaveLength(10);
		expect(scene?.render.remotion?.output?.resolution).toEqual({ width: 1920, height: 1080 });
		expect(scene?.training.glossary.terms[0]).toMatchObject({ term: 'Project', sourceStep: 'goto', tags: ['core'] });
	});

it('normalizes malformed optional object and array shapes without throwing', () => {
		const diagnostics: Array<{ code: string }> = [];
		const scene = parseTreeseedSceneManifest({
			schemaVersion: 'treeseed.scene/v1', id: 'shape-fallbacks', title: 'Shape Fallbacks',
			journey: [], mode: [], target: { app: 'market', viewport: [] }, devices: [],
			setup: [], workflow: {}, chapters: {}, overlays: {}, diagrams: {}, render: { remotion: { output: [], capture: [], browserFrame: [] } },
			runtime: { mode: 'invalid', timeouts: { sceneSeconds: 'never', chapterSeconds: -1, stepSeconds: Number.NaN }, checkpoints: [], progress: [], failure: [] },
			training: { captions: [], transcript: [], narration: [], glossary: { terms: 'invalid' }, chapterClips: [] }, visualAudit: [],
		}, diagnostics as never);

		expect(scene).not.toBeNull();
		expect(diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'scene.invalid_object', 'scene.invalid_array', 'scene.invalid_number', 'scene.invalid_runtime_mode',
		]));
	});

it('plans a valid scene with deterministic artifact paths', () => {
		const root = workspace();
		const path = writeScene(root, 'market-project-deploy-demo', validSceneYaml(`
render:
  remotion:
    composition: treeseed-training-default
diagrams:
  - id: lifecycle
    renderer: remotion
    component: OperationLifecycleDiagram
    at: open-projects
    placement: interstitial
    props:
      states:
        - queued
        - running
        - completed
`));

		const plan = planTreeseedScene({
			projectRoot: root,
			scene: path,
			environment: 'prod',
			timestamp: '20260614T120000Z',
			runId: 'abc123',
		});

		expect(plan.ok).toBe(true);
		expect(plan.phase).toBe(1);
		expect(plan.sceneId).toBe('market-project-deploy-demo');
		expect(plan.environment).toBe('prod');
		expect(plan.workflowSteps.map((step) => step.actionKind)).toEqual(['goto', 'click']);
		expect(plan.workflowSteps[0]?.assertionKinds).toEqual(['visible']);
		expect(plan.enabledActions).toEqual(['goto', 'click']);
		expect(plan.enabledAssertions).toEqual(['visible', 'text']);
		expect(plan.enabledRenderers).toEqual(['remotion']);
		expect(plan.enabledDiagrams).toEqual(['OperationLifecycleDiagram']);
		expect(plan.enabledDiagramPlugins).toEqual(['treeseed.scene.diagrams.remotion']);
		expect(plan.enabledTrainingOutputs).toEqual(['captions', 'transcript', 'narration', 'glossary', 'chapter-clips']);
		expect(plan.enabledNarrationPlugins).toEqual(['treeseed.scene.training.deterministic']);
		expect(plan.enabledDeviceProfiles).toEqual(['desktop']);
		expect(plan.plugins.some((entry) => entry.id === 'treeseed.scene.browser-actions')).toBe(true);
		expect(plan.plugins.some((entry) => entry.id === 'treeseed.scene.renderer.remotion' && entry.status === 'available')).toBe(true);
		expect(plan.plugins.some((entry) => entry.id === 'treeseed.scene.diagrams.remotion' && entry.status === 'available')).toBe(true);
		expect(plan.plugins.some((entry) => entry.id === 'treeseed.scene.training.deterministic' && entry.status === 'available')).toBe(true);
		expect(plan.enabledPlugins).toEqual([
			'treeseed.scene.browser-actions',
			'treeseed.scene.browser-assertions',
			'treeseed.scene.diagrams.remotion',
			'treeseed.scene.renderer.remotion',
			'treeseed.scene.training.deterministic',
		]);
		expect(plan.pluginDiagnostics).toEqual([]);
		expect(plan.artifactPaths?.runRoot).toContain('.treeseed/scenes/runs/market-project-deploy-demo/20260614T120000Z-abc123');
	});

it('plans disabled training output branches and invalid environment blockers', () => {
		const root = workspace();
		writeScene(root, 'training-disabled', validSceneYaml(`
training:
  enabled: false
`));
		const disabled = planTreeseedScene({
			projectRoot: root,
			scene: 'training-disabled',
			environment: 'qa' as never,
		});
		expect(disabled.ok).toBe(false);
		expect(disabled.enabledTrainingOutputs).toEqual([]);
		expect(disabled.enabledNarrationPlugins).toEqual([]);
		expect(disabled.diagnostics.map((entry) => entry.code)).toContain('scene.invalid_environment');

		writeScene(root, 'training-output-disabled', validSceneYaml(`
training:
  captions:
    enabled: false
  transcript:
    enabled: false
  narration:
    enabled: false
  glossary:
    enabled: false
  chapterClips:
    enabled: false
`));
		const outputsDisabled = planTreeseedScene({
			projectRoot: root,
			scene: 'training-output-disabled',
		});
		expect(outputsDisabled.ok).toBe(true);
		expect(outputsDisabled.enabledTrainingOutputs).toEqual([]);
		expect(outputsDisabled.enabledNarrationPlugins).toEqual([]);
		expect(outputsDisabled.enabledPlugins).not.toContain('treeseed.scene.training.deterministic');
	});

it('plans a degraded report with default capabilities when the scene cannot be loaded', () => {
		const root = workspace();
		const plan = planTreeseedScene({
			projectRoot: root,
			scene: 'missing-plan-scene',
		});
		expect(plan.ok).toBe(false);
		expect(plan.sceneId).toBeNull();
		expect(plan.title).toBeNull();
		expect(plan.environment).toBe('local');
		expect(plan.baseUrl).toBe('auto');
		expect(plan.browser).toBeNull();
		expect(plan.viewport).toBeNull();
		expect(plan.workflowSteps).toEqual([]);
		expect(plan.enabledActions).toEqual(expect.arrayContaining(['goto', 'click', 'fill']));
		expect(plan.enabledAssertions).toEqual(expect.arrayContaining(['visible', 'text']));
		expect(plan.enabledRenderers).toContain('remotion');
		expect(plan.enabledDiagrams).toEqual([]);
		expect(plan.enabledDiagramPlugins).toEqual([]);
		expect(plan.enabledTrainingOutputs).toEqual([]);
		expect(plan.enabledNarrationPlugins).toEqual([]);
		expect(plan.enabledDeviceProfiles).toEqual([]);
		expect(plan.artifactPaths).toBeNull();
		expect(plan.estimatedDurationSeconds).toBeNull();
		expect(plan.blockers.map((entry) => entry.code)).toContain('scene.not_found');
	});

it('resolves hosted scene base URLs from the web surface instead of API connections', () => {
		const root = workspace();
		writeFileSync(resolve(root, 'treeseed.site.yaml'), `name: Hosted Scene Test
slug: hosted-scene-test
siteUrl: https://fallback.example.test
contactEmail: test@example.test
hosting:
  kind: self_hosted_project
  registration: none
  teamId: treeseed
  projectId: hosted-scene-test
hub:
  mode: treeseed_hosted
runtime:
  mode: treeseed_managed
  registration: none
surfaces:
  web:
    environments:
      staging:
        domain: preview.example.test
connections:
  api:
    environments:
      staging:
        baseUrl: https://api.example.test
`, 'utf8');
		writeScene(root, 'hosted-base-url-demo', validSceneYaml());
		const scene = validateTreeseedScene({ projectRoot: root, scene: 'hosted-base-url-demo' }).scene;

		const report = resolveTreeseedSceneBaseUrl({
			projectRoot: root,
			scene: scene!,
			environment: 'staging',
		});

		expect(report).toEqual({ ok: true, baseUrl: 'https://preview.example.test', diagnostics: [] });
	});
});
