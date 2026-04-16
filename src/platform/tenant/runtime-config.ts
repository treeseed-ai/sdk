import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TreeseedTenantConfig } from '../contracts.ts';
import { loadTreeseedManifest } from '../tenant-config.ts';
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

function fallbackTenantConfig(projectRoot: string): TreeseedTenantConfig {
	return {
		id: 'treeseed-runtime',
		siteConfigPath: resolve(projectRoot, 'treeseed.site.yaml'),
		content: {
			pages: resolve(projectRoot, 'src/content/pages'),
			notes: resolve(projectRoot, 'src/content/notes'),
			questions: resolve(projectRoot, 'src/content/questions'),
			objectives: resolve(projectRoot, 'src/content/objectives'),
				people: resolve(projectRoot, 'src/content/people'),
				agents: resolve(projectRoot, 'src/content/agents'),
				books: resolve(projectRoot, 'src/content/books'),
				docs: resolve(projectRoot, 'src/content/knowledge'),
				templates: resolve(projectRoot, 'src/content/templates'),
				knowledge_packs: resolve(projectRoot, 'src/content/knowledge-packs'),
				workdays: resolve(projectRoot, 'src/content/workdays'),
			},
		features: {
			docs: true,
			books: true,
		},
	};
}

export const RUNTIME_PROJECT_ROOT = injectedProjectRoot ?? process.cwd();
export const RUNTIME_TENANT = (() => {
	if (injectedTenantConfig) {
		return injectedTenantConfig;
	}
	try {
		return loadTreeseedManifest();
	} catch {
		return fallbackTenantConfig(RUNTIME_PROJECT_ROOT);
	}
})();
export const RUNTIME_SITE_CONFIG =
	injectedSiteConfig
	?? (() => {
		try {
			return parseSiteConfig(readFileSync(RUNTIME_TENANT.siteConfigPath, 'utf8'));
		} catch {
			return null;
		}
	})();
