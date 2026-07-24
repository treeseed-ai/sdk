import { appendSceneJsonl } from '../evidence/artifacts.ts';
import type { SceneProgressEvent, SceneProgressEventType } from '../../types.ts';

export function createSceneProgress(input: {
	sceneId: string | null;
	runId: string | null;
	startedAtMs: number;
	progressPath?: string | null;
	onProgress?: (event: SceneProgressEvent) => void;
	now?: () => Date;
}) {
	const now = input.now ?? (() => new Date());
	return {
		push(type: SceneProgressEventType, data: Record<string, unknown> = {}, options: {
			chapterId?: string | null;
			segmentId?: string | null;
			stepId?: string | null;
			checkpointId?: string | null;
			status?: string;
		} = {}) {
			const timestamp = now();
			const event: SceneProgressEvent = {
				type,
				sceneId: input.sceneId,
				runId: input.runId,
				timestamp: timestamp.toISOString(),
				offsetMs: Math.max(0, timestamp.getTime() - input.startedAtMs),
				data,
				...options,
			};
			if (input.progressPath) appendSceneJsonl(input.progressPath, event);
			input.onProgress?.(event);
			return event;
		},
	};
}
