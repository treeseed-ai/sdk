import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';

import { tmpdir } from 'node:os';

import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	loadSceneDocument,
	parseSceneManifest,
	planScene,
	resolveSceneBaseUrl,
	resolveScenePath,
	validateScene,
} from '../../../../src/scenes/index.ts';

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
		const report = validateScene({ projectRoot: root, scene: 'devices-demo' });
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
		const diagnostics = validateScene({ projectRoot: root, scene: 'bad-devices' }).diagnostics;
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
		const report = validateScene({ projectRoot: root, scene: 'visuals-demo' });
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
		const diagnostics = validateScene({ projectRoot: root, scene: 'bad-visuals' }).diagnostics.map((entry) => entry.code);
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
		const plan = planScene({ projectRoot: root, scene: 'market-project-deploy-demo' });
		expect(plan.ok).toBe(false);
		expect(plan.diagnostics.some((entry) => entry.code === 'scene.diagram_invalid_props')).toBe(true);
		expect(plan.diagnostics.some((entry) => entry.code === 'scene.diagram_unknown_component')).toBe(true);
		expect(plan.enabledRenderers).toContain('remotion');
	});

it('resolves bare scene ids to scenes yaml files', () => {
		const root = workspace();
		expect(resolveScenePath(root, 'alpha-demo')).toBe(resolve(root, 'scenes', 'alpha-demo.yaml'));
	});

it('reports missing files and invalid YAML as diagnostics', () => {
		const root = workspace();
		expect(validateScene({ projectRoot: root, scene: 'missing-demo' }).diagnostics[0]?.code).toBe('scene.not_found');
		writeScene(root, 'bad-yaml', 'schemaVersion: [');
		expect(validateScene({ projectRoot: root, scene: 'bad-yaml' }).diagnostics[0]?.code).toBe('scene.yaml_parse_error');
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
		const diagnostics = validateScene({ projectRoot: root, scene: 'invalid-demo' }).diagnostics.map((entry) => entry.code);
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
		expect(validateScene({ projectRoot: root, scene: 'demo-only' }).ok).toBe(true);
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
		const diagnostics = validateScene({ projectRoot: root, scene: 'long-scene' }).diagnostics.map((entry) => entry.code);
		expect(diagnostics).toContain('scene.missing_chapters');
		expect(diagnostics).toContain('scene.unknown_step_reference');
	});
});
