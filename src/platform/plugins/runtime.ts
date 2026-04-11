import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TreeseedDeployConfig } from '../contracts.ts';
import { loadTreeseedDeployConfig } from '../deploy/config.ts';
import { TREESEED_DEFAULT_PLUGIN_PACKAGE } from './constants.ts';
import type { TreeseedPluginEnvironmentContext } from './plugin.ts';
import type { SdkGraphRankingProvider } from '../../sdk-types.ts';

const require = createRequire(import.meta.url);

type LoadedPluginEntry = {
	package: string;
	config: Record<string, unknown>;
	baseDir: string;
	plugin: Record<string, any>;
};

export type LoadedTreeseedPluginEntry = LoadedPluginEntry;

function normalizeLoadedPlugin(moduleExports: unknown, packageName: string) {
	const plugin = (moduleExports as { default?: unknown } | undefined)?.default ?? moduleExports;
	if (!plugin || typeof plugin !== 'object') {
		throw new Error(`Treeseed plugin "${packageName}" did not export a plugin object.`);
	}
	return plugin as Record<string, any>;
}

function isPathLikePluginReference(packageName: string) {
	return packageName.startsWith('.') || packageName.startsWith('/') || packageName.startsWith('file:');
}

function loadPluginModule(packageName: string, tenantRoot: string) {
	if (packageName === TREESEED_DEFAULT_PLUGIN_PACKAGE) {
		const resolvedPath = require.resolve(packageName);
		return {
			moduleExports: require(resolvedPath),
			baseDir: path.dirname(resolvedPath),
		};
	}

	if (isPathLikePluginReference(packageName)) {
		const resolvedPath = packageName.startsWith('file:')
			? fileURLToPath(packageName)
			: path.resolve(tenantRoot, packageName);
		return {
			moduleExports: require(resolvedPath),
			baseDir: path.dirname(resolvedPath),
		};
	}

	const resolvedPath = require.resolve(packageName);
	return {
		moduleExports: require(resolvedPath),
		baseDir: path.dirname(resolvedPath),
	};
}

export function loadTreeseedPlugins(config: TreeseedDeployConfig = loadTreeseedDeployConfig()): LoadedPluginEntry[] {
	const tenantRoot = (config as TreeseedDeployConfig & { __tenantRoot?: string }).__tenantRoot ?? process.cwd();
	const plugins: LoadedPluginEntry[] = [];

	for (const pluginRef of config.plugins ?? []) {
		if (pluginRef?.enabled === false) {
			continue;
		}

		const loaded = loadPluginModule(pluginRef.package, tenantRoot);
		const plugin = normalizeLoadedPlugin(loaded.moduleExports, pluginRef.package);
		plugins.push({
			package: pluginRef.package,
			config: pluginRef.config ?? {},
			baseDir: loaded.baseDir,
			plugin,
		});
	}

	return plugins;
}

function collectProvidedIds(plugins: LoadedPluginEntry[]) {
	const provided = {
		forms: new Set<string>(),
		operations: new Set<string>(),
		agents: {
			execution: new Set<string>(),
			mutation: new Set<string>(),
			repository: new Set<string>(),
			verification: new Set<string>(),
			notification: new Set<string>(),
			research: new Set<string>(),
			handlers: new Set<string>(),
		},
		deploy: new Set<string>(),
		content: {
			docs: new Set<string>(),
		},
		site: new Set<string>(),
	};

	for (const { plugin } of plugins) {
		for (const id of plugin.provides?.forms ?? []) provided.forms.add(id);
		for (const id of plugin.provides?.operations ?? []) provided.operations.add(id);
		for (const id of plugin.provides?.agents?.execution ?? []) provided.agents.execution.add(id);
		for (const id of plugin.provides?.agents?.mutation ?? []) provided.agents.mutation.add(id);
		for (const id of plugin.provides?.agents?.repository ?? []) provided.agents.repository.add(id);
		for (const id of plugin.provides?.agents?.verification ?? []) provided.agents.verification.add(id);
		for (const id of plugin.provides?.agents?.notification ?? []) provided.agents.notification.add(id);
		for (const id of plugin.provides?.agents?.research ?? []) provided.agents.research.add(id);
		for (const id of plugin.provides?.agents?.handlers ?? []) provided.agents.handlers.add(id);
		for (const id of plugin.provides?.deploy ?? []) provided.deploy.add(id);
		for (const id of plugin.provides?.content?.docs ?? []) provided.content.docs.add(id);
		for (const id of plugin.provides?.site ?? []) provided.site.add(id);
	}

	return provided;
}

function assertSelectedProvider(provided: Set<string>, label: string, id?: string) {
	if (!id) {
		throw new Error(`Treeseed plugin runtime is missing selected provider id for ${label}.`);
	}
	if (!provided.has(id)) {
		throw new Error(`Treeseed plugin runtime could not resolve ${label} provider "${id}".`);
	}
}

export function loadTreeseedPluginRuntime(config: TreeseedDeployConfig = loadTreeseedDeployConfig()) {
	const plugins = loadTreeseedPlugins(config);
	const provided = collectProvidedIds(plugins);
	const providers = config.providers;

	assertSelectedProvider(provided.forms, 'forms', providers.forms);
	assertSelectedProvider(provided.operations, 'operations', providers.operations);
	assertSelectedProvider(provided.agents.execution, 'agents.execution', providers.agents.execution);
	assertSelectedProvider(provided.agents.mutation, 'agents.mutation', providers.agents.mutation);
	assertSelectedProvider(provided.agents.repository, 'agents.repository', providers.agents.repository);
	assertSelectedProvider(provided.agents.verification, 'agents.verification', providers.agents.verification);
	assertSelectedProvider(provided.agents.notification, 'agents.notification', providers.agents.notification);
	assertSelectedProvider(provided.agents.research, 'agents.research', providers.agents.research);
	assertSelectedProvider(provided.deploy, 'deploy', providers.deploy);
	assertSelectedProvider(provided.content.docs, 'content.docs', providers.content?.docs);
	assertSelectedProvider(provided.site, 'site', providers.site);

	return {
		config,
		plugins,
		provided,
	};
}

export function resolveTreeseedGraphRankingProvider(
	plugins: LoadedPluginEntry[],
	context: Omit<TreeseedPluginEnvironmentContext, 'pluginConfig'>,
): SdkGraphRankingProvider | null {
	for (const entry of plugins) {
		const contributions = entry.plugin.graphRankingProviders;
		if (!contributions || typeof contributions !== 'object') {
			continue;
		}
		for (const contribution of Object.values(contributions)) {
			if (!contribution) {
				continue;
			}
			const provider = typeof contribution === 'function'
				? contribution({ ...context, pluginConfig: entry.config ?? {} })
				: contribution;
			if (provider) {
				return provider;
			}
		}
	}
	return null;
}
