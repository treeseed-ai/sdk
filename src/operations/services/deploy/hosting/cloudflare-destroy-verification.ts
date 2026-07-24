import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { resolveWebCachePolicy } from '../../../../platform/hosting/deploy-config.ts';
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
} from '../../hosting/railway/railway-api.ts';
import { loadCliDeployConfig, resolveWranglerBin } from '../../agents/runtime-tools.ts';
import { sdkD1MigrationsRoot } from '../../runtime/runtime-paths.ts';
import { countMatchingCloudflareEntries, dockerList, matchesSweep, matchingDockerEntries, SweepTokens } from '../support/docker-list.ts';
import { listD1Databases, listDnsRecords, listDnsZones, listKvNamespaces, listPagesProjects, listQueues, listR2Buckets, listTurnstileWidgets, listWorkers } from '../support/run-wrangler.ts';
import { dockerAvailable } from '../support/delete-cache-rules.ts';
import { resourceOperation } from './collect-missing-deploy-inputs.ts';

export function cloudflareDestroyVerification(tenantRoot, deployConfig, state, env) {
	const tokens = SweepTokens(deployConfig, state);
	const zoneIds = new Set([
		deployConfig.cloudflare?.zoneId,
		state.webCache?.webZoneId,
		state.webCache?.contentZoneId,
	]);
	for (const zone of listDnsZones(env)) {
		if (zone?.id) {
			zoneIds.add(zone.id);
		}
	}
	const dnsRecords = [];
	for (const zoneId of [...zoneIds].filter(Boolean)) {
		dnsRecords.push(...listDnsRecords(zoneId, env));
	}
	const remaining = {
		pages: countMatchingCloudflareEntries(listPagesProjects(tenantRoot, env), tokens),
		workers: countMatchingCloudflareEntries(listWorkers(tenantRoot, env), tokens),
		kvNamespaces: countMatchingCloudflareEntries(listKvNamespaces(tenantRoot, env), tokens),
		queues: countMatchingCloudflareEntries(listQueues(tenantRoot, env), tokens),
		d1Databases: countMatchingCloudflareEntries(listD1Databases(tenantRoot, env), tokens),
		r2Buckets: countMatchingCloudflareEntries(listR2Buckets(tenantRoot, env), tokens),
		turnstileWidgets: countMatchingCloudflareEntries(listTurnstileWidgets(tenantRoot, env), tokens),
		dnsRecords: countMatchingCloudflareEntries(
			dnsRecords.filter((record) => record?.type !== 'SOA' && record?.type !== 'NS'),
			tokens,
		),
	};
	const totalRemaining = Object.values(remaining).reduce((sum, value) => sum + value, 0);
	return {
		provider: 'cloudflare',
		method: 'cloudflare-api',
		status: totalRemaining === 0 ? 'clean' : 'remaining',
		remaining,
		totalRemaining,
	};
}

export function localDockerDestroyVerification() {
	if (!dockerAvailable()) {
		return {
			provider: 'local-docker',
			method: 'docker-cli',
			status: 'skipped',
			reason: 'docker_unavailable',
			remaining: {
				containers: 0,
				volumes: 0,
				networks: 0,
			},
			totalRemaining: 0,
		};
	}
	const containers = matchingDockerEntries(
		dockerList(['ps', '-a', '--format', '{{.ID}}\t{{.Names}}\t{{.Image}}']),
		(line) => {
			const [id, name, image] = line.split('\t');
			return id && name ? { id, name, image } : null;
		},
	).length;
	const volumes = matchingDockerEntries(
		dockerList(['volume', 'ls', '--format', '{{.Name}}']),
		(line) => ({ id: line, name: line }),
	).length;
	const networks = matchingDockerEntries(
		dockerList(['network', 'ls', '--format', '{{.ID}}\t{{.Name}}']),
		(line) => {
			const [id, name] = line.split('\t');
			return id && name ? { id, name } : null;
		},
	).filter((entry) => !['bridge', 'host', 'none'].includes(entry.name)).length;
	const remaining = { containers, volumes, networks };
	const totalRemaining = containers + volumes + networks;
	return {
		provider: 'local-docker',
		method: 'docker-cli',
		status: totalRemaining === 0 ? 'clean' : 'remaining',
		remaining,
		totalRemaining,
	};
}

export async function sweepRailwayResources(deployConfig, state, { env, planOnly }) {
	if (!resolveRailwayApiToken(env)) {
		return [resourceOperation('railway', 'treeseed-sweep', 'railway', 'blocked', { reason: 'missing_railway_api_token' })];
	}
	const tokens = SweepTokens(deployConfig, state);
	const workspace = await resolveRailwayWorkspaceContext({ env, workspace: resolveRailwayWorkspace(env) });
	const projects = await listRailwayProjects({ env, workspaceId: workspace.id });
	const operations = [];
	for (const project of projects) {
		if (project.deletedAt || !matchesSweep(project.name, tokens)) {
			continue;
		}
		if (planOnly) {
			operations.push(resourceOperation('railway', 'project', project.name, 'planned', {
				id: project.id,
				workspaceId: workspace.id,
				sweep: true,
			}));
		} else {
			throw new Error('Railway project sweep deletion is reconciler-owned. Use trsd reconcile test-live --mode cleanup for isolated cleanup.');
		}
	}
	return operations.length > 0
		? operations
		: [resourceOperation('railway', 'treeseed-sweep', 'railway', 'missing', { reason: 'no_matching_projects' })];
}
