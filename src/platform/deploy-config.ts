import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TreeseedFieldAliasRegistry } from '../field-aliases.ts';
import { normalizeAliasedRecord } from '../field-aliases.ts';
import type {
	TreeseedDeployConfig,
	TreeseedExportConfig,
	TreeseedHubConfig,
	TreeseedManagedServiceConfig,
	TreeseedManagedServicesConfig,
	TreeseedPlatformSurfacesConfig,
	TreeseedPluginReference,
	TreeseedProviderSelections,
	TreeseedRuntimeConfig,
	TreeseedWebCachePolicyConfig,
	TreeseedWebSourcePageCacheConfig,
} from './contracts.ts';
import { resolveTreeseedTenantRoot } from './tenant-config.ts';
import {
	TREESEED_DEFAULT_PLUGIN_REFERENCES,
	TREESEED_DEFAULT_PROVIDER_SELECTIONS,
} from './plugins/constants.ts';

const deployConfigFieldAliases: TreeseedFieldAliasRegistry = {
	siteUrl: { key: 'siteUrl', aliases: ['site_url'] },
	contactEmail: { key: 'contactEmail', aliases: ['contact_email'] },
};

const hostingFieldAliases: TreeseedFieldAliasRegistry = {
	kind: { key: 'kind', aliases: ['kind'] },
	registration: { key: 'registration', aliases: ['registration'] },
	marketBaseUrl: { key: 'marketBaseUrl', aliases: ['market_base_url'] },
	teamId: { key: 'teamId', aliases: ['team_id'] },
	projectId: { key: 'projectId', aliases: ['project_id'] },
};

const hubFieldAliases: TreeseedFieldAliasRegistry = {
	mode: { key: 'mode', aliases: ['mode'] },
};

const runtimeFieldAliases: TreeseedFieldAliasRegistry = {
	mode: { key: 'mode', aliases: ['mode'] },
	registration: { key: 'registration', aliases: ['registration'] },
	marketBaseUrl: { key: 'marketBaseUrl', aliases: ['market_base_url'] },
	teamId: { key: 'teamId', aliases: ['team_id'] },
	projectId: { key: 'projectId', aliases: ['project_id'] },
};

const cloudflareFieldAliases: TreeseedFieldAliasRegistry = {
	accountId: { key: 'accountId', aliases: ['account_id'] },
	zoneId: { key: 'zoneId', aliases: ['zone_id'] },
	workerName: { key: 'workerName', aliases: ['worker_name'] },
	queueName: { key: 'queueName', aliases: ['queue_name'] },
	dlqName: { key: 'dlqName', aliases: ['dlq_name'] },
	d1Binding: { key: 'd1Binding', aliases: ['d1_binding'] },
	queueBinding: { key: 'queueBinding', aliases: ['queue_binding'] },
};

const cloudflarePagesFieldAliases: TreeseedFieldAliasRegistry = {
	projectName: { key: 'projectName', aliases: ['project_name'] },
	previewProjectName: { key: 'previewProjectName', aliases: ['preview_project_name'] },
	productionBranch: { key: 'productionBranch', aliases: ['production_branch'] },
	stagingBranch: { key: 'stagingBranch', aliases: ['staging_branch'] },
	buildOutputDir: { key: 'buildOutputDir', aliases: ['build_output_dir'] },
};

const cloudflareR2FieldAliases: TreeseedFieldAliasRegistry = {
	binding: { key: 'binding', aliases: ['binding'] },
	bucketName: { key: 'bucketName', aliases: ['bucket_name'] },
	publicBaseUrl: { key: 'publicBaseUrl', aliases: ['public_base_url'] },
	manifestKeyTemplate: { key: 'manifestKeyTemplate', aliases: ['manifest_key_template', 'manifest_key'] },
	previewRootTemplate: { key: 'previewRootTemplate', aliases: ['preview_root_template', 'preview_root'] },
	previewTtlHours: { key: 'previewTtlHours', aliases: ['preview_ttl_hours'] },
};

const webSurfaceCacheFieldAliases: TreeseedFieldAliasRegistry = {
	sourcePages: { key: 'sourcePages', aliases: ['source_pages'] },
	contentPages: { key: 'contentPages', aliases: ['content_pages'] },
	r2PublishedObjects: { key: 'r2PublishedObjects', aliases: ['r2_published_objects'] },
};

const webCachePolicyFieldAliases: TreeseedFieldAliasRegistry = {
	browserTtlSeconds: { key: 'browserTtlSeconds', aliases: ['browser_ttl_seconds'] },
	edgeTtlSeconds: { key: 'edgeTtlSeconds', aliases: ['edge_ttl_seconds'] },
	staleWhileRevalidateSeconds: { key: 'staleWhileRevalidateSeconds', aliases: ['stale_while_revalidate_seconds'] },
	staleIfErrorSeconds: { key: 'staleIfErrorSeconds', aliases: ['stale_if_error_seconds'] },
	paths: { key: 'paths', aliases: ['paths'] },
};

const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';
const TREESEED_DEFAULT_SOURCE_PAGE_PURGE_PATHS = ['/', '/contact', '/404'];
const TREESEED_DEFAULT_LONG_LIVED_CACHE_POLICY: Required<TreeseedWebCachePolicyConfig> = {
	browserTtlSeconds: 0,
	edgeTtlSeconds: 31536000,
	staleWhileRevalidateSeconds: 86400,
	staleIfErrorSeconds: 86400,
};

function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Invalid deploy config: expected ${label} to be a non-empty string.`);
	}

	return value.trim();
}

function optionalString(value: unknown) {
	if (typeof value !== 'string' || !value.trim()) {
		return undefined;
	}

	return value.trim();
}

function optionalCloudflareAccountId(value: unknown) {
	const accountId = optionalString(value);
	return accountId === CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER ? undefined : accountId;
}

function optionalPositiveNumber(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new Error(`Invalid deploy config: expected ${label} to be a positive number when provided.`);
	}

	return value;
}

function optionalNonNegativeNumber(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid deploy config: expected ${label} to be a non-negative number when provided.`);
	}

	return value;
}

function optionalEnum<TValue extends string>(value: unknown, label: string, allowed: readonly TValue[]) {
	if (value === undefined) {
		return undefined;
	}

	const normalized = optionalString(value);
	if (!normalized) {
		return undefined;
	}

	if (!allowed.includes(normalized as TValue)) {
		throw new Error(`Invalid deploy config: expected ${label} to be one of ${allowed.join(', ')}.`);
	}

	return normalized as TValue;
}

function optionalBoolean(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'boolean') {
		throw new Error(`Invalid deploy config: expected ${label} to be a boolean when provided.`);
	}

	return value;
}

function optionalStringArray(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (!Array.isArray(value)) {
		throw new Error(`Invalid deploy config: expected ${label} to be an array of strings when provided.`);
	}

	return value
		.map((entry, index) => expectString(entry, `${label}[${index}]`))
		.filter(Boolean);
}

function optionalRecord(value: unknown, label: string) {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid deploy config: expected ${label} to be an object when provided.`);
	}

	return value as Record<string, unknown>;
}

function parsePluginReferences(value: unknown): TreeseedPluginReference[] {
	if (value === undefined) {
		return [...TREESEED_DEFAULT_PLUGIN_REFERENCES];
	}

	if (!Array.isArray(value)) {
		throw new Error('Invalid deploy config: expected plugins to be an array.');
	}

	return value.map((entry, index) => {
		const record = optionalRecord(entry, `plugins[${index}]`);
		return {
			package: expectString(record?.package, `plugins[${index}].package`),
			enabled: record?.enabled === undefined ? true : optionalBoolean(record.enabled, `plugins[${index}].enabled`),
			config: record?.config === undefined ? {} : optionalRecord(record.config, `plugins[${index}].config`),
		};
	});
}

function parseHostingConfig(value: unknown) {
	const record = normalizeAliasedRecord(
		hostingFieldAliases,
		(optionalRecord(value, 'hosting') ?? {}) as Record<string, unknown>,
	);
	if (!value || Object.keys(record).length === 0) {
		return undefined;
	}

	return {
		kind: optionalEnum(record.kind, 'hosting.kind', [
			'market_control_plane',
			'hosted_project',
			'self_hosted_project',
		] as const) ?? 'self_hosted_project',
		registration: optionalEnum(record.registration, 'hosting.registration', ['optional', 'none'] as const) ?? 'none',
		marketBaseUrl: optionalString(process.env.TREESEED_MARKET_API_BASE_URL) ?? optionalString(record.marketBaseUrl),
		teamId: optionalString(process.env.TREESEED_HOSTING_TEAM_ID) ?? optionalString(record.teamId),
		projectId: optionalString(process.env.TREESEED_PROJECT_ID) ?? optionalString(record.projectId),
	};
}

function normalizePlanesFromLegacyHosting(
	hosting: ReturnType<typeof parseHostingConfig> | undefined,
): { hub: TreeseedHubConfig; runtime: TreeseedRuntimeConfig } {
	if (!hosting) {
		return {
			hub: { mode: 'treeseed_hosted' },
			runtime: { mode: 'none', registration: 'none' },
		};
	}

	if (hosting.kind === 'market_control_plane' || hosting.kind === 'hosted_project') {
		return {
			hub: { mode: 'treeseed_hosted' },
			runtime: {
				mode: 'treeseed_managed',
				registration: hosting.kind === 'market_control_plane' ? 'none' : (hosting.registration ?? 'none'),
				marketBaseUrl: hosting.marketBaseUrl,
				teamId: hosting.teamId,
				projectId: hosting.projectId,
			},
		};
	}

	return {
		hub: { mode: 'customer_hosted' },
		runtime: {
			mode: 'byo_attached',
			registration: hosting.registration ?? 'none',
			marketBaseUrl: hosting.marketBaseUrl,
			teamId: hosting.teamId,
			projectId: hosting.projectId,
		},
	};
}

function normalizeLegacyHostingFromPlanes(hub: TreeseedHubConfig, runtime: TreeseedRuntimeConfig) {
	if (runtime.mode === 'treeseed_managed' && hub.mode === 'treeseed_hosted') {
		return {
			kind: 'hosted_project' as const,
			registration: runtime.registration === 'required' ? 'optional' : (runtime.registration ?? 'none'),
			marketBaseUrl: runtime.marketBaseUrl,
			teamId: runtime.teamId,
			projectId: runtime.projectId,
		};
	}

	return {
		kind: 'self_hosted_project' as const,
		registration: runtime.registration === 'required' ? 'optional' : (runtime.registration ?? 'none'),
		marketBaseUrl: runtime.marketBaseUrl,
		teamId: runtime.teamId,
		projectId: runtime.projectId,
	};
}

function parseHubConfig(value: unknown, fallback: TreeseedHubConfig): TreeseedHubConfig {
	const record = normalizeAliasedRecord(
		hubFieldAliases,
		(optionalRecord(value, 'hub') ?? {}) as Record<string, unknown>,
	);
	if (!value || Object.keys(record).length === 0) {
		return fallback;
	}

	return {
		mode: optionalEnum(record.mode, 'hub.mode', ['treeseed_hosted', 'customer_hosted'] as const) ?? fallback.mode,
	};
}

function parseRuntimeConfig(value: unknown, fallback: TreeseedRuntimeConfig): TreeseedRuntimeConfig {
	const record = normalizeAliasedRecord(
		runtimeFieldAliases,
		(optionalRecord(value, 'runtime') ?? {}) as Record<string, unknown>,
	);
	if (!value || Object.keys(record).length === 0) {
		return fallback;
	}

	return {
		mode: optionalEnum(record.mode, 'runtime.mode', ['none', 'byo_attached', 'treeseed_managed'] as const) ?? fallback.mode,
		registration: optionalEnum(record.registration, 'runtime.registration', ['optional', 'required', 'none'] as const)
			?? fallback.registration
			?? 'none',
		marketBaseUrl: optionalString(process.env.TREESEED_MARKET_API_BASE_URL) ?? fallback.marketBaseUrl,
		teamId: optionalString(process.env.TREESEED_HOSTING_TEAM_ID) ?? fallback.teamId,
		projectId: optionalString(process.env.TREESEED_PROJECT_ID) ?? fallback.projectId,
	};
}

function parseProviderSelections(value: unknown): TreeseedProviderSelections {
	const record = optionalRecord(value, 'providers');
	if (!record) {
		return structuredClone(TREESEED_DEFAULT_PROVIDER_SELECTIONS);
	}

	const agentProviders = optionalRecord(record.agents, 'providers.agents') ?? {};
	const contentProviders = optionalRecord(record.content, 'providers.content') ?? {};

	return {
		forms: expectString(record.forms ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.forms, 'providers.forms'),
		operations: expectString(record.operations ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.operations, 'providers.operations'),
		agents: {
			execution: expectString(
				agentProviders.execution ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.execution,
				'providers.agents.execution',
			),
			mutation: expectString(
				agentProviders.mutation ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.mutation,
				'providers.agents.mutation',
			),
			repository: expectString(
				agentProviders.repository ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.repository,
				'providers.agents.repository',
			),
			verification: expectString(
				agentProviders.verification ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.verification,
				'providers.agents.verification',
			),
			notification: expectString(
				agentProviders.notification ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.notification,
				'providers.agents.notification',
			),
			research: expectString(
				agentProviders.research ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents.research,
				'providers.agents.research',
			),
		},
		deploy: expectString(record.deploy ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.deploy, 'providers.deploy'),
		content: {
			runtime: expectString(
				contentProviders.runtime ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.runtime,
				'providers.content.runtime',
			),
			publish: expectString(
				contentProviders.publish
					?? contentProviders.runtime
					?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.publish,
				'providers.content.publish',
			),
			docs: expectString(
				contentProviders.docs
					?? contentProviders.runtime
					?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.docs
					?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.runtime,
				'providers.content.docs',
			),
			serving: optionalEnum(
				contentProviders.serving,
				'providers.content.serving',
				['local_collections', 'published_runtime'] as const,
			) ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.serving,
		},
		site: expectString(record.site ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.site, 'providers.site'),
	};
}

function parseServiceEnvironmentConfig(
	value: unknown,
	label: string,
) {
	const record = optionalRecord(value, label) ?? {};
	return {
		baseUrl: optionalString(record.baseUrl),
		domain: optionalString(record.domain),
		railwayEnvironment: optionalString(record.railwayEnvironment),
	};
}

function parseManagedServiceConfig(value: unknown, label: string): TreeseedManagedServiceConfig | undefined {
	const record = optionalRecord(value, label);
	if (!record) {
		return undefined;
	}
	const railway = optionalRecord(record.railway, `${label}.railway`) ?? {};
	const environments = optionalRecord(record.environments, `${label}.environments`) ?? {};
	return {
		enabled: record.enabled === undefined ? undefined : optionalBoolean(record.enabled, `${label}.enabled`),
		provider: optionalString(record.provider),
		rootDir: optionalString(record.rootDir),
		publicBaseUrl: optionalString(record.publicBaseUrl),
		railway: {
			projectId: optionalString(railway.projectId),
			projectName: optionalString(railway.projectName),
			serviceId: optionalString(railway.serviceId),
			serviceName: optionalString(railway.serviceName),
			rootDir: optionalString(railway.rootDir),
			buildCommand: optionalString(railway.buildCommand),
			startCommand: optionalString(railway.startCommand),
			schedule: Array.isArray(railway.schedule)
				? railway.schedule.map((entry) => optionalString(entry)).filter(Boolean)
				: optionalString(railway.schedule),
		},
		environments: {
			local: parseServiceEnvironmentConfig(environments.local, `${label}.environments.local`),
			staging: parseServiceEnvironmentConfig(environments.staging, `${label}.environments.staging`),
			prod: parseServiceEnvironmentConfig(environments.prod, `${label}.environments.prod`),
		},
	};
}

function parseManagedServicesConfig(value: unknown): TreeseedManagedServicesConfig | undefined {
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

function inferManagedRuntimeFromServices(services: TreeseedManagedServicesConfig | undefined) {
	return Object.values(services ?? {}).some((service) =>
		service && service.enabled !== false && (service.provider ?? 'railway') === 'railway',
	);
}

function parsePlatformSurfaceConfig(
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
		cache: parseWebSurfaceCacheConfig(record.cache, `${label}.cache`),
	};
}

function parseWebSurfaceCacheConfig(value: unknown, label: string) {
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

function parseWebCachePolicyRecord(
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

function parsePlatformSurfacesConfig(value: unknown): TreeseedPlatformSurfacesConfig | undefined {
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

function parseExportConfig(value: unknown): TreeseedExportConfig | undefined {
	const record = optionalRecord(value, 'export');
	if (!record) {
		return undefined;
	}

	return {
		ignore: optionalStringArray(record.ignore, 'export.ignore'),
		bundledPaths: optionalStringArray(record.bundledPaths, 'export.bundledPaths'),
	};
}

function parseDeployConfig(raw: string): TreeseedDeployConfig {
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
	const compatibilityHosting = hosting && !parsed.hub && !parsed.runtime
		? hosting
		: normalizedHosting;

	return {
		name: expectString(parsed.name, 'name'),
		slug: expectString(parsed.slug, 'slug'),
		siteUrl: expectString(parsed.siteUrl, 'siteUrl'),
		contactEmail: expectString(parsed.contactEmail, 'contactEmail'),
		hosting: compatibilityHosting,
		hub,
		runtime,
		cloudflare: {
			accountId:
				optionalCloudflareAccountId(process.env.CLOUDFLARE_ACCOUNT_ID)
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
					projectName: optionalString(process.env.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME) ?? optionalString(cloudflarePages.projectName),
					previewProjectName: optionalString(process.env.TREESEED_CLOUDFLARE_PAGES_PREVIEW_PROJECT_NAME) ?? optionalString(cloudflarePages.previewProjectName),
					productionBranch: optionalString(cloudflarePages.productionBranch) ?? 'main',
					stagingBranch: optionalString(cloudflarePages.stagingBranch) ?? 'staging',
					buildOutputDir: optionalString(cloudflarePages.buildOutputDir),
				},
			r2: cloudflare.r2 === undefined
				? undefined
				: {
					binding: optionalString(process.env.TREESEED_CONTENT_BUCKET_BINDING),
					bucketName: optionalString(process.env.TREESEED_CONTENT_BUCKET_NAME),
					publicBaseUrl: optionalString(process.env.TREESEED_CONTENT_PUBLIC_BASE_URL),
					manifestKeyTemplate: optionalString(cloudflareR2.manifestKeyTemplate) ?? 'teams/{teamId}/published/common.json',
					previewRootTemplate: optionalString(cloudflareR2.previewRootTemplate) ?? 'teams/{teamId}/previews',
					previewTtlHours: optionalPositiveNumber(cloudflareR2.previewTtlHours, 'cloudflare.r2.previewTtlHours') ?? 168,
				},
		},
		plugins: parsePluginReferences(parsed.plugins),
		providers: parseProviderSelections(parsed.providers),
		surfaces: parsePlatformSurfacesConfig(parsed.surfaces),
		services,
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

function resolveLongLivedCachePolicy(configured: TreeseedWebCachePolicyConfig | undefined): Required<TreeseedWebCachePolicyConfig> {
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

	Object.defineProperty(parsed, '__tenantRoot', {
		value: tenantRoot,
		enumerable: false,
	});

	Object.defineProperty(parsed, '__configPath', {
		value: resolvedConfigPath,
		enumerable: false,
	});

	return parsed;
}
