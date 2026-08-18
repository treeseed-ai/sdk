import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	planScene,
	validateScene,
} from '../../../../src/scenes/index.ts';

function findWorkspaceRoot() {
	if (process.env.TREESEED_VERIFY_PACKAGE_ISOLATED === '1') {
		return resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/scene-project');
	}
	let current = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
	for (let index = 0; index < 8; index += 1) {
		if (existsSync(resolve(current, 'scenes/team-project-portfolio-demo.yaml'))) return current;
		const next = dirname(current);
		if (next === current) break;
		current = next;
	}
	return resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/scene-project');
}

describe('team project portfolio demo scene', () => {
	it('validates and plans the tracked scenario scene', () => {
		const projectRoot = findWorkspaceRoot();
		const report = validateScene({ projectRoot, scene: 'team-project-portfolio-demo' });
		expect(report.ok).toBe(true);
		expect(report.diagnostics).toEqual([]);
		expect(report.scene?.runtime.mode).toBe('training');
		expect(report.scene?.runtime.checkpoints.defaultResumable).toBe(true);
		expect(report.scene?.target.viewport).toEqual({ width: 1600, height: 900 });
		expect(report.scene?.devices.defaultProfile).toBe('desktop');
		expect(report.scene?.devices.profiles.map((profile) => profile.id)).toEqual(['desktop', 'tablet', 'mobile']);
		expect(report.scene?.devices.profiles.find((profile) => profile.id === 'mobile')?.output).toEqual({ width: 1080, height: 1920 });
		expect(report.scene?.render.remotion?.capture?.viewport).toEqual({ width: 1600, height: 900 });
		expect(report.scene?.render.remotion?.capture?.video).toEqual({ width: 1600, height: 900 });
		expect(report.scene?.render.remotion?.capture?.evidenceFit).toBe('fixed-browser');
		expect(report.scene?.render.remotion?.browserFrame?.enabled).toBe(false);
		expect(report.scene?.training.enabled).toBe(true);
		expect(report.scene?.overlays.some((overlay) => overlay.motion && overlay.objects?.length)).toBe(true);
		expect(report.scene?.diagrams.some((diagram) => diagram.motion && diagram.objects?.length)).toBe(true);
		expect(report.scene?.workflow.some((step) => step.id === 'capture-sdk-linking-gap')).toBe(true);

		const plan = planScene({
			projectRoot,
			scene: 'team-project-portfolio-demo',
			environment: 'local',
			timestamp: '20260615T120000Z',
			runId: 'portfolio',
		});
		expect(plan.ok).toBe(true);
		expect(plan.enabledRenderers).toContain('remotion');
		expect(plan.enabledDiagrams).toEqual([
			'DevRuntimeTopologyDiagram',
			'OperationLifecycleDiagram',
			'SceneExecutionTimelineDiagram',
		]);
		expect(plan.enabledTrainingOutputs).toEqual(['captions', 'transcript', 'narration', 'glossary', 'chapter-clips']);
		expect(plan.enabledDeviceProfiles).toEqual(['desktop', 'mobile', 'tablet']);
		expect(plan.enabledPlugins).toEqual(expect.arrayContaining([
			'treeseed.scene.browser-actions',
			'treeseed.scene.browser-assertions',
			'treeseed.scene.diagrams.remotion',
			'treeseed.scene.renderer.remotion',
			'treeseed.scene.training.deterministic',
		]));
		expect(plan.artifactPaths?.runRoot).toContain('.treeseed/scenes/runs/team-project-portfolio-demo/20260615T120000Z-portfolio');
	});

	it('keeps the generated scene placeholder replacement narrow and documented', () => {
		const projectRoot = findWorkspaceRoot();
		const scenePath = resolve(projectRoot, 'scenes/team-project-portfolio-demo.yaml');
		const generatorPath = resolve(projectRoot, 'scenes/team-project-portfolio-demo.generate.ts');
		const readmePath = resolve(projectRoot, 'scenes/team-project-portfolio-demo.README.md');
		const scene = readFileSync(scenePath, 'utf8');
		const generator = readFileSync(generatorPath, 'utf8');
		const readme = readFileSync(readmePath, 'utf8');

		expect(scene).toContain('__PORTFOLIO_MAILPIT_URL__');
		expect(scene).toContain('__PORTFOLIO_EMAIL__');
		expect(scene).toContain('mailpitConfirmLatest');
		expect(scene).toContain('github.com/treeseed-ai/sdk');
		expect(scene).toContain('Current gap: this linked-project operation is not exposed');
		expect(generator).toContain('.treeseed/scenes/generated/team-project-portfolio-demo.local.yaml');
		expect(generator).toContain('/api/v1/messages');
		expect(generator).toContain('TREESEED_SCENE_CLEAR_MAILPIT');
		expect(generator).toContain('npx');
		expect(generator).toContain('trsd');
		expect(readme).toContain('central TreeSeed acceptance test harness and demo / educational video generator');
		expect(readme).toContain('--device desktop');
		expect(readme).toContain('--device tablet');
		expect(readme).toContain('--device mobile');
		expect(readme).toContain('--device all');
		expect(readme).toContain('SDK linked software project requirement');
		expect(readme).toContain('clears the local Mailpit inbox');
		expect(readme).toContain('Mailpit confirmation');
	});

	it('documents scene authoring capabilities in one standalone guide', () => {
		const projectRoot = findWorkspaceRoot();
		const guide = readFileSync(resolve(projectRoot, 'docs/scene-authoring.md'), 'utf8');
		const workflowTester = readFileSync(resolve(projectRoot, 'docs/workflow-tester.md'), 'utf8');
		for (const text of [
			'central TreeSeed acceptance test harness and demo / educational video generator',
			'trsd scene status',
			'trsd scene validate',
			'trsd scene plan',
			'trsd scene run',
			'trsd scene inspect',
			'trsd scene resume',
			'trsd scene render',
			'trsd scene training',
			'trsd scene evidence',
			'trsd scene publish',
			'trsd scene publish-plan',
			'trsd scene export',
			'goto',
			'click',
			'fill',
			'keyboard',
			'pause',
			'mailpitConfirmLatest',
			'waitForOperation',
			'apiRequest',
			'visible',
			'text',
			'urlIncludes',
			'operation',
			'desktop',
			'tablet',
			'mobile',
			'Motion uses renderer-portable keyframes',
			'Visual object types',
			'evidence',
			'publish',
			'export',
		]) {
			expect(guide).toContain(text);
		}
		expect(workflowTester).toContain('Scene Authoring Guide');
		expect(workflowTester).toContain('scene-authoring.md');
	});
});
