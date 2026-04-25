import type { TreeseedTenantConfig } from '../contracts.ts';
import { parseSiteConfig } from '../utils/site-config-schema.js';

declare const __TREESEED_TENANT_CONFIG__: TreeseedTenantConfig | undefined;
declare const __TREESEED_PROJECT_ROOT__: string | undefined;
declare const __TREESEED_SITE_CONFIG__: ReturnType<typeof parseSiteConfig> | undefined;

const injectedTenantConfig =
	typeof __TREESEED_TENANT_CONFIG__ !== 'undefined' ? __TREESEED_TENANT_CONFIG__ : null;
const injectedProjectRoot =
	typeof __TREESEED_PROJECT_ROOT__ !== 'undefined' ? __TREESEED_PROJECT_ROOT__ : null;
const injectedSiteConfig =
	typeof __TREESEED_SITE_CONFIG__ !== 'undefined' ? __TREESEED_SITE_CONFIG__ : null;

function getNodeBuiltin<T>(name: string): T | null {
	const getBuiltinModule = (globalThis as { process?: { getBuiltinModule?: (name: string) => T } }).process
		?.getBuiltinModule;

	return getBuiltinModule?.(name) ?? null;
}

function getCwd() {
	const cwd = (globalThis as { process?: { cwd?: () => string } }).process?.cwd;

	return cwd?.() ?? '.';
}

function resolveRuntimePath(projectRoot: string, path: string) {
	const pathModule = getNodeBuiltin<{ resolve: (...paths: string[]) => string }>('path');

	return pathModule?.resolve(projectRoot, path) ?? `${projectRoot.replace(/\/$/, '')}/${path}`;
}

function fallbackTenantConfig(projectRoot: string): TreeseedTenantConfig {
	return {
		id: 'treeseed-runtime',
		siteConfigPath: resolveRuntimePath(projectRoot, 'treeseed.site.yaml'),
		content: {
			pages: resolveRuntimePath(projectRoot, 'src/content/pages'),
			notes: resolveRuntimePath(projectRoot, 'src/content/notes'),
			questions: resolveRuntimePath(projectRoot, 'src/content/questions'),
			objectives: resolveRuntimePath(projectRoot, 'src/content/objectives'),
			proposals: resolveRuntimePath(projectRoot, 'src/content/proposals'),
			decisions: resolveRuntimePath(projectRoot, 'src/content/decisions'),
			people: resolveRuntimePath(projectRoot, 'src/content/people'),
			agents: resolveRuntimePath(projectRoot, 'src/content/agents'),
			books: resolveRuntimePath(projectRoot, 'src/content/books'),
			docs: resolveRuntimePath(projectRoot, 'src/content/knowledge'),
			templates: resolveRuntimePath(projectRoot, 'src/content/templates'),
			knowledge_packs: resolveRuntimePath(projectRoot, 'src/content/knowledge-packs'),
			workdays: resolveRuntimePath(projectRoot, 'src/content/workdays'),
		},
		features: {
			docs: true,
			books: true,
			notes: true,
			questions: true,
			objectives: true,
			proposals: true,
			decisions: true,
		},
	};
}

export const RUNTIME_PROJECT_ROOT = injectedProjectRoot ?? getCwd();
export const RUNTIME_TENANT = (() => {
	if (injectedTenantConfig) {
		return injectedTenantConfig;
	}

	return fallbackTenantConfig(RUNTIME_PROJECT_ROOT);
})();
export const RUNTIME_SITE_CONFIG =
	injectedSiteConfig
	?? (() => {
		const fs = getNodeBuiltin<{ readFileSync: (path: string, encoding: 'utf8') => string }>('fs');
		if (!fs) {
			return null;
		}

		try {
			return parseSiteConfig(fs.readFileSync(RUNTIME_TENANT.siteConfigPath, 'utf8'));
		} catch {
			return null;
		}
	})();
