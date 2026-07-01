import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readTreeseedDevInstance } from '../local-dev/managed-dev.ts';
import { resolveTreeseedSceneBaseUrl } from './base-url.ts';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from './diagnostics.ts';
import { resolveTreeseedSceneDeviceProfile } from './devices.ts';
import { prepareTreeseedSceneEnvironment } from './environment.ts';
import { validateTreeseedScene } from './planner.ts';
import { writeTreeseedSceneVisualAuditReport } from './visual-audit-report.ts';
import {
	buildTreeseedSceneVisualAuditReview,
	isTreeseedSceneVisualAuditIgnoredClientError,
	writeTreeseedSceneVisualAuditReview,
} from './visual-audit-review.ts';
import {
	discoverTreeseedSceneVisualAuditRoutes,
	treeseedSceneVisualAuditRouteFilename,
} from './visual-audit-routes.ts';
import {
	ensureTreeseedSceneVisualAuditRoleFixtures,
	signInTreeseedSceneVisualAuditRole,
	validateTreeseedSceneVisualAuditRoles,
} from './visual-audit-fixtures.ts';
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
} from './types.ts';

function splitDiagnostics(diagnostics: TreeseedSceneDiagnostic[], severity: 'error' | 'warning') {
	return diagnostics.filter((entry) => entry.severity === severity);
}

function compactTimestamp(value?: string) {
	return value ?? new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function auditId(timestamp: string) {
	return `${timestamp.toLowerCase().replace(/[^a-z0-9]/gu, '').slice(0, 12)}-${randomUUID().slice(0, 8)}`;
}

function pathRootFolder(pathRoot: string) {
	return pathRoot === '/' ? 'root' : pathRoot.replace(/^\/+|\/+$/gu, '').replace(/[^a-z0-9]+/giu, '-').toLowerCase() || 'root';
}

function pathsFor(input: { projectRoot: string; sceneId: string; timestamp: string; auditId: string }): TreeseedSceneVisualAuditPaths {
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

function httpHealthBaseUrl(instance: unknown) {
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

function resolveVisualAuditApiBaseUrl(input: { projectRoot: string; environment: string; webBaseUrl: string }) {
	if (input.environment !== 'local') return input.webBaseUrl;
	const apiInstance = readTreeseedDevInstance({ cwd: input.projectRoot, surface: 'api' });
	const managedApi = httpHealthBaseUrl(apiInstance);
	if (managedApi) return managedApi;
	const envApi = process.env.TREESEED_API_BASE_URL?.trim() || process.env.TREESEED_MARKET_API_BASE_URL?.trim();
	if (envApi) return envApi.replace(/\/+$/u, '');
	return input.webBaseUrl;
}

function screenshotPath(input: {
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

async function loadPlaywright() {
	try {
		return await import('playwright');
	} catch (error) {
		const diagnostic = sceneErrorDiagnostic('scene.playwright_unavailable', error instanceof Error ? error.message : String(error ?? 'Playwright is unavailable.'), 'visualAudit');
		throw Object.assign(new Error(diagnostic.message), { diagnostic });
	}
}

function captureId(role: string, device: string, routeId: string) {
	return `${role}-${device}-${routeId}`.replace(/[^a-z0-9._-]+/giu, '-').toLowerCase();
}

function clientErrorId(captureIdValue: string, index: number) {
	return `${captureIdValue}-client-${String(index).padStart(3, '0')}`;
}

async function collectDomSummary(page: any) {
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

function hasTransientVisualAuditServerError(input: {
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

function pathFromUrl(value: string | null | undefined) {
	if (!value) return null;
	try {
		return new URL(value).pathname.replace(/\/+$/u, '') || '/';
	} catch {
		return null;
	}
}

function expectedStatusMatches(expected: number | number[] | null | undefined, actual: number | null) {
	if (actual == null || expected == null) return false;
	return Array.isArray(expected) ? expected.includes(actual) : expected === actual;
}

function captureLooksHealthy(input: {
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

async function captureRoute(input: {
	page: any;
	baseUrl: string;
	paths: TreeseedSceneVisualAuditPaths;
	role: TreeseedSceneVisualAuditRole;
	device: string;
	route: TreeseedSceneVisualAuditManifest['routes'][number];
	includeFullPage: boolean;
}): Promise<TreeseedSceneVisualAuditCapture> {
	const started = Date.now();
	const url = new URL(input.route.path, input.baseUrl).toString();
	const capturedAt = new Date().toISOString();
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	const captureIdValue = captureId(input.role, input.device, input.route.id);
	const clientErrors: TreeseedSceneVisualAuditClientError[] = [];
	const pushClientError = (entry: Omit<TreeseedSceneVisualAuditClientError, 'id' | 'captureId' | 'timestamp'> & { timestamp?: string }) => {
		if (isTreeseedSceneVisualAuditIgnoredClientError(entry)) return;
		clientErrors.push({
			...entry,
			id: clientErrorId(captureIdValue, clientErrors.length + 1),
			captureId: captureIdValue,
			timestamp: entry.timestamp ?? new Date().toISOString(),
		});
	};
	const consoleHandler = (message: { type(): string; text(): string; location?(): { url?: string } }) => {
		const type = message.type();
		if (type !== 'error' && type !== 'warning') return;
		pushClientError({ kind: 'console', severity: type === 'error' ? 'error' : 'warning', message: message.text(), url: message.location?.().url ?? null });
	};
	const pageErrorHandler = (error: Error) => {
		pushClientError({ kind: 'pageerror', severity: 'error', message: error.message, url });
	};
	const requestFailedHandler = (request: { url(): string; method(): string; failure(): { errorText: string } | null }) => {
		const requestUrl = request.url();
		const message = request.failure()?.errorText ?? 'Request failed.';
		if (/ERR_ABORTED/iu.test(message) && pathFromUrl(requestUrl) !== pathFromUrl(url)) return;
		pushClientError({ kind: 'requestfailed', severity: 'error', message, url: requestUrl, method: request.method() });
	};
	const responseHandler = (response: { url(): string; status(): number; request(): { method(): string } }) => {
		const status = response.status();
		if (status >= 500) pushClientError({ kind: 'http-error', severity: 'error', message: `HTTP ${status} ${response.url()}`, url: response.url(), method: response.request().method(), status });
	};
	let httpStatus: number | null = null;
	let finalUrl: string | null = null;
	let screenshot: string | null = null;
	let fullPageScreenshot: string | null = null;
	let dom = null;
	try {
		input.page.on('console', consoleHandler);
		input.page.on('pageerror', pageErrorHandler);
		input.page.on('requestfailed', requestFailedHandler);
		input.page.on('response', responseHandler);
		const attemptStartIndex = clientErrors.length;
		const navigate = async () => {
			const response = await input.page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
			httpStatus = response?.status() ?? null;
			finalUrl = input.page.url();
			await input.page.waitForTimeout(350);
			dom = await collectDomSummary(input.page).catch(() => null);
		};
		let lastAttemptError: unknown = null;
		for (let attempt = 0; attempt < 4; attempt += 1) {
			try {
				if (attempt > 0) {
					await input.page.goto('about:blank', { waitUntil: 'load', timeout: 5000 }).catch(() => undefined);
					await input.page.waitForTimeout([750, 1500, 2500][attempt - 1] ?? 2500);
				}
				await navigate();
				if (!hasTransientVisualAuditServerError({ httpStatus, dom, clientErrors: clientErrors.slice(attemptStartIndex) })
					|| captureLooksHealthy({ url, finalUrl, httpStatus, dom })) {
					clientErrors.splice(attemptStartIndex);
					lastAttemptError = null;
					break;
				}
			} catch (error) {
				lastAttemptError = error;
			}
		}
		if (lastAttemptError) throw lastAttemptError;
		screenshot = screenshotPath({ paths: input.paths, role: input.role, device: input.device, pathRoot: input.route.pathRoot, path: input.route.path });
		mkdirSync(dirname(screenshot), { recursive: true });
		await input.page.screenshot({ path: screenshot, fullPage: false });
		if (input.includeFullPage) {
			fullPageScreenshot = screenshotPath({ paths: input.paths, role: input.role, device: input.device, pathRoot: input.route.pathRoot, path: input.route.path, fullPage: true });
			mkdirSync(dirname(fullPageScreenshot), { recursive: true });
			await input.page.screenshot({ path: fullPageScreenshot, fullPage: true });
		}
		if (captureLooksHealthy({ url, finalUrl, httpStatus, dom })) {
			const routePath = pathFromUrl(url);
			for (let index = clientErrors.length - 1; index >= 0; index -= 1) {
				const entry = clientErrors[index]!;
				const entryPath = pathFromUrl(entry.url);
				if (entryPath !== routePath) continue;
				if ((entry.kind === 'http-error' && (entry.status ?? 0) >= 500)
					|| (/Failed to load resource.*500|server responded with a status of 500|ERR_ABORTED/iu.test(entry.message))) {
					clientErrors.splice(index, 1);
				}
			}
		}
		if (expectedStatusMatches(input.route.expectedStatus, httpStatus)) {
			const routePath = pathFromUrl(url);
			for (let index = clientErrors.length - 1; index >= 0; index -= 1) {
				const entry = clientErrors[index]!;
				const entryPath = pathFromUrl(entry.url);
				if (entryPath === routePath && (entry.status === httpStatus || entry.message.includes(` ${httpStatus} `))) {
					clientErrors.splice(index, 1);
				}
			}
		} else if (httpStatus && httpStatus >= 400) {
			diagnostics.push(sceneWarningDiagnostic('scene.visual_audit_capture_http_status', `Route returned HTTP ${httpStatus}.`, input.route.path));
		}
		return {
			id: captureIdValue,
			routeId: input.route.id,
			path: input.route.path,
			pathRoot: input.route.pathRoot,
			role: input.role,
			device: input.device,
			url,
			status: 'captured',
			httpStatus,
			finalUrl,
			screenshotPath: screenshot,
			fullPageScreenshotPath: fullPageScreenshot,
			capturedAt,
			durationMs: Date.now() - started,
			dom,
			clientErrors,
			diagnostics,
		};
	} catch (error) {
		diagnostics.push(sceneErrorDiagnostic('scene.visual_audit_capture_failed', error instanceof Error ? error.message : String(error ?? 'Visual audit capture failed.'), input.route.path));
		return {
			id: captureIdValue,
			routeId: input.route.id,
			path: input.route.path,
			pathRoot: input.route.pathRoot,
			role: input.role,
			device: input.device,
			url,
			status: 'failed',
			httpStatus,
			finalUrl,
			screenshotPath: screenshot,
			fullPageScreenshotPath: fullPageScreenshot,
			capturedAt,
			durationMs: Date.now() - started,
			dom,
			clientErrors,
			diagnostics,
		};
	} finally {
		input.page.removeListener?.('console', consoleHandler);
		input.page.removeListener?.('pageerror', pageErrorHandler);
		input.page.removeListener?.('requestfailed', requestFailedHandler);
		input.page.removeListener?.('response', responseHandler);
	}
}

function skipCapture(input: {
	role: TreeseedSceneVisualAuditRole;
	device: string;
	route: TreeseedSceneVisualAuditManifest['routes'][number];
	baseUrl: string;
	diagnostic: TreeseedSceneDiagnostic;
}): TreeseedSceneVisualAuditCapture {
	return {
		id: captureId(input.role, input.device, input.route.id),
		routeId: input.route.id,
		path: input.route.path,
		pathRoot: input.route.pathRoot,
		role: input.role,
		device: input.device,
		url: new URL(input.route.path, input.baseUrl).toString(),
		status: 'skipped',
		httpStatus: null,
		finalUrl: null,
		screenshotPath: null,
		fullPageScreenshotPath: null,
		capturedAt: new Date().toISOString(),
		durationMs: 0,
		dom: null,
		clientErrors: [],
		diagnostics: [input.diagnostic],
	};
}

function browserContextOptions(profile: TreeseedSceneDeviceProfile) {
	return {
		viewport: profile.viewport,
		screen: profile.viewport,
		deviceScaleFactor: profile.deviceScaleFactor ?? 1,
		isMobile: profile.isMobile ?? false,
		hasTouch: profile.hasTouch ?? false,
		...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
	};
}

function visualAuditPreflightRoutes() {
	return ['/', '/auth/register', '/agents', '/questions', '/app'];
}

async function runVisualAuditPreflight(baseUrl: string): Promise<TreeseedSceneDiagnostic[]> {
	const diagnostics: TreeseedSceneDiagnostic[] = [];
	const unhealthy: string[] = [];
	for (const path of visualAuditPreflightRoutes()) {
		try {
			const response = await fetch(new URL(path, baseUrl), { redirect: 'follow' });
			const text = await response.text().catch(() => '');
			const sample = text.replace(/<[^>]*>/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, 320);
			if (response.status >= 500
				|| /Cannot find module|Astro detected an unhandled rejection|Internal Server Error|AstroError|Vite Error/iu.test(sample)) {
				unhealthy.push(`${path} status=${response.status} ${sample}`);
			}
		} catch (error) {
			unhealthy.push(`${path} ${(error instanceof Error ? error.message : String(error ?? 'request failed'))}`);
		}
	}
	if (unhealthy.length > 0) {
		diagnostics.push(sceneErrorDiagnostic(
			'scene.visual_audit_environment_unhealthy',
			`Visual audit preflight found local dev route failures. Restart with \`trsd dev start --web-runtime local --force --json\` or use \`trsd scene visual-audit --fresh-dev\`. Examples: ${unhealthy.slice(0, 3).join(' | ')}`,
			'visualAudit.preflight',
		));
	}
	return diagnostics;
}

export async function runTreeseedSceneVisualAudit(input: TreeseedSceneVisualAuditOptions): Promise<TreeseedSceneVisualAuditReport> {
	const validation = validateTreeseedScene({ projectRoot: input.projectRoot, scene: input.scene });
	const environment = input.environment ?? 'local';
	if (!validation.ok || !validation.scene) {
		return {
			ok: false,
			phase: 11,
			sceneId: validation.scene?.id ?? null,
			auditId: null,
			scenePath: validation.scenePath,
			baseUrl: null,
			roles: input.roles ?? [],
			devices: input.devices ?? [],
			routeCount: 0,
			captureCount: 0,
			failedCount: 0,
			skippedCount: 0,
			auditRoot: null,
			paths: null,
			manifest: null,
			review: null,
			reviewFindingCount: 0,
			rootCauseCount: 0,
			incidentCount: 0,
			clientErrorCount: 0,
			diagnostics: validation.diagnostics,
			warnings: splitDiagnostics(validation.diagnostics, 'warning'),
			blockers: splitDiagnostics(validation.diagnostics, 'error'),
		};
	}
	const scene = validation.scene;
	const roles = input.roles?.length ? input.roles : scene.visualAudit.roles;
	const requestedDevices = input.devices?.length ? input.devices : scene.devices.profiles.map((profile) => profile.id);
	const diagnostics: TreeseedSceneDiagnostic[] = [...validateTreeseedSceneVisualAuditRoles(roles)];
	const profiles: TreeseedSceneDeviceProfile[] = [];
	for (const device of requestedDevices) {
		const resolved = resolveTreeseedSceneDeviceProfile({ scene, device });
		diagnostics.push(...resolved.diagnostics);
		if (resolved.profile) profiles.push(resolved.profile);
	}
	const environmentReport = await prepareTreeseedSceneEnvironment({ projectRoot: input.projectRoot, scene, environment, env: process.env });
	diagnostics.push(...environmentReport.diagnostics);
	const baseUrlReport = resolveTreeseedSceneBaseUrl({ projectRoot: input.projectRoot, scene, environment, environmentReport });
	diagnostics.push(...baseUrlReport.diagnostics);
	const discovered = discoverTreeseedSceneVisualAuditRoutes({
		projectRoot: input.projectRoot,
		scene,
		pathRoots: input.pathRoots,
		pathGlobs: input.pathGlobs,
		excludePathGlobs: input.excludePathGlobs,
	});
	diagnostics.push(...discovered.diagnostics);
	if (discovered.routes.length === 0) diagnostics.push(sceneErrorDiagnostic('scene.visual_audit_no_routes', 'No user-facing routes were discovered for visual audit.', 'visualAudit'));
	const blockers = splitDiagnostics(diagnostics, 'error');
	if (blockers.length > 0 || !baseUrlReport.baseUrl) {
		return {
			ok: false,
			phase: 11,
			sceneId: scene.id,
			auditId: null,
			scenePath: validation.scenePath,
			baseUrl: baseUrlReport.baseUrl,
			roles,
			devices: requestedDevices,
			routeCount: discovered.routes.length,
			captureCount: 0,
			failedCount: 0,
			skippedCount: 0,
			auditRoot: null,
			paths: null,
			manifest: null,
			review: null,
			reviewFindingCount: 0,
			rootCauseCount: 0,
			incidentCount: 0,
			clientErrorCount: 0,
			diagnostics,
			warnings: splitDiagnostics(diagnostics, 'warning'),
			blockers,
		};
	}
	if (environment === 'local' && input.preflight !== false) {
		diagnostics.push(...await runVisualAuditPreflight(baseUrlReport.baseUrl));
		const preflightBlockers = splitDiagnostics(diagnostics, 'error');
		if (preflightBlockers.length > 0) {
			return {
				ok: false,
				phase: 11,
				sceneId: scene.id,
				auditId: null,
				scenePath: validation.scenePath,
				baseUrl: baseUrlReport.baseUrl,
				roles,
				devices: requestedDevices,
				routeCount: discovered.routes.length,
				captureCount: 0,
				failedCount: 0,
				skippedCount: 0,
				auditRoot: null,
				paths: null,
				manifest: null,
				review: null,
				reviewFindingCount: 0,
				rootCauseCount: 0,
				incidentCount: 0,
				clientErrorCount: 0,
				diagnostics,
				warnings: splitDiagnostics(diagnostics, 'warning'),
				blockers: preflightBlockers,
			};
		}
	}
	const apiBaseUrl = resolveVisualAuditApiBaseUrl({ projectRoot: input.projectRoot, environment, webBaseUrl: baseUrlReport.baseUrl });
	if (environment === 'local' && roles.some((role) => role !== 'anonymous')) {
		diagnostics.push(...await ensureTreeseedSceneVisualAuditRoleFixtures({ baseUrl: apiBaseUrl, roles }));
	}
	const timestamp = compactTimestamp(input.timestamp);
	const id = auditId(timestamp);
	const paths = pathsFor({ projectRoot: input.projectRoot, sceneId: scene.id, timestamp, auditId: id });
	mkdirSync(paths.screenshotsRoot, { recursive: true });
	const captures: TreeseedSceneVisualAuditCapture[] = [];
	const playwright = await loadPlaywright();
	const browser = await playwright.chromium.launch();
	try {
		for (const role of roles) {
			const roleRequiresLogin = role !== 'anonymous';
			for (const profile of profiles) {
				const context = await browser.newContext(browserContextOptions(profile));
				const page = await context.newPage();
				let roleDiagnostics: TreeseedSceneDiagnostic[] = [];
				if (roleRequiresLogin) {
					if (environment !== 'local') {
						roleDiagnostics = [sceneErrorDiagnostic('scene.visual_audit_fixture_unavailable', 'Authenticated visual audit fixture sessions are local-only in this implementation.', 'roles')];
					} else {
						roleDiagnostics = await signInTreeseedSceneVisualAuditRole({ page, baseUrl: baseUrlReport.baseUrl, apiBaseUrl, role });
					}
					diagnostics.push(...roleDiagnostics);
				}
				for (const route of discovered.routes) {
					if (!route.roles.includes(role)) continue;
					if (roleDiagnostics.length > 0) {
						captures.push(skipCapture({ role, device: profile.id, route, baseUrl: baseUrlReport.baseUrl, diagnostic: roleDiagnostics[0]! }));
						continue;
					}
					captures.push(await captureRoute({
						page,
						baseUrl: baseUrlReport.baseUrl,
						paths,
						role,
						device: profile.id,
						route,
						includeFullPage: input.includeFullPage ?? scene.visualAudit.includeFullPage,
					}));
				}
				await context.close().catch(() => undefined);
			}
		}
	} finally {
		await browser.close().catch(() => undefined);
	}
	const manifest: TreeseedSceneVisualAuditManifest = {
		schemaVersion: 'treeseed.scene.visual-audit/v1',
		phase: 11,
		generatedAt: new Date().toISOString(),
		sceneId: scene.id,
		auditId: id,
		baseUrl: baseUrlReport.baseUrl,
		roles,
		devices: profiles.map((profile) => profile.id),
		routes: discovered.routes,
		captures,
		diagnostics,
	};
	const reviewEnabled = input.review ?? scene.visualAudit.review.enabled;
	const review = reviewEnabled
		? buildTreeseedSceneVisualAuditReview({
			manifest,
			paths,
			detail: input.reviewDetail ?? scene.visualAudit.review.detail,
			maxFindings: input.maxFindings ?? scene.visualAudit.review.maxFindings,
		})
		: null;
	writeTreeseedSceneVisualAuditReport({ manifest, paths, review });
	if (review) writeTreeseedSceneVisualAuditReview({ manifest, review, paths });
	const failedCount = captures.filter((capture) => capture.status === 'failed').length;
	const skippedCount = captures.filter((capture) => capture.status === 'skipped').length;
	const captureCount = captures.filter((capture) => capture.status === 'captured').length;
	const writeDiagnostics = diagnostics;
	const ok = captureCount > 0;
	return {
		ok,
		phase: 11,
		sceneId: scene.id,
		auditId: id,
		scenePath: validation.scenePath,
		baseUrl: baseUrlReport.baseUrl,
		roles,
		devices: profiles.map((profile) => profile.id),
		routeCount: discovered.routes.length,
		captureCount,
		failedCount,
		skippedCount,
		auditRoot: paths.auditRoot,
		paths,
		manifest,
		review,
		reviewFindingCount: review?.summary.findingCount ?? 0,
		rootCauseCount: review?.summary.rootCauseCount ?? 0,
		incidentCount: review?.summary.incidentCount ?? 0,
		clientErrorCount: review?.summary.clientErrorCount ?? 0,
		diagnostics: writeDiagnostics,
		warnings: splitDiagnostics(writeDiagnostics, 'warning'),
		blockers: splitDiagnostics(writeDiagnostics, 'error'),
	};
}

export { discoverTreeseedSceneVisualAuditRoutes } from './visual-audit-routes.ts';
