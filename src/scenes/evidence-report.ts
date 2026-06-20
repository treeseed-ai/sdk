import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sceneWarningDiagnostic } from './diagnostics.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneEvidenceManifest,
	TreeseedSceneEvidencePaths,
	TreeseedSceneRunReport,
} from './types.ts';

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path: string, value: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, 'utf8');
}

export function formatTreeseedSceneEvidenceMarkdownReport(manifest: TreeseedSceneEvidenceManifest) {
	const lines = [
		`# Treeseed Scene Evidence: ${manifest.summary.sceneId ?? '(unknown scene)'}`,
		'',
		`Scene: ${manifest.summary.sceneId ?? '(unknown)'}`,
		`Source run: ${manifest.summary.runId ?? '(unknown)'}`,
		`Target: ${manifest.target}`,
		`Bundle: ${manifest.bundlePolicy}`,
		`Workflow: ${manifest.summary.workflowStatus}`,
		`Failed step: ${manifest.summary.failedStep ?? '(none)'}`,
		`Steps: ${manifest.summary.stepCounts.passed} passed, ${manifest.summary.stepCounts.failed} failed, ${manifest.summary.stepCounts.skipped} skipped`,
		`Chapters: ${manifest.summary.chapters}`,
		`Segments: ${manifest.summary.segments}`,
		`Checkpoints: ${manifest.summary.checkpoints}`,
		`Rendered videos: ${manifest.summary.renderedVideos}`,
		`Training outputs: ${manifest.summary.trainingOutputs ? 'yes' : 'no'}`,
		'',
		'## Artifacts',
		'',
		'| Kind | Path | Bundle | SHA-256 |',
		'| --- | --- | --- | --- |',
		...manifest.artifacts.map((artifact) => [
			`| ${artifact.kind}`,
			artifact.relativePath,
			artifact.includedInBundle ? 'included' : artifact.redactionStatus,
			artifact.sha256 ?? '(none)',
			'|',
		].join(' | ')),
		'',
		'## Recommendations',
		'',
		...(manifest.recommendations.length > 0
			? manifest.recommendations.map((recommendation) => `- ${recommendation.severity.toUpperCase()} ${recommendation.reason}: \`${recommendation.command}\``)
			: ['- No follow-up recommendations.']),
		'',
	];
	return lines.join('\n');
}

export function writeTreeseedSceneEvidenceReport(input: {
	manifest: TreeseedSceneEvidenceManifest;
	paths: TreeseedSceneEvidencePaths;
}) {
	writeJson(input.paths.manifestPath, input.manifest);
	writeText(input.paths.reportPath, formatTreeseedSceneEvidenceMarkdownReport(input.manifest));
}

export function appendTreeseedSceneEvidencePaths(input: {
	runPath: string;
	paths: TreeseedSceneEvidencePaths;
}): TreeseedSceneDiagnostic[] {
	try {
		if ((statSync(input.runPath).mode & 0o222) === 0) {
			throw new Error('run.json is not writable.');
		}
		const run = JSON.parse(readFileSync(input.runPath, 'utf8')) as TreeseedSceneRunReport & {
			evidencePaths?: TreeseedSceneEvidencePaths;
			logs?: Record<string, string | null>;
		};
		writeJson(input.runPath, {
			...run,
			evidencePaths: input.paths,
			logs: run.logs ? { ...run.logs, evidence: input.paths.evidenceRoot } : run.logs,
		});
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic('scene.evidence_run_update_failed', `Evidence artifacts were written but run.json could not be updated. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'run.json')];
	}
}
