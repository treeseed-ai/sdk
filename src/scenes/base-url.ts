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
			const connectionUrl = config.connections?.api?.environments?.[environment]?.baseUrl;
			const serviceUrl = config.services?.web?.environments?.[environment]?.baseUrl
				?? config.surfaces?.web?.environments?.[environment]?.baseUrl;
			const baseUrl = serviceUrl ?? connectionUrl;
			if (typeof baseUrl === 'string' && baseUrl.trim()) return baseUrl.trim();
		} catch {
			// Ignore malformed manifests here; readiness reports own detailed config diagnostics.
		}
	}
	if (environment === 'prod') return 'https://treeseed.ai';
	if (environment === 'staging') return 'https://staging.treeseed.ai';
	return null;
}
