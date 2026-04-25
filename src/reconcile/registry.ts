import { loadTreeseedPlugins } from '../platform/plugins/runtime.ts';
import type { TreeseedDeployConfig } from '../platform/contracts.ts';
import type { TreeseedPlugin, TreeseedPluginEnvironmentContext } from '../platform/plugin.ts';
import type { TreeseedReconcileAdapter, TreeseedReconcileProviderId, TreeseedReconcileUnitType } from './contracts.ts';
import { createCloudflareReconcileAdapters, createRailwayReconcileAdapters } from './builtin-adapters.ts';

export type TreeseedReconcileRegistry = {
	adapters: TreeseedReconcileAdapter[];
	get(unitType: TreeseedReconcileUnitType, providerId: TreeseedReconcileProviderId): TreeseedReconcileAdapter;
};

function normalizeAdapterContribution(
	contribution: unknown,
	context: TreeseedPluginEnvironmentContext,
) {
	if (typeof contribution === 'function') {
		return contribution(context);
	}
	return contribution;
}

function loadPluginReconcileAdapters(config: TreeseedDeployConfig) {
	const tenantRoot = (config as TreeseedDeployConfig & { __tenantRoot?: string }).__tenantRoot ?? process.cwd();
	const plugins = loadTreeseedPlugins(config);
	const adapters: TreeseedReconcileAdapter[] = [];
	for (const entry of plugins) {
		const plugin = entry.plugin as TreeseedPlugin;
		const contributions = plugin.reconcileAdapters;
		if (!contributions || typeof contributions !== 'object') {
			continue;
		}
		for (const contribution of Object.values(contributions as Record<string, unknown>)) {
			const resolved = normalizeAdapterContribution(contribution, {
				projectRoot: tenantRoot,
				deployConfig: config,
				tenantConfig: undefined,
				pluginConfig: entry.config ?? {},
			});
			if (!resolved) {
				continue;
			}
			adapters.push(resolved as TreeseedReconcileAdapter);
		}
	}
	return adapters;
}

export function createTreeseedReconcileRegistry(config: TreeseedDeployConfig): TreeseedReconcileRegistry {
	const adapters = [
		...createCloudflareReconcileAdapters(),
		...createRailwayReconcileAdapters(),
		...loadPluginReconcileAdapters(config),
	];
	const seenBindings = new Map<string, string>();
	for (const adapter of adapters) {
		for (const unitType of adapter.unitTypes) {
			const bindingKey = `${adapter.providerId}:${unitType}`;
			const existing = seenBindings.get(bindingKey);
			if (existing) {
				throw new Error(`Duplicate Treeseed reconcile adapter binding for ${bindingKey} (${existing}, ${adapter.providerId}).`);
			}
			seenBindings.set(bindingKey, adapter.providerId);
		}
	}
	return {
		adapters,
		get(unitType, providerId) {
			const adapter = adapters.find((candidate) => candidate.supports(unitType, providerId));
			if (!adapter) {
				throw new Error(`Treeseed reconcile adapter missing for ${providerId}:${unitType}.`);
			}
			return adapter;
		},
	};
}
