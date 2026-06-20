import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
	TreeseedSceneChapter,
	TreeseedSceneManifest,
	TreeseedSceneRunChapterReport,
	TreeseedSceneRunSegmentReport,
	TreeseedSceneRunStatus,
	TreeseedSceneRunStepReport,
	TreeseedSceneTimelineEvent,
} from './types.ts';

function iso() {
	return new Date().toISOString();
}

function duration(startedAt: string, finishedAt: string | null) {
	return finishedAt ? Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)) : 0;
}

export function deriveTreeseedSceneStepChapters(scene: TreeseedSceneManifest) {
	const starts = new Map(scene.chapters.map((chapter) => [chapter.startsAt, chapter]));
	const defaultChapter: TreeseedSceneChapter = { id: 'default', title: 'Default', startsAt: scene.workflow[0]?.id ?? 'default' };
	let current = scene.chapters.length > 0 && starts.has(scene.workflow[0]?.id ?? '') ? starts.get(scene.workflow[0]!.id)! : defaultChapter;
	const result = new Map<string, TreeseedSceneChapter>();
	for (const step of scene.workflow) {
		current = starts.get(step.id) ?? current;
		result.set(step.id, current);
	}
	return result;
}

export function createTreeseedSceneChapterReports(scene: TreeseedSceneManifest): TreeseedSceneRunChapterReport[] {
	const stepChapters = deriveTreeseedSceneStepChapters(scene);
	const reports = new Map<string, TreeseedSceneRunChapterReport>();
	for (const step of scene.workflow) {
		const chapter = stepChapters.get(step.id)!;
		if (!reports.has(chapter.id)) {
			reports.set(chapter.id, {
				id: chapter.id,
				title: chapter.title,
				startedAt: iso(),
				finishedAt: null,
				durationMs: 0,
				status: 'passed',
				stepIds: [],
				segmentIds: [],
			});
		}
		reports.get(chapter.id)!.stepIds.push(step.id);
	}
	return [...reports.values()];
}

export function createTreeseedSceneSegment(input: {
	segmentsRoot: string;
	chapterId: string;
	index: number;
	startedAt?: string;
}): TreeseedSceneRunSegmentReport {
	const id = `${input.chapterId}-segment-${String(input.index).padStart(3, '0')}`;
	const root = join(input.segmentsRoot, input.chapterId, id);
	mkdirSync(root, { recursive: true });
	return {
		id,
		chapterId: input.chapterId,
		startedAt: input.startedAt ?? iso(),
		finishedAt: null,
		durationMs: 0,
		status: 'passed',
		stepIds: [],
		timelinePath: join(root, 'timeline.json'),
		stepsPath: join(root, 'steps.json'),
		segmentPath: join(root, 'segment.json'),
		videoRefs: [],
	};
}

export function finishTreeseedSceneSegment(segment: TreeseedSceneRunSegmentReport, status: TreeseedSceneRunStatus) {
	segment.finishedAt = iso();
	segment.durationMs = duration(segment.startedAt, segment.finishedAt);
	segment.status = status;
	return segment;
}

export function writeTreeseedSceneSegmentArtifacts(input: {
	segment: TreeseedSceneRunSegmentReport;
	steps: TreeseedSceneRunStepReport[];
	timeline: TreeseedSceneTimelineEvent[];
}) {
	writeFileSync(input.segment.segmentPath, `${JSON.stringify(input.segment, null, 2)}\n`, 'utf8');
	writeFileSync(input.segment.stepsPath, `${JSON.stringify(input.steps, null, 2)}\n`, 'utf8');
	writeFileSync(input.segment.timelinePath, `${JSON.stringify(input.timeline, null, 2)}\n`, 'utf8');
}
