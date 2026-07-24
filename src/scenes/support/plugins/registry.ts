import { createBuiltInScenePlugins } from './builtin-plugins.ts';
import { createScenePluginRegistry, pluginResolutionFromRegistry, summarizeScenePlugins } from './plugins.ts';
import type {
	SceneActionDefinition,
	SceneAssertionDefinition,
	SceneDiagramDefinition,
	ScenePlugin,
	SceneRendererDefinition,
} from '../../types.ts';

export function createBuiltInScenePluginRegistry() {
	return createScenePluginRegistry(createBuiltInScenePlugins());
}

export function resolveScenePlugins(input: { plugins?: ScenePlugin[] } = {}) {
	return pluginResolutionFromRegistry(createScenePluginRegistry([
		...createBuiltInScenePlugins(),
		...(input.plugins ?? []),
	]));
}

export function listBuiltInScenePlugins() {
	return summarizeScenePlugins(createBuiltInScenePlugins());
}

export function listBuiltInSceneActions(): SceneActionDefinition[] {
	const registry = createBuiltInScenePluginRegistry();
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

export function listBuiltInSceneAssertions(): SceneAssertionDefinition[] {
	const registry = createBuiltInScenePluginRegistry();
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

export function listBuiltInSceneRenderers(): SceneRendererDefinition[] {
	const registry = createBuiltInScenePluginRegistry();
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

export function listBuiltInSceneDiagrams(): SceneDiagramDefinition[] {
	const registry = createBuiltInScenePluginRegistry();
	return [...registry.diagrams.values()]
		.flatMap((provider) => Object.values(provider.diagrams))
		.sort((a, b) => a.component.localeCompare(b.component));
}

export function findBuiltInSceneAction(id: string) {
	return listBuiltInSceneActions().find((action) => action.id === id) ?? null;
}

export function findBuiltInSceneAssertion(id: string) {
	return listBuiltInSceneAssertions().find((assertion) => assertion.id === id) ?? null;
}
