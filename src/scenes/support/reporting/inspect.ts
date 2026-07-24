import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import type {
	SceneCheckpoint,
	SceneInspectOptions,
	SceneInspectReport,
	SceneRunReport,
	SceneTimelineEvent,
} from '../../types.ts';

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

export function resolveSceneRunRoot(projectRoot: string, run: string) {
	const candidate = resolve(projectRoot, run);
	if (existsSync(join(candidate, 'run.json'))) return { runRoot: candidate, diagnostics: [] };
	const runsRoot = join(projectRoot, '.treeseed', 'scenes', 'runs');
	const matches: string[] = [];
	if (existsSync(runsRoot)) {
		for (const sceneId of readdirSync(runsRoot)) {
			const sceneRoot = join(runsRoot, sceneId);
			for (const runDir of readdirSync(sceneRoot)) {
				const runRoot = join(sceneRoot, runDir);
				if (basename(runRoot).endsWith(`-${run}`)) matches.push(runRoot);
				else if (existsSync(join(runRoot, 'run.json'))) {
					try {
						const report = readJson<SceneRunReport>(join(runRoot, 'run.json'));
						if (report.runId === run) matches.push(runRoot);
					} catch {
						// Ignore malformed historical runs during lookup.
					}
				}
			}
		}
	}
	if (matches.length === 1) return { runRoot: matches[0], diagnostics: [] };
	if (matches.length > 1) return { runRoot: null, diagnostics: [sceneErrorDiagnostic('scene.run_ambiguous', `Multiple scene runs match "${run}".`, 'run')] };
	return { runRoot: null, diagnostics: [sceneErrorDiagnostic('scene.run_not_found', `Scene run not found: ${run}.`, 'run')] };
}

export function inspectSceneRun(input: SceneInspectOptions): SceneInspectReport {
	const resolved = resolveSceneRunRoot(input.projectRoot, input.run);
	if (!resolved.runRoot) {
		return { ok: false, runRoot: null, run: null, timeline: [], chapters: [], segments: [], checkpoints: [], selectedStep: null, diagnostics: resolved.diagnostics };
	}
	const diagnostics = [...resolved.diagnostics];
	const runPath = join(resolved.runRoot, 'run.json');
	if (!existsSync(runPath)) {
		diagnostics.push(sceneErrorDiagnostic('scene.run_not_found', `Run report not found: ${runPath}.`, 'run'));
		return { ok: false, runRoot: resolved.runRoot, run: null, timeline: [], chapters: [], segments: [], checkpoints: [], selectedStep: null, diagnostics };
	}
	const run = readJson<SceneRunReport>(runPath);
	const timeline = existsSync(run.timelinePath ?? '') ? readJson<SceneTimelineEvent[]>(run.timelinePath!) : [];
	const checkpointsRoot = run.artifacts?.checkpointsRoot;
	const checkpoints: SceneCheckpoint[] = checkpointsRoot && existsSync(checkpointsRoot)
		? readdirSync(checkpointsRoot).filter((entry) => entry.endsWith('.json')).map((entry) => readJson<SceneCheckpoint>(join(checkpointsRoot, entry)))
		: run.checkpoints ?? [];
	const selectedStep = input.stepId ? run.steps.find((step) => step.id === input.stepId) ?? null : null;
	if (input.stepId && !selectedStep) diagnostics.push(sceneErrorDiagnostic('scene.step_not_found', `Step not found: ${input.stepId}.`, 'step'));
	return {
		ok: diagnostics.every((entry) => entry.severity !== 'error'),
		runRoot: resolved.runRoot,
		run,
		timeline,
		chapters: run.chapters ?? [],
		segments: run.segments ?? [],
		checkpoints,
		selectedStep,
		diagnostics,
	};
}
