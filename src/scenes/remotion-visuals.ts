import React from 'react';
import { interpolate } from 'remotion';
import type {
	TreeseedSceneMotion,
	TreeseedSceneVisualObject,
	TreeseedSceneVisualPoint,
	TreeseedSceneVisualRegion,
	TreeseedSceneVisualSize,
	TreeseedSceneVisualStyle,
} from './types.ts';

export const treeseedSceneVideoTheme = {
	bg: '#0f172a',
	panel: 'rgba(15,23,42,0.88)',
	panelSolid: '#172033',
	text: '#f8fafc',
	muted: '#cbd5e1',
	accent: '#38bdf8',
	success: '#22c55e',
	warning: '#f59e0b',
	danger: '#ef4444',
	brand: '#14b8a6',
	line: 'rgba(148,163,184,0.42)',
};

function unitValue(value: number, unit?: string) {
	return unit === 'percent' ? `${value}%` : value;
}

function pointStyle(point?: TreeseedSceneVisualPoint): React.CSSProperties {
	if (!point) return {};
	return { left: unitValue(point.x, point.unit), top: unitValue(point.y, point.unit) };
}

function sizeStyle(size?: TreeseedSceneVisualSize): React.CSSProperties {
	if (!size) return {};
	return { width: unitValue(size.width, size.unit), height: unitValue(size.height, size.unit) };
}

export function resolveVisualRegion(region: TreeseedSceneVisualRegion | undefined, margin = 48): React.CSSProperties {
	const common: React.CSSProperties = { position: 'absolute' };
	if (region === 'top-left') return { ...common, left: margin, top: margin };
	if (region === 'top') return { ...common, left: '50%', top: margin, transform: 'translateX(-50%)' };
	if (region === 'top-right' || !region) return { ...common, right: margin, top: margin };
	if (region === 'left') return { ...common, left: margin, top: '50%', transform: 'translateY(-50%)' };
	if (region === 'center') return { ...common, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
	if (region === 'right') return { ...common, right: margin, top: '50%', transform: 'translateY(-50%)' };
	if (region === 'bottom-left') return { ...common, left: margin, bottom: margin };
	if (region === 'bottom') return { ...common, left: '50%', bottom: margin, transform: 'translateX(-50%)' };
	return { ...common, right: margin, bottom: margin };
}

function toneColors(style?: TreeseedSceneVisualStyle) {
	if (style?.tone === 'success') return { accent: treeseedSceneVideoTheme.success, background: 'rgba(20,83,45,0.88)' };
	if (style?.tone === 'warning') return { accent: treeseedSceneVideoTheme.warning, background: 'rgba(120,53,15,0.9)' };
	if (style?.tone === 'danger') return { accent: treeseedSceneVideoTheme.danger, background: 'rgba(127,29,29,0.9)' };
	if (style?.tone === 'brand') return { accent: treeseedSceneVideoTheme.brand, background: 'rgba(19,78,74,0.9)' };
	if (style?.tone === 'info') return { accent: treeseedSceneVideoTheme.accent, background: 'rgba(12,74,110,0.9)' };
	return { accent: treeseedSceneVideoTheme.accent, background: treeseedSceneVideoTheme.panel };
}

export function visualStyle(style?: TreeseedSceneVisualStyle): React.CSSProperties {
	const colors = toneColors(style);
	const shadow = style?.shadow === 'none' ? 'none'
		: style?.shadow === 'strong' ? '0 28px 80px rgba(0,0,0,0.44)'
			: style?.shadow === 'soft' ? '0 10px 24px rgba(0,0,0,0.18)'
				: '0 18px 46px rgba(0,0,0,0.28)';
	return {
		background: style?.background ?? colors.background,
		color: style?.color ?? treeseedSceneVideoTheme.text,
		borderColor: style?.borderColor ?? colors.accent,
		borderStyle: 'solid',
		borderWidth: style?.borderWidth ?? 1,
		borderRadius: style?.radius ?? 10,
		boxShadow: shadow,
		opacity: style?.opacity ?? 1,
	};
}

function easing(value: string | undefined) {
	if (value === 'ease-in') return (t: number) => t * t;
	if (value === 'ease-out') return (t: number) => 1 - (1 - t) * (1 - t);
	if (value === 'ease' || value === 'ease-in-out') return (t: number) => t * t * (3 - 2 * t);
	return (t: number) => t;
}

export function interpolateSceneMotion(input: {
	motion?: TreeseedSceneMotion;
	frame: number;
	fps: number;
	durationSeconds: number;
}): React.CSSProperties {
	const motion = input.motion;
	if (!motion || motion.keyframes.length === 0) return {};
	const durationFrames = Math.max(1, Math.ceil(input.durationSeconds * input.fps));
	const frame = motion.loop ? input.frame % durationFrames : Math.min(input.frame, durationFrames);
	const currentSeconds = frame / Math.max(1, input.fps);
	const normalized = frame / durationFrames;
	const keyframes = [...motion.keyframes].sort((a, b) => a.at - b.at);
	const frameAt = (at: number, unit?: string) => unit === 'progress' ? at : at / Math.max(0.001, input.durationSeconds);
	const progress = keyframes[0]?.unit === 'progress' ? normalized : currentSeconds / Math.max(0.001, input.durationSeconds);
	let previous = keyframes[0]!;
	let next = keyframes[keyframes.length - 1]!;
	for (let index = 0; index < keyframes.length - 1; index += 1) {
		const a = keyframes[index]!;
		const b = keyframes[index + 1]!;
		const start = frameAt(a.at, a.unit);
		const end = frameAt(b.at, b.unit);
		if (progress >= start && progress <= end) {
			previous = a;
			next = b;
			break;
		}
	}
	const start = frameAt(previous.at, previous.unit);
	const end = frameAt(next.at, next.unit);
	const raw = end === start ? 1 : Math.max(0, Math.min(1, (progress - start) / (end - start)));
	const t = easing(next.easing ?? previous.easing)(raw);
	const mix = (a: number | undefined, b: number | undefined, fallback: number) => interpolate(t, [0, 1], [a ?? fallback, b ?? a ?? fallback]);
	const style: React.CSSProperties = {};
	if (previous.position || next.position) {
		const from = previous.position ?? next.position!;
		const to = next.position ?? previous.position!;
		style.left = unitValue(mix(from.x, to.x, from.x), to.unit ?? from.unit);
		style.top = unitValue(mix(from.y, to.y, from.y), to.unit ?? from.unit);
	}
	if (previous.size || next.size) {
		const from = previous.size ?? next.size!;
		const to = next.size ?? previous.size!;
		style.width = unitValue(mix(from.width, to.width, from.width), to.unit ?? from.unit);
		style.height = unitValue(mix(from.height, to.height, from.height), to.unit ?? from.unit);
	}
	if (previous.opacity !== undefined || next.opacity !== undefined) style.opacity = mix(previous.opacity, next.opacity, previous.opacity ?? 1);
	const scale = mix(previous.scale, next.scale, previous.scale ?? 1);
	const rotate = mix(previous.rotateDeg, next.rotateDeg, previous.rotateDeg ?? 0);
	style.transform = `scale(${scale}) rotate(${rotate}deg)`;
	return style;
}

export function renderTreeseedVisualObject(input: {
	object: TreeseedSceneVisualObject;
	frame: number;
	fps: number;
	durationSeconds: number;
}): React.ReactElement | null {
	const object = input.object;
	const base: React.CSSProperties = {
		position: 'absolute',
		...resolveVisualRegion(object.region, 0),
		...pointStyle(object.position),
		...sizeStyle(object.size),
		...visualStyle(object.style),
		...interpolateSceneMotion({ motion: object.motion, frame: input.frame, fps: input.fps, durationSeconds: input.durationSeconds }),
		boxSizing: 'border-box',
		fontFamily: 'Inter, Arial, sans-serif',
		pointerEvents: 'none',
	};
	if (object.type === 'text' || object.type === 'badge') {
		return React.createElement('div', {
			key: object.id,
			style: {
				...base,
				padding: object.type === 'badge' ? '8px 12px' : '12px 16px',
				fontSize: object.type === 'badge' ? 18 : 24,
				fontWeight: 800,
				whiteSpace: 'pre-wrap',
			},
		}, object.text ?? object.id);
	}
	if (object.type === 'circle' || object.type === 'spotlight') {
		return React.createElement('div', { key: object.id, style: { ...base, borderRadius: 999, background: object.type === 'spotlight' ? 'rgba(56,189,248,0.12)' : base.background } });
	}
	if (object.type === 'line' || object.type === 'arrow') {
		const from = object.from ?? object.position ?? { x: 0, y: 0 };
		const to = object.to ?? { x: from.x + 160, y: from.y };
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const length = Math.sqrt(dx * dx + dy * dy);
		const angle = Math.atan2(dy, dx) * 180 / Math.PI;
		return React.createElement('div', {
			key: object.id,
			style: {
				position: 'absolute',
				left: unitValue(from.x, from.unit),
				top: unitValue(from.y, from.unit),
				width: length,
				height: object.style?.borderWidth ?? 4,
				background: object.style?.color ?? object.style?.borderColor ?? treeseedSceneVideoTheme.accent,
				transformOrigin: '0 50%',
				transform: `rotate(${angle}deg)`,
				boxShadow: '0 0 18px rgba(56,189,248,0.4)',
			},
		}, object.type === 'arrow' ? React.createElement('span', {
			style: {
				position: 'absolute',
				right: -2,
				top: -7,
				width: 0,
				height: 0,
				borderTop: '8px solid transparent',
				borderBottom: '8px solid transparent',
				borderLeft: `14px solid ${object.style?.color ?? object.style?.borderColor ?? treeseedSceneVideoTheme.accent}`,
			},
		}) : null);
	}
	if (object.type === 'cursor') {
		return React.createElement('div', {
			key: object.id,
			style: {
				...base,
				width: object.size?.width ?? 28,
				height: object.size?.height ?? 28,
				background: 'transparent',
				border: 0,
				boxShadow: 'none',
				color: object.style?.color ?? treeseedSceneVideoTheme.text,
				fontSize: 30,
			},
		}, '▸');
	}
	return React.createElement('div', { key: object.id, style: base });
}
