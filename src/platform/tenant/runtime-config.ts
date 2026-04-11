import { readFileSync } from 'node:fs';
import type { TreeseedTenantConfig } from '../contracts.ts';
import { loadTreeseedManifest } from './config.ts';
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

export const RUNTIME_TENANT = injectedTenantConfig ?? loadTreeseedManifest();
export const RUNTIME_PROJECT_ROOT = injectedProjectRoot ?? process.cwd();
export const RUNTIME_SITE_CONFIG =
	injectedSiteConfig
	?? (() => {
		try {
			return parseSiteConfig(readFileSync(RUNTIME_TENANT.siteConfigPath, 'utf8'));
		} catch {
			return null;
		}
	})();
