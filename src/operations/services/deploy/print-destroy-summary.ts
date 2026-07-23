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


export function printDestroySummary(result) {
	const { summary, operations } = result;
	const cloudflare = Array.isArray(operations?.cloudflare) ? operations.cloudflare : null;
	const legacy = cloudflare
		? {
			worker: cloudflare.find((entry) => entry.type === 'worker'),
			database: cloudflare.find((entry) => entry.type === 'd1-database'),
			formGuard: cloudflare.find((entry) => entry.type === 'kv-namespace'),
			formGuardPreview: cloudflare.find((entry) => entry.type === 'kv-namespace-preview'),
			session: cloudflare.find((entry) => entry.type === 'kv-namespace' && entry.name === summary.sessionKv?.name),
			sessionPreview: cloudflare.find((entry) => entry.type === 'kv-namespace-preview' && entry.name === summary.sessionKv?.name),
		}
		: operations;
	console.log('Treeseed destroy summary');
	console.log(`  Target: ${summary.target}`);
	console.log(`  Worker: ${summary.workerName} -> ${legacy.worker?.status ?? 'unknown'}`);
	console.log(`  Site URL: ${summary.siteUrl}`);
	console.log(`  Account ID: ${summary.accountId}`);
	console.log(`  D1: ${summary.siteDataDb.databaseName} -> ${legacy.database?.status ?? 'unknown'}`);
	console.log(`  KV FORM_GUARD_KV: ${summary.formGuardKv.name} -> ${legacy.formGuard?.status ?? 'unknown'}`);
	if (legacy.formGuardPreview) {
		console.log(`  KV FORM_GUARD_KV preview -> ${legacy.formGuardPreview.status}`);
	}
	if (summary.sessionKv && legacy.session) {
		console.log(`  KV SESSION (deprecated): ${summary.sessionKv.name} -> ${legacy.session.status}`);
	}
	if (legacy.sessionPreview) {
		console.log(`  KV SESSION preview -> ${legacy.sessionPreview.status}`);
	}
	if (cloudflare) {
		for (const entry of [
			...cloudflare.filter((item) => !['worker', 'd1-database', 'kv-namespace', 'kv-namespace-preview'].includes(item.type)),
			...(Array.isArray(operations?.railway) ? operations.railway : []),
			...(Array.isArray(operations?.local) ? operations.local : []),
		]) {
			console.log(`  ${entry.provider} ${entry.type} ${entry.name ?? '(none)'} -> ${entry.status}`);
		}
	}
}
