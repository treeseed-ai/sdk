import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TreeseedFieldAliasRegistry } from '../../field-aliases.ts';
import { normalizeAliasedRecord } from '../../field-aliases.ts';
import type {
	TreeseedDeployConfig,
	TreeseedExportConfig,
	TreeseedHubConfig,
	TreeseedLocalRuntimeConfig,
	TreeseedManagedServiceConfig,
	TreeseedManagedServicesConfig,
	TreeseedPlatformSurfacesConfig,
	TreeseedProcessingConfig,
	TreeseedPluginReference,
	TreeseedProviderSelections,
	TreeseedRuntimeConfig,
	TreeseedWebCachePolicyConfig,
	TreeseedWebSourcePageCacheConfig,
} from '../contracts.ts';
import { resolveTreeseedTenantRoot } from '../tenant-config.ts';
import {
	TREESEED_DEFAULT_PLUGIN_REFERENCES,
	TREESEED_DEFAULT_PROVIDER_SELECTIONS,
} from '../plugins/constants.ts';
import { TREESEED_DEFAULT_SOURCE_PAGE_PURGE_PATHS, optionalBoolean, optionalEnum, optionalNonNegativeNumber, optionalPositiveNumber, optionalRecord, optionalString, optionalStringArray, processingFieldAliases, webCachePolicyFieldAliases, webSurfaceCacheFieldAliases } from './deploy-config-field-aliases.ts';
import { parseLocalRuntimeConfig, parseManagedServiceConfig, parseServiceEnvironmentConfig } from './normalize-planes-from-legacy-hosting.ts';

export function parsePublicTreeDxFederationConfig(value: unknown) {
	const record = optionalRecord(value, 'publicTreeDxFederation');
	if (!record) {
		return undefined;
	}
	const railway = optionalRecord(record.railway, 'publicTreeDxFederation.railway') ?? {};
	const nodePool = optionalRecord(railway.nodePool, 'publicTreeDxFederation.railway.nodePool') ?? {};
	return {
		railway: {
			nodePool: {
				bootstrapCount: optionalPositiveNumber(
					nodePool.bootstrapCount,
					'publicTreeDxFederation.railway.nodePool.bootstrapCount',
				),
				maxNodes: optionalPositiveNumber(
					nodePool.maxNodes,
					'publicTreeDxFederation.railway.nodePool.maxNodes',
				),
			},
		},
	};
}

export function parseManagedServicesConfig(value: unknown): TreeseedManagedServicesConfig | undefined {
	const record = optionalRecord(value, 'services');
	if (!record) {
		return undefined;
	}
	return Object.fromEntries(
		Object.entries(record).map(([serviceKey, serviceValue]) => [
			serviceKey,
			parseManagedServiceConfig(serviceValue, `services.${serviceKey}`),
		]),
	);
}

export function parseProcessingConfig(value: unknown, services: TreeseedManagedServicesConfig | undefined): TreeseedProcessingConfig {
	const record = normalizeAliasedRecord(
		processingFieldAliases,
		(optionalRecord(value, 'processing') ?? {}) as Record<string, unknown>,
	);
	const hasProcessingServices = Object.entries(services ?? {}).some(([serviceKey, service]) =>
		['api', 'manager', 'worker', 'workerRunner', 'workdayStart', 'workdayReport'].includes(serviceKey)
		&& service
		&& service.enabled !== false
	);
	return {
		mode: optionalEnum(record.mode, 'processing.mode', [
			'market-assigned',
			'team-owned',
			'project-owned',
			'local',
			'none',
		] as const) ?? (hasProcessingServices ? 'project-owned' : 'market-assigned'),
		providerRef: optionalString(record.providerRef),
		requiredCapabilities: optionalStringArray(record.requiredCapabilities, 'processing.requiredCapabilities'),
	};
}

export function parseConnectionsConfig(value: unknown) {
	const record = optionalRecord(value, 'connections') ?? {};
	const api = optionalRecord(record.api, 'connections.api');
	if (!api) {
		return Object.keys(record).length > 0 ? record as Record<string, unknown> : undefined;
	}
	const environmentsRaw = optionalRecord(api.environments, 'connections.api.environments') ?? {};
	const environments = Object.fromEntries(
		(['local', 'staging', 'prod'] as const).map((scope) => {
			const environment = optionalRecord(environmentsRaw[scope], `connections.api.environments.${scope}`);
			return [scope, environment ? {
				baseUrl: optionalString(environment.baseUrl),
				domain: optionalString(environment.domain),
			} : undefined];
		}).filter(([, environment]) => environment),
	);
	return {
		...record,
		api: {
			proxyPrefix: optionalString(api.proxyPrefix),
			localBaseUrl: optionalString(api.localBaseUrl),
			environments,
		},
	};
}

export function inferManagedRuntimeFromServices(services: TreeseedManagedServicesConfig | undefined) {
	return Object.values(services ?? {}).some((service) =>
		service && service.enabled !== false && (service.provider ?? 'railway') === 'railway',
	);
}

export function parsePlatformSurfaceConfig(
	value: unknown,
	label: string,
) {
	const record = optionalRecord(value, label);
	if (!record) {
		return undefined;
	}

	return {
		enabled: record.enabled === undefined ? undefined : optionalBoolean(record.enabled, `${label}.enabled`),
		provider: optionalString(record.provider),
		rootDir: optionalString(record.rootDir),
		publicBaseUrl: optionalString(record.publicBaseUrl),
		localBaseUrl: optionalString(record.localBaseUrl),
		local: parseLocalRuntimeConfig(record.local, `${label}.local`),
		environments: (() => {
			const environments = optionalRecord(record.environments, `${label}.environments`);
			if (!environments) {
				return undefined;
			}
			return {
				local: parseServiceEnvironmentConfig(environments.local, `${label}.environments.local`),
				staging: parseServiceEnvironmentConfig(environments.staging, `${label}.environments.staging`),
				prod: parseServiceEnvironmentConfig(environments.prod, `${label}.environments.prod`),
			};
		})(),
		cache: parseWebSurfaceCacheConfig(record.cache, `${label}.cache`),
	};
}

export function parseWebSurfaceCacheConfig(value: unknown, label: string) {
	const record = normalizeAliasedRecord(
		webSurfaceCacheFieldAliases,
		(optionalRecord(value, label) ?? {}) as Record<string, unknown>,
	);
	if (!value || Object.keys(record).length === 0) {
		return undefined;
	}

	return {
		sourcePages: parseWebCachePolicyRecord(record.sourcePages, `${label}.sourcePages`, {
			paths: TREESEED_DEFAULT_SOURCE_PAGE_PURGE_PATHS,
		}),
		contentPages: parseWebCachePolicyRecord(record.contentPages, `${label}.contentPages`),
		r2PublishedObjects: parseWebCachePolicyRecord(record.r2PublishedObjects, `${label}.r2PublishedObjects`),
	};
}

export function parseWebCachePolicyRecord(
	value: unknown,
	label: string,
	options: { paths?: string[] } = {},
) {
	const record = normalizeAliasedRecord(
		webCachePolicyFieldAliases,
		(optionalRecord(value, label) ?? {}) as Record<string, unknown>,
	);
	if (!value || Object.keys(record).length === 0) {
		return options.paths ? { paths: [...options.paths] } : undefined;
	}

	const parsed = {
		browserTtlSeconds: optionalNonNegativeNumber(record.browserTtlSeconds, `${label}.browserTtlSeconds`),
		edgeTtlSeconds: optionalNonNegativeNumber(record.edgeTtlSeconds, `${label}.edgeTtlSeconds`),
		staleWhileRevalidateSeconds: optionalNonNegativeNumber(
			record.staleWhileRevalidateSeconds,
			`${label}.staleWhileRevalidateSeconds`,
		),
		staleIfErrorSeconds: optionalNonNegativeNumber(record.staleIfErrorSeconds, `${label}.staleIfErrorSeconds`),
	} as TreeseedWebCachePolicyConfig & { paths?: string[] };

	if (options.paths) {
		parsed.paths = [...new Set(optionalStringArray(record.paths, `${label}.paths`) ?? options.paths)];
	}

	return parsed;
}

export function parsePlatformSurfacesConfig(value: unknown): TreeseedPlatformSurfacesConfig | undefined {
	const record = optionalRecord(value, 'surfaces');
	if (!record) {
		return undefined;
	}

	return Object.fromEntries(
		Object.entries(record).map(([surfaceKey, surfaceValue]) => [
			surfaceKey,
			parsePlatformSurfaceConfig(surfaceValue, `surfaces.${surfaceKey}`),
		]),
	);
}

export function parseExportConfig(value: unknown): TreeseedExportConfig | undefined {
	const record = optionalRecord(value, 'export');
	if (!record) {
		return undefined;
	}

	return {
		ignore: optionalStringArray(record.ignore, 'export.ignore'),
		bundledPaths: optionalStringArray(record.bundledPaths, 'export.bundledPaths'),
	};
}
