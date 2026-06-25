import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import { resolveTreeseedSceneRunRoot } from './inspect.ts';
import { runTreeseedScene } from './runner.ts';
import type { TreeseedSceneCheckpoint, TreeseedSceneManifest, TreeseedSceneResumeOptions, TreeseedSceneRunReport } from './types.ts';

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function blocked(input: TreeseedSceneResumeOptions, diagnostics: ReturnType<typeof sceneErrorDiagnostic>[]): TreeseedSceneRunReport {
	const now = new Date().toISOString();
	return {
		ok: false,
		phase: 5,
		sceneId: null,
		runId: null,
		scenePath: input.run,
		startedAt: now,
		finishedAt: now,
		durationMs: 0,
		environment: input.environment ?? 'local',
		baseUrl: null,
		browser: null,
		workflowStatus: 'blocked',
		steps: [],
		failedStep: null,
		assertions: [],
		artifacts: null,
		timelinePath: null,
		playwrightTracePath: null,
		videoPaths: [],
		renderedVideoPaths: [],
		logs: {},
		setup: null,
		operations: [],
		chapters: [],
		segments: [],
		checkpoints: [],
		resumedFrom: null,
		progressPath: null,
		warnings: diagnostics.filter((entry) => entry.severity === 'warning'),
		blockers: diagnostics.filter((entry) => entry.severity === 'error'),
		diagnostics,
	};
}

export async function resumeTreeseedScene(input: TreeseedSceneResumeOptions): Promise<TreeseedSceneRunReport> {
	input.onProgress?.({ type: 'resume.started', sceneId: null, runId: null, timestamp: new Date().toISOString(), offsetMs: 0, checkpointId: input.fromCheckpoint, data: { run: input.run } });
	const resolved = resolveTreeseedSceneRunRoot(input.projectRoot, input.run);
	if (!resolved.runRoot) return blocked(input, resolved.diagnostics);
	const checkpointPath = join(resolved.runRoot, 'checkpoints', `${input.fromCheckpoint}.json`);
	if (!existsSync(checkpointPath)) return blocked(input, [sceneErrorDiagnostic('scene.checkpoint_not_found', `Checkpoint not found: ${input.fromCheckpoint}.`, 'checkpoint')]);
	const checkpoint = readJson<TreeseedSceneCheckpoint>(checkpointPath);
	if (!checkpoint.resumable) return blocked(input, [sceneErrorDiagnostic('scene.checkpoint_not_resumable', `Checkpoint is not resumable: ${input.fromCheckpoint}.`, 'checkpoint')]);
	const scenePath = join(resolved.runRoot, 'scene.normalized.json');
	if (!existsSync(scenePath)) return blocked(input, [sceneErrorDiagnostic('scene.normalized_scene_not_found', `Normalized scene not found: ${scenePath}.`, 'scene')]);
	const scene = readJson<TreeseedSceneManifest>(scenePath);
	const nextIndex = checkpoint.nextStepId ? scene.workflow.findIndex((step) => step.id === checkpoint.nextStepId) : scene.workflow.length;
	if (nextIndex < 0) return blocked(input, [sceneErrorDiagnostic('scene.resume_step_not_found', `Resume step not found: ${checkpoint.nextStepId}.`, 'checkpoint.nextStepId')]);
	const resumeScene = {
		...scene,
		workflow: scene.workflow.slice(nextIndex),
	};
	const report = await runTreeseedScene({
		...input,
		scene: resumeScene,
		onProgress: (event) => {
			input.onProgress?.(event);
		},
	});
	report.resumedFrom = {
		runRoot: resolved.runRoot,
		checkpointId: checkpoint.id,
		sourceRunId: checkpoint.runId,
	};
	input.onProgress?.({ type: 'resume.finished', sceneId: report.sceneId, runId: report.runId, timestamp: new Date().toISOString(), offsetMs: 0, checkpointId: checkpoint.id, status: report.workflowStatus, data: { ok: report.ok } });
	return report;
}
