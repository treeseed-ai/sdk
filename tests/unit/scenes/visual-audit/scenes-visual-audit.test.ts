import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
	discoverSceneVisualAuditRoutes,
	formatSceneVisualAuditMarkdown,
	validateScene,
	type SceneVisualAuditManifest,
	type SceneVisualAuditPaths,
} from '../../../../src/scenes/index.ts';

function projectRoot() {
	if (process.env.TREESEED_VERIFY_PACKAGE_ISOLATED === '1') {
		return resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/scene-project');
	}
	let current = process.cwd();
	for (let index = 0; index < 8; index += 1) {
		if (existsSync(resolve(current, 'scenes/site-visual-audit.yaml'))) return current;
		const next = resolve(current, '..');
		if (next === current) break;
		current = next;
	}
	return resolve(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/scene-project');
}

describe('scene visual audit', () => {
	it('validates the canonical visual audit scene', () => {
		const root = projectRoot();
		const report = validateScene({ projectRoot: root, scene: 'site-visual-audit' });

		expect(report.ok).toBe(true);
		expect(report.scene?.id).toBe('site-visual-audit');
		expect(report.scene?.visualAudit.roles).toEqual(['anonymous', 'owner', 'admin', 'member']);
		expect(report.scene?.visualAudit.includeFullPage).toBe(false);
		expect(report.scene?.devices.profiles.map((profile) => profile.id)).toEqual(['desktop', 'tablet', 'mobile']);
	});

	it('discovers user-facing core, admin, tenant override, and content routes', () => {
		const root = projectRoot();
		const report = validateScene({ projectRoot: root, scene: 'site-visual-audit' });
		const discovered = discoverSceneVisualAuditRoutes({ projectRoot: root, scene: report.scene! });
		const paths = discovered.routes.map((route) => route.path);

		expect(discovered.diagnostics.filter((entry) => entry.severity === 'error')).toEqual([]);
		expect(paths).toContain('/');
		expect(paths).not.toContain('/${slug}');
		expect(paths).toContain('/books');
		expect(paths).toContain('/books/market-architecture');
		expect(paths).not.toContain('/books/visual-audit');
		expect(paths).toContain('/auth/register');
		expect(paths).toContain('/auth/sign-in');
		expect(paths).toContain('/market/templates/engineering');
		expect(paths).toContain('/app');
		expect(paths).toContain('/app/teams');
		expect(paths).toContain('/app/teams/new');
		expect(paths.some((path) => path.startsWith('/api/'))).toBe(false);
		expect(paths.some((path) => path.startsWith('/v1/'))).toBe(false);
		expect(paths.some((path) => path.includes('/delete'))).toBe(false);
		expect(paths.some((path) => path.endsWith('/visual-audit') && !path.startsWith('/app/') && !path.startsWith('/u/') && !path.startsWith('/t/'))).toBe(false);
	});

	it('filters visual audit routes by path root and classifies app roots', () => {
		const root = projectRoot();
		const report = validateScene({ projectRoot: root, scene: 'site-visual-audit' });
		const discovered = discoverSceneVisualAuditRoutes({ projectRoot: root, scene: report.scene!, pathRoots: ['/app/teams'] });

		expect(discovered.routes.length).toBeGreaterThan(0);
		expect(discovered.routes.every((route) => route.path.startsWith('/app/teams'))).toBe(true);
		expect(discovered.routes.every((route) => route.pathRoot === '/app/teams')).toBe(true);
	});

	it('filters visual audit routes by include and exclude path globs', () => {
		const root = projectRoot();
		const report = validateScene({ projectRoot: root, scene: 'site-visual-audit' });
		const discovered = discoverSceneVisualAuditRoutes({
			projectRoot: root,
			scene: report.scene!,
			pathGlobs: ['/app/teams/**', '**/appearance'],
			excludePathGlobs: ['**/deploy', '**/delete'],
		});
		const paths = discovered.routes.map((route) => route.path);

		expect(paths.length).toBeGreaterThan(0);
		expect(paths).toContain('/app/teams');
		expect(paths).toContain('/app/teams/new');
		expect(paths).not.toContain('/app/teams/visual-audit/delete');
		expect(paths.every((path) => path.startsWith('/app/teams') || path.endsWith('/appearance'))).toBe(true);
		expect(paths.some((path) => path.includes('/delete'))).toBe(false);
	});

	it('formats a visual audit report grouped by path root', () => {
		const root = mkdtempSync(resolve(tmpdir(), 'treeseed-visual-audit-'));
		const paths: SceneVisualAuditPaths = {
			auditRoot: root,
			manifestPath: resolve(root, 'manifest.json'),
			reportPath: resolve(root, 'report.md'),
			screenshotsRoot: resolve(root, 'screenshots'),
			reviewRoot: resolve(root, 'review'),
			reviewSummaryPath: resolve(root, 'review/summary.json'),
			reviewFindingsPath: resolve(root, 'review/findings.json'),
			reviewAgentBriefPath: resolve(root, 'review/agent-brief.md'),
		};
		const manifest: SceneVisualAuditManifest = {
			schemaVersion: 'treeseed.scene.visual-audit/v1',
			phase: 11,
			generatedAt: '2026-06-17T12:00:00.000Z',
			sceneId: 'site-visual-audit',
			auditId: 'audit',
			baseUrl: 'http://127.0.0.1:4321',
			roles: ['anonymous'],
			devices: ['desktop'],
			routes: [{
				id: 'index',
				path: '/',
				pathRoot: '/',
				source: 'core-route-registry',
				requiresAuth: false,
				roles: ['anonymous'],
				dynamic: false,
			}],
			captures: [{
				id: 'anonymous-desktop-index',
				routeId: 'index',
				path: '/',
				pathRoot: '/',
				role: 'anonymous',
				device: 'desktop',
				url: 'http://127.0.0.1:4321/',
				status: 'captured',
				httpStatus: 200,
				finalUrl: 'http://127.0.0.1:4321/',
				screenshotPath: resolve(root, 'screenshots/anonymous/desktop/root/index.png'),
				fullPageScreenshotPath: null,
				capturedAt: '2026-06-17T12:00:00.000Z',
				durationMs: 25,
				diagnostics: [],
			}],
			diagnostics: [],
		};
		const markdown = formatSceneVisualAuditMarkdown({ manifest, paths });

		expect(markdown).toContain('# TreeSeed Scene Visual Audit');
		expect(markdown).toContain('### /');
		expect(markdown).toContain('| anonymous | desktop | / | captured |');
		expect(markdown).toContain('Review findings: 0');
	});

	it('documents the visual audit command in the authoring guide', () => {
		const root = projectRoot();
		const guide = readFileSync(resolve(root, 'docs/scene-authoring.md'), 'utf8');

		expect(guide).toContain('trsd scene visual-audit');
		expect(guide).toContain('viewport screenshots');
		expect(guide).toContain('desktop');
		expect(guide).toContain('tablet');
		expect(guide).toContain('mobile');
	});
});
