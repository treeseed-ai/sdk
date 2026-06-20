import { appendTreeseedSceneJsonl } from './artifacts.ts';
import type { TreeseedSceneProgressEvent, TreeseedSceneProgressEventType } from './types.ts';

export function createTreeseedSceneProgress(input: {
	sceneId: string | null;
	runId: string | null;
	startedAtMs: number;
	progressPath?: string | null;
	onProgress?: (event: TreeseedSceneProgressEvent) => void;
	now?: () => Date;
}) {
	const now = input.now ?? (() => new Date());
	return {
		push(type: TreeseedSceneProgressEventType, data: Record<string, unknown> = {}, options: {
			chapterId?: string | null;
			segmentId?: string | null;
			stepId?: string | null;
			checkpointId?: string | null;
			status?: string;
		} = {}) {
			const timestamp = now();
			const event: TreeseedSceneProgressEvent = {
				type,
				sceneId: input.sceneId,
				runId: input.runId,
				timestamp: timestamp.toISOString(),
				offsetMs: Math.max(0, timestamp.getTime() - input.startedAtMs),
				data,
				...options,
			};
			if (input.progressPath) appendTreeseedSceneJsonl(input.progressPath, event);
			input.onProgress?.(event);
			return event;
		},
	};
}
