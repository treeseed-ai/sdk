import type { SceneTimelineEvent } from '../../types.ts';

export type SceneTimelineWriter = {
	events: SceneTimelineEvent[];
	push(type: SceneTimelineEvent['type'], data: Record<string, unknown>, stepId?: string): SceneTimelineEvent;
};

export function createSceneTimeline(input: {
	sceneId: string;
	runId: string;
	startedAtMs: number;
	now?: () => Date;
}): SceneTimelineWriter {
	const events: SceneTimelineEvent[] = [];
	const now = input.now ?? (() => new Date());
	let sequence = 0;
	return {
		events,
		push(type, data, stepId) {
			const timestamp = now();
			const event: SceneTimelineEvent = {
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
