import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { ApiPrincipal, RemoteConfig, RemoteHost } from '../../../../entrypoints/clients/remote.ts';
import {
	getEnvironmentSuggestedValues,
	isEnvironmentEntryRelevant,
	isEnvironmentEntryRequired,
	resolveEnvironmentRegistry,
	ENVIRONMENT_SCOPES,
	type EnvironmentPurpose,
	type EnvironmentValidation,
	validateEnvironmentValues,
} from '../../../../platform/configuration/environment.ts';
import { loadManifest } from '../../../../platform/configuration/tenant-config.ts';
import {
	buildProvisioningSummary,
	createPersistentDeployTarget,
	ensureGeneratedWranglerConfig,
	loadDeployState,
	provisionCloudflareResources,
	syncCloudflareSecrets,
	verifyProvisionedCloudflareResources,
} from '../../hosting/deployment/deploy.ts';
import {
	collectReconcileStatus,
	reconcileTarget,
	resolveBootstrapSelection,
	type BootstrapSystem,
	type DesiredUnit,
	type RunnableBootstrapSystem,
} from '../../../../reconcile/index.ts';
import {
	ensureGitHubBootstrapRepository,
	maybeResolveGitHubRepositorySlug,
} from '../../repositories/github-automation.ts';
import {
	buildRailwayCommandEnv,
	configuredRailwayServices,
	validateRailwayDeployPrerequisites,
} from '../../hosting/railway/railway-deploy.ts';
import {
	ensureRailwayEnvironment,
	ensureRailwayProject,
	ensureRailwayService,
	normalizeRailwayEnvironmentName,
	resolveRailwayWorkspace,
	resolveRailwayWorkspaceContext,
	upsertRailwayVariables,
} from '../../hosting/railway/railway-api.ts';
import { discoverApplications } from '../../../../hosting/apps.ts';
import {
	createGitHubApiClient,
	ensureGitHubBranchFromBase,
	listGitHubEnvironmentSecretNames,
	listGitHubEnvironmentVariableNames,
} from '../../repositories/github-api.ts';
import { resolveGitHubCredentialForRepository } from '../../configuration/github-credentials.ts';
import { loadCliDeployConfig, packageDistScriptRoot, packageScriptPath, resolveWranglerBin, withProcessCwd } from '../../agents/runtime-tools.ts';
import { PRODUCTION_BRANCH, STAGING_BRANCH } from '../../operations/git-workflow.ts';
import {
	createManagedToolEnv,
	resolveToolBinary,
	resolveToolCommand,
} from '../../../../entrypoints/runtime/managed-dependencies.ts';
import { GITHUB_TOKEN_ENV, resolveGitHubToken, withServiceCredentialEnv } from '../../../../configuration/service-credentials.ts';
import {
	filterManagedHostGitHubEnvironment,
	usesManagedHostOperationRequests,
} from '../../hosting/audit/managed-host-security.ts';
import {
	assertKeyAgentResponse,
	getKeyAgentPaths,
	inspectKeyAgentDiagnostics,
	readWrappedMachineKeyFile,
	replaceWrappedMachineKey,
	rotateWrappedMachineKeyPassphrase,
	KEY_AGENT_IDLE_TIMEOUT_MS,
	MACHINE_KEY_PASSPHRASE_ENV,
	KeyAgentError,
	unwrapMachineKey,
	type KeyAgentStatus,
} from '../../configuration/key-agent.ts';
import { checkCloudflareConnection, checkGitHubConnection, isTransientProviderConnectionError, providerConnectionResult } from '../agents/ensure-act-verification-tooling.ts';
import { railwayConnectionCheckCache } from '../configuration/machine-config-relative-path.ts';
import { collectConfigSeedValues } from '../support/resolve-entry-value-from-buckets.ts';
import { colorize, formatConfigSectionTitle } from '../support/summarize-persistent-readiness.ts';

export async function checkRailwayConnection({ tenantRoot, env }) {
	if (!env.TREESEED_RAILWAY_API_TOKEN) {
		return providerConnectionResult('railway', false, 'TREESEED_RAILWAY_API_TOKEN is not configured.', { skipped: true });
	}
	const workspaceName = env.TREESEED_RAILWAY_WORKSPACE || resolveRailwayWorkspace(env);
	const cacheKey = JSON.stringify({
		tenantRoot,
		token: env.TREESEED_RAILWAY_API_TOKEN,
		workspaceName,
	});
	const cached = railwayConnectionCheckCache.get(cacheKey);
	if (cached) {
		return await cached;
	}
	const checkPromise = (async () => {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				const workspace = await resolveRailwayWorkspaceContext({ env, workspace: workspaceName });
				return providerConnectionResult('railway', true, `Railway API token can access workspace ${workspace.name}. Project and service existence will be reconciled during bootstrap.`);
			} catch (error) {
				const detail = error instanceof Error ? error.message : 'Railway API check failed.';
				if (/rate.?limit|too many requests|429/iu.test(detail || '')) {
					return providerConnectionResult(
						'railway',
						false,
						'Railway connectivity preflight was rate-limited; bootstrap will continue and rely on API-backed reconcile verification.',
						{ skipped: true, warning: true, rateLimited: true },
					);
				}
				if (attempt >= 2 && isTransientProviderConnectionError(detail)) {
					return providerConnectionResult(
						'railway',
						false,
						'Railway connectivity preflight hit transient API failures; bootstrap will continue and rely on API-backed reconcile verification.',
						{ skipped: true, warning: true, transient: true },
					);
				}
				if (attempt >= 2 || !isTransientProviderConnectionError(detail)) {
					return providerConnectionResult('railway', false, detail);
				}
			}
		}
		return providerConnectionResult('railway', false, 'Railway API check failed.');
	})();
	railwayConnectionCheckCache.set(cacheKey, checkPromise);
	try {
		return await checkPromise;
	} catch (error) {
		railwayConnectionCheckCache.delete(cacheKey);
		throw error;
	}
}

export async function checkProviderConnections({ tenantRoot, scope = 'prod', env = process.env, valuesOverlay = {} } = {}) {
	const values = collectConfigSeedValues(tenantRoot, scope, env, valuesOverlay);
	const passthroughValue = (key: string) => {
		const overlayValue = valuesOverlay?.[key];
		if (typeof overlayValue === 'string' && overlayValue.trim()) {
			return overlayValue.trim();
		}
		const envValue = env?.[key];
		if (typeof envValue === 'string' && envValue.trim()) {
			return envValue.trim();
		}
		const resolvedValue = values?.[key];
		return typeof resolvedValue === 'string' && resolvedValue.trim() ? resolvedValue.trim() : undefined;
	};
	const githubCredentialValues = Object.fromEntries(
		Object.entries(values).filter(([key, value]) => key.startsWith('TREESEED_GITHUB_TOKEN_') && typeof value === 'string' && value.trim()),
	);
	const rawCommandEnv = {
		...githubCredentialValues,
		TREESEED_GITHUB_TOKEN: resolveGitHubToken(values),
		TREESEED_GITHUB_IDENTITY_MODE: passthroughValue('TREESEED_GITHUB_IDENTITY_MODE'),
		TREESEED_HOSTED_HUBS_GITHUB_OWNER: passthroughValue('TREESEED_HOSTED_HUBS_GITHUB_OWNER'),
		TREESEED_CLOUDFLARE_API_TOKEN: values.TREESEED_CLOUDFLARE_API_TOKEN,
		TREESEED_CLOUDFLARE_ACCOUNT_ID: values.TREESEED_CLOUDFLARE_ACCOUNT_ID,
		TREESEED_RAILWAY_API_TOKEN: values.TREESEED_RAILWAY_API_TOKEN,
		TREESEED_RAILWAY_WORKSPACE: values.TREESEED_RAILWAY_WORKSPACE || resolveRailwayWorkspace(values),
	};
	const commandEnv = buildRailwayCommandEnv(createManagedToolEnv(rawCommandEnv));
	const checks = [
		checkGitHubConnection({ tenantRoot, env: commandEnv }),
		checkCloudflareConnection({ tenantRoot, env: commandEnv }),
	];
	const railwayCheck = await checkRailwayConnection({ tenantRoot, env: commandEnv });
	checks.push(railwayCheck);
	return {
		scope,
		ok: checks.every((check) => check.ready || check.skipped),
		checks,
		issues: checks
			.filter((check) => !check.ready && !check.skipped)
			.map((check) => check.detail),
	};
}

export function formatProviderConnectionReport(report) {
	const lines = [formatConfigSectionTitle(`Provider connection checks for ${report.scope}`)];
	for (const check of report.checks) {
		const label = check.provider[0].toUpperCase() + check.provider.slice(1);
		const status = check.ready ? colorize('ready', '32') : check.skipped ? colorize('skipped', '33') : colorize('failed', '31');
		lines.push(`${label}: ${status} - ${check.detail}`);
	}
	return lines.join('\n');
}

export function formatProviderConnectionFailures(
	reports: Array<ReturnType<typeof checkProviderConnections>>,
) {
	const failing = reports.filter((report) => report.checks.some((check) => !check.ready && !check.skipped));
	if (failing.length === 0) {
		return '';
	}
	return [
		'Treeseed provider connection checks failed.',
		...failing.map((report) => formatProviderConnectionReport(report)),
	].join('\n');
}

export function writeProviderConnectionReport(write, report) {
	write(formatProviderConnectionReport(report));
}

export async function runBounded<T>(
	items: T[],
	limit: number,
	worker: (item: T, index: number) => Promise<void>,
) {
	const concurrency = Math.max(1, Math.min(limit, items.length || 1));
	let nextIndex = 0;
	const workers = Array.from({ length: concurrency }, async () => {
		for (;;) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= items.length) {
				return;
			}
			await worker(items[index]!, index);
		}
	});
	await Promise.all(workers);
}

export function repositorySlugFromPackageJson(root: string) {
	try {
		const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>;
		const repository = packageJson.repository;
		const raw = typeof repository === 'string'
			? repository
			: repository && typeof repository === 'object' && !Array.isArray(repository)
				? (repository as Record<string, unknown>).url
				: null;
		if (typeof raw !== 'string') return null;
		const normalized = raw
			.trim()
			.replace(/^git\+/u, '')
			.replace(/^ssh:\/\/git@github\.com[:/]/u, '')
			.replace(/^git@github\.com:/u, '')
			.replace(/^https:\/\/github\.com\//u, '')
			.replace(/\.git$/u, '')
			.replace(/\/$/u, '');
		return /^[^/\s]+\/[^/\s]+$/u.test(normalized) ? normalized : null;
	} catch {
		return null;
	}
}

export function resolveGitHubRepositorySlugForPath(root: string) {
	try {
		return maybeResolveGitHubRepositorySlug(root);
	} catch {
		return null;
	}
}

export function discoverGitHubEnvironmentSyncTargets(tenantRoot: string, explicitRepository?: string | null) {
	const targets = new Map<string, { repository: string; managedHostMode: 'auto' | 'direct' | 'managed' }>();
	const add = (repository: string | null | undefined, managedHostMode: 'auto' | 'direct' | 'managed') => {
		if (!repository || !repository.trim()) return;
		const normalized = repository.trim();
		const existing = targets.get(normalized);
		if (!existing || (existing.managedHostMode === 'managed' && managedHostMode === 'direct')) {
			targets.set(normalized, { repository: normalized, managedHostMode });
		}
	};
	add(explicitRepository ?? resolveGitHubRepositorySlugForPath(tenantRoot), 'auto');
	for (const application of discoverApplications(tenantRoot)) {
		const repository = resolveGitHubRepositorySlugForPath(application.root) ?? repositorySlugFromPackageJson(application.root);
		const managedHostMode = usesManagedHostOperationRequests(application.config) ? 'managed' : 'direct';
		add(repository, managedHostMode);
	}
	return [...targets.values()];
}

export function withGitHubEnvironmentCredentialContext(
	error: unknown,
	repository: string,
	credential: ReturnType<typeof resolveGitHubCredentialForRepository>,
) {
	const message = error instanceof Error && error.message.trim()
		? error.message.trim()
		: String(error ?? 'GitHub environment sync failed.');
	if (credential.fallbackUsed && /authentication failed|resource not accessible|403/iu.test(message)) {
		return new Error(`${message} Configure ${credential.envName} with Actions environment secrets and variables permissions for ${repository}; the fallback TREESEED_GITHUB_TOKEN is not sufficient for this repository.`);
	}
	return error;
}

export function githubConfigSyncUnitId(value: string) {
	return String(value || 'unknown').replace(/[^A-Za-z0-9:._/-]+/gu, '-');
}
