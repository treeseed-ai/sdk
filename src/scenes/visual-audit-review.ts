import { mkdirSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneVisualAuditCapture,
	TreeseedSceneVisualAuditClientError,
	TreeseedSceneVisualAuditClientErrorIncident,
	TreeseedSceneVisualAuditFinding,
	TreeseedSceneVisualAuditFindingOwner,
	TreeseedSceneVisualAuditFindingSeverity,
	TreeseedSceneVisualAuditManifest,
	TreeseedSceneVisualAuditPaths,
	TreeseedSceneVisualAuditReview,
	TreeseedSceneVisualAuditReviewCategory,
	TreeseedSceneVisualAuditReviewDetail,
	TreeseedSceneVisualAuditRole,
	TreeseedSceneVisualAuditRootCause,
} from './types.ts';
import { writeTreeseedSceneVisualAuditContactSheets } from './visual-audit-contact-sheets.ts';

const SEVERITIES: TreeseedSceneVisualAuditFindingSeverity[] = ['blocking', 'high', 'medium', 'low', 'info'];
const CATEGORIES: TreeseedSceneVisualAuditReviewCategory[] = ['functional', 'client-error', 'display', 'content', 'architecture'];
const OWNERS: TreeseedSceneVisualAuditFindingOwner[] = ['@treeseed/ui', '@treeseed/admin', '@treeseed/core', '@treeseed/market', '@treeseed/api', '@treeseed/sdk', '@treeseed/cli', 'unknown'];

function md(value: unknown) {
	return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function rel(root: string, path: string | null) {
	return path ? relative(root, path) : '';
}

export function isTreeseedSceneVisualAuditIgnoredClientError(error: Pick<TreeseedSceneVisualAuditClientError, 'url' | 'message'>) {
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

function countMap<T extends string>(keys: readonly T[]) {
	return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function priorityBand(score: number): 'critical' | 'high' | 'medium' | 'low' {
	if (score >= 1100) return 'critical';
	if (score >= 800) return 'high';
	if (score >= 450) return 'medium';
	return 'low';
}

function priorityScore(input: {
	severity: TreeseedSceneVisualAuditFindingSeverity;
	category: TreeseedSceneVisualAuditReviewCategory;
	owner: TreeseedSceneVisualAuditFindingOwner;
	count: number;
	pathCount: number;
	roleCount: number;
	deviceCount: number;
	code: string;
}) {
	const severityWeight: Record<TreeseedSceneVisualAuditFindingSeverity, number> = {
		blocking: 1000,
		high: 700,
		medium: 350,
		low: 100,
		info: 25,
	};
	const categoryWeight: Record<TreeseedSceneVisualAuditReviewCategory, number> = {
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

function pathOwner(path: string): TreeseedSceneVisualAuditFindingOwner {
	if (path === '/' || path.startsWith('/market')) return '@treeseed/market';
	if (path.startsWith('/auth') || path.startsWith('/app') || path.startsWith('/t/') || path.startsWith('/u/') || path.startsWith('/team-invites')) return '@treeseed/admin';
	if (path.startsWith('/books') || path.startsWith('/notes') || path.startsWith('/questions') || path.startsWith('/objectives') || path.startsWith('/proposals') || path.startsWith('/decisions') || path.startsWith('/people') || path.startsWith('/agents') || path.startsWith('/contact') || path.startsWith('/knowledge')) return '@treeseed/core';
	return 'unknown';
}

function ownerFor(input: { capture: TreeseedSceneVisualAuditCapture; category: TreeseedSceneVisualAuditReviewCategory; code: string }): TreeseedSceneVisualAuditFindingOwner {
	if (input.code.includes('fixture') || input.code.includes('seeded_entity')) return '@treeseed/api';
	if (input.code.includes('default_link') || input.code.includes('default_button') || input.code.includes('horizontal_overflow') || input.code.includes('mobile_desktop')) return '@treeseed/ui';
	if (input.category === 'client-error' && input.capture.path.startsWith('/app')) return '@treeseed/admin';
	return pathOwner(input.capture.path);
}

function guidance(owner: TreeseedSceneVisualAuditFindingOwner, code: string) {
	if (owner === '@treeseed/ui') return 'Start with shared @treeseed/ui components and CSS tokens/classes. Avoid route-local CSS unless the issue is genuinely route-specific.';
	if (owner === '@treeseed/admin') return 'Inspect admin route composition, client initialization, session handling, and use of shared UI components before patching individual markup.';
	if (owner === '@treeseed/core') return 'Inspect core public/book layout style loading and reusable public layout integration before adding page-local styles.';
	if (owner === '@treeseed/market') return 'Inspect root tenant overrides and market branding styles while keeping shared reusable controls in @treeseed/ui.';
	if (owner === '@treeseed/api') return 'Fix fixture, session, authorization, or PostgreSQL-backed data behavior in @treeseed/api; do not add SDK-side database writes.';
	if (owner === '@treeseed/sdk') return 'Inspect the scene visual-audit capture/review implementation and artifact contract.';
	return `Investigate the owning package for ${code}, then prefer a reusable architectural fix over divergent local patches.`;
}

function recommendedAction(owner: TreeseedSceneVisualAuditFindingOwner, code: string) {
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

function finding(input: {
	index: number;
	capture: TreeseedSceneVisualAuditCapture;
	severity: TreeseedSceneVisualAuditFindingSeverity;
	category: TreeseedSceneVisualAuditReviewCategory;
	code: string;
	title: string;
	message: string;
	evidence?: Record<string, unknown>;
	owner?: TreeseedSceneVisualAuditFindingOwner;
}): TreeseedSceneVisualAuditFinding {
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

function finalPath(capture: TreeseedSceneVisualAuditCapture) {
	if (!capture.finalUrl) return null;
	try {
		return new URL(capture.finalUrl).pathname;
	} catch {
		return capture.finalUrl;
	}
}

function isProtected(path: string) {
	return path.startsWith('/app') || path.startsWith('/t/') || path.startsWith('/u/') || path.startsWith('/team-invites');
}

function includesSignIn(path: string | null) {
	return !!path && (path.includes('/auth/sign-in') || path.includes('/auth/register'));
}

function statusExpected(status: number, expected: number | number[] | null | undefined) {
	if (!expected) return status < 400;
	return Array.isArray(expected) ? expected.includes(status) : status === expected;
}

function captureFindings(capture: TreeseedSceneVisualAuditCapture, indexStart: number, route?: TreeseedSceneVisualAuditManifest['routes'][number]) {
	const findings: TreeseedSceneVisualAuditFinding[] = [];
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

type EnrichedClientError = TreeseedSceneVisualAuditClientError & {
	path: string;
	pathRoot: string;
	role: TreeseedSceneVisualAuditRole;
	device: string;
	screenshotPath: string | null;
	finalUrl: string | null;
};

function normalizedErrorMessage(error: TreeseedSceneVisualAuditClientError) {
	const message = error.message.replace(/\bhttps?:\/\/\S+/giu, '<url>').replace(/\s+/gu, ' ').trim();
	if (/Failed to load resource.+status of 500|server responded with a status of 500|HTTP\s+500/iu.test(message)) return 'http-500';
	if (/Failed to load resource.+status of 404|server responded with a status of 404|HTTP\s+404/iu.test(message)) return 'http-404';
	if (/ERR_ABORTED|Request failed/iu.test(message)) return 'request-aborted';
	if (/hydration|runtime|react|astro|vite/iu.test(message)) return 'client-runtime';
	return message.slice(0, 140);
}

function errorIncidentCode(error: TreeseedSceneVisualAuditClientError) {
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

function incidentTitle(code: string) {
	if (code === 'visual.client.http_500') return 'Routes return HTTP 500';
	if (code === 'visual.client.http_404') return 'Routes reference missing HTTP 404 resources';
	if (code === 'visual.client.request_aborted') return 'Requests abort during navigation';
	if (code === 'visual.client.runtime_error') return 'Client runtime errors occur';
	if (code === 'visual.client.page_error') return 'Uncaught page errors occur';
	return 'Client-side errors occur';
}

function incidentSeverity(error: TreeseedSceneVisualAuditClientError): TreeseedSceneVisualAuditFindingSeverity {
	if (error.kind === 'pageerror' || error.kind === 'uncaught-exception') return 'blocking';
	if ((error.status ?? 0) >= 500 || normalizedErrorMessage(error) === 'http-500') return 'high';
	if ((error.status ?? 0) >= 400 || normalizedErrorMessage(error) === 'http-404') return 'medium';
	if (normalizedErrorMessage(error) === 'request-aborted') return 'medium';
	return error.severity === 'error' ? 'high' : 'medium';
}

function incidentKey(error: EnrichedClientError) {
	return [
		errorIncidentCode(error),
		pathOwner(error.path),
		error.pathRoot,
		normalizedErrorMessage(error),
	].join('|');
}

function buildClientErrorIncidents(errors: EnrichedClientError[]): TreeseedSceneVisualAuditClientErrorIncident[] {
	const grouped = new Map<string, EnrichedClientError[]>();
	for (const error of errors) {
		if (normalizedErrorMessage(error) === 'request-aborted' && error.finalUrl) continue;
		const list = grouped.get(incidentKey(error)) ?? [];
		list.push(error);
		grouped.set(incidentKey(error), list);
	}
	const output: TreeseedSceneVisualAuditClientErrorIncident[] = [];
	let index = 0;
	for (const list of grouped.values()) {
		const first = list[0];
		if (!first) continue;
		const code = errorIncidentCode(first);
		const owner = pathOwner(first.path);
		const paths = compactList(list.map((entry) => entry.path));
		const pathRoots = compactList(list.map((entry) => entry.pathRoot));
		const roles = compactList(list.map((entry) => entry.role));
		const devices = compactList(list.map((entry) => entry.device));
		const captureIds = compactList(list.map((entry) => entry.captureId));
		const severity = list.reduce<TreeseedSceneVisualAuditFindingSeverity>((best, entry) => severityRank(incidentSeverity(entry)) < severityRank(best) ? incidentSeverity(entry) : best, incidentSeverity(first));
		const score = priorityScore({
			severity,
			category: 'client-error',
			owner,
			count: list.length,
			pathCount: paths.length,
			roleCount: roles.length,
			deviceCount: devices.length,
			code,
		});
		output.push({
			id: `incident-${String(index += 1).padStart(3, '0')}`,
			severity,
			primaryKind: first.kind,
			code,
			title: incidentTitle(code),
			message: `${first.message} Seen ${list.length} raw event(s) across ${paths.length} path(s), ${roles.length} role(s), and ${devices.length} device profile(s).`,
			normalizedMessage: normalizedErrorMessage(first),
			suspectedOwner: owner,
			count: list.length,
			pathRoots,
			paths,
			roles,
			devices,
			captureIds,
			errorIds: list.map((entry) => entry.id),
			exampleScreenshotPath: list.find((entry) => entry.screenshotPath)?.screenshotPath ?? null,
			exampleFinalUrl: first.finalUrl,
			status: first.status ?? null,
			url: first.url,
			priorityScore: score,
			priorityRank: 0,
			recommendedAction: recommendedAction(owner, code),
			architectureGuidance: guidance(owner, code),
		});
	}
	return output.sort((a, b) => b.priorityScore - a.priorityScore || severityRank(a.severity) - severityRank(b.severity) || b.count - a.count)
		.map((entry, priorityRank) => ({ ...entry, priorityRank: priorityRank + 1 }));
}

function incidentFindings(incidents: TreeseedSceneVisualAuditClientErrorIncident[], captures: TreeseedSceneVisualAuditCapture[], indexStart: number) {
	const byId = new Map(captures.map((capture) => [capture.id, capture]));
	const output: TreeseedSceneVisualAuditFinding[] = [];
	let index = indexStart;
	for (const incident of incidents) {
		const capture = incident.captureIds.map((id) => byId.get(id)).find(Boolean);
		if (!capture) continue;
		output.push(finding({
			index: index += 1,
			capture,
			severity: incident.severity,
			category: 'client-error',
			code: incident.code,
			title: incident.title,
			message: incident.message,
			owner: incident.suspectedOwner,
			evidence: { incidentId: incident.id, rawErrorCount: incident.count, errorIds: incident.errorIds.slice(0, 20) },
		}));
	}
	return output;
}

function architectureFindings(captures: TreeseedSceneVisualAuditCapture[], findings: TreeseedSceneVisualAuditFinding[], indexStart: number) {
	const output: TreeseedSceneVisualAuditFinding[] = [];
	let index = indexStart;
	const sample = captures.find((capture) => capture.path.startsWith('/app')) ?? captures[0];
	if (!sample) return output;
	const repeated = (code: string) => findings.filter((entry) => entry.code === code);
	const push = (code: string, title: string, message: string, owner: TreeseedSceneVisualAuditFindingOwner, evidence: Record<string, unknown>) => {
		output.push(finding({ index: index += 1, capture: sample, severity: 'high', category: 'architecture', code, title, message, owner, evidence }));
	};
	if (new Set(repeated('visual.display.default_link_style').map((entry) => entry.path)).size >= 2 || new Set(repeated('visual.display.default_button_style').map((entry) => entry.path)).size >= 2) {
		push('visual.architecture.shared_ui_control_regression', 'Repeated shared UI control styling regression', 'Default-looking links or buttons repeat across multiple routes. Treat this as a shared UI package styling/component contract issue first.', '@treeseed/ui', { findingCodes: ['visual.display.default_link_style', 'visual.display.default_button_style'] });
	}
	if (new Set(findings.filter((entry) => entry.code === 'visual.functional.auth_redirect_unexpected').map((entry) => entry.path)).size >= 3) {
		push('visual.architecture.admin_shell_regression', 'Repeated authenticated route redirect regression', 'Multiple authenticated app routes redirected to auth. Inspect admin session/shell behavior before fixing individual pages.', '@treeseed/admin', {});
	}
	if (new Set(findings.filter((entry) => entry.code === 'visual.functional.seeded_entity_missing').map((entry) => entry.path)).size >= 3) {
		push('visual.architecture.api_fixture_or_access_regression', 'Repeated seeded entity visibility regression', 'Seeded fixture entities are missing on multiple app routes. Verify API fixture/session/data behavior before page-local fixes.', '@treeseed/api', {});
	}
	return output;
}

function severityRank(value: TreeseedSceneVisualAuditFindingSeverity) {
	return SEVERITIES.indexOf(value);
}

function filteredFindings(findings: TreeseedSceneVisualAuditFinding[], detail: TreeseedSceneVisualAuditReviewDetail, maxFindings: number) {
	const sorted = [...findings].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.path.localeCompare(b.path) || a.code.localeCompare(b.code));
	const byDetail = detail === 'summary' ? sorted.filter((entry) => entry.severity === 'blocking' || entry.severity === 'high') : sorted;
	return byDetail.slice(0, maxFindings);
}

function expectedFindingNoise(findingEntry: TreeseedSceneVisualAuditFinding) {
	if (findingEntry.pathRoot !== '/404') return false;
	if (findingEntry.code === 'visual.functional.http_error') return true;
	if (findingEntry.code === 'visual.display.visible_error_text') return true;
	if (findingEntry.code === 'visual.client.console_error' && /404|not found/iu.test(findingEntry.message)) return true;
	return false;
}

function messageSignature(findingEntry: TreeseedSceneVisualAuditFinding) {
	const evidence = JSON.stringify(findingEntry.evidence);
	if (/ENOENT.+starlight\/routes\/ssr/isu.test(findingEntry.message) || /starlight\/routes\/ssr/iu.test(evidence)) return 'missing-starlight-ssr-vendor';
	if (/HTTP\s+500/iu.test(findingEntry.message) || findingEntry.message.includes('Internal Server Error')) return 'http-500';
	if (/HTTP\s+404|status of 404|not found/iu.test(findingEntry.message)) return 'http-404';
	if (/ERR_ABORTED/iu.test(findingEntry.message)) return 'request-aborted';
	if (/hydration|runtime|react|astro|vite/iu.test(findingEntry.message)) return 'client-runtime';
	return findingEntry.message.replace(/\bhttps?:\/\/\S+/giu, '<url>').replace(/\s+/gu, ' ').slice(0, 90);
}

function rootCauseKey(findingEntry: TreeseedSceneVisualAuditFinding) {
	if (findingEntry.category === 'architecture') return `${findingEntry.code}|${findingEntry.suspectedOwner}`;
	if (findingEntry.code === 'visual.display.default_link_style' || findingEntry.code === 'visual.display.default_button_style') return `${findingEntry.code}|${findingEntry.suspectedOwner}|shared-controls`;
	if (findingEntry.code === 'visual.functional.seeded_entity_missing') return `${findingEntry.code}|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}`;
	if (findingEntry.code === 'visual.functional.final_url_mismatch') return `${findingEntry.code}|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}`;
	if (findingEntry.category === 'client-error' || findingEntry.code === 'visual.functional.http_error' || findingEntry.code === 'visual.display.visible_error_text' || findingEntry.code === 'visual.display.blank_or_low_content') {
		return `visual.runtime_or_empty_route|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}|${messageSignature(findingEntry)}`;
	}
	return `${findingEntry.code}|${findingEntry.suspectedOwner}|${findingEntry.pathRoot}`;
}

function compactList<T extends string>(values: T[]) {
	return [...new Set(values)].sort();
}

function rootCauseTitle(findings: TreeseedSceneVisualAuditFinding[]) {
	const first = findings[0];
	if (!first) return 'Visual audit finding cluster';
	if (first.code === 'visual.display.default_link_style' || first.code === 'visual.display.default_button_style') return 'Shared UI controls are falling back to browser-default styling';
	if (first.code === 'visual.functional.seeded_entity_missing') return 'Seeded visual-audit entities are missing from app routes';
	if (first.code === 'visual.functional.final_url_mismatch') return 'Routes end at unexpected final URLs';
	if (messageSignature(first) === 'missing-starlight-ssr-vendor') return 'Routes fail because the Core/Starlight SSR vendor file is missing';
	if (messageSignature(first) === 'http-500') return 'Routes return HTTP 500';
	if (messageSignature(first) === 'http-404') return 'Routes return HTTP 404';
	if (messageSignature(first) === 'request-aborted') return 'Requests abort during navigation';
	if (messageSignature(first) === 'client-runtime') return 'Client runtime errors are visible in the browser';
	if (first.code === 'visual.display.blank_or_low_content') return 'Routes render blank or very low-content pages';
	return first.title;
}

function rootCauseMessage(findings: TreeseedSceneVisualAuditFinding[]) {
	const first = findings[0];
	if (!first) return '';
	const paths = compactList(findings.map((entry) => entry.path));
	const roles = compactList(findings.map((entry) => entry.role));
	const devices = compactList(findings.map((entry) => entry.device));
	return `${first.message} Seen ${findings.length} time(s) across ${paths.length} path(s), ${roles.length} role(s), and ${devices.length} device profile(s).`;
}

function buildRootCauses(findings: TreeseedSceneVisualAuditFinding[]) {
	const grouped = new Map<string, TreeseedSceneVisualAuditFinding[]>();
	for (const findingEntry of findings) {
		const key = rootCauseKey(findingEntry);
		const list = grouped.get(key) ?? [];
		list.push(findingEntry);
		grouped.set(key, list);
	}
	const output: TreeseedSceneVisualAuditRootCause[] = [];
	let index = 0;
	for (const list of grouped.values()) {
		const sorted = [...list].sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.path.localeCompare(b.path));
		const first = sorted[0];
		if (!first) continue;
		const pathRoots = compactList(sorted.map((entry) => entry.pathRoot));
		const paths = compactList(sorted.map((entry) => entry.path));
		const roles = compactList(sorted.map((entry) => entry.role));
		const devices = compactList(sorted.map((entry) => entry.device));
		const captureIds = compactList(sorted.map((entry) => entry.captureId));
		const severity = sorted.reduce((best, entry) => severityRank(entry.severity) < severityRank(best) ? entry.severity : best, first.severity);
		const score = priorityScore({
			severity,
			category: first.category,
			owner: first.suspectedOwner,
			count: sorted.length,
			pathCount: paths.length,
			roleCount: roles.length,
			deviceCount: devices.length,
			code: first.code,
		});
		output.push({
			id: `root-cause-${String(index += 1).padStart(3, '0')}`,
			severity,
			category: first.category,
			code: first.code,
			title: rootCauseTitle(sorted),
			message: rootCauseMessage(sorted),
			suspectedOwner: first.suspectedOwner,
			count: sorted.length,
			pathRoots,
			paths,
			roles,
			devices,
			findingIds: sorted.map((entry) => entry.id),
			captureIds,
			exampleScreenshotPath: sorted.find((entry) => entry.screenshotPath)?.screenshotPath ?? null,
			architectureGuidance: first.architectureGuidance,
			recommendedAction: recommendedAction(first.suspectedOwner, first.code),
			priorityScore: score,
			priorityRank: 0,
			impact: {
				pathCount: paths.length,
				roleCount: roles.length,
				deviceCount: devices.length,
				captureCount: captureIds.length,
			},
			query: {
				owner: first.suspectedOwner,
				severity,
				code: first.code,
				pathRoots,
			},
		});
	}
	return output.sort((a, b) => b.priorityScore - a.priorityScore || severityRank(a.severity) - severityRank(b.severity) || b.count - a.count || a.title.localeCompare(b.title))
		.map((entry, priorityRank) => ({ ...entry, priorityRank: priorityRank + 1 }));
}

function enrichClientErrors(captures: TreeseedSceneVisualAuditCapture[]): EnrichedClientError[] {
	return captures.flatMap((capture) => (capture.clientErrors ?? [])
		.filter((entry) => !isTreeseedSceneVisualAuditIgnoredClientError(entry))
		.map((entry) => ({
			...entry,
			path: capture.path,
			pathRoot: capture.pathRoot,
			role: capture.role,
			device: capture.device,
			screenshotPath: capture.screenshotPath,
			finalUrl: capture.finalUrl,
		} satisfies TreeseedSceneVisualAuditClientError)));
}

export function buildTreeseedSceneVisualAuditReview(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	paths: TreeseedSceneVisualAuditPaths;
	detail?: TreeseedSceneVisualAuditReviewDetail;
	maxFindings?: number;
}): TreeseedSceneVisualAuditReview {
	const detail = input.detail ?? 'standard';
	const allFindings: TreeseedSceneVisualAuditFinding[] = [];
	const routesById = new Map(input.manifest.routes.map((route) => [route.id, route]));
	for (const capture of input.manifest.captures) allFindings.push(...captureFindings(capture, allFindings.length, routesById.get(capture.routeId)));
	const clientErrors = enrichClientErrors(input.manifest.captures);
	const incidents = buildClientErrorIncidents(clientErrors);
	allFindings.push(...incidentFindings(incidents, input.manifest.captures, allFindings.length));
	allFindings.push(...architectureFindings(input.manifest.captures, allFindings, allFindings.length));
	const findings = filteredFindings(allFindings, detail, input.maxFindings ?? 250);
	const rootCauses = buildRootCauses(allFindings.filter((entry) => !expectedFindingNoise(entry)));
	const bySeverity = countMap(SEVERITIES);
	const byCategory = countMap(CATEGORIES);
	const byOwner = countMap(OWNERS);
	const byPriorityBand = { critical: 0, high: 0, medium: 0, low: 0 };
	const byPathRoot: Record<string, number> = {};
	for (const entry of allFindings) {
		bySeverity[entry.severity] += 1;
		byCategory[entry.category] += 1;
		byOwner[entry.suspectedOwner] += 1;
		byPathRoot[entry.pathRoot] = (byPathRoot[entry.pathRoot] ?? 0) + 1;
	}
	for (const entry of rootCauses) byPriorityBand[priorityBand(entry.priorityScore)] += 1;
	const generatedAt = new Date().toISOString();
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	return {
		schemaVersion: 'treeseed.scene.visual-audit-review/v1',
		generatedAt,
		auditId: input.manifest.auditId,
		sceneId: input.manifest.sceneId,
		summary: {
			generatedAt,
			detail,
			routeCount: input.manifest.routes.length,
			captureCount: input.manifest.captures.length,
			findingCount: allFindings.length,
			rootCauseCount: rootCauses.length,
			incidentCount: incidents.length,
			clientErrorCount: clientErrors.length,
			highestPriorityScore: rootCauses[0]?.priorityScore ?? incidents[0]?.priorityScore ?? 0,
			byPriorityBand,
			bySeverity,
			byCategory,
			byOwner,
			byPathRoot,
		},
		findings,
		rootCauses,
		incidents,
		clientErrors,
		diagnostics,
	};
}

function rootCauseTable(input: { paths: TreeseedSceneVisualAuditPaths; rootCauses: TreeseedSceneVisualAuditRootCause[] }) {
	const lines = [
		'| Rank | Score | Severity | Owner | Count | Root cause | Examples | Screenshot |',
		'| ---: | ---: | --- | --- | ---: | --- | --- | --- |',
	];
	for (const entry of input.rootCauses) {
		const screenshot = entry.exampleScreenshotPath ? `[view](${md(rel(input.paths.auditRoot, entry.exampleScreenshotPath))})` : '';
		lines.push(`| ${entry.priorityRank} | ${entry.priorityScore} | ${entry.severity} | ${md(entry.suspectedOwner)} | ${entry.count} | ${md(entry.title)} | ${md(entry.paths.slice(0, 4).join(', '))} | ${screenshot} |`);
	}
	return lines;
}

function issueSummary(entry: TreeseedSceneVisualAuditRootCause | TreeseedSceneVisualAuditClientErrorIncident) {
	return {
		id: entry.id,
		priorityRank: entry.priorityRank,
		priorityScore: entry.priorityScore,
		severity: entry.severity,
		owner: entry.suspectedOwner,
		category: 'category' in entry ? entry.category : 'client-error',
		code: entry.code,
		title: entry.title,
		count: entry.count,
		pathRoots: entry.pathRoots,
		paths: entry.paths,
		roles: entry.roles,
		devices: entry.devices,
		exampleScreenshotPath: entry.exampleScreenshotPath,
		recommendedAction: entry.recommendedAction,
	};
}

function combinedPriorityQueue(review: TreeseedSceneVisualAuditReview) {
	return [...review.rootCauses.map(issueSummary), ...review.incidents.map(issueSummary)]
		.sort((a, b) => b.priorityScore - a.priorityScore || a.priorityRank - b.priorityRank);
}

function groupBy<T>(items: T[], key: (item: T) => string | string[]) {
	const groups: Record<string, T[]> = {};
	for (const item of items) {
		const keys = key(item);
		for (const entry of Array.isArray(keys) ? keys : [keys]) {
			groups[entry] = [...(groups[entry] ?? []), item];
		}
	}
	return groups;
}

function jsonl<T>(items: T[]) {
	return items.map((entry) => JSON.stringify(entry)).join('\n') + (items.length ? '\n' : '');
}

export function formatTreeseedSceneVisualAuditFindingsMarkdown(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	const lines = [
		'# TreeSeed Visual Audit Findings',
		'',
		`Scene: ${input.manifest.sceneId ?? '(unknown)'}`,
		`Audit: ${input.manifest.auditId}`,
		`Generated: ${input.review.generatedAt}`,
		'',
		'## Summary',
		'',
		`- Findings: ${input.review.summary.findingCount}`,
		`- Root causes: ${input.review.summary.rootCauseCount}`,
		`- Incidents: ${input.review.summary.incidentCount}`,
		`- Included findings: ${input.review.findings.length}`,
		`- Raw client errors: ${input.review.summary.clientErrorCount}`,
		'',
		'## Root Causes',
		'',
		...rootCauseTable({ paths: input.paths, rootCauses: input.review.rootCauses }),
		'',
		'## Findings',
		'',
		'| Severity | Category | Code | Owner | Role | Device | Path | Screenshot |',
		'| --- | --- | --- | --- | --- | --- | --- | --- |',
	];
	for (const entry of input.review.findings) {
		const screenshot = entry.screenshotPath ? `[view](${md(rel(input.paths.auditRoot, entry.screenshotPath))})` : '';
		lines.push(`| ${entry.severity} | ${entry.category} | ${md(entry.code)} | ${md(entry.suspectedOwner)} | ${md(entry.role)} | ${md(entry.device)} | ${md(entry.path)} | ${screenshot} |`);
		lines.push(`|  |  |  |  |  |  | ${md(entry.message)} ${md(entry.architectureGuidance)} |  |`);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

export function formatTreeseedSceneVisualAuditAgentBrief(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	const high = input.review.findings.filter((entry) => entry.severity === 'blocking' || entry.severity === 'high');
	const client = input.review.findings.filter((entry) => entry.category === 'client-error' && !expectedFindingNoise(entry));
	const architecture = input.review.findings.filter((entry) => entry.category === 'architecture');
	const priorityQueue = combinedPriorityQueue(input.review).slice(0, 50);
	const lines = [
		'# Visual Audit Agent Brief',
		'',
		'## Mission',
		'',
		'Repair TreeSeed UI and functionality issues found by visual audit. Prefer reusable architecture fixes over route-local patches. Client-side browser/runtime errors are the first priority because the admin application is moving toward a progressively client-dominant architecture and reusable UI package foundation.',
		'',
		'## Priority Queue',
		'',
		'| Rank | Score | Severity | Owner | Count | Issue | Roots | Evidence |',
		'| ---: | ---: | --- | --- | ---: | --- | --- | --- |',
	];
	for (const entry of priorityQueue) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '';
		lines.push(`| ${entry.priorityRank} | ${entry.priorityScore} | ${entry.severity} | ${md(entry.owner)} | ${entry.count} | ${md(entry.title)} | ${md(entry.pathRoots.join(', '))} | ${screenshot ? `[view](${md(screenshot)})` : ''} |`);
	}
	lines.push(
		'',
		'## Raw Client Error Interpretation',
		'',
		'Raw client errors are preserved in `client-errors.jsonl`, but prioritized work should start from `incidents.json` and `root-causes.json` because browser console/resource events can duplicate the same route failure.',
		'',
		'## Root Causes To Assign First',
		'',
	);
	for (const entry of input.review.rootCauses.slice(0, 25)) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '(none)';
		lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity} ${entry.suspectedOwner}** ${entry.title}`);
		lines.push(`  - Count: ${entry.count}; roots: ${entry.pathRoots.join(', ')}; roles: ${entry.roles.join(', ')}; devices: ${entry.devices.join(', ')}`);
		lines.push(`  - Example: ${entry.paths[0] ?? '(none)'}`);
		lines.push(`  - Screenshot: ${screenshot}`);
		lines.push(`  - Action: ${entry.recommendedAction}`);
	}
	lines.push(
		'',
		'## Critical Client-Side Errors',
		'',
	);
	if (client.length === 0) lines.push('No client-side errors were detected in the included findings.', '');
	for (const entry of client.slice(0, 50)) lines.push(`- **${entry.severity}** ${entry.path} ${entry.role}/${entry.device}: ${entry.message}`);
	lines.push('', '## Client Error Incidents', '');
	if (input.review.incidents.length === 0) lines.push('No client-error incidents were detected.', '');
	for (const entry of input.review.incidents.slice(0, 50)) lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity} ${entry.suspectedOwner}** ${entry.title}: ${entry.count} raw event(s), roots ${entry.pathRoots.join(', ')}`);
	lines.push('', '## Highest Priority Findings', '');
	for (const entry of high.filter((entry) => !expectedFindingNoise(entry)).slice(0, 75)) lines.push(`- **${entry.severity} ${entry.code}** ${entry.path} ${entry.role}/${entry.device} (${entry.suspectedOwner}): ${entry.message}`);
	lines.push(
		'',
		'## Architecture Guidance',
		'',
		'- Fix shared controls/styles in `@treeseed/ui` when repeated across routes.',
		'- Fix admin composition, client initialization, state, auth, and access in `@treeseed/admin`.',
		'- Fix public/book style loading in `@treeseed/core`.',
		'- Fix tenant branding only in `@treeseed/market`.',
		'- Fix API/database fixture/access issues in `@treeseed/api`.',
		'- Do not add divergent one-off CSS unless the route is genuinely unique.',
		'',
		'## Architecture Findings',
		'',
	);
	if (architecture.length === 0) lines.push('No aggregate architecture findings were generated.', '');
	for (const entry of architecture) lines.push(`- **${entry.code}** (${entry.suspectedOwner}): ${entry.message}`);
	lines.push(
		'',
		'## Suggested Work Batches',
		'',
		'### Batch 1: Client Runtime Errors',
		'Fix console, page, request, hydration, and visible runtime errors before visual polish.',
		'',
		'### Batch 2: Shared UI Control Regressions',
		'Resolve repeated default link/button/form/control issues in `@treeseed/ui`.',
		'',
		'### Batch 3: Admin Access And Seeded Data Visibility',
		'Verify app shell routing, team/project membership, and seeded visual-audit entities.',
		'',
		'### Batch 4: Responsive And Mobile Issues',
		'Fix overflow, desktop layout leakage, and cramped mobile/tablet surfaces.',
		'',
		'### Batch 5: Public, Book, And Market Polish',
		'Restore public shell, book page, and tenant branding consistency.',
		'',
		'## Findings',
		'',
	);
	for (const entry of input.review.findings) {
		const screenshot = entry.screenshotPath ? rel(input.paths.auditRoot, entry.screenshotPath) : '(none)';
		lines.push(`- **${entry.severity} ${entry.code}** ${entry.path} ${entry.role}/${entry.device} -> ${entry.suspectedOwner}`);
		lines.push(`  - ${entry.message}`);
		lines.push(`  - Screenshot: ${screenshot}`);
		lines.push(`  - Guidance: ${entry.architectureGuidance}`);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

function formatOwnerBrief(input: {
	owner: TreeseedSceneVisualAuditFindingOwner;
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	const rootCauses = input.review.rootCauses.filter((entry) => entry.suspectedOwner === input.owner);
	const incidents = input.review.incidents.filter((entry) => entry.suspectedOwner === input.owner);
	const priorityQueue = combinedPriorityQueue(input.review).filter((entry) => entry.owner === input.owner).slice(0, 50);
	const findings = input.review.findings.filter((entry) => entry.suspectedOwner === input.owner && !expectedFindingNoise(entry));
	const lines = [
		`# Visual Audit Brief: ${input.owner}`,
		'',
		`Scene: ${input.manifest.sceneId ?? '(unknown)'}`,
		`Audit: ${input.manifest.auditId}`,
		'',
		'## Package Boundary',
		'',
		guidance(input.owner, 'visual.audit'),
		'',
		'## Priority Queue',
		'',
		'| Rank | Score | Severity | Count | Issue | Roots | Evidence |',
		'| ---: | ---: | --- | ---: | --- | --- | --- |',
	];
	for (const entry of priorityQueue) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '';
		lines.push(`| ${entry.priorityRank} | ${entry.priorityScore} | ${entry.severity} | ${entry.count} | ${md(entry.title)} | ${md(entry.pathRoots.join(', '))} | ${screenshot ? `[view](${md(screenshot)})` : ''} |`);
	}
	if (priorityQueue.length === 0) lines.push('|  |  |  |  | No prioritized issues were assigned to this owner. |  |  |');
	lines.push(
		'',
		'## Root Causes',
		'',
	);
	if (rootCauses.length === 0) lines.push('No root causes were assigned to this owner.', '');
	for (const entry of rootCauses) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '(none)';
		lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity}** ${entry.title}`);
		lines.push(`  - Count: ${entry.count}`);
		lines.push(`  - Path roots: ${entry.pathRoots.join(', ')}`);
		lines.push(`  - Roles/devices: ${entry.roles.join(', ')} / ${entry.devices.join(', ')}`);
		lines.push(`  - Example screenshot: ${screenshot}`);
		lines.push(`  - Recommended action: ${entry.recommendedAction}`);
	}
	lines.push('', '## Client Error Incidents', '');
	if (incidents.length === 0) lines.push('No client-error incidents were assigned to this owner.', '');
	for (const entry of incidents.slice(0, 80)) {
		const screenshot = entry.exampleScreenshotPath ? rel(input.paths.auditRoot, entry.exampleScreenshotPath) : '(none)';
		lines.push(`- **#${entry.priorityRank} score ${entry.priorityScore} ${entry.severity} ${entry.code}** ${entry.title}`);
		lines.push(`  - Count: ${entry.count}`);
		lines.push(`  - Path roots: ${entry.pathRoots.join(', ')}`);
		lines.push(`  - Example screenshot: ${screenshot}`);
		lines.push(`  - Recommended action: ${entry.recommendedAction}`);
	}
	lines.push('', '## Representative Findings', '');
	for (const entry of findings.slice(0, 80)) {
		const screenshot = entry.screenshotPath ? rel(input.paths.auditRoot, entry.screenshotPath) : '(none)';
		lines.push(`- **${entry.severity} ${entry.code}** ${entry.path} ${entry.role}/${entry.device}`);
		lines.push(`  - ${entry.message}`);
		lines.push(`  - Screenshot: ${screenshot}`);
	}
	lines.push('');
	return `${lines.join('\n')}\n`;
}

export function writeTreeseedSceneVisualAuditReview(input: {
	manifest: TreeseedSceneVisualAuditManifest;
	review: TreeseedSceneVisualAuditReview;
	paths: TreeseedSceneVisualAuditPaths;
}) {
	if (!input.paths.reviewRoot || !input.paths.reviewSummaryPath || !input.paths.reviewFindingsPath || !input.paths.reviewAgentBriefPath) return;
	mkdirSync(input.paths.reviewRoot, { recursive: true });
	const priorityQueue = combinedPriorityQueue(input.review);
	const issueIndex = {
		schemaVersion: 'treeseed.scene.visual-audit-issue-index/v1',
		generatedAt: input.review.generatedAt,
		auditId: input.manifest.auditId,
		rootCauses: input.review.rootCauses.map(issueSummary),
		files: {
			rootCauses: 'root-causes.json',
			incidents: 'incidents.json',
			findings: 'findings.json',
			clientErrors: 'client-errors.jsonl',
			contactSheets: 'contact-sheets/index.html',
			flaggedContactSheet: 'contact-sheets/flagged.html',
			rootCauseContactSheet: 'contact-sheets/root-causes.html',
		},
	};
	writeFileSync(input.paths.reviewSummaryPath, `${JSON.stringify(input.review.summary, null, 2)}\n`, 'utf8');
	writeFileSync(input.paths.reviewFindingsPath, `${JSON.stringify(input.review.findings, null, 2)}\n`, 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/findings.jsonl`, jsonl(input.review.findings), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/root-causes.json`, `${JSON.stringify(input.review.rootCauses, null, 2)}\n`, 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/root-causes.jsonl`, jsonl(input.review.rootCauses), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/incidents.json`, `${JSON.stringify(input.review.incidents, null, 2)}\n`, 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/incidents.jsonl`, jsonl(input.review.incidents), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/issue-index.json`, `${JSON.stringify(issueIndex, null, 2)}\n`, 'utf8');
	writeFileSync(input.paths.reviewAgentBriefPath, formatTreeseedSceneVisualAuditAgentBrief(input), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/findings.md`, formatTreeseedSceneVisualAuditFindingsMarkdown(input), 'utf8');
	writeFileSync(`${input.paths.reviewRoot}/client-errors.jsonl`, input.review.clientErrors.map((entry) => JSON.stringify(entry)).join('\n') + (input.review.clientErrors.length ? '\n' : ''), 'utf8');
	const queryRoot = `${input.paths.reviewRoot}/query`;
	mkdirSync(queryRoot, { recursive: true });
	writeFileSync(`${queryRoot}/top-priority.json`, `${JSON.stringify(priorityQueue.slice(0, 50), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-owner.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.owner), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-path-root.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.pathRoots), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-route.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.paths), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-role.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.roles), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-device.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.devices), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-code.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => entry.code), null, 2)}\n`, 'utf8');
	writeFileSync(`${queryRoot}/by-priority.json`, `${JSON.stringify(groupBy(priorityQueue, (entry) => priorityBand(entry.priorityScore)), null, 2)}\n`, 'utf8');
	const ownerRoot = `${input.paths.reviewRoot}/owner-briefs`;
	mkdirSync(ownerRoot, { recursive: true });
	for (const owner of OWNERS) {
		const filename = owner.replace(/^@/u, '').replace(/[^a-z0-9-]+/giu, '-').toLowerCase();
		writeFileSync(`${ownerRoot}/${filename}.md`, formatOwnerBrief({ ...input, owner }), 'utf8');
	}
	writeFileSync(`${input.paths.reviewRoot}/routes.json`, `${JSON.stringify(input.manifest.routes.map((route) => ({
		id: route.id,
		path: route.path,
		pathRoot: route.pathRoot,
		roles: route.roles,
		source: route.source,
		findings: input.review.findings.filter((finding) => finding.path === route.path).length,
	})), null, 2)}\n`, 'utf8');
	writeTreeseedSceneVisualAuditContactSheets(input);
}
