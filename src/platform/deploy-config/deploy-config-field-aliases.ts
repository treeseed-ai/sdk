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


export const deployConfigFieldAliases: TreeseedFieldAliasRegistry = {
	siteUrl: { key: 'siteUrl', aliases: ['site_url'] },
	contactEmail: { key: 'contactEmail', aliases: ['contact_email'] },
	projectRoot: { key: 'projectRoot', aliases: ['project_root'] },
};

export const hostingFieldAliases: TreeseedFieldAliasRegistry = {
	kind: { key: 'kind', aliases: ['kind'] },
	registration: { key: 'registration', aliases: ['registration'] },
	marketBaseUrl: { key: 'marketBaseUrl', aliases: ['market_base_url'] },
	teamId: { key: 'teamId', aliases: ['team_id'] },
	projectId: { key: 'projectId', aliases: ['project_id'] },
};

export const hubFieldAliases: TreeseedFieldAliasRegistry = {
	mode: { key: 'mode', aliases: ['mode'] },
};

export const runtimeFieldAliases: TreeseedFieldAliasRegistry = {
	mode: { key: 'mode', aliases: ['mode'] },
	registration: { key: 'registration', aliases: ['registration'] },
	marketBaseUrl: { key: 'marketBaseUrl', aliases: ['market_base_url'] },
	teamId: { key: 'teamId', aliases: ['team_id'] },
	projectId: { key: 'projectId', aliases: ['project_id'] },
};

export const processingFieldAliases: TreeseedFieldAliasRegistry = {
	mode: { key: 'mode', aliases: ['mode'] },
	providerRef: { key: 'providerRef', aliases: ['provider_ref', 'providerRef'] },
	requiredCapabilities: { key: 'requiredCapabilities', aliases: ['required_capabilities', 'requiredCapabilities'] },
};

export const cloudflareFieldAliases: TreeseedFieldAliasRegistry = {
	accountId: { key: 'accountId', aliases: ['account_id'] },
	zoneId: { key: 'zoneId', aliases: ['zone_id'] },
	workerName: { key: 'workerName', aliases: ['worker_name'] },
	queueName: { key: 'queueName', aliases: ['queue_name'] },
	dlqName: { key: 'dlqName', aliases: ['dlq_name'] },
	d1Binding: { key: 'd1Binding', aliases: ['d1_binding'] },
	queueBinding: { key: 'queueBinding', aliases: ['queue_binding'] },
};

export const cloudflarePagesFieldAliases: TreeseedFieldAliasRegistry = {
	projectName: { key: 'projectName', aliases: ['project_name'] },
	previewProjectName: { key: 'previewProjectName', aliases: ['preview_project_name'] },
	productionBranch: { key: 'productionBranch', aliases: ['production_branch'] },
	stagingBranch: { key: 'stagingBranch', aliases: ['staging_branch'] },
	buildOutputDir: { key: 'buildOutputDir', aliases: ['build_output_dir'] },
};

export const cloudflareR2FieldAliases: TreeseedFieldAliasRegistry = {
	binding: { key: 'binding', aliases: ['binding'] },
	bucketName: { key: 'bucketName', aliases: ['bucket_name'] },
	publicBaseUrl: { key: 'publicBaseUrl', aliases: ['public_base_url'] },
	manifestKeyTemplate: { key: 'manifestKeyTemplate', aliases: ['manifest_key_template', 'manifest_key'] },
	previewRootTemplate: { key: 'previewRootTemplate', aliases: ['preview_root_template', 'preview_root'] },
	previewTtlHours: { key: 'previewTtlHours', aliases: ['preview_ttl_hours'] },
};

export const webSurfaceCacheFieldAliases: TreeseedFieldAliasRegistry = {
	sourcePages: { key: 'sourcePages', aliases: ['source_pages'] },
	contentPages: { key: 'contentPages', aliases: ['content_pages'] },
	r2PublishedObjects: { key: 'r2PublishedObjects', aliases: ['r2_published_objects'] },
};

export const localRuntimeFieldAliases: TreeseedFieldAliasRegistry = {
	runtime: { key: 'runtime', aliases: ['runtime', 'runtime_mode', 'runtimeMode'] },
};

export const webCachePolicyFieldAliases: TreeseedFieldAliasRegistry = {
	browserTtlSeconds: { key: 'browserTtlSeconds', aliases: ['browser_ttl_seconds'] },
	edgeTtlSeconds: { key: 'edgeTtlSeconds', aliases: ['edge_ttl_seconds'] },
	staleWhileRevalidateSeconds: { key: 'staleWhileRevalidateSeconds', aliases: ['stale_while_revalidate_seconds'] },
	staleIfErrorSeconds: { key: 'staleIfErrorSeconds', aliases: ['stale_if_error_seconds'] },
	paths: { key: 'paths', aliases: ['paths'] },
};

export const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';

export const TREESEED_DEFAULT_SOURCE_PAGE_PURGE_PATHS = ['/', '/contact', '/404'];

export const TREESEED_DEFAULT_LONG_LIVED_CACHE_POLICY: Required<TreeseedWebCachePolicyConfig> = {
	browserTtlSeconds: 0,
	edgeTtlSeconds: 31536000,
	staleWhileRevalidateSeconds: 86400,
	staleIfErrorSeconds: 86400,
};

export function expectString(value: unknown, label: string) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`Invalid deploy config: expected ${label} to be a non-empty string.`);
	}

	return value.trim();
}

export function optionalString(value: unknown) {
	if (typeof value !== 'string' || !value.trim()) {
		return undefined;
	}

	return value.trim();
}

export function optionalCloudflareAccountId(value: unknown) {
	const accountId = optionalString(value);
	return accountId === CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER ? undefined : accountId;
}

export function optionalPositiveNumber(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
		throw new Error(`Invalid deploy config: expected ${label} to be a positive number when provided.`);
	}

	return value;
}

export function optionalNonNegativeNumber(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw new Error(`Invalid deploy config: expected ${label} to be a non-negative number when provided.`);
	}

	return value;
}

export function optionalEnum<TValue extends string>(value: unknown, label: string, allowed: readonly TValue[]) {
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

export function optionalBoolean(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'boolean') {
		throw new Error(`Invalid deploy config: expected ${label} to be a boolean when provided.`);
	}

	return value;
}

export function optionalStringArray(value: unknown, label: string) {
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

export function optionalRecord(value: unknown, label: string) {
	if (value === undefined || value === null) {
		return undefined;
	}

	if (typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Invalid deploy config: expected ${label} to be an object when provided.`);
	}

	return value as Record<string, unknown>;
}

export function parsePluginReferences(value: unknown): TreeseedPluginReference[] {
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

export function parseHostingConfig(value: unknown) {
	const record = normalizeAliasedRecord(
		hostingFieldAliases,
		(optionalRecord(value, 'hosting') ?? {}) as Record<string, unknown>,
	);
	if (!value || Object.keys(record).length === 0) {
		return undefined;
	}

	return {
		kind: optionalEnum(record.kind, 'hosting.kind', [
			'treeseed_control_plane',
			'hosted_project',
			'self_hosted_project',
		] as const) ?? 'self_hosted_project',
		registration: optionalEnum(record.registration, 'hosting.registration', ['optional', 'none'] as const) ?? 'none',
		marketBaseUrl: optionalString(process.env.TREESEED_API_BASE_URL) ?? optionalString(record.marketBaseUrl),
		teamId: optionalString(process.env.TREESEED_HOSTING_TEAM_ID) ?? optionalString(record.teamId),
		projectId: optionalString(process.env.TREESEED_PROJECT_ID) ?? optionalString(record.projectId),
	};
}
