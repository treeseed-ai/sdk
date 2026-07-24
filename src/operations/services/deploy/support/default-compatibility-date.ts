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
import { safeUrl } from '../projects/projects-core/ensure-pages-project-compatibility.ts';
import { scopeFromTarget } from '../hosting/configured-surface-hosts.ts';

export const DEFAULT_COMPATIBILITY_DATE = '2026-04-05';

export const DEFAULT_COMPATIBILITY_FLAGS = ['nodejs_compat'];

export const DEFAULT_MARKET_BASE_URL = 'https://api.treeseed.dev';

export const GENERATED_ROOT = '.treeseed/generated';

export const STATE_ROOT = '.treeseed/state';

export const WORKTREE_METADATA_RELATIVE_PATH = '.treeseed/worktree.json';

export const PERSISTENT_SCOPES = new Set(['local', 'staging', 'prod']);

export const MANAGED_SERVICE_KEYS = ['api'];

export const TRESEED_ENVELOPE_SCHEMA_GENERATION = 'runtime-envelopes-v1';

export const TRESEED_MIGRATION_WAVE_ID = '0005_runtime_envelopes';

export const TRESEED_SUPPORTED_PAYLOAD_RANGE = { min: 1, max: 1 };

export function sleepSync(milliseconds) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function ensureParent(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

export function stableHash(value) {
	return createHash('sha256').update(value).digest('hex');
}

export function compactDeploymentKey(input) {
	const rawKey = sanitizeResourceKey(input.rawKey ?? '');
	if (rawKey && rawKey.length <= 40) return rawKey;
	const base = sanitizeSegment(input.slug ?? input.projectSegment ?? 'project').slice(0, 27) || 'project';
	const hash = stableHash(`${input.teamId ?? ''}:${input.projectId ?? ''}:${input.slug ?? ''}`).slice(0, 8);
	return `${base}-${hash}`;
}

export function readJson(filePath, fallback) {
	if (!existsSync(filePath)) {
		return fallback;
	}

	try {
		return JSON.parse(readFileSync(filePath, 'utf8'));
	} catch {
		return fallback;
	}
}

export function writeJson(filePath, value) {
	ensureParent(filePath);
	writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function renderTomlString(value) {
	return JSON.stringify(String(value));
}

export function envOrNull(key) {
	const value = process.env[key];
	return typeof value === 'string' && value.length ? value : null;
}

export function loadTenantDeployConfig(tenantRoot) {
	return loadCliDeployConfig(tenantRoot);
}

export function sanitizeSegment(value) {
	return String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
		.slice(0, 36) || 'default';
}

export function sanitizeResourceKey(value) {
	return String(value)
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '');
}

export function requireConfiguredIdentityValue(value, label) {
	const normalized = typeof value === 'string' && value.trim() ? value.trim() : '';
	if (!normalized) {
		throw new Error(`Configure ${label} before reconciling multi-tenant resources.`);
	}
	return normalized;
}

export function resolveResourceIdentity(deployConfig, target) {
	const teamId = requireConfiguredIdentityValue(
		envOrNull('TREESEED_HOSTING_TEAM_ID')
			?? deployConfig.runtime?.teamId
			?? deployConfig.hosting?.teamId,
		'hosting.teamId or runtime.teamId in treeseed.site.yaml',
	);
	const projectId = requireConfiguredIdentityValue(
		envOrNull('TREESEED_PROJECT_ID')
			?? deployConfig.runtime?.projectId
			?? deployConfig.hosting?.projectId,
		'hosting.projectId or runtime.projectId in treeseed.site.yaml',
	);
	const teamSegment = sanitizeSegment(teamId);
	const projectSegment = sanitizeSegment(projectId);
	const deploymentKey = compactDeploymentKey({
		rawKey: `${teamSegment}-${projectSegment}`,
		teamId,
		projectId,
		projectSegment,
		slug: deployConfig.slug,
	});
	const environment = target.kind === 'persistent' ? target.scope : target.branchName;
	const environmentSegment = target.kind === 'persistent' ? target.scope : sanitizeSegment(target.branchName);
	return {
		teamId,
		projectId,
		slug: deployConfig.slug,
		environment,
		deploymentKey,
		environmentKey: `${deploymentKey}-${environmentSegment}`,
	};
}

export function primaryHost(value) {
	return safeUrl(value)?.hostname ?? null;
}

export function domainZoneFromConfiguredWebDomain(domain) {
	if (typeof domain !== 'string' || !domain.trim()) {
		return null;
	}
	return domain.trim().replace(/^api\./u, '');
}

export function resolveSurfaceDomainZone(deployConfig) {
	return domainZoneFromConfiguredWebDomain(
		deployConfig.surfaces?.web?.environments?.prod?.domain
		?? primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl),
	);
}

export function deriveStagingDomainHash(identity, surface) {
	return stableHash(`${identity.teamId}:${identity.projectId}:${identity.slug}:${surface}:staging`).slice(0, 8);
}

export function deriveStagingSurfaceDomain(deployConfig, identity, surface) {
	const zone = resolveSurfaceDomainZone(deployConfig);
	if (!zone) {
		return null;
	}
	const hash = deriveStagingDomainHash(identity, surface);
	return surface === 'web'
		? `${identity.deploymentKey}-staging-${hash}.${zone}`
		: `api-${identity.deploymentKey}-staging-${hash}.${zone}`;
}

export function deriveApiDomainFromWebDomain(domain) {
	if (!domain) {
		return null;
	}
	return domain.startsWith('api.') ? domain : `api.${domain}`;
}

export function configuredApiConnectionDomain(deployConfig, scope) {
	const apiConnection = deployConfig.connections?.api?.environments?.[scope];
	const domain = apiConnection?.domain?.trim();
	if (domain) {
		return domain;
	}
	const connectionBaseUrl = primaryHost(apiConnection?.baseUrl);
	if (connectionBaseUrl) {
		return connectionBaseUrl;
	}
	const serviceDomain = deployConfig.services?.api?.environments?.[scope]?.domain?.trim();
	if (serviceDomain) {
		return serviceDomain;
	}
	return primaryHost(
		deployConfig.services?.api?.environments?.[scope]?.baseUrl
		?? deployConfig.services?.api?.publicBaseUrl,
	);
}

export function resolveConfiguredSurfaceDomain(deployConfig, target, surface) {
	if (target.kind !== 'persistent') {
		return null;
	}
	const scope = target.scope;
	const configured = deployConfig.surfaces?.[surface]?.environments?.[scope]?.domain?.trim();
	if (configured) {
		return configured;
	}
	if (surface === 'api') {
		const apiConnectionDomain = configuredApiConnectionDomain(deployConfig, scope);
		if (apiConnectionDomain) {
			return apiConnectionDomain;
		}
	}
	if (scope === 'staging') {
		return deriveStagingSurfaceDomain(
			deployConfig,
			resolveResourceIdentity(deployConfig, target),
			surface,
		);
	}
	if (scope !== 'prod') {
		return null;
	}
	if (surface === 'web') {
		return primaryHost(deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl);
	}
	return deriveApiDomainFromWebDomain(resolveConfiguredSurfaceDomain(deployConfig, target, 'web'));
}

export function resolveConfiguredSurfaceBaseUrl(deployConfig, target, surface) {
	if (surface === 'api') {
		const scope = scopeFromTarget(target);
		const apiConnection = deployConfig.connections?.api?.environments?.[scope];
		const connectionBaseUrl = apiConnection?.baseUrl
			?? (apiConnection?.domain ? `https://${apiConnection.domain}` : null);
		if (connectionBaseUrl) {
			return connectionBaseUrl;
		}
	}
	const configuredDomain = resolveConfiguredSurfaceDomain(deployConfig, target, surface);
	if (configuredDomain) {
		return `https://${configuredDomain}`;
	}
	if (surface === 'web') {
		return deployConfig.surfaces?.web?.publicBaseUrl ?? deployConfig.siteUrl ?? null;
	}
	if (surface === 'api') {
		const scope = scopeFromTarget(target);
		return deployConfig.services?.api?.environments?.[scope]?.baseUrl
			?? deployConfig.services?.api?.publicBaseUrl
			?? null;
	}
	return null;
}
