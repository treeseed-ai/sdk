import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { TreeseedFieldAliasRegistry } from '../../field-aliases.ts';
import { normalizeAliasedRecord } from '../../field-aliases.ts';
import type {
	TreeseedDeployConfig,
	TreeseedManagedServiceConfig,
	TreeseedManagedServicesConfig,
	TreeseedPluginReference,
	TreeseedProviderSelections,
} from '../contracts.ts';
import { resolveTreeseedTenantRoot } from '../tenant/config.ts';
import {
	TREESEED_DEFAULT_PLUGIN_REFERENCES,
	TREESEED_DEFAULT_PROVIDER_SELECTIONS,
} from '../plugins/constants.ts';

const deployConfigFieldAliases: TreeseedFieldAliasRegistry = {
	siteUrl: { key: 'siteUrl', aliases: ['site_url'] },
	contactEmail: { key: 'contactEmail', aliases: ['contact_email'] },
};

const cloudflareFieldAliases: TreeseedFieldAliasRegistry = {
	accountId: { key: 'accountId', aliases: ['account_id'] },
	workerName: { key: 'workerName', aliases: ['worker_name'] },
};

const CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER = 'replace-with-cloudflare-account-id';

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

function optionalBoolean(value: unknown, label: string) {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'boolean') {
		throw new Error(`Invalid deploy config: expected ${label} to be a boolean when provided.`);
	}

	return value;
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
			docs: expectString(
				contentProviders.docs ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.docs,
				'providers.content.docs',
			),
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
	return {
		api: parseManagedServiceConfig(record.api, 'services.api'),
		agents: parseManagedServiceConfig(record.agents, 'services.agents'),
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
	const smtp = optionalRecord(parsed.smtp, 'smtp') ?? {};
	const turnstile = optionalRecord(parsed.turnstile, 'turnstile') ?? {};
	optionalBoolean(turnstile.enabled, 'turnstile.enabled');

	return {
		name: expectString(parsed.name, 'name'),
		slug: expectString(parsed.slug, 'slug'),
		siteUrl: expectString(parsed.siteUrl, 'siteUrl'),
		contactEmail: expectString(parsed.contactEmail, 'contactEmail'),
		cloudflare: {
			accountId:
				optionalCloudflareAccountId(cloudflare.accountId)
				?? optionalCloudflareAccountId(process.env.CLOUDFLARE_ACCOUNT_ID)
				?? CLOUDFLARE_ACCOUNT_ID_PLACEHOLDER,
			workerName: optionalString(cloudflare.workerName),
		},
		plugins: parsePluginReferences(parsed.plugins),
		providers: parseProviderSelections(parsed.providers),
		services: parseManagedServicesConfig(parsed.services),
		smtp: {
			enabled: optionalBoolean(smtp.enabled, 'smtp.enabled'),
		},
		turnstile: {
			enabled: true,
		},
	};
}

export function resolveTreeseedDeployConfigPath(configPath = 'treeseed.site.yaml') {
	const tenantRoot = resolveTreeseedTenantRoot();
	const candidate = resolve(tenantRoot, configPath);
	if (!existsSync(candidate)) {
		throw new Error(`Unable to resolve Treeseed deploy config at "${candidate}".`);
	}
	return candidate;
}

export function deriveCloudflareWorkerName(config: TreeseedDeployConfig) {
	return config.cloudflare.workerName?.trim() || config.slug;
}

export function loadTreeseedDeployConfig(configPath = 'treeseed.site.yaml'): TreeseedDeployConfig {
	const resolvedConfigPath = resolveTreeseedDeployConfigPath(configPath);
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
