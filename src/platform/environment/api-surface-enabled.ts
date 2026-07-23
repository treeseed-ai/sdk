import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { runTreeseedGit } from '../../operations/services/git-runner.ts';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { discoverTreeseedApplications } from '../../hosting/apps.ts';
import { githubRepositoryCredentialEnvName } from '../../operations/services/github-credentials.ts';
import { discoverTreeseedPackageAdapters } from '../../operations/services/package-adapters.ts';
import type { TreeseedDeployConfig, TreeseedTenantConfig } from '../contracts.ts';
import { loadTreeseedDeployConfig } from '../deploy-config.ts';
import { loadTreeseedPlugins, type LoadedTreeseedPluginEntry } from '../plugins.ts';
import { loadTreeseedManifest } from '../tenant-config.ts';
import { TreeseedEnvironmentContext, TreeseedEnvironmentScope, managedServiceEnabled, webSurfaceEnabled, workflowPlaneAllows } from './treeseed-environment-scopes.ts';

export function apiSurfaceEnabled(context: TreeseedEnvironmentContext) {
	if (!workflowPlaneAllows('processing')) {
		return false;
	}
	const apiSurfaceExplicitlyEnabled = context.deployConfig.surfaces?.api?.enabled === true;
	const apiServiceConfigured = context.deployConfig.services?.api != null && managedServiceEnabled(context, 'api');
	return (apiSurfaceExplicitlyEnabled || apiServiceConfigured) && managedServiceEnabled(context, 'api');
}

export function processingPlaneEnabled(context: TreeseedEnvironmentContext) {
	if (!workflowPlaneAllows('processing')) {
		return false;
	}
	const mode = context.deployConfig.processing?.mode ?? 'market-assigned';
	if (mode === 'team-owned' || mode === 'project-owned' || mode === 'local') {
		return true;
	}
	return Object.entries(context.deployConfig.services ?? {}).some(([service, config]) =>
		['api', 'manager', 'worker', 'workerRunner', 'workdayStart', 'workdayReport'].includes(service)
		&& config
		&& config.enabled !== false
	);
}

export function formsEnabled(context: TreeseedEnvironmentContext) {
	return webSurfaceEnabled(context) && (context.deployConfig.providers?.forms ?? 'store_only') !== 'none';
}

export function codexExecutionSelected(context: TreeseedEnvironmentContext) {
	const execution = context.deployConfig.providers?.agents?.execution ?? 'codex';
	return execution === 'codex';
}

export function copilotExecutionSelected(context: TreeseedEnvironmentContext) {
	return context.deployConfig.providers?.agents?.execution === 'github_copilot';
}

export function railwayManagedEnabled(context: TreeseedEnvironmentContext) {
	if (!workflowPlaneAllows('processing')) {
		return false;
	}
	if (!processingPlaneEnabled(context)) {
		return false;
	}
	if (context.deployConfig.runtime?.mode === 'treeseed_managed') {
		return true;
	}
	if (context.deployConfig.runtime?.mode && context.deployConfig.runtime.mode !== 'treeseed_managed') {
		return false;
	}
	return Object.values(context.deployConfig.services ?? {}).some((service) =>
		service && service.enabled !== false && (service.provider ?? 'railway') === 'railway',
	);
}

export function resolveHubMode(context: TreeseedEnvironmentContext) {
	return context.deployConfig.hub?.mode ?? 'treeseed_hosted';
}

export function resolveRuntimeMode(context: TreeseedEnvironmentContext) {
	return context.deployConfig.runtime?.mode ?? 'none';
}

export function resolveRuntimeRegistration(context: TreeseedEnvironmentContext) {
	return context.deployConfig.runtime?.registration ?? 'none';
}

export function resolveHostingKind(context: TreeseedEnvironmentContext) {
	return context.deployConfig.hosting?.kind ?? 'self_hosted_project';
}

export function resolveHostingRegistration(context: TreeseedEnvironmentContext) {
	return context.deployConfig.hosting?.registration ?? 'none';
}

export function marketControlPlaneEnabled(context: TreeseedEnvironmentContext) {
	return resolveHostingKind(context) === 'treeseed_control_plane';
}

export function hostedProjectEnabled(context: TreeseedEnvironmentContext) {
	return resolveHostingKind(context) === 'hosted_project';
}

export function selfHostedProjectEnabled(context: TreeseedEnvironmentContext) {
	return resolveHostingKind(context) === 'self_hosted_project';
}

export function projectRegistrationEnabled(context: TreeseedEnvironmentContext) {
	return resolveRuntimeRegistration(context) === 'optional' || resolveRuntimeRegistration(context) === 'required';
}

export function generatedSecret(bytes = 24) {
	return randomBytes(bytes).toString('hex');
}

export function localSmtpHostDefault() {
	return '127.0.0.1';
}

export function localSmtpPortDefault() {
	return '1025';
}

export function contactEmailDefault(context: TreeseedEnvironmentContext) {
	return context.deployConfig.contactEmail?.trim() || 'contact@example.com';
}

export function localApiDatabaseUrlDefault(
	_context: TreeseedEnvironmentContext,
	_scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	const port = values.TREESEED_MARKET_LOCAL_POSTGRES_PORT?.trim()
		|| values.TREESEED_API_LOCAL_POSTGRES_PORT?.trim()
		|| process.env.TREESEED_MARKET_LOCAL_POSTGRES_PORT?.trim()
		|| '54329';
	const database = values.TREESEED_MARKET_LOCAL_POSTGRES_DATABASE?.trim()
		|| values.TREESEED_API_LOCAL_POSTGRES_DATABASE?.trim()
		|| 'treeseed_api';
	const user = values.TREESEED_MARKET_LOCAL_POSTGRES_USER?.trim()
		|| values.TREESEED_API_LOCAL_POSTGRES_USER?.trim()
		|| 'treeseed';
	const password = values.TREESEED_MARKET_LOCAL_POSTGRES_PASSWORD?.trim()
		|| values.TREESEED_API_LOCAL_POSTGRES_PASSWORD?.trim()
		|| 'treeseed-local-dev';
	return `postgres://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:${port}/${encodeURIComponent(database)}`;
}

export function normalizeUrl(value: string) {
	return value.trim().replace(/\/$/u, '');
}

export function primaryHostFromUrl(value: string | undefined) {
	if (!value || value.trim().length === 0) {
		return undefined;
	}

	try {
		return new URL(value).host;
	} catch {
		return undefined;
	}
}

export function parseDomainList(value: string | undefined) {
	return String(value ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function deriveApiDomainFromProjectDomain(domain: string | undefined) {
	if (!domain) {
		return undefined;
	}
	if (domain.startsWith('api.')) {
		return domain;
	}

	const segments = domain.split('.').filter(Boolean);
	if (segments.length <= 2) {
		return `api.${domain}`;
	}
	return `api.${segments.slice(1).join('.')}`;
}

export function projectDomainsDefault(context: TreeseedEnvironmentContext, scope: TreeseedEnvironmentScope) {
	if (scope === 'staging') {
		return context.deployConfig.surfaces?.web?.environments?.staging?.domain
			?? primaryHostFromUrl(context.deployConfig.surfaces?.web?.environments?.staging?.baseUrl)
			?? primaryHostFromUrl(context.deployConfig.siteUrl);
	}
	if (scope === 'prod') {
		return context.deployConfig.surfaces?.web?.environments?.prod?.domain
			?? primaryHostFromUrl(context.deployConfig.surfaces?.web?.environments?.prod?.baseUrl)
			?? primaryHostFromUrl(context.deployConfig.surfaces?.web?.publicBaseUrl)
			?? primaryHostFromUrl(context.deployConfig.siteUrl);
	}
	return primaryHostFromUrl(context.deployConfig.siteUrl);
}

export function resolveConfiguredApiBaseUrl(
	context: TreeseedEnvironmentContext,
	scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	const localBaseUrl = context.deployConfig.services?.api?.environments?.local?.baseUrl
		?? context.deployConfig.surfaces?.api?.localBaseUrl
		?? 'http://127.0.0.1:3000';
	if (scope === 'local') {
		return normalizeUrl(localBaseUrl);
	}

	const scopedBaseUrl = context.deployConfig.services?.api?.environments?.[scope]?.baseUrl
		?? context.deployConfig.services?.api?.publicBaseUrl
		?? context.deployConfig.surfaces?.api?.publicBaseUrl;
	if (scopedBaseUrl) {
		return normalizeUrl(scopedBaseUrl);
	}

	const projectDomains = [
		...parseDomainList(values.TREESEED_PROJECT_DOMAINS),
		primaryHostFromUrl(context.deployConfig.siteUrl),
	].filter(Boolean) as string[];

	for (const domain of projectDomains) {
		const apiDomain = deriveApiDomainFromProjectDomain(domain);
		if (apiDomain) {
			return `https://${apiDomain}`;
		}
	}

	return undefined;
}

export function resolveWebServiceId(
	_values: Record<string, string | undefined> = {},
) {
	return 'web';
}

export function resolveApiWebServiceId(
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_WEB_SERVICE_ID?.trim() || 'web';
}

export function resolvePagesProjectName(context: TreeseedEnvironmentContext) {
	return context.deployConfig.slug;
}

export function resolvePagesPreviewProjectName(
	context: TreeseedEnvironmentContext,
	_scope: TreeseedEnvironmentScope,
	values: Record<string, string | undefined> = {},
) {
	return values.TREESEED_CLOUDFLARE_PAGES_PROJECT_NAME?.trim()
		|| context.deployConfig.cloudflare.pages?.projectName?.trim()
		|| context.deployConfig.slug;
}

export function resolveContentBucketName(context: TreeseedEnvironmentContext) {
	return `${context.deployConfig.slug}-content`;
}
