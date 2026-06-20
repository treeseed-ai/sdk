import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
	TreeseedSceneEvidenceArtifact,
	TreeseedSceneEvidenceManifest,
	TreeseedSceneEvidencePaths,
} from './types.ts';

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function safeBundlePath(bundleRoot: string, relativePath: string) {
	return join(bundleRoot, relativePath.replace(/^(\.\.[/\\])+/u, '').replace(/^[/\\]+/u, ''));
}

export function writeTreeseedSceneEvidenceBundle(input: {
	manifest: TreeseedSceneEvidenceManifest;
	paths: TreeseedSceneEvidencePaths;
}): TreeseedSceneEvidenceArtifact[] {
	if (!input.paths.bundleRoot || !input.paths.bundleManifestPath) return input.manifest.artifacts;
	const copied: TreeseedSceneEvidenceArtifact[] = [];
	for (const artifact of input.manifest.artifacts) {
		if (!artifact.includedInBundle || !existsSync(artifact.path)) {
			copied.push(artifact);
			continue;
		}
		const targetPath = safeBundlePath(input.paths.bundleRoot, artifact.relativePath);
		mkdirSync(dirname(targetPath), { recursive: true });
		copyFileSync(artifact.path, targetPath);
		copied.push({
			...artifact,
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
