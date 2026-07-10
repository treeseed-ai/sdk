import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneActionKind, sceneExpectationKinds } from './schema.ts';
import { planTreeseedScene, validateTreeseedScene } from './planner.ts';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import { resolveTreeseedSceneDeviceProfile } from './devices.ts';
import { planTreeseedSceneArtifactPaths } from './phase0.ts';
import { resolveTreeseedSceneApiBaseUrl, resolveTreeseedSceneBaseUrl } from './base-url.ts';
import { prepareTreeseedSceneEnvironment } from './environment.ts';
import { resolveTreeseedSceneAuth } from './auth.ts';
import { planOrApplyTreeseedSceneSeed } from './seed.ts';
import { extractTreeseedSceneOperationIds, waitForTreeseedSceneOperation } from './operations.ts';
import { collectTreeseedSceneLogs } from './logs.ts';
import { createPlaywrightTreeseedSceneBrowserAdapter } from './playwright-adapter.ts';
import { createTreeseedSceneRuntimePluginContext } from './plugins.ts';
import { resolveTreeseedScenePlugins } from './registry.ts';
import { createTreeseedSceneTimeline } from './timeline.ts';
import { createTreeseedSceneProgress } from './progress.ts';
import { ensureTreeseedSceneVisualAuditRoleFixtures, signInTreeseedSceneVisualAuditRole } from './visual-audit-fixtures.ts';
import { withTreeseedSceneTimeout } from './timeouts.ts';
import { createTreeseedSceneCheckpoint, writeTreeseedSceneCheckpoint } from './checkpoints.ts';
import {
	createTreeseedSceneChapterReports,
	createTreeseedSceneSegment,
	deriveTreeseedSceneStepChapters,
	finishTreeseedSceneSegment,
	writeTreeseedSceneSegmentArtifacts,
} from './segments.ts';
import {
	appendTreeseedSceneJsonl,
	createTreeseedSceneRunArtifacts,
	ensureTreeseedSceneRunDirectories,
	writeTreeseedSceneRunArtifacts,
} from './artifacts.ts';
import { writeTreeseedSceneMarkdownReport } from './reporter.ts';
import type {
	TreeseedSceneAction,
	TreeseedSceneAssertionRunReport,
	TreeseedSceneBrowserSession,
	TreeseedSceneDiagnostic,
	TreeseedSceneObservedError,
	TreeseedSceneOperationWaitReport,
	TreeseedSceneRunOptions,
	TreeseedSceneRunReport,
	TreeseedSceneRunSetupReport,
	TreeseedSceneRunStepReport,
	TreeseedSceneValidationReport,
	TreeseedScenePlanReport,
	TreeseedSceneManifest,
	TreeseedSceneRenderEvidenceFit,
	TreeseedSceneDeviceProfile,
	TreeseedSceneVisualAuditRole,
} from './types.ts';

function now() {
	return new Date();
}

function duration(start: Date, end: Date) {
	return Math.max(0, end.getTime() - start.getTime());
}

function splitDiagnostics(diagnostics: TreeseedSceneDiagnostic[], severity: 'error' | 'warning') {
	return diagnostics.filter((entry) => entry.severity === severity);
}

function renderResolution(scene: TreeseedSceneManifest) {
	return scene.render.remotion?.output?.resolution ?? { width: 1920, height: 1080 };
}

function defaultCaptureViewport(scene: TreeseedSceneManifest) {
	const resolution = renderResolution(scene);
	if (resolution.width === 1920 && resolution.height === 1080) return { width: 1600, height: 900 };
	return scene.target.viewport;
}

function resolveCapture(input: {
	scene: TreeseedSceneManifest;
	device?: TreeseedSceneDeviceProfile | null;
	runtimeMode: TreeseedSceneManifest['runtime']['mode'];
	recording: boolean;
}) {
	const remotion = input.scene.render.remotion;
	const recordedDemo = input.recording && ['demo', 'training', 'record-only'].includes(input.runtimeMode);
	const viewport = recordedDemo
		? input.device?.viewport ?? remotion?.capture?.viewport ?? defaultCaptureViewport(input.scene)
		: input.device?.viewport ?? input.scene.target.viewport;
	const videoSize = input.recording
		? input.device?.video ?? remotion?.capture?.video ?? viewport ?? { width: 1600, height: 900 }
		: null;
	const evidenceFit: TreeseedSceneRenderEvidenceFit = remotion?.capture?.evidenceFit ?? 'fixed-browser';
	return {
		viewport,
		videoSize,
		renderResolution: input.device?.output ?? remotion?.output?.resolution ?? null,
		evidenceFit,
	};
}

function reportFromBlock(input: {
	scenePath: string;
	sceneId: string | null;
	runId: string | null;
	startedAt: Date;
	environment: TreeseedSceneRunReport['environment'];
	browser: TreeseedSceneRunReport['browser'];
	baseUrl?: string | null;
	device?: TreeseedSceneDeviceProfile | null;
	diagnostics: TreeseedSceneDiagnostic[];
	artifacts?: TreeseedSceneRunReport['artifacts'];
	setup?: TreeseedSceneRunSetupReport | null;
	operations?: TreeseedSceneOperationWaitReport[];
}): TreeseedSceneRunReport {
	const finishedAt = now();
	return {
		ok: false,
		phase: 5,
		sceneId: input.sceneId,
		runId: input.runId,
		scenePath: input.scenePath,
		startedAt: input.startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: duration(input.startedAt, finishedAt),
		environment: input.environment,
		baseUrl: input.baseUrl ?? null,
		browser: input.browser,
		device: input.device ?? null,
		workflowStatus: 'blocked',
		steps: [],
		failedStep: null,
		assertions: [],
		artifacts: input.artifacts ?? null,
		timelinePath: input.artifacts?.timelinePath ?? null,
		playwrightTracePath: input.artifacts?.playwrightTracePath ?? null,
		videoPaths: [],
		renderedVideoPaths: [],
		logs: {},
		setup: input.setup ?? null,
		operations: input.operations ?? [],
		chapters: [],
		segments: [],
		checkpoints: [],
		resumedFrom: null,
		progressPath: input.artifacts?.progressPath ?? null,
		warnings: splitDiagnostics(input.diagnostics, 'warning'),
		blockers: splitDiagnostics(input.diagnostics, 'error'),
		diagnostics: input.diagnostics,
	};
}

function playwrightDiagnostic(error: unknown) {
	const code = error && typeof error === 'object' && 'treeseedSceneCode' in error
		? String((error as { treeseedSceneCode?: unknown }).treeseedSceneCode)
		: 'scene.playwright_unavailable';
	const remediation = code === 'scene.playwright_browser_missing'
		? ' Run `npm -w packages/sdk exec playwright install chromium`.'
		: '';
	return sceneErrorDiagnostic(code, `${error instanceof Error ? error.message : String(error ?? 'Playwright unavailable.')}${remediation}`, 'playwright');
}

function validationForInput(input: TreeseedSceneRunOptions): TreeseedSceneValidationReport {
	if (typeof input.scene === 'string') return validateTreeseedScene({ projectRoot: input.projectRoot, scene: input.scene });
	return {
		ok: true,
		scenePath: '<normalized-scene>',
		scene: input.scene,
		diagnostics: [],
	};
}

function planForInput(input: TreeseedSceneRunOptions, validation: TreeseedSceneValidationReport): TreeseedScenePlanReport {
	if (typeof input.scene === 'string') {
		return planTreeseedScene({
			projectRoot: input.projectRoot,
			scene: input.scene,
			environment: input.environment,
			runId: input.runId,
			timestamp: input.timestamp,
		});
	}
	const scene = validation.scene!;
	const environment = input.environment ?? scene.target.environment;
	const browser = input.browser ?? scene.target.browser;
	const workflowSteps = scene.workflow.map((step) => ({
		id: step.id,
		title: step.title,
		actionKind: sceneActionKind(step.action),
		assertionKinds: sceneExpectationKinds(step.expect),
		chapterId: null,
		demoOnly: step.demoOnly === true,
	}));
	const actionIds = [...new Set(workflowSteps.map((step) => step.actionKind))];
	const assertionIds = [...new Set(workflowSteps.flatMap((step) => step.assertionKinds))];
	const pluginResolution = resolveTreeseedScenePlugins({ plugins: input.plugins });
	return {
		ok: pluginResolution.ok,
		phase: 1,
		scenePath: '<normalized-scene>',
		sceneId: scene.id,
		title: scene.title,
		environment,
		baseUrl: scene.target.baseUrl,
		browser,
		viewport: scene.target.viewport,
		workflowSteps,
		enabledActions: actionIds,
		enabledAssertions: assertionIds,
		enabledRenderers: [],
		enabledDiagrams: [],
		enabledDiagramPlugins: [],
		enabledTrainingOutputs: [],
		enabledNarrationPlugins: [],
		enabledDeviceProfiles: scene.devices.profiles.map((profile) => profile.id).sort(),
		enabledPlugins: [],
		plugins: pluginResolution.summaries,
		pluginDiagnostics: pluginResolution.diagnostics,
		artifactPaths: planTreeseedSceneArtifactPaths({
			workspaceRoot: input.projectRoot,
			sceneId: scene.id,
			runId: input.runId,
			timestamp: input.timestamp,
		}),
		diagnostics: pluginResolution.diagnostics,
		warnings: pluginResolution.diagnostics.filter((entry) => entry.severity === 'warning'),
		blockers: pluginResolution.diagnostics.filter((entry) => entry.severity === 'error'),
		estimatedDurationSeconds: null,
	};
}

function canContinueAfterFailure(scene: TreeseedSceneManifest, step: { demoOnly?: boolean; continueOnFailure?: boolean }) {
	return scene.runtime.mode === 'demo'
		|| scene.runtime.mode === 'training'
		|| step.demoOnly === true
		|| step.continueOnFailure === true
		|| scene.runtime.failure.continueOnFailure === true;
}

function sceneWithRunOverrides(scene: TreeseedSceneManifest, input: TreeseedSceneRunOptions): TreeseedSceneManifest {
	if (!input.authRole) return scene;
	return {
		...scene,
		setup: {
			...scene.setup,
			auth: {
				...(scene.setup.auth ?? {}),
				required: input.authRole !== 'anonymous',
				role: (scene.setup.auth?.role ?? input.authRole) as TreeseedSceneVisualAuditRole,
			},
		},
	};
}

export async function runTreeseedScene(input: TreeseedSceneRunOptions): Promise<TreeseedSceneRunReport> {
	const startedAt = now();
	const validation = validationForInput(input);
	if (!validation.ok || !validation.scene) {
		return reportFromBlock({
			scenePath: validation.scenePath,
			sceneId: validation.scene?.id ?? null,
			runId: input.runId ?? null,
			startedAt,
			environment: input.environment ?? validation.scene?.target.environment ?? 'local',
			browser: validation.scene?.target.browser ?? null,
			diagnostics: validation.diagnostics,
		});
	}
	const scene = sceneWithRunOverrides(validation.scene, input);
	const browser = input.browser ?? scene.target.browser;
	const deviceResolution = resolveTreeseedSceneDeviceProfile({ scene, device: input.device });
	if (!deviceResolution.profile && deviceResolution.diagnostics.some((entry) => entry.severity === 'error')) {
		return reportFromBlock({
			scenePath: validation.scenePath,
			sceneId: scene.id,
			runId: input.runId ?? null,
			startedAt,
			environment: input.environment ?? scene.target.environment,
			browser,
			diagnostics: deviceResolution.diagnostics,
		});
	}
	const device = deviceResolution.profile;
	const runtime = input.mode ? { ...scene.runtime, mode: input.mode } : scene.runtime;
	const pluginResolution = resolveTreeseedScenePlugins({ plugins: input.plugins });
	const registry = pluginResolution.registry;
	const environmentProvider = registry.environmentProviders[0];
	const plan = planForInput(input, validation);
	if (!plan.ok || !plan.artifactPaths) {
		return reportFromBlock({
			scenePath: validation.scenePath,
			sceneId: scene.id,
			runId: input.runId ?? null,
			startedAt,
			environment: plan.environment,
			browser,
			device,
			diagnostics: plan.diagnostics,
		});
	}

	const paths = plan.artifactPaths;
	ensureTreeseedSceneRunDirectories(paths);
	const screenshotOnlyArtifacts = input.artifactMode === 'screenshots';
	const tracePath = scene.artifacts.trace ? join(paths.playwrightRoot, 'trace.zip') : null;
	const videoDir = !screenshotOnlyArtifacts && (input.record || scene.artifacts.video) ? join(paths.playwrightRoot, 'videos') : null;
	const recordingVideo = Boolean(videoDir);
	const capture = resolveCapture({ scene, device, runtimeMode: runtime.mode, recording: Boolean(videoDir) });
	const artifacts = createTreeseedSceneRunArtifacts({ paths, playwrightTracePath: tracePath });
	writeFileSync(artifacts.consoleLogPath ?? join(paths.playwrightRoot, 'console.jsonl'), '', 'utf8');
	writeFileSync(artifacts.networkLogPath ?? join(paths.playwrightRoot, 'network.jsonl'), '', 'utf8');
	writeFileSync(artifacts.errorsLogPath ?? join(paths.playwrightRoot, 'errors.jsonl'), '', 'utf8');
	if (artifacts.progressPath) writeFileSync(artifacts.progressPath, '', 'utf8');

	const timeline = createTreeseedSceneTimeline({ sceneId: scene.id, runId: paths.runId, startedAtMs: startedAt.getTime() });
	const progress = createTreeseedSceneProgress({ sceneId: scene.id, runId: paths.runId, startedAtMs: startedAt.getTime(), progressPath: artifacts.progressPath, onProgress: input.onProgress });
	progress.push('scene.run.started', { title: scene.title, environment: plan.environment });
	progress.push('scene.run.heartbeat', { status: 'starting' });
	timeline.push('scene.start', { title: scene.title, environment: plan.environment });
	timeline.push('setup.start', { environment: plan.environment });
	progress.push('setup.started', { environment: plan.environment });
	timeline.push('readiness.start', { environment: plan.environment });
	const environmentAdapter = input.environmentAdapter ?? environmentProvider?.prepare ?? prepareTreeseedSceneEnvironment;
	const environmentReport = await environmentAdapter({ projectRoot: input.projectRoot, scene, environment: plan.environment, env: process.env });
	timeline.push('readiness.end', { ok: environmentReport.ok, diagnostics: environmentReport.diagnostics.length });
	timeline.push('auth.resolve', { required: scene.setup.auth?.required === true });
	const authResolver = input.authResolver ?? environmentProvider?.resolveAuth ?? resolveTreeseedSceneAuth;
	const authReport = authResolver({ projectRoot: input.projectRoot, scene, environment: plan.environment });
	const seedRunner = input.seedRunner ?? environmentProvider?.prepareSeed ?? planOrApplyTreeseedSceneSeed;
	const seedMode = scene.setup.seed?.apply ? 'apply' : scene.setup.seed?.name ? 'plan' : 'none';
	if (seedMode === 'apply') timeline.push('seed.apply.start', { seed: scene.setup.seed?.name ?? null });
	else if (seedMode === 'plan') timeline.push('seed.plan.start', { seed: scene.setup.seed?.name ?? null });
	const seedReport = await seedRunner({ projectRoot: input.projectRoot, scene, environment: plan.environment, auth: authReport, env: process.env });
	if (seedMode === 'apply') timeline.push('seed.apply.end', { ok: seedReport.ok, seed: seedReport.seedName });
	else if (seedMode === 'plan') timeline.push('seed.plan.end', { ok: seedReport.ok, seed: seedReport.seedName });
	const setup: TreeseedSceneRunSetupReport = { environment: environmentReport, auth: authReport, seed: seedReport };
	timeline.push('setup.end', { ok: environmentReport.ok && authReport.ok && seedReport.ok });
	progress.push('setup.finished', { ok: environmentReport.ok && authReport.ok && seedReport.ok });
	const setupDiagnostics = [...pluginResolution.diagnostics, ...environmentReport.diagnostics, ...authReport.diagnostics, ...seedReport.diagnostics];
	if (setupDiagnostics.some((entry) => entry.severity === 'error')) {
		const report = reportFromBlock({
			scenePath: validation.scenePath,
			sceneId: scene.id,
			runId: paths.runId,
			startedAt,
			environment: plan.environment,
			browser,
			device,
			diagnostics: [...plan.diagnostics, ...setupDiagnostics],
			artifacts,
			setup,
		});
		const logReport = (input.logCollector ?? collectTreeseedSceneLogs)({ projectRoot: input.projectRoot, artifacts, environmentReport });
		report.logs = { ...report.logs, ...logReport.logs };
		report.diagnostics.push(...logReport.diagnostics);
		report.warnings = splitDiagnostics(report.diagnostics, 'warning');
		report.blockers = splitDiagnostics(report.diagnostics, 'error');
		timeline.push('scene.end', { status: report.workflowStatus });
		progress.push('scene.run.finished', { ok: report.ok }, { status: report.workflowStatus });
		writeTreeseedSceneMarkdownReport(report);
		writeTreeseedSceneRunArtifacts({ scene, plan, report, timeline: timeline.events });
		return report;
	}

	const baseUrlResolver = environmentProvider?.resolveBaseUrl ?? resolveTreeseedSceneBaseUrl;
	const baseUrl = baseUrlResolver({ projectRoot: input.projectRoot, scene, environment: plan.environment, environmentReport });
	if (!baseUrl.ok || !baseUrl.baseUrl) {
		const report = reportFromBlock({
			scenePath: validation.scenePath,
			sceneId: scene.id,
			runId: paths.runId,
			startedAt,
			environment: plan.environment,
			browser,
			device,
			diagnostics: [...plan.diagnostics, ...setupDiagnostics, ...baseUrl.diagnostics],
			artifacts,
			setup,
		});
		const logReport = (input.logCollector ?? collectTreeseedSceneLogs)({ projectRoot: input.projectRoot, artifacts, environmentReport });
		report.logs = { ...report.logs, ...logReport.logs };
		report.diagnostics.push(...logReport.diagnostics);
		report.warnings = splitDiagnostics(report.diagnostics, 'warning');
		report.blockers = splitDiagnostics(report.diagnostics, 'error');
		timeline.push('scene.end', { status: report.workflowStatus });
		progress.push('scene.run.finished', { ok: report.ok }, { status: report.workflowStatus });
		writeTreeseedSceneMarkdownReport(report);
		writeTreeseedSceneRunArtifacts({ scene, plan, report, timeline: timeline.events });
		return report;
	}
	if (scene.setup.auth?.role && scene.setup.auth.role !== 'anonymous') {
		const apiBaseUrl = resolveTreeseedSceneApiBaseUrl({ projectRoot: input.projectRoot, environment: plan.environment, webBaseUrl: baseUrl.baseUrl });
		const roleFixtureDiagnostics = await ensureTreeseedSceneVisualAuditRoleFixtures({
			baseUrl: apiBaseUrl,
			roles: [scene.setup.auth.role],
			projectRoot: input.projectRoot,
			environment: plan.environment,
		});
		setupDiagnostics.push(...roleFixtureDiagnostics);
	}

	const adapter = input.browserAdapter ?? createPlaywrightTreeseedSceneBrowserAdapter();
	let session: TreeseedSceneBrowserSession | null = null;
	const steps: TreeseedSceneRunStepReport[] = [];
	const diagnostics: TreeseedSceneDiagnostic[] = [...plan.diagnostics, ...setupDiagnostics];
	let failedStep: string | null = null;
	let currentStepId: string | undefined;
	const consoleErrors: TreeseedSceneObservedError[] = [];
	const networkErrors: TreeseedSceneObservedError[] = [];
	const linkedOperationIds: string[] = [];
	const operationReports: TreeseedSceneOperationWaitReport[] = [];
	const operationWaiter = input.operationWaiter ?? waitForTreeseedSceneOperation;
	const stepChapters = deriveTreeseedSceneStepChapters(scene);
	const chapters = createTreeseedSceneChapterReports(scene);
	const segments: TreeseedSceneRunReport['segments'] = [];
	const checkpoints: TreeseedSceneRunReport['checkpoints'] = [];
	const completedStepIds: string[] = [];
	let currentChapterId: string | null = null;
	let currentSegment: TreeseedSceneRunReport['segments'][number] | null = null;
	const segmentIndexes = new Map<string, number>();
	let sessionClosed = false;
	try {
		session = await adapter.launch({
			browser,
			viewport: capture.viewport,
			videoSize: capture.videoSize,
			recordVideoDir: videoDir,
			tracePath,
			userAgent: device?.userAgent,
			deviceScaleFactor: device?.deviceScaleFactor,
			isMobile: device?.isMobile,
			hasTouch: device?.hasTouch,
		});
		session.page.on('console', (message) => {
			if (message.type() !== 'error') return;
			const entry = { message: message.text(), timestamp: now().toISOString(), ...(currentStepId ? { stepId: currentStepId } : {}) };
			consoleErrors.push(entry);
			if (artifacts.consoleLogPath) appendTreeseedSceneJsonl(artifacts.consoleLogPath, entry);
			if (artifacts.errorsLogPath) appendTreeseedSceneJsonl(artifacts.errorsLogPath, { kind: 'console', ...entry });
			timeline.push('console', entry, currentStepId);
		});
		session.page.on('requestfailed', (request) => {
			const entry = { message: request.failure()?.errorText ?? 'request failed', timestamp: now().toISOString(), url: request.url(), method: request.method(), ...(currentStepId ? { stepId: currentStepId } : {}) };
			networkErrors.push(entry);
			if (artifacts.networkLogPath) appendTreeseedSceneJsonl(artifacts.networkLogPath, entry);
			if (artifacts.errorsLogPath) appendTreeseedSceneJsonl(artifacts.errorsLogPath, { kind: 'network', ...entry });
			timeline.push('network', entry, currentStepId);
		});
		session.page.on('response', (response) => {
			const status = response.status();
			response.json?.().then((payload) => {
				const ids = extractTreeseedSceneOperationIds(payload);
				for (const id of ids) {
					if (!linkedOperationIds.includes(id)) linkedOperationIds.push(id);
					timeline.push('operation.detected', { operationId: id, url: response.url() }, currentStepId);
				}
			}).catch(() => undefined);
			if (status < 400) return;
			const entry = { message: `HTTP ${status}`, timestamp: now().toISOString(), url: response.url(), method: response.request().method(), status, ...(currentStepId ? { stepId: currentStepId } : {}) };
			networkErrors.push(entry);
			if (artifacts.networkLogPath) appendTreeseedSceneJsonl(artifacts.networkLogPath, entry);
			if (artifacts.errorsLogPath) appendTreeseedSceneJsonl(artifacts.errorsLogPath, { kind: 'network', ...entry });
			timeline.push('network', entry, currentStepId);
		});
		if (tracePath) await session.startTracing?.();
		if (scene.setup.auth?.role && scene.setup.auth.role !== 'anonymous') {
			const signInDiagnostics = await signInTreeseedSceneVisualAuditRole({
				page: session.page,
				baseUrl: baseUrl.baseUrl,
				apiBaseUrl: resolveTreeseedSceneApiBaseUrl({ projectRoot: input.projectRoot, environment: plan.environment, webBaseUrl: baseUrl.baseUrl }),
				role: scene.setup.auth.role,
			});
			diagnostics.push(...signInDiagnostics);
			if (signInDiagnostics.some((entry) => entry.severity === 'error')) {
				throw signInDiagnostics.find((entry) => entry.severity === 'error')
					?? sceneErrorDiagnostic('scene.auth_required', `Could not sign in scene role ${scene.setup.auth.role}.`, 'setup.auth.role');
			}
		}
		for (const step of scene.workflow) {
			const chapter = stepChapters.get(step.id);
			if (chapter && chapter.id !== currentChapterId) {
				if (currentSegment) {
					finishTreeseedSceneSegment(currentSegment, currentSegment.status);
					writeTreeseedSceneSegmentArtifacts({
						segment: currentSegment,
						steps: steps.filter((entry) => currentSegment?.stepIds.includes(entry.id)),
						timeline: timeline.events.filter((entry) => !entry.stepId || currentSegment?.stepIds.includes(entry.stepId)),
					});
					timeline.push('segment.end', { status: currentSegment.status }, currentSegment.stepIds.at(-1));
					progress.push('segment.finished', { status: currentSegment.status }, { chapterId: currentSegment.chapterId, segmentId: currentSegment.id, status: currentSegment.status });
				}
				if (currentChapterId) {
					const previousChapter = chapters.find((entry) => entry.id === currentChapterId);
					if (previousChapter) {
						previousChapter.finishedAt = now().toISOString();
						previousChapter.durationMs = Math.max(0, Date.parse(previousChapter.finishedAt) - Date.parse(previousChapter.startedAt));
						timeline.push('chapter.end', { status: previousChapter.status }, previousChapter.stepIds.at(-1));
						progress.push('chapter.finished', { status: previousChapter.status }, { chapterId: previousChapter.id, status: previousChapter.status });
					}
				}
				currentChapterId = chapter.id;
				const chapterReport = chapters.find((entry) => entry.id === chapter.id);
				if (chapterReport) {
					chapterReport.startedAt = now().toISOString();
					timeline.push('chapter.start', { title: chapterReport.title }, step.id);
					progress.push('chapter.started', { title: chapterReport.title }, { chapterId: chapterReport.id, stepId: step.id });
				}
				const nextIndex = (segmentIndexes.get(chapter.id) ?? 0) + 1;
				segmentIndexes.set(chapter.id, nextIndex);
				currentSegment = createTreeseedSceneSegment({ segmentsRoot: paths.segmentsRoot, chapterId: chapter.id, index: nextIndex });
				segments.push(currentSegment);
				chapterReport?.segmentIds.push(currentSegment.id);
				timeline.push('segment.start', { chapterId: chapter.id, segmentId: currentSegment.id }, step.id);
				progress.push('segment.started', { chapterId: chapter.id }, { chapterId: chapter.id, segmentId: currentSegment.id, stepId: step.id });
			}
			const actionKind = sceneActionKind(step.action);
			const stepStartedAt = now();
			currentStepId = step.id;
			currentSegment?.stepIds.push(step.id);
			progress.push('step.started', { title: step.title, actionKind }, { chapterId: currentChapterId, segmentId: currentSegment?.id ?? null, stepId: step.id });
			timeline.push('step.start', { title: step.title, actionKind }, step.id);
			const stepConsoleStart = consoleErrors.length;
			const stepNetworkStart = networkErrors.length;
			let stepDiagnostic: TreeseedSceneDiagnostic | undefined;
			let assertionResults: TreeseedSceneAssertionRunReport[] = [];
			let status: TreeseedSceneRunStepReport['status'] = 'passed';
			timeline.push('action.start', { actionKind }, step.id);
			try {
				const runtimeContext = createTreeseedSceneRuntimePluginContext({
					projectRoot: input.projectRoot,
					scene,
					environment: plan.environment,
					runId: paths.runId,
					session,
					baseUrl: baseUrl.baseUrl,
					timeline,
					artifacts,
					linkedOperationIds,
					operationReports,
					operationWaiter,
					interactive: input.interactive === true,
					pauseController: input.pauseController,
					sleep: input.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))),
					progress,
				});
				const actionHandler = registry.actions.get(actionKind);
				if (!actionHandler) {
					throw sceneErrorDiagnostic('scene.unknown_runtime_action', `No scene action plugin is registered for "${actionKind}".`, `workflow.${step.id}.action`);
				}
				if (actionHandler.status !== 'available') {
					throw sceneErrorDiagnostic('scene.unsupported_runtime_action', `Action "${actionKind}" is ${actionHandler.status} and is planned for Phase ${actionHandler.phase}.`, `workflow.${step.id}.action`);
				}
				const actionResult = await withTreeseedSceneTimeout({
					promise: actionHandler.run({ action: step.action, actionKind, step, context: runtimeContext }),
					timeoutMs: (step.timeoutSeconds ?? runtime.timeouts.stepSeconds) * 1000,
					diagnostic: sceneErrorDiagnostic('scene.step_timeout', `Step timed out after ${step.timeoutSeconds ?? runtime.timeouts.stepSeconds} seconds.`, `workflow.${step.id}`),
				});
				if (!actionResult.ok) throw actionResult.diagnostics[0] ?? sceneErrorDiagnostic('scene.step_failed', `Action "${actionKind}" failed.`, `workflow.${step.id}.action`);
				if (actionResult.operationReport?.operationId && !linkedOperationIds.includes(actionResult.operationReport.operationId)) linkedOperationIds.push(actionResult.operationReport.operationId);
				timeline.push('action.end', { actionKind, status: 'passed' }, step.id);
				for (const assertionKind of sceneExpectationKinds(step.expect)) {
					const assertionHandler = registry.assertions.get(assertionKind);
					if (!assertionHandler) {
						throw sceneErrorDiagnostic('scene.unknown_runtime_assertion', `No scene assertion plugin is registered for "${assertionKind}".`, `workflow.${step.id}.expect.${assertionKind}`);
					}
					if (assertionHandler.status !== 'available') {
						throw sceneErrorDiagnostic('scene.unsupported_runtime_assertion', `Assertion "${assertionKind}" is ${assertionHandler.status} and is planned for Phase ${assertionHandler.phase}.`, `workflow.${step.id}.expect.${assertionKind}`);
					}
					assertionResults.push(await assertionHandler.run({
						kind: assertionKind,
						value: step.expect?.[assertionKind as keyof typeof step.expect],
						step,
						context: runtimeContext,
					}));
				}
				for (const assertion of assertionResults) {
					timeline.push('assertion.end', { kind: assertion.kind, status: assertion.status }, step.id);
				}
				const failedAssertion = assertionResults.find((assertion) => assertion.status === 'failed');
				if (failedAssertion?.error) throw failedAssertion.error;
			} catch (error) {
				status = 'failed';
				stepDiagnostic = error && typeof error === 'object' && 'code' in error
					? error as TreeseedSceneDiagnostic
					: sceneErrorDiagnostic('scene.step_failed', error instanceof Error ? error.message : String(error ?? 'Step failed.'), `workflow.${step.id}`);
				diagnostics.push(stepDiagnostic);
				timeline.push('error', { code: stepDiagnostic.code, message: stepDiagnostic.message }, step.id);
				if (!failedStep) failedStep = step.id;
			}
			const screenshotPath = scene.artifacts.screenshots ? join(paths.playwrightRoot, 'screenshots', `${step.id}.png`) : null;
			const viewportScreenshotPath = scene.artifacts.screenshots ? join(paths.playwrightRoot, 'screenshots', 'viewport', `${step.id}.png`) : null;
			if (viewportScreenshotPath) {
				try {
					await session.page.screenshot({ path: viewportScreenshotPath, fullPage: false });
					artifacts.viewportScreenshotPaths?.push(viewportScreenshotPath);
					timeline.push('screenshot.viewport', { path: viewportScreenshotPath }, step.id);
				} catch {
					// Viewport screenshots are a render fallback; full-page evidence remains primary for debugging.
				}
			}
			if (screenshotPath) {
				try {
					await session.page.screenshot({ path: screenshotPath, fullPage: true });
					artifacts.screenshotPaths.push(screenshotPath);
					timeline.push('screenshot', { path: screenshotPath }, step.id);
				} catch {
					// Screenshot failure should not hide the original step result.
				}
			}
			const stepFinishedAt = now();
			const stepReport: TreeseedSceneRunStepReport = {
				id: step.id,
				title: step.title,
				actionKind,
				startedAt: stepStartedAt.toISOString(),
				finishedAt: stepFinishedAt.toISOString(),
				durationMs: duration(stepStartedAt, stepFinishedAt),
				status,
				retryCount: 0,
				assertionResults,
				screenshotPath,
				viewportScreenshotPath,
				traceLocation: tracePath,
				consoleErrors: consoleErrors.slice(stepConsoleStart),
				networkErrors: networkErrors.slice(stepNetworkStart),
				operationIds: [...linkedOperationIds],
				...(stepDiagnostic ? { error: stepDiagnostic } : {}),
			};
			steps.push(stepReport);
			if (currentSegment && status === 'failed') currentSegment.status = 'failed';
			const chapterReport = currentChapterId ? chapters.find((entry) => entry.id === currentChapterId) : null;
			if (chapterReport && status === 'failed') chapterReport.status = 'failed';
			timeline.push('step.end', { status, durationMs: stepReport.durationMs }, step.id);
			progress.push('step.finished', { durationMs: stepReport.durationMs }, { chapterId: currentChapterId, segmentId: currentSegment?.id ?? null, stepId: step.id, status });
			if (status === 'passed') {
				completedStepIds.push(step.id);
				if (runtime.checkpoints.enabled && runtime.checkpoints.everyStep) {
					const stepIndex = scene.workflow.findIndex((entry) => entry.id === step.id);
					const checkpoint = createTreeseedSceneCheckpoint({
						paths,
						sceneId: scene.id,
						runId: paths.runId,
						stepId: step.id,
						chapterId: currentChapterId ?? 'default',
						segmentId: currentSegment?.id ?? 'default-segment-001',
						completedStepIds,
						nextStepId: scene.workflow[stepIndex + 1]?.id ?? null,
						checkpointId: step.checkpoint?.id ?? step.id,
						resumable: step.checkpoint?.resumable ?? runtime.checkpoints.defaultResumable,
					});
					checkpoints.push(checkpoint);
					writeTreeseedSceneCheckpoint(checkpoint);
					timeline.push('checkpoint.write', { checkpointId: checkpoint.id, resumable: checkpoint.resumable }, step.id);
					progress.push('checkpoint.written', { resumable: checkpoint.resumable }, { chapterId: checkpoint.chapterId, segmentId: checkpoint.segmentId, stepId: step.id, checkpointId: checkpoint.id });
					if (checkpoint.resumable && currentSegment) {
						finishTreeseedSceneSegment(currentSegment, currentSegment.status);
						writeTreeseedSceneSegmentArtifacts({
							segment: currentSegment,
							steps: steps.filter((entry) => currentSegment?.stepIds.includes(entry.id)),
							timeline: timeline.events.filter((entry) => !entry.stepId || currentSegment?.stepIds.includes(entry.stepId)),
						});
						const nextIndex = (segmentIndexes.get(checkpoint.chapterId) ?? 0) + 1;
						segmentIndexes.set(checkpoint.chapterId, nextIndex);
						currentSegment = createTreeseedSceneSegment({ segmentsRoot: paths.segmentsRoot, chapterId: checkpoint.chapterId, index: nextIndex });
						segments.push(currentSegment);
						chapterReport?.segmentIds.push(currentSegment.id);
						timeline.push('segment.start', { chapterId: checkpoint.chapterId, segmentId: currentSegment.id }, step.id);
						progress.push('segment.started', { afterCheckpoint: checkpoint.id }, { chapterId: checkpoint.chapterId, segmentId: currentSegment.id, stepId: step.id });
					}
				}
			}
			currentStepId = undefined;
			if (status === 'failed' && !canContinueAfterFailure({ ...scene, runtime }, step)) break;
		}
		if (currentSegment) {
			finishTreeseedSceneSegment(currentSegment, currentSegment.status);
			writeTreeseedSceneSegmentArtifacts({
				segment: currentSegment,
				steps: steps.filter((entry) => currentSegment?.stepIds.includes(entry.id)),
				timeline: timeline.events.filter((entry) => !entry.stepId || currentSegment?.stepIds.includes(entry.stepId)),
			});
			timeline.push('segment.end', { status: currentSegment.status }, currentSegment.stepIds.at(-1));
			progress.push('segment.finished', { status: currentSegment.status }, { chapterId: currentSegment.chapterId, segmentId: currentSegment.id, status: currentSegment.status });
		}
		if (currentChapterId) {
			const chapterReport = chapters.find((entry) => entry.id === currentChapterId);
			if (chapterReport) {
				chapterReport.finishedAt = now().toISOString();
				chapterReport.durationMs = Math.max(0, Date.parse(chapterReport.finishedAt) - Date.parse(chapterReport.startedAt));
				timeline.push('chapter.end', { status: chapterReport.status }, chapterReport.stepIds.at(-1));
				progress.push('chapter.finished', { status: chapterReport.status }, { chapterId: chapterReport.id, status: chapterReport.status });
			}
		}
		if (tracePath) await session.stopTracing?.(tracePath);
		await session.close().catch(() => undefined);
		sessionClosed = true;
		const videoPaths = await session.videoPaths?.() ?? [];
		artifacts.videoPaths.push(...videoPaths);
	} catch (error) {
		const diagnostic = playwrightDiagnostic(error);
		diagnostics.push(diagnostic);
		failedStep = failedStep ?? null;
	} finally {
		currentStepId = undefined;
		if (!sessionClosed) await session?.close().catch(() => undefined);
	}
	const finishedAt = now();
	const workflowStatus = diagnostics.some((entry) => entry.severity === 'error')
		? (steps.length === 0 ? 'blocked' : 'failed')
		: 'passed';
	const logReport = (input.logCollector ?? collectTreeseedSceneLogs)({ projectRoot: input.projectRoot, artifacts, environmentReport });
	diagnostics.push(...logReport.diagnostics);
	timeline.push('scene.end', { status: workflowStatus });
	progress.push('scene.run.finished', { ok: workflowStatus === 'passed' }, { status: workflowStatus });
	const report: TreeseedSceneRunReport = {
		ok: workflowStatus === 'passed',
		phase: 5,
		sceneId: scene.id,
		runId: paths.runId,
		scenePath: validation.scenePath,
		startedAt: startedAt.toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs: duration(startedAt, finishedAt),
		environment: plan.environment,
		baseUrl: baseUrl.baseUrl,
		browser,
		device,
		capture,
		workflowStatus,
		steps,
		failedStep,
		assertions: steps.flatMap((step) => step.assertionResults),
		artifacts,
		timelinePath: artifacts.timelinePath,
		playwrightTracePath: artifacts.playwrightTracePath,
		videoPaths: artifacts.videoPaths,
		renderedVideoPaths: [],
		logs: {
			console: artifacts.consoleLogPath,
			network: artifacts.networkLogPath,
			errors: artifacts.errorsLogPath,
			...logReport.logs,
		},
		setup,
		operations: operationReports,
		chapters,
		segments,
		checkpoints,
		resumedFrom: null,
		progressPath: artifacts.progressPath ?? null,
		warnings: splitDiagnostics(diagnostics, 'warning'),
		blockers: splitDiagnostics(diagnostics, 'error'),
		diagnostics,
	};
	writeTreeseedSceneMarkdownReport(report);
	writeTreeseedSceneRunArtifacts({ scene, plan, report, timeline: timeline.events });
	return report;
}
