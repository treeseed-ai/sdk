import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { parseCapacityProviderLaunchManifest, resolveCapacityProviderLaunchPlan } from '../capacity-provider.ts';
import { discoverTreeseedApplications } from '../hosting/apps.ts';
import { discoverTreeseedPackageAdapters } from '../operations/services/package-adapters.ts';
import { collectTreeseedEnvironmentContext } from '../operations/services/config-runtime.ts';
import { loadTreeseedDeployConfigFromPath, resolveTreeseedDeployConfigPathFromRoot } from './deploy-config.ts';
import type { TreeseedDeployConfig } from './contracts.ts';

export type TreeseedPlatformConfigInput = {
	tenantRoot: string;
	environment: 'local' | 'staging' | 'prod';
	env?: Record<string, string | undefined>;
	capacityConfigPath?: string | null;
};

function loadOptionalYaml(filePath: string) {
	if (!existsSync(filePath)) return null;
	return parseYaml(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
}

function loadCapacityLaunchFromPackageManifest(tenantRoot: string) {
	const agentManifestPath = resolve(tenantRoot, 'packages', 'agent', 'treeseed.package.yaml');
	const manifest = loadOptionalYaml(agentManifestPath);
	const capacityProvider = manifest?.capacityProvider;
	if (!capacityProvider || typeof capacityProvider !== 'object' || Array.isArray(capacityProvider)) return null;
	const local = (capacityProvider as Record<string, any>).local ?? {};
	const roles = (capacityProvider as Record<string, any>).roles ?? {};
	const launchManifest = {
		schemaVersion: 1,
		provider: {
			dataDir: local.dataDir ?? '.treeseed/local-capacity-provider/data',
			environment: 'local',
		},
		runtime: {
			images: {
				roles: {
					manager: { image: roles.manager?.image ?? 'treeseed/agent-manager', tag: roles.manager?.tag ?? 'latest' },
					runner: { image: roles.runner?.image ?? 'treeseed/agent-runner', tag: roles.runner?.tag ?? 'latest' },
				},
			},
		},
	};
	const parsed = parseCapacityProviderLaunchManifest(launchManifest);
	return {
		path: agentManifestPath,
		manifest: parsed,
		plan: resolveCapacityProviderLaunchPlan(parsed),
	};
}

function loadCapacityLaunchFromPath(configPath: string | null | undefined) {
	if (!configPath) return null;
	const absolutePath = resolve(configPath);
	if (!existsSync(absolutePath)) {
		throw new Error(`Capacity launch config was not found: ${absolutePath}`);
	}
	const parsed = parseCapacityProviderLaunchManifest(readFileSync(absolutePath, 'utf8'));
	return {
		path: absolutePath,
		manifest: parsed,
		plan: resolveCapacityProviderLaunchPlan(parsed),
	};
}

function loadTreeseedDevManifest(tenantRoot: string) {
	return loadOptionalYaml(resolve(tenantRoot, 'treeseed.dev.yaml')) ?? {
		schemaVersion: 1,
		dev: {
			processes: {
				'market-web': { package: '@treeseed/market', cwd: '.', surface: 'web' },
				api: { package: '@treeseed/api', cwd: 'packages/api', surface: 'api' },
				'operations-runner': { package: '@treeseed/api', cwd: 'packages/api', surface: 'operations-runner' },
			},
		},
	};
}

function discoverPlatformPackages(tenantRoot: string): ReturnType<typeof discoverTreeseedPackageAdapters> {
	if (!existsSync(resolve(tenantRoot, 'package.json'))) {
		return [];
	}
	return discoverTreeseedPackageAdapters(tenantRoot);
}

export function loadTreeseedPlatformConfig(input: TreeseedPlatformConfigInput): {
	tenantRoot: string;
	environment: 'local' | 'staging' | 'prod';
	deployConfig: TreeseedDeployConfig;
	packages: ReturnType<typeof discoverTreeseedPackageAdapters>;
	applications: ReturnType<typeof discoverTreeseedApplications>;
	capacityLaunch: ReturnType<typeof loadCapacityLaunchFromPackageManifest>;
	dev: ReturnType<typeof loadTreeseedDevManifest>;
	envRegistry: ReturnType<typeof collectTreeseedEnvironmentContext> | null;
} {
	const tenantRoot = resolve(input.tenantRoot);
	const deployConfigPath = resolveTreeseedDeployConfigPathFromRoot(tenantRoot);
	const deployConfig = loadTreeseedDeployConfigFromPath(deployConfigPath);
	const packages = discoverPlatformPackages(tenantRoot);
	const applications = discoverTreeseedApplications(tenantRoot);
	const capacityLaunch = loadCapacityLaunchFromPath(input.capacityConfigPath ?? input.env?.TREESEED_CAPACITY_CONFIG_PATH) ?? loadCapacityLaunchFromPackageManifest(tenantRoot);
	const dev = loadTreeseedDevManifest(tenantRoot);
	let envRegistry = null;
	try {
		envRegistry = collectTreeseedEnvironmentContext(tenantRoot, input.environment, { env: input.env });
	} catch {
		envRegistry = null;
	}
	return {
		tenantRoot,
		environment: input.environment,
		deployConfig,
		packages,
		applications,
		capacityLaunch,
		dev,
		envRegistry,
	};
}
