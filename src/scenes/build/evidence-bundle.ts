import { createHash } from 'node:crypto';
import { copyFileSync,existsSync,mkdirSync,readFileSync,statSync,writeFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
import type {
SceneEvidenceArtifact,
SceneEvidenceManifest,
SceneEvidencePaths,
} from '../types.ts';

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeBundlePath(bundleRoot: string, relativePath: string) {
	return join(bundleRoot, relativePath.replace(/^(\.\.[/\\])+/u, '').replace(/^[/\\]+/u, ''));
}

function withoutBrowserStateReferences(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(withoutBrowserStateReferences);
	if (!value || typeof value !== 'object') return value;
	return Object.fromEntries(Object.entries(value as Record<string, unknown>)
		.filter(([key]) => key !== 'storageStatePath')
		.map(([key, entry]) => [key, withoutBrowserStateReferences(entry)]));
}

function copySanitizedArtifact(artifact: SceneEvidenceArtifact, targetPath: string) {
	if (!artifact.relativePath.endsWith('.json')) {
		copyFileSync(artifact.path, targetPath);
		return artifact;
	}
	const parsed = JSON.parse(readFileSync(artifact.path, 'utf8'));
	writeJson(targetPath, withoutBrowserStateReferences(parsed));
	const bytes = statSync(targetPath).size;
	const sha256 = createHash('sha256').update(readFileSync(targetPath)).digest('hex');
	return { ...artifact, bytes, sha256 };
}

export function writeSceneEvidenceBundle(input: {
	manifest: SceneEvidenceManifest;
	paths: SceneEvidencePaths;
}): SceneEvidenceArtifact[] {
	if (!input.paths.bundleRoot || !input.paths.bundleManifestPath) return input.manifest.artifacts;
	const copied: SceneEvidenceArtifact[] = [];
	for (const artifact of input.manifest.artifacts) {
		if (!artifact.includedInBundle || !existsSync(artifact.path)) {
			copied.push(artifact);
			continue;
		}
		const targetPath = safeBundlePath(input.paths.bundleRoot, artifact.relativePath);
		mkdirSync(dirname(targetPath), { recursive: true });
		const sanitized = copySanitizedArtifact(artifact, targetPath);
		copied.push({
			...sanitized,
			path: targetPath,
			relativePath: artifact.relativePath,
		});
	}
	const bundleManifest = {
		schemaVersion: 'treeseed.scene.evidence-bundle/v1',
		generatedAt: input.manifest.generatedAt,
		sceneId: input.manifest.summary.sceneId,
		sourceRunId: input.manifest.summary.runId,
		target: input.manifest.target,
		bundlePolicy: input.manifest.bundlePolicy,
		artifacts: copied,
	};
	writeJson(input.paths.bundleManifestPath, bundleManifest);
	return copied;
}
