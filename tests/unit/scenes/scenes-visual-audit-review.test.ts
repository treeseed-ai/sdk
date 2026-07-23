import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	buildTreeseedSceneVisualAuditReview,
	writeTreeseedSceneVisualAuditReview,
	type TreeseedSceneVisualAuditCapture,
	type TreeseedSceneVisualAuditManifest,
	type TreeseedSceneVisualAuditPaths,
} from '../../../src/scenes/index.ts';

function paths(): TreeseedSceneVisualAuditPaths {
	const root = mkdtempSync(resolve(tmpdir(), 'treeseed-visual-audit-review-'));
	return {
		auditRoot: root,
		manifestPath: resolve(root, 'manifest.json'),
		reportPath: resolve(root, 'report.md'),
		screenshotsRoot: resolve(root, 'screenshots'),
		reviewRoot: resolve(root, 'review'),
		reviewSummaryPath: resolve(root, 'review/summary.json'),
		reviewFindingsPath: resolve(root, 'review/findings.json'),
		reviewAgentBriefPath: resolve(root, 'review/agent-brief.md'),
	};
}

function capture(overrides: Partial<TreeseedSceneVisualAuditCapture>): TreeseedSceneVisualAuditCapture {
	const id = overrides.id ?? 'owner-desktop-app';
	return {
		id,
		routeId: overrides.routeId ?? 'app',
		path: overrides.path ?? '/app',
		pathRoot: overrides.pathRoot ?? '/app',
		role: overrides.role ?? 'owner',
		device: overrides.device ?? 'desktop',
		url: overrides.url ?? 'http://127.0.0.1:4321/app',
		status: overrides.status ?? 'captured',
		httpStatus: overrides.httpStatus ?? 200,
		finalUrl: overrides.finalUrl ?? 'http://127.0.0.1:4321/app',
		screenshotPath: overrides.screenshotPath ?? null,
		fullPageScreenshotPath: null,
		capturedAt: '2026-06-18T00:00:00.000Z',
		durationMs: 10,
		dom: {
			title: 'App',
			h1: 'App',
			headings: ['App'],
			visibleTextSample: 'App dashboard',
			bodyTextLength: 200,
			visibleLinkCount: 1,
			visibleButtonCount: 1,
			visibleInputCount: 0,
			visibleFormCount: 0,
			appShellDetected: true,
			authShellDetected: false,
			publicShellDetected: false,
			horizontalOverflow: false,
			scrollWidth: 1600,
			scrollHeight: 900,
			viewportWidth: 1600,
			viewportHeight: 900,
			defaultStyledLinks: [],
			defaultStyledButtons: [],
			visibleErrorTexts: [],
			seededEntityTexts: ['Visual Audit Team'],
			...overrides.dom,
		},
		clientErrors: [],
		diagnostics: [],
		...overrides,
	};
}

function manifest(captures: TreeseedSceneVisualAuditCapture[]): TreeseedSceneVisualAuditManifest {
	return {
		schemaVersion: 'treeseed.scene.visual-audit/v1',
		phase: 11,
		generatedAt: '2026-06-18T00:00:00.000Z',
		sceneId: 'site-visual-audit',
		auditId: 'audit',
		baseUrl: 'http://127.0.0.1:4321',
		roles: ['anonymous', 'owner'],
		devices: ['desktop', 'mobile'],
		routes: [...new Map(captures.map((entry) => [entry.routeId, {
			id: entry.routeId,
			path: entry.path,
			pathRoot: entry.pathRoot,
			source: 'admin-route-registry' as const,
			requiresAuth: entry.path.startsWith('/app'),
			roles: [entry.role],
			dynamic: false,
		}])).values()],
		captures,
		diagnostics: [],
	};
}

describe('scene visual audit review', () => {
	it('builds client, functional, display, and architecture findings', () => {
		const captures = [
			capture({
				id: 'owner-desktop-app',
				clientErrors: [{ id: 'err-1', captureId: 'owner-desktop-app', kind: 'console', severity: 'error', message: 'React hydration failed', url: 'http://127.0.0.1:4321/app', timestamp: '2026-06-18T00:00:00.000Z' }],
				dom: {
					defaultStyledLinks: [{ text: 'Manage', href: '/app/teams', selectorHint: 'a.manage' }],
					horizontalOverflow: true,
					scrollWidth: 1700,
					viewportWidth: 1600,
				},
			}),
			capture({
				id: 'owner-mobile-teams',
				path: '/app/teams',
				pathRoot: '/app/teams',
				routeId: 'app-teams',
				device: 'mobile',
				dom: {
					defaultStyledLinks: [{ text: 'Manage', href: '/app/teams', selectorHint: 'a.manage' }],
					horizontalOverflow: true,
					scrollWidth: 900,
					viewportWidth: 390,
					seededEntityTexts: [],
				},
			}),
			capture({
				id: 'owner-desktop-projects',
				path: '/app/projects',
				pathRoot: '/app/projects',
				routeId: 'app-projects',
				dom: {
					defaultStyledButtons: [{ text: 'Create project', selectorHint: 'button' }],
					seededEntityTexts: [],
				},
			}),
			capture({
				id: 'anonymous-desktop-app',
				role: 'anonymous',
				path: '/app',
				pathRoot: '/app',
				routeId: 'app',
			}),
		];
		const review = buildTreeseedSceneVisualAuditReview({ manifest: manifest(captures), paths: paths(), detail: 'full', maxFindings: 100 });
		const codes = review.findings.map((entry) => entry.code);

		expect(review.schemaVersion).toBe('treeseed.scene.visual-audit-review/v1');
		expect(codes).toContain('visual.client.runtime_error');
		expect(codes).toContain('visual.display.default_link_style');
		expect(codes).toContain('visual.display.default_button_style');
		expect(codes).toContain('visual.display.horizontal_overflow');
		expect(codes).toContain('visual.functional.anonymous_protected_access');
		expect(codes).toContain('visual.functional.seeded_entity_missing');
		expect(codes).toContain('visual.architecture.shared_ui_control_regression');
		expect(review.findings.some((entry) => entry.suspectedOwner === '@treeseed/ui')).toBe(true);
		expect(review.summary.clientErrorCount).toBe(1);
		expect(review.summary.incidentCount).toBe(1);
		expect(review.summary.rootCauseCount).toBeGreaterThan(0);
		expect(review.incidents[0]?.priorityScore).toBeGreaterThan(0);
		expect(review.rootCauses.some((entry) => entry.title.includes('Shared UI controls'))).toBe(true);
		expect(review.rootCauses[0]?.priorityRank).toBe(1);
		expect(review.clientErrors[0]?.path).toBe('/app');
		expect(review.clientErrors[0]?.role).toBe('owner');
	});

	it('ignores local Astro dev toolbar load failures', () => {
		const captures = [
			capture({
				id: 'owner-desktop-app',
				clientErrors: [
					{
						id: 'err-1',
						captureId: 'owner-desktop-app',
						kind: 'console',
						severity: 'error',
						message: 'Failed to load resource: the server responded with a status of 403 (Forbidden)',
						url: 'http://127.0.0.1:4321/@fs/home/adrian/project/node_modules/astro/dist/runtime/client/dev-toolbar/entrypoint.js?v=123',
						timestamp: '2026-06-18T00:00:00.000Z',
					},
					{
						id: 'err-2',
						captureId: 'owner-desktop-app',
						kind: 'requestfailed',
						severity: 'error',
						message: 'net::ERR_ABORTED',
						url: 'http://127.0.0.1:4321/@fs/home/adrian/project/node_modules/astro/dist/runtime/client/dev-toolbar/entrypoint.js?v=123',
						timestamp: '2026-06-18T00:00:00.000Z',
					},
				],
			}),
		];
		const review = buildTreeseedSceneVisualAuditReview({ manifest: manifest(captures), paths: paths(), detail: 'full', maxFindings: 100 });

		expect(review.summary.clientErrorCount).toBe(0);
		expect(review.findings.map((entry) => entry.code)).not.toContain('visual.client.console_error');
		expect(review.findings.map((entry) => entry.code)).not.toContain('visual.client.request_failed');
	});

	it('writes review JSON, Markdown, agent brief, client errors, routes, and contact sheets', () => {
		const p = paths();
		const screenshot = resolve(p.screenshotsRoot, 'owner/desktop/app/index.png');
		mkdirSync(resolve(p.screenshotsRoot, 'owner/desktop/app'), { recursive: true });
		writeFileSync(screenshot, 'fake', { flag: 'w' });
		const captures = [capture({ screenshotPath: screenshot, dom: { defaultStyledLinks: [{ text: 'Manage', href: '/app/teams', selectorHint: 'a.manage' }] } })];
		const m = manifest(captures);
		const review = buildTreeseedSceneVisualAuditReview({ manifest: m, paths: p });

		writeTreeseedSceneVisualAuditReview({ manifest: m, review, paths: p });

		expect(existsSync(p.reviewSummaryPath!)).toBe(true);
		expect(existsSync(p.reviewFindingsPath!)).toBe(true);
		expect(existsSync(p.reviewAgentBriefPath!)).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'root-causes.json'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'root-causes.jsonl'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'incidents.json'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'incidents.jsonl'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'issue-index.json'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'query/top-priority.json'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'query/by-owner.json'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'findings.md'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'client-errors.jsonl'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'owner-briefs/treeseed-ui.md'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'owner-briefs/treeseed-admin.md'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'routes.json'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'contact-sheets/index.html'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'contact-sheets/flagged.html'))).toBe(true);
		expect(existsSync(resolve(p.reviewRoot!, 'contact-sheets/root-causes.html'))).toBe(true);
		expect(readFileSync(resolve(p.reviewRoot!, 'findings.md'), 'utf8')).toContain('## Root Causes');
		expect(readFileSync(resolve(p.reviewRoot!, 'owner-briefs/treeseed-ui.md'), 'utf8')).toContain('Visual Audit Brief: @treeseed/ui');
		expect(readFileSync(resolve(p.reviewRoot!, 'owner-briefs/treeseed-ui.md'), 'utf8')).toContain('## Priority Queue');
		expect(readFileSync(p.reviewAgentBriefPath!, 'utf8')).toContain('Architecture Guidance');
		expect(readFileSync(p.reviewAgentBriefPath!, 'utf8')).toContain('Raw Client Error Interpretation');
		expect(readFileSync(p.reviewAgentBriefPath!, 'utf8')).toContain('Root Causes To Assign First');
		expect(readFileSync(resolve(p.reviewRoot!, 'contact-sheets/flagged.html'), 'utf8')).toContain('display.default_link_style');
	});
});
