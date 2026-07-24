import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readDevInstance } from '../../local-dev/managed-dev.ts';
import { resolveSceneBaseUrl } from '../support/execution/base-url.ts';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../support/reporting/diagnostics.ts';
import { resolveSceneDeviceProfile } from '../runtime/devices.ts';
import { prepareSceneEnvironment } from '../configuration/environment.ts';
import { validateScene } from '../support/execution/planner.ts';
import { writeSceneVisualAuditReport } from '../support/visual-audit/visual-audit-report.ts';
import {
	buildSceneVisualAuditReview,
	isSceneVisualAuditIgnoredClientError,
	writeSceneVisualAuditReview,
} from '../support/visual-audit/visual-audit-review.ts';
import {
	discoverSceneVisualAuditRoutes,
	SceneVisualAuditRouteFilename,
} from '../support/visual-audit/visual-audit-routes.ts';
import {
	ensureSceneVisualAuditRoleFixtures,
	signInSceneVisualAuditRole,
	validateSceneVisualAuditRoles,
} from '../testing/visual-audit-fixtures.ts';
import type {
	SceneDeviceProfile,
	SceneVisualAuditClientError,
	SceneDiagnostic,
	SceneVisualAuditCapture,
	SceneVisualAuditManifest,
	SceneVisualAuditOptions,
	SceneVisualAuditPaths,
	SceneVisualAuditReport,
	SceneVisualAuditRole,
} from '../types.ts';
import { auditId, compactTimestamp, loadPlaywright, pathsFor, resolveVisualAuditApiBaseUrl, splitDiagnostics } from './split-diagnostics.ts';
import { browserContextOptions, captureRoute, runVisualAuditPreflight, skipCapture } from './capture-route.ts';

export async function runSceneVisualAudit(input: SceneVisualAuditOptions): Promise<SceneVisualAuditReport> {
	const validation = validateScene({ projectRoot: input.projectRoot, scene: input.scene });
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
	const diagnostics: SceneDiagnostic[] = [...validateSceneVisualAuditRoles(roles)];
	const profiles: SceneDeviceProfile[] = [];
	for (const device of requestedDevices) {
		const resolved = resolveSceneDeviceProfile({ scene, device });
		diagnostics.push(...resolved.diagnostics);
		if (resolved.profile) profiles.push(resolved.profile);
	}
	const environmentReport = await prepareSceneEnvironment({ projectRoot: input.projectRoot, scene, environment, env: process.env });
	diagnostics.push(...environmentReport.diagnostics);
	const baseUrlReport = resolveSceneBaseUrl({ projectRoot: input.projectRoot, scene, environment, environmentReport });
	diagnostics.push(...baseUrlReport.diagnostics);
	const discovered = discoverSceneVisualAuditRoutes({
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
		diagnostics.push(...await ensureSceneVisualAuditRoleFixtures({ baseUrl: apiBaseUrl, roles }));
	}
	const timestamp = compactTimestamp(input.timestamp);
	const id = auditId(timestamp);
	const paths = pathsFor({ projectRoot: input.projectRoot, sceneId: scene.id, timestamp, auditId: id });
	mkdirSync(paths.screenshotsRoot, { recursive: true });
	const captures: SceneVisualAuditCapture[] = [];
	const playwright = await loadPlaywright();
	const browser = await playwright.chromium.launch();
	try {
		for (const role of roles) {
			const roleRequiresLogin = role !== 'anonymous';
			for (const profile of profiles) {
				const context = await browser.newContext(browserContextOptions(profile));
				const page = await context.newPage();
				let roleDiagnostics: SceneDiagnostic[] = [];
				if (roleRequiresLogin) {
					if (environment !== 'local') {
						roleDiagnostics = [sceneErrorDiagnostic('scene.visual_audit_fixture_unavailable', 'Authenticated visual audit fixture sessions are local-only in this implementation.', 'roles')];
					} else {
						roleDiagnostics = await signInSceneVisualAuditRole({ page, baseUrl: baseUrlReport.baseUrl, apiBaseUrl, role });
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
	const manifest: SceneVisualAuditManifest = {
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
		? buildSceneVisualAuditReview({
			manifest,
			paths,
			detail: input.reviewDetail ?? scene.visualAudit.review.detail,
			maxFindings: input.maxFindings ?? scene.visualAudit.review.maxFindings,
		})
		: null;
	writeSceneVisualAuditReport({ manifest, paths, review });
	if (review) writeSceneVisualAuditReview({ manifest, review, paths });
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

export { discoverSceneVisualAuditRoutes } from '../support/visual-audit/visual-audit-routes.ts';
