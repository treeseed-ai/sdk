import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sceneWarningDiagnostic } from '../support/reporting/diagnostics.ts';
import type {
	SceneDiagnostic,
	ScenePublishPlanManifest,
	ScenePublishPlanPaths,
	SceneRunReport,
} from '../types.ts';

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(path: string, value: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, value, 'utf8');
}

export function formatScenePublishPlanMarkdownReport(manifest: ScenePublishPlanManifest) {
	const lines = [
		`# Treeseed Scene Publish Plan: ${manifest.sceneId ?? '(unknown scene)'}`,
		'',
		`Scene: ${manifest.sceneId ?? '(unknown)'}`,
		`Source run: ${manifest.sourceRunId ?? '(unknown)'}`,
		`Workflow: ${manifest.workflowStatus}`,
		`Mode: ${manifest.mode}`,
		`Targets: ${manifest.targets.join(', ') || '(none)'}`,
		`Destinations: ${manifest.destinations.length}`,
		`Artifacts: ${manifest.artifacts.length}`,
		'',
		'## Destinations',
		'',
		'| Target | Root | Provider | Action |',
		'| --- | --- | --- | --- |',
		...(manifest.destinations.length > 0
			? manifest.destinations.map((destination) => `| ${destination.target} | ${destination.relativePath} | ${destination.reconciliationResource.provider} | plan-only |`)
			: ['| (none) | (none) | (none) | (none) |']),
		'',
		'## Artifacts',
		'',
		'| Kind | Source | Destinations | Decision | SHA-256 |',
		'| --- | --- | --- | --- | --- |',
		...(manifest.artifacts.length > 0
			? manifest.artifacts.map((artifact) => `| ${artifact.kind} | ${artifact.relativePath} | ${artifact.destinationIds.join(', ') || '(none)'} | ${artifact.redactionDecision} | ${artifact.sha256 ?? '(none)'} |`)
			: ['| (none) | (none) | (none) | (none) | (none) |']),
		'',
		'## Reconciliation Intents',
		'',
		'| Target | Action | Reason |',
		'| --- | --- | --- |',
		...(manifest.reconciliationIntents.length > 0
			? manifest.reconciliationIntents.map((intent) => `| ${intent.target} | ${intent.action} | ${intent.reason} |`)
			: ['| (none) | (none) | (none) |']),
		'',
	];
	return lines.join('\n');
}

export function writeScenePublishPlanReport(input: {
	manifest: ScenePublishPlanManifest;
	paths: ScenePublishPlanPaths;
}) {
	writeJson(input.paths.manifestPath, input.manifest);
	writeText(input.paths.reportPath, formatScenePublishPlanMarkdownReport(input.manifest));
}

export function appendScenePublishPlanPaths(input: {
	runPath: string;
	paths: ScenePublishPlanPaths;
}): SceneDiagnostic[] {
	try {
		if ((statSync(input.runPath).mode & 0o222) === 0) {
			throw new Error('run.json is not writable.');
		}
		const run = JSON.parse(readFileSync(input.runPath, 'utf8')) as SceneRunReport & {
			publishPlanPaths?: ScenePublishPlanPaths;
			logs?: Record<string, string | null>;
		};
		writeJson(input.runPath, {
			...run,
			publishPlanPaths: input.paths,
			logs: run.logs ? { ...run.logs, publishPlan: input.paths.publishPlanRoot } : run.logs,
		});
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic('scene.publish_plan_run_update_failed', `Publish plan artifacts were written but run.json could not be updated. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'run.json')];
	}
}
