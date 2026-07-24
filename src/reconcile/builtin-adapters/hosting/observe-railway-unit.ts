import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { collectEnvironmentContext, resolveMachineEnvironmentValues, setMachineEnvironmentValue } from "../../../operations/services/configuration/config-runtime.ts";
import { loadDeployState, resolveConfiguredSurfaceDomain } from "../../../operations/services/hosting/deployment/deploy.ts";
import { configuredRailwayServices } from "../../../operations/services/hosting/railway/railway-deploy.ts";
import { shouldExposeManagedHostRuntimeSecret } from "../../../operations/services/hosting/audit/managed-host-security.ts";
import type { ObservedUnitState, ReconcileAdapterInput } from "../../support/contracts/contracts.ts";
import { configuredRailwayServicesForInput, resolveRailwayTopologyForScope } from './resolve-railway-topology-for-scope.ts';
import { isTransientRailwayReconcileError, sleepMs, toDeployTarget } from './to-deploy-target.ts';
import { findRailwayTopologyEntry, railwayUnitServiceIdentity, resolveRailwayUnitTopology } from './railway-verification-may-settle.ts';
import { buildCloudflareEnv, findCloudflareD1ByName, hasLiveResourceId, normalizeEnvironmentValues, resolveReconcileEnvironmentValues } from '../reconciliation/build-workflow-meta-adapter.ts';
import { configuredMarketDatabaseService } from './build-cloudflare-diff.ts';
import { capacityProviderVariablesForService } from '../capacity/providers/capacity-provider-variables-for-service.ts';

export async function observeRailwayUnit(input: ReconcileAdapterInput, {
	refresh = false,
	topology: providedTopology,
}: {
	refresh?: boolean;
	topology?: Awaited<ReturnType<typeof resolveRailwayTopologyForScope>>;
} = {}): Promise<ObservedUnitState> {
	let attempt = 0;
	for (;;) {
		try {
			const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
			const serviceKey = String(input.unit.metadata.serviceKey ?? '').trim();
			const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target: toDeployTarget(input.context.target) });
			const persisted = state.services?.[serviceKey] ?? {};
			const topology = providedTopology ?? await resolveRailwayUnitTopology(input, scope, {
				refresh,
				includeInstances: false,
				includeVariables: false,
				cacheSuffix: refresh ? 'refresh' : 'observe',
			});
			const entry = findRailwayTopologyEntry(topology, railwayUnitServiceIdentity(input));
			const configuredService = entry?.configuredService ?? null;
			const usesPortableSource = Boolean(
				configuredService?.imageRef
				|| (configuredService?.sourceMode === 'git' && configuredService?.sourceRepo)
			);
			const configured = Boolean(
				configuredService
				&& (configuredService.serviceName || configuredService.serviceId)
				&& (configuredService.projectName || configuredService.projectId)
				&& (usesPortableSource || existsSync(resolve(configuredService.rootDir))),
			);
			return {
				exists: Boolean(entry?.project && entry?.environment && entry?.service),
				status: entry?.project && entry?.environment && entry?.service && configured ? 'ready' : 'pending',
				live: {
					...(persisted ?? {}),
					...(configuredService ?? {}),
					project: entry?.project ?? null,
					environment: entry?.environment ?? null,
					service: entry?.service ?? null,
					instance: entry?.instance ?? null,
				},
				locators: {
					projectId: entry?.project?.id ?? entry?.configuredService.projectId ?? persisted.projectId ?? null,
					serviceId: entry?.service?.id ?? entry?.configuredService.serviceId ?? persisted.serviceId ?? null,
					serviceName: entry?.service?.name ?? entry?.configuredService.serviceName ?? persisted.serviceName ?? null,
					publicBaseUrl: entry?.configuredService.publicBaseUrl ?? persisted.publicBaseUrl ?? null,
					workspace: topology.workspace.name,
				},
				warnings: [],
			};
		} catch (error) {
			if (attempt >= 2 || !isTransientRailwayReconcileError(error)) {
				throw error;
			}
			attempt += 1;
			sleepMs(1000 * attempt);
		}
	}
}

export function collectRailwayEnvironmentSync(input: ReconcileAdapterInput, valuesOverlay: Record<string, string | undefined> = {}) {
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const registry = collectEnvironmentContext(input.context.tenantRoot);
	const configuredServices = configuredRailwayServicesForInput(input, scope);
	const hasPublicTreeDxService = configuredServices
		.some((service) => service.key === 'public-treedx-node-01' && service.enabled !== false);
	const machineValues = hasPublicTreeDxService && scope === 'local'
		? normalizeEnvironmentValues(resolveMachineEnvironmentValues(input.context.tenantRoot, scope))
		: {};
	const baseValues = {
		...resolveReconcileEnvironmentValues(input, scope),
		...machineValues,
		...valuesOverlay,
	};
	const values = {
		...baseValues,
		...ensurePublicTreeDxSecretsForRailwaySync(input, scope, baseValues, registry),
	};
	if (scope !== 'local') {
		sanitizeRemoteRailwayServiceUrls(input, scope, values);
	}
	const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target: toDeployTarget(input.context.target) });
	const serviceTargetsEntry = (entry: Record<string, unknown>, serviceKey: string) => {
		const targets = Array.isArray(entry.serviceTargets)
			? entry.serviceTargets.map((value) => String(value).trim()).filter(Boolean)
			: [];
		return targets.length === 0 || targets.includes(serviceKey);
	};
	const entriesForService = (target: 'railway-secret' | 'railway-var', serviceKey: string) => registry.entries
		.filter((entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes(target)
			&& serviceTargetsEntry(entry as unknown as Record<string, unknown>, serviceKey)
		)
		.map((entry) => [entry.id, values[entry.id]] as const)
		.filter(([, value]) => typeof value === 'string' && value.length > 0);
	const aggregateEntries = (target: 'railway-secret' | 'railway-var') => registry.entries
		.filter((entry) =>
			entry.scopes.includes(scope)
			&& entry.targets.includes(target))
		.map((entry) => [entry.id, values[entry.id]] as const)
		.filter(([, value]) => typeof value === 'string' && value.length > 0);
	const secrets = Object.fromEntries(aggregateEntries('railway-secret'));
	const variables = Object.fromEntries(aggregateEntries('railway-var'));
	const apiOnlySecrets: Record<string, string> = {};
	const apiOnlyVariables: Record<string, string> = {};
	const Database = configuredMarketDatabaseService(input.context.tenantRoot, input.context.deployConfig);
	const DatabaseService = Database?.service;
	const DatabaseServiceName = Database?.serviceName ?? '';
	const DatabaseUrl = typeof values.TREESEED_DATABASE_URL === 'string' && values.TREESEED_DATABASE_URL.length > 0
		? values.TREESEED_DATABASE_URL
		: DatabaseService?.enabled !== false && DatabaseService?.provider === 'railway'
			? `\${{${DatabaseServiceName}.DATABASE_URL}}`
			: '';

	if (
		typeof values.TREESEED_CLOUDFLARE_API_TOKEN === 'string'
		&& values.TREESEED_CLOUDFLARE_API_TOKEN.length > 0
		&& shouldExposeManagedHostRuntimeSecret(input.context.deployConfig, 'TREESEED_CLOUDFLARE_API_TOKEN')
	) {
		secrets.TREESEED_CLOUDFLARE_API_TOKEN = values.TREESEED_CLOUDFLARE_API_TOKEN;
		apiOnlySecrets.TREESEED_CLOUDFLARE_API_TOKEN = values.TREESEED_CLOUDFLARE_API_TOKEN;
	}
	if (typeof values.TREESEED_CLOUDFLARE_ACCOUNT_ID === 'string' && values.TREESEED_CLOUDFLARE_ACCOUNT_ID.length > 0) {
		variables.TREESEED_CLOUDFLARE_ACCOUNT_ID = values.TREESEED_CLOUDFLARE_ACCOUNT_ID;
		apiOnlyVariables.TREESEED_CLOUDFLARE_ACCOUNT_ID = values.TREESEED_CLOUDFLARE_ACCOUNT_ID;
	}
	const siteDataDb = state.d1Databases?.SITE_DATA_DB;
	let apiD1DatabaseId = siteDataDb?.databaseId;
	if (!hasLiveResourceId(apiD1DatabaseId)) {
		const liveDatabase = findCloudflareD1ByName(input, buildCloudflareEnv(input), siteDataDb?.databaseName, { attempts: 3, delayMs: 250 });
		apiD1DatabaseId = liveDatabase?.uuid ?? liveDatabase?.id ?? apiD1DatabaseId;
	}
	if (hasLiveResourceId(apiD1DatabaseId)) {
		variables.TREESEED_API_D1_DATABASE_ID = apiD1DatabaseId;
		apiOnlyVariables.TREESEED_API_D1_DATABASE_ID = apiD1DatabaseId;
	}
	if (DatabaseUrl) {
		secrets.TREESEED_DATABASE_URL = DatabaseUrl;
	}

	return {
		scope,
		secrets,
		variables,
		forService(serviceKey: string, configuredService?: ReturnType<typeof configuredRailwayServices>[number]) {
			const capacityVariables = capacityProviderVariablesForService(input, scope, values, serviceKey, configuredService);
			const capacitySecrets: Record<string, string> = {};
				const serviceVariables = configuredService?.environmentVariables && typeof configuredService.environmentVariables === 'object'
					? Object.fromEntries(Object.entries(configuredService.environmentVariables)
						.filter(([, value]) => typeof value === 'string' && value.length > 0))
					: {};
				const serviceSecretRefs = Array.isArray(configuredService?.secretRefs)
					? configuredService.secretRefs.map((value) => String(value).trim()).filter(Boolean)
					: [];
				const serviceVariableRefs = Array.isArray(configuredService?.variableRefs)
					? configuredService.variableRefs.map((value) => String(value).trim()).filter(Boolean)
					: [];
				const serviceValue = (key: string) => {
					const direct = values[key];
					if (typeof direct === 'string' && direct.length > 0) return direct;
					if (key.startsWith('TREEDX_')) {
						const legacy = values[`TREESEED_${key}`];
						if (typeof legacy === 'string' && legacy.length > 0) return legacy;
					}
					return undefined;
				};
				const serviceRefSecrets = Object.fromEntries(serviceSecretRefs
					.map((key) => [key, serviceValue(key)] as const)
					.filter(([, value]) => typeof value === 'string' && value.length > 0));
				const serviceRefVariables = Object.fromEntries(serviceVariableRefs
					.map((key) => [key, serviceValue(key)] as const)
					.filter(([, value]) => typeof value === 'string' && value.length > 0));
				return {
					secrets: {
						...Object.fromEntries(entriesForService('railway-secret', serviceKey)),
						...serviceRefSecrets,
						...(DatabaseUrl && ['api', 'operationsRunner'].includes(serviceKey)
							? { TREESEED_DATABASE_URL: DatabaseUrl }
							: {}),
					...(serviceKey === 'api' ? apiOnlySecrets : {}),
					...capacitySecrets,
				},
					variables: {
						...serviceVariables,
						...serviceRefVariables,
						...Object.fromEntries(entriesForService('railway-var', serviceKey)),
					...(serviceKey === 'operationsRunner'
						? {
								TREESEED_MANAGER_ID: scope,
								TREESEED_PLATFORM_RUNNER_ID: configuredService?.runnerId ?? configuredService?.serviceName ?? 'treeseed-api-operations-runner-01',
								TREESEED_PLATFORM_RUNNER_DATA_DIR: configuredService?.volumeMountPath ?? '/data',
								TREESEED_PLATFORM_RUNNER_ENVIRONMENT: scope === 'prod' ? 'production' : scope,
							}
						: {}),
					...(serviceKey === 'api' ? apiOnlyVariables : {}),
					...capacityVariables,
				},
			};
		},
	};
}

export function isLoopbackServiceUrl(value: unknown) {
	if (typeof value !== 'string' || !value.trim()) return false;
	try {
		const url = new URL(value);
		return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
	} catch {
		return false;
	}
}

export function sanitizeRemoteRailwayServiceUrls(
	input: ReconcileAdapterInput,
	scope: 'staging' | 'prod',
	values: Record<string, string | undefined>,
) {
	const configuredApiDomain = resolveConfiguredSurfaceDomain(input.context.deployConfig, { kind: 'persistent', scope }, 'api');
	const configuredApiBaseUrl = configuredApiDomain ? `https://${configuredApiDomain}` : '';
	const apiBaseUrl = [
		values.TREESEED_MARKET_API_BASE_URL,
		values.TREESEED_STAGING_MARKET_API_BASE_URL,
		configuredApiBaseUrl,
	].find((value) => typeof value === 'string' && value.trim() && !isLoopbackServiceUrl(value))?.trim();
	if (!apiBaseUrl) return;
	if (isLoopbackServiceUrl(values.TREESEED_API_BASE_URL)) {
		values.TREESEED_API_BASE_URL = apiBaseUrl;
	}
	for (const key of ['TREESEED_CENTRAL_MARKET_API_BASE_URL', 'TREESEED_CATALOG_MARKET_API_BASE_URLS'] as const) {
		if (isLoopbackServiceUrl(values[key])) {
			values[key] = apiBaseUrl;
		}
	}
}

export function capacityProviderRoleForService(serviceKey: string) {
	if (serviceKey === 'capacityProviderManager') return 'manager';
	if (serviceKey === 'capacityProviderRunner') return 'runner';
	return null;
}

export function ensurePublicTreeDxSecretsForRailwaySync(
	input: ReconcileAdapterInput,
	scope: 'local' | 'staging' | 'prod',
	values: Record<string, string | undefined>,
	registry: ReturnType<typeof collectEnvironmentContext>,
) {
	const hasPublicTreeDxService = configuredRailwayServicesForInput(input, scope)
		.some((service) => service.key === 'public-treedx-node-01' && service.enabled !== false);
	if (!hasPublicTreeDxService) return {};
	const generated: Record<string, string> = {};
	const specs = [
		['TREESEED_TREEDX_SECRET_KEY_BASE', () => randomBytes(64).toString('hex')],
		['TREESEED_TREEDX_ADMIN_TOKEN', () => `tdx_admin_${randomBytes(32).toString('base64url')}`],
		['TREESEED_TREEDX_JWT_HS256_SECRET', () => randomBytes(48).toString('base64url')],
	] as const;
	for (const [key, create] of specs) {
		const existing = String(values[key] ?? '').trim();
		if (existing) continue;
		const entry = registry.entries.find((candidate) => candidate.id === key);
		if (!entry) continue;
		const value = create();
		setMachineEnvironmentValue(input.context.tenantRoot, scope, entry, value);
		generated[key] = value;
	}
	return generated;
}
