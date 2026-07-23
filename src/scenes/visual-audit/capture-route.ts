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
import { captureId, captureLooksHealthy, clientErrorId, collectDomSummary, expectedStatusMatches, hasTransientVisualAuditServerError, pathFromUrl, screenshotPath } from './split-diagnostics.ts';

export async function captureRoute(input: {
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

export function skipCapture(input: {
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

export function browserContextOptions(profile: TreeseedSceneDeviceProfile) {
	return {
		viewport: profile.viewport,
		screen: profile.viewport,
		deviceScaleFactor: profile.deviceScaleFactor ?? 1,
		isMobile: profile.isMobile ?? false,
		hasTouch: profile.hasTouch ?? false,
		...(profile.userAgent ? { userAgent: profile.userAgent } : {}),
	};
}

export function visualAuditPreflightRoutes() {
	return ['/', '/auth/register', '/agents', '/questions', '/app'];
}

export async function runVisualAuditPreflight(baseUrl: string): Promise<TreeseedSceneDiagnostic[]> {
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
