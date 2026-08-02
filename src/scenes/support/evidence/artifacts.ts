import { execFileSync } from 'node:child_process';
import { mkdirSync,mkdtempSync,readdirSync,readFileSync,renameSync,rmSync,statSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname,join,resolve } from 'node:path';
import type {
SceneArtifactPathPlan,
SceneManifest,
ScenePlanReport,
SceneRunArtifacts,
SceneRunReport,
SceneTimelineEvent,
} from '../../types.ts';

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const REDACTED_SCENE_VALUE = '[REDACTED]';

function isSensitiveFieldName(value: string) {
	const normalized = value.replace(/[^a-z0-9]/giu, '').toLowerCase();
	return ['apikey', 'apitoken', 'clientsecret', 'credential', 'passphrase', 'password', 'privatekey', 'secret', 'token']
		.some((field) => normalized.includes(field));
}

export function fillTargetsSensitiveField(fill: Record<string, unknown>) {
	return ['css', 'label', 'name', 'placeholder', 'testId']
		.some((key) => isSensitiveFieldName(String(fill[key] ?? '')));
}

function redactSceneValue(value: unknown, parentKey = ''): unknown {
	if (Array.isArray(value)) return value.map((entry) => redactSceneValue(entry));
	if (!value || typeof value !== 'object') {
		return isSensitiveFieldName(parentKey) ? REDACTED_SCENE_VALUE : value;
	}
	const input = value as Record<string, unknown>;
	const output: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(input)) {
		if (key === 'fill' && entry && typeof entry === 'object' && !Array.isArray(entry)) {
			const fill = entry as Record<string, unknown>;
			output[key] = {
				...fill,
				value: fillTargetsSensitiveField(fill) ? REDACTED_SCENE_VALUE : redactSceneValue(fill.value, key),
			};
			continue;
		}
		output[key] = redactSceneValue(entry, key);
	}
	return output;
}

export function redactSceneArtifact(scene: SceneManifest): SceneManifest {
	return redactSceneValue(scene) as SceneManifest;
}

export function redactPlaywrightTraceArchive(path: string, sensitiveValues: string[]) {
	const values = [...new Set(sensitiveValues.filter(Boolean))];
	if (values.length === 0) return;
	const extractionRoot = mkdtempSync(join(tmpdir(), 'treeseed-trace-redaction-'));
	const outputPath = resolve(dirname(path), `.trace-redacted-${process.pid}-${Date.now()}.zip`);
	let replacements = 0;
	try {
		execFileSync('unzip', ['-q', path, '-d', extractionRoot], { stdio: 'ignore' });
		const pending = [extractionRoot];
		while (pending.length > 0) {
			const entryPath = pending.pop()!;
			if (statSync(entryPath).isDirectory()) {
				pending.push(...readdirSync(entryPath).map((name) => join(entryPath, name)));
				continue;
			}
			let content = readFileSync(entryPath);
			for (const value of values) {
				const secret = Buffer.from(value);
				let index = content.indexOf(secret);
				while (index >= 0) {
					content = Buffer.concat([
						content.subarray(0, index),
						Buffer.from(REDACTED_SCENE_VALUE),
						content.subarray(index + secret.length),
					]);
					replacements += 1;
					index = content.indexOf(secret, index + REDACTED_SCENE_VALUE.length);
				}
			}
			writeFileSync(entryPath, content);
		}
		if (replacements === 0) {
			throw new Error('Playwright trace redaction found no recorded sensitive values; refusing to retain an unverified trace.');
		}
		execFileSync('zip', ['-q', '-r', outputPath, '.'], { cwd: extractionRoot, stdio: 'ignore' });
		renameSync(outputPath, path);
	} finally {
		rmSync(extractionRoot, { recursive: true, force: true });
		rmSync(outputPath, { force: true });
	}
}

export function ensureSceneRunDirectories(paths: SceneArtifactPathPlan) {
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

export function createSceneRunArtifacts(input: {
	paths: SceneArtifactPathPlan;
	playwrightTracePath?: string | null;
	screenshotPaths?: string[];
	viewportScreenshotPaths?: string[];
	videoPaths?: string[];
}): SceneRunArtifacts {
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

export function appendSceneJsonl(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value)}\n`, { encoding: 'utf8', flag: 'a' });
}

export function writeSceneRunArtifacts(input: {
	scene: SceneManifest;
	plan: ScenePlanReport;
	report: SceneRunReport;
	timeline: SceneTimelineEvent[];
}) {
	const artifacts = input.report.artifacts;
	if (!artifacts) return;
	writeJson(artifacts.normalizedScenePath, redactSceneArtifact(input.scene));
	writeJson(artifacts.planPath, input.plan);
	if (artifacts.setupPath) writeJson(artifacts.setupPath, input.report.setup);
	writeJson(artifacts.timelinePath, input.timeline);
	writeJson(artifacts.runPath, input.report);
}
