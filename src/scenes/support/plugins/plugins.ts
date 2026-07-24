import { sceneErrorDiagnostic } from '../reporting/diagnostics.ts';
import { resolveSceneLocator } from '../validation/selectors.ts';
import type {
	ScenePlugin,
	ScenePluginCategory,
	ScenePluginRegistry,
	ScenePluginResolution,
	ScenePluginSummary,
	SceneRuntimePluginContext,
	SceneRuntimePluginContextInput,
} from '../../types.ts';

function categories(plugin: ScenePlugin): ScenePluginCategory[] {
	const values: ScenePluginCategory[] = [];
	if (plugin.actions && Object.keys(plugin.actions).length > 0) values.push('action');
	if (plugin.assertions && Object.keys(plugin.assertions).length > 0) values.push('assertion');
	if (plugin.environment) values.push('environment');
	if (plugin.captures && Object.keys(plugin.captures).length > 0) values.push('capture');
	if (plugin.artifacts && Object.keys(plugin.artifacts).length > 0) values.push('artifact');
	if (plugin.renderers && Object.keys(plugin.renderers).length > 0) values.push('renderer');
	if (plugin.diagrams && Object.keys(plugin.diagrams).length > 0) values.push('diagram');
	if (plugin.narration && Object.keys(plugin.narration).length > 0) values.push('narration');
	return values;
}

function summary(plugin: ScenePlugin): ScenePluginSummary {
	return {
		id: plugin.id,
		version: plugin.version,
		status: plugin.status,
		categories: categories(plugin),
		phase: plugin.phase,
		summary: plugin.summary,
	};
}

function addEntries<T extends { id: string }>(input: {
	plugin: ScenePlugin;
	category: ScenePluginCategory;
	entries: Record<string, T> | undefined;
	map: Map<string, T>;
	ownerMap: Map<string, string>;
	diagnostics: ScenePluginRegistry['diagnostics'];
}) {
	for (const [id, entry] of Object.entries(input.entries ?? {})) {
		if (input.map.has(id)) {
			input.diagnostics.push(sceneErrorDiagnostic('scene.plugin_duplicate', `Duplicate ${input.category} plugin entry: ${id}.`, `plugins.${input.plugin.id}.${input.category}.${id}`));
			continue;
		}
		input.map.set(id, entry);
		input.ownerMap.set(id, input.plugin.id);
	}
}

export function createScenePluginRegistry(plugins: ScenePlugin[]): ScenePluginRegistry {
	const registry: ScenePluginRegistry = {
		plugins: [...plugins],
		actions: new Map(),
		actionPlugins: new Map(),
		assertions: new Map(),
		assertionPlugins: new Map(),
		environmentProviders: [],
		captures: new Map(),
		capturePlugins: new Map(),
		artifacts: new Map(),
		artifactPlugins: new Map(),
		renderers: new Map(),
		rendererPlugins: new Map(),
		diagrams: new Map(),
		diagramPlugins: new Map(),
		narration: new Map(),
		narrationPlugins: new Map(),
		diagnostics: [],
	};
	const pluginIds = new Set<string>();
	for (const plugin of registry.plugins) {
		if (!plugin.id || !plugin.version || !plugin.summary) {
			registry.diagnostics.push(sceneErrorDiagnostic('scene.plugin_invalid', 'Plugin id, version, and summary are required.', `plugins.${plugin.id || '(unknown)'}`));
			continue;
		}
		if (pluginIds.has(plugin.id)) {
			registry.diagnostics.push(sceneErrorDiagnostic('scene.plugin_duplicate', `Duplicate plugin id: ${plugin.id}.`, `plugins.${plugin.id}`));
			continue;
		}
		pluginIds.add(plugin.id);
		if (plugin.environment) registry.environmentProviders.push(plugin.environment);
		addEntries({ plugin, category: 'action', entries: plugin.actions, map: registry.actions, ownerMap: registry.actionPlugins, diagnostics: registry.diagnostics });
		addEntries({ plugin, category: 'assertion', entries: plugin.assertions, map: registry.assertions, ownerMap: registry.assertionPlugins, diagnostics: registry.diagnostics });
		addEntries({ plugin, category: 'capture', entries: plugin.captures, map: registry.captures, ownerMap: registry.capturePlugins, diagnostics: registry.diagnostics });
		addEntries({ plugin, category: 'artifact', entries: plugin.artifacts, map: registry.artifacts, ownerMap: registry.artifactPlugins, diagnostics: registry.diagnostics });
		addEntries({ plugin, category: 'renderer', entries: plugin.renderers, map: registry.renderers, ownerMap: registry.rendererPlugins, diagnostics: registry.diagnostics });
		addEntries({ plugin, category: 'diagram', entries: plugin.diagrams, map: registry.diagrams, ownerMap: registry.diagramPlugins, diagnostics: registry.diagnostics });
		addEntries({ plugin, category: 'narration', entries: plugin.narration, map: registry.narration, ownerMap: registry.narrationPlugins, diagnostics: registry.diagnostics });
	}
	const diagramComponents = new Map<string, string>();
	for (const [providerId, provider] of registry.diagrams.entries()) {
		for (const component of Object.keys(provider.diagrams ?? {})) {
			const owner = diagramComponents.get(component);
			if (owner) {
				registry.diagnostics.push(sceneErrorDiagnostic('scene.plugin_duplicate', `Duplicate diagram component id: ${component}.`, `plugins.${registry.diagramPlugins.get(providerId) ?? providerId}.diagram.${providerId}.${component}`));
				continue;
			}
			diagramComponents.set(component, providerId);
		}
	}
	return registry;
}

export function summarizeScenePlugins(plugins: ScenePlugin[]) {
	return plugins.map(summary).sort((a, b) => a.id.localeCompare(b.id));
}

export function createSceneRuntimePluginContext(input: SceneRuntimePluginContextInput): SceneRuntimePluginContext {
	return {
		...input,
		resolveSelector(selector) {
			return resolveSceneLocator(input.session.page, selector);
		},
		resolveUrl(value) {
			return new URL(value, input.baseUrl.endsWith('/') ? input.baseUrl : `${input.baseUrl}/`).toString();
		},
	};
}

export function pluginResolutionFromRegistry(registry: ScenePluginRegistry): ScenePluginResolution {
	return {
		ok: !registry.diagnostics.some((entry) => entry.severity === 'error'),
		registry,
		diagnostics: registry.diagnostics,
		summaries: summarizeScenePlugins(registry.plugins),
	};
}
