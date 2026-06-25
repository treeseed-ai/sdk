import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import { writeTreeseedSceneEvidenceBundle } from './evidence-bundle.ts';
import { appendTreeseedSceneEvidencePaths, writeTreeseedSceneEvidenceReport } from './evidence-report.ts';
import { resolveTreeseedSceneRunRoot } from './inspect.ts';
import { validateTreeseedScene } from './planner.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneEvidenceArtifact,
	TreeseedSceneEvidenceArtifactKind,
	TreeseedSceneEvidenceBundlePolicy,
	TreeseedSceneEvidenceManifest,
	TreeseedSceneEvidenceOptions,
	TreeseedSceneEvidencePaths,
	TreeseedSceneEvidenceRecommendation,
	TreeseedSceneEvidenceReport,
	TreeseedSceneEvidenceTarget,
	TreeseedSceneManifest,
	TreeseedSceneRunReport,
	TreeseedSceneTimelineEvent,
} from './types.ts';

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function nowIso() {
	return new Date().toISOString();
}

function sha256(path: string) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function fileSize(path: string) {
	return statSync(path).size;
}

function artifactId(kind: TreeseedSceneEvidenceArtifactKind, relativePath: string) {
	return `${kind}:${relativePath.replace(/[^a-zA-Z0-9._/-]/gu, '-')}`;
}

function createArtifact(input: {
	runRoot: string;
	kind: TreeseedSceneEvidenceArtifactKind;
	path: string | null | undefined;
	includedInBundle: boolean;
	redactionStatus?: TreeseedSceneEvidenceArtifact['redactionStatus'];
}): TreeseedSceneEvidenceArtifact | null {
	if (!input.path) return null;
	const relativePath = relative(input.runRoot, input.path) || input.path;
	const exists = existsSync(input.path);
	if (exists && !statSync(input.path).isFile()) return null;
	return {
		id: artifactId(input.kind, relativePath),
		kind: input.kind,
		path: input.path,
		relativePath,
		sha256: exists ? sha256(input.path) : null,
		bytes: exists ? fileSize(input.path) : null,
		includedInBundle: input.includedInBundle && exists,
		redactionStatus: exists ? input.redactionStatus ?? (input.includedInBundle ? 'sanitized' : 'not-required') : 'unknown',
	};
}

function pushArtifact(artifacts: TreeseedSceneEvidenceArtifact[], artifact: TreeseedSceneEvidenceArtifact | null) {
	if (!artifact) return;
	if (artifacts.some((entry) => entry.kind === artifact.kind && entry.path === artifact.path)) return;
	artifacts.push(artifact);
}

function listFiles(root: string): string[] {
	if (!existsSync(root)) return [];
	const entries = readdirSync(root, { withFileTypes: true });
	return entries.flatMap((entry) => {
		const path = join(root, entry.name);
		if (entry.isDirectory()) return listFiles(path);
		return [path];
	});
}

function discoverTrainingOutputs(runRoot: string) {
	const trainingRoot = join(runRoot, 'training');
	return [
		'captions.vtt',
		'captions.srt',
		'transcript.json',
		'transcript.md',
		'narration.json',
		'narration.md',
		'glossary.json',
		'glossary.md',
		'chapter-clips.json',
		'report.json',
	].map((name) => join(trainingRoot, name)).filter((path) => existsSync(path));
}

function discoverRenderReports(runRoot: string) {
	const renderRoot = join(runRoot, 'render');
	if (!existsSync(renderRoot)) return [];
	return readdirSync(renderRoot, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => join(renderRoot, entry.name, 'report.json'))
		.filter((path) => existsSync(path));
}

function discoverEvidenceArtifacts(input: {
	runRoot: string;
	run: TreeseedSceneRunReport;
}): TreeseedSceneEvidenceArtifact[] {
	const artifacts: TreeseedSceneEvidenceArtifact[] = [];
	const runRoot = input.runRoot;
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'run-report', path: join(runRoot, 'run.json'), includedInBundle: true }));
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'markdown-report', path: join(runRoot, 'report.md'), includedInBundle: true }));
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'timeline', path: join(runRoot, 'timeline.json'), includedInBundle: true }));
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'setup', path: join(runRoot, 'setup.json'), includedInBundle: true }));
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'progress', path: join(runRoot, 'progress.jsonl'), includedInBundle: true }));
	for (const path of listFiles(join(runRoot, 'checkpoints'))) pushArtifact(artifacts, createArtifact({ runRoot, kind: 'checkpoint', path, includedInBundle: true }));
	for (const path of listFiles(join(runRoot, 'segments')).filter((entry) => entry.endsWith('.json'))) pushArtifact(artifacts, createArtifact({ runRoot, kind: 'segment', path, includedInBundle: true }));
	for (const path of discoverTrainingOutputs(runRoot)) pushArtifact(artifacts, createArtifact({ runRoot, kind: 'training-output', path, includedInBundle: true }));
	for (const path of discoverRenderReports(runRoot)) pushArtifact(artifacts, createArtifact({ runRoot, kind: 'render-report', path, includedInBundle: true }));
	const failedStep = input.run.failedStep ? input.run.steps.find((step) => step.id === input.run.failedStep) : null;
	if (failedStep?.screenshotPath) pushArtifact(artifacts, createArtifact({ runRoot, kind: 'screenshot', path: failedStep.screenshotPath, includedInBundle: true }));
	for (const path of input.run.artifacts?.screenshotPaths ?? []) {
		if (path === failedStep?.screenshotPath) continue;
		pushArtifact(artifacts, createArtifact({ runRoot, kind: 'screenshot', path, includedInBundle: false, redactionStatus: 'not-required' }));
	}
	const tracePath = input.run.playwrightTracePath ?? input.run.artifacts?.playwrightTracePath;
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'log-summary', path: tracePath, includedInBundle: false, redactionStatus: 'excluded-sensitive' }));
	for (const path of [...input.run.videoPaths, ...(input.run.artifacts?.videoPaths ?? [])]) {
		pushArtifact(artifacts, createArtifact({ runRoot, kind: 'render-video', path, includedInBundle: false, redactionStatus: 'excluded-sensitive' }));
	}
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'log-summary', path: input.run.artifacts?.consoleLogPath, includedInBundle: false, redactionStatus: 'excluded-sensitive' }));
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'log-summary', path: input.run.artifacts?.networkLogPath, includedInBundle: false, redactionStatus: 'excluded-sensitive' }));
	pushArtifact(artifacts, createArtifact({ runRoot, kind: 'log-summary', path: input.run.artifacts?.errorsLogPath, includedInBundle: false, redactionStatus: 'excluded-sensitive' }));
	for (const path of Object.values(input.run.logs ?? {}).filter((value): value is string => typeof value === 'string' && value.length > 0)) {
		if (path.includes('/training') || path.includes('\\training')) continue;
		pushArtifact(artifacts, createArtifact({ runRoot, kind: 'log-summary', path, includedInBundle: false, redactionStatus: 'excluded-sensitive' }));
	}
	return artifacts.sort((left, right) => left.kind.localeCompare(right.kind) || left.relativePath.localeCompare(right.relativePath));
}

function buildRecommendations(input: {
	runRoot: string;
	sceneId: string | null;
	run: TreeseedSceneRunReport;
	target: TreeseedSceneEvidenceTarget;
	artifacts: TreeseedSceneEvidenceArtifact[];
}): TreeseedSceneEvidenceRecommendation[] {
	const scene = input.sceneId ?? '(scene)';
	const run = input.run.runId ?? input.runRoot;
	const recommendations: TreeseedSceneEvidenceRecommendation[] = [];
	if (!input.run.ok || input.run.workflowStatus === 'failed') {
		recommendations.push({
			id: 'inspect-failed-run',
			severity: 'warning',
			command: `trsd scene inspect ${run} --step ${input.run.failedStep ?? ''} --json`.replace(' --step  ', ' '),
			reason: 'Inspect the failed scene run before promoting evidence.',
		});
	}
	const resumable = input.run.checkpoints.find((checkpoint) => checkpoint.resumable);
	if (resumable && (!input.run.ok || input.run.workflowStatus === 'failed')) {
		recommendations.push({
			id: 'resume-from-checkpoint',
			severity: 'info',
			command: `trsd scene resume ${run} --from-checkpoint ${resumable.id} --json`,
			reason: `Resume from checkpoint ${resumable.id} after repair.`,
		});
	}
	if (!input.run.trainingOutputPaths && !input.artifacts.some((artifact) => artifact.kind === 'training-output')) {
		recommendations.push({
			id: 'generate-training',
			severity: 'info',
			command: `trsd scene training ${scene} --from ${run} --json`,
			reason: 'Generate deterministic captions, transcripts, narration scripts, glossary, and chapter clip manifests.',
		});
	}
	if ((input.run.renderedVideoPaths ?? []).length === 0) {
		recommendations.push({
			id: 'render-video',
			severity: 'info',
			command: `trsd scene render ${scene} --from ${run} --mode ${input.run.workflowStatus === 'failed' ? 'failure-review' : 'demo'} --json`,
			reason: 'Render a downstream evidence video from the existing run artifacts.',
		});
	}
	if (input.target === 'release' && input.run.workflowStatus !== 'passed') {
		recommendations.push({
			id: 'release-blocked',
			severity: 'blocking',
			command: `trsd scene inspect ${run} --json`,
			reason: 'Release evidence is blocked until the scene workflow passes or a release owner accepts the failed evidence.',
		});
	}
	return recommendations;
}

export function buildTreeseedSceneEvidenceManifest(input: {
	scene: TreeseedSceneManifest;
	run: TreeseedSceneRunReport;
	timeline: TreeseedSceneTimelineEvent[];
	runRoot: string;
	target?: TreeseedSceneEvidenceTarget;
	bundlePolicy?: TreeseedSceneEvidenceBundlePolicy;
	bundle?: TreeseedSceneEvidenceBundlePolicy;
	timestamp?: string;
}): TreeseedSceneEvidenceManifest {
	void input.timeline;
	const target = input.target ?? 'local';
	const bundlePolicy = input.bundlePolicy ?? input.bundle ?? 'sanitized';
	const artifacts = discoverEvidenceArtifacts({ runRoot: input.runRoot, run: input.run });
	const trainingOutputCount = artifacts.filter((artifact) => artifact.kind === 'training-output').length;
	return {
		schemaVersion: 'treeseed.scene.evidence/v1',
		phase: 9,
		generatedAt: input.timestamp ?? nowIso(),
		target,
		bundlePolicy,
		runRoot: input.runRoot,
		summary: {
			sceneId: input.scene.id,
			runId: input.run.runId,
			workflowStatus: input.run.workflowStatus,
			ok: input.run.ok,
			environment: input.run.environment ?? null,
			startedAt: input.run.startedAt,
			finishedAt: input.run.finishedAt,
			durationMs: input.run.durationMs,
			failedStep: input.run.failedStep,
			stepCounts: {
				passed: input.run.steps.filter((step) => step.status === 'passed').length,
				failed: input.run.steps.filter((step) => step.status === 'failed').length,
				skipped: input.run.steps.filter((step) => step.status === 'skipped').length,
			},
			chapters: input.run.chapters.length,
			segments: input.run.segments.length,
			checkpoints: input.run.checkpoints.length,
			renderedVideos: input.run.renderedVideoPaths.length,
			trainingOutputs: trainingOutputCount > 0,
		},
		artifacts,
		recommendations: buildRecommendations({ runRoot: input.runRoot, sceneId: input.scene.id, run: input.run, target, artifacts }),
		diagnostics: input.run.diagnostics ?? [],
	};
}

export function writeTreeseedSceneEvidence(input: {
	runRoot: string;
	manifest: TreeseedSceneEvidenceManifest;
}): TreeseedSceneEvidencePaths {
	const evidenceRoot = join(input.runRoot, 'evidence');
	const paths: TreeseedSceneEvidencePaths = {
		evidenceRoot,
		manifestPath: join(evidenceRoot, 'manifest.json'),
		reportPath: join(evidenceRoot, 'report.md'),
		bundleRoot: input.manifest.bundlePolicy === 'sanitized' ? join(evidenceRoot, 'bundle') : null,
		bundleManifestPath: input.manifest.bundlePolicy === 'sanitized' ? join(evidenceRoot, 'bundle', 'bundle-manifest.json') : null,
	};
	writeTreeseedSceneEvidenceReport({ manifest: input.manifest, paths });
	if (input.manifest.bundlePolicy === 'sanitized') writeTreeseedSceneEvidenceBundle({ manifest: input.manifest, paths });
	return paths;
}

function failedReport(input: {
	scenePath: string;
	runRoot: string | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings?: TreeseedSceneDiagnostic[];
	blockers?: TreeseedSceneDiagnostic[];
}): TreeseedSceneEvidenceReport {
	const blockers = input.blockers ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
	return {
		ok: false,
		phase: 9,
		sceneId: null,
		sourceRunId: null,
		scenePath: input.scenePath,
		runRoot: input.runRoot,
		evidenceRoot: input.runRoot ? join(input.runRoot, 'evidence') : null,
		manifest: null,
		paths: null,
		diagnostics: input.diagnostics,
		warnings: input.warnings ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
		blockers,
	};
}

export function generateTreeseedSceneEvidence(input: TreeseedSceneEvidenceOptions): TreeseedSceneEvidenceReport {
	const resolved = resolveTreeseedSceneRunRoot(input.projectRoot, input.from);
	if (!resolved.runRoot) return failedReport({ scenePath: input.scene, runRoot: null, diagnostics: resolved.diagnostics });
	const scenePath = join(resolved.runRoot, 'scene.normalized.json');
	const runPath = join(resolved.runRoot, 'run.json');
	const timelinePath = join(resolved.runRoot, 'timeline.json');
	const blockers: TreeseedSceneDiagnostic[] = [];
	if (!existsSync(scenePath)) blockers.push(sceneErrorDiagnostic('scene.evidence_missing_scene', `Normalized scene artifact not found: ${scenePath}.`, 'scene'));
	if (!existsSync(runPath)) blockers.push(sceneErrorDiagnostic('scene.evidence_missing_run', `Run report artifact not found: ${runPath}.`, 'from'));
	if (!existsSync(timelinePath)) blockers.push(sceneErrorDiagnostic('scene.evidence_missing_timeline', `Timeline artifact not found: ${timelinePath}.`, 'from'));
	if (blockers.length > 0) return failedReport({ scenePath: input.scene, runRoot: resolved.runRoot, diagnostics: [...resolved.diagnostics, ...blockers], blockers });

	const sourceScene = readJson<TreeseedSceneManifest>(scenePath);
	const run = readJson<TreeseedSceneRunReport>(runPath);
	const timeline = readJson<TreeseedSceneTimelineEvent[]>(timelinePath);
	const validation = validateTreeseedScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.ok) return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: validation.diagnostics });
	if (validation.scene?.id !== sourceScene.id) {
		const diagnostic = sceneErrorDiagnostic('scene.evidence_scene_mismatch', `Scene manifest "${validation.scene?.id ?? '(unknown)'}" does not match source run scene "${sourceScene.id}".`, 'scene');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], blockers: [diagnostic] });
	}
	try {
		const manifest = buildTreeseedSceneEvidenceManifest({
			scene: sourceScene,
			run,
			timeline,
			runRoot: resolved.runRoot,
			target: input.target,
			bundlePolicy: input.bundlePolicy ?? input.bundle,
			timestamp: input.timestamp,
		});
		const paths = writeTreeseedSceneEvidence({ runRoot: resolved.runRoot, manifest });
		const updateWarnings = appendTreeseedSceneEvidencePaths({ runPath, paths });
		return {
			ok: true,
			phase: 9,
			sceneId: sourceScene.id,
			sourceRunId: run.runId,
			scenePath: validation.scenePath,
			runRoot: resolved.runRoot,
			evidenceRoot: paths.evidenceRoot,
			manifest,
			paths,
			diagnostics: updateWarnings,
			warnings: updateWarnings,
			blockers: [],
		};
	} catch (error) {
		const diagnostic = sceneErrorDiagnostic('scene.evidence_write_failed', `Evidence artifacts could not be written. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'evidence');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], blockers: [diagnostic] });
	}
}
