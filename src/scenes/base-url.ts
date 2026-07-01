import { readTreeseedDevInstance } from '../local-dev/managed-dev.ts';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadTreeseedDeployConfigFromPath } from '../platform/deploy-config.ts';
import { sceneErrorDiagnostic } from './diagnostics.ts';
import type { TreeseedSceneBaseUrlResolution, TreeseedSceneEnvironment, TreeseedSceneEnvironmentPrepareReport, TreeseedSceneManifest } from './types.ts';

export function resolveTreeseedSceneBaseUrl(input: {
	projectRoot: string;
	scene: TreeseedSceneManifest;
	environment: TreeseedSceneEnvironment;
	environmentReport?: TreeseedSceneEnvironmentPrepareReport | null;
}): TreeseedSceneBaseUrlResolution {
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
	const instance = readTreeseedDevInstance({ cwd: input.projectRoot, surface: 'web' });
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

function configuredHostedBaseUrl(projectRoot: string, environment: Exclude<TreeseedSceneEnvironment, 'local'>) {
	const candidates = [
		resolve(projectRoot, 'treeseed.site.yaml'),
		resolve(projectRoot, '..', '..', 'treeseed.site.yaml'),
	];
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		try {
			const config = loadTreeseedDeployConfigFromPath(candidate);
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
