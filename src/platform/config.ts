import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateAndDigestCapacityProviderManifest } from '../capacity-provider/index.ts';
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

function loadCapacityManifestFromPath(configPath: string | null | undefined) {
	if (!configPath) return null;
	const absolutePath = resolve(configPath);
	if (!existsSync(absolutePath)) {
		throw new Error(`Capacity launch config was not found: ${absolutePath}`);
	}
	const parsed = parseYaml(readFileSync(absolutePath, 'utf8'));
	let validated: ReturnType<typeof validateAndDigestCapacityProviderManifest>;
	try {
		validated = validateAndDigestCapacityProviderManifest(parsed);
	} catch (error) {
		throw new Error(`Capacity provider manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
	}
	return {
		path: absolutePath,
		...validated,
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
	capacityLaunch: ReturnType<typeof loadCapacityManifestFromPath>;
	dev: ReturnType<typeof loadTreeseedDevManifest>;
	envRegistry: ReturnType<typeof collectTreeseedEnvironmentContext> | null;
} {
	const tenantRoot = resolve(input.tenantRoot);
	const deployConfigPath = resolveTreeseedDeployConfigPathFromRoot(tenantRoot);
	const deployConfig = loadTreeseedDeployConfigFromPath(deployConfigPath);
	const packages = discoverPlatformPackages(tenantRoot);
	const applications = discoverTreeseedApplications(tenantRoot);
	const explicitCapacityConfig = input.capacityConfigPath ?? input.env?.TREESEED_CAPACITY_PROVIDER_MANIFEST ?? input.env?.TREESEED_CAPACITY_CONFIG_PATH;
	const defaultCapacityConfig = resolve(tenantRoot, 'treeseed.capacity-provider.yaml');
	const capacityLaunch = explicitCapacityConfig
		? loadCapacityManifestFromPath(explicitCapacityConfig)
		: existsSync(defaultCapacityConfig)
			? loadCapacityManifestFromPath(defaultCapacityConfig)
			: null;
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
