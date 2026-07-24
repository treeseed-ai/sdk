import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { sceneWarningDiagnostic } from '../reporting/diagnostics.ts';
import type { SceneDiagnostic, SceneRenderInput } from '../../types.ts';

function extensionFor(path: string, mimeType: string) {
	const extension = extname(path);
	if (extension) return extension;
	if (mimeType === 'video/mp4') return '.mp4';
	if (mimeType === 'video/quicktime') return '.mov';
	return '.webm';
}

function smallDataUriFallback(path: string, mimeType: string) {
	if (!existsSync(path)) return null;
	const stat = statSync(path);
	if (stat.size > 1024 * 1024) return null;
	return `data:${mimeType};base64,${readFileSync(path).toString('base64')}`;
}

function normalizePlaywrightVideo(input: {
	path: string;
	hash: string;
	mediaDir: string;
	fps: number;
	sourceWidth: number;
	sourceHeight: number;
	width: number;
	height: number;
}): { path: string; staticPath: string } | null {
	const filename = `${input.hash}-normalized-v1.mp4`;
	const outputPath = join(input.mediaDir, filename);
	if (existsSync(outputPath)) return { path: outputPath, staticPath: `media/${filename}` };
	const cropWidth = Math.max(2, Math.floor((input.sourceWidth * 0.95) / 2) * 2);
	const cropHeight = Math.max(2, Math.floor((input.sourceHeight * 0.95) / 2) * 2);
	const result = spawnSync('ffmpeg', [
		'-y',
		'-loglevel',
		'error',
		'-i',
		input.path,
		'-vf',
		`crop=${cropWidth}:${cropHeight}:0:0,scale=${input.width}:${input.height},setsar=1,fps=${input.fps}`,
		'-an',
		'-c:v',
		'libx264',
		'-preset',
		'veryfast',
		'-crf',
		'18',
		'-pix_fmt',
		'yuv420p',
		'-movflags',
		'+faststart',
		outputPath,
	], { encoding: 'utf8' });
	if (result.status !== 0 || !existsSync(outputPath)) return null;
	return { path: outputPath, staticPath: `media/${filename}` };
}

export function stageSceneRenderMediaAssets(input: {
	renderRoot: string;
	renderInput: SceneRenderInput;
}): {
	renderInput: SceneRenderInput;
	publicDir: string;
	warnings: SceneDiagnostic[];
} {
	const publicDir = join(input.renderRoot, 'public');
	const mediaDir = join(publicDir, 'media');
	mkdirSync(mediaDir, { recursive: true });
	const warnings: SceneDiagnostic[] = [];
	const stagedRefs = (input.renderInput.media.videoRefs ?? []).flatMap((ref) => {
		if (ref.staticPath || ref.src) return [ref];
		try {
			if (!existsSync(ref.path)) return [];
			const bytes = readFileSync(ref.path);
			const hash = createHash('sha256').update(bytes).digest('hex');
			const filename = `${hash}${extensionFor(ref.path, ref.mimeType)}`;
			const targetPath = join(mediaDir, filename);
			if (!existsSync(targetPath)) copyFileSync(ref.path, targetPath);
			if (input.renderInput.run.capture?.evidenceFit === 'fixed-browser') {
				const source = input.renderInput.run.capture?.videoSize ?? input.renderInput.run.capture?.viewport ?? {
					width: input.renderInput.render.width,
					height: input.renderInput.render.height,
				};
				const normalized = normalizePlaywrightVideo({
					path: ref.path,
					hash,
					mediaDir,
					fps: input.renderInput.render.fps,
					sourceWidth: source.width,
					sourceHeight: source.height,
					width: input.renderInput.render.width,
					height: input.renderInput.render.height,
				});
				if (normalized) {
					return [{ ...ref, staticPath: normalized.staticPath, mimeType: 'video/mp4' as const }];
				}
				if (!normalized) {
					warnings.push(sceneWarningDiagnostic(
						'scene.render_video_normalization_failed',
						'Playwright video normalization failed; Remotion will use staged source video or screenshot fallback.',
						ref.path,
					));
				}
			}
			return [{ ...ref, staticPath: `media/${filename}` }];
		} catch (error) {
			const fallback = smallDataUriFallback(ref.path, ref.mimeType);
			if (fallback) return [{ ...ref, src: fallback }];
			warnings.push(sceneWarningDiagnostic(
				'scene.render_video_staging_failed',
				`Playwright video could not be staged for Remotion rendering and screenshots will be used if available. ${error instanceof Error ? error.message : String(error ?? '')}`.trim(),
				ref.path,
			));
			return [];
		}
	});
	return {
		publicDir,
		warnings,
		renderInput: {
			...input.renderInput,
			media: {
				...input.renderInput.media,
				videoRefs: stagedRefs,
				videoFrames: [],
				videos: stagedRefs.map((ref) => ref.staticPath ?? ref.src ?? ref.path),
			},
		},
	};
}
