import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readTreeseedDevInstance } from '../../local-dev/managed-dev.ts';
import { resolveTreeseedSceneBaseUrl } from '../base-url.ts';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../diagnostics.ts';
import { resolveTreeseedSceneDeviceProfile } from '../devices.ts';
import { prepareTreeseedSceneEnvironment } from '../environment.ts';
import { validateTreeseedScene } from '../planner.ts';
import { writeTreeseedSceneVisualAuditReport } from '../visual-audit-report.ts';
import {
	buildTreeseedSceneVisualAuditReview,
	isTreeseedSceneVisualAuditIgnoredClientError,
	writeTreeseedSceneVisualAuditReview,
} from '../visual-audit-review.ts';
import {
	discoverTreeseedSceneVisualAuditRoutes,
	treeseedSceneVisualAuditRouteFilename,
} from '../visual-audit-routes.ts';
import {
	ensureTreeseedSceneVisualAuditRoleFixtures,
	signInTreeseedSceneVisualAuditRole,
	validateTreeseedSceneVisualAuditRoles,
} from '../visual-audit-fixtures.ts';
import type {
	TreeseedSceneDeviceProfile,
	TreeseedSceneVisualAuditClientError,
	TreeseedSceneDiagnostic,
	TreeseedSceneVisualAuditCapture,
	TreeseedSceneVisualAuditManifest,
	TreeseedSceneVisualAuditOptions,
	TreeseedSceneVisualAuditPaths,
	TreeseedSceneVisualAuditReport,
	TreeseedSceneVisualAuditRole,
} from '../types.ts';


export function splitDiagnostics(diagnostics: TreeseedSceneDiagnostic[], severity: 'error' | 'warning') {
	return diagnostics.filter((entry) => entry.severity === severity);
}

export function compactTimestamp(value?: string) {
	return value ?? new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

export function auditId(timestamp: string) {
	return `${timestamp.toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 12)}-${randomUUID().slice(0, 8)}`;
}

export function pathRootFolder(pathRoot: string) {
	return pathRoot === '/' ? 'root' : pathRoot.replace(/^\/+|\/+$/gu, '').replace(/[^a-z0-9]+/giu, '-').toLowerCase() || 'root';
}

export function pathsFor(input: { projectRoot: string; sceneId: string; timestamp: string; auditId: string }): TreeseedSceneVisualAuditPaths {
	const auditRoot = join(input.projectRoot, '.treeseed', 'scenes', 'visual-audits', input.sceneId, `${input.timestamp}-${input.auditId}`);
	return {
		auditRoot,
		manifestPath: join(auditRoot, 'manifest.json'),
		reportPath: join(auditRoot, 'report.md'),
		screenshotsRoot: join(auditRoot, 'screenshots'),
		reviewRoot: join(auditRoot, 'review'),
		reviewSummaryPath: join(auditRoot, 'review', 'summary.json'),
		reviewFindingsPath: join(auditRoot, 'review', 'findings.json'),
		reviewAgentBriefPath: join(auditRoot, 'review', 'agent-brief.md'),
	};
}

export function httpHealthBaseUrl(instance: unknown) {
	const healthUrl = (instance as { health?: Array<{ kind?: string; url?: string }> } | null)?.health
		?.find((entry) => entry.kind === 'http' && typeof entry.url === 'string')
		?.url;
	if (!healthUrl) return null;
	try {
		const url = new URL(healthUrl);
		if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
		return url.origin;
	} catch {
		return healthUrl.replace(/\/healthz?$/u, '').replace(/\/+$/u, '');
	}
}

export function resolveVisualAuditApiBaseUrl(input: { projectRoot: string; environment: string; webBaseUrl: string }) {
	if (input.environment !== 'local') return input.webBaseUrl;
	const apiInstance = readTreeseedDevInstance({ cwd: input.projectRoot, surface: 'api' });
	const managedApi = httpHealthBaseUrl(apiInstance);
	if (managedApi) return managedApi;
	const envApi = process.env.TREESEED_API_BASE_URL?.trim() || process.env.TREESEED_MARKET_API_BASE_URL?.trim();
	if (envApi) return envApi.replace(/\/+$/u, '');
	return input.webBaseUrl;
}

export function screenshotPath(input: {
	paths: TreeseedSceneVisualAuditPaths;
	role: string;
	device: string;
	pathRoot: string;
	path: string;
	fullPage?: boolean;
}) {
	const root = input.fullPage ? join(input.paths.auditRoot, 'full-page') : input.paths.screenshotsRoot;
	return join(root, input.role, input.device, pathRootFolder(input.pathRoot), treeseedSceneVisualAuditRouteFilename(input.path));
}

export async function loadPlaywright() {
	try {
		return await import('playwright');
	} catch (error) {
		const diagnostic = sceneErrorDiagnostic('scene.playwright_unavailable', error instanceof Error ? error.message : String(error ?? 'Playwright is unavailable.'), 'visualAudit');
		throw Object.assign(new Error(diagnostic.message), { diagnostic });
	}
}

export function captureId(role: string, device: string, routeId: string) {
	return `${role}-${device}-${routeId}`.replace(/[^a-z0-9._-]+/giu, '-').toLowerCase();
}

export function clientErrorId(captureIdValue: string, index: number) {
	return `${captureIdValue}-client-${String(index).padStart(3, '0')}`;
}

export async function collectDomSummary(page: any) {
	return await page.evaluate(() => {
		const visible = (element: Element) => {
			const rect = element.getBoundingClientRect();
			const style = window.getComputedStyle(element);
			return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
		};
		const text = (value: string | null | undefined) => (value ?? '').replace(/\s+/gu, ' ').trim();
		const selectorHint = (element: Element) => {
			const id = element.getAttribute('id');
			if (id) return `#${id}`;
			const scene = element.getAttribute('data-scene');
			if (scene) return `[data-scene="${scene}"]`;
			const testId = element.getAttribute('data-testid');
			if (testId) return `[data-testid="${testId}"]`;
			const className = typeof element.className === 'string' ? element.className.split(/\s+/u).filter(Boolean).slice(0, 3).join('.') : '';
			return className ? `${element.tagName.toLowerCase()}.${className}` : element.tagName.toLowerCase();
		};
		const hasTreeSeedClass = (element: Element) => typeof element.className === 'string' && /\b(ts-|astro-|starlight)/u.test(element.className);
		const links = [...document.querySelectorAll('a')].filter(visible);
		const buttons = [...document.querySelectorAll('button,[role="button"],input[type="button"],input[type="submit"]')].filter(visible);
		const inputs = [...document.querySelectorAll('input,textarea,select')].filter(visible);
		const forms = [...document.querySelectorAll('form')].filter(visible);
		const defaultStyledLinks = links
			.filter((entry) => !hasTreeSeedClass(entry) && !entry.closest('.prose,[data-prose],article'))
			.map((entry) => {
				const style = window.getComputedStyle(entry);
				const color = style.color;
				const decoration = style.textDecorationLine;
				const looksBlue = /rgb\(\s*(0|20|30|37|59|29),\s*(0|80|100|102|130|78),\s*(150|190|200|238|255)/u.test(color);
				return { entry, style, looksDefault: decoration.includes('underline') || looksBlue };
			})
			.filter((entry) => entry.looksDefault)
			.slice(0, 12)
			.map(({ entry }) => ({ text: text(entry.textContent).slice(0, 80), href: entry.getAttribute('href'), selectorHint: selectorHint(entry) }));
		const defaultStyledButtons = buttons
			.filter((entry) => !hasTreeSeedClass(entry))
			.slice(0, 12)
			.map((entry) => ({ text: text((entry as HTMLInputElement).value || entry.textContent).slice(0, 80), selectorHint: selectorHint(entry) }));
		const visibleText = text(document.body?.innerText ?? '');
		const errorTexts = visibleText.split(/(?<=[.!?])\s+|\n+/u)
			.map((entry) => text(entry))
			.filter((entry) => /error|exception|stack trace|not found|failed to load|something went wrong|cannot read|undefined|internal server error|vite|astro error|hydration|client error/iu.test(entry))
			.slice(0, 20);
		const seededEntityTexts = ['Visual Audit Team', 'visual-audit', 'Visual Audit Project', 'visual-audit-project']
			.filter((entry) => visibleText.includes(entry));
		const headings = [...document.querySelectorAll('h1,h2,h3')]
			.filter(visible)
			.map((entry) => text(entry.textContent))
			.filter(Boolean)
			.slice(0, 20);
		return {
			title: text(document.title) || null,
			h1: headings[0] ?? null,
			headings,
			visibleTextSample: visibleText.slice(0, 1000),
			bodyTextLength: visibleText.length,
			visibleLinkCount: links.length,
			visibleButtonCount: buttons.length,
			visibleInputCount: inputs.length,
			visibleFormCount: forms.length,
			appShellDetected: !!document.querySelector('.ts-app-shell,[data-scene^="app."],.ts-team-selector'),
			authShellDetected: !!document.querySelector('.ts-auth-shell,[data-scene^="auth."]'),
			publicShellDetected: !!document.querySelector('.ts-public-shell,.ts-site-shell,.sl-container'),
			horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 4,
			scrollWidth: document.documentElement.scrollWidth,
			scrollHeight: document.documentElement.scrollHeight,
			viewportWidth: window.innerWidth,
			viewportHeight: window.innerHeight,
			defaultStyledLinks,
			defaultStyledButtons,
			visibleErrorTexts: errorTexts,
			seededEntityTexts,
		};
	});
}

export function hasTransientVisualAuditServerError(input: {
	httpStatus: number | null;
	dom: Awaited<ReturnType<typeof collectDomSummary>> | null;
	clientErrors: TreeseedSceneVisualAuditClientError[];
}) {
	if (input.httpStatus && input.httpStatus >= 500) return true;
	const visibleErrors = input.dom?.visibleErrorTexts?.join(' ') ?? '';
	if (/Cannot find module|Astro detected an unhandled rejection|Internal Server Error|AstroError|Vite Error|starlight\/routes\/ssr/iu.test(visibleErrors)) return true;
	return input.clientErrors.some((entry) => entry.kind === 'http-error' && (entry.status ?? 0) >= 500)
		|| input.clientErrors.some((entry) => /Cannot find module|Astro detected an unhandled rejection|Internal Server Error|AstroError|Vite Error|starlight\/routes\/ssr/iu.test(entry.message));
}

export function pathFromUrl(value: string | null | undefined) {
	if (!value) return null;
	try {
		return new URL(value).pathname.replace(/\/+$/u, '') || '/';
	} catch {
		return null;
	}
}

export function expectedStatusMatches(expected: number | number[] | null | undefined, actual: number | null) {
	if (actual == null || expected == null) return false;
	return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

export function captureLooksHealthy(input: {
	url: string;
	finalUrl: string | null;
	httpStatus: number | null;
	dom: Awaited<ReturnType<typeof collectDomSummary>> | null;
}) {
	const routePath = pathFromUrl(input.url);
	const finalPath = pathFromUrl(input.finalUrl);
	if (routePath !== finalPath) return false;
	if (input.httpStatus != null && input.httpStatus >= 400) return false;
	return (input.dom?.visibleErrorTexts?.length ?? 0) === 0;
}
