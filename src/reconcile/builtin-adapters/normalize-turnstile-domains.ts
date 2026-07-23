import { cloudflareApiRequest, listD1Databases, listKvNamespaces, listPagesProjects, listR2Buckets, listTurnstileWidgets, loadDeployState } from "../../operations/services/deploy.ts";
import type { TreeseedReconcileAdapterInput, TreeseedReconcileResult } from ".././contracts.ts";
import { loadTreeseedReconcileState } from ".././state.ts";
import { createTreeseedReconcileUnitId } from ".././units.ts";
import { buildCloudflareEnv, providerCache } from './build-workflow-meta-adapter.ts';
import { toDeployTarget } from './to-deploy-target.ts';

export function normalizeTurnstileDomains(value: unknown) {
	return [...new Set((Array.isArray(value) ? value : [])
		.map((entry) => typeof entry === 'string' ? entry.trim() : '')
		.filter(Boolean))]
		.sort();
}

export function turnstileDomainsEqual(left: unknown, right: unknown) {
	return JSON.stringify(normalizeTurnstileDomains(left)) === JSON.stringify(normalizeTurnstileDomains(right));
}

export function mergeTurnstileWidget(...widgets: Array<Record<string, unknown> | null | undefined>) {
	const merged: Record<string, unknown> = {};
	for (const widget of widgets) {
		if (!widget) continue;
		for (const [key, value] of Object.entries(widget)) {
			if (value === undefined || value === null) continue;
			if (key === 'domains' && !Array.isArray(value)) continue;
			merged[key] = value;
		}
	}
	return Object.keys(merged).length > 0 ? merged : null;
}

export function findTurnstileWidget(widgets: unknown[], current: Record<string, unknown> | null | undefined, desiredName: string | null | undefined) {
	return widgets.find((entry: any) => {
		if (!entry || typeof entry !== 'object') return false;
		return (current?.sitekey && entry.sitekey === current.sitekey)
			|| (desiredName && entry.name === desiredName);
	}) as Record<string, unknown> | null | undefined;
}

export function listCloudflareQueuesViaApi(env: Record<string, string>) {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		throw new Error('Configure CLOUDFLARE_ACCOUNT_ID before reconciling Cloudflare queues.');
	}
	const payload = cloudflareApiRequest(`/accounts/${encodeURIComponent(accountId)}/queues`, { env });
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function cloudflareObservationSnapshot(input: TreeseedReconcileAdapterInput, forceRefresh = false) {
	const cacheKey = `cloudflare:refresh:${input.unit.target.kind === 'persistent' ? input.unit.target.scope : input.unit.target.branchName}`;
	return providerCache(input, cacheKey, () => {
		const target = toDeployTarget(input.context.target);
		const env = buildCloudflareEnv(input);
		return {
			target,
			env,
			state: loadDeployState(input.context.tenantRoot, input.context.deployConfig, { target }),
			kvNamespaces: listKvNamespaces(input.context.tenantRoot, env),
			d1Databases: listD1Databases(input.context.tenantRoot, env),
			queues: listCloudflareQueuesViaApi(env),
			buckets: listR2Buckets(input.context.tenantRoot, env),
			pagesProjects: listPagesProjects(input.context.tenantRoot, env),
			turnstileWidgets: listTurnstileWidgets(input.context.tenantRoot, env),
		};
	}, forceRefresh);
}

export function customDomainStateKey(provider: string, domain: string) {
	return `custom-domain:${provider}:${domain}`;
}

export function storeCustomDomainState(input: TreeseedReconcileAdapterInput, provider: string, domain: string, value: Record<string, unknown>) {
	input.context.session.set(customDomainStateKey(provider, domain), value);
}

export function getCustomDomainState(input: TreeseedReconcileAdapterInput, provider: string, domain: string) {
	return input.context.session.get(customDomainStateKey(provider, domain)) as Record<string, unknown> | undefined;
}

export function getPersistedCustomDomainState(input: TreeseedReconcileAdapterInput, provider: string, domain: string) {
	if (!domain) {
		return null;
	}
	if (provider === 'railway') {
		try {
			const state = loadTreeseedReconcileState(input.context.tenantRoot, input.context.target, input.context.launchEnv);
			const unitId = createTreeseedReconcileUnitId('custom-domain:api', domain);
			const unit = state.units[unitId];
			const reconciled = unit?.lastReconciledState;
			if (reconciled && typeof reconciled === 'object' && reconciled.domain === domain) {
				return reconciled;
			}
			const observed = unit?.lastObservedState;
			if (observed && typeof observed === 'object' && observed.domain === domain) {
				return observed;
			}
		} catch {
			// Persisted reconcile state is a convenience cache; live/session state remains authoritative.
		}
	}
	return null;
}

export function listCloudflareDnsRecords(env: Record<string, string>, zoneId: string, recordName?: string | null) {
	const query = recordName ? `?name=${encodeURIComponent(recordName)}` : '';
	const payload = cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records${query}`, {
		env,
		allowFailure: true,
	});
	return Array.isArray(payload?.result) ? payload.result : [];
}

export function ensureCloudflareDnsRecord(env: Record<string, string>, zoneId: string, record: {
	name: string;
	type: string;
	content: string;
	proxied?: boolean;
	ttl?: number;
}) {
	const existing = listCloudflareDnsRecords(env, zoneId, record.name)
		.find((entry) => entry?.name === record.name && entry?.type === record.type);
	if (existing?.id) {
		const unchanged = existing.content === record.content
			&& (record.proxied === undefined || Boolean(existing.proxied) === Boolean(record.proxied));
		if (unchanged) {
			return existing;
		}
		return cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(existing.id)}`, {
			method: 'PATCH',
			env,
			body: {
				type: record.type,
				name: record.name,
				content: record.content,
				...(record.proxied === undefined ? {} : { proxied: record.proxied }),
				ttl: record.ttl ?? 1,
			},
		})?.result ?? existing;
	}
	return cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records`, {
		method: 'POST',
		env,
		body: {
			type: record.type,
			name: record.name,
			content: record.content,
			...(record.proxied === undefined ? {} : { proxied: record.proxied }),
			ttl: record.ttl ?? 1,
		},
	})?.result ?? null;
}

export function unquoteDnsTxtContent(value: string) {
	const trimmed = value.trim();
	return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
		? trimmed.slice(1, -1)
		: trimmed;
}

export function dnsRecordContentMatches(actual: unknown, expected: unknown, type: unknown) {
	const actualText = String(actual ?? '');
	const expectedText = String(expected ?? '');
	if (String(type ?? '').toUpperCase() === 'TXT') {
		return unquoteDnsTxtContent(actualText) === unquoteDnsTxtContent(expectedText);
	}
	return actualText === expectedText;
}

export function dnsRecordProxiedMatches(actual: Record<string, unknown> | null, expected: { proxied?: boolean }) {
	return expected.proxied === undefined || Boolean(actual?.proxied) === Boolean(expected.proxied);
}

export function dnsRecordIdentityMatches(actual: Record<string, unknown> | null, expected: { name: string; type: string }) {
	return actual?.name === expected.name && String(actual?.type ?? '').toUpperCase() === expected.type;
}

export function dnsRecordMatches(actual: Record<string, unknown> | null, expected: { name: string; type: string; content: string; proxied?: boolean }) {
	return Boolean(actual)
		&& dnsRecordIdentityMatches(actual, expected)
		&& dnsRecordContentMatches(actual?.content, expected.content, expected.type)
		&& dnsRecordProxiedMatches(actual, expected);
}

export function dnsRecordsFromCurrentResult(input: TreeseedReconcileAdapterInput & { result?: TreeseedReconcileResult | null }) {
	const records = input.result?.state?.records;
	return Array.isArray(records)
		? records.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
		: [];
}

export function getCloudflarePagesDomain(env: Record<string, string>, projectName: string, domain: string) {
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		return null;
	}
	const payload = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
		{ env, allowFailure: true },
	);
	return payload?.result ?? null;
}

export function ensureCloudflarePagesDomain(env: Record<string, string>, projectName: string, domain: string) {
	const existing = getCloudflarePagesDomain(env, projectName, domain);
	if (existing?.name || existing?.domain) {
		return existing;
	}
	const accountId = env.CLOUDFLARE_ACCOUNT_ID;
	if (!accountId) {
		throw new Error('Configure CLOUDFLARE_ACCOUNT_ID before reconciling Pages custom domains.');
	}
	const created = cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains`,
		{
			method: 'POST',
			env,
			body: { name: domain },
		},
	);
	return created?.result ?? null;
}

export function normalizeRailwayDomainDnsRecord(value: unknown) {
	if (!value || typeof value !== 'object') {
		return null;
	}
	const record = value as Record<string, unknown>;
	const rawType = typeof record.recordType === 'string'
		? record.recordType.trim().toUpperCase()
		: typeof record.type === 'string'
			? record.type.trim().toUpperCase()
			: '';
	const type = rawType.startsWith('DNS_RECORD_TYPE_')
		? rawType.replace(/^DNS_RECORD_TYPE_/u, '')
		: rawType;
	const host = typeof record.fqdn === 'string'
		? record.fqdn.trim()
		: typeof record.hostname === 'string'
			? record.hostname.trim()
		: typeof record.name === 'string'
			? record.name.trim()
			: '';
	const valueText = typeof record.requiredValue === 'string'
		? record.requiredValue.trim()
		: typeof record.currentValue === 'string'
			? record.currentValue.trim()
		: typeof record.value === 'string'
			? record.value.trim()
				: typeof record.link === 'string'
					? record.link.trim()
					: '';
	if (!type || !host || !valueText) {
		return null;
	}
	return {
		type,
		name: host,
		content: valueText,
		status: typeof record.status === 'string' ? record.status.trim().toUpperCase() : '',
	};
}
