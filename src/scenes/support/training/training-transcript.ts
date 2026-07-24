import { stepOffset } from './training-captions.ts';
import type {
	SceneChapterClipManifest,
	SceneGlossaryTerm,
	SceneManifest,
	SceneNarrationScriptEntry,
	SceneRunReport,
	SceneTimelineEvent,
	SceneTrainingNarrationStyle,
	SceneTranscriptEntry,
} from '../../types.ts';

const BUILT_IN_GLOSSARY: Record<string, string> = {
	reconciliation: 'Exact-state comparison and repair from declared Treeseed desired state to observed live state.',
	operation: 'A tracked Treeseed platform task with lifecycle status, events, and durable evidence.',
	checkpoint: 'A durable scene marker that records completed workflow progress and possible resume position.',
	segment: 'A bounded section of a long scene used for evidence organization and future partial rendering.',
	'managed dev': 'The worktree-scoped local Treeseed development runtime supervised by SDK managed-dev services.',
	seed: 'A deterministic Treeseed data/configuration input planned or applied through canonical SDK seed services.',
	auth: 'A resolved non-interactive Treeseed market profile and session context.',
	provider: 'A host, service, or external platform managed only through canonical Treeseed reconciliation paths.',
	Remotion: 'The Phase 6 adapter-hosted renderer used to turn scene evidence into video outputs.',
	Playwright: 'The browser automation engine used by scene runs to collect executable acceptance evidence.',
};

function text(value: string | undefined | null) {
	return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function chapterForStep(run: SceneRunReport, stepId: string) {
	return (run.chapters ?? []).find((chapter) => chapter.stepIds.includes(stepId)) ?? null;
}

function actionSummary(actionKind: string) {
	if (actionKind === 'goto') return 'navigates the browser to the expected screen';
	if (actionKind === 'click') return 'performs the requested user click';
	if (actionKind === 'fill') return 'fills a browser field';
	if (actionKind === 'keyboard') return 'sends a keyboard command';
	if (actionKind === 'waitForOperation') return 'waits for a Treeseed platform operation to reach an accepted state';
	if (actionKind === 'pause') return 'pauses the demo workflow at an intentional control point';
	if (actionKind === 'mailpitConfirmLatest') return 'opens the latest local Mailpit confirmation link in the browser';
	return `runs ${actionKind}`;
}

export function buildSceneTranscriptEntries(input: {
	scene: SceneManifest;
	run: SceneRunReport;
	timeline: SceneTimelineEvent[];
}): SceneTranscriptEntry[] {
	const entries: SceneTranscriptEntry[] = [{
		id: 'scene',
		timestampMs: 0,
		type: 'scene',
		title: input.scene.title,
		text: text(input.scene.description) || `Scene ${input.scene.id} completed with status ${input.run.workflowStatus}.`,
	}];
	if (input.scene.audience.length > 0) {
		entries.push({
			id: 'scene-audience',
			timestampMs: 0,
			type: 'scene',
			title: 'Audience',
			text: input.scene.audience.join(', '),
		});
	}
	for (const chapter of input.run.chapters ?? []) {
		const firstStep = chapter.stepIds[0];
		entries.push({
			id: `chapter-${chapter.id}`,
			timestampMs: firstStep ? stepOffset({ stepId: firstStep, timeline: input.timeline }) : 0,
			type: 'chapter',
			title: chapter.title,
			text: `Chapter ${chapter.title} covers ${chapter.stepIds.length} scene step${chapter.stepIds.length === 1 ? '' : 's'}.`,
			chapterId: chapter.id,
		});
	}
	input.run.steps.forEach((step, index) => {
		const chapter = chapterForStep(input.run, step.id);
		entries.push({
			id: `step-${step.id}`,
			timestampMs: stepOffset({ stepId: step.id, timeline: input.timeline, fallbackMs: index * 4000 }),
			type: 'step',
			title: step.title,
			text: `This step ${actionSummary(step.actionKind)} and records ${step.assertionResults.length} assertion result${step.assertionResults.length === 1 ? '' : 's'}.`,
			stepId: step.id,
			chapterId: chapter?.id ?? null,
		});
	});
	for (const overlay of input.scene.overlays ?? []) {
		if (!overlay.text) continue;
		const chapter = chapterForStep(input.run, overlay.at);
		entries.push({
			id: `overlay-${overlay.id}`,
			timestampMs: stepOffset({ stepId: overlay.at, timeline: input.timeline }),
			type: 'overlay',
			title: overlay.id,
			text: overlay.text,
			stepId: overlay.at,
			chapterId: chapter?.id ?? null,
		});
	}
	for (const diagram of input.scene.diagrams ?? []) {
		const chapter = chapterForStep(input.run, diagram.at);
		const title = typeof diagram.props?.title === 'string' ? diagram.props.title : diagram.id;
		entries.push({
			id: `diagram-${diagram.id}`,
			timestampMs: stepOffset({ stepId: diagram.at, timeline: input.timeline }),
			type: 'diagram',
			title,
			text: `${diagram.component} renders as ${diagram.placement} evidence for step ${diagram.at}.`,
			stepId: diagram.at,
			chapterId: chapter?.id ?? null,
		});
	}
	const failedStep = input.run.failedStep ? input.run.steps.find((step) => step.id === input.run.failedStep) : null;
	if (failedStep?.error && input.scene.training.narration.includeDiagnostics) {
		const chapter = chapterForStep(input.run, failedStep.id);
		entries.push({
			id: `diagnostic-${failedStep.id}`,
			timestampMs: stepOffset({ stepId: failedStep.id, timeline: input.timeline }),
			type: 'diagnostic',
			title: failedStep.error.code,
			text: failedStep.error.message,
			stepId: failedStep.id,
			chapterId: chapter?.id ?? null,
		});
	}
	return entries.sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id));
}

function scriptFor(entry: SceneTranscriptEntry, style: SceneTrainingNarrationStyle) {
	if (style === 'concise') return `${entry.title}: ${entry.text}`;
	if (style === 'operator') return `Operator note. ${entry.title}. ${entry.text}`;
	if (entry.type === 'step') return `${entry.title}. This proves the workflow can ${entry.text.replace(/^This step /u, '')}`;
	if (entry.type === 'diagnostic') return `Review ${entry.title}. The recorded diagnostic is: ${entry.text}`;
	return `${entry.title}. ${entry.text}`;
}

export function buildSceneNarrationEntries(input: {
	scene: SceneManifest;
	run: SceneRunReport;
	transcript: SceneTranscriptEntry[];
	style: SceneTrainingNarrationStyle;
}): SceneNarrationScriptEntry[] {
	return input.transcript.map((entry, index) => ({
		id: `narration-${entry.id}`,
		order: index + 1,
		...(entry.chapterId ? { chapterId: entry.chapterId } : {}),
		...(entry.stepId ? { stepId: entry.stepId } : {}),
		title: entry.title,
		script: scriptFor(entry, input.style),
		source: entry.type,
	}));
}

export function buildSceneGlossary(input: {
	scene: SceneManifest;
	transcript: SceneTranscriptEntry[];
}): SceneGlossaryTerm[] {
	const explicit = new Map<string, SceneGlossaryTerm>();
	for (const term of input.scene.training.glossary.terms) explicit.set(term.term.toLowerCase(), term);
	const haystack = input.transcript.map((entry) => `${entry.title} ${entry.text}`).join(' ').toLowerCase();
	const terms = new Map<string, SceneGlossaryTerm>();
	for (const [term, definition] of Object.entries(BUILT_IN_GLOSSARY)) {
		if (haystack.includes(term.toLowerCase())) terms.set(term.toLowerCase(), { term, definition, tags: ['built-in'] });
	}
	for (const term of input.scene.diagrams.map((diagram) => diagram.component)) {
		terms.set(term.toLowerCase(), { term, definition: 'A typed Treeseed scene diagram component rendered from validated manifest props.', tags: ['diagram'] });
	}
	for (const [key, term] of explicit) terms.set(key, term);
	return [...terms.values()].sort((a, b) => a.term.localeCompare(b.term));
}

export function buildSceneChapterClips(input: {
	scene: SceneManifest;
	run: SceneRunReport;
	timeline: SceneTimelineEvent[];
}): SceneChapterClipManifest[] {
	const chapters = input.run.chapters.length > 0
		? input.run.chapters
		: [{ id: 'default', title: input.scene.title, stepIds: input.run.steps.map((step) => step.id), segmentIds: input.run.segments.map((segment) => segment.id) }];
	return chapters.map((chapter) => {
		const starts = chapter.stepIds.map((stepId) => stepOffset({ stepId, timeline: input.timeline }));
		const ends = chapter.stepIds.map((stepId) => stepOffset({ stepId, timeline: input.timeline, prefer: 'end', fallbackMs: stepOffset({ stepId, timeline: input.timeline }) + 4000 }));
		const startOffsetMs = Math.min(...starts, 0);
		const endOffsetMs = Math.max(...ends, startOffsetMs + 4000);
		const safeName = `${input.scene.id}-${chapter.id}`.toLowerCase().replace(/[^a-z0-9._-]+/gu, '-');
		return {
			id: `${chapter.id}-clip`,
			chapterId: chapter.id,
			title: chapter.title,
			startOffsetMs,
			endOffsetMs,
			durationMs: Math.max(0, endOffsetMs - startOffsetMs),
			stepIds: chapter.stepIds,
			segmentIds: chapter.segmentIds,
			suggestedOutputName: `${safeName}.mp4`,
		};
	});
}

export function formatSceneTranscriptMarkdown(entries: SceneTranscriptEntry[]) {
	const scene = entries.find((entry) => entry.type === 'scene');
	const lines = [`# ${scene?.title ?? 'Treeseed Scene Transcript'}`, ''];
	for (const entry of entries) {
		if (entry.id === 'scene') {
			lines.push(entry.text, '');
		} else if (entry.type === 'chapter') {
			lines.push(`## Chapter: ${entry.title}`, '', entry.text, '');
		} else {
			const label = entry.type.charAt(0).toUpperCase() + entry.type.slice(1);
			lines.push(`### ${label}: ${entry.title}`, '', entry.text, '');
		}
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

export function formatSceneNarrationMarkdown(entries: SceneNarrationScriptEntry[]) {
	const lines = ['# Treeseed Scene Narration Script', ''];
	for (const entry of entries) {
		lines.push(`## ${entry.order}. ${entry.title}`, '', entry.script, '');
	}
	return `${lines.join('\n').trimEnd()}\n`;
}

export function formatSceneGlossaryMarkdown(terms: SceneGlossaryTerm[]) {
	const lines = ['# Treeseed Scene Glossary', ''];
	for (const term of terms) {
		lines.push(`## ${term.term}`, '', term.definition ?? 'No definition provided.', '');
	}
	return `${lines.join('\n').trimEnd()}\n`;
}
