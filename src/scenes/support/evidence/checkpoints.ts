import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { SceneArtifactPathPlan, SceneCheckpoint } from '../../types.ts';

export function createSceneCheckpoint(input: {
	paths: SceneArtifactPathPlan;
	sceneId: string;
	runId: string;
	stepId: string;
	chapterId: string;
	segmentId: string;
	completedStepIds: string[];
	nextStepId: string | null;
	checkpointId?: string;
	resumable: boolean;
}): SceneCheckpoint {
	const id = input.checkpointId ?? input.stepId;
	const checkpointPath = join(input.paths.checkpointsRoot, `${id}.json`);
	return {
		id,
		sceneId: input.sceneId,
		runId: input.runId,
		stepId: input.stepId,
		chapterId: input.chapterId,
		segmentId: input.segmentId,
		createdAt: new Date().toISOString(),
		resumable: input.resumable,
		completedStepIds: [...input.completedStepIds],
		nextStepId: input.nextStepId,
		artifactPaths: {
			checkpointPath,
			runRoot: input.paths.runRoot,
			timelinePath: input.paths.timelinePath,
			reportPath: input.paths.markdownReportPath,
		},
	};
}

export function writeSceneCheckpoint(checkpoint: SceneCheckpoint) {
	mkdirSync(dirname(checkpoint.artifactPaths.checkpointPath), { recursive: true });
	writeFileSync(checkpoint.artifactPaths.checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`, 'utf8');
}
