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
import { deleteD1Database, looksLikeMissingResource, resourceOperation } from './collect-missing-deploy-inputs.ts';
import { cloudflareApiRequest } from './cloudflare-api-request.ts';
import { queueId, queueName } from './assert-cloudflare-cache-purge-succeeded.ts';
import { listQueues } from './run-wrangler.ts';
import { sleepSync } from './default-compatibility-date.ts';

export function deleteCloudflareApiResource(path, { env, planOnly, name, type }) {
	if (!path) {
		return resourceOperation('cloudflare', type, name, 'missing');
	}
	if (planOnly) {
		return resourceOperation('cloudflare', type, name, 'planned', { path });
	}
	const result = cloudflareApiRequest(path, { method: 'DELETE', env, allowFailure: true });
	if (result?.success === false && !looksLikeMissingResource(formatCloudflareErrors(result))) {
		throw new Error(formatCloudflareErrors(result) || `Failed to delete Cloudflare ${type} ${name}.`);
	}
	return resourceOperation('cloudflare', type, name, result?.success === false ? 'missing' : 'deleted', { path });
}

export function formatCloudflareErrors(payload) {
	return Array.isArray(payload?.errors)
		? payload.errors.map((entry) => entry?.message ?? JSON.stringify(entry)).filter(Boolean).join('; ')
		: '';
}

export function deleteQueueByName(tenantRoot, queue, { env, planOnly }) {
	const name = queueName(queue) ?? queue?.name ?? null;
	let id = queueId(queue);
	if (!name) {
		return resourceOperation('cloudflare', 'queue', name, 'missing');
	}
	if (planOnly) {
		return resourceOperation('cloudflare', 'queue', name, 'planned', { id });
	}
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!id && accountId) {
		const live = listQueues(tenantRoot, env).find((entry) => queueName(entry) === name);
		id = queueId(live);
	}
	const path = id
		? `/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(id)}`
		: null;
	if (path) {
		const deleted = deleteCloudflareApiResource(path, { env, planOnly: false, name, type: 'queue' });
		if (deleted.status === 'deleted' || deleted.status === 'missing') {
			return { ...deleted, id };
		}
	}
	if (accountId) {
		return resourceOperation('cloudflare', 'queue', name, 'missing', { id });
	}
	throw new Error(`Failed to delete queue ${name}: CLOUDFLARE_ACCOUNT_ID is not configured.`);
}

export function deleteR2Bucket(tenantRoot, bucketName, { env, planOnly, deleteData }) {
	if (!bucketName) {
		return resourceOperation('cloudflare', 'r2-bucket', bucketName, 'missing');
	}
	if (!deleteData) {
		return resourceOperation('cloudflare', 'r2-bucket', bucketName, 'skipped', { reason: 'data_preserved' });
	}
	if (planOnly) {
		return resourceOperation('cloudflare', 'r2-bucket', bucketName, 'planned');
	}
	const drained = drainR2Bucket(bucketName, { env });
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, planOnly: false, name: bucketName, type: 'r2-bucket' });
	return resourceOperation('cloudflare', 'r2-bucket', bucketName, deleted.status, drained);
}

export function r2ObjectKey(entry) {
	return typeof entry?.key === 'string' ? entry.key
		: typeof entry?.name === 'string' ? entry.name
			: '';
}

export function listR2Objects(bucketName, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId || !bucketName) {
		return [];
	}
	const objects = [];
	let cursor = '';
	for (let page = 0; page < 20; page += 1) {
		const payload = cloudflareApiRequest(
			`/accounts/${encodeURIComponent(accountId)}/r2/buckets/${encodeURIComponent(bucketName)}/objects?per_page=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
			{ env, allowFailure: true },
		);
		if (payload?.success === false) {
			break;
		}
		const pageObjects = Array.isArray(payload?.result)
			? payload.result
			: Array.isArray(payload?.result?.objects)
				? payload.result.objects
				: [];
		objects.push(...pageObjects);
		const nextCursor = typeof payload?.result_info?.cursor === 'string' ? payload.result_info.cursor
			: typeof payload?.result?.cursor === 'string' ? payload.result.cursor
				: '';
		if (!nextCursor || nextCursor === cursor || pageObjects.length === 0) {
			break;
		}
		cursor = nextCursor;
		if (objects.length >= 200) {
			break;
		}
	}
	return objects;
}

export function drainR2Bucket(bucketName, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	if (!accountId || !bucketName) {
		return { objectsDeleted: 0, objectsMissing: 0, objectsDeferred: 0 };
	}
	let objectsDeleted = 0;
	let objectsMissing = 0;
	let objectsDeferred = 0;
	for (let batch = 0; batch < 100; batch += 1) {
		const objects = listR2Objects(bucketName, { env });
		if (objects.length === 0) {
			break;
		}
		const keys = objects.map((object) => r2ObjectKey(object)).filter(Boolean);
		const deleted = deleteR2ObjectsBatch(bucketName, keys, { env });
		objectsDeleted += deleted.objectsDeleted;
		objectsMissing += deleted.objectsMissing;
		objectsDeferred += deleted.objectsDeferred;
		const batchDeleted = deleted.objectsDeleted + deleted.objectsMissing;
		if (batchDeleted === 0) {
			if (deleted.objectsDeferred > 0) {
				sleepSync(3000);
				continue;
			}
			break;
		}
		if (deleted.objectsDeferred > 0) {
			sleepSync(1500);
		}
	}
	return { objectsDeleted, objectsMissing, objectsDeferred };
}

export function deleteR2ObjectsBatch(bucketName, keys, { env }) {
	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const token = env?.CLOUDFLARE_API_TOKEN ?? process.env.TREESEED_CLOUDFLARE_API_TOKEN ?? '';
	const uniqueKeys = [...new Set((keys ?? []).filter(Boolean))];
	if (!accountId || !bucketName || uniqueKeys.length === 0) {
		return { objectsDeleted: 0, objectsMissing: 0, objectsDeferred: 0 };
	}
	const script = `
const input = JSON.parse(await new Promise((resolve) => {
	let body = '';
	process.stdin.setEncoding('utf8');
	process.stdin.on('data', (chunk) => { body += chunk; });
	process.stdin.on('end', () => resolve(body || '{}'));
}));
let index = 0;
let deleted = 0;
let missing = 0;
let deferred = 0;
const failed = [];
async function removeKey(key) {
	function encodeObjectKey(value) {
		return String(value).split('/').map((part) => encodeURIComponent(part)).join('/');
	}
	const url = 'https://api.cloudflare.com/client/v4/accounts/'
		+ encodeURIComponent(input.accountId)
		+ '/r2/buckets/'
		+ encodeURIComponent(input.bucketName)
		+ '/objects/'
		+ encodeObjectKey(key);
	for (let attempt = 0; attempt < 6; attempt += 1) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), input.timeoutMs || 15000);
		try {
			const response = await fetch(url, {
				method: 'DELETE',
				headers: { authorization: 'Bearer ' + input.token },
				signal: controller.signal,
			});
			const text = await response.text();
			let payload = {};
			try { payload = text ? JSON.parse(text) : {}; } catch { payload = { errors: [{ message: text }] }; }
			if (response.ok && payload.success !== false) {
				deleted += 1;
				return;
			}
			const message = Array.isArray(payload.errors) ? payload.errors.map((entry) => entry?.message || JSON.stringify(entry)).join('; ') : text;
			if (/not found|does not exist|deleted|missing/i.test(message || '')) {
				missing += 1;
				return;
			}
			if (response.status === 429 || /rate limit|too many requests/i.test(message || '')) {
				await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
				continue;
			}
			failed.push({ key, message: message || \`delete failed with status \${response.status}\` });
			return;
		} catch (error) {
			if (attempt < 5 && /aborted|timed out|fetch failed|econnreset/i.test(error instanceof Error ? error.message : String(error))) {
				await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
				continue;
			}
			failed.push({ key, message: error instanceof Error ? error.message : String(error) });
			return;
		} finally {
			clearTimeout(timeout);
		}
	}
	deferred += 1;
}
async function worker() {
	for (;;) {
		const current = index;
		index += 1;
		if (current >= input.keys.length) return;
		await removeKey(input.keys[current]);
	}
}
await Promise.all(Array.from({ length: Math.min(input.concurrency || 4, input.keys.length) }, () => worker()));
process.stdout.write(JSON.stringify({ deleted, missing, deferred, failed }));
`.trim();
	const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
		stdio: ['pipe', 'pipe', 'pipe'],
		encoding: 'utf8',
		env: { ...process.env, ...(env ?? {}) },
		input: JSON.stringify({
			accountId,
			bucketName,
			keys: uniqueKeys,
			token,
			concurrency: 4,
			timeoutMs: 12000,
		}),
		timeout: 120000,
	});
	if (result.status !== 0 || result.error) {
		throw new Error(result.stderr?.trim() || result.error?.message || `Failed to delete R2 object batch for ${bucketName}.`);
	}
	let parsed;
	try {
		parsed = JSON.parse(result.stdout || '{}');
	} catch {
		throw new Error(`R2 object batch delete returned invalid JSON for ${bucketName}.`);
	}
	if (Array.isArray(parsed.failed) && parsed.failed.length > 0) {
		const first = parsed.failed[0];
		throw new Error(`Failed to delete ${parsed.failed.length} R2 objects from ${bucketName}: ${first?.message ?? first?.key ?? 'unknown error'}`);
	}
	return {
		objectsDeleted: Number(parsed.deleted) || 0,
		objectsMissing: Number(parsed.missing) || 0,
		objectsDeferred: Number(parsed.deferred) || 0,
	};
}

export function deleteD1DatabaseForDestroy(tenantRoot, databaseName, { env, planOnly, deleteData }) {
	if (!deleteData) {
		return resourceOperation('cloudflare', 'd1-database', databaseName, 'skipped', { reason: 'data_preserved' });
	}
	const result = deleteD1Database(tenantRoot, databaseName, { env, planOnly });
	return resourceOperation('cloudflare', 'd1-database', databaseName, result.status, result);
}
