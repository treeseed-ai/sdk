import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveTreeseedWebCachePolicy } from '../../../platform/deploy-config.ts';
import {
	deleteRailwayCustomDomain,
	deleteRailwayEnvironment,
	deleteRailwayVolume,
	getRailwayServiceInstance,
	listRailwayCustomDomains,
	listRailwayProjects,
	listRailwayVariables,
	listRailwayVolumes,
	normalizeRailwayEnvironmentName,
	resolveRailwayApiToken,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
} from '../railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from '../runtime-tools.ts';
import { sdkD1MigrationsRoot } from '../runtime-paths.ts';
import { cloudflareApiRequest, resolveCloudflareZoneIdForHost } from './cloudflare-api-request.ts';
import { runWrangler } from './run-wrangler.ts';
import { looksLikeMissingResource, resourceOperation } from './collect-missing-deploy-inputs.ts';
import { deleteCloudflareApiResource, formatCloudflareErrors } from './delete-cloudflare-api-resource.ts';

export function pagesDomainName(domain) {
	return typeof domain?.name === 'string' ? domain.name
		: typeof domain?.domain === 'string' ? domain.domain
			: typeof domain?.hostname === 'string' ? domain.hostname
				: '';
}

export function listPagesCustomDomains(projectName, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!projectName || !accountId) {
		return [];
	}
	const domains = [];
	let page = 1;
	let totalPages = 1;
	while (page <= totalPages && page <= 50) {
		const payload = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains?per_page=100&page=${page}`,
			{ env, allowFailure: true },
		);
		if (payload?.success === false) {
			break;
		}
		if (Array.isArray(payload?.result)) {
			domains.push(...payload.result);
		}
		const reportedTotal = Number(payload?.result_info?.total_pages);
		totalPages = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : page;
		page += 1;
	}
	return domains;
}

export function listPagesCustomDomainsWithWrangler(tenantRoot, projectName, { env }) {
	const result = runWrangler(['pages', 'project', 'list', '--json'], {
		cwd: tenantRoot,
		allowFailure: true,
		capture: true,
		env,
	});
	if (result.status !== 0) {
		return [];
	}
	try {
		const projects = JSON.parse(result.stdout || '[]');
		const project = (Array.isArray(projects) ? projects : [])
			.find((entry) => entry?.name === projectName || entry?.projectName === projectName || entry?.['Project Name'] === projectName);
		const domains = typeof project?.['Project Domains'] === 'string'
			? project['Project Domains']
			: typeof project?.domains === 'string'
				? project.domains
				: '';
		return domains.split(',').map((entry) => entry.trim()).filter((entry) => entry && !entry.endsWith('.pages.dev'));
	} catch {
		return [];
	}
}

export function deletePagesCustomDomains(tenantRoot, projectName, knownNames, { env, planOnly, knownOnly = false }) {
	if (!projectName) {
		return [resourceOperation('cloudflare', 'pages-custom-domain', projectName, 'missing')];
	}
	const desiredNames = [...new Set((knownNames ?? []).filter(Boolean))];
	if (planOnly) {
		return desiredNames.length > 0
			? desiredNames.map((name) => resourceOperation('cloudflare', 'pages-custom-domain', name, 'planned', { projectName, knownOnly }))
			: [resourceOperation('cloudflare', 'pages-custom-domain', projectName, knownOnly ? 'skipped' : 'planned', { reason: knownOnly ? 'no_target_scoped_domain' : 'project_delete_prerequisite' })];
	}
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return desiredNames.length > 0
			? desiredNames.map((name) => resourceOperation('cloudflare', 'pages-custom-domain', name, 'blocked', { projectName, reason: 'missing_cloudflare_account_id' }))
			: [resourceOperation('cloudflare', 'pages-custom-domain', projectName, 'blocked', { reason: 'missing_cloudflare_account_id' })];
	}
	const listedNames = knownOnly ? [] : listPagesCustomDomains(projectName, { env }).map(pagesDomainName).filter(Boolean);
	const wranglerNames = knownOnly ? [] : listPagesCustomDomainsWithWrangler(tenantRoot, projectName, { env });
	const domainNames = [...new Set([...desiredNames, ...listedNames, ...wranglerNames])];
	if (domainNames.length === 0) {
		return [resourceOperation('cloudflare', 'pages-custom-domain', projectName, 'missing', { projectName })];
	}
	return domainNames.map((name) => deleteCloudflareApiResource(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/domains/${encodeURIComponent(name)}`,
		{ env, planOnly: false, name, type: 'pages-custom-domain' },
	));
}

export function normalizePagesDeploymentId(deployment) {
	return typeof deployment?.id === 'string' ? deployment.id
		: typeof deployment?.Id === 'string' ? deployment.Id
			: '';
}

export function normalizePagesDeployments(value) {
	return (Array.isArray(value) ? value : Array.isArray(value?.result) ? value.result : [])
		.filter((entry) => normalizePagesDeploymentId(entry));
}

export function pagesDeploymentEnvironments(environment = 'all') {
	return environment === 'preview' ? ['preview']
		: environment === 'production' ? ['production']
			: ['preview', 'production'];
}

export function listPagesDeploymentsWithApi(projectName, { env, environment = 'all' }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!projectName || !accountId) {
		return [];
	}
	const deployments = [];
	for (const pagesEnvironment of pagesDeploymentEnvironments(environment)) {
		let page = 1;
		let totalPages = 1;
		while (page <= totalPages && page <= 50) {
			const payload = cloudflareApiRequest(
				`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments?per_page=100&page=${page}&env=${pagesEnvironment}`,
				{ env, allowFailure: true },
			);
			if (payload?.success === false) {
				break;
			}
			deployments.push(...normalizePagesDeployments(payload));
			const reportedTotal = Number(payload?.result_info?.total_pages);
			totalPages = Number.isFinite(reportedTotal) && reportedTotal > 0 ? reportedTotal : page;
			page += 1;
		}
	}
	return deployments;
}

export function listPagesDeployments(tenantRoot, projectName, { env, environment = 'all' }) {
	const deployments = [];
	for (const pagesEnvironment of pagesDeploymentEnvironments(environment)) {
		const result = runWrangler(['pages', 'deployment', 'list', '--project-name', projectName, '--environment', pagesEnvironment, '--json'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
			env,
		});
		if (result.status !== 0) {
			continue;
		}
		try {
			deployments.push(...normalizePagesDeployments(JSON.parse(result.stdout || '[]')));
		} catch {
			// Fall back to the API list below.
		}
	}
	if (deployments.length > 0) {
		const byId = new Map(deployments.map((deployment) => [normalizePagesDeploymentId(deployment), deployment]));
		return [...byId.values()];
	}
	return listPagesDeploymentsWithApi(projectName, { env, environment });
}

export function deletePagesDeployments(tenantRoot, projectName, { env, planOnly, environment = 'all' }) {
	if (!projectName) {
		return resourceOperation('cloudflare', 'pages-deployments', projectName, 'missing');
	}
	if (planOnly) {
		return resourceOperation('cloudflare', 'pages-deployments', projectName, 'planned', { reason: 'project_delete_prerequisite', environment });
	}
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId) {
		return resourceOperation('cloudflare', 'pages-deployments', projectName, 'blocked', { reason: 'missing_cloudflare_account_id' });
	}
	let deleted = 0;
	let skipped = 0;
	let total = 0;
	for (let batch = 0; batch < 100; batch += 1) {
		const deployments = listPagesDeployments(tenantRoot, projectName, { env, environment });
		if (deployments.length === 0) {
			return resourceOperation('cloudflare', 'pages-deployments', projectName, deleted > 0 ? 'deleted' : 'missing', {
				deleted,
				skipped,
				total,
			});
		}
		total += deployments.length;
		let batchDeleted = 0;
		let batchSkipped = 0;
		for (const deployment of deployments) {
			const deploymentId = normalizePagesDeploymentId(deployment);
			if (!deploymentId) {
				continue;
			}
			const result = cloudflareApiRequest(
				`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}/deployments/${encodeURIComponent(deploymentId)}`,
				{ method: 'DELETE', env, allowFailure: true },
			);
			if (result?.success === false) {
				const message = formatCloudflareErrors(result);
				if (/active production deployment|production deployment|deployment is aliased|aliased deployment/iu.test(message)) {
					skipped += 1;
					batchSkipped += 1;
					continue;
				}
				if (looksLikeMissingResource(message)) {
					continue;
				}
				throw new Error(message || `Failed to delete Pages deployment ${deploymentId}.`);
			}
			deleted += 1;
			batchDeleted += 1;
		}
		if (batchDeleted === 0 && batchSkipped >= deployments.length) {
			break;
		}
	}
	return resourceOperation('cloudflare', 'pages-deployments', projectName, deleted > 0 ? 'deleted' : 'skipped', {
		deleted,
		skipped,
		total,
	});
}

export function deletePagesProject(projectName, { env, planOnly }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!projectName || !accountId) {
		return resourceOperation('cloudflare', 'pages-project', projectName, 'missing');
	}
	return deleteCloudflareApiResource(
		`/accounts/${encodeURIComponent(accountId)}/pages/projects/${encodeURIComponent(projectName)}`,
		{ env, planOnly, name: projectName, type: 'pages-project' },
	);
}

export function listDnsRecordsForName(zoneId, name, env) {
	if (!zoneId || !name) {
		return [];
	}
	const result = cloudflareApiRequest(`/zones/${encodeURIComponent(zoneId)}/dns_records?name=${encodeURIComponent(name)}&per_page=100`, { env, allowFailure: true });
	return Array.isArray(result?.result) ? result.result : [];
}

export function deleteDnsRecordsForName(deployConfig, name, { env, planOnly }) {
	if (!name) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'missing')];
	}
	if (planOnly) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'planned')];
	}
	const zoneId = resolveCloudflareZoneIdForHost(deployConfig, name, env);
	if (!zoneId) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'blocked', { reason: 'zone_unresolved' })];
	}
	const records = listDnsRecordsForName(zoneId, name, env);
	if (records.length === 0) {
		return [resourceOperation('cloudflare', 'dns-record', name, 'missing', { zoneId })];
	}
	return records.map((record) => {
		const recordName = record?.name ?? name;
		return deleteCloudflareApiResource(
			`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`,
			{ env, planOnly: false, name: recordName, type: 'dns-record' },
		);
	});
}
