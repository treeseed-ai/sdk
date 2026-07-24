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
		const diagnostics = validateScene({ projectRoot: root, scene: 'css-scene' }).diagnostics;
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
		const diagnostics = validateScene({ projectRoot: root, scene: 'bad-target' }).diagnostics.map((entry) => entry.code);
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
		const report = validateScene({ projectRoot: root, scene: 'training-scene' });
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
		const diagnostics = validateScene({ projectRoot: root, scene: 'bad-training' }).diagnostics.map((entry) => entry.code);
		expect(diagnostics).toContain('scene.training_invalid_config');
		expect(diagnostics).toContain('scene.invalid_number');
		expect(diagnostics).toContain('scene.missing_field');
		expect(diagnostics).toContain('scene.unknown_step_reference');
	});
});
