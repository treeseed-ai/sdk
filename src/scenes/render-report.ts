import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { sceneWarningDiagnostic } from './diagnostics.ts';
import type {
	TreeseedSceneDiagnostic,
	TreeseedSceneRenderInput,
	TreeseedSceneRenderReport,
	TreeseedSceneRunReport,
} from './types.ts';

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function writeTreeseedSceneRenderReport(input: {
	report: TreeseedSceneRenderReport;
	input: TreeseedSceneRenderInput | null;
	composition: Record<string, unknown> | null;
}) {
	if (input.report.inputPath && input.input) writeJson(input.report.inputPath, input.input);
	if (input.report.compositionPath) writeJson(input.report.compositionPath, input.composition ?? {});
	if (input.report.renderRoot) writeJson(join(input.report.renderRoot, 'report.json'), input.report);
}

export function appendTreeseedSceneRenderedVideo(input: {
	runPath: string;
	outputPath: string;
}): TreeseedSceneDiagnostic[] {
	try {
		const run = JSON.parse(readFileSync(input.runPath, 'utf8')) as TreeseedSceneRunReport;
		const renderedVideoPaths = [...new Set([...(run.renderedVideoPaths ?? []), input.outputPath])];
		writeJson(input.runPath, { ...run, renderedVideoPaths });
		return [];
	} catch (error) {
		return [sceneWarningDiagnostic('scene.render_run_update_failed', `Rendered video was created but run.json could not be updated. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'run.json')];
	}
}
