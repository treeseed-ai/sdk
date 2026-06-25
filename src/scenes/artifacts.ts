import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	TreeseedSceneArtifactPathPlan,
	TreeseedSceneManifest,
	TreeseedScenePlanReport,
	TreeseedSceneRunArtifacts,
	TreeseedSceneRunReport,
	TreeseedSceneTimelineEvent,
} from './types.ts';

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function ensureTreeseedSceneRunDirectories(paths: TreeseedSceneArtifactPathPlan) {
	mkdirSync(paths.runRoot, { recursive: true });
	mkdirSync(paths.playwrightRoot, { recursive: true });
	mkdirSync(join(paths.playwrightRoot, 'screenshots'), { recursive: true });
	mkdirSync(join(paths.playwrightRoot, 'screenshots', 'viewport'), { recursive: true });
	mkdirSync(join(paths.playwrightRoot, 'videos'), { recursive: true });
	mkdirSync(paths.logsRoot, { recursive: true });
	mkdirSync(paths.segmentsRoot, { recursive: true });
	mkdirSync(paths.checkpointsRoot, { recursive: true });
	mkdirSync(paths.renderRoot, { recursive: true });
	mkdirSync(paths.evidenceRoot, { recursive: true });
	mkdirSync(paths.publishRoot, { recursive: true });
}

export function createTreeseedSceneRunArtifacts(input: {
	paths: TreeseedSceneArtifactPathPlan;
	playwrightTracePath?: string | null;
	screenshotPaths?: string[];
	viewportScreenshotPaths?: string[];
	videoPaths?: string[];
}): TreeseedSceneRunArtifacts {
	return {
		runRoot: input.paths.runRoot,
		normalizedScenePath: input.paths.normalizedScenePath,
		planPath: input.paths.planPath,
		runPath: input.paths.runPath,
		timelinePath: input.paths.timelinePath,
		markdownReportPath: input.paths.markdownReportPath,
		playwrightTracePath: input.playwrightTracePath ?? null,
		screenshotPaths: input.screenshotPaths ?? [],
		viewportScreenshotPaths: input.viewportScreenshotPaths ?? [],
		videoPaths: input.videoPaths ?? [],
		consoleLogPath: join(input.paths.playwrightRoot, 'console.jsonl'),
		networkLogPath: join(input.paths.playwrightRoot, 'network.jsonl'),
		errorsLogPath: join(input.paths.playwrightRoot, 'errors.jsonl'),
		setupPath: join(input.paths.runRoot, 'setup.json'),
		devLogPath: join(input.paths.logsRoot, 'dev.jsonl'),
		apiLogPath: join(input.paths.logsRoot, 'api.jsonl'),
		operationsRunnerLogPath: join(input.paths.logsRoot, 'operations-runner.jsonl'),
		progressPath: input.paths.progressPath,
		checkpointsRoot: input.paths.checkpointsRoot,
	};
}

export function appendTreeseedSceneJsonl(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

export function writeTreeseedSceneRunArtifacts(input: {
	scene: TreeseedSceneManifest;
	plan: TreeseedScenePlanReport;
	report: TreeseedSceneRunReport;
	timeline: TreeseedSceneTimelineEvent[];
}) {
	const artifacts = input.report.artifacts;
	if (!artifacts) return;
	writeJson(artifacts.normalizedScenePath, input.scene);
	writeJson(artifacts.planPath, input.plan);
	if (artifacts.setupPath) writeJson(artifacts.setupPath, input.report.setup);
	writeJson(artifacts.timelinePath, input.timeline);
	writeJson(artifacts.runPath, input.report);
}
