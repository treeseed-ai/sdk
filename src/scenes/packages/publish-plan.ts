import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from '../support/reporting/diagnostics.ts';
import {
	DEFAULT_SCENE_PUBLICATION_TARGETS,
	createScenePublishDestinations,
	destinationIdsForScenePublishedArtifact,
	isSceneExternalPublishTarget,
} from './publish-destinations.ts';
import { resolveSceneRunRoot } from '../support/reporting/inspect.ts';
import { validateScene } from '../support/execution/planner.ts';
import { publishSceneEvidence } from './publish.ts';
import { appendScenePublishPlanPaths, writeScenePublishPlanReport } from './publish-plan-report.ts';
import type {
	SceneDiagnostic,
	SceneExternalPublishTarget,
	SceneManifest,
	ScenePublishManifest,
	ScenePublishPlanArtifact,
	ScenePublishPlanManifest,
	ScenePublishPlanMode,
	ScenePublishPlanOptions,
	ScenePublishPlanPaths,
	ScenePublishPlanReport,
	SceneRunReport,
} from '../types.ts';

function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function nowIso() {
	return new Date().toISOString();
}

function safeExportPath(exportRoot: string, relativePath: string) {
	return join(exportRoot, relativePath.replace(/^(\.\.[/\\])+/u, '').replace(/^[/\\]+/u, ''));
}

function failedReport(input: {
	scenePath: string;
	runRoot: string | null;
	publishRoot?: string | null;
	publishPlanRoot?: string | null;
	diagnostics: SceneDiagnostic[];
	warnings?: SceneDiagnostic[];
	blockers?: SceneDiagnostic[];
	sceneId?: string | null;
	sourceRunId?: string | null;
	manifest?: ScenePublishPlanManifest | null;
	paths?: ScenePublishPlanPaths | null;
}): ScenePublishPlanReport {
	const blockers = input.blockers ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
	return {
		ok: false,
		phase: 11,
		sceneId: input.sceneId ?? null,
		sourceRunId: input.sourceRunId ?? null,
		scenePath: input.scenePath,
		runRoot: input.runRoot,
		publishRoot: input.publishRoot ?? (input.runRoot ? join(input.runRoot, 'publish') : null),
		publishPlanRoot: input.publishPlanRoot ?? (input.runRoot ? join(input.runRoot, 'publish-plan') : null),
		manifest: input.manifest ?? null,
		paths: input.paths ?? null,
		diagnostics: input.diagnostics,
		warnings: input.warnings ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
		blockers,
	};
}

function validateTargets(targets: SceneExternalPublishTarget[]): SceneDiagnostic[] {
	return targets
		.filter((target) => !isSceneExternalPublishTarget(target))
		.map((target) => sceneErrorDiagnostic('scene.publish_plan_target_unsupported', `Unsupported scene publication target "${String(target)}".`, 'target'));
}

export function buildScenePublishPlanManifest(input: {
	publish: ScenePublishManifest;
	publishManifestPath: string;
	runRoot: string;
	targets: SceneExternalPublishTarget[];
	mode: ScenePublishPlanMode;
	timestamp?: string;
}): ScenePublishPlanManifest {
	const diagnostics = [...input.publish.diagnostics, ...validateTargets(input.targets)];
	if (input.targets.includes('release-evidence') && input.publish.workflowStatus !== 'passed') {
		diagnostics.push(sceneErrorDiagnostic('scene.publish_plan_release_blocked', 'Release-evidence publication planning is blocked until the scene workflow passes.', 'target'));
	}
	const validTargets = input.targets.filter(isSceneExternalPublishTarget);
	const destinations = createScenePublishDestinations({ runRoot: input.runRoot, targets: validTargets });
	const artifacts: ScenePublishPlanArtifact[] = input.publish.artifacts.map((artifact) => ({
		id: artifact.id,
		kind: artifact.kind,
		sourcePath: artifact.publishedPath ?? artifact.sourcePath,
		relativePath: artifact.relativePath,
		destinationIds: destinationIdsForScenePublishedArtifact({ artifact, targets: validTargets }),
		sha256: artifact.sha256,
		bytes: artifact.bytes,
		redactionDecision: artifact.decision,
	})).filter((artifact) => artifact.destinationIds.length > 0);
	if (artifacts.length === 0) {
		diagnostics.push(sceneErrorDiagnostic('scene.publish_plan_no_artifacts', 'No redacted published artifacts matched the selected publication targets.', 'publish-plan'));
	}
	return {
		schemaVersion: 'treeseed.scene.publish-plan/v1',
		phase: 11,
		generatedAt: input.timestamp ?? nowIso(),
		sourcePublishManifestPath: input.publishManifestPath,
		sourceRunRoot: input.runRoot,
		sceneId: input.publish.sceneId,
		sourceRunId: input.publish.sourceRunId,
		workflowStatus: input.publish.workflowStatus,
		mode: input.mode,
		targets: validTargets,
		destinations,
		artifacts,
		reconciliationIntents: destinations.map((destination) => ({
			id: `scene-publication-${destination.target}`,
			target: destination.target,
			action: 'plan-only',
			reason: 'Phase 11 records publication intent for a future canonical reconciliation apply; it does not mutate external stores.',
			desiredState: destination.reconciliationResource.desiredState,
		})),
		diagnostics,
	};
}

export function writeScenePublishPlan(input: {
	runRoot: string;
	manifest: ScenePublishPlanManifest;
}): ScenePublishPlanPaths {
	const publishPlanRoot = join(input.runRoot, 'publish-plan');
	const exportRoot = input.manifest.mode === 'local-export' ? join(publishPlanRoot, 'export') : null;
	const paths: ScenePublishPlanPaths = {
		publishPlanRoot,
		manifestPath: join(publishPlanRoot, 'manifest.json'),
		reportPath: join(publishPlanRoot, 'report.md'),
		exportRoot,
		exportManifestPath: exportRoot ? join(exportRoot, 'export-manifest.json') : null,
	};
	if (exportRoot) {
		const copied: Array<{
			artifactId: string;
			destinationId: string;
			sourcePath: string;
			exportedPath: string | null;
			relativePath: string;
		}> = [];
		for (const destination of input.manifest.destinations) {
			mkdirSync(destination.root, { recursive: true });
			for (const artifact of input.manifest.artifacts.filter((entry) => entry.destinationIds.includes(destination.id))) {
				if (destination.target === 'artifact-store') {
					copied.push({
						artifactId: artifact.id,
						destinationId: destination.id,
						sourcePath: artifact.sourcePath,
						exportedPath: null,
						relativePath: artifact.relativePath,
					});
					continue;
				}
				if (!existsSync(artifact.sourcePath)) continue;
				const targetPath = safeExportPath(destination.root, artifact.relativePath);
				mkdirSync(dirname(targetPath), { recursive: true });
				copyFileSync(artifact.sourcePath, targetPath);
				copied.push({
					artifactId: artifact.id,
					destinationId: destination.id,
					sourcePath: artifact.sourcePath,
					exportedPath: targetPath,
					relativePath: artifact.relativePath,
				});
			}
		}
		writeJson(paths.exportManifestPath!, {
			schemaVersion: 'treeseed.scene.publication-export/v1',
			phase: 11,
			generatedAt: input.manifest.generatedAt,
			sceneId: input.manifest.sceneId,
			sourceRunId: input.manifest.sourceRunId,
			targets: input.manifest.targets,
			destinations: input.manifest.destinations,
			artifacts: copied,
		});
	}
	writeScenePublishPlanReport({ manifest: input.manifest, paths });
	return paths;
}

async function loadOrGenerateLocalPublish(input: {
	projectRoot: string;
	scene: string;
	from: string;
	runRoot: string;
	timestamp?: string;
}): Promise<{
	publish: ScenePublishManifest | null;
	publishManifestPath: string;
	diagnostics: SceneDiagnostic[];
	warnings: SceneDiagnostic[];
}> {
	const publishManifestPath = join(input.runRoot, 'publish', 'local', 'manifest.json');
	if (existsSync(publishManifestPath)) {
		return { publish: readJson<ScenePublishManifest>(publishManifestPath), publishManifestPath, diagnostics: [], warnings: [] };
	}
	const report = await publishSceneEvidence({
		projectRoot: input.projectRoot,
		scene: input.scene,
		from: input.from,
		target: 'local',
		timestamp: input.timestamp,
	});
	if (!report.ok || !report.manifest || !report.paths) {
		return { publish: null, publishManifestPath, diagnostics: report.diagnostics, warnings: report.warnings };
	}
	const warning = sceneWarningDiagnostic('scene.publish_plan_missing_publish', 'Local Phase 10 publish manifest was missing, so Phase 11 generated a local redacted publish bundle first.', 'publish/local/manifest.json');
	return {
		publish: report.manifest,
		publishManifestPath: report.paths.manifestPath,
		diagnostics: [warning, ...report.diagnostics],
		warnings: [warning, ...report.warnings],
	};
}

async function runPublicationPlan(input: ScenePublishPlanOptions & { mode: ScenePublishPlanMode }): Promise<ScenePublishPlanReport> {
	const resolved = resolveSceneRunRoot(input.projectRoot, input.from);
	if (!resolved.runRoot) return failedReport({ scenePath: input.scene, runRoot: null, diagnostics: resolved.diagnostics });
	const scenePath = join(resolved.runRoot, 'scene.normalized.json');
	const runPath = join(resolved.runRoot, 'run.json');
	const blockers: SceneDiagnostic[] = [];
	if (!existsSync(scenePath)) blockers.push(sceneErrorDiagnostic('scene.publish_plan_missing_scene', `Normalized scene artifact not found: ${scenePath}.`, 'scene'));
	if (!existsSync(runPath)) blockers.push(sceneErrorDiagnostic('scene.publish_plan_missing_run', `Run report artifact not found: ${runPath}.`, 'from'));
	if (blockers.length > 0) return failedReport({ scenePath: input.scene, runRoot: resolved.runRoot, diagnostics: [...resolved.diagnostics, ...blockers], blockers });

	const sourceScene = readJson<SceneManifest>(scenePath);
	const run = readJson<SceneRunReport>(runPath);
	const validation = validateScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.ok) return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: validation.diagnostics, sceneId: sourceScene.id, sourceRunId: run.runId });
	if (validation.scene?.id !== sourceScene.id) {
		const diagnostic = sceneErrorDiagnostic('scene.publish_plan_scene_mismatch', `Scene manifest "${validation.scene?.id ?? '(unknown)'}" does not match source run scene "${sourceScene.id}".`, 'scene');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], blockers: [diagnostic], sceneId: sourceScene.id, sourceRunId: run.runId });
	}
	const targets = input.targets ?? DEFAULT_SCENE_PUBLICATION_TARGETS;
	const targetDiagnostics = validateTargets(targets);
	if (targetDiagnostics.length > 0) {
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: targetDiagnostics, blockers: targetDiagnostics, sceneId: sourceScene.id, sourceRunId: run.runId });
	}
	const publishResult = await loadOrGenerateLocalPublish({ projectRoot: input.projectRoot, scene: input.scene, from: input.from, runRoot: resolved.runRoot, timestamp: input.timestamp });
	if (!publishResult.publish) {
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: publishResult.diagnostics, warnings: publishResult.warnings, blockers: publishResult.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), sceneId: sourceScene.id, sourceRunId: run.runId });
	}
	const manifest = buildScenePublishPlanManifest({
		publish: publishResult.publish,
		publishManifestPath: publishResult.publishManifestPath,
		runRoot: resolved.runRoot,
		targets,
		mode: input.mode,
		timestamp: input.timestamp,
	});
	const manifestErrors = manifest.diagnostics.filter((diagnostic) => diagnostic.severity === 'error' && diagnostic.code.startsWith('scene.publish_plan_'));
	if (manifestErrors.length > 0) {
		return failedReport({
			scenePath: validation.scenePath,
			runRoot: resolved.runRoot,
			diagnostics: [...publishResult.diagnostics, ...manifest.diagnostics],
			warnings: publishResult.warnings,
			blockers: manifestErrors,
			sceneId: sourceScene.id,
			sourceRunId: run.runId,
			manifest,
		});
	}
	try {
		const paths = writeScenePublishPlan({ runRoot: resolved.runRoot, manifest });
		const updateWarnings = appendScenePublishPlanPaths({ runPath, paths });
		return {
			ok: true,
			phase: 11,
			sceneId: sourceScene.id,
			sourceRunId: run.runId,
			scenePath: validation.scenePath,
			runRoot: resolved.runRoot,
			publishRoot: join(resolved.runRoot, 'publish'),
			publishPlanRoot: paths.publishPlanRoot,
			manifest,
			paths,
			diagnostics: [...publishResult.diagnostics, ...updateWarnings],
			warnings: [...publishResult.warnings, ...updateWarnings],
			blockers: [],
		};
	} catch (error) {
		const diagnostic = sceneErrorDiagnostic(input.mode === 'local-export' ? 'scene.publish_plan_export_failed' : 'scene.publish_plan_write_failed', `Publish plan artifacts could not be written. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'publish-plan');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], warnings: publishResult.warnings, blockers: [diagnostic], sceneId: sourceScene.id, sourceRunId: run.runId, manifest });
	}
}

export function planScenePublication(input: ScenePublishPlanOptions): Promise<ScenePublishPlanReport> {
	return runPublicationPlan({ ...input, mode: input.mode ?? 'plan' });
}

export function exportScenePublication(input: Omit<ScenePublishPlanOptions, 'mode'>): Promise<ScenePublishPlanReport> {
	return runPublicationPlan({ ...input, mode: 'local-export' });
}
