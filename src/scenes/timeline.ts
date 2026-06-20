import type { TreeseedSceneTimelineEvent } from './types.ts';

export type TreeseedSceneTimelineWriter = {
	events: TreeseedSceneTimelineEvent[];
	push(type: TreeseedSceneTimelineEvent['type'], data: Record<string, unknown>, stepId?: string): TreeseedSceneTimelineEvent;
};

export function createTreeseedSceneTimeline(input: {
	sceneId: string;
	runId: string;
	startedAtMs: number;
	now?: () => Date;
}): TreeseedSceneTimelineWriter {
	const events: TreeseedSceneTimelineEvent[] = [];
	const now = input.now ?? (() => new Date());
	let sequence = 0;
	return {
		events,
		push(type, data, stepId) {
			const timestamp = now();
			const event: TreeseedSceneTimelineEvent = {
				id: `${input.runId}-${String(sequence += 1).padStart(5, '0')}`,
				type,
				sceneId: input.sceneId,
				runId: input.runId,
				...(stepId ? { stepId } : {}),
				timestamp: timestamp.toISOString(),
				offsetMs: Math.max(0, timestamp.getTime() - input.startedAtMs),
				data,
			};
			events.push(event);
			return event;
		},
	};
}
