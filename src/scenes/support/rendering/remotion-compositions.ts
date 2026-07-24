import React from 'react';
import {
	AbsoluteFill,
	Composition,
	Img,
	Sequence,
	Video,
	interpolate,
	registerRoot,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from 'remotion';
import { renderSceneDiagram } from './remotion-diagrams.ts';
import { interpolateSceneMotion, renderVisualObject, resolveVisualRegion, SceneVideoTheme, visualStyle } from './remotion-visuals.ts';
import type { SceneRenderInput } from '../../types.ts';

function titleCard(input: SceneRenderInput, subtitle: string) {
	return React.createElement(AbsoluteFill, {
		style: {
			backgroundColor: '#0f172a',
			color: 'white',
			fontFamily: 'Inter, Arial, sans-serif',
			justifyContent: 'center',
			padding: 96,
		},
	}, React.createElement('div', { style: { fontSize: 56, fontWeight: 700, lineHeight: 1.08 } }, input.scene.title),
	React.createElement('div', { style: { marginTop: 24, fontSize: 26, color: '#bfdbfe', maxWidth: 1200 } }, subtitle),
	React.createElement('div', { style: { marginTop: 48, fontSize: 18, color: '#94a3b8' } }, `Scene ${input.scene.id} · Run ${input.run.runId ?? 'unknown'}`));
}

export function SceneRenderLayout(input: SceneRenderInput) {
	const fps = input.render.fps;
	const introFrames = input.render.introFrames ?? Math.min(90, Math.floor(fps * 3));
	const interstitialFrames = input.render.interstitialFrames ?? input.renderDiagrams
		.filter((entry) => entry.placement !== 'overlay')
		.reduce((sum, diagram) => sum + Math.max(1, Math.ceil(diagram.durationSeconds * fps)), 0);
	const evidenceStartFrame = input.render.evidenceStartFrame ?? introFrames + interstitialFrames;
	const evidenceDurationInFrames = input.render.evidenceDurationInFrames ?? Math.max(1, input.render.durationInFrames - evidenceStartFrame);
	return { introFrames, interstitialFrames, evidenceStartFrame, evidenceDurationInFrames };
}

export function resolveEvidenceViewport(input: SceneRenderInput): {
	width: number;
	height: number;
	scale: number;
	left: number;
	top: number;
} {
	const source = input.run.capture?.videoSize ?? input.run.capture?.viewport ?? input.scene.render.remotion?.capture?.video ?? input.scene.render.remotion?.capture?.viewport ?? { width: input.render.width, height: input.render.height };
	const availableWidth = Math.max(1, input.render.width);
	const availableHeight = Math.max(1, input.render.height);
	const scale = Math.min(availableWidth / source.width, availableHeight / source.height);
	const width = Math.round(source.width * scale);
	const height = Math.round(source.height * scale);
	return {
		width,
		height,
		scale,
		left: Math.round((input.render.width - width) / 2),
		top: Math.round((input.render.height - height) / 2),
	};
}

function eventStepOffset(input: SceneRenderInput, stepId: string, type: 'step.start' | 'step.end') {
	return input.timeline.find((event) => event.type === type && event.stepId === stepId)?.offsetMs ?? null;
}

function stepAtEvidenceMs(input: SceneRenderInput, evidenceMs: number) {
	let fallback = input.run.steps[0] ?? null;
	for (const step of input.run.steps) {
		const start = eventStepOffset(input, step.id, 'step.start');
		const end = eventStepOffset(input, step.id, 'step.end');
		if (start !== null && start <= evidenceMs) fallback = step;
		if (start !== null && start <= evidenceMs && (end === null || evidenceMs <= end)) return step;
	}
	return fallback;
}

function stepStartMs(input: SceneRenderInput, stepId: string) {
	const timelineStart = eventStepOffset(input, stepId, 'step.start');
	if (timelineStart !== null) return timelineStart;
	const index = input.run.steps.findIndex((step) => step.id === stepId);
	if (index < 0) return null;
	return Math.floor((index / Math.max(1, input.run.steps.length)) * Math.max(1, input.run.durationMs));
}

function evidenceTimelineOffsetMs(input: SceneRenderInput) {
	if (!input.media.videoRefs?.length && input.media.videos.length === 0) return 0;
	const firstStep = input.run.steps[0];
	if (!firstStep) return 0;
	return eventStepOffset(input, firstStep.id, 'step.start') ?? 0;
}

function evidenceSourceMs(input: SceneRenderInput, frame: number) {
	const evidenceMs = Math.floor((frame / Math.max(1, input.render.fps)) * 1000);
	return evidenceMs + evidenceTimelineOffsetMs(input);
}

function activeOverlayText(input: SceneRenderInput, evidenceMs: number) {
	const overlays = input.overlays.filter((overlay) => overlay.text);
	return overlays.find((overlay) => {
		const start = stepStartMs(input, overlay.at);
		return start !== null && evidenceMs >= start && evidenceMs <= start + 6000;
	}) ?? null;
}

function activeOverlayDiagram(input: SceneRenderInput, evidenceMs: number) {
	const diagrams = input.renderDiagrams.filter((diagram) => diagram.placement === 'overlay');
	return diagrams.find((diagram) => {
		const start = diagram.startOffsetMs ?? stepStartMs(input, diagram.at);
		return start !== null && evidenceMs >= start && evidenceMs <= start + diagram.durationSeconds * 1000;
	}) ?? null;
}

function activeInterstitialDiagram(input: SceneRenderInput, frame: number) {
	let cursor = 0;
	for (const diagram of input.renderDiagrams.filter((entry) => entry.placement !== 'overlay')) {
		const duration = Math.max(1, Math.ceil(diagram.durationSeconds * input.render.fps));
		if (frame >= cursor && frame < cursor + duration) {
			return { diagram, frame: frame - cursor };
		}
		cursor += duration;
	}
	return null;
}

function EvidenceFrame({ input, durationFrames }: { input: SceneRenderInput; durationFrames: number }) {
	const frame = useCurrentFrame();
	const viewport = resolveEvidenceViewport(input);
	const frameStyle = {
		position: 'absolute' as const,
		left: viewport.left,
		top: viewport.top,
		width: viewport.width,
		height: viewport.height,
		overflow: 'hidden',
		backgroundColor: '#111827',
		boxShadow: viewport.left === 0 && viewport.top === 0 ? 'none' : '0 24px 70px rgba(0,0,0,0.38)',
	};
	const videoFrames = input.media.videoFrames ?? [];
	if (videoFrames.length > 0) {
		const frameEntry = videoFrames[Math.min(videoFrames.length - 1, Math.max(0, frame))] ?? videoFrames[0]!;
		return React.createElement('div', { style: frameStyle }, React.createElement(Img, {
			src: staticFile(frameEntry.staticPath),
			style: {
				position: 'absolute',
				inset: 0,
				display: 'block',
				width: '100%',
				height: '100%',
				objectFit: 'fill',
				backgroundColor: '#111827',
			},
		}));
	}
	const videoRef = input.media.videoRefs?.[0];
	const videoSrc = videoRef?.staticPath ? staticFile(videoRef.staticPath) : videoRef?.src ?? input.media.videos[0];
	if (videoSrc) {
		return React.createElement('div', { style: frameStyle }, React.createElement(Video, {
			src: videoSrc,
			muted: true,
			style: {
				position: 'absolute',
				inset: 0,
				display: 'block',
				width: '100%',
				height: '100%',
				minWidth: '100%',
				minHeight: '100%',
				maxWidth: 'none',
				maxHeight: 'none',
				objectFit: input.run.capture?.evidenceFit === 'cover' ? 'cover' : 'fill',
				backgroundColor: '#111827',
			},
		}));
	}
	const screenshots = [...input.media.screenshots].sort((a, b) => (a.offsetMs ?? Number.MAX_SAFE_INTEGER) - (b.offsetMs ?? Number.MAX_SAFE_INTEGER));
	if (screenshots.length === 0) {
		return React.createElement('div', { style: { color: 'white', fontSize: 36 } }, 'No browser media available');
	}
	const evidenceMs = evidenceSourceMs(input, frame);
	const timed = screenshots.find((screenshot, index) => {
		const start = screenshot.offsetMs ?? null;
		const next = screenshots[index + 1]?.offsetMs ?? Number.MAX_SAFE_INTEGER;
		return start !== null && evidenceMs >= start && evidenceMs < next;
	});
	const screenshotIndex = Math.min(screenshots.length - 1, Math.floor((frame / Math.max(1, durationFrames)) * screenshots.length));
	const screenshot = timed ?? screenshots[screenshotIndex];
	const objectFit = screenshot.captureKind === 'full-page' ? 'cover' : 'contain';
	return React.createElement('div', { style: frameStyle }, React.createElement(Img, {
		src: screenshot.src ?? screenshot.path,
		style: {
			width: '100%',
			height: '100%',
			objectFit: screenshot.captureKind === 'viewport' ? 'fill' : objectFit,
			objectPosition: screenshot.captureKind === 'full-page' ? 'top center' : 'center center',
			backgroundColor: '#111827',
		},
	}));
}

function BrowserFrame({ input }: { input: SceneRenderInput }) {
	if (input.scene.render.remotion?.browserFrame?.enabled !== true) return null;
	const viewport = resolveEvidenceViewport(input);
	return React.createElement('div', {
		style: {
			position: 'absolute',
			left: viewport.left,
			top: viewport.top,
			width: viewport.width,
			height: 34,
			background: 'rgba(15,23,42,0.84)',
			borderBottom: '1px solid rgba(148,163,184,0.32)',
			display: 'flex',
			alignItems: 'center',
			gap: 8,
			padding: '0 12px',
			boxSizing: 'border-box',
			fontFamily: 'Inter, Arial, sans-serif',
			color: '#cbd5e1',
			fontSize: 13,
			pointerEvents: 'none',
		},
	}, React.createElement('div', { style: { display: 'flex', gap: 6 } },
		React.createElement('span', { style: { width: 9, height: 9, borderRadius: 999, background: '#ef4444', display: 'block' } }),
		React.createElement('span', { style: { width: 9, height: 9, borderRadius: 999, background: '#f59e0b', display: 'block' } }),
		React.createElement('span', { style: { width: 9, height: 9, borderRadius: 999, background: '#22c55e', display: 'block' } }),
	), React.createElement('div', {
		style: {
			flex: 1,
			height: 22,
			borderRadius: 999,
			background: 'rgba(255,255,255,0.12)',
			display: 'flex',
			alignItems: 'center',
			padding: '0 12px',
			overflow: 'hidden',
			whiteSpace: 'nowrap',
			textOverflow: 'ellipsis',
		},
	}, input.scene.render.remotion.browserFrame.title ?? input.run.baseUrl ?? input.scene.target.baseUrl));
}

function LowerThird({ input }: { input: SceneRenderInput }) {
	const frame = useCurrentFrame();
	const evidenceMs = evidenceSourceMs(input, frame);
	const step = stepAtEvidenceMs(input, evidenceMs);
	if (!step) return null;
	return React.createElement('div', {
		style: {
			position: 'absolute',
			left: 48,
			bottom: 42,
			background: 'rgba(15, 23, 42, 0.86)',
			color: 'white',
			borderRadius: 6,
			padding: '16px 20px',
			fontFamily: 'Inter, Arial, sans-serif',
			maxWidth: 980,
			boxShadow: '0 16px 40px rgba(0,0,0,0.25)',
		},
	}, React.createElement('div', { style: { fontSize: 17, color: '#93c5fd', textTransform: 'uppercase' } }, step.id),
	React.createElement('div', { style: { fontSize: 26, fontWeight: 700, marginTop: 4 } }, step.title));
}

function CaptionOverlay({ input }: { input: SceneRenderInput }) {
	const frame = useCurrentFrame();
	if (input.render.mode !== 'training' || input.scene.training?.captions?.renderInTrainingVideo === false || input.training.captions.length === 0) return null;
	const ms = evidenceSourceMs(input, frame);
	const cue = input.training.captions.find((entry) => ms >= entry.startMs && ms <= entry.endMs);
	if (!cue) return null;
	return React.createElement('div', {
		style: {
			position: 'absolute',
			left: '50%',
			bottom: 132,
			transform: 'translateX(-50%)',
			width: 1040,
			maxWidth: '82%',
			minHeight: 64,
			background: 'rgba(15, 23, 42, 0.88)',
			color: '#f8fafc',
			border: '1px solid rgba(56,189,248,0.36)',
			borderRadius: 8,
			padding: '14px 22px',
			fontFamily: 'Inter, Arial, sans-serif',
			fontSize: 26,
			lineHeight: 1.22,
			textAlign: 'center',
			boxShadow: '0 18px 42px rgba(0,0,0,0.34)',
		},
	}, React.createElement('span', { style: { color: '#38bdf8', marginRight: 10 } }, 'Training'),
	React.createElement('span', null, cue.text));
}

function Callouts({ input }: { input: SceneRenderInput }) {
	const frame = useCurrentFrame();
	const evidenceMs = evidenceSourceMs(input, frame);
	const overlay = activeOverlayText(input, evidenceMs);
	if (!overlay?.text) return null;
	const start = stepStartMs(input, overlay.at) ?? evidenceMs;
	const localFrame = Math.max(0, Math.floor(((evidenceMs - start) / 1000) * input.render.fps));
	const durationSeconds = overlay.durationSeconds ?? 6;
	const opacity = overlay.motion
		? undefined
		: interpolate(localFrame, [0, 20, Math.max(21, durationSeconds * input.render.fps - 20), Math.max(22, durationSeconds * input.render.fps)], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const regionStyle = overlay.position ? { position: 'absolute' as const, left: overlay.position.unit === 'percent' ? `${overlay.position.x}%` : overlay.position.x, top: overlay.position.unit === 'percent' ? `${overlay.position.y}%` : overlay.position.y } : resolveVisualRegion(overlay.region ?? (overlay.variant === 'lower-third' ? 'bottom-left' : 'top-right'), 48);
	const sizeStyle = overlay.size ? { width: overlay.size.unit === 'percent' ? `${overlay.size.width}%` : overlay.size.width, height: overlay.size.unit === 'percent' ? `${overlay.size.height}%` : overlay.size.height } : {};
	const variant = overlay.variant ?? (overlay.type === 'callout' ? 'callout' : 'panel');
	const variantStyle = variant === 'badge'
		? { width: 'auto', maxWidth: 520, padding: '10px 14px', borderRadius: 999, fontSize: 18, fontWeight: 800 }
		: variant === 'label'
			? { width: 360, padding: '14px 16px', fontSize: 20, fontWeight: 700 }
			: variant === 'lower-third'
				? { width: 720, padding: '18px 22px', fontSize: 24, fontWeight: 700 }
				: { width: 480, padding: 24, fontSize: 24, fontWeight: 500 };
	return React.createElement('div', {
		style: {
			...regionStyle,
			...variantStyle,
			...sizeStyle,
			...visualStyle({ tone: overlay.style?.tone ?? 'neutral', ...overlay.style }),
			borderLeftWidth: variant === 'callout' || variant === 'panel' ? 5 : overlay.style?.borderWidth ?? 1,
			fontFamily: 'Inter, Arial, sans-serif',
			lineHeight: 1.3,
			opacity,
			boxSizing: 'border-box',
			overflow: 'hidden',
			...interpolateSceneMotion({ motion: overlay.motion, frame: localFrame, fps: input.render.fps, durationSeconds }),
		},
	}, React.createElement('div', {
		style: { color: overlay.style?.color ?? SceneVideoTheme.text, whiteSpace: 'pre-wrap' },
	}, overlay.text),
	...(overlay.objects ?? []).map((object) => renderVisualObject({ object, frame: localFrame, fps: input.render.fps, durationSeconds })).filter(Boolean));
}

function OverlayDiagram({ input }: { input: SceneRenderInput }) {
	const frame = useCurrentFrame();
	const evidenceMs = evidenceSourceMs(input, frame);
	const diagram = activeOverlayDiagram(input, evidenceMs);
	if (!diagram) return null;
	const start = diagram.startOffsetMs ?? stepStartMs(input, diagram.at) ?? evidenceMs;
	const diagramFrame = Math.max(0, Math.floor(((evidenceMs - start) / 1000) * input.render.fps));
	return React.createElement('div', {
		style: {
			position: 'absolute',
			right: 44,
			bottom: 132,
			width: 520,
			height: 292,
			...visualStyle({ tone: diagram.style?.tone ?? 'info', background: '#0f172a', ...diagram.style }),
			border: `${diagram.style?.borderWidth ?? 1}px solid ${diagram.style?.borderColor ?? 'rgba(56,189,248,0.45)'}`,
			borderRadius: diagram.style?.radius ?? 8,
			overflow: 'hidden',
			...interpolateSceneMotion({ motion: diagram.motion, frame: diagramFrame, fps: input.render.fps, durationSeconds: diagram.durationSeconds }),
		},
	}, renderSceneDiagram({ diagram, frame: diagramFrame, fps: input.render.fps, width: 520, height: 292 }));
}

function ChapterBanner({ input }: { input: SceneRenderInput }) {
	const frame = useCurrentFrame();
	if (input.chapters.length === 0) return null;
	const evidenceMs = evidenceSourceMs(input, frame);
	const step = stepAtEvidenceMs(input, evidenceMs);
	const chapter = step ? input.chapters.find((entry) => entry.stepIds.includes(step.id)) ?? input.chapters[0] : input.chapters[0];
	const viewport = resolveEvidenceViewport(input);
	const hasBrowserFrame = input.scene.render.remotion?.browserFrame?.enabled === true;
	return React.createElement('div', {
		style: {
			position: 'absolute',
			left: hasBrowserFrame ? viewport.left + 24 : 48,
			top: hasBrowserFrame ? viewport.top + 48 : 38,
			color: '#e0f2fe',
			fontFamily: 'Inter, Arial, sans-serif',
			fontSize: 20,
			fontWeight: 700,
			textShadow: '0 2px 12px rgba(0,0,0,0.5)',
		},
	}, chapter.title);
}

function renderShell(input: SceneRenderInput, subtitle: string) {
	const config = useVideoConfig();
	const layout = SceneRenderLayout(input);
	return React.createElement(AbsoluteFill, { style: { backgroundColor: '#111827' } },
		layout.introFrames > 0
			? React.createElement(Sequence, { from: 0, durationInFrames: layout.introFrames }, titleCard(input, subtitle))
			: null,
		layout.interstitialFrames > 0
			? React.createElement(Sequence, { from: layout.introFrames, durationInFrames: layout.interstitialFrames }, React.createElement(InterstitialDiagrams, { input, width: config.width, height: config.height }))
			: null,
		React.createElement(Sequence, { from: layout.evidenceStartFrame, durationInFrames: layout.evidenceDurationInFrames },
			React.createElement(EvidenceFrame, { input, durationFrames: layout.evidenceDurationInFrames }),
			React.createElement(BrowserFrame, { input }),
			React.createElement(ChapterBanner, { input }),
			React.createElement(LowerThird, { input }),
			React.createElement(CaptionOverlay, { input }),
			React.createElement(Callouts, { input }),
			React.createElement(OverlayDiagram, { input })));
}

function InterstitialDiagrams({ input, width, height }: { input: SceneRenderInput; width: number; height: number }) {
	const frame = useCurrentFrame();
	const diagram = activeInterstitialDiagram(input, frame);
	if (!diagram) return null;
	return renderSceneDiagram({ diagram: diagram.diagram, frame: diagram.frame, fps: input.render.fps, width, height });
}

function DemoDefault(input: SceneRenderInput) {
	return renderShell(input, 'Workflow evidence rendered from scene timeline artifacts.');
}

function TrainingDefault(input: SceneRenderInput) {
	return renderShell(input, input.scene.description ?? 'Training walkthrough rendered from reusable scene evidence.');
}

function FailureReview(input: SceneRenderInput) {
	const failed = input.run.steps.find((step) => step.id === input.run.failedStep);
	return renderShell(input, failed?.error ? `${failed.id}: ${failed.error.message}` : 'Failure review from scene evidence.');
}

function DiagramOnly(input: SceneRenderInput) {
	const frame = useCurrentFrame();
	const config = useVideoConfig();
	const diagrams = input.renderDiagrams;
	if (diagrams.length === 0) {
		return React.createElement(AbsoluteFill, { style: { backgroundColor: '#0f172a', color: '#f8fafc', fontFamily: 'Inter, Arial, sans-serif', justifyContent: 'center', alignItems: 'center', fontSize: 34 } }, 'No validated diagrams available');
	}
	let cursor = 0;
	for (const diagram of diagrams) {
		const duration = Math.max(1, Math.ceil(diagram.durationSeconds * input.render.fps));
		if (frame >= cursor && frame < cursor + duration) {
			return renderSceneDiagram({ diagram, frame: frame - cursor, fps: input.render.fps, width: config.width, height: config.height });
		}
		cursor += duration;
	}
	const last = diagrams[diagrams.length - 1]!;
	return renderSceneDiagram({ diagram: last, frame: Math.max(0, Math.ceil(last.durationSeconds * input.render.fps) - 1), fps: input.render.fps, width: config.width, height: config.height });
}

export function SceneRemotionRoot() {
	const defaultProps = {
		schemaVersion: 'treeseed.scene.render-input/v1',
		scene: { id: 'treeseed-render-preview', title: 'Treeseed Scene Render Preview', description: '', audience: [], workflow: [], chapters: [], overlays: [], diagrams: [], runtime: { mode: 'demo' }, render: {} },
		run: { runId: 'treeseed-render-preview', steps: [], workflowStatus: 'passed', durationMs: 8000, renderedVideoPaths: [] },
		timeline: [],
		chapters: [],
		segments: [],
		checkpoints: [],
		overlays: [],
		diagrams: [],
		renderDiagrams: [],
		training: { captions: [], transcript: [], narration: [], glossary: [], chapterClips: [] },
		media: { videos: [], screenshots: [] },
		render: { mode: 'demo', composition: 'treeseed-demo-default', fps: 30, width: 1920, height: 1080, durationInFrames: 240, format: 'mp4' },
	} as unknown as SceneRenderInput;
	const compositions = [
		['treeseed-demo-default', DemoDefault],
		['treeseed-training-default', TrainingDefault],
		['treeseed-failure-review', FailureReview],
		['treeseed-diagram-only', DiagramOnly],
	] as const;
	return React.createElement(React.Fragment, null, ...compositions.map(([id, component]) => React.createElement(Composition, {
		key: id,
		id,
		component,
		durationInFrames: defaultProps.render.durationInFrames,
		fps: defaultProps.render.fps,
		width: defaultProps.render.width,
		height: defaultProps.render.height,
		defaultProps,
		calculateMetadata: ({ props }: { props: SceneRenderInput }) => ({
			durationInFrames: props.render.durationInFrames,
			fps: props.render.fps,
			width: props.render.width,
			height: props.render.height,
		}),
	})));
}

registerRoot(SceneRemotionRoot);
