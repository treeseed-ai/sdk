import { createBuiltInTreeseedScenePlugins } from './builtin-plugins.ts';
import { createTreeseedScenePluginRegistry, pluginResolutionFromRegistry, summarizeTreeseedScenePlugins } from './plugins.ts';
import type {
	TreeseedSceneActionDefinition,
	TreeseedSceneAssertionDefinition,
	TreeseedSceneDiagramDefinition,
	TreeseedScenePlugin,
	TreeseedSceneRendererDefinition,
} from './types.ts';

export function createBuiltInTreeseedScenePluginRegistry() {
	return createTreeseedScenePluginRegistry(createBuiltInTreeseedScenePlugins());
}

export function resolveTreeseedScenePlugins(input: { plugins?: TreeseedScenePlugin[] } = {}) {
	return pluginResolutionFromRegistry(createTreeseedScenePluginRegistry([
		...createBuiltInTreeseedScenePlugins(),
		...(input.plugins ?? []),
	]));
}

export function listBuiltInTreeseedScenePlugins() {
	return summarizeTreeseedScenePlugins(createBuiltInTreeseedScenePlugins());
}

export function listBuiltInTreeseedSceneActions(): TreeseedSceneActionDefinition[] {
	const registry = createBuiltInTreeseedScenePluginRegistry();
	return [...registry.actions.entries()]
		.map(([id, action]) => ({
			id,
			phase: action.phase,
			pluginId: registry.actionPlugins.get(id) ?? 'unknown',
			status: action.status,
			summary: action.summary,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function listBuiltInTreeseedSceneAssertions(): TreeseedSceneAssertionDefinition[] {
	const registry = createBuiltInTreeseedScenePluginRegistry();
	return [...registry.assertions.entries()]
		.map(([id, assertion]) => ({
			id,
			phase: assertion.phase,
			pluginId: registry.assertionPlugins.get(id) ?? 'unknown',
			status: assertion.status,
			summary: assertion.summary,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function listBuiltInTreeseedSceneRenderers(): TreeseedSceneRendererDefinition[] {
	const registry = createBuiltInTreeseedScenePluginRegistry();
	return [...registry.renderers.entries()]
		.map(([id, renderer]) => ({
			id,
			phase: renderer.phase,
			pluginId: registry.rendererPlugins.get(id) ?? 'unknown',
			status: renderer.status,
			summary: renderer.summary,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function listBuiltInTreeseedSceneDiagrams(): TreeseedSceneDiagramDefinition[] {
	const registry = createBuiltInTreeseedScenePluginRegistry();
	return [...registry.diagrams.values()]
		.flatMap((provider) => Object.values(provider.diagrams))
		.sort((a, b) => a.component.localeCompare(b.component));
}

export function findBuiltInTreeseedSceneAction(id: string) {
	return listBuiltInTreeseedSceneActions().find((action) => action.id === id) ?? null;
}

export function findBuiltInTreeseedSceneAssertion(id: string) {
	return listBuiltInTreeseedSceneAssertions().find((assertion) => assertion.id === id) ?? null;
}
