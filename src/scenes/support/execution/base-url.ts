import { readDevInstance } from '../../../local-dev/managed-dev.ts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadDeployConfigFromPath } from '../../../platform/hosting/deploy-config.ts';
import { sceneErrorDiagnostic } from '../reporting/diagnostics.ts';
import type { SceneBaseUrlResolution, SceneEnvironment, SceneEnvironmentPrepareReport, SceneManifest } from '../../types.ts';

export function resolveSceneBaseUrl(input: {
	projectRoot: string;
	scene: SceneManifest;
	environment: SceneEnvironment;
	environmentReport?: SceneEnvironmentPrepareReport | null;
}): SceneBaseUrlResolution {
	if (input.scene.target.baseUrl !== 'auto') {
		return { ok: true, baseUrl: input.scene.target.baseUrl, diagnostics: [] };
	}
	if (input.environment !== 'local') {
		const configured = configuredHostedBaseUrl(input.projectRoot, input.environment);
		if (configured) return { ok: true, baseUrl: configured, diagnostics: [] };
		return {
			ok: false,
			baseUrl: null,
			diagnostics: [
				sceneErrorDiagnostic(
					'scene.base_url_unresolved',
					'Automatic staging/prod base URL resolution requires a configured Treeseed deploy base URL.',
					'target.baseUrl',
				),
			],
		};
	}
	if (input.environmentReport?.dev.baseUrl) {
		return { ok: true, baseUrl: input.environmentReport.dev.baseUrl, diagnostics: [] };
	}
	const instance = readDevInstance({ cwd: input.projectRoot, surface: 'web' });
	const healthUrl = instance?.health?.find((entry) => entry.kind === 'http')?.url ?? null;
	if (!instance?.running || !healthUrl) {
		return {
			ok: false,
			baseUrl: null,
			diagnostics: [
				sceneErrorDiagnostic(
					'scene.local_dev_not_running',
					'Start local dev with trsd dev start --web-runtime local --json or set target.baseUrl explicitly.',
					'target.baseUrl',
				),
			],
		};
	}
	return { ok: true, baseUrl: healthUrl, diagnostics: [] };
}

function configuredHostedBaseUrl(projectRoot: string, environment: Exclude<SceneEnvironment, 'local'>) {
	const candidates = [
		resolve(projectRoot, 'treeseed.site.yaml'),
		resolve(projectRoot, '..', '..', 'treeseed.site.yaml'),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const config = loadDeployConfigFromPath(candidate);
			const serviceUrl = hostedWebUrl(config.services?.web?.environments?.[environment])
				?? hostedWebUrl(config.surfaces?.web?.environments?.[environment])
				?? (environment === 'prod' ? config.surfaces?.web?.publicBaseUrl : undefined);
			if (typeof serviceUrl === 'string' && serviceUrl.trim()) return serviceUrl.trim();
		} catch {
			// Ignore malformed manifests here; readiness reports own detailed config diagnostics.
		}
	}
	if (environment === 'prod') return 'https://treeseed.dev';
	if (environment === 'staging') return 'https://preview.treeseed.dev';
	return null;
}

function hostedWebUrl(environmentConfig: unknown) {
	if (!environmentConfig || typeof environmentConfig !== 'object') return null;
	const record = environmentConfig as { baseUrl?: unknown; domain?: unknown };
	const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
	if (baseUrl) return baseUrl;
	const domain = typeof record.domain === 'string' ? record.domain.trim() : '';
	if (!domain) return null;
	return /^https?:\/\//u.test(domain) ? domain : `https://${domain}`;
}

export function resolveSceneApiBaseUrl(input: {
	projectRoot: string;
	environment: SceneEnvironment | string;
	webBaseUrl: string;
}) {
	if (input.environment === 'local') {
		const instance = readDevInstance({ cwd: input.projectRoot, surface: 'api' });
		const managedApi = httpHealthBaseUrl(instance);
		if (managedApi) return managedApi;
		const envApi = process.env.TREESEED_API_BASE_URL?.trim() || process.env.TREESEED_MARKET_API_BASE_URL?.trim();
		if (envApi) return envApi.replace(/\/+$/u, '');
		return input.webBaseUrl;
	}
	const environment = input.environment === 'prod' ? 'prod' : input.environment === 'staging' ? 'staging' : null;
	if (!environment) return input.webBaseUrl;
	const configured = configuredHostedApiBaseUrl(input.projectRoot, environment);
	return configured ?? input.webBaseUrl;
}

function configuredHostedApiBaseUrl(projectRoot: string, environment: Exclude<SceneEnvironment, 'local'>) {
	const candidates = [
		resolve(projectRoot, 'treeseed.site.yaml'),
		resolve(projectRoot, 'packages', 'api', 'treeseed.site.yaml'),
		resolve(projectRoot, '..', '..', 'treeseed.site.yaml'),
		resolve(projectRoot, '..', '..', 'packages', 'api', 'treeseed.site.yaml'),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const config = loadDeployConfigFromPath(candidate);
			const serviceUrl = hostedApiUrl(config.connections?.api?.environments?.[environment])
				?? hostedApiUrl(config.services?.api?.environments?.[environment])
				?? hostedApiUrl(config.surfaces?.api?.environments?.[environment])
				?? (environment === 'prod' ? config.surfaces?.api?.publicBaseUrl : undefined);
			if (typeof serviceUrl === 'string' && serviceUrl.trim()) return serviceUrl.trim();
		} catch {
			// Ignore malformed manifests here; readiness reports own detailed config diagnostics.
		}
	}
	if (environment === 'prod') return 'https://api.treeseed.dev';
	if (environment === 'staging') return 'https://api.preview.treeseed.dev';
	return null;
}

function hostedApiUrl(environmentConfig: unknown) {
	return hostedWebUrl(environmentConfig);
}

function httpHealthBaseUrl(instance: unknown) {
	const healthUrl = (instance as { health?: Array<{ kind?: string; url?: string }> } | null)?.health
		?.find((entry) => entry.kind === 'http' && typeof entry.url === 'string')
		?.url;
	if (!healthUrl) return null;
	try {
		const url = new URL(healthUrl);
		if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
		return url.origin;
	} catch {
		return healthUrl.replace(/\/healthz?$/u, '').replace(/\/+$/u, '');
	}
}
