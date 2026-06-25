import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sceneWarningDiagnostic } from './diagnostics.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedScenePublishManifest,
	TreeseedScenePublishPaths,
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

export function formatTreeseedScenePublishMarkdownReport(manifest: TreeseedScenePublishManifest) {
	const included = manifest.artifacts.filter((artifact) => artifact.decision === 'include');
	const excluded = manifest.artifacts.filter((artifact) => artifact.decision !== 'include');
	const lines = [
		`# Treeseed Scene Publish: ${manifest.sceneId ?? '(unknown scene)'}`,
		'',
		`Scene: ${manifest.sceneId ?? '(unknown)'}`,
		`Source run: ${manifest.sourceRunId ?? '(unknown)'}`,
		`Target: ${manifest.target}`,
		`Workflow: ${manifest.workflowStatus}`,
		`Policy: ${manifest.redactionPolicy.id}`,
		`Included artifacts: ${included.length}`,
		`Excluded artifacts: ${excluded.length}`,
		`Release record: ${manifest.releaseRecordPath ?? '(none)'}`,
		'',
		'## Included Artifacts',
		'',
		'| Kind | Source | Published | SHA-256 |',
		'| --- | --- | --- | --- |',
		...(included.length > 0
			? included.map((artifact) => `| ${artifact.kind} | ${artifact.relativePath} | ${artifact.publishedPath ?? '(none)'} | ${artifact.sha256 ?? '(none)'} |`)
			: ['| (none) | (none) | (none) | (none) |']),
		'',
		'## Redaction Decisions',
		'',
		'| Kind | Source | Decision | Reason |',
		'| --- | --- | --- | --- |',
		...(excluded.length > 0
			? excluded.map((artifact) => `| ${artifact.kind} | ${artifact.relativePath} | ${artifact.decision} | ${artifact.reason} |`)
			: ['| (none) | (none) | (none) | (none) |']),
		'',
	];
	return lines.join('\n');
}

export function writeTreeseedScenePublishReport(input: {
	manifest: TreeseedScenePublishManifest;
	paths: TreeseedScenePublishPaths;
}) {
	writeJson(input.paths.manifestPath, input.manifest);
	writeText(input.paths.reportPath, formatTreeseedScenePublishMarkdownReport(input.manifest));
}

export function appendTreeseedScenePublishPaths(input: {
	runPath: string;
	paths: TreeseedScenePublishPaths;
}): TreeseedSceneDiagnostic[] {
	try {
		if ((statSync(input.runPath).mode & 0o222) === 0) {
			throw new Error('run.json is not writable.');
		}
		const run = JSON.parse(readFileSync(input.runPath, 'utf8')) as TreeseedSceneRunReport & {
			publishPaths?: TreeseedScenePublishPaths;
			logs?: Record<string, string | null>;
		};
		writeJson(input.runPath, {
			...run,
			publishPaths: input.paths,
			logs: run.logs ? { ...run.logs, publish: input.paths.publishRoot } : run.logs,
		});
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic('scene.publish_run_update_failed', `Publish artifacts were written but run.json could not be updated. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'run.json')];
	}
}
