import type {
	SceneCaptionCue,
	SceneManifest,
	SceneRunReport,
	SceneTimelineEvent,
} from '../../types.ts';

function clampText(value: string) {
	return value.replace(/\s+/gu, ' ').trim();
}

function formatTimestamp(ms: number, separator: '.' | ',') {
	const totalMs = Math.max(0, Math.round(ms));
	const hours = Math.floor(totalMs / 3_600_000);
	const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
	const seconds = Math.floor((totalMs % 60_000) / 1000);
	const millis = totalMs % 1000;
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}${separator}${String(millis).padStart(3, '0')}`;
}

export function stepOffset(input: {
	stepId: string;
	timeline: SceneTimelineEvent[];
	prefer?: 'start' | 'end';
	fallbackMs?: number;
}) {
	const preferredType = input.prefer === 'end' ? 'step.end' : 'step.start';
	const preferred = input.timeline.find((event) => event.stepId === input.stepId && event.type === preferredType);
	if (preferred) return preferred.offsetMs;
	const any = input.timeline.find((event) => event.stepId === input.stepId);
	return any?.offsetMs ?? input.fallbackMs ?? 0;
}

function chapterForStep(run: SceneRunReport, stepId: string) {
	return (run.chapters ?? []).find((chapter) => chapter.stepIds.includes(stepId)) ?? null;
}

function boundedCue(input: {
	id: string;
	startMs: number;
	endMs?: number;
	maxCueMs: number;
	text: string;
	stepId?: string | null;
	chapterId?: string | null;
}): SceneCaptionCue {
	const startMs = Math.max(0, Math.round(input.startMs));
	const requestedEnd = input.endMs && input.endMs > startMs ? input.endMs : startMs + input.maxCueMs;
	const endMs = Math.max(startMs + 1000, Math.min(Math.round(requestedEnd), startMs + input.maxCueMs));
	return {
		id: input.id,
		startMs,
		endMs,
		text: clampText(input.text),
		...(input.stepId ? { stepId: input.stepId } : {}),
		...(input.chapterId ? { chapterId: input.chapterId } : {}),
	};
}

export function buildSceneCaptionCues(input: {
	scene: SceneManifest;
	run: SceneRunReport;
	timeline: SceneTimelineEvent[];
}): SceneCaptionCue[] {
	const maxCueMs = Math.max(1000, Math.round(input.scene.training.captions.maxCueSeconds * 1000));
	const cues: SceneCaptionCue[] = [];
	for (const chapter of input.run.chapters ?? []) {
		const firstStep = chapter.stepIds[0];
		const startMs = firstStep ? stepOffset({ stepId: firstStep, timeline: input.timeline }) : 0;
		cues.push(boundedCue({ id: `chapter-${chapter.id}`, startMs, maxCueMs, text: `Chapter: ${chapter.title}`, chapterId: chapter.id }));
	}
	input.run.steps.forEach((step, index) => {
		const chapter = chapterForStep(input.run, step.id);
		const startMs = stepOffset({ stepId: step.id, timeline: input.timeline, fallbackMs: index * 4000 });
		const endMs = stepOffset({ stepId: step.id, timeline: input.timeline, prefer: 'end', fallbackMs: startMs + maxCueMs });
		cues.push(boundedCue({ id: `step-${step.id}`, startMs, endMs, maxCueMs, text: step.title, stepId: step.id, chapterId: chapter?.id ?? null }));
	});
	for (const overlay of input.scene.overlays ?? []) {
		if (!overlay.text) continue;
		const startMs = stepOffset({ stepId: overlay.at, timeline: input.timeline });
		const chapter = chapterForStep(input.run, overlay.at);
		cues.push(boundedCue({ id: `overlay-${overlay.id}`, startMs, maxCueMs, text: overlay.text, stepId: overlay.at, chapterId: chapter?.id ?? null }));
	}
	for (const diagram of input.scene.diagrams ?? []) {
		const title = typeof diagram.props?.title === 'string' ? diagram.props.title : diagram.id;
		const startMs = stepOffset({ stepId: diagram.at, timeline: input.timeline });
		const chapter = chapterForStep(input.run, diagram.at);
		cues.push(boundedCue({ id: `diagram-${diagram.id}`, startMs, maxCueMs, text: `Diagram: ${title}`, stepId: diagram.at, chapterId: chapter?.id ?? null }));
	}
	const failedStep = input.run.failedStep ? input.run.steps.find((step) => step.id === input.run.failedStep) : null;
	if (failedStep?.error && input.scene.training.narration.includeDiagnostics) {
		const startMs = stepOffset({ stepId: failedStep.id, timeline: input.timeline });
		const chapter = chapterForStep(input.run, failedStep.id);
		cues.push(boundedCue({ id: `diagnostic-${failedStep.id}`, startMs, maxCueMs, text: `${failedStep.error.code}: ${failedStep.error.message}`, stepId: failedStep.id, chapterId: chapter?.id ?? null }));
	}
	const byId = new Map<string, SceneCaptionCue>();
	for (const cue of cues.filter((cue) => cue.text.length > 0)) byId.set(cue.id, cue);
	return [...byId.values()].sort((a, b) => a.startMs - b.startMs || a.id.localeCompare(b.id));
}

export function formatSceneCaptionsVtt(cues: SceneCaptionCue[]) {
	const lines = ['WEBVTT', ''];
	for (const cue of cues) {
		lines.push(cue.id);
		lines.push(`${formatTimestamp(cue.startMs, '.')} --> ${formatTimestamp(cue.endMs, '.')}`);
		lines.push(cue.text);
		lines.push('');
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

export function formatSceneCaptionsSrt(cues: SceneCaptionCue[]) {
	const lines: string[] = [];
	cues.forEach((cue, index) => {
		lines.push(String(index + 1));
		lines.push(`${formatTimestamp(cue.startMs, ',')} --> ${formatTimestamp(cue.endMs, ',')}`);
		lines.push(cue.text);
		lines.push('');
	});
	return `${lines.join('\n').trimEnd()}\n`;
}
