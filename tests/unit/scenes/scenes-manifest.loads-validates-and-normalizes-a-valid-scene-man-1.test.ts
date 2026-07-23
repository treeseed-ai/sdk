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

it('reports dense schema diagnostics for malformed journey, workflow, devices, visuals, and training config', () => {
		const diagnostics: Array<{ code: string; severity: string; path?: string }> = [];
		const scene = parseTreeseedSceneManifest({
			schemaVersion: 'treeseed.scene/v1',
			id: 'schema-edge',
			title: 'Schema Edge',
			journey: {
				kind: 'adventure',
				proves: ['service-flow', 123],
				minimumSteps: 0,
				requiresInteractiveAction: 'yes',
				producesState: ['not-object', { key: '', kind: 'created' }],
				consumesState: [{ key: 'quote', kind: '' }],
			},
			mode: { test: 'yes' },
			target: { app: 'market', environment: 'moon', browser: 'netscape' },
			devices: {
				unknown: true,
				defaultProfile: 'missing',
				profiles: [
					'not-object',
					{
						id: 'Bad Device!',
						orientation: 'sideways',
						viewport: { width: -1, height: Number.NaN },
						video: { width: null, height: 100 },
						output: { width: 500, height: 300 },
						browserFrame: { chrome: 'watch' },
						deviceScaleFactor: 0,
						isMobile: 'sometimes',
						hasTouch: 'maybe',
					},
				],
			},
			setup: { auth: { role: 'owner', required: 'true' } },
			workflow: [
				'not-object',
				{
					id: 'Bad Step!',
					title: '',
					action: 'not-object',
					expect: 'not-object',
					checkpoint: { id: 'Bad Checkpoint!', resumable: 'yes' },
				},
				{
					id: 'pause',
					title: 'Pause',
					action: { pause: { mode: 'timed' } },
				},
				{
					id: 'select',
					title: 'Select',
					action: { select: { css: '.role' } },
				},
				{
					id: 'fill',
					title: 'Fill',
					action: { fill: { role: 'textbox', name: 'Name' } },
					expect: { unknown: true, operation: 'bad' },
				},
			],
			chapters: [
				'not-object',
				{ id: 'Bad Chapter!', title: 'Bad', startsAt: 'missing-step' },
			],
			overlays: [
				'not-object',
				{
					id: 'Bad Overlay!',
					variant: 'mystery',
					at: 'select',
					position: 'bad',
					size: { width: 120, height: -1, unit: 'percent' },
					style: { tone: 'loud', opacity: 2, unknown: true },
					motion: {
						loop: 'yes',
						keyframes: [
							'bad',
							{ at: 2, unit: 'progress', opacity: 2, position: { x: 120, y: -1, unit: 'percent' }, rotateDeg: Number.NaN, easing: 'rocket' },
						],
					},
					objects: ['bad', { type: 'triangle', text: 'Hello', position: { x: 'left', y: 10 } }],
				},
			],
			diagrams: [
				'not-object',
				{ id: 'Bad Diagram!', renderer: 'remotion', component: '', at: 'missing-step', placement: 'beside' },
			],
			render: {
				remotion: {
					capture: {
						evidenceFit: 'squish',
					},
				},
			},
			training: {
				unknown: true,
				enabled: true,
				captions: { formats: ['vtt', 'pdf'] },
				transcript: { formats: ['json', 'doc'] },
				narration: { style: 'dramatic' },
				glossary: { terms: ['bad'] },
				chapterClips: { format: 'video' },
			},
			visualAudit: {
				unknown: true,
				roles: [],
				pathRoots: ['app'],
				review: { unknown: true, detail: 'loud', maxFindings: 0 },
				routeDiscovery: { unknown: true },
			},
		}, diagnostics as never);

		expect(scene).not.toBeNull();
		expect(diagnostics.map((entry) => entry.code)).toEqual(expect.arrayContaining([
			'scene.invalid_journey_kind',
			'scene.invalid_string',
			'scene.invalid_state_ref',
			'scene.invalid_boolean',
			'scene.invalid_environment',
			'scene.invalid_browser',
			'scene.unknown_device_field',
			'scene.invalid_device_profile',
			'scene.invalid_id',
			'scene.device_orientation_invalid',
			'scene.device_browser_chrome_invalid',
			'scene.invalid_workflow_step',
			'scene.invalid_action',
			'scene.invalid_expectation',
			'scene.invalid_chapter',
			'scene.unknown_step_reference',
			'scene.invalid_overlay',
			'scene.visual_invalid_size',
			'scene.visual_invalid_opacity',
			'scene.motion_invalid_keyframe',
			'scene.motion_invalid_progress',
			'scene.visual_invalid_object',
			'scene.invalid_diagram',
			'scene.diagram_invalid_placement',
			'scene.render_capture_fit_invalid',
			'scene.training_invalid_config',
			'scene.visual_audit_invalid_roles',
			'scene.visual_audit_invalid_path_root',
			'scene.visual_audit_invalid_review_detail',
			'scene.visual_audit_invalid_max_findings',
		]));
		expect(diagnostics.some((entry) => entry.severity === 'warning')).toBe(true);
	});
});
