import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	planScene,
	validateScene,
} from '../../../../src/scenes/index.ts';

function findWorkspaceRoot() {
	if (process.env.TREESEED_VERIFY_PACKAGE_ISOLATED === '1') {
		return resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/scene-project');
	}
	let current = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
	for (let index = 0; index < 8; index += 1) {
		if (existsSync(resolve(current, 'scenes/user-team-management-demo.yaml'))) return current;
		const next = dirname(current);
		if (next === current) break;
		current = next;
	}
	return resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/scene-project');
}

describe('user team management demo scene', () => {
	it('validates and plans the strict user/team QA scene', () => {
		const projectRoot = findWorkspaceRoot();
		const report = validateScene({ projectRoot, scene: 'user-team-management-demo' });
		expect(report.ok).toBe(true);
		expect(report.scene?.id).toBe('user-team-management-demo');
		expect(report.scene?.runtime.failure.continueOnFailure).toBe(false);
		expect(report.scene?.target.viewport).toEqual({ width: 1600, height: 900 });
		expect(report.scene?.devices.profiles.map((profile) => profile.id)).toEqual(['desktop', 'tablet', 'mobile']);
		expect(report.scene?.devices.profiles.find((profile) => profile.id === 'mobile')?.output).toEqual({ width: 1080, height: 1920 });
		expect(report.scene?.training.enabled).toBe(true);
		expect(report.scene?.workflow.some((step) => step.id === 'owner-view-sessions-tab')).toBe(true);
		expect(report.scene?.workflow.some((step) => step.id === 'owner-final-roster')).toBe(true);
		expect(report.scene?.workflow.some((step) => step.id.includes('danger') || step.id.includes('delete'))).toBe(false);

		const plan = planScene({
			projectRoot,
			scene: 'user-team-management-demo',
			environment: 'local',
			timestamp: '20260615T120000Z',
			runId: 'team-demo',
		});
		expect(plan.ok).toBe(true);
		expect(plan.enabledActions).toEqual(expect.arrayContaining(['goto', 'fill', 'click', 'select', 'mailpitConfirmLatest', 'pause']));
		expect(plan.enabledRenderers).toContain('remotion');
		expect(plan.enabledTrainingOutputs).toEqual(['captions', 'transcript', 'narration', 'glossary', 'chapter-clips']);
		expect(plan.enabledDeviceProfiles).toEqual(['desktop', 'mobile', 'tablet']);
		expect(plan.artifactPaths?.runRoot).toContain('.treeseed/scenes/runs/user-team-management-demo/20260615T120000Z-team-demo');
	});

	it('keeps local generation narrow and documents fixed demo state', () => {
		const projectRoot = findWorkspaceRoot();
		const scene = readFileSync(resolve(projectRoot, 'scenes/user-team-management-demo.yaml'), 'utf8');
		const normalizedScene = scene.replace(/\s+/gu, ' ');
		const generator = readFileSync(resolve(projectRoot, 'scenes/user-team-management-demo.generate.ts'), 'utf8');
		const readme = readFileSync(resolve(projectRoot, 'scenes/user-team-management-demo.README.md'), 'utf8');

		for (const text of [
			'demo.admin@treeseed.io',
			'avery.admin@treeseed.io',
			'casey.member@treeseed.io',
			'jordan.member@treeseed.io',
			'riley.member@treeseed.io',
			'project_lead',
			'central TreeSeed acceptance test harness and demo / educational video generator',
			'TreeSeed teams give small businesses one place',
		]) {
			expect(normalizedScene).toContain(text);
		}
		expect(scene).toContain('__USER_TEAM_MAILPIT_URL__');
		expect(scene).toContain('select:');
		expect(generator).toContain('.treeseed/scenes/generated/user-team-management-demo.local.yaml');
		expect(generator).toContain('/api/v1/messages');
		expect(generator).toContain('TREESEED_SCENE_CLEAR_MAILPIT');
		expect(readme).toContain('fixed demo identities');
		expect(readme).toContain('fresh local app database');
		expect(readme).toContain('--device desktop');
		expect(readme).toContain('--device all');
	});
});
