import { join } from 'node:path';
import type {
	SceneExternalPublishTarget,
	ScenePublishedArtifact,
	ScenePublishDestination,
} from '../types.ts';

export const DEFAULT_SCENE_PUBLICATION_TARGETS: SceneExternalPublishTarget[] = [
	'docs',
	'training',
	'release-evidence',
];

export const SCENE_EXTERNAL_PUBLICATION_TARGETS: SceneExternalPublishTarget[] = [
	'docs',
	'training',
	'release-evidence',
	'artifact-store',
];

export function isSceneExternalPublishTarget(value: unknown): value is SceneExternalPublishTarget {
	return typeof value === 'string' && SCENE_EXTERNAL_PUBLICATION_TARGETS.includes(value as SceneExternalPublishTarget);
}

export function createScenePublishDestinations(input: {
	runRoot: string;
	targets: SceneExternalPublishTarget[];
}): ScenePublishDestination[] {
	return input.targets.map((target) => {
		const relativePath = join('publish-plan', 'export', target);
		const title = target === 'docs'
			? 'Documentation evidence publication'
			: target === 'training'
				? 'Training artifact publication'
				: target === 'release-evidence'
					? 'Release evidence publication'
					: 'Remote artifact-store publication plan';
		const provider = target === 'artifact-store' ? 'artifact-store' : 'local';
		return {
			id: target,
			target,
			title,
			root: join(input.runRoot, relativePath),
			relativePath,
			plannedUrl: null,
			reconciliationResource: {
				type: 'scene-evidence-publication',
				provider,
				environment: target === 'release-evidence' ? 'release' : null,
				desiredState: {
					target,
					sourceRunRoot: input.runRoot,
					exportRoot: join(input.runRoot, relativePath),
					phase: 11,
					mode: 'plan-only',
				},
			},
		};
	});
}

function publishedPath(artifact: ScenePublishedArtifact) {
	return artifact.publishedPath ?? artifact.sourcePath;
}

function isTrainingMarkdown(relativePath: string) {
	return /(^|[/\\])training[/\\](transcript\.md|glossary\.md|chapter-clips\.json)$/u.test(relativePath);
}

function isTrainingOutput(relativePath: string) {
	return /(^|[/\\])training[/\\]/u.test(relativePath);
}

function isRenderReport(relativePath: string) {
	return /(^|[/\\])render[/\\][^/\\]+[/\\]report\.json$/u.test(relativePath);
}

export function destinationIdsForScenePublishedArtifact(input: {
	artifact: ScenePublishedArtifact;
	targets: SceneExternalPublishTarget[];
}): string[] {
	const artifact = input.artifact;
	if (artifact.decision !== 'include') return [];
	const path = artifact.relativePath;
	const destinations: SceneExternalPublishTarget[] = [];
	if (input.targets.includes('docs')) {
		if (
			artifact.kind === 'markdown-report'
			|| artifact.kind === 'render-report'
			|| isTrainingMarkdown(path)
			|| isRenderReport(path)
		) {
			destinations.push('docs');
		}
	}
	if (input.targets.includes('training')) {
		if (artifact.kind === 'training-output' || isTrainingOutput(path) || artifact.kind === 'render-report') {
			destinations.push('training');
		}
	}
	if (input.targets.includes('release-evidence')) {
		if ([
			'run-report',
			'markdown-report',
			'timeline',
			'setup',
			'progress',
			'segment',
			'checkpoint',
			'render-report',
			'training-output',
			'screenshot',
		].includes(artifact.kind)) {
			destinations.push('release-evidence');
		}
	}
	if (input.targets.includes('artifact-store')) {
		if (publishedPath(artifact) && artifact.kind !== 'render-video' && artifact.kind !== 'log-summary') {
			destinations.push('artifact-store');
		}
	}
	return destinations;
}
