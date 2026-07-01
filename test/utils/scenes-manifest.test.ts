import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	loadTreeseedSceneDocument,
	planTreeseedScene,
	resolveTreeseedSceneBaseUrl,
	resolveTreeseedScenePath,
	validateTreeseedScene,
} from '../../src/scenes/index.ts';

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
	it('loads, validates, and normalizes a valid scene manifest', () => {
		const root = workspace();
		writeScene(root, 'market-project-deploy-demo', validSceneYaml());

		const loaded = loadTreeseedSceneDocument(root, 'market-project-deploy-demo');
		expect(loaded.diagnostics).toEqual([]);
		const report = validateTreeseedScene({ projectRoot: root, scene: 'market-project-deploy-demo' });

		expect(report.ok).toBe(true);
		expect(report.scene?.id).toBe('market-project-deploy-demo');
		expect(report.scene?.target.environment).toBe('local');
		expect(report.scene?.target.browser).toBe('chromium');
		expect(report.scene?.target.viewport).toEqual({ width: 1440, height: 1000 });
		expect(report.scene?.devices.defaultProfile).toBe('desktop');
		expect(report.scene?.devices.profiles).toEqual([expect.objectContaining({
			id: 'desktop',
			viewport: { width: 1600, height: 900 },
			video: { width: 1600, height: 900 },
			output: { width: 1920, height: 1080 },
		})]);
		expect(report.scene?.artifacts.video).toBe(false);
		expect(report.scene?.training.captions.formats).toEqual(['vtt', 'srt']);
		expect(report.scene?.training.transcript.formats).toEqual(['json', 'markdown']);
		expect(report.scene?.training.narration.style).toBe('instructional');
		expect(report.scene?.visualAudit.roles).toEqual(['anonymous', 'owner', 'admin', 'member']);
		expect(report.scene?.visualAudit.includeFullPage).toBe(false);
		expect(report.scene?.visualAudit.pathGlobs).toEqual([]);
		expect(report.scene?.visualAudit.excludePathGlobs).toEqual([]);
		expect(report.scene?.visualAudit.review).toEqual({
			enabled: true,
			detail: 'standard',
			maxFindings: 250,
			contactSheets: true,
		});
		expect(report.scene?.visualAudit.routeDiscovery.core).toBe(true);
	});

	it('parses explicit visual audit config and rejects invalid path roots', () => {
		const root = workspace();
		writeScene(root, 'visual-audit-demo', validSceneYaml(`
visualAudit:
  enabled: true
  roles:
    - anonymous
  pathRoots:
    - /app
  pathGlobs:
    - /app/projects/**
    - '**/settings'
  excludePathGlobs:
    - '**/delete'
  includeFullPage: true
  review:
    enabled: true
    detail: full
    maxFindings: 50
    contactSheets: false
  routeDiscovery:
    core: true
    admin: false
    tenantOverrides: true
    contentCollections: true
`));

		const report = validateTreeseedScene({ projectRoot: root, scene: 'visual-audit-demo' });

		expect(report.ok).toBe(true);
		expect(report.scene?.visualAudit.roles).toEqual(['anonymous']);
		expect(report.scene?.visualAudit.pathRoots).toEqual(['/app']);
		expect(report.scene?.visualAudit.pathGlobs).toEqual(['/app/projects/**', '**/settings']);
		expect(report.scene?.visualAudit.excludePathGlobs).toEqual(['**/delete']);
		expect(report.scene?.visualAudit.includeFullPage).toBe(true);
		expect(report.scene?.visualAudit.review).toEqual({
			enabled: true,
			detail: 'full',
			maxFindings: 50,
			contactSheets: false,
		});
		expect(report.scene?.visualAudit.routeDiscovery.admin).toBe(false);

		writeScene(root, 'invalid-visual-audit-demo', validSceneYaml(`
visualAudit:
  pathRoots:
    - app
  review:
    detail: loud
    maxFindings: 0
`));
		const invalid = validateTreeseedScene({ projectRoot: root, scene: 'invalid-visual-audit-demo' });
		expect(invalid.ok).toBe(false);
		expect(invalid.diagnostics.map((entry) => entry.code)).toContain('scene.visual_audit_invalid_path_root');
		expect(invalid.diagnostics.map((entry) => entry.code)).toContain('scene.visual_audit_invalid_review_detail');
		expect(invalid.diagnostics.map((entry) => entry.code)).toContain('scene.visual_audit_invalid_max_findings');
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

	it('parses explicit device profiles and validates invalid device configuration', () => {
		const root = workspace();
		writeScene(root, 'devices-demo', validSceneYaml(`
devices:
  defaultProfile: mobile
  profiles:
    - id: desktop
      viewport: { width: 1600, height: 900 }
      video: { width: 1600, height: 900 }
      output: { width: 1920, height: 1080 }
    - id: tablet
      title: Tablet
      orientation: landscape
      viewport: { width: 1024, height: 768 }
      video: { width: 1024, height: 768 }
      output: { width: 1440, height: 1080 }
      isMobile: true
      hasTouch: true
    - id: mobile
      title: Mobile
      orientation: portrait
      viewport: { width: 390, height: 844 }
      video: { width: 390, height: 844 }
      output: { width: 1080, height: 1920 }
      deviceScaleFactor: 2
      isMobile: true
      hasTouch: true
`));
		const report = validateTreeseedScene({ projectRoot: root, scene: 'devices-demo' });
		expect(report.ok).toBe(true);
		expect(report.scene?.devices.defaultProfile).toBe('mobile');
		expect(report.scene?.devices.profiles.map((profile) => profile.id)).toEqual(['desktop', 'tablet', 'mobile']);
		expect(report.scene?.devices.profiles.find((profile) => profile.id === 'mobile')?.output).toEqual({ width: 1080, height: 1920 });

		writeScene(root, 'bad-devices', validSceneYaml(`
devices:
  defaultProfile: missing
  profiles:
    - id: desktop
      viewport: { width: 0, height: 900 }
      extraThing: true
    - id: desktop
      viewport: { width: 1600, height: 900 }
`));
		const diagnostics = validateTreeseedScene({ projectRoot: root, scene: 'bad-devices' }).diagnostics;
		expect(diagnostics.some((entry) => entry.code === 'scene.device_unknown')).toBe(true);
		expect(diagnostics.some((entry) => entry.code === 'scene.device_duplicate')).toBe(true);
		expect(diagnostics.some((entry) => entry.code === 'scene.invalid_number')).toBe(true);
		expect(diagnostics.some((entry) => entry.code === 'scene.unknown_device_field' && entry.severity === 'warning')).toBe(true);
	});

	it('parses overlay and diagram visual objects with renderer-portable motion', () => {
		const root = workspace();
		writeScene(root, 'visuals-demo', validSceneYaml(`
overlays:
  - id: moving-panel
    at: open-projects
    renderer: remotion
    type: callout
    variant: panel
    region: top-right
    durationSeconds: 5
    style:
      tone: brand
      shadow: medium
    motion:
      keyframes:
        - at: 0
          unit: progress
          opacity: 0
          position: { x: 100, y: 8, unit: percent }
        - at: 0.25
          unit: progress
          opacity: 1
          position: { x: 78, y: 8, unit: percent }
    objects:
      - id: pulse
        type: circle
        position: { x: 8, y: 18 }
        size: { width: 12, height: 12 }
        motion:
          keyframes:
            - at: 0
              unit: progress
              scale: 0.8
            - at: 1
              unit: progress
              scale: 1.2
    text: Motion makes this overlay readable in video.
diagrams:
  - id: lifecycle
    renderer: remotion
    component: OperationLifecycleDiagram
    at: open-projects
    objects:
      - id: arrow
        type: arrow
        from: { x: 10, y: 80, unit: percent }
        to: { x: 90, y: 80, unit: percent }
    motion:
      keyframes:
        - at: 0
          unit: progress
          opacity: 0
        - at: 0.2
          unit: progress
          opacity: 1
    props:
      states: [queued, running, completed]
`));
		const report = validateTreeseedScene({ projectRoot: root, scene: 'visuals-demo' });
		expect(report.ok).toBe(true);
		expect(report.scene?.overlays[0]?.variant).toBe('panel');
		expect(report.scene?.overlays[0]?.objects?.[0]?.id).toBe('pulse');
		expect(report.scene?.diagrams[0]?.objects?.[0]?.type).toBe('arrow');

		writeScene(root, 'bad-visuals', validSceneYaml(`
overlays:
  - id: bad
    at: open-projects
    renderer: remotion
    type: callout
    variant: missing
    motion:
      keyframes:
        - at: 1
          unit: progress
        - at: 0.5
          unit: progress
    objects:
      - id: duplicate
        type: box
      - id: duplicate
        type: not-real
`));
		const diagnostics = validateTreeseedScene({ projectRoot: root, scene: 'bad-visuals' }).diagnostics.map((entry) => entry.code);
		expect(diagnostics).toContain('scene.overlay_invalid_variant');
		expect(diagnostics).toContain('scene.motion_keyframes_unsorted');
		expect(diagnostics).toContain('scene.visual_duplicate_object');
		expect(diagnostics).toContain('scene.visual_invalid_object_type');
	});

	it('fails planning for invalid diagram props and unknown components', () => {
		const root = workspace();
		writeScene(root, 'market-project-deploy-demo', validSceneYaml(`
diagrams:
  - id: bad-lifecycle
    renderer: remotion
    component: OperationLifecycleDiagram
    at: open-projects
    props: {}
  - id: unknown
    renderer: remotion
    component: MissingDiagram
    at: open-deploy
`));
		const plan = planTreeseedScene({ projectRoot: root, scene: 'market-project-deploy-demo' });
		expect(plan.ok).toBe(false);
		expect(plan.diagnostics.some((entry) => entry.code === 'scene.diagram_invalid_props')).toBe(true);
		expect(plan.diagnostics.some((entry) => entry.code === 'scene.diagram_unknown_component')).toBe(true);
		expect(plan.enabledRenderers).toContain('remotion');
	});

	it('resolves bare scene ids to scenes yaml files', () => {
		const root = workspace();
		expect(resolveTreeseedScenePath(root, 'alpha-demo')).toBe(resolve(root, 'scenes', 'alpha-demo.yaml'));
	});

	it('reports missing files and invalid YAML as diagnostics', () => {
		const root = workspace();
		expect(validateTreeseedScene({ projectRoot: root, scene: 'missing-demo' }).diagnostics[0]?.code).toBe('scene.not_found');
		writeScene(root, 'bad-yaml', 'schemaVersion: [');
		expect(validateTreeseedScene({ projectRoot: root, scene: 'bad-yaml' }).diagnostics[0]?.code).toBe('scene.yaml_parse_error');
	});

	it('rejects invalid schema, missing required fields, duplicate ids, and missing assertions', () => {
		const root = workspace();
		writeScene(root, 'invalid-demo', `schemaVersion: treeseed.scene/v0
id: Invalid Demo
workflow:
  - id: duplicate
    title: First
    action:
      goto: /one
  - id: duplicate
    title: Second
    action:
      goto: /two
    expect:
      text: Two
`);
		const diagnostics = validateTreeseedScene({ projectRoot: root, scene: 'invalid-demo' }).diagnostics.map((entry) => entry.code);
		expect(diagnostics).toContain('scene.unsupported_schema_version');
		expect(diagnostics).toContain('scene.invalid_id');
		expect(diagnostics).toContain('scene.missing_field');
		expect(diagnostics).toContain('scene.duplicate_step_id');
		expect(diagnostics).toContain('scene.missing_assertion');
	});

	it('allows demo-only steps without assertions', () => {
		const root = workspace();
		writeScene(root, 'demo-only', `schemaVersion: treeseed.scene/v1
id: demo-only
title: Demo Only
target:
  app: market
workflow:
  - id: pause
    title: Pause
    action:
      pause:
        mode: manual
    demoOnly: true
`);
		expect(validateTreeseedScene({ projectRoot: root, scene: 'demo-only' }).ok).toBe(true);
	});

	it('rejects long scenes without chapters and invalid references', () => {
		const root = workspace();
		const steps = Array.from({ length: 11 }, (_, index) => `  - id: step-${index}
    title: Step ${index}
    action:
      goto: /${index}
    expect:
      text: Step ${index}`).join('\n');
		writeScene(root, 'long-scene', `schemaVersion: treeseed.scene/v1
id: long-scene
title: Long Scene
target:
  app: market
workflow:
${steps}
overlays:
  - id: overlay-one
    at: missing
    renderer: remotion
    type: callout
diagrams:
  - id: diagram-one
    at: missing
    renderer: remotion
    component: Example
`);
		const diagnostics = validateTreeseedScene({ projectRoot: root, scene: 'long-scene' }).diagnostics.map((entry) => entry.code);
		expect(diagnostics).toContain('scene.missing_chapters');
		expect(diagnostics).toContain('scene.unknown_step_reference');
	});

	it('warns for unmarked raw CSS selectors and unknown top-level fields', () => {
		const root = workspace();
		writeScene(root, 'css-scene', validSceneYaml(`
extraField: true
overlays:
  - id: overlay-one
    at: open-projects
    renderer: remotion
    type: callout
    anchor:
      css: .timeline
`));
		const diagnostics = validateTreeseedScene({ projectRoot: root, scene: 'css-scene' }).diagnostics;
		expect(diagnostics.some((entry) => entry.code === 'scene.raw_css_selector' && entry.severity === 'warning')).toBe(true);
		expect(diagnostics.some((entry) => entry.code === 'scene.unknown_field' && entry.severity === 'warning')).toBe(true);
	});

	it('rejects invalid environment and browser values', () => {
		const root = workspace();
		writeScene(root, 'bad-target', `schemaVersion: treeseed.scene/v1
id: bad-target
title: Bad Target
target:
  app: market
  environment: qa
  browser: netscape
workflow:
  - id: open
    title: Open
    action:
      goto: /
    expect:
      text: Home
`);
		const diagnostics = validateTreeseedScene({ projectRoot: root, scene: 'bad-target' }).diagnostics.map((entry) => entry.code);
		expect(diagnostics).toContain('scene.invalid_environment');
		expect(diagnostics).toContain('scene.invalid_browser');
	});

	it('validates explicit training configuration', () => {
		const root = workspace();
		writeScene(root, 'training-scene', validSceneYaml(`
training:
  enabled: true
  captions:
    formats:
      - vtt
    maxCueSeconds: 8
  transcript:
    formats:
      - markdown
  narration:
    style: operator
    includeDiagnostics: false
  glossary:
    terms:
      - term: operation
        definition: Explicit operation definition.
        sourceStep: open-projects
  chapterClips:
    format: manifest
`));
		const report = validateTreeseedScene({ projectRoot: root, scene: 'training-scene' });
		expect(report.ok).toBe(true);
		expect(report.scene?.training.captions.formats).toEqual(['vtt']);
		expect(report.scene?.training.captions.maxCueSeconds).toBe(8);
		expect(report.scene?.training.transcript.formats).toEqual(['markdown']);
		expect(report.scene?.training.narration.style).toBe('operator');
		expect(report.scene?.training.glossary.terms[0]?.definition).toBe('Explicit operation definition.');
	});

	it('rejects invalid training configuration', () => {
		const root = workspace();
		writeScene(root, 'bad-training', validSceneYaml(`
training:
  captions:
    formats:
      - ass
    maxCueSeconds: 0
  transcript:
    formats:
      - html
  narration:
    style: poetic
  glossary:
    terms:
      - definition: Missing term
      - term: bad source
        sourceStep: missing
`));
		const diagnostics = validateTreeseedScene({ projectRoot: root, scene: 'bad-training' }).diagnostics.map((entry) => entry.code);
		expect(diagnostics).toContain('scene.training_invalid_config');
		expect(diagnostics).toContain('scene.invalid_number');
		expect(diagnostics).toContain('scene.missing_field');
		expect(diagnostics).toContain('scene.unknown_step_reference');
	});
});
