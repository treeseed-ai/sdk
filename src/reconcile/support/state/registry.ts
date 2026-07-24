import { loadPlugins } from '../../../platform/plugins/runtime.ts';
import type { DeployConfig } from '../../../platform/support/contracts.ts';
import type { Plugin, PluginEnvironmentContext } from '../../../platform/support/plugin.ts';
import type { ReconcileAdapter, ReconcileProviderId, ReconcileUnitType } from '../contracts/contracts.ts';
import {
	createCapacityProviderReconcileAdapters,
	createCloudflareReconcileAdapters,
	createDockerReconcileAdapters,
	createGitHubReconcileAdapters,
	createLocalProcessReconcileAdapters,
	createPackageReconcileAdapters,
	createRailwayReconcileAdapters,
	createReleaseGateReconcileAdapters,
} from '../../reconciliation/builtin-adapters.ts';
import { createLocalSeedBootstrapAdapter } from '../../seeds/local-seed-bootstrap-adapter.ts';

export type ReconcileRegistry = {
	adapters: ReconcileAdapter[];
	get(unitType: ReconcileUnitType, providerId: ReconcileProviderId): ReconcileAdapter;
};

function normalizeAdapterContribution(
	contribution: unknown,
	context: PluginEnvironmentContext,
) {
	if (typeof contribution === 'function') {
		return contribution(context);
	}
	return contribution;
}

function loadPluginReconcileAdapters(config: DeployConfig) {
	const tenantRoot = (config as DeployConfig & { __tenantRoot?: string }).__tenantRoot ?? process.cwd();
	const plugins = loadPlugins(config);
	const adapters: ReconcileAdapter[] = [];
	for (const entry of plugins) {
		const plugin = entry.plugin as Plugin;
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
			adapters.push(resolved as ReconcileAdapter);
		}
	}
	return adapters;
}

export function createReconcileRegistry(config: DeployConfig): ReconcileRegistry {
	const adapters = [
		...createReleaseGateReconcileAdapters(),
		...createPackageReconcileAdapters(),
		...createGitHubReconcileAdapters(),
		...createDockerReconcileAdapters(),
		...createLocalProcessReconcileAdapters(),
		createLocalSeedBootstrapAdapter(),
		...createCapacityProviderReconcileAdapters(),
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
