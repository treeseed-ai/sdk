import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { resolveLaunchEnvironment } from '../../operations/services/configuration/config-runtime.ts';
import { cloudflareApiRequest, resolveCloudflareZoneIdForHost, resolveConfiguredCloudflareAccountId, runWrangler } from '../../operations/services/hosting/deployment/deploy.ts';
import type {
	ApplicationHostingProfile,
	HostAdapter,
	HostAdapterOperationInput,
	HostAdapterOperationResult,
	HostCapability,
	HostingEnvironment,
	HostingStatus,
	HostingUnit,
	HostingUnitPlan,
	HostingVerification,
	ServicePlacement,
	ServiceTypeAdapter,
} from '../contracts.ts';
import { cloudflarePagesEnv } from './all-environments.ts';

export function probeCloudflarePagesPublicUrl(url: string | null) {
	if (!url) {
		return { ok: false, status: null, finalUrl: null, headers: {}, error: 'missing_url' };
	}
	const script = `
const url = process.argv[1];
try {
	const response = await fetch(url, {
		redirect: 'follow',
		headers: {
			'user-agent': 'treeseed-hosting-verifier/1.0',
			'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		},
		signal: AbortSignal.timeout(15000),
	});
	const headers = {};
	for (const key of ['cf-cache-status', 'age', 'server', 'cache-control', 'content-type']) {
		const value = response.headers.get(key);
		if (value) headers[key] = value;
	}
	process.stdout.write(JSON.stringify({
		ok: response.ok,
		status: response.status,
		finalUrl: response.url,
		headers,
		error: null,
	}));
} catch (error) {
	process.stdout.write(JSON.stringify({
		ok: false,
		status: null,
		finalUrl: url,
		headers: {},
		error: error instanceof Error ? error.message : String(error),
	}));
}
`;
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, url], {
		encoding: 'utf8',
		timeout: 20_000,
	});
	if (result.error) {
		return { ok: false, status: null, finalUrl: url, headers: {}, error: result.error.message };
	}
	try {
		return JSON.parse(result.stdout || '{}');
	} catch {
		return {
			ok: false,
			status: null,
			finalUrl: url,
			headers: {},
			error: result.stderr?.trim() || result.stdout?.trim() || 'invalid_probe_output',
		};
	}
}

export function cloudflarePagesDnsTarget(projectName: string, branchName: string, environment: HostingEnvironment) {
	return environment === 'prod'
		? `${projectName}.pages.dev`
		: `${branchName}.${projectName}.pages.dev`;
}

export function cloudflarePagesDomainName(domain: any) {
	return typeof domain?.name === 'string' ? domain.name
		: typeof domain?.domain === 'string' ? domain.domain
			: typeof domain?.hostname === 'string' ? domain.hostname
				: '';
}

export function listCloudflarePagesDomains(input: HostAdapterOperationInput, projectName: string) {
	const env = cloudflarePagesEnv(input);
	const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (!projectName || !accountId || !token) return [];
	const domains: any[] = [];
	let page = 1;
	let totalPages = 1;
	while (page <= totalPages && page <= 50) {
		const payload = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains?per_page=25&page=${page}`,
			{ env, allowFailure: true },
		);
		if (payload?.success === false) break;
		if (Array.isArray(payload?.result)) domains.push(...payload.result);
		const reportedTotal = Number(payload?.result_info?.total_pages);
		totalPages = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : page;
		page += 1;
	}
	return domains;
}

export function findCloudflarePagesDomain(input: HostAdapterOperationInput, projectName: string, domain: string | null) {
	if (!domain) return null;
	const env = cloudflarePagesEnv(input);
	const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (accountId && token) {
		const direct = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(domain)}`,
			{ env, allowFailure: true },
		)?.result ?? null;
		if (cloudflarePagesDomainName(direct) === domain) return direct;
	}
	return listCloudflarePagesDomains(input, projectName)
		.find((entry) => cloudflarePagesDomainName(entry) === domain) ?? null;
}

export function cloudflareDnsRecordName(record: any) {
	return typeof record?.name === 'string' ? record.name : '';
}

export function listCloudflareDnsRecords(input: HostAdapterOperationInput, recordName: string | null) {
	const env = cloudflarePagesEnv(input);
	const zoneId = recordName ? resolveCloudflareZoneIdForHost(input.graph.deployConfig, recordName, env) : null;
	if (!zoneId || !recordName) return { zoneId, records: [] as any[] };
	const payload = cloudflareApiRequest(
		`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(recordName)}&per_page=100`,
		{ env, allowFailure: true },
	);
	return {
		zoneId,
		records: Array.isArray(payload?.result) ? payload.result : [],
	};
}

export function observeCloudflarePagesProject(input: HostAdapterOperationInput, projectName: string) {
	const env = cloudflarePagesEnv(input);
	const accountId = String(env.CLOUDFLARE_ACCOUNT_ID ?? '').trim();
	const token = String(env.CLOUDFLARE_API_TOKEN ?? '').trim();
	if (!accountId || !token) return null;
	return cloudflareApiRequest(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
		{ env, allowFailure: true },
	)?.result ?? null;
}

export function observeCloudflarePagesDomain(input: HostAdapterOperationInput, projectName: string, domain: string | null) {
	return findCloudflarePagesDomain(input, projectName, domain);
}

export function observeCloudflarePagesDeployment(input: HostAdapterOperationInput, projectName: string, branchName: string) {
	const result = runWrangler(['pages', 'deployment', 'list', '--project-name', projectName, '--json'], {
		cwd: input.graph.tenantRoot,
		capture: true,
		allowFailure: true,
		env: cloudflarePagesEnv(input),
	});
	if (result.status !== 0) return null;
	try {
		const deployments = JSON.parse(result.stdout || '[]');
		return (Array.isArray(deployments) ? deployments : [])
			.find((entry) => entry?.Branch === branchName || entry?.branch === branchName) ?? null;
	} catch {
		return null;
	}
}

export function observeCloudflarePagesDns(input: HostAdapterOperationInput, projectName: string, branchName: string, domain: string | null) {
	if (!domain) return null;
	const expectedContent = cloudflarePagesDnsTarget(projectName, branchName, input.environment);
	const { zoneId, records } = listCloudflareDnsRecords(input, domain);
	const record = records.find((entry) =>
		cloudflareDnsRecordName(entry) === domain
		&& String(entry?.type ?? '').toUpperCase() === 'CNAME'
		&& entry?.content === expectedContent
	) ?? null;
	return record ? { ...record, zoneId } : null;
}
