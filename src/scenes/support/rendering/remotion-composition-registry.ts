import type { SceneRemotionCompositionDefinition } from '../../types.ts';

const COMPOSITIONS: SceneRemotionCompositionDefinition[] = [
	{ id: 'treeseed-demo-default', phase: 6, mode: 'demo', summary: 'Default Treeseed demo video with browser evidence, chapters, lower thirds, and callouts.' },
	{ id: 'treeseed-training-default', phase: 6, mode: 'training', summary: 'Training-oriented render profile with larger context and persistent chapter labels.' },
	{ id: 'treeseed-failure-review', phase: 6, mode: 'failure-review', summary: 'Failure review render focused on failed step diagnostics and evidence.' },
	{ id: 'treeseed-diagram-only', phase: 6, mode: 'diagram-only', summary: 'Render typed scene diagrams from validated diagram provider input.' },
];

export function listSceneRemotionCompositions() {
	return [...COMPOSITIONS];
}
