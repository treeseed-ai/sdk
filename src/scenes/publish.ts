import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { sceneErrorDiagnostic, sceneWarningDiagnostic } from './diagnostics.ts';
import { generateTreeseedSceneEvidence } from './evidence.ts';
import { resolveTreeseedSceneRunRoot } from './inspect.ts';
import { validateTreeseedScene } from './planner.ts';
import {
	createDefaultTreeseedSceneRedactionPolicy,
	readTreeseedSceneRedactionPolicyFile,
	resolveTreeseedSceneRedactionRule,
	validateTreeseedSceneRedactionPolicy,
} from './publish-redaction.ts';
import { appendTreeseedScenePublishPaths, writeTreeseedScenePublishReport } from './publish-report.ts';
import { treeseedSceneReleaseEvidenceRecordPath, writeTreeseedSceneReleaseEvidenceRecord } from './publish-release-record.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneEvidenceArtifact,
	TreeseedSceneEvidenceManifest,
	TreeseedSceneManifest,
	TreeseedScenePublishedArtifact,
	TreeseedScenePublishManifest,
	TreeseedScenePublishOptions,
	TreeseedScenePublishPaths,
	TreeseedScenePublishReport,
	TreeseedScenePublishTarget,
	TreeseedSceneRedactionPolicy,
	TreeseedSceneRunReport,
} from './types.ts';

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

function safeBundlePath(bundleRoot: string, relativePath: string) {
	return join(bundleRoot, relativePath.replace(/^(\.\.[/\\])+/u, '').replace(/^[/\\]+/u, ''));
}

function failedReport(input: {
	scenePath: string;
	runRoot: string | null;
	evidenceRoot?: string | null;
	publishRoot?: string | null;
	diagnostics: TreeseedSceneDiagnostic[];
	warnings?: TreeseedSceneDiagnostic[];
	blockers?: TreeseedSceneDiagnostic[];
	sceneId?: string | null;
	sourceRunId?: string | null;
	manifest?: TreeseedScenePublishManifest | null;
	paths?: TreeseedScenePublishPaths | null;
}): TreeseedScenePublishReport {
	const blockers = input.blockers ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
	return {
		ok: false,
		phase: 10,
		status: 'blocked',
		sceneId: input.sceneId ?? null,
		sourceRunId: input.sourceRunId ?? null,
		scenePath: input.scenePath,
		runRoot: input.runRoot,
		evidenceRoot: input.evidenceRoot ?? (input.runRoot ? join(input.runRoot, 'evidence') : null),
		publishRoot: input.publishRoot ?? (input.runRoot ? join(input.runRoot, 'publish') : null),
		manifest: input.manifest ?? null,
		paths: input.paths ?? null,
		diagnostics: input.diagnostics,
		warnings: input.warnings ?? input.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning'),
		blockers,
	};
}

function defaultIncluded(input: {
	artifact: TreeseedSceneEvidenceArtifact;
	policy: TreeseedSceneRedactionPolicy;
}) {
	return input.policy.id === 'treeseed.scene.redaction.default'
		&& input.artifact.kind === 'screenshot'
		&& !input.artifact.includedInBundle
		? false
		: true;
}

function publishDecision(input: {
	artifact: TreeseedSceneEvidenceArtifact;
	policy: TreeseedSceneRedactionPolicy;
	target: TreeseedScenePublishTarget;
	workflowStatus: TreeseedSceneRunReport['workflowStatus'];
}): TreeseedScenePublishedArtifact {
	if (!existsSync(input.artifact.path) || !statSync(input.artifact.path).isFile()) {
		return {
			id: input.artifact.id,
			kind: input.artifact.kind,
			sourcePath: input.artifact.path,
			publishedPath: null,
			relativePath: input.artifact.relativePath,
			sha256: input.artifact.sha256,
			bytes: input.artifact.bytes,
			decision: 'missing',
			reason: 'Source artifact is missing.',
		};
	}
	if (input.artifact.redactionStatus === 'excluded-sensitive') {
		return {
			id: input.artifact.id,
			kind: input.artifact.kind,
			sourcePath: input.artifact.path,
			publishedPath: null,
			relativePath: input.artifact.relativePath,
			sha256: input.artifact.sha256,
			bytes: input.artifact.bytes,
			decision: 'exclude-sensitive',
			reason: 'Artifact was marked sensitive by evidence generation.',
		};
	}
	const rule = resolveTreeseedSceneRedactionRule({
		policy: input.policy,
		artifactKind: input.artifact.kind,
		target: input.target,
		workflowStatus: input.workflowStatus,
	});
	if (!rule || !defaultIncluded({ artifact: input.artifact, policy: input.policy })) {
		return {
			id: input.artifact.id,
			kind: input.artifact.kind,
			sourcePath: input.artifact.path,
			publishedPath: null,
			relativePath: input.artifact.relativePath,
			sha256: input.artifact.sha256,
			bytes: input.artifact.bytes,
			decision: 'exclude-not-allowed',
			reason: rule?.reason ?? 'No redaction rule allowed this artifact.',
		};
	}
	if (!rule.include) {
		return {
			id: input.artifact.id,
			kind: input.artifact.kind,
			sourcePath: input.artifact.path,
			publishedPath: null,
			relativePath: input.artifact.relativePath,
			sha256: input.artifact.sha256,
			bytes: input.artifact.bytes,
			decision: input.artifact.redactionStatus === 'excluded-sensitive' ? 'exclude-sensitive' : 'exclude-not-allowed',
			reason: rule.reason,
		};
	}
	return {
		id: input.artifact.id,
		kind: input.artifact.kind,
		sourcePath: input.artifact.path,
		publishedPath: null,
		relativePath: input.artifact.relativePath,
		sha256: input.artifact.sha256,
		bytes: input.artifact.bytes,
		decision: 'include',
		reason: rule.reason,
	};
}

export function buildTreeseedScenePublishManifest(input: {
	evidence: TreeseedSceneEvidenceManifest;
	evidencePath: string;
	runRoot: string;
	target: TreeseedScenePublishTarget;
	redactionPolicy?: TreeseedSceneRedactionPolicy;
	timestamp?: string;
}): TreeseedScenePublishManifest {
	const redactionPolicy = input.redactionPolicy ?? createDefaultTreeseedSceneRedactionPolicy(input.target);
	const policyDiagnostics = validateTreeseedSceneRedactionPolicy({ policy: redactionPolicy });
	const artifacts = input.evidence.artifacts.map((artifact) => publishDecision({
		artifact,
		policy: redactionPolicy,
		target: input.target,
		workflowStatus: input.evidence.summary.workflowStatus,
	}));
	const diagnostics = [...input.evidence.diagnostics, ...policyDiagnostics];
	if (artifacts.every((artifact) => artifact.decision !== 'include')) {
		diagnostics.push(sceneErrorDiagnostic('scene.publish_no_artifacts', 'Redaction policy did not include any publishable evidence artifacts.', 'publish'));
	}
	return {
		schemaVersion: 'treeseed.scene.publish/v1',
		phase: 10,
		generatedAt: input.timestamp ?? nowIso(),
		target: input.target,
		sourceEvidenceManifestPath: input.evidencePath,
		sourceRunRoot: input.runRoot,
		sceneId: input.evidence.summary.sceneId,
		sourceRunId: input.evidence.summary.runId,
		workflowStatus: input.evidence.summary.workflowStatus,
		redactionPolicy,
		artifacts,
		releaseRecordPath: null,
		diagnostics,
	};
}

export function writeTreeseedScenePublish(input: {
	runRoot: string;
	manifest: TreeseedScenePublishManifest;
	evidence: TreeseedSceneEvidenceManifest;
	projectRoot?: string;
}): TreeseedScenePublishPaths {
	const publishRoot = join(input.runRoot, 'publish', input.manifest.target);
	const paths: TreeseedScenePublishPaths = {
		publishRoot,
		manifestPath: join(publishRoot, 'manifest.json'),
		reportPath: join(publishRoot, 'report.md'),
		bundleRoot: join(publishRoot, 'bundle'),
		releaseRecordPath: input.manifest.target === 'release' && input.projectRoot
			? treeseedSceneReleaseEvidenceRecordPath({ projectRoot: input.projectRoot, sceneId: input.manifest.sceneId, runId: input.manifest.sourceRunId })
			: null,
	};
	const copiedArtifacts = input.manifest.artifacts.map((artifact) => {
		if (artifact.decision !== 'include' || !existsSync(artifact.sourcePath)) return artifact;
		const targetPath = safeBundlePath(paths.bundleRoot, artifact.relativePath);
		mkdirSync(dirname(targetPath), { recursive: true });
		copyFileSync(artifact.sourcePath, targetPath);
		return {
			...artifact,
			publishedPath: targetPath,
			relativePath: relative(paths.bundleRoot, targetPath),
		};
	});
	const manifest = {
		...input.manifest,
		releaseRecordPath: paths.releaseRecordPath,
		artifacts: copiedArtifacts,
	};
	mkdirSync(paths.bundleRoot, { recursive: true });
	writeJson(join(paths.bundleRoot, 'bundle-manifest.json'), {
		schemaVersion: 'treeseed.scene.publish-bundle/v1',
		generatedAt: manifest.generatedAt,
		target: manifest.target,
		sceneId: manifest.sceneId,
		sourceRunId: manifest.sourceRunId,
		artifacts: copiedArtifacts,
	});
	if (manifest.target === 'release' && input.projectRoot) {
		writeTreeseedSceneReleaseEvidenceRecord({
			projectRoot: input.projectRoot,
			manifest,
			manifestPath: paths.manifestPath,
			reportPath: paths.reportPath,
			bundleRoot: paths.bundleRoot,
		});
	}
	writeTreeseedScenePublishReport({ manifest, paths });
	return paths;
}

function loadOrGenerateEvidence(input: {
	projectRoot: string;
	scene: string;
	from: string;
	runRoot: string;
	target: TreeseedScenePublishTarget;
	timestamp?: string;
}): {
	evidence: TreeseedSceneEvidenceManifest | null;
	evidencePath: string;
	warnings: TreeseedSceneDiagnostic[];
	diagnostics: TreeseedSceneDiagnostic[];
} {
	const evidencePath = join(input.runRoot, 'evidence', 'manifest.json');
	if (existsSync(evidencePath)) {
		return { evidence: readJson<TreeseedSceneEvidenceManifest>(evidencePath), evidencePath, warnings: [], diagnostics: [] };
	}
	const report = generateTreeseedSceneEvidence({
		projectRoot: input.projectRoot,
		scene: input.scene,
		from: input.from,
		target: input.target === 'release' ? 'release' : 'local',
		bundlePolicy: 'sanitized',
		timestamp: input.timestamp,
	});
	if (!report.ok || !report.manifest || !report.paths) {
		return { evidence: null, evidencePath, warnings: report.warnings, diagnostics: report.diagnostics };
	}
	const warning = sceneWarningDiagnostic('scene.publish_generated_evidence', 'Evidence manifest was missing, so publish generated sanitized Phase 9 evidence first.', 'evidence');
	return { evidence: report.manifest, evidencePath: report.paths.manifestPath, warnings: [warning, ...report.warnings], diagnostics: [warning, ...report.diagnostics] };
}

export async function publishTreeseedSceneEvidence(input: TreeseedScenePublishOptions): Promise<TreeseedScenePublishReport> {
	const target = input.target ?? 'local';
	if (!['local', 'release'].includes(target)) {
		const diagnostic = sceneErrorDiagnostic('scene.publish_target_unsupported', `Unsupported scene publish target "${String(target)}".`, 'target');
		return failedReport({ scenePath: input.scene, runRoot: null, diagnostics: [diagnostic], blockers: [diagnostic] });
	}
	const resolved = resolveTreeseedSceneRunRoot(input.projectRoot, input.from);
	if (!resolved.runRoot) return failedReport({ scenePath: input.scene, runRoot: null, diagnostics: resolved.diagnostics });
	const scenePath = join(resolved.runRoot, 'scene.normalized.json');
	const runPath = join(resolved.runRoot, 'run.json');
	const timelinePath = join(resolved.runRoot, 'timeline.json');
	const blockers: TreeseedSceneDiagnostic[] = [];
	if (!existsSync(scenePath)) blockers.push(sceneErrorDiagnostic('scene.publish_missing_evidence', `Normalized scene artifact not found: ${scenePath}.`, 'scene'));
	if (!existsSync(runPath)) blockers.push(sceneErrorDiagnostic('scene.publish_missing_evidence', `Run report artifact not found: ${runPath}.`, 'from'));
	if (!existsSync(timelinePath)) blockers.push(sceneErrorDiagnostic('scene.publish_missing_evidence', `Timeline artifact not found: ${timelinePath}.`, 'from'));
	if (blockers.length > 0) return failedReport({ scenePath: input.scene, runRoot: resolved.runRoot, diagnostics: [...resolved.diagnostics, ...blockers], blockers });

	const sourceScene = readJson<TreeseedSceneManifest>(scenePath);
	const run = readJson<TreeseedSceneRunReport>(runPath);
	const validation = validateTreeseedScene({ projectRoot: input.projectRoot, scene: input.scene });
	if (!validation.ok) return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: validation.diagnostics });
	if (validation.scene?.id !== sourceScene.id) {
		const diagnostic = sceneErrorDiagnostic('scene.publish_scene_mismatch', `Scene manifest "${validation.scene?.id ?? '(unknown)'}" does not match source run scene "${sourceScene.id}".`, 'scene');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], blockers: [diagnostic], sceneId: sourceScene.id, sourceRunId: run.runId });
	}
	const policyResult = input.redactionPolicyPath
		? readTreeseedSceneRedactionPolicyFile(input.redactionPolicyPath)
		: { policy: createDefaultTreeseedSceneRedactionPolicy(target), diagnostics: [] };
	if (!policyResult.policy || policyResult.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: policyResult.diagnostics, blockers: policyResult.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), sceneId: sourceScene.id, sourceRunId: run.runId });
	}
	const evidenceResult = loadOrGenerateEvidence({ projectRoot: input.projectRoot, scene: input.scene, from: input.from, runRoot: resolved.runRoot, target, timestamp: input.timestamp });
	if (!evidenceResult.evidence) return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: evidenceResult.diagnostics, warnings: evidenceResult.warnings, blockers: evidenceResult.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), sceneId: sourceScene.id, sourceRunId: run.runId });
	const manifest = buildTreeseedScenePublishManifest({
		evidence: evidenceResult.evidence,
		evidencePath: evidenceResult.evidencePath,
		runRoot: resolved.runRoot,
		target,
		redactionPolicy: policyResult.policy,
		timestamp: input.timestamp,
	});
	const manifestErrors = manifest.diagnostics.filter((diagnostic) => diagnostic.severity === 'error' && diagnostic.code.startsWith('scene.publish_'));
	if (target === 'release' && manifest.workflowStatus !== 'passed') {
		manifestErrors.push(sceneErrorDiagnostic('scene.publish_release_blocked', 'Release evidence publication is blocked until the scene workflow passes.', 'target'));
	}
	if (manifestErrors.length > 0) {
		return failedReport({
			scenePath: validation.scenePath,
			runRoot: resolved.runRoot,
			diagnostics: [...evidenceResult.diagnostics, ...manifest.diagnostics, ...manifestErrors],
			warnings: evidenceResult.warnings,
			blockers: manifestErrors,
			sceneId: sourceScene.id,
			sourceRunId: run.runId,
			manifest,
		});
	}
	try {
		const paths = writeTreeseedScenePublish({ runRoot: resolved.runRoot, manifest, evidence: evidenceResult.evidence, projectRoot: input.projectRoot });
		const updateWarnings = appendTreeseedScenePublishPaths({ runPath, paths });
		return {
			ok: true,
			phase: 10,
			status: 'published',
			sceneId: sourceScene.id,
			sourceRunId: run.runId,
			scenePath: validation.scenePath,
			runRoot: resolved.runRoot,
			evidenceRoot: join(resolved.runRoot, 'evidence'),
			publishRoot: paths.publishRoot,
			manifest: readJson<TreeseedScenePublishManifest>(paths.manifestPath),
			paths,
			diagnostics: [...evidenceResult.diagnostics, ...updateWarnings],
			warnings: [...evidenceResult.warnings, ...updateWarnings],
			blockers: [],
		};
	} catch (error) {
		const diagnostic = sceneErrorDiagnostic('scene.publish_write_failed', `Publish artifacts could not be written. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'publish');
		return failedReport({ scenePath: validation.scenePath, runRoot: resolved.runRoot, diagnostics: [diagnostic], warnings: evidenceResult.warnings, blockers: [diagnostic], sceneId: sourceScene.id, sourceRunId: run.runId, manifest });
	}
}
