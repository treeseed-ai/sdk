import type { AgentLabPresentation,AgentLabPresentationAdapter,AgentLabSnapshot } from '../types.ts';
import { sanitizeAgentLabSnapshot } from './report-model.ts';
import { simulationViewerRuntime } from './viewer/runtime.ts';
import { simulationViewerStyles } from './viewer/styles.ts';

const skins = {
	'race-control': { label: 'Race Control', description: 'Live Lab / Race Control', accent: '#d8ff45', accent2: '#45d7ff' },
	'strategy-command': { label: 'Strategy Command', description: 'AI Lab / Strategic Field', accent: '#70f5b0', accent2: '#ffc857' },
	'esports-tournament': { label: 'Esports Tournament', description: 'TreeSeed Lab / Match Live', accent: '#45d7ff', accent2: '#ff79c6' },
} as const;

function escape(value: unknown) {
	return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');
}

function render(snapshotInput: AgentLabSnapshot, presentation: AgentLabPresentation) {
	const snapshot = sanitizeAgentLabSnapshot(snapshotInput);
	const skin = skins[presentation];
	const fallbackName = snapshot.sceneId.replace(/^guide-/, '').replace(/-agent-lab$/, '').replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
	const labName = snapshot.agents.length === 1 ? snapshot.agents[0]!.title : fallbackName;
	const json = JSON.stringify(snapshot).replace(/</gu, '\\u003c');
	const runtime = simulationViewerRuntime().replace(/<\/script/giu, '<\\/script');
	return `<!doctype html><html lang="en" data-revision="0"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="description" content="Standalone production agent simulation evidence viewer"><title>Agent Lab: ${escape(labName)}</title>${simulationViewerStyles(skin.accent, skin.accent2)}</head><body><div id="simulation-root"><div class="shell"><div class="empty">Initializing Agent Lab…</div></div></div><script type="application/json" id="agent-lab-data">${json}</script><script>${runtime}</script></body></html>`;
}

export const BUILT_IN_AGENT_LAB_PRESENTATIONS: AgentLabPresentationAdapter[] = (Object.keys(skins) as AgentLabPresentation[]).map((id) => ({
	id,
	label: skins[id].label,
	description: skins[id].description,
	render: (snapshot) => render(snapshot, id),
}));

export function resolveAgentLabPresentation(id: string, adapters: AgentLabPresentationAdapter[] = []) {
	return [...BUILT_IN_AGENT_LAB_PRESENTATIONS, ...adapters].find((adapter) => adapter.id === id) ?? null;
}
