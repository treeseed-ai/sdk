import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runRepositoryGit } from '../../operations/services/operations/git-runner.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { discoverApplications } from '../../hosting/apps.ts';
import { githubRepositoryCredentialEnvName } from '../../operations/services/configuration/github-credentials.ts';
import { discoverPackageAdapters } from '../../operations/services/reconciliation/package-adapters.ts';
import type { DeployConfig, TenantConfig } from '../support/contracts.ts';
import { loadDeployConfig } from '../hosting/deploy-config.ts';
import { loadPlugins, type LoadedPluginRegistration } from '../support/plugins.ts';
import { loadManifest } from '../configuration/tenant-config.ts';
import { DEFAULT_MARKET_BASE_URL, NamedPredicateMap, NamedResolverMap, EnvironmentContext, EnvironmentRegistryOverlay, EnvironmentScope, smtpEnabled, turnstileEnabled, webSurfaceEnabled } from './environment-scopes.ts';
import { apiSurfaceEnabled, codexExecutionSelected, contactEmailDefault, copilotExecutionSelected, formsEnabled, generatedSecret, hostedProjectEnabled, localApiDatabaseUrlDefault, localSmtpHostDefault, localSmtpPortDefault, marketControlPlaneEnabled, processingPlaneEnabled, projectDomainsDefault, projectRegistrationEnabled, railwayManagedEnabled, resolveApiWebServiceId, resolveConfiguredApiBaseUrl, resolveContentBucketName, resolveHostingKind, resolveHostingRegistration, resolveHubMode, resolvePagesPreviewProjectName, resolvePagesProjectName, resolveRuntimeMode, resolveRuntimeRegistration, resolveWebServiceId, selfHostedProjectEnabled } from './api-surface-enabled.ts';

export function resolveContentBucketBinding(context: EnvironmentContext) {
	return context.deployConfig.cloudflare.r2?.binding?.trim() || 'TREESEED_CONTENT_BUCKET';
}

export function resolveMarketBaseUrl(
	context: EnvironmentContext,
	_scope: EnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_API_BASE_URL?.trim()
		|| values.TREESEED_CENTRAL_MARKET_API_BASE_URL?.trim()
		|| process.env.TREESEED_API_BASE_URL?.trim()
		|| process.env.TREESEED_CENTRAL_MARKET_API_BASE_URL?.trim()
		|| context.deployConfig.runtime?.marketBaseUrl?.trim()
		|| context.deployConfig.hosting?.marketBaseUrl?.trim()
		|| DEFAULT_MARKET_BASE_URL;
}

export function resolveCentralMarketBaseUrl(
	context: EnvironmentContext,
	scope: EnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_CENTRAL_MARKET_API_BASE_URL?.trim()
		|| process.env.TREESEED_CENTRAL_MARKET_API_BASE_URL?.trim()
		|| resolveMarketBaseUrl(context, scope, values)
		|| DEFAULT_MARKET_BASE_URL;
}

export function resolveCatalogMarketBaseUrls(
	context: EnvironmentContext,
	scope: EnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_CATALOG_MARKET_API_BASE_URLS?.trim()
		|| values.TREESEED_API_BASE_URL?.trim()
		|| values.TREESEED_CENTRAL_MARKET_API_BASE_URL?.trim()
		|| process.env.TREESEED_CATALOG_MARKET_API_BASE_URLS?.trim()
		|| resolveCentralMarketBaseUrl(context, scope, values);
}

export function resolveHostedTeamId(context: EnvironmentContext) {
	return context.deployConfig.slug;
}

export function resolveHostedProjectId(context: EnvironmentContext) {
	return context.deployConfig.slug;
}

export function resolveRailwayWorkspaceDefault() {
	return 'knowledge-coop';
}

export function resolvePlatformRunnerIdDefault(_context: EnvironmentContext, scope: EnvironmentScope) {
	return scope === 'prod' ? 'treeseed-ops-prod-1' : scope === 'staging' ? 'treeseed-ops-staging-1' : 'treeseed-ops-local-1';
}

export function resolvePlatformRunnerEnvironmentDefault(_context: EnvironmentContext, scope: EnvironmentScope) {
	return scope === 'prod' ? 'production' : scope;
}

export function parseGitHubRepositorySlugFromRemote(remoteUrl: string | undefined) {
	const normalized = String(remoteUrl ?? '').trim();
	const sshMatch = normalized.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/u);
	if (sshMatch) {
		return { owner: sshMatch[1], name: sshMatch[2] };
	}

	const httpsMatch = normalized.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/u);
	if (httpsMatch) {
		return { owner: httpsMatch[1], name: httpsMatch[2] };
	}

	return null;
}

export function resolveGitHubOriginRepository(context: EnvironmentContext) {
	const rootResult = runRepositoryGit(['rev-parse', '--show-toplevel'], {
		cwd: context.tenantRoot,
		mode: 'read',
		allowFailure: true,
	});
	if (rootResult.status !== 0 || resolve(rootResult.stdout.trim()) !== resolve(context.tenantRoot)) {
		return null;
	}
	const result = runRepositoryGit(['remote', 'get-url', 'origin'], {
		cwd: context.tenantRoot,
		mode: 'read',
		allowFailure: true,
	});
	if (result.status !== 0) {
		return null;
	}
	return parseGitHubRepositorySlugFromRemote(result.stdout);
}

export function resolveGitHubOwnerDefault(context: EnvironmentContext) {
	return resolveGitHubOriginRepository(context)?.owner;
}

export function resolveGitHubRepositoryNameDefault(context: EnvironmentContext) {
	return resolveGitHubOriginRepository(context)?.name || context.deployConfig.slug;
}

export const VALUE_RESOLVERS: NamedResolverMap = {
	generatedSecret: () => generatedSecret(),
	localFormsBypassDefault: () => 'true',
	localSmtpHostDefault: () => localSmtpHostDefault(),
	localSmtpPortDefault: () => localSmtpPortDefault(),
	localApiDatabaseUrlDefault: (context, scope, values) => localApiDatabaseUrlDefault(context, scope, values),
	contactEmailDefault: (context) => contactEmailDefault(context),
	projectDomainsDefault: (context, scope) => projectDomainsDefault(context, scope),
	apiBaseUrlDefault: (context, scope, values) => resolveConfiguredApiBaseUrl(context, scope, values),
	webServiceIdDefault: (_context, _scope, values) => resolveWebServiceId(values),
	apiWebServiceIdDefault: (_context, _scope, values) => resolveApiWebServiceId(values),
	pagesProjectNameDefault: (context) => resolvePagesProjectName(context),
	pagesPreviewProjectNameDefault: (context) => resolvePagesPreviewProjectName(context),
	contentBucketNameDefault: (context) => resolveContentBucketName(context),
	contentBucketBindingDefault: (context) => resolveContentBucketBinding(context),
	hostingKindDefault: (context) => resolveHostingKind(context),
	hostingRegistrationDefault: (context) => resolveHostingRegistration(context),
	hubModeDefault: (context) => resolveHubMode(context),
	runtimeModeDefault: (context) => resolveRuntimeMode(context),
	runtimeRegistrationDefault: (context) => resolveRuntimeRegistration(context),
	marketBaseUrlDefault: (context, scope, values) => resolveMarketBaseUrl(context, scope, values),
	centralMarketBaseUrlDefault: (context, scope, values) => resolveCentralMarketBaseUrl(context, scope, values),
	catalogMarketBaseUrlsDefault: (context, scope, values) => resolveCatalogMarketBaseUrls(context, scope, values),
	hostingTeamIdDefault: (context) => resolveHostedTeamId(context),
	hostingProjectIdDefault: (context) => resolveHostedProjectId(context),
	railwayWorkspaceDefault: () => resolveRailwayWorkspaceDefault(),
	platformRunnerIdDefault: (context, scope) => resolvePlatformRunnerIdDefault(context, scope),
	platformRunnerEnvironmentDefault: (context, scope) => resolvePlatformRunnerEnvironmentDefault(context, scope),
	platformRunnerDataDirDefault: () => '/data',
	treedxDockerImageDefault: () => 'treeseed/treedx:latest',
	githubOwnerDefault: (context) => resolveGitHubOwnerDefault(context),
	githubRepositoryNameDefault: (context) => resolveGitHubRepositoryNameDefault(context),
	githubRepositoryVisibilityDefault: () => 'private',
};

export const PREDICATES: NamedPredicateMap = {
	turnstileEnabled: (context) => turnstileEnabled(context),
	turnstileNonLocal: (context, scope) => turnstileEnabled(context) && scope !== 'local',
	smtpEnabled: (context) => smtpEnabled(context),
	smtpNonLocal: (context, scope) => smtpEnabled(context) && scope !== 'local',
	webSurfaceEnabled: (context) => webSurfaceEnabled(context),
	apiSurfaceEnabled: (context) => apiSurfaceEnabled(context),
	processingPlaneEnabled: (context) => processingPlaneEnabled(context),
	formsEnabled: (context) => formsEnabled(context),
	codexExecutionSelected: (context) => codexExecutionSelected(context),
	copilotExecutionSelected: (context) => copilotExecutionSelected(context),
	railwayManagedEnabled: (context) => railwayManagedEnabled(context),
	hubHosted: (context) => resolveHubMode(context) === 'treeseed_hosted',
	hubCustomerHosted: (context) => resolveHubMode(context) === 'customer_hosted',
	runtimeNone: (context) => resolveRuntimeMode(context) === 'none',
	runtimeByoAttached: (context) => resolveRuntimeMode(context) === 'byo_attached',
	runtimeManaged: (context) => resolveRuntimeMode(context) === 'treeseed_managed',
	marketControlPlaneEnabled: (context) => marketControlPlaneEnabled(context),
	hostedProjectEnabled: (context) => hostedProjectEnabled(context),
	selfHostedProjectEnabled: (context) => selfHostedProjectEnabled(context),
	projectRegistrationEnabled: (context) => projectRegistrationEnabled(context),
};

export function deepMerge(left: unknown, right: unknown): unknown {
	if (Array.isArray(left) && Array.isArray(right)) {
		return [...right];
	}
	if (
		left
		&& typeof left === 'object'
		&& !Array.isArray(left)
		&& right
		&& typeof right === 'object'
		&& !Array.isArray(right)
	) {
		const result = { ...(left as Record<string, unknown>) };
		for (const [key, value] of Object.entries(right as Record<string, unknown>)) {
			result[key] = key in result ? deepMerge(result[key], value) : value;
		}
		return result;
	}
	return right;
}

export function normalizeOverlay(raw: unknown, label: string): EnvironmentRegistryOverlay {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error(`Invalid Treeseed environment registry overlay from ${label}.`);
	}

	const overlay = raw as EnvironmentRegistryOverlay;
	if (overlay.entries === undefined) {
		return { entries: {} };
	}
	if (!overlay.entries || typeof overlay.entries !== 'object' || Array.isArray(overlay.entries)) {
		throw new Error(`Invalid Treeseed environment registry overlay entries in ${label}.`);
	}

	return overlay;
}

export function readYamlOverlayIfPresent(filePath: string) {
	if (!existsSync(filePath)) {
		return null;
	}
	return normalizeOverlay(parseYaml(readFileSync(filePath, 'utf8')), filePath);
}

export function pluginEnvironmentCandidates(baseDir: string) {
	const dir = resolve(baseDir);
	return [
		resolve(dir, 'env.yaml'),
		resolve(dir, 'src/env.yaml'),
		resolve(dir, '../env.yaml'),
		resolve(dir, '../src/env.yaml'),
		resolve(dir, '../../env.yaml'),
		resolve(dir, '../../src/env.yaml'),
	];
}

export function readPluginEnvironmentOverlay(baseDir: string) {
	for (const candidate of pluginEnvironmentCandidates(baseDir)) {
		const overlay = readYamlOverlayIfPresent(candidate);
		if (overlay) {
			return { path: candidate, overlay };
		}
	}
	return null;
}
