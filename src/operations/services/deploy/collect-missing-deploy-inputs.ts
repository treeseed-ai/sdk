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
import { envOrNull, loadTenantDeployConfig } from './default-compatibility-date.ts';
import { isPlaceholderAccountId, missingContentRuntimeRequirements, missingTurnstileRequirements } from './assert-cloudflare-cache-purge-succeeded.ts';
import { listD1Databases, runWrangler } from './run-wrangler.ts';
import { isPlaceholderResourceId } from './ensure-pages-project-compatibility.ts';
import { deleteCloudflareApiResource } from './delete-cloudflare-api-resource.ts';

export function collectMissingDeployInputs(tenantRoot) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const missing = [];

	if (isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		missing.push({
			key: 'CLOUDFLARE_ACCOUNT_ID',
			label: 'Cloudflare account ID',
			message: 'Cloudflare account ID is missing. Set CLOUDFLARE_ACCOUNT_ID with treeseed config or provide it now.',
		});
	}

	if (deployConfig.providers?.content?.runtime === 'team_scoped_r2_overlay' && !envOrNull('TREESEED_EDITORIAL_PREVIEW_SECRET')) {
		missing.push({
			key: 'TREESEED_EDITORIAL_PREVIEW_SECRET',
			label: 'Editorial preview signing secret',
			message: 'Editorial preview signing secret is missing for deploy.',
		});
	}

	return missing;
}

export async function promptForMissingDeployInputs(tenantRoot) {
	const missing = collectMissingDeployInputs(tenantRoot);
	if (!missing.length || !process.stdin.isTTY || !process.stdout.isTTY) {
		return { prompted: false, provided: [] };
	}

	const rl = createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	const provided = [];

	try {
		console.log('Treeseed deploy needs a few missing values before it can continue.');
		console.log('These values will be used for this deploy process only. Persist them in your env files or CI secrets afterward.');

		for (const item of missing) {
			console.log(`- ${item.message}`);
			const answer = (await rl.question(`${item.label}: `)).trim();
			if (!answer) {
				continue;
			}
			process.env[item.key] = answer;
			provided.push(item.key);
		}
	} finally {
		rl.close();
	}

	return { prompted: true, provided };
}

export function validateDeployPrerequisites(tenantRoot, { requireRemote = true } = {}) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const issues = [];

	if (isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		issues.push(
			'Set CLOUDFLARE_ACCOUNT_ID with treeseed config or export it before deploying.',
		);
	}

	if (requireRemote) {
		issues.push(...missingTurnstileRequirements());
		issues.push(...missingContentRuntimeRequirements(deployConfig));

		const result = runWrangler(['whoami'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
		});
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		if (/You are not authenticated/i.test(output) || /wrangler login/i.test(output)) {
			issues.push('Authenticate Wrangler first with `wrangler login`.');
		}
	}

	if (issues.length > 0) {
		throw new Error(`Treeseed deploy prerequisites are not satisfied:\n- ${issues.join('\n- ')}`);
	}

	return deployConfig;
}

export function validateDestroyPrerequisites(tenantRoot, { requireRemote = true } = {}) {
	const deployConfig = loadTenantDeployConfig(tenantRoot);
	const issues = [];

	if (requireRemote && isPlaceholderAccountId(deployConfig.cloudflare.accountId)) {
		issues.push(
			'Set CLOUDFLARE_ACCOUNT_ID with treeseed config or export it before destroying infrastructure.',
		);
	}

	if (requireRemote) {
		const result = runWrangler(['whoami'], {
			cwd: tenantRoot,
			allowFailure: true,
			capture: true,
		});
		const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
		if (/You are not authenticated/i.test(output) || /wrangler login/i.test(output)) {
			issues.push('Authenticate Wrangler first with `wrangler login`.');
		}
	}

	if (issues.length > 0) {
		throw new Error(`Treeseed destroy prerequisites are not satisfied:\n- ${issues.join('\n- ')}`);
	}

	return deployConfig;
}

export function resolveExistingKvIdByName(kvNamespaces, expectedName, fallbackId) {
	if (fallbackId && !isPlaceholderResourceId(fallbackId)) {
		return fallbackId;
	}

	return kvNamespaces.find((entry) => entry?.title === expectedName)?.id ?? null;
}

export function resolveExistingTurnstileWidget(widgets, current) {
	if (!current?.name && !current?.sitekey) {
		return current;
	}
	const existing = widgets.find((entry) =>
		(current.sitekey && entry?.sitekey === current.sitekey)
		|| (current.name && entry?.name === current.name),
	);
	if (!existing?.sitekey) {
		return current;
	}
	return {
		...current,
		sitekey: existing.sitekey,
		secret: existing.secret ?? current.secret ?? null,
		domains: Array.isArray(existing.domains) ? existing.domains : current.domains ?? [],
		mode: existing.mode ?? current.mode ?? 'managed',
	};
}

export function resolveExistingD1ByName(d1Databases, expectedName, current) {
	if (current?.databaseId && !isPlaceholderResourceId(current.databaseId)) {
		return current;
	}

	const existing = d1Databases.find((entry) => entry?.name === expectedName);
	if (!existing?.uuid) {
		return current;
	}

	return {
		...current,
		databaseId: existing.uuid,
		previewDatabaseId: existing.previewDatabaseUuid ?? existing.uuid,
	};
}

export function looksLikeMissingResource(output) {
	return /not found|does not exist|could(?: not|n't) find|couldnt find|already deleted|deleted widget|access a deleted/i.test(output);
}

export function deleteKvNamespace(tenantRoot, namespaceId, { env, planOnly, preview = false }) {
	if (!namespaceId || isPlaceholderResourceId(namespaceId)) {
		return { status: 'missing', id: namespaceId };
	}

	if (planOnly) {
		return { status: 'planned', id: namespaceId, preview };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/storage/kv/namespaces/${encodeURIComponent(namespaceId)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, planOnly: false, name: namespaceId, type: 'kv-namespace' });
	return { status: deleted.status, id: namespaceId, preview };
}

export function deleteTurnstileWidget(sitekey, { env, planOnly, name = null }) {
	if (!sitekey || isPlaceholderResourceId(sitekey)) {
		return { status: 'missing', sitekey, name };
	}

	if (planOnly) {
		return { status: 'planned', sitekey, name };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/challenges/widgets/${encodeURIComponent(sitekey)}`
		: null;
	let deleted;
	try {
		deleted = deleteCloudflareApiResource(path, { env, planOnly: false, name: name ?? sitekey, type: 'turnstile-widget' });
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new Error(`Cloudflare Turnstile widget deletion failed. Ensure the API token has Turnstile Sites Write permission: ${detail}`);
	}
	return { status: deleted.status, sitekey, name };
}

export function deleteD1Database(tenantRoot, databaseName, { env, planOnly }) {
	if (!databaseName) {
		return { status: 'missing', name: databaseName };
	}

	if (planOnly) {
		return { status: 'planned', name: databaseName };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const database = accountId
		? listD1Databases(tenantRoot, env).find((entry) => entry?.name === databaseName)
		: null;
	const databaseId = database?.uuid ?? database?.id ?? null;
	const path = accountId && databaseId
		? `/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, planOnly: false, name: databaseName, type: 'd1-database' });
	return { status: deleted.status, name: databaseName, id: databaseId };
}

export function deleteWorker(tenantRoot, workerName, { env, planOnly, force = false }) {
	if (!workerName) {
		return { status: 'missing', name: workerName };
	}

	if (planOnly) {
		return { status: 'planned', name: workerName };
	}

	const accountId = env?.CLOUDFLARE_ACCOUNT_ID ?? process.env.TREESEED_CLOUDFLARE_ACCOUNT_ID ?? '';
	const path = accountId
		? `/accounts/${encodeURIComponent(accountId)}/workers/services/${encodeURIComponent(workerName)}`
		: null;
	const deleted = deleteCloudflareApiResource(path, { env, planOnly: false, name: workerName, type: 'worker' });
	return { status: deleted.status, name: workerName };
}

export function resourceOperation(provider, type, name, status, extra = {}) {
	return {
		provider,
		type,
		name: name ?? null,
		status,
		...extra,
	};
}
