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
import { CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER, TREESEED_DEFAULT_LONG_LIVED_CACHE_POLICY, TREESEED_DEFAULT_SOURCE_PAGE_PURGE_PATHS, cloudflareFieldAliases, cloudflarePagesFieldAliases, cloudflareR2FieldAliases, deployConfigFieldAliases, expectString, optionalBoolean, optionalCloudflareAccountId, optionalPositiveNumber, optionalRecord, optionalString, parseHostingConfig, parsePluginReferences } from './deploy-config-field-aliases.ts';
import { inferManagedRuntimeFromServices, parseConnectionsConfig, parseExportConfig, parseManagedServicesConfig, parsePlatformSurfacesConfig, parseProcessingConfig, parsePublicTreeDxFederationConfig } from './parse-public-tree-dx-federation-config.ts';
import { normalizeLegacyHostingFromPlanes, normalizePlanesFromLegacyHosting, parseHubConfig, parseProviderSelections, parseRuntimeConfig } from './normalize-planes-from-legacy-hosting.ts';

export function parseDeployConfig(raw: string): TreeseedDeployConfig {
	const parsed = normalizeAliasedRecord(
		deployConfigFieldAliases,
		(parseYaml(raw) ?? {}) as Record<string, unknown>,
	) as Record<string, unknown>;
	const cloudflare = normalizeAliasedRecord(
		cloudflareFieldAliases,
		(optionalRecord(parsed.cloudflare, 'cloudflare') ?? {}) as Record<string, unknown>,
	);
	const cloudflarePages = normalizeAliasedRecord(
		cloudflarePagesFieldAliases,
		(optionalRecord(cloudflare.pages, 'cloudflare.pages') ?? {}) as Record<string, unknown>,
	);
	const cloudflareR2 = normalizeAliasedRecord(
		cloudflareR2FieldAliases,
		(optionalRecord(cloudflare.r2, 'cloudflare.r2') ?? {}) as Record<string, unknown>,
	);
	const hosting = parseHostingConfig(parsed.hosting);
	const services = parseManagedServicesConfig(parsed.services);
	const processing = parseProcessingConfig(parsed.processing, services);
	const normalizedPlanes = normalizePlanesFromLegacyHosting(hosting);
	const inferredPlanes = !hosting && !parsed.hub && !parsed.runtime && inferManagedRuntimeFromServices(services)
		? {
			hub: { mode: 'customer_hosted' as const },
			runtime: { mode: 'treeseed_managed' as const, registration: 'none' as const },
		}
		: normalizedPlanes;
	const hub = parseHubConfig(parsed.hub, inferredPlanes.hub);
	const runtime = parseRuntimeConfig(parsed.runtime, inferredPlanes.runtime);
	const smtp = optionalRecord(parsed.smtp, 'smtp') ?? {};
	const turnstile = optionalRecord(parsed.turnstile, 'turnstile') ?? {};
	optionalBoolean(turnstile.enabled, 'turnstile.enabled');
	const normalizedHosting = normalizeLegacyHostingFromPlanes(hub, runtime);
	const compatibilityHosting = hosting?.kind === 'treeseed_control_plane'
		? { ...hosting, registration: 'none' as const }
		: hosting && !parsed.hub && !parsed.runtime
		? hosting
		: normalizedHosting;

	return {
		name: expectString(parsed.name, 'name'),
		slug: expectString(parsed.slug, 'slug'),
		siteUrl: expectString(parsed.siteUrl, 'siteUrl'),
		contactEmail: expectString(parsed.contactEmail, 'contactEmail'),
		projectRoot: optionalString(parsed.projectRoot),
		hosting: compatibilityHosting,
		hub,
		runtime,
		cloudflare: {
			accountId:
				optionalCloudflareAccountId(process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID)
				?? CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER,
			zoneId: optionalString(cloudflare.zoneId),
			workerName: optionalString(cloudflare.workerName),
			queueName: optionalString(cloudflare.queueName),
			dlqName: optionalString(cloudflare.dlqName),
			d1Binding: optionalString(cloudflare.d1Binding),
			queueBinding: optionalString(cloudflare.queueBinding),
			pages: cloudflare.pages === undefined
				? undefined
				: {
					projectName: optionalString(cloudflarePages.projectName) ?? optionalString(process.env.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME),
					previewProjectName: optionalString(process.env.TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME)
						?? optionalString(cloudflarePages.previewProjectName)
						?? optionalString(cloudflarePages.projectName)
						?? optionalString(process.env.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME),
					productionBranch: optionalString(cloudflarePages.productionBranch) ?? 'main',
					stagingBranch: optionalString(cloudflarePages.stagingBranch) ?? 'staging',
					buildCommand: optionalString(cloudflarePages.buildCommand),
					buildOutputDir: optionalString(cloudflarePages.buildOutputDir),
				},
			r2: cloudflare.r2 === undefined
				? undefined
				: {
					binding: optionalString(process.env.TREESEED_CONTENT_BUCKET_BINDING) ?? optionalString(cloudflareR2.binding),
					bucketName: optionalString(process.env.TREESEED_CONTENT_BUCKET_NAME) ?? optionalString(cloudflareR2.bucketName),
					publicBaseUrl: optionalString(process.env.TREESEED_CONTENT_PUBLIC_BASE_URL) ?? optionalString(cloudflareR2.publicBaseUrl),
					manifestKeyTemplate: optionalString(cloudflareR2.manifestKeyTemplate) ?? 'teams/{teamId}/published/common.json',
					previewRootTemplate: optionalString(cloudflareR2.previewRootTemplate) ?? 'teams/{teamId}/previews',
					previewTtlHours: optionalPositiveNumber(cloudflareR2.previewTtlHours, 'cloudflare.r2.previewTtlHours') ?? 168,
				},
		},
		plugins: parsePluginReferences(parsed.plugins),
		providers: parseProviderSelections(parsed.providers),
		surfaces: parsePlatformSurfacesConfig(parsed.surfaces),
		services,
		publicTreeDxFederation: parsePublicTreeDxFederationConfig(parsed.publicTreeDxFederation),
		connections: parseConnectionsConfig(parsed.connections),
		processing,
		smtp: {
			enabled: optionalBoolean(smtp.enabled, 'smtp.enabled'),
		},
		turnstile: {
			enabled: optionalBoolean(turnstile.enabled, 'turnstile.enabled') ?? false,
		},
		export: parseExportConfig(parsed.export),
	};
}

export function resolveTreeseedDeployConfigPath(configPath = 'treeseed.site.yaml') {
	const tenantRoot = resolveTreeseedTenantRoot();
	return resolveTreeseedDeployConfigPathFromRoot(tenantRoot, configPath);
}

export function resolveTreeseedDeployConfigPathFromRoot(tenantRoot: string, configPath = 'treeseed.site.yaml') {
	const candidate = resolve(tenantRoot, configPath);
	if (!existsSync(candidate)) {
		throw new Error(`Unable to resolve Treeseed deploy config at "${candidate}".`);
	}
	return candidate;
}

export function deriveCloudflareWorkerName(config: TreeseedDeployConfig) {
	return config.cloudflare.workerName?.trim() || config.slug;
}

export function resolveLongLivedCachePolicy(configured: TreeseedWebCachePolicyConfig | undefined): Required<TreeseedWebCachePolicyConfig> {
	return {
		browserTtlSeconds: configured?.browserTtlSeconds ?? TREESEED_DEFAULT_LONG_LIVED_CACHE_POLICY.browserTtlSeconds,
		edgeTtlSeconds: configured?.edgeTtlSeconds ?? TREESEED_DEFAULT_LONG_LIVED_CACHE_POLICY.edgeTtlSeconds,
		staleWhileRevalidateSeconds:
			configured?.staleWhileRevalidateSeconds ?? TREESEED_DEFAULT_LONG_LIVED_CACHE_POLICY.staleWhileRevalidateSeconds,
		staleIfErrorSeconds: configured?.staleIfErrorSeconds ?? TREESEED_DEFAULT_LONG_LIVED_CACHE_POLICY.staleIfErrorSeconds,
	};
}

export function resolveTreeseedWebCachePolicy(config: TreeseedDeployConfig) {
	const cache = config.surfaces?.web?.cache ?? {};
	const sourcePages = cache.sourcePages as TreeseedWebSourcePageCacheConfig | undefined;
	return {
		sourcePages: {
			...resolveLongLivedCachePolicy(sourcePages),
			paths: [...new Set(sourcePages?.paths ?? TREESEED_DEFAULT_SOURCE_PAGE_PURGE_PATHS)],
		},
		contentPages: resolveLongLivedCachePolicy(cache.contentPages),
		r2PublishedObjects: resolveLongLivedCachePolicy(cache.r2PublishedObjects),
	};
}

export function loadTreeseedDeployConfig(configPath = 'treeseed.site.yaml'): TreeseedDeployConfig {
	const resolvedConfigPath = resolveTreeseedDeployConfigPath(configPath);
	return loadTreeseedDeployConfigFromPath(resolvedConfigPath);
}

export function loadTreeseedDeployConfigFromPath(resolvedConfigPath: string): TreeseedDeployConfig {
	const tenantRoot = dirname(resolvedConfigPath);
	const parsed = parseDeployConfig(readFileSync(resolvedConfigPath, 'utf8'));
	const projectRoot = parsed.projectRoot ? resolve(tenantRoot, parsed.projectRoot) : tenantRoot;

	Object.defineProperty(parsed, '__tenantRoot', {
		value: tenantRoot,
		enumerable: false,
	});

	Object.defineProperty(parsed, '__projectRoot', {
		value: projectRoot,
		enumerable: false,
	});

	Object.defineProperty(parsed, '__configPath', {
		value: resolvedConfigPath,
		enumerable: false,
	});

	return parsed;
}
