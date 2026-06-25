import { describe, expect, it } from 'vitest';
import {
	createBuiltInTreeseedScenePluginRegistry,
	listBuiltInTreeseedScenePlugins,
	resolveTreeseedScenePlugins,
	type TreeseedScenePlugin,
} from '../../src/scenes/index.ts';

describe('scene plugin registry', () => {
	it('includes built-in plugin categories and deterministic summaries', () => {
		const summaries = listBuiltInTreeseedScenePlugins();
		expect(summaries.map((entry) => entry.id)).toEqual([...summaries.map((entry) => entry.id)].sort());
		expect(summaries.some((entry) => entry.categories.includes('action'))).toBe(true);
		expect(summaries.some((entry) => entry.categories.includes('assertion'))).toBe(true);
		expect(summaries.some((entry) => entry.categories.includes('environment'))).toBe(true);
		expect(summaries.some((entry) => entry.categories.includes('capture'))).toBe(true);
		expect(summaries.some((entry) => entry.categories.includes('artifact'))).toBe(true);
		expect(summaries.some((entry) => entry.categories.includes('renderer'))).toBe(true);
		expect(summaries.some((entry) => entry.categories.includes('diagram'))).toBe(true);
		expect(summaries.some((entry) => entry.categories.includes('narration'))).toBe(true);
		expect(summaries.some((entry) => entry.id.includes('placeholder'))).toBe(false);
	});

	it('registers built-in action and assertion handlers', () => {
		const registry = createBuiltInTreeseedScenePluginRegistry();
		expect([...registry.actions.keys()].sort()).toEqual(['apiRequest', 'click', 'fill', 'goto', 'keyboard', 'mailpitConfirmLatest', 'pause', 'select', 'waitForOperation']);
		expect([...registry.assertions.keys()].sort()).toEqual(['operation', 'text', 'urlIncludes', 'visible']);
		expect(registry.actions.get('waitForOperation')?.status).toBe('available');
		expect(registry.actions.get('apiRequest')?.status).toBe('deferred');
		expect(registry.assertions.get('operation')?.status).toBe('available');
	});

	it('registers Remotion as an available renderer plugin without loading Remotion components', () => {
		const registry = createBuiltInTreeseedPluginRegistryForTest();
		expect(registry.renderers.get('remotion')?.status).toBe('available');
		expect(registry.renderers.get('remotion')?.phase).toBe(6);
		expect(registry.rendererPlugins.get('remotion')).toBe('treeseed.scene.renderer.remotion');
	});

	it('registers the Phase 7 Remotion diagram provider and components', () => {
		const registry = createBuiltInTreeseedPluginRegistryForTest();
		expect(registry.diagrams.get('treeseed-remotion-diagrams')?.status).toBe('available');
		expect(registry.diagrams.get('treeseed-remotion-diagrams')?.phase).toBe(7);
		expect(registry.diagramPlugins.get('treeseed-remotion-diagrams')).toBe('treeseed.scene.diagrams.remotion');
		expect(Object.keys(registry.diagrams.get('treeseed-remotion-diagrams')?.diagrams ?? {}).sort()).toEqual([
			'DevRuntimeTopologyDiagram',
			'OperationLifecycleDiagram',
			'ReconciliationLifecycleDiagram',
			'SceneExecutionTimelineDiagram',
		]);
	});

	it('registers deterministic Phase 8 training providers and artifacts', () => {
		const registry = createBuiltInTreeseedPluginRegistryForTest();
		expect(registry.narration.get('deterministic-narration')?.status).toBe('available');
		expect(registry.narration.get('deterministic-narration')?.phase).toBe(8);
		expect(registry.narrationPlugins.get('deterministic-narration')).toBe('treeseed.scene.training.deterministic');
		expect(registry.artifacts.get('training-captions')?.status).toBe('available');
		expect(registry.artifactPlugins.get('training-captions')).toBe('treeseed.scene.training.deterministic');
	});

	it('combines explicit plugins and reports duplicate ids', () => {
		const duplicate: TreeseedScenePlugin = {
			id: 'test.duplicate-action',
			version: '1.0.0',
			phase: 4,
			status: 'available',
			summary: 'Duplicate action for diagnostics.',
			actions: {
				goto: {
					id: 'goto',
					phase: 4,
					status: 'available',
					summary: 'duplicate',
					async run() {
						return { ok: true, diagnostics: [] };
					},
				},
			},
		};
		const resolved = resolveTreeseedScenePlugins({ plugins: [duplicate] });
		expect(resolved.ok).toBe(false);
		expect(resolved.summaries.some((entry) => entry.id === 'test.duplicate-action')).toBe(true);
		expect(resolved.diagnostics.some((entry) => entry.code === 'scene.plugin_duplicate')).toBe(true);
		expect(resolved.registry.actionPlugins.get('goto')).toBe('treeseed.scene.browser-actions');
	});

	it('reports invalid plugin metadata', () => {
		const invalid = {
			id: '',
			version: '',
			phase: 4,
			status: 'available',
			summary: '',
		} as TreeseedScenePlugin;
		const resolved = resolveTreeseedScenePlugins({ plugins: [invalid] });
		expect(resolved.ok).toBe(false);
		expect(resolved.diagnostics.some((entry) => entry.code === 'scene.plugin_invalid')).toBe(true);
	});

	it('reports duplicate diagram component ids from explicit plugins', () => {
		const duplicate: TreeseedScenePlugin = {
			id: 'test.duplicate-diagram',
			version: '1.0.0',
			phase: 7,
			status: 'available',
			summary: 'Duplicate diagram component for diagnostics.',
			diagrams: {
				test: {
					id: 'test',
					phase: 7,
					status: 'available',
					summary: 'duplicate',
					diagrams: {
						OperationLifecycleDiagram: {
							id: 'OperationLifecycleDiagram',
							phase: 7,
							status: 'available',
							summary: 'duplicate',
							component: 'OperationLifecycleDiagram',
							kind: 'operation-lifecycle',
							defaultDurationSeconds: 1,
							validateProps: () => [],
							normalizeProps: () => ({}),
						},
					},
				},
			},
		};
		const resolved = resolveTreeseedScenePlugins({ plugins: [duplicate] });
		expect(resolved.ok).toBe(false);
		expect(resolved.diagnostics.some((entry) => entry.code === 'scene.plugin_duplicate' && entry.message.includes('OperationLifecycleDiagram'))).toBe(true);
	});
});

function createBuiltInTreeseedPluginRegistryForTest() {
	return createBuiltInTreeseedScenePluginRegistry();
}
