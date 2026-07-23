import { collectTreeseedEnvironmentContext } from "../../operations/services/config-runtime.ts";
import { buildPublicVars, buildSecretMap, loadDeployState, scopeFromTarget } from "../../operations/services/deploy.ts";
import { shouldExposeManagedHostRuntimeSecret } from "../../operations/services/managed-host-security.ts";
import { listRailwayCustomDomains, listRailwayServiceDomains } from "../../operations/services/railway-api.ts";
import type { TreeseedReconcileAdapterInput, TreeseedUnitVerificationCheck } from ".././contracts.ts";
import { normalizeRailwayDomainDnsRecord } from './normalize-turnstile-domains.ts';
import { findRailwayTopologyEntry, resolveRailwayUnitTopology } from './railway-verification-may-settle.ts';
import { toDeployTarget } from './to-deploy-target.ts';
import { resolveReconcileEnvironmentValues } from './build-workflow-meta-adapter.ts';

export function firstRailwayDomainString(...values: unknown[]) {
	for (const value of values) {
		if (typeof value === 'string' && value.trim()) {
			return value.trim();
		}
	}
	return null;
}

export function firstRailwayDomainArray(...values: unknown[]) {
	for (const value of values) {
		if (Array.isArray(value)) {
			return value;
		}
	}
	return [];
}

export function normalizeRailwayDomainPayload(value: unknown) {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const record = value as Record<string, unknown>;
	const status = record.status && typeof record.status === 'object'
		? record.status as Record<string, unknown>
		: {};
	const certificate = record.certificate && typeof record.certificate === 'object'
		? record.certificate as Record<string, unknown>
		: status.certificate && typeof status.certificate === 'object'
			? status.certificate as Record<string, unknown>
			: {};
	const verification = record.verification && typeof record.verification === 'object'
		? record.verification as Record<string, unknown>
		: status.verification && typeof status.verification === 'object'
			? status.verification as Record<string, unknown>
			: {};
	const domain = typeof record.domain === 'string'
		? record.domain.trim()
		: typeof record.name === 'string'
			? record.name.trim()
			: '';
	const serviceDomain = firstRailwayDomainString(
		record.serviceDomain,
		record.target,
		record.targetDomain,
		record.cnameTarget,
		record.cname,
		record.dnsTarget,
		status.serviceDomain,
		status.target,
		status.targetDomain,
		status.cnameTarget,
		status.cname,
		status.dnsTarget,
	);
	const dnsRecordCandidates = firstRailwayDomainArray(
		record.dnsRecords,
		record.requiredDnsRecords,
		record.requiredRecords,
		record.records,
		record.dns,
		status.dnsRecords,
		status.requiredDnsRecords,
		status.requiredRecords,
		status.records,
		status.dns,
	);
	const dnsRecords = dnsRecordCandidates
		.map((entry) => normalizeRailwayDomainDnsRecord(entry))
		.filter(Boolean);
	const effectiveDnsRecords = dnsRecords.length > 0 || !domain || !serviceDomain || serviceDomain === domain
		? dnsRecords
		: [{
			type: 'CNAME',
			name: domain,
			content: serviceDomain,
			status: '',
		}];
	return {
		id: typeof record.id === 'string' ? record.id.trim() : null,
		domain,
		serviceId: typeof record.serviceId === 'string' ? record.serviceId.trim() : null,
		serviceName: typeof record.serviceName === 'string' ? record.serviceName.trim() : null,
		serviceDomain,
		verified: record.verified === true || status.verified === true || verification.verified === true,
		certificateStatus: firstRailwayDomainString(
			record.certificateStatus,
			status.certificateStatus,
			certificate.status,
		)?.toUpperCase() ?? null,
		verificationDnsHost: typeof record.verificationDnsHost === 'string'
			? record.verificationDnsHost.trim()
			: typeof status.verificationDnsHost === 'string'
				? String(status.verificationDnsHost).trim()
				: typeof verification.dnsHost === 'string'
					? String(verification.dnsHost).trim()
					: null,
		verificationToken: typeof record.verificationToken === 'string'
			? record.verificationToken.trim()
			: typeof status.verificationToken === 'string'
				? String(status.verificationToken).trim()
				: typeof verification.token === 'string'
					? String(verification.token).trim()
					: null,
		dnsRecords: effectiveDnsRecords,
	};
}

export async function observeRailwayCustomDomainLive(input: TreeseedReconcileAdapterInput, domain: string) {
	if (!domain) {
		return null;
	}
	const scope = input.context.target.kind === 'persistent' ? input.context.target.scope : 'staging';
	const serviceKey = String(input.unit.metadata.serviceKey ?? 'api').trim();
	const topology = await resolveRailwayUnitTopology(input, scope, {
		refresh: false,
		includeInstances: false,
		includeVariables: false,
	});
	const entry = findRailwayTopologyEntry(topology, serviceKey);
	const identifiers = {
		projectId: entry?.project?.id ?? null,
		environmentId: entry?.environment?.id ?? null,
		serviceId: entry?.service?.id ?? null,
	};
	if (!identifiers.projectId || !identifiers.environmentId || !identifiers.serviceId) {
		return {
			domain: null,
			serviceId: null,
			serviceName: entry?.configuredService?.serviceName ?? null,
		};
	}
	const [customDomains, serviceDomains] = await Promise.all([
		listRailwayCustomDomains({
			projectId: identifiers.projectId,
			environmentId: identifiers.environmentId,
			serviceId: identifiers.serviceId,
			env: topology.env,
		}),
		listRailwayServiceDomains({
			projectId: identifiers.projectId,
			environmentId: identifiers.environmentId,
			serviceId: identifiers.serviceId,
			env: topology.env,
		}),
	]);
	const customDomain = customDomains.find((entry) => entry.domain === domain) ?? null;
	if (!customDomain) {
		return null;
	}
	const serviceDomain = serviceDomains.find((entry) => entry.kind === 'service') ?? null;
	const normalized = normalizeRailwayDomainPayload({
		...customDomain,
		serviceId: identifiers.serviceId,
		serviceName: entry?.configuredService?.serviceName ?? null,
		serviceDomain: serviceDomain?.domain ?? null,
	});
	return normalized?.domain ? normalized : {
		...customDomain,
		serviceId: identifiers.serviceId,
		serviceName: entry?.configuredService?.serviceName ?? null,
	};
}

export function railwayCustomDomainHasDnsRequirements(live: Record<string, unknown> | null | undefined) {
	if (!live) {
		return false;
	}
	return (Array.isArray(live.dnsRecords) && live.dnsRecords.length > 0)
		|| (typeof live.serviceDomain === 'string' && live.serviceDomain.trim().length > 0)
		|| (typeof live.verificationDnsHost === 'string' && live.verificationDnsHost.trim().length > 0
			&& typeof live.verificationToken === 'string' && live.verificationToken.trim().length > 0);
}

export function collectCloudflareEnvironmentSync(input: TreeseedReconcileAdapterInput) {
	const target = toDeployTarget(input.context.target);
	const scope = scopeFromTarget(target);
	const values = resolveReconcileEnvironmentValues(input, scope);
	const registry = collectTreeseedEnvironmentContext(input.context.tenantRoot);
	const state = loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target });
	const generatedSecrets = buildSecretMap(input.context.deployConfig, state);
	const publicVars = buildPublicVars(input.context.deployConfig, { target });
	const secrets: Record<string, string> = {};
	const generatedTurnstileSiteKey = typeof state.turnstileWidgets?.formGuard?.sitekey === 'string'
		? state.turnstileWidgets.formGuard.sitekey
		: '';
	const vars: Record<string, string> = {
		...publicVars,
	};
	const secretNames = new Set<string>();
	const varNames = new Set<string>(Object.keys(publicVars));

	for (const entry of registry.entries) {
		if (!entry.scopes.includes(scope)) {
			continue;
		}
		const value = typeof values[entry.id] === 'string' ? values[entry.id] : '';
		if (entry.targets.includes('cloudflare-secret')) {
			const secretValue = value || (typeof generatedSecrets[entry.id] === 'string' ? generatedSecrets[entry.id] : '');
			if (secretValue && shouldExposeManagedHostRuntimeSecret(input.context.deployConfig, entry.id)) {
				secrets[entry.id] = secretValue;
				secretNames.add(entry.id);
			}
		}
		if (entry.targets.includes('cloudflare-var') && value && entry.id !== 'TREESEED_PROJECT_DOMAINS') {
			vars[entry.id] = value;
			varNames.add(entry.id);
		}
	}

	if (generatedTurnstileSiteKey) {
		vars.TREESEED_PUBLIC_TURNSTILE_SITE_KEY = generatedTurnstileSiteKey;
		varNames.add('TREESEED_PUBLIC_TURNSTILE_SITE_KEY');
	}

	for (const [key, value] of Object.entries(generatedSecrets)) {
		const exposeRuntimeSecret = key === 'TREESEED_TURNSTILE_SECRET_KEY'
			|| shouldExposeManagedHostRuntimeSecret(input.context.deployConfig, key);
		if (typeof value === 'string' && value.length > 0 && exposeRuntimeSecret) {
			secrets[key] = value;
			secretNames.add(key);
		}
	}

	return { scope, state, secrets, vars, secretNames: [...secretNames], varNames: [...varNames] };
}

export function verificationCheck(
	key: string,
	description: string,
	source: TreeseedUnitVerificationCheck['source'],
	options: {
		exists: boolean;
		configured?: boolean;
		ready?: boolean;
		verified?: boolean;
		expected?: unknown;
		observed?: unknown;
		issues?: string[];
	},
): TreeseedUnitVerificationCheck {
	return {
		key,
		description,
		source,
		exists: options.exists,
		configured: options.configured ?? options.exists,
		ready: options.ready ?? options.exists,
		verified: options.verified ?? (options.exists && (options.configured ?? true) && (options.ready ?? true) && (options.issues?.length ?? 0) === 0),
		expected: options.expected,
		observed: options.observed,
		issues: options.issues ?? [],
	};
}
