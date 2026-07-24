import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { FieldAliasRegistry } from '../../entrypoints/models/field-aliases.ts';
import { normalizeAliasedRecord } from '../../entrypoints/models/field-aliases.ts';
import type {
	DeployConfig,
	ExportConfig,
	HubConfig,
	LocalRuntimeConfig,
	ManagedServiceConfig,
	ManagedServicesConfig,
	PlatformSurfacesConfig,
	ProcessingConfig,
	PluginReference,
	ProviderSelections,
	RuntimeConfig,
	WebCachePolicyConfig,
	WebSourcePageCacheConfig,
} from '../support/contracts.ts';
import { resolveTenantRoot } from '../configuration/tenant-config.ts';
import {
	DEFAULT_PLUGIN_REFERENCES,
	DEFAULT_PROVIDER_SELECTIONS,
} from '../plugins/constants.ts';
import { expectString, hubFieldAliases, localRuntimeFieldAliases, optionalBoolean, optionalEnum, optionalPositiveNumber, optionalRecord, optionalString, optionalStringArray, parseHostingConfig, runtimeFieldAliases } from './deploy-config-field-aliases.ts';

export function normalizePlanesFromLegacyHosting(
	hosting: ReturnType<typeof parseHostingConfig> | undefined,
): { hub: HubConfig; runtime: RuntimeConfig } {
	if (!hosting) {
		return {
			hub: { mode: 'treeseed_hosted' },
			runtime: { mode: 'none', registration: 'none' },
		};
	}

	if (hosting.kind === 'treeseed_control_plane' || hosting.kind === 'hosted_project') {
		return {
			hub: { mode: 'treeseed_hosted' },
			runtime: {
				mode: 'treeseed_managed',
				registration: hosting.kind === 'treeseed_control_plane' ? 'none' : (hosting.registration ?? 'none'),
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

export function normalizeLegacyHostingFromPlanes(hub: HubConfig, runtime: RuntimeConfig) {
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

export function parseHubConfig(value: unknown, fallback: HubConfig): HubConfig {
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

export function parseRuntimeConfig(value: unknown, fallback: RuntimeConfig): RuntimeConfig {
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
		marketBaseUrl: optionalString(process.env.TREESEED_API_BASE_URL) ?? fallback.marketBaseUrl,
		teamId: optionalString(process.env.TREESEED_HOSTING_TEAM_ID) ?? fallback.teamId,
		projectId: optionalString(process.env.TREESEED_PROJECT_ID) ?? fallback.projectId,
	};
}

export function parseProviderSelections(value: unknown): ProviderSelections {
	const record = optionalRecord(value, 'providers');
	if (!record) {
		return structuredClone(DEFAULT_PROVIDER_SELECTIONS);
	}

	const agentProviders = optionalRecord(record.agents, 'providers.agents') ?? {};
	const contentProviders = optionalRecord(record.content, 'providers.content') ?? {};

	return {
		forms: expectString(record.forms ?? DEFAULT_PROVIDER_SELECTIONS.forms, 'providers.forms'),
		operations: expectString(record.operations ?? DEFAULT_PROVIDER_SELECTIONS.operations, 'providers.operations'),
		agents: {
			execution: expectString(
				agentProviders.execution ?? DEFAULT_PROVIDER_SELECTIONS.agents.execution,
				'providers.agents.execution',
			),
			mutation: expectString(
				agentProviders.mutation ?? DEFAULT_PROVIDER_SELECTIONS.agents.mutation,
				'providers.agents.mutation',
			),
			repository: expectString(
				agentProviders.repository ?? DEFAULT_PROVIDER_SELECTIONS.agents.repository,
				'providers.agents.repository',
			),
			verification: expectString(
				agentProviders.verification ?? DEFAULT_PROVIDER_SELECTIONS.agents.verification,
				'providers.agents.verification',
			),
			notification: expectString(
				agentProviders.notification ?? DEFAULT_PROVIDER_SELECTIONS.agents.notification,
				'providers.agents.notification',
			),
			research: expectString(
				agentProviders.research ?? DEFAULT_PROVIDER_SELECTIONS.agents.research,
				'providers.agents.research',
			),
		},
		deploy: expectString(record.deploy ?? DEFAULT_PROVIDER_SELECTIONS.deploy, 'providers.deploy'),
		dns: expectString(record.dns ?? DEFAULT_PROVIDER_SELECTIONS.dns, 'providers.dns'),
		content: {
			runtime: expectString(
				contentProviders.runtime ?? DEFAULT_PROVIDER_SELECTIONS.content.runtime,
				'providers.content.runtime',
			),
			publish: expectString(
				contentProviders.publish
					?? contentProviders.runtime
					?? DEFAULT_PROVIDER_SELECTIONS.content.publish,
				'providers.content.publish',
			),
			docs: expectString(
				contentProviders.docs
					?? contentProviders.runtime
					?? DEFAULT_PROVIDER_SELECTIONS.content.docs
					?? DEFAULT_PROVIDER_SELECTIONS.content.runtime,
				'providers.content.docs',
			),
			serving: optionalEnum(
				contentProviders.serving,
				'providers.content.serving',
				['local_collections', 'published_runtime'] as const,
			) ?? DEFAULT_PROVIDER_SELECTIONS.content.serving,
		},
		site: expectString(record.site ?? DEFAULT_PROVIDER_SELECTIONS.site, 'providers.site'),
	};
}

export function parseServiceEnvironmentConfig(
	value: unknown,
	label: string,
) {
	const record = optionalRecord(value, label) ?? {};
	return {
		baseUrl: optionalString(record.baseUrl),
		domain: optionalString(record.domain),
		railwayEnvironment: optionalString(record.railwayEnvironment),
		railwayProjectName: optionalString(record.railwayProjectName),
		serviceName: optionalString(record.serviceName ?? record.railwayServiceName),
		railwayServiceName: optionalString(record.railwayServiceName ?? record.serviceName),
	};
}

export function parseLocalRuntimeConfig(value: unknown, label: string): LocalRuntimeConfig | undefined {
	const record = normalizeAliasedRecord(
		localRuntimeFieldAliases,
		(optionalRecord(value, label) ?? {}) as Record<string, unknown>,
	);
	if (!value || Object.keys(record).length === 0) {
		return undefined;
	}
	return {
		runtime: optionalEnum(record.runtime, `${label}.runtime`, ['auto', 'provider', 'local'] as const),
	};
}

export function parseManagedServiceConfig(value: unknown, label: string): ManagedServiceConfig | undefined {
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
				imageRef: optionalString(railway.imageRef),
				sourceMode: optionalEnum(railway.sourceMode, `${label}.railway.sourceMode`, ['git', 'image'] as const),
				sourceRepo: optionalString(railway.sourceRepo),
				sourceBranch: optionalString(railway.sourceBranch),
				sourceRootDirectory: optionalString(railway.sourceRootDirectory),
				dockerfilePath: optionalString(railway.dockerfilePath),
				buildCommand: optionalString(railway.buildCommand),
			startCommand: optionalString(railway.startCommand),
			healthcheckPath: optionalString(railway.healthcheckPath),
			healthcheckTimeoutSeconds: optionalPositiveNumber(
				railway.healthcheckTimeoutSeconds,
				`${label}.railway.healthcheckTimeoutSeconds`,
			),
			healthcheckIntervalSeconds: optionalPositiveNumber(
				railway.healthcheckIntervalSeconds,
				`${label}.railway.healthcheckIntervalSeconds`,
			),
			restartPolicy: optionalString(railway.restartPolicy),
			runtimeMode: optionalString(railway.runtimeMode),
			resourceType: optionalString(railway.resourceType),
			environmentVariable: optionalString(railway.environmentVariable),
			serviceTargets: optionalStringArray(railway.serviceTargets, `${label}.railway.serviceTargets`),
			volumeMountPath: optionalString(railway.volumeMountPath),
			runnerPool: optionalRecord(railway.runnerPool, `${label}.railway.runnerPool`)
				? {
					bootstrapCount: optionalPositiveNumber(
						optionalRecord(railway.runnerPool, `${label}.railway.runnerPool`)?.bootstrapCount,
						`${label}.railway.runnerPool.bootstrapCount`,
					),
					maxRunners: optionalPositiveNumber(
						optionalRecord(railway.runnerPool, `${label}.railway.runnerPool`)?.maxRunners,
						`${label}.railway.runnerPool.maxRunners`,
					),
					volumeMountPath: optionalString(optionalRecord(railway.runnerPool, `${label}.railway.runnerPool`)?.volumeMountPath),
				}
				: undefined,
			schedule: Array.isArray(railway.schedule)
				? railway.schedule.map((entry) => optionalString(entry)).filter(Boolean)
				: optionalString(railway.schedule),
		},
		local: parseLocalRuntimeConfig(record.local, `${label}.local`),
		environments: {
			local: parseServiceEnvironmentConfig(environments.local, `${label}.environments.local`),
			staging: parseServiceEnvironmentConfig(environments.staging, `${label}.environments.staging`),
			prod: parseServiceEnvironmentConfig(environments.prod, `${label}.environments.prod`),
		},
	};
}
