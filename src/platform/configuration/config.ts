import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateAndDigestCapacityProviderManifest } from '../../capacity-provider/index.ts';
import { discoverApplications } from '../../hosting/apps.ts';
import { discoverPackageAdapters } from '../../operations/services/reconciliation/package-adapters.ts';
import { collectEnvironmentContext } from '../../operations/services/configuration/config-runtime.ts';
import { loadDeployConfigFromPath, resolveDeployConfigPathFromRoot } from '../hosting/deploy-config.ts';
import type { DeployConfig } from '../support/contracts.ts';

export type PlatformConfigInput = {
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

function loadDevManifest(tenantRoot: string) {
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

function discoverPlatformPackages(tenantRoot: string): ReturnType<typeof discoverPackageAdapters> {
	if (!existsSync(resolve(tenantRoot, 'package.json'))) {
		return [];
	}
	return discoverPackageAdapters(tenantRoot);
}

export function loadPlatformConfig(input: PlatformConfigInput): {
	tenantRoot: string;
	environment: 'local' | 'staging' | 'prod';
	deployConfig: DeployConfig;
	packages: ReturnType<typeof discoverPackageAdapters>;
	applications: ReturnType<typeof discoverApplications>;
	capacityLaunch: ReturnType<typeof loadCapacityManifestFromPath>;
	dev: ReturnType<typeof loadDevManifest>;
	envRegistry: ReturnType<typeof collectEnvironmentContext> | null;
} {
	const tenantRoot = resolve(input.tenantRoot);
	const deployConfigPath = resolveDeployConfigPathFromRoot(tenantRoot);
	const deployConfig = loadDeployConfigFromPath(deployConfigPath);
	const packages = discoverPlatformPackages(tenantRoot);
	const applications = discoverApplications(tenantRoot);
	const explicitCapacityConfig = input.capacityConfigPath ?? input.env?.TREESEED_CAPACITY_PROVIDER_MANIFEST ?? input.env?.TREESEED_CAPACITY_CONFIG_PATH;
	const defaultCapacityConfig = resolve(tenantRoot, 'treeseed.capacity-provider.yaml');
	const capacityLaunch = explicitCapacityConfig
		? loadCapacityManifestFromPath(explicitCapacityConfig)
		: existsSync(defaultCapacityConfig)
			? loadCapacityManifestFromPath(defaultCapacityConfig)
			: null;
	const dev = loadDevManifest(tenantRoot);
	let envRegistry = null;
	try {
		envRegistry = collectEnvironmentContext(tenantRoot, input.environment, { env: input.env });
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
