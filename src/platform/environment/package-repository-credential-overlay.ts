import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../../operations/services/git-runner.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { discoverTreeseedApplications } from '../../hosting/apps.ts';
import { githubRepositoryCredentialEnvName } from '../../operations/services/github-credentials.ts';
import { discoverTreeseedPackageAdapters } from '../../operations/services/package-adapters.ts';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from '../contracts.ts';
import { loadTreeseedDeployConfig } from '../deploy-config.ts';
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from '../plugins.ts';
import { loadTreeseedManifest } from '../tenant-config.ts';
import { TENANT_ENVIRONMENT_OVERLAY_PATH, TREESEED_CONFIG_STARTUP_PROFILES, TreeseedEnvironmentContext, TreeseedEnvironmentEntry, TreeseedEnvironmentEntryOverride, TreeseedEnvironmentEntryYaml, TreeseedEnvironmentPurpose, TreeseedEnvironmentRegistryOverlay, TreeseedEnvironmentScope, TreeseedResolvedEnvironmentRegistry, loadOptionalTenantConfig, resolveSdkEnvironmentPath, resolveSiblingPackageEnvironmentPath, webSurfaceEnabled } from './treeseed-environment-scopes.ts';
import { PREDICATES, VALUE_RESOLVERS, deepMerge, normalizeOverlay, readPluginEnvironmentOverlay, readYamlOverlayIfPresent } from './resolve-content-bucket-binding.ts';
import { apiSurfaceEnabled, processingPlaneEnabled } from './api-surface-enabled.ts';

export function packageRepositoryCredentialOverlay(tenantRoot: string): TreeseedEnvironmentRegistryOverlay {
	const entries: Record<string, TreeseedEnvironmentEntryOverride> = {};
	let packages: ReturnType<typeof discoverTreeseedPackageAdapters> = [];
	try {
		packages = discoverTreeseedPackageAdapters(tenantRoot);
	} catch {
		packages = [];
	}
	for (const pkg of packages) {
		const repository = typeof pkg.metadata.repository === 'string' && pkg.metadata.repository.trim()
			? pkg.metadata.repository.trim()
			: null;
		if (!repository) continue;
		let id = '';
		try {
			id = githubRepositoryCredentialEnvName(repository);
		} catch {
			continue;
		}
		entries[id] = {
			label: `${pkg.name} GitHub token`,
			group: 'github',
			cluster: `github:${repository}`,
			description: `GitHub token used by Treeseed package workflows for ${pkg.name} in ${repository}.`,
			howToGet: `Create a GitHub token with Actions workflow and environment secret permissions for ${repository}, then store it as ${id}.`,
			sensitivity: 'secret',
			targets: ['local-runtime'],
			scopes: ['staging', 'prod'],
			storage: 'shared',
			requirement: 'optional',
			purposes: ['deploy', 'config'],
			validation: {
				kind: 'nonempty',
				minLength: 8,
			},
			sourcePriority: ['machine-config', 'process-env'],
		};
	}
	return { entries };
}

export function loadTreeseedEnvironmentOverlay(tenantRoot: string) {
	const overlayPath = resolve(tenantRoot, TENANT_ENVIRONMENT_OVERLAY_PATH);
	return {
		path: overlayPath,
		overlay: readYamlOverlayIfPresent(overlayPath) ?? ({ entries: {} } satisfies TreeseedEnvironmentRegistryOverlay),
	};
}

export function resolveNamedValueResolver(ref: string | undefined) {
	if (!ref) return undefined;
	const resolver = VALUE_RESOLVERS[ref];
	if (!resolver) {
		throw new Error(`Unknown Treeseed environment value resolver "${ref}".`);
	}
	return resolver;
}

export function resolveNamedPredicate(ref: string | undefined) {
	if (!ref) return undefined;
	const predicate = PREDICATES[ref];
	if (!predicate) {
		throw new Error(`Unknown Treeseed environment predicate "${ref}".`);
	}
	return predicate;
}

export function materializeEntry(id: string, entry: TreeseedEnvironmentEntryYaml): TreeseedEnvironmentEntry {
	return {
		...entry,
		id,
		cluster: entry.cluster ?? `${entry.group}:${id}`,
		onboardingFeature: entry.onboardingFeature,
		visibility: entry.visibility ?? 'user',
		startupProfile: entry.startupProfile
			?? (entry.onboardingFeature ? 'optional' : (
				entry.group === 'auth'
				|| entry.id === 'TREESEED_FORM_TOKEN_SECRET'
				|| entry.group === 'local-development'
					? 'core'
					: 'advanced'
			)),
		storage: entry.storage ?? 'scoped',
		defaultValue: resolveNamedValueResolver(entry.defaultValueRef),
		localDefaultValue: resolveNamedValueResolver(entry.localDefaultValueRef),
		isRelevant: resolveNamedPredicate(entry.relevanceRef),
		requiredWhen: resolveNamedPredicate(entry.requiredWhenRef),
	};
}

export function mergeEntryYaml(
	baseEntry: TreeseedEnvironmentEntryYaml | undefined,
	id: string,
	override: TreeseedEnvironmentEntryOverride,
) {
	const merged = (baseEntry ? deepMerge(baseEntry, override) : override) as TreeseedEnvironmentEntryYaml;

	if (
		typeof merged.label !== 'string'
		|| typeof merged.group !== 'string'
		|| (merged.cluster !== undefined && typeof merged.cluster !== 'string')
		|| (merged.onboardingFeature !== undefined && typeof merged.onboardingFeature !== 'string')
		|| (merged.startupProfile !== undefined && !TREESEED_CONFIG_STARTUP_PROFILES.includes(merged.startupProfile))
		|| typeof merged.description !== 'string'
		|| typeof merged.howToGet !== 'string'
		|| !Array.isArray(merged.targets)
		|| !Array.isArray(merged.scopes)
		|| typeof merged.requirement !== 'string'
		|| !Array.isArray(merged.purposes)
		|| typeof merged.sensitivity !== 'string'
	) {
		throw new Error(`Treeseed environment registry entry "${id}" is missing required metadata after merge.`);
	}

	return merged;
}

export function collectOverlaySources(context: TreeseedEnvironmentContext) {
	const sources: Array<{ label: string; overlay: TreeseedEnvironmentRegistryOverlay }> = [];

	const sdkEnvironmentPath = resolveSdkEnvironmentPath();
	const sdkOverlay = readYamlOverlayIfPresent(sdkEnvironmentPath);
	if (!sdkOverlay) {
		throw new Error(`Treeseed SDK environment registry file was not found at ${sdkEnvironmentPath}.`);
	}
	sources.push({ label: sdkEnvironmentPath, overlay: sdkOverlay });

	if (webSurfaceEnabled(context)) {
		const coreEnvironmentPath = resolveSiblingPackageEnvironmentPath('core');
		const coreOverlay = readYamlOverlayIfPresent(coreEnvironmentPath);
		if (coreOverlay) {
			sources.push({ label: coreEnvironmentPath, overlay: coreOverlay });
		}
	}

	if (apiSurfaceEnabled(context) || processingPlaneEnabled(context)) {
		const apiEnvironmentPath = resolveSiblingPackageEnvironmentPath('api');
		const apiOverlay = readYamlOverlayIfPresent(apiEnvironmentPath);
		if (apiOverlay) {
			sources.push({ label: apiEnvironmentPath, overlay: apiOverlay });
		}
		const agentEnvironmentPath = resolveSiblingPackageEnvironmentPath('agent');
		const agentOverlay = readYamlOverlayIfPresent(agentEnvironmentPath);
		if (agentOverlay) {
			sources.push({ label: agentEnvironmentPath, overlay: agentOverlay });
		}
	}

	let discoveredApiApps: ReturnType<typeof discoverTreeseedApplications> = [];
	try {
		discoveredApiApps = discoverTreeseedApplications(context.tenantRoot)
			.filter((application) => application.root !== context.tenantRoot && application.roles.some((role) => role === 'api' || role === 'operations-runner' || role === 'treeseed-control-plane'));
	} catch {
		discoveredApiApps = [];
	}
	const discoveredApiEnvironmentPath = resolveSiblingPackageEnvironmentPath('api');
	if (discoveredApiApps.length > 0 && !sources.some((source) => source.label === discoveredApiEnvironmentPath)) {
		const apiOverlay = readYamlOverlayIfPresent(discoveredApiEnvironmentPath);
		if (apiOverlay) {
			sources.push({ label: discoveredApiEnvironmentPath, overlay: apiOverlay });
		}
	}

	for (const application of discoveredApiApps) {
		const overlay = readYamlOverlayIfPresent(resolve(application.root, 'src/env.yaml'));
		if (overlay) {
			sources.push({ label: resolve(application.root, 'src/env.yaml'), overlay });
		}
	}

	const packageCredentialOverlay = packageRepositoryCredentialOverlay(context.tenantRoot);
	if (Object.keys(packageCredentialOverlay.entries ?? {}).length > 0) {
		sources.push({ label: 'discovered package repository credentials', overlay: packageCredentialOverlay });
	}

	for (const pluginEntry of context.plugins) {
		const fileOverlay = readPluginEnvironmentOverlay(pluginEntry.baseDir);
		if (fileOverlay) {
			sources.push({ label: fileOverlay.path, overlay: fileOverlay.overlay });
		}

		const overlaySource = pluginEntry.plugin.environmentRegistry;
		if (!overlaySource) {
			continue;
		}

		const pluginContext = {
			projectRoot: context.tenantRoot,
			tenantConfig: context.tenantConfig,
			deployConfig: context.deployConfig,
			pluginConfig: pluginEntry.config,
		};
		const overlay = typeof overlaySource === 'function' ? overlaySource(pluginContext) : overlaySource;
		if (overlay) {
			sources.push({
				label: `plugin ${pluginEntry.package}`,
				overlay: normalizeOverlay(overlay, `plugin ${pluginEntry.package}`),
			});
		}
	}

	const tenantOverlay = loadTreeseedEnvironmentOverlay(context.tenantRoot);
	sources.push({ label: tenantOverlay.path, overlay: tenantOverlay.overlay });
	return sources;
}

export function resolveTreeseedEnvironmentContext(options: {
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
} = {}): TreeseedEnvironmentContext {
	const deployConfig = options.deployConfig ?? loadTreeseedDeployConfig();
	const tenantConfig = options.tenantConfig ?? loadOptionalTenantConfig();
	const plugins = options.plugins ?? loadTreeseedPlugins(deployConfig);
	const tenantRoot =
		(deployConfig as TreeseedDeployConfig & { __tenantRoot?: string }).__tenantRoot
		?? (tenantConfig as TreeseedTenantConfig & { __tenantRoot?: string } | undefined)?.__tenantRoot
		?? process.cwd();

	return {
		deployConfig,
		tenantConfig,
		plugins,
		tenantRoot,
	};
}

export function resolveTreeseedEnvironmentRegistry(options: {
	deployConfig?: TreeseedDeployConfig;
	tenantConfig?: TreeseedTenantConfig;
	plugins?: LoadedTreeseedPluginEntry[];
} = {}): TreeseedResolvedEnvironmentRegistry {
	const context = resolveTreeseedEnvironmentContext(options);
	const entriesById = new Map<string, TreeseedEnvironmentEntryYaml>();
	const order: string[] = [];

	for (const source of collectOverlaySources(context)) {
		for (const [id, override] of Object.entries(source.overlay.entries ?? {})) {
			const current = entriesById.get(id);
			entriesById.set(id, mergeEntryYaml(current, id, override ?? {}));
			if (!current) {
				order.push(id);
			}
		}
	}

	return {
		context,
		entries: order.map((id) => materializeEntry(id, entriesById.get(id)!)),
	};
}

export function isTreeseedEnvironmentEntryRelevant(
	entry: TreeseedEnvironmentEntry,
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	purpose?: TreeseedEnvironmentPurpose,
) {
	if (!entry.scopes.includes(scope)) {
		return false;
	}
	if (purpose && !entry.purposes.includes(purpose)) {
		return false;
	}
	if (entry.isRelevant) {
		return entry.isRelevant(context, scope, purpose);
	}
	return true;
}
