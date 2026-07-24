import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sceneWarningDiagnostic } from '../reporting/diagnostics.ts';
import type {
	SceneDiagnostic,
	SceneRenderInput,
	SceneRenderReport,
	SceneRunReport,
} from '../../types.ts';

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeSceneRenderReport(input: {
	report: SceneRenderReport;
	input: SceneRenderInput | null;
	composition: Record<string, unknown> | null;
}) {
	if (input.report.inputPath && input.input) writeJson(input.report.inputPath, input.input);
	if (input.report.compositionPath) writeJson(input.report.compositionPath, input.composition ?? {});
	if (input.report.renderRoot) writeJson(join(input.report.renderRoot, 'report.json'), input.report);
}

export function appendSceneRenderedVideo(input: {
	runPath: string;
	outputPath: string;
}): SceneDiagnostic[] {
	try {
		const run = JSON.parse(readFileSync(input.runPath, 'utf8')) as SceneRunReport;
		const renderedVideoPaths = [...new Set([...(run.renderedVideoPaths ?? []), input.outputPath])];
		writeJson(input.runPath, { ...run, renderedVideoPaths });
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic('scene.render_run_update_failed', `Rendered video was created but run.json could not be updated. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'run.json')];
	}
}
