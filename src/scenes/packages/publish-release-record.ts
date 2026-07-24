import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ScenePublishManifest } from '../types.ts';

function safePathPart(value: string | null) {
	return (value ?? 'unknown').toLowerCase().replace(/[^a-z0-9._-]/gu, '-').replace(/^-+|-+$/gu, '') || 'unknown';
}

export function SceneReleaseEvidenceRecordPath(input: {
	projectRoot: string;
	sceneId: string | null;
	runId: string | null;
}) {
	return join(input.projectRoot, '.treeseed', 'workflow', 'scene-evidence', safePathPart(input.sceneId), `${safePathPart(input.runId)}.json`);
}

export function writeSceneReleaseEvidenceRecord(input: {
	projectRoot: string;
	manifest: ScenePublishManifest;
	manifestPath: string;
	reportPath: string;
	bundleRoot: string;
}) {
	const path = SceneReleaseEvidenceRecordPath({
		projectRoot: input.projectRoot,
		sceneId: input.manifest.sceneId,
		runId: input.manifest.sourceRunId,
	});
	const record = {
		schemaVersion: 'treeseed.scene.release-evidence/v1',
		generatedAt: input.manifest.generatedAt,
		sceneId: input.manifest.sceneId,
		sourceRunId: input.manifest.sourceRunId,
		workflowStatus: input.manifest.workflowStatus,
		publishManifestPath: input.manifestPath,
		publishReportPath: input.reportPath,
		publishBundleRoot: input.bundleRoot,
		sourceEvidenceManifestPath: input.manifest.sourceEvidenceManifestPath,
	};
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
	return path;
}
