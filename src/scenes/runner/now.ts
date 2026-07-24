import { sceneActionKind, sceneExpectationKinds } from "../support/validation/schema.ts";
import { planScene, validateScene } from "../support/execution/planner.ts";
import { sceneErrorDiagnostic } from "../support/reporting/diagnostics.ts";
import { planSceneArtifactPaths } from "../support/execution/phase0.ts";
import { extractSceneOperationIds } from "../operations/operations.ts";
import { collectSceneLogs } from "../support/reporting/logs.ts";
import { resolveScenePlugins } from "../support/plugins/registry.ts";
import { createSceneTimeline } from "../support/evidence/timeline.ts";
import { appendSceneJsonl } from "../support/evidence/artifacts.ts";
import type { SceneBrowserSession, SceneDiagnostic, SceneObservedError, SceneOperationWaitReport, SceneRunOptions, SceneRunReport, SceneRunSetupReport, SceneValidationReport, ScenePlanReport, SceneManifest, SceneRenderEvidenceFit, SceneDeviceProfile, SceneVisualAuditRole } from "../types.ts";


export function now() {
	return new Date();
}

export function duration(start: Date, end: Date) {
	return Math.max(0, end.getTime() - start.getTime());
}

export function splitDiagnostics(diagnostics: SceneDiagnostic[], severity: 'error' | 'warning') {
	return diagnostics.filter((entry) => entry.severity === severity);
}

export function renderResolution(scene: SceneManifest) {
	return scene.render.remotion?.output?.resolution ?? { width: 1920, height: 1080 };
}

export function defaultCaptureViewport(scene: SceneManifest) {
	const resolution = renderResolution(scene);
	if (resolution.width === 1920 && resolution.height === 1080) return { width: 1600, height: 900 };
	return scene.target.viewport;
}

export function resolveCapture(input: {
	scene: SceneManifest;
	device?: SceneDeviceProfile | null;
	runtimeMode: SceneManifest['runtime']['mode'];
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
	const evidenceFit: SceneRenderEvidenceFit = remotion?.capture?.evidenceFit ?? 'fixed-browser';
	return {
		viewport,
		videoSize,
		renderResolution: input.device?.output ?? remotion?.output?.resolution ?? null,
		evidenceFit,
	};
}

export function reportFromBlock(input: {
	scenePath: string;
	sceneId: string | null;
	runId: string | null;
	startedAt: Date;
	environment: SceneRunReport['environment'];
	browser: SceneRunReport['browser'];
	baseUrl?: string | null;
	device?: SceneDeviceProfile | null;
	diagnostics: SceneDiagnostic[];
	artifacts?: SceneRunReport['artifacts'];
	setup?: SceneRunSetupReport | null;
	operations?: SceneOperationWaitReport[];
}): SceneRunReport {
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

export function playwrightDiagnostic(error: unknown) {
	const code = error && typeof error === 'object' && 'sceneCode' in error
		? String((error as { sceneCode?: unknown }).sceneCode)
		: 'scene.playwright_unavailable';
	const remediation = code === 'scene.playwright_browser_missing'
		? ' Run `npm -w packages/sdk exec playwright install chromium`.'
		: '';
	return sceneErrorDiagnostic(code, `${error instanceof Error ? error.message : String(error ?? 'Playwright unavailable.')}${remediation}`, 'playwright');
}

export function validationForInput(input: SceneRunOptions): SceneValidationReport {
	if (typeof input.scene === 'string') return validateScene({ projectRoot: input.projectRoot, scene: input.scene });
	return {
		ok: true,
		scenePath: '<normalized-scene>',
		scene: input.scene,
		diagnostics: [],
	};
}

export function planForInput(input: SceneRunOptions, validation: SceneValidationReport): ScenePlanReport {
	if (typeof input.scene === 'string') {
		return planScene({
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
	const pluginResolution = resolveScenePlugins({ plugins: input.plugins });
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
		artifactPaths: planSceneArtifactPaths({
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

export function canContinueAfterFailure(scene: SceneManifest, step: { demoOnly?: boolean; continueOnFailure?: boolean }) {
	return scene.runtime.mode === 'demo'
		|| scene.runtime.mode === 'training'
		|| step.demoOnly === true
		|| step.continueOnFailure === true
		|| scene.runtime.failure.continueOnFailure === true;
}

export function sceneWithRunOverrides(scene: SceneManifest, input: SceneRunOptions): SceneManifest {
	if (!input.authRole) return scene;
	return {
		...scene,
		setup: {
			...scene.setup,
			auth: {
				...(scene.setup.auth ?? {}),
				required: input.authRole !== 'anonymous',
				role: (scene.setup.auth?.role ?? input.authRole) as SceneVisualAuditRole,
			},
		},
	};
}

export function appendBlockedSceneLogs(
	report: SceneRunReport,
	input: SceneRunOptions,
	artifacts: SceneRunReport['artifacts'],
	environmentReport: SceneRunSetupReport['environment'],
) {
	const logReport = (input.logCollector ?? collectSceneLogs)({ projectRoot: input.projectRoot, artifacts, environmentReport });
	report.logs = { ...report.logs, ...logReport.logs };
	report.diagnostics.push(...logReport.diagnostics);
	report.warnings = splitDiagnostics(report.diagnostics, 'warning');
	report.blockers = splitDiagnostics(report.diagnostics, 'error');
}

export function registerScenePageObservers(input: {
	session: SceneBrowserSession;
	currentStepId: () => string | undefined;
	consoleErrors: SceneObservedError[];
	networkErrors: SceneObservedError[];
	linkedOperationIds: string[];
	artifacts: SceneRunReport['artifacts'];
	timeline: ReturnType<typeof createSceneTimeline>;
}) {
	input.session.page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const stepId = input.currentStepId();
		const entry = { message: message.text(), timestamp: now().toISOString(), ...(stepId ? { stepId } : {}) };
		input.consoleErrors.push(entry);
		appendSceneJsonl(input.artifacts.consoleLogPath!, entry);
		appendSceneJsonl(input.artifacts.errorsLogPath!, { kind: 'console', ...entry });
		input.timeline.push('console', entry, stepId);
	});
	input.session.page.on('requestfailed', (request) => {
		const stepId = input.currentStepId();
		const entry = { message: request.failure()?.errorText ?? 'request failed', timestamp: now().toISOString(), url: request.url(), method: request.method(), ...(stepId ? { stepId } : {}) };
		input.networkErrors.push(entry);
		appendSceneJsonl(input.artifacts.networkLogPath!, entry);
		appendSceneJsonl(input.artifacts.errorsLogPath!, { kind: 'network', ...entry });
		input.timeline.push('network', entry, stepId);
	});
	input.session.page.on('response', (response) => {
		const stepId = input.currentStepId();
		const status = response.status();
		response.json?.().then((payload) => {
			for (const id of extractSceneOperationIds(payload)) {
				if (!input.linkedOperationIds.includes(id)) input.linkedOperationIds.push(id);
				input.timeline.push('operation.detected', { operationId: id, url: response.url() }, stepId);
			}
		}).catch(() => undefined);
		if (status < 400) return;
		const entry = { message: `HTTP ${status}`, timestamp: now().toISOString(), url: response.url(), method: response.request().method(), status, ...(stepId ? { stepId } : {}) };
		input.networkErrors.push(entry);
		appendSceneJsonl(input.artifacts.networkLogPath!, entry);
		appendSceneJsonl(input.artifacts.errorsLogPath!, { kind: 'network', ...entry });
		input.timeline.push('network', entry, stepId);
	});
}
