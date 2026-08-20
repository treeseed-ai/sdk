import { join } from 'node:path';
import { renameSync,writeFileSync } from 'node:fs';
import { createSceneRunArtifacts,ensureSceneRunDirectories,writeSceneRunArtifacts } from '../support/evidence/artifacts.ts';
import { createSceneTimeline } from '../support/evidence/timeline.ts';
import { createSceneProgress } from '../support/reporting/progress.ts';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import { writeSceneMarkdownReport } from '../support/reporting/reporter.ts';
import type { AgentLabSnapshot,ScenePlanReport,SceneRunOptions,SceneRunReport,SceneValidationReport } from '../types.ts';
import { prepareSceneEnvironment } from '../configuration/environment.ts';
import { resolveSceneAuth } from '../accounts/auth.ts';
import { planOrApplySceneSeed } from '../seeds/seed.ts';
import { initialAgentLabSnapshot } from './report-model.ts';
import { resolveAgentLabPresentation } from './report-adapters.ts';
import { startAgentLabLiveReport } from './report-writer.ts';

function terminalReport(input: {
	validation: SceneValidationReport;
	plan: ScenePlanReport;
	startedAt: Date;
	snapshot: AgentLabSnapshot;
	diagnostics: SceneRunReport['diagnostics'];
	artifacts: NonNullable<SceneRunReport['artifacts']>;
	setup?: SceneRunReport['setup'];
}): SceneRunReport {
	const failed = input.snapshot.status === 'failed' || input.diagnostics.some((entry) => entry.severity === 'error');
	const finishedAt = new Date();
	return {
		ok: !failed, phase: 5, sceneId: input.snapshot.sceneId, runId: input.snapshot.runId,
		scenePath: input.validation.scenePath, startedAt: input.startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
		durationMs: Math.max(0, finishedAt.getTime() - input.startedAt.getTime()), environment: input.plan.environment,
		baseUrl: null, browser: null, device: null, capture: null, workflowStatus: failed ? 'failed' : 'passed',
		steps: [], failedStep: failed ? input.snapshot.workdays.find((entry) => entry.status === 'failed')?.id ?? null : null,
		assertions: [], artifacts: input.artifacts, timelinePath: input.artifacts.timelinePath, playwrightTracePath: null,
		videoPaths: [], renderedVideoPaths: [], logs: {}, setup: input.setup ?? null, operations: [], chapters: [], segments: [], checkpoints: [],
		resumedFrom: null, progressPath: input.artifacts.progressPath ?? null,
		warnings: input.diagnostics.filter((entry) => entry.severity === 'warning'), blockers: input.diagnostics.filter((entry) => entry.severity === 'error'), diagnostics: input.diagnostics,
	};
}

export async function runAgentLabScene(input: {
	options: SceneRunOptions;
	validation: SceneValidationReport;
	plan: ScenePlanReport;
}): Promise<SceneRunReport> {
	const scene = input.validation.scene!, config = scene.agentLab!, paths = input.plan.artifactPaths!, startedAt = new Date();
	ensureSceneRunDirectories(paths);
	const artifacts = createSceneRunArtifacts({ paths, playwrightTracePath: null });
	writeFileSync(artifacts.progressPath!, '', 'utf8');
	const timeline = createSceneTimeline({ sceneId: scene.id, runId: paths.runId, startedAtMs: startedAt.getTime() });
	const progress = createSceneProgress({ sceneId: scene.id, runId: paths.runId, startedAtMs: startedAt.getTime(), progressPath: artifacts.progressPath, onProgress: input.options.onProgress });
	const environmentReport = await (input.options.environmentAdapter ?? prepareSceneEnvironment)({ projectRoot: input.options.projectRoot, scene, environment: input.plan.environment, env: process.env });
	const authReport = (input.options.authResolver ?? resolveSceneAuth)({ projectRoot: input.options.projectRoot, scene, environment: input.plan.environment });
	const seedReport = await (input.options.seedRunner ?? planOrApplySceneSeed)({ projectRoot: input.options.projectRoot, scene, environment: input.plan.environment, auth: authReport, env: process.env });
	const setup = { environment: environmentReport, auth: authReport, seed: seedReport };
	const setupDiagnostics = [...environmentReport.diagnostics, ...authReport.diagnostics, ...seedReport.diagnostics];
	let snapshot = initialAgentLabSnapshot({ sceneId: scene.id, runId: paths.runId, presentation: config.presentation, timeZone: config.timeZone, repositories: config.repositories, workdays: config.workdays });
	const snapshotPath = join(paths.runRoot, 'agent-lab-snapshot.json');
	const writeSnapshot = () => {
		const temporary = `${snapshotPath}.${process.pid}.${Date.now()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
		renameSync(temporary, snapshotPath);
	};
	writeSnapshot();
	const adapter = resolveAgentLabPresentation(config.presentation, input.options.agentLabPresentations);
	const diagnostics: SceneRunReport['diagnostics'] = [...setupDiagnostics];
	if (!adapter) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_presentation_unavailable', `Agent Lab presentation ${config.presentation} is unavailable.`, 'agentLab.presentation'));
	if (!input.options.agentLabExecutor) diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_executor_unavailable', 'Agent Lab requires the CLI production capacity executor.', 'agentLab'));
	if (!adapter || !input.options.agentLabExecutor || setupDiagnostics.some((entry) => entry.severity === 'error')) {
		const report = terminalReport({ validation: input.validation, plan: input.plan, startedAt, snapshot: { ...snapshot, status: 'failed' }, diagnostics, artifacts, setup });
		writeSceneMarkdownReport(report); writeSceneRunArtifacts({ scene, plan: input.plan, report, timeline: timeline.events });
		return report;
	}
	const live = await startAgentLabLiveReport({ path: paths.htmlReportPath, adapter, initial: snapshot });
	await input.options.onAgentLabReportReady?.({ url: live.url, path: paths.htmlReportPath });
	progress.push('scene.run.started', { title: scene.title, environment: input.plan.environment, reportUrl: live.url });
	timeline.push('scene.start', { title: scene.title, environment: input.plan.environment, journey: 'agent-lab', reportUrl: live.url });
	try {
		snapshot = await input.options.agentLabExecutor({
			projectRoot: input.options.projectRoot, contentRef: input.options.agentLabContentRef, authorityScope: input.options.agentLabAuthorityScope,
			config, sceneId: scene.id, runId: paths.runId, reportPath: paths.htmlReportPath,
			onUpdate: async (update) => {
				snapshot = update.snapshot;
				writeSnapshot();
				await live.publish(snapshot);
				timeline.push('heartbeat', { status: snapshot.status, workdays: snapshot.workdays.map((entry) => ({ id: entry.id, status: entry.status, executions: entry.executions.length })) });
				progress.push('scene.run.heartbeat', { status: snapshot.status, reportUrl: live.url });
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		diagnostics.push(sceneErrorDiagnostic('scene.agent_lab_execution_failed', message, 'agentLab'));
		snapshot = { ...snapshot, status: 'failed', generatedAt: new Date().toISOString(), diagnostics: [...snapshot.diagnostics, message] };
		writeSnapshot();
		await live.publish(snapshot);
	} finally {
		await live.close();
	}
	timeline.push('scene.end', { status: snapshot.status, reportPath: paths.htmlReportPath });
	progress.push('scene.run.finished', { ok: snapshot.status === 'completed', reportPath: paths.htmlReportPath }, { status: snapshot.status });
	const report = terminalReport({ validation: input.validation, plan: input.plan, startedAt, snapshot, diagnostics, artifacts, setup });
	writeSceneMarkdownReport(report);
	writeSceneRunArtifacts({ scene, plan: input.plan, report, timeline: timeline.events });
	return report;
}
