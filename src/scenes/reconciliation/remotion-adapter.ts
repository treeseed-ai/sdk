import { dirname, join } from 'node:path';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { sceneErrorDiagnostic } from '../support/reporting/diagnostics.ts';
import type { SceneRendererAdapter } from '../types.ts';

function remotionEntryPoint() {
	const current = fileURLToPath(import.meta.url);
	const extension = current.endsWith('.ts') ? '.ts' : '.js';
	return join(dirname(current), `remotion-compositions${extension}`);
}

function remotionDiagnostic(error: unknown, fallbackCode: string, fallbackMessage: string) {
	const message = error instanceof Error ? error.message : String(error ?? fallbackMessage);
	const lower = message.toLowerCase();
	if (lower.includes('browser') || lower.includes('chrome') || lower.includes('chromium')) {
		return sceneErrorDiagnostic('scene.remotion_browser_missing', `${fallbackMessage} ${message}`.trim(), 'renderer');
	}
	return sceneErrorDiagnostic(fallbackCode, `${fallbackMessage} ${message}`.trim(), 'renderer');
}

function remotionConcurrency() {
	const raw = process.env.TREESEED_SCENE_REMOTION_CONCURRENCY;
	const parsed = raw ? Number(raw) : 4;
	const max = Math.max(1, availableParallelism());
	if (!Number.isFinite(parsed)) return 4;
	return Math.max(1, Math.min(max, Math.floor(parsed)));
}

export function createRemotionSceneRendererAdapter(): SceneRendererAdapter {
	return {
		id: 'remotion',
		async render(input) {
			let bundle: typeof import('@remotion/bundler')['bundle'];
			let selectComposition: typeof import('@remotion/renderer')['selectComposition'];
			let renderMedia: typeof import('@remotion/renderer')['renderMedia'];
			try {
				const [bundler, renderer] = await Promise.all([
					import('@remotion/bundler'),
					import('@remotion/renderer'),
				]);
				bundle = bundler.bundle;
				selectComposition = renderer.selectComposition;
				renderMedia = renderer.renderMedia;
			} catch (error) {
				return {
					ok: false,
					outputPath: null,
					diagnostics: [sceneErrorDiagnostic('scene.remotion_unavailable', `Install SDK dependencies and ensure remotion, @remotion/renderer, and @remotion/bundler are available. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(), 'renderer')],
				};
			}

			let serveUrl: string;
			try {
				input.onProgress?.({ type: 'bundle.started' });
				serveUrl = await bundle({
					entryPoint: input.entryPoint || remotionEntryPoint(),
					...(input.publicDir ? { publicDir: input.publicDir } : {}),
				});
				input.onProgress?.({ type: 'bundle.finished', serveUrl });
			} catch (error) {
				return { ok: false, outputPath: null, diagnostics: [remotionDiagnostic(error, 'scene.remotion_bundle_failed', 'Unable to bundle Remotion scene composition.')] };
			}

			let composition: Awaited<ReturnType<typeof selectComposition>>;
			try {
				input.onProgress?.({ type: 'composition.selected', compositionId: input.compositionId });
				composition = await selectComposition({
					serveUrl,
					id: input.compositionId,
					inputProps: input.inputProps,
				});
			} catch (error) {
				return { ok: false, outputPath: null, diagnostics: [remotionDiagnostic(error, 'scene.remotion_composition_failed', 'Unable to select Remotion scene composition.')] };
			}

			try {
				input.onProgress?.({ type: 'media.started', outputPath: input.outputPath });
				await renderMedia({
					serveUrl,
					composition,
					codec: input.codec,
					outputLocation: input.outputPath,
					inputProps: input.inputProps,
					concurrency: remotionConcurrency(),
					onProgress: (progress) => input.onProgress?.({ type: 'media.progress', ...progress }),
				});
				input.onProgress?.({ type: 'media.finished', outputPath: input.outputPath });
				return { ok: true, outputPath: input.outputPath, diagnostics: [] };
			} catch (error) {
				return { ok: false, outputPath: null, diagnostics: [remotionDiagnostic(error, 'scene.remotion_render_failed', 'Unable to render Remotion scene video.')] };
			}
		},
	};
}

export function resolveSceneRemotionEntryPoint() {
	return remotionEntryPoint();
}
