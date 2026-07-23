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
import { LOCAL_DOCKER_RESOURCE_PATTERN, dockerAvailable, killPidFromFile, runDestroyDocker } from './delete-treeseed-cache-rules.ts';
import { deleteD1Database, deleteKvNamespace, deleteTurnstileWidget, deleteWorker, resourceOperation } from './collect-missing-deploy-inputs.ts';
import { primaryHost } from './default-compatibility-date.ts';
import { deleteCloudflareApiResource, deleteQueueByName, deleteR2Bucket } from './delete-cloudflare-api-resource.ts';
import { listD1Databases, listDnsRecords, listDnsZones, listKvNamespaces, listPagesProjects, listQueues, listR2Buckets, listTurnstileWidgets, listWorkers } from './run-wrangler.ts';
import { deletePagesCustomDomains, deletePagesDeployments, deletePagesProject } from './pages-domain-name.ts';

export function dockerList(formatArgs) {
	const result = runDestroyDocker(formatArgs);
	if (result.status !== 0) {
		return [];
	}
	return result.stdout
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean);
}

export function matchingDockerEntries(lines, parser) {
	return lines
		.map(parser)
		.filter((entry) => entry && LOCAL_DOCKER_RESOURCE_PATTERN.test(`${entry.name} ${entry.image ?? ''}`));
}

export function removeDockerResource(kind, id, name) {
	const args = kind === 'container'
		? ['rm', '-f', id]
		: kind === 'volume'
			? ['volume', 'rm', '-f', id]
			: ['network', 'rm', id];
	const result = runDestroyDocker(args);
	if (result.status === 0) {
		return resourceOperation('local', `docker-${kind}`, name, 'deleted', { id });
	}
	return resourceOperation('local', `docker-${kind}`, name, 'blocked', {
		id,
		reason: result.stderr?.trim() || result.stdout?.trim() || 'docker_remove_failed',
	});
}

export function dockerLocalRuntimeResourceOperations({ planOnly = false } = {}) {
	if (!dockerAvailable()) {
		return [resourceOperation('local', 'docker-cleanup', 'docker', 'skipped', { reason: 'docker_unavailable' })];
	}
	const containers = matchingDockerEntries(
		dockerList(['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}']),
		(line) => {
			const [id, name, image] = line.split('\t');
			return id && name ? { id, name, image } : null;
		},
	);
	const volumes = matchingDockerEntries(
		dockerList(['volume', 'ls', '--format', '{{.Name}}']),
		(line) => ({ id: line, name: line }),
	);
	const networks = matchingDockerEntries(
		dockerList(['network', 'ls', '--format', '{{.ID}}\t{{.Name}}']),
		(line) => {
			const [id, name] = line.split('\t');
			return id && name ? { id, name } : null;
		},
	).filter((entry) => !['bridge', 'host', 'none'].includes(entry.name));

	if (planOnly) {
		return [
			...containers.map((entry) => resourceOperation('local', 'docker-container', entry.name, 'planned', { id: entry.id })),
			...volumes.map((entry) => resourceOperation('local', 'docker-volume', entry.name, 'planned', { id: entry.id })),
			...networks.map((entry) => resourceOperation('local', 'docker-network', entry.name, 'planned', { id: entry.id })),
			...(containers.length || volumes.length || networks.length
				? []
				: [resourceOperation('local', 'docker-cleanup', 'docker', 'missing', { reason: 'no_matching_resources' })]),
		];
	}

	const operations = [];
	for (const entry of containers) {
		operations.push(removeDockerResource('container', entry.id, entry.name));
	}
	for (const entry of volumes) {
		operations.push(removeDockerResource('volume', entry.id, entry.name));
	}
	for (const entry of networks) {
		operations.push(removeDockerResource('network', entry.id, entry.name));
	}
	if (!operations.length) {
		operations.push(resourceOperation('local', 'docker-cleanup', 'docker', 'missing', { reason: 'no_matching_resources' }));
	}
	return operations;
}

export function destroyLocalRuntimeResources(tenantRoot, { planOnly = false, deleteData = false } = {}) {
	const operations = [];
	const pidDir = resolve(tenantRoot, '.treeseed/dev-pids');
	if (existsSync(pidDir)) {
		for (const entry of readdirSync(pidDir)) {
			if (entry.endsWith('.pid')) {
				operations.push(killPidFromFile(resolve(pidDir, entry), { planOnly }));
			}
		}
	} else {
		operations.push(resourceOperation('local', 'dev-pids', pidDir, 'missing'));
	}
	if (deleteData) {
		for (const relativePath of [
			'.treeseed/generated/environments/local',
			'.treeseed/generated/dev',
			'.treeseed/operations-runner',
			'.treeseed/local-capacity-provider/data',
		]) {
			const absolutePath = resolve(tenantRoot, relativePath);
			if (!existsSync(absolutePath)) {
				operations.push(resourceOperation('local', 'data-path', relativePath, 'missing'));
				continue;
			}
			if (planOnly) {
				operations.push(resourceOperation('local', 'data-path', relativePath, 'planned'));
				continue;
			}
			rmSync(absolutePath, { recursive: true, force: true });
			operations.push(resourceOperation('local', 'data-path', relativePath, 'deleted'));
		}
		operations.push(...dockerLocalRuntimeResourceOperations({ planOnly }));
	} else {
		operations.push(resourceOperation('local', 'data-path', '.treeseed/generated/environments/local', 'skipped', { reason: 'data_preserved' }));
	}
	return { operations };
}

export function treeSeedSweepTokens(deployConfig, state) {
	const configuredHosts = [
		deployConfig.siteUrl,
		deployConfig.surfaces?.web?.publicBaseUrl,
		deployConfig.surfaces?.web?.environments?.staging?.domain,
		deployConfig.surfaces?.web?.environments?.prod?.domain,
		deployConfig.surfaces?.api?.environments?.staging?.domain,
		deployConfig.surfaces?.api?.environments?.prod?.domain,
		deployConfig.services?.api?.environments?.staging?.domain,
		deployConfig.services?.api?.environments?.prod?.domain,
	].map((value) => primaryHost(value) ?? value);
	return [...new Set([
		'treeseed',
		deployConfig.slug,
		deployConfig.name,
		state.identity?.deploymentKey,
		state.identity?.environmentKey,
		state.pages?.projectName,
		state.workerName,
		state.content?.bucketName,
		state.kvNamespaces?.FORM_GUARD_KV?.name,
		state.kvNamespaces?.SESSION?.name,
		state.d1Databases?.SITE_DATA_DB?.databaseName,
		...configuredHosts,
	].map((value) => String(value ?? '').trim().toLowerCase()).filter((value) => value.length >= 4))];
}

export function isProtectedAiIntegrationResource(value) {
	return /(?:^|[-_.])(?:ai-gateway|workers-ai|ai-integration|openai|anthropic)(?:[-_.]|$)/iu.test(String(value ?? ''));
}

export function matchesTreeSeedSweep(value, tokens) {
	const normalized = String(value ?? '').trim().toLowerCase();
	if (!normalized || isProtectedAiIntegrationResource(normalized)) {
		return false;
	}
	return tokens.some((token) => normalized === token || normalized.includes(token));
}

export function cloudflareNameCandidates(entry) {
	return [
		entry?.name,
		entry?.title,
		entry?.id,
		entry?.queue_name,
		entry?.script,
		entry?.domain,
		entry?.hostname,
		entry?.content,
		entry?.comment,
		...(Array.isArray(entry?.domains) ? entry.domains : []),
		...(Array.isArray(entry?.tags) ? entry.tags : []),
	].filter(Boolean);
}

export function cloudflareEntryMatchesTreeSeed(entry, tokens) {
	return cloudflareNameCandidates(entry).some((candidate) => matchesTreeSeedSweep(candidate, tokens));
}

export function deleteDnsRecord(zoneId, record, { env, planOnly }) {
	const name = record?.name ?? record?.content ?? record?.id ?? null;
	if (!zoneId || !record?.id) {
		return resourceOperation('cloudflare', 'dns-record', name, 'missing', { zoneId });
	}
	if (planOnly) {
		return resourceOperation('cloudflare', 'dns-record', name, 'planned', {
			zoneId,
			id: record.id,
			content: record.content ?? null,
			recordType: record.type ?? null,
		});
	}
	return deleteCloudflareApiResource(
		`/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(record.id)}`,
		{ env, planOnly: false, name, type: 'dns-record' },
	);
}

export function sweepTreeSeedCloudflareResources(tenantRoot, deployConfig, state, { env, planOnly, deleteData }) {
	const tokens = treeSeedSweepTokens(deployConfig, state);
	const operations = [];
	const pagesProjects = listPagesProjects(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens));
	for (const project of pagesProjects) {
		const projectName = project?.name ?? project?.id ?? null;
		operations.push(...deletePagesCustomDomains(tenantRoot, projectName, [], { env, planOnly, knownOnly: false }));
		operations.push(deletePagesDeployments(tenantRoot, projectName, { env, planOnly, environment: 'all' }));
		operations.push(deletePagesProject(projectName, { env, planOnly }));
	}

	for (const worker of listWorkers(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const name = worker?.id ?? worker?.name ?? worker?.script ?? null;
		const deleted = deleteWorker(tenantRoot, name, { env, planOnly, force: true });
		operations.push(resourceOperation('cloudflare', 'worker', name, deleted.status, { ...deleted, sweep: true }));
	}

	for (const namespace of listKvNamespaces(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const deleted = deleteKvNamespace(tenantRoot, namespace.id, { env, planOnly });
		operations.push(resourceOperation('cloudflare', 'kv-namespace', namespace.title ?? namespace.id, deleted.status, { ...deleted, sweep: true }));
	}

	for (const queue of listQueues(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		operations.push({ ...deleteQueueByName(tenantRoot, queue, { env, planOnly }), sweep: true });
	}

	for (const database of listD1Databases(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const name = database?.name ?? database?.uuid ?? database?.id ?? null;
		const deleted = deleteData ? deleteD1Database(tenantRoot, name, { env, planOnly }) : null;
		operations.push(resourceOperation('cloudflare', 'd1-database', name, deleteData ? deleted?.status : 'skipped', {
			...(deleteData ? deleted : { reason: 'data_preserved' }),
			sweep: true,
		}));
	}

	for (const bucket of listR2Buckets(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		operations.push({ ...deleteR2Bucket(tenantRoot, bucket.name, { env, planOnly, deleteData }), sweep: true });
	}

	for (const widget of listTurnstileWidgets(tenantRoot, env).filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens))) {
		const deleted = deleteTurnstileWidget(widget.sitekey, { env, planOnly, name: widget.name });
		operations.push(resourceOperation('cloudflare', 'turnstile-widget', widget.name ?? widget.sitekey, deleted.status, { ...deleted, sweep: true }));
	}

	for (const zone of listDnsZones(env)) {
		const zoneId = zone?.id ?? null;
		for (const record of listDnsRecords(zoneId, env)) {
			if (record?.type === 'SOA' || record?.type === 'NS') {
				continue;
			}
			if (!cloudflareEntryMatchesTreeSeed(record, tokens)) {
				continue;
			}
			operations.push({ ...deleteDnsRecord(zoneId, record, { env, planOnly }), zoneName: zone?.name ?? null, sweep: true });
		}
	}

	return operations.length > 0
		? operations
		: [resourceOperation('cloudflare', 'treeseed-sweep', 'cloudflare', 'missing', { reason: 'no_matching_resources' })];
}

export function countMatchingCloudflareEntries(entries, tokens) {
	return entries.filter((entry) => cloudflareEntryMatchesTreeSeed(entry, tokens)).length;
}
