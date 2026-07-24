import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type {
	SceneDiagnostic,
	SceneVisualAuditCapture,
	SceneVisualAuditClientError,
	SceneVisualAuditClientErrorIncident,
	SceneVisualAuditFinding,
	SceneVisualAuditFindingOwner,
	SceneVisualAuditFindingSeverity,
	SceneVisualAuditManifest,
	SceneVisualAuditPaths,
	SceneVisualAuditReview,
	SceneVisualAuditReviewCategory,
	SceneVisualAuditReviewDetail,
	SceneVisualAuditRole,
	SceneVisualAuditRootCause,
} from '../types.ts';
import { writeSceneVisualAuditContactSheets } from '../support/visual-audit/visual-audit-contact-sheets.ts';


export const SEVERITIES: SceneVisualAuditFindingSeverity[] = ['blocking', 'high', 'medium', 'low', 'info'];

export const CATEGORIES: SceneVisualAuditReviewCategory[] = ['functional', 'client-error', 'display', 'content', 'architecture'];

export const OWNERS: SceneVisualAuditFindingOwner[] = ['@treeseed/ui', '@treeseed/admin', '@treeseed/core', '@treeseed/market', '@treeseed/api', '@treeseed/sdk', '@treeseed/cli', 'unknown'];

export function md(value: unknown) {
	return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

export function rel(root: string, path: string | null) {
	return path ? relative(root, path) : '';
}

export function isSceneVisualAuditIgnoredClientError(error: Pick<SceneVisualAuditClientError, 'url' | 'message'>) {
	const url = error.url ?? '';
	const message = error.message ?? '';
	if (/^chrome-extension:/iu.test(url) || /^devtools:/iu.test(url)) return true;
	if (/favicon\.ico/iu.test(url) && /404|failed to load resource|ERR_ABORTED/iu.test(message)) return true;
	if (/\.map(?:\?|$)/iu.test(url) && /404|failed to load resource|ERR_ABORTED/iu.test(message)) return true;
	if (url.includes('/@fs/') && url.includes('/astro/dist/runtime/client/dev-toolbar/')) return true;
	if (url.includes('/node_modules/astro/dist/runtime/client/dev-toolbar/')) return true;
	if (/dev-toolbar\/entrypoint\.js/iu.test(url)) return true;
	if (/dev-toolbar\/entrypoint\.js/iu.test(message) && /403|ERR_ABORTED|failed to load resource/iu.test(message)) return true;
	return false;
}

export function countMap<T extends string>(keys: readonly T[]) {
	return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

export function priorityBand(score: number): 'critical' | 'high' | 'medium' | 'low' {
	if (score >= 1100) return 'critical';
	if (score >= 800) return 'high';
	if (score >= 450) return 'medium';
	return 'low';
}

export function priorityScore(input: {
	severity: SceneVisualAuditFindingSeverity;
	category: SceneVisualAuditReviewCategory;
	owner: SceneVisualAuditFindingOwner;
	count: number;
	pathCount: number;
	roleCount: number;
	deviceCount: number;
	code: string;
}) {
	const severityWeight: Record<SceneVisualAuditFindingSeverity, number> = {
		blocking: 1000,
		high: 700,
		medium: 350,
		low: 100,
		info: 25,
	};
	const categoryWeight: Record<SceneVisualAuditReviewCategory, number> = {
		'client-error': 150,
		functional: 125,
		display: 75,
		content: 40,
		architecture: 200,
	};
	let ownerWeight = 0;
	if (input.owner === '@treeseed/api' && /seeded|fixture|access/iu.test(input.code)) ownerWeight = 80;
	else if (input.owner === '@treeseed/admin') ownerWeight = 60;
	else if (input.owner === '@treeseed/core') ownerWeight = 50;
	else if (input.owner === '@treeseed/ui') ownerWeight = 50;
	return severityWeight[input.severity]
		+ Math.min(input.count, 100) * 4
		+ input.pathCount * 20
		+ input.roleCount * 30
		+ input.deviceCount * 25
		+ categoryWeight[input.category]
		+ ownerWeight;
}

export function pathOwner(path: string): SceneVisualAuditFindingOwner {
	if (path === '/' || path.startsWith('/market')) return '@treeseed/market';
	if (path.startsWith('/auth') || path.startsWith('/app') || path.startsWith('/t/') || path.startsWith('/u/') || path.startsWith('/team-invites')) return '@treeseed/admin';
	if (path.startsWith('/books') || path.startsWith('/notes') || path.startsWith('/questions') || path.startsWith('/objectives') || path.startsWith('/proposals') || path.startsWith('/decisions') || path.startsWith('/people') || path.startsWith('/agents') || path.startsWith('/contact') || path.startsWith('/knowledge')) return '@treeseed/core';
	return 'unknown';
}

export function ownerFor(input: { capture: SceneVisualAuditCapture; category: SceneVisualAuditReviewCategory; code: string }): SceneVisualAuditFindingOwner {
	if (input.code.includes('fixture') || input.code.includes('seeded_entity')) return '@treeseed/api';
	if (input.code.includes('default_link') || input.code.includes('default_button') || input.code.includes('horizontal_overflow') || input.code.includes('mobile_desktop')) return '@treeseed/ui';
	if (input.category === 'client-error' && input.capture.path.startsWith('/app')) return '@treeseed/admin';
	return pathOwner(input.capture.path);
}

export function guidance(owner: SceneVisualAuditFindingOwner, code: string) {
	if (owner === '@treeseed/ui') return 'Start with shared @treeseed/ui components and CSS tokens/classes. Avoid route-local CSS unless the issue is genuinely route-specific.';
	if (owner === '@treeseed/admin') return 'Inspect admin route composition, client initialization, session handling, and use of shared UI components before patching individual markup.';
	if (owner === '@treeseed/core') return 'Inspect core public/book layout style loading and reusable public layout integration before adding page-local styles.';
	if (owner === '@treeseed/market') return 'Inspect root tenant overrides and market branding styles while keeping shared reusable controls in @treeseed/ui.';
	if (owner === '@treeseed/api') return 'Fix fixture, session, authorization, or PostgreSQL-backed data behavior in @treeseed/api; do not add SDK-side database writes.';
	if (owner === '@treeseed/sdk') return 'Inspect the scene visual-audit capture/review implementation and artifact contract.';
	return `Investigate the owning package for ${code}, then prefer a reusable architectural fix over divergent local patches.`;
}

export function recommendedAction(owner: SceneVisualAuditFindingOwner, code: string) {
	if (code.includes('client') || code.includes('http_error') || code.includes('visible_error')) {
		if (owner === '@treeseed/core') return 'Reproduce the route locally, inspect the server stack trace and route build/runtime dependency, then fix the shared core route or package build contract.';
		if (owner === '@treeseed/admin') return 'Fix the route handler, client initializer, or session/data dependency at the admin shell/view-model boundary before styling the page.';
		return 'Resolve the runtime error first, then rerun visual audit before doing visual polish on the affected route.';
	}
	if (code.includes('default_link') || code.includes('default_button')) return 'Add or repair the reusable UI component/class in @treeseed/ui, then update route markup to use that shared primitive instead of browser-default controls.';
	if (code.includes('seeded_entity')) return 'Verify visual-audit seed data, role membership, API lookup keys, and admin view-model access before changing page markup.';
	if (code.includes('final_url_mismatch')) return 'Declare intentional redirects in route expectations or fix unexpected redirects at the owning route boundary.';
	if (code.includes('blank_or_low_content')) return 'Treat this as a route rendering failure unless the route is intentionally empty; inspect data loading and responsive layout.';
	if (code.includes('architecture')) return 'Fix this as a shared architectural issue and avoid route-local patches that create divergent UI or data behavior.';
	return 'Inspect the examples in this cluster and prefer a reusable package-level fix over a local patch.';
}

export function finding(input: {
	index: number;
	capture: SceneVisualAuditCapture;
	severity: SceneVisualAuditFindingSeverity;
	category: SceneVisualAuditReviewCategory;
	code: string;
	title: string;
	message: string;
	evidence?: Record<string, unknown>;
	owner?: SceneVisualAuditFindingOwner;
}): SceneVisualAuditFinding {
	const suspectedOwner = input.owner ?? ownerFor({ capture: input.capture, category: input.category, code: input.code });
	return {
		id: `finding-${String(input.index).padStart(4, '0')}`,
		severity: input.severity,
		category: input.category,
		code: input.code,
		title: input.title,
		message: input.message,
		path: input.capture.path,
		pathRoot: input.capture.pathRoot,
		role: input.capture.role,
		device: input.capture.device,
		captureId: input.capture.id,
		screenshotPath: input.capture.screenshotPath,
		finalUrl: input.capture.finalUrl,
		suspectedOwner,
		architectureGuidance: guidance(suspectedOwner, input.code),
		evidence: input.evidence ?? {},
	};
}

export function finalPath(capture: SceneVisualAuditCapture) {
	if (!capture.finalUrl) return null;
	try {
		return new URL(capture.finalUrl).pathname;
	} catch {
		return capture.finalUrl;
	}
}

export function isProtected(path: string) {
	return path.startsWith('/app') || path.startsWith('/t/') || path.startsWith('/u/') || path.startsWith('/team-invites');
}

export function includesSignIn(path: string | null) {
	return !!path && (path.includes('/auth/sign-in') || path.includes('/auth/register'));
}

export function statusExpected(status: number, expected: number | number[] | null | undefined) {
	if (!expected) return status < 400;
	return Array.isArray(expected) ? expected.includes(status) : status === expected;
}

export function captureFindings(capture: SceneVisualAuditCapture, indexStart: number, route?: SceneVisualAuditManifest['routes'][number]) {
	const findings: SceneVisualAuditFinding[] = [];
	let index = indexStart;
	const push = (input: Omit<Parameters<typeof finding>[0], 'index' | 'capture'>) => findings.push(finding({ ...input, index: index += 1, capture }));
	const final = finalPath(capture);
	if (capture.status === 'failed') {
		push({ severity: 'high', category: 'functional', code: 'visual.functional.capture_failed', title: 'Capture failed', message: `Visual audit could not capture ${capture.path}.`, evidence: { diagnostics: capture.diagnostics } });
	}
	if (capture.status === 'skipped') {
		push({ severity: 'medium', category: 'functional', code: 'visual.functional.capture_skipped', title: 'Capture skipped', message: `Visual audit skipped ${capture.path}.`, evidence: { diagnostics: capture.diagnostics } });
	}
	if (capture.httpStatus && capture.httpStatus >= 400 && !statusExpected(capture.httpStatus, route?.expectedStatus)) {
		push({ severity: capture.httpStatus >= 500 ? 'high' : 'medium', category: 'functional', code: 'visual.functional.http_error', title: 'HTTP error', message: `Route returned HTTP ${capture.httpStatus}.`, evidence: { httpStatus: capture.httpStatus } });
	}
	if (capture.role !== 'anonymous' && isProtected(capture.path) && includesSignIn(final)) {
		push({ severity: 'high', category: 'functional', code: 'visual.functional.auth_redirect_unexpected', title: 'Authenticated route redirected to auth', message: `${capture.role} was redirected from ${capture.path} to ${final}.`, evidence: { finalUrl: capture.finalUrl } });
	}
	if (capture.role === 'anonymous' && isProtected(capture.path) && capture.status === 'captured' && capture.httpStatus === 200 && !includesSignIn(final) && route?.expectedAuthRedirect !== true) {
		push({ severity: 'high', category: 'functional', code: 'visual.functional.anonymous_protected_access', title: 'Anonymous protected access', message: `Anonymous role reached protected route ${capture.path}.`, evidence: { finalUrl: capture.finalUrl } });
	}
	if (capture.status === 'captured' && final && !includesSignIn(final) && final !== capture.path && !capture.path.endsWith('/') && final.replace(/\/$/u, '') !== capture.path.replace(/\/$/u, '') && (!route?.expectedFinalPath || final !== route.expectedFinalPath)) {
		push({ severity: 'medium', category: 'functional', code: 'visual.functional.final_url_mismatch', title: 'Final URL differs from requested path', message: `Requested ${capture.path} but ended at ${final}.`, evidence: { finalUrl: capture.finalUrl } });
	}
	const dom = capture.dom;
	if (dom) {
		const seededEntityTexts = dom.seededEntityTexts ?? [];
		const defaultStyledLinks = dom.defaultStyledLinks ?? [];
		const defaultStyledButtons = dom.defaultStyledButtons ?? [];
		const visibleErrorTexts = dom.visibleErrorTexts ?? [];
		if (capture.role !== 'anonymous' && (capture.path.startsWith('/app/teams') || capture.path.startsWith('/app/projects') || capture.path === '/app') && seededEntityTexts.length === 0) {
			push({ severity: 'medium', category: 'functional', code: 'visual.functional.seeded_entity_missing', title: 'Seeded visual-audit entity not visible', message: `Expected visual-audit seeded team or project text was not visible on ${capture.path}.`, evidence: { seededEntityTexts } });
		}
		if (defaultStyledLinks.length > 0) {
			push({ severity: capture.path.startsWith('/app') ? 'high' : 'medium', category: 'display', code: 'visual.display.default_link_style', title: 'Default-styled command link detected', message: `${defaultStyledLinks.length} visible link(s) look like browser-default links.`, evidence: { links: defaultStyledLinks.slice(0, 6) } });
		}
		if (defaultStyledButtons.length > 0) {
			push({ severity: capture.path.startsWith('/app') ? 'high' : 'medium', category: 'display', code: 'visual.display.default_button_style', title: 'Default-styled button detected', message: `${defaultStyledButtons.length} visible button(s) look unstyled.`, evidence: { buttons: defaultStyledButtons.slice(0, 6) } });
		}
		if (dom.horizontalOverflow) {
			push({ severity: capture.device === 'mobile' || capture.device === 'tablet' ? 'high' : 'medium', category: 'display', code: 'visual.display.horizontal_overflow', title: 'Horizontal overflow detected', message: `Document scroll width ${dom.scrollWidth} exceeds viewport ${dom.viewportWidth}.`, evidence: { scrollWidth: dom.scrollWidth, viewportWidth: dom.viewportWidth } });
		}
		if (visibleErrorTexts.length > 0 && route?.expectedEmpty !== true) {
			push({ severity: 'high', category: 'display', code: 'visual.display.visible_error_text', title: 'Visible error text', message: 'The page contains visible error or runtime failure text.', evidence: { visibleErrorTexts: visibleErrorTexts.slice(0, 8) } });
		}
		if (capture.status === 'captured' && dom.bodyTextLength < 40 && dom.visibleLinkCount + dom.visibleButtonCount + dom.visibleInputCount < 3 && route?.expectedEmpty !== true) {
			push({ severity: capture.path.startsWith('/app') || capture.path.startsWith('/auth') ? 'high' : 'medium', category: 'display', code: 'visual.display.blank_or_low_content', title: 'Blank or low-content page', message: 'The captured page has very little visible text or interactive content.', evidence: { bodyTextLength: dom.bodyTextLength } });
		}
		if (capture.device === 'mobile' && dom.horizontalOverflow) {
			push({ severity: 'high', category: 'display', code: 'visual.display.mobile_desktop_layout', title: 'Mobile layout appears to overflow', message: 'Mobile viewport appears to be rendering a desktop-width layout.', evidence: { scrollWidth: dom.scrollWidth, viewportWidth: dom.viewportWidth } });
		}
	}
	return findings;
}

export type EnrichedClientError = SceneVisualAuditClientError & {
	path: string;
	pathRoot: string;
	role: SceneVisualAuditRole;
	device: string;
	screenshotPath: string | null;
	finalUrl: string | null;
};

export function normalizedErrorMessage(error: SceneVisualAuditClientError) {
	const message = error.message.replace(/\bhttps?:\/\/\S+/giu, '<url>').replace(/\s+/gu, ' ').trim();
	if (/Failed to load resource.+status of 500|server responded with a status of 500|HTTP\s+500/iu.test(message)) return 'http-500';
	if (/Failed to load resource.+status of 404|server responded with a status of 404|HTTP\s+404/iu.test(message)) return 'http-404';
	if (/ERR_ABORTED|Request failed/iu.test(message)) return 'request-aborted';
	if (/hydration|runtime|react|astro|vite/iu.test(message)) return 'client-runtime';
	return message.slice(0, 140);
}

export function errorIncidentCode(error: SceneVisualAuditClientError) {
	const normalized = normalizedErrorMessage(error);
	if (normalized === 'http-500') return 'visual.client.http_500';
	if (normalized === 'http-404') return 'visual.client.http_404';
	if (normalized === 'request-aborted') return 'visual.client.request_aborted';
	if (normalized === 'client-runtime') return 'visual.client.runtime_error';
	if (error.kind === 'pageerror' || error.kind === 'uncaught-exception') return 'visual.client.page_error';
	if (error.kind === 'http-error') return 'visual.client.http_subresource_error';
	if (error.kind === 'requestfailed') return 'visual.client.request_failed';
	return 'visual.client.console_error';
}
