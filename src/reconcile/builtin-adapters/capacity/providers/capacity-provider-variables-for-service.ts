import { resolve } from 'node:path';
import { resolveCloudflareZoneIdForHost } from "../../../../operations/services/hosting/deployment/deploy.ts";
import { configuredRailwayServices } from "../../../../operations/services/hosting/railway/railway-deploy.ts";
import type { ObservedUnitState, ReconcileAdapterInput, ReconcileUnitDiff } from "../../../support/contracts/contracts.ts";
import { discoverApplications } from "../../../../hosting/apps.ts";
import { capacityProviderRoleForService } from '../../hosting/observe-railway-unit.ts';
import { dnsRecordMatches, getCloudflarePagesDomain, getCustomDomainState, getPersistedCustomDomainState, listCloudflareDnsRecords, normalizeRailwayDomainDnsRecord, storeCustomDomainState } from '../../support/normalize-turnstile-domains.ts';
import { buildCloudflareEnv } from '../../reconciliation/build-workflow-meta-adapter.ts';
import { observeRailwayCustomDomainLive } from '../../hosting/first-railway-domain-string.ts';
import { noopObservedState } from '../../hosting/to-deploy-target.ts';

export function capacityProviderVariablesForService(
	input: ReconcileAdapterInput,
	scope: string,
	values: Record<string, string | undefined>,
	serviceKey: string,
	configuredService?: ReturnType<typeof configuredRailwayServices>[number],
): Record<string, string> {
	const role = capacityProviderRoleForService(serviceKey);
	if (!role) return {};
	const variables: Record<string, string> = {
		TREESEED_PROVIDER_ENVIRONMENT: scope === 'prod' ? 'production' : scope,
		TREESEED_PROVIDER_ROLE: role,
	};
	const marketUrl = resolveCapacityProviderMarketUrl(input, scope, values);
	if (marketUrl) {
		variables.TREESEED_MARKET_URL = marketUrl;
		variables.TREESEED_API_BASE_URL = marketUrl;
	}
	if (role === 'runner') {
		variables.TREESEED_PROVIDER_RUNNER_ID = String(configuredService?.runnerId ?? configuredService?.serviceName ?? 'treeseed-agent-runner-01');
		variables.TREESEED_PROVIDER_DATA_DIR = String(configuredService?.volumeMountPath ?? '/data');
	}
	return variables;
}

export function resolveCapacityProviderMarketUrl(
	input: ReconcileAdapterInput,
	scope: string,
	values: Record<string, string | undefined>,
) {
	const hostedApiBaseUrl = resolveHostedApiBaseUrl(input, scope);
	if (hostedApiBaseUrl) return hostedApiBaseUrl;
	for (const key of ['TREESEED_MARKET_URL', 'TREESEED_MARKET_API_BASE_URL', 'TREESEED_STAGING_MARKET_API_BASE_URL', 'TREESEED_API_BASE_URL', 'TREESEED_CENTRAL_MARKET_API_BASE_URL', 'TREESEED_PUBLIC_MARKET_URL', 'TREESEED_SITE_URL']) {
		const value = String(values[key] ?? '').trim();
		if (/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/iu.test(value)) continue;
		if (value) return value.replace(/\/+$/u, '');
	}
	const applications = discoverApplications(input.context.tenantRoot);
	const webApplication = applications.find((application) => application.roles.includes('web'))
		?? applications.find((application) => application.root === resolve(input.context.tenantRoot));
	const web = webApplication?.config?.surfaces?.web;
	const environment = scope === 'prod' ? 'prod' : scope;
	const domain = String(web?.environments?.[environment]?.domain ?? web?.publicBaseUrl ?? '').trim();
	if (!domain) return '';
	if (/^https?:\/\//u.test(domain)) return domain.replace(/\/+$/u, '');
	return `https://${domain.replace(/\/+$/u, '')}`;
}

export function resolveHostedApiBaseUrl(input: ReconcileAdapterInput, scope: string) {
	const environment = scope === 'prod' ? 'prod' : scope;
	const rootConnections = input.context.deployConfig.connections as Record<string, any> | undefined;
	const configuredConnectionUrl = String(rootConnections?.api?.environments?.[environment]?.baseUrl ?? '').trim();
	if (configuredConnectionUrl) return configuredConnectionUrl.replace(/\/+$/u, '');
	const applications = discoverApplications(input.context.tenantRoot);
	for (const application of applications) {
		const apiSurface = application.config?.surfaces?.api;
		const configuredBaseUrl = String(apiSurface?.environments?.[environment]?.baseUrl ?? '').trim();
		if (configuredBaseUrl) return configuredBaseUrl.replace(/\/+$/u, '');
		const configuredDomain = String(apiSurface?.environments?.[environment]?.domain ?? '').trim();
		if (configuredDomain) {
			return /^https?:\/\//u.test(configuredDomain)
				? configuredDomain.replace(/\/+$/u, '')
				: `https://${configuredDomain.replace(/\/+$/u, '')}`;
		}
	}
	return '';
}

export function buildAttachmentDiff(input: ReconcileAdapterInput, observed: ObservedUnitState): ReconcileUnitDiff {
	if (!observed.exists) {
		return {
			action: 'create',
			reasons: ['attachment missing'],
			before: observed.live,
			after: input.unit.spec,
		};
	}
	return {
		action: observed.status === 'ready' ? 'noop' : 'update',
		reasons: observed.status === 'ready' ? ['attachment already present'] : ['attachment requires update'],
		before: observed.live,
		after: input.unit.spec,
	};
}

export function resolveDesiredDnsRecords(input: ReconcileAdapterInput) {
	if (typeof input.unit.spec.recordType === 'string' && typeof input.unit.spec.recordContent === 'string' && typeof input.unit.spec.recordName === 'string') {
		return [{
			type: String(input.unit.spec.recordType).toUpperCase(),
			name: String(input.unit.spec.recordName),
			content: String(input.unit.spec.recordContent),
			status: '',
			proxied: typeof input.unit.spec.proxied === 'boolean' ? input.unit.spec.proxied : undefined,
		}];
	}
	const domain = typeof input.unit.spec.domain === 'string' ? input.unit.spec.domain : '';
	if (!domain) {
		return [];
	}
	const railwayState = getCustomDomainState(input, 'railway', domain)
		?? getPersistedCustomDomainState(input, 'railway', domain)
		?? (input.persistedState?.lastObservedState as Record<string, unknown> | undefined)
		?? (input.persistedState?.lastReconciledState as Record<string, unknown> | undefined);
	const records = Array.isArray(railwayState?.dnsRecords)
		? railwayState.dnsRecords.map((entry) => normalizeRailwayDomainDnsRecord(entry)).filter(Boolean)
		: [];
	if (
		records.length === 0
		&& typeof railwayState?.serviceDomain === 'string'
		&& railwayState.serviceDomain.trim()
		&& railwayState.serviceDomain.trim() !== domain
	) {
		records.push({
			type: 'CNAME',
			name: domain,
			content: railwayState.serviceDomain.trim(),
			status: '',
		});
	}
	const desiredRecords = records.map((record) => ({
		...record,
		proxied: false,
	}));
	const verificationDnsHost = typeof railwayState?.verificationDnsHost === 'string'
		? railwayState.verificationDnsHost.trim()
		: '';
	const verificationToken = typeof railwayState?.verificationToken === 'string'
		? railwayState.verificationToken.trim()
		: '';
	if (verificationDnsHost && verificationToken) {
		const verificationName = verificationDnsHost.endsWith(`.${domain}`)
			? verificationDnsHost
			: `${verificationDnsHost}.${domain.split('.').slice(-2).join('.')}`;
		desiredRecords.push({
			type: 'TXT',
			name: verificationName,
			content: verificationToken,
			status: '',
			proxied: false,
		});
	}
	return desiredRecords;
}

export async function observeCustomDomainUnit(input: ReconcileAdapterInput): Promise<ObservedUnitState> {
	switch (input.unit.unitType) {
		case 'custom-domain:web': {
			const env = buildCloudflareEnv(input);
			const domain = String(input.unit.spec.domain ?? '').trim();
			const projectName = String(input.unit.spec.projectName ?? '').trim();
			const live = domain && projectName ? getCloudflarePagesDomain(env, projectName, domain) : null;
			if (live) {
				storeCustomDomainState(input, 'cloudflare', domain, live);
			}
			return {
				exists: Boolean(live?.name || live?.domain),
				status: live?.name || live?.domain ? 'ready' : 'pending',
				live: live ?? {},
				locators: {
					domain: domain || null,
					projectName: projectName || null,
				},
				warnings: [],
			};
		}
		case 'custom-domain:api': {
			const domain = String(input.unit.spec.domain ?? '').trim();
			const live = await observeRailwayCustomDomainLive(input, domain);
			if (live?.domain) {
				storeCustomDomainState(input, 'railway', domain, live);
			}
			return {
				exists: Boolean(live?.domain),
				status: live?.domain ? 'ready' : 'pending',
				live: live ?? {},
				locators: {
					domain: domain || null,
					serviceId: typeof live?.serviceId === 'string' ? live.serviceId : null,
					serviceName: typeof live?.serviceName === 'string' ? live.serviceName : null,
					serviceDomain: typeof live?.serviceDomain === 'string' ? live.serviceDomain : null,
				},
				warnings: [],
			};
		}
		default:
			return noopObservedState(input);
	}
}

export function observeDnsRecordUnit(input: ReconcileAdapterInput): ObservedUnitState {
	const env = buildCloudflareEnv(input);
	const domain = String(input.unit.spec.domain ?? '').trim();
	const zoneId = domain ? resolveCloudflareZoneIdForHost(input.context.deployConfig, domain, env) : null;
	const desiredRecords = resolveDesiredDnsRecords(input);
	const liveRecords = zoneId
		? desiredRecords.map((record) =>
			listCloudflareDnsRecords(env, zoneId, record.name)
				.find((entry) => entry?.name === record.name && entry?.type === record.type) ?? null,
		)
		: [];
	const matches = desiredRecords.length > 0 && liveRecords.every((entry, index) =>
		dnsRecordMatches(entry, desiredRecords[index]!),
	);
	return {
		exists: desiredRecords.length > 0 && liveRecords.every(Boolean),
		status: matches ? 'ready' : 'pending',
		live: {
			zoneId,
			records: liveRecords.filter(Boolean),
		},
		locators: {
			zoneId,
		},
		warnings: desiredRecords.length === 0 ? ['No desired DNS records were available for verification.'] : [],
	};
}
