import React from 'react';
import { interpolate } from 'remotion';
import { interpolateSceneMotion, renderVisualObject, visualStyle } from './remotion-visuals.ts';
import type { SceneRenderDiagram } from '../../types.ts';

const colors = {
	bg: '#0f172a',
	panel: '#172033',
	text: '#f8fafc',
	muted: '#cbd5e1',
	accent: '#38bdf8',
	success: '#22c55e',
	warning: '#f59e0b',
	error: '#ef4444',
	line: '#334155',
};

function text(value: unknown, fallback = '') {
	return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function array(value: unknown, fallback: unknown[]) {
	return Array.isArray(value) ? value : fallback;
}

function title(value: unknown) {
	return React.createElement('div', {
		style: { color: colors.text, fontSize: 46, fontWeight: 800, marginBottom: 40, maxWidth: 1500 },
	}, value);
}

function frameShell(children: React.ReactNode) {
	return React.createElement('div', {
		style: {
			width: '100%',
			height: '100%',
			background: colors.bg,
			color: colors.text,
			fontFamily: 'Inter, Arial, sans-serif',
			padding: 80,
			boxSizing: 'border-box',
			display: 'flex',
			flexDirection: 'column',
			justifyContent: 'center',
		},
	}, children);
}

function diagramShell(diagram: SceneRenderDiagram, frame: number, fps: number, children: React.ReactNode) {
	return React.createElement('div', {
		style: {
			width: '100%',
			height: '100%',
			position: 'relative',
			overflow: 'hidden',
			...visualStyle({ background: colors.bg, color: colors.text, borderWidth: 0, shadow: 'none', ...diagram.style }),
			...interpolateSceneMotion({ motion: diagram.motion, frame, fps, durationSeconds: diagram.durationSeconds }),
		},
	}, children,
	...(diagram.objects ?? []).map((object) => renderVisualObject({ object, frame, fps, durationSeconds: diagram.durationSeconds })).filter(Boolean));
}

function progress(frame: number, fps: number, durationSeconds: number) {
	return Math.max(0, Math.min(1, frame / Math.max(1, durationSeconds * fps)));
}

function OperationLifecycleDiagram(diagram: SceneRenderDiagram, frame: number, fps: number) {
	const props = diagram.props;
	const states = array(props.states, ['queued', 'claimed', 'running', 'verified', 'completed']).map((entry) => String(entry));
	const activeState = text(props.activeState);
	const pct = progress(frame, fps, diagram.durationSeconds);
	const activeIndex = activeState ? Math.max(0, states.indexOf(activeState)) : Math.min(states.length - 1, Math.floor(pct * states.length));
	return frameShell(React.createElement(React.Fragment, null,
		title(text(props.title, 'Operation lifecycle')),
		React.createElement('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${states.length}, minmax(0, 1fr))`, gap: 18, alignItems: 'center' } },
			...states.map((state, index) => {
				const active = index <= activeIndex;
				return React.createElement('div', { key: state, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 } },
					React.createElement('div', { style: { width: 86, height: 86, borderRadius: 43, background: active ? colors.success : colors.panel, border: `4px solid ${active ? colors.success : colors.line}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800 } }, String(index + 1)),
					React.createElement('div', { style: { color: active ? colors.text : colors.muted, fontSize: 24, fontWeight: active ? 800 : 600, textAlign: 'center' } }, state));
			})),
		React.createElement('div', { style: { marginTop: 46, height: 10, background: colors.line, borderRadius: 6, overflow: 'hidden' } },
			React.createElement('div', { style: { width: `${interpolate(pct, [0, 1], [0, 100])}%`, height: '100%', background: colors.accent } })),
	));
}

function ReconciliationLifecycleDiagram(diagram: SceneRenderDiagram, frame: number, fps: number) {
	const props = diagram.props;
	const stages = array(props.stages, ['refresh', 'diff', 'plan', 'validate', 'apply', 'refresh', 'verify', 'persist']).map((entry) => String(entry));
	const pct = progress(frame, fps, diagram.durationSeconds);
	const activeIndex = Math.min(stages.length - 1, Math.floor(pct * stages.length));
	return frameShell(React.createElement(React.Fragment, null,
		title(text(props.title, 'Reconciliation lifecycle')),
		React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 18 } },
			...stages.map((stage, index) => {
				const active = index <= activeIndex;
				return React.createElement('div', { key: `${stage}-${index}`, style: { minHeight: 132, border: `2px solid ${active ? colors.accent : colors.line}`, borderRadius: 8, padding: 22, background: active ? '#123044' : colors.panel } },
					React.createElement('div', { style: { color: active ? colors.accent : colors.muted, fontSize: 18, fontWeight: 800 } }, `0${index + 1}`.slice(-2)),
					React.createElement('div', { style: { marginTop: 14, fontSize: 28, fontWeight: 800 } }, stage));
			})),
		React.createElement('div', { style: { marginTop: 38, color: colors.muted, fontSize: 24 } }, `Current stage: ${stages[activeIndex] ?? stages[0]}`),
	));
}

function DevRuntimeTopologyDiagram(diagram: SceneRenderDiagram, frame: number, fps: number) {
	const props = diagram.props;
	const surfaces = array(props.surfaces, []).map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : {});
	const links = array(props.links, []).map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : {});
	const pct = progress(frame, fps, diagram.durationSeconds);
	return frameShell(React.createElement(React.Fragment, null,
		title(text(props.title, 'Managed dev topology')),
		React.createElement('div', { style: { display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, surfaces.length)}, minmax(0, 1fr))`, gap: 32, alignItems: 'center' } },
			...surfaces.map((surface, index) => React.createElement('div', { key: String(surface.id ?? index), style: { border: `3px solid ${colors.accent}`, background: colors.panel, borderRadius: 8, padding: 28, minHeight: 180 } },
				React.createElement('div', { style: { fontSize: 34, fontWeight: 800 } }, text(surface.label, String(surface.id ?? `surface-${index}`))),
				React.createElement('div', { style: { marginTop: 16, fontSize: 22, color: colors.muted } }, text(surface.kind, 'service'))))),
		React.createElement('div', { style: { marginTop: 42, display: 'grid', gap: 14 } },
			...links.map((link, index) => React.createElement('div', { key: index, style: { color: index / Math.max(1, links.length) <= pct ? colors.success : colors.muted, fontSize: 24 } }, `${text(link.from)} -> ${text(link.to)}${link.label ? ` (${text(link.label)})` : ''}`))),
	));
}

function SceneExecutionTimelineDiagram(diagram: SceneRenderDiagram, frame: number, fps: number) {
	const props = diagram.props;
	const steps = array(props.steps, []).map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : {});
	const chapters = array(props.chapters, []).map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : {});
	const checkpoints = array(props.checkpoints, []).map((entry) => entry && typeof entry === 'object' ? entry as Record<string, unknown> : {});
	const pct = progress(frame, fps, diagram.durationSeconds);
	const visibleSteps = Math.max(1, Math.ceil(pct * Math.max(1, steps.length)));
	return frameShell(React.createElement(React.Fragment, null,
		title(text(props.title, 'Scene execution timeline')),
		React.createElement('div', { style: { display: 'grid', gap: 16 } },
			...steps.slice(0, visibleSteps).map((step, index) => {
				const failed = step.id === props.failedStep || step.status === 'failed';
				return React.createElement('div', { key: String(step.id ?? index), style: { display: 'grid', gridTemplateColumns: '80px 1fr 180px', gap: 18, alignItems: 'center', color: colors.text } },
					React.createElement('div', { style: { color: failed ? colors.error : colors.accent, fontSize: 22, fontWeight: 800 } }, `#${index + 1}`),
					React.createElement('div', { style: { borderLeft: `5px solid ${failed ? colors.error : colors.success}`, background: colors.panel, borderRadius: 8, padding: 18 } },
						React.createElement('div', { style: { fontSize: 24, fontWeight: 800 } }, text(step.title, String(step.id ?? 'step'))),
						React.createElement('div', { style: { marginTop: 8, color: colors.muted, fontSize: 17 } }, String(step.id ?? ''))),
					React.createElement('div', { style: { color: failed ? colors.error : colors.success, fontSize: 20, fontWeight: 800 } }, text(step.status, 'planned')));
			})),
		React.createElement('div', { style: { marginTop: 30, display: 'flex', gap: 28, color: colors.muted, fontSize: 22 } },
			React.createElement('span', null, `${chapters.length} chapters`),
			React.createElement('span', null, `${array(props.segments, []).length} segments`),
			React.createElement('span', null, `${checkpoints.length} checkpoints`)),
	));
}

export function renderSceneDiagram(input: {
	diagram: SceneRenderDiagram;
	frame: number;
	fps: number;
	width: number;
	height: number;
}): React.ReactElement {
	const content = input.diagram.kind === 'operation-lifecycle'
		? OperationLifecycleDiagram(input.diagram, input.frame, input.fps)
		: input.diagram.kind === 'reconciliation-lifecycle'
		? ReconciliationLifecycleDiagram(input.diagram, input.frame, input.fps)
		: input.diagram.kind === 'dev-runtime-topology'
			? DevRuntimeTopologyDiagram(input.diagram, input.frame, input.fps)
			: SceneExecutionTimelineDiagram(input.diagram, input.frame, input.fps);
	return diagramShell(input.diagram, input.frame, input.fps, content);
}
