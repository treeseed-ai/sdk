import type { TreeseedDeployConfig } from './contracts.ts';
import { loadTreeseedDeployConfig } from './deploy/config.ts';
import { TREESEED_DEFAULT_PLUGIN_REFERENCES, TREESEED_DEFAULT_PROVIDER_SELECTIONS } from './plugins/constants.ts';

declare const __TREESEED_DEPLOY_CONFIG__: TreeseedDeployConfig | undefined;

let cachedDeployConfig: TreeseedDeployConfig | null = null;

function defaultDeployConfig(): TreeseedDeployConfig {
	return {
		name: 'Treeseed Site',
		slug: 'treeseed-site',
		siteUrl: 'https://example.com',
		contactEmail: 'contact@example.com',
		cloudflare: {
			accountId: '',
			workerName: 'treeseed-site',
		},
		plugins: [...TREESEED_DEFAULT_PLUGIN_REFERENCES],
		providers: structuredClone(TREESEED_DEFAULT_PROVIDER_SELECTIONS),
		smtp: {
			enabled: false,
		},
		turnstile: {
			enabled: true,
		},
	};
}

export function getTreeseedDeployConfig() {
	if (cachedDeployConfig) {
		return cachedDeployConfig;
	}

	if (typeof __TREESEED_DEPLOY_CONFIG__ !== 'undefined' && __TREESEED_DEPLOY_CONFIG__) {
		cachedDeployConfig = __TREESEED_DEPLOY_CONFIG__;
		return cachedDeployConfig;
	}

	try {
		cachedDeployConfig = loadTreeseedDeployConfig();
		return cachedDeployConfig;
	} catch {
		cachedDeployConfig = defaultDeployConfig();
		return cachedDeployConfig;
	}
}

export function resetTreeseedDeployConfigForTests() {
	cachedDeployConfig = null;
}

export function getTreeseedFormsProvider() {
	return getTreeseedDeployConfig().providers?.forms ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.forms;
}

export function getTreeseedOperationsProvider() {
	return getTreeseedDeployConfig().providers?.operations ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.operations;
}

export function getTreeseedAgentProviderSelections() {
	return getTreeseedDeployConfig().providers?.agents ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.agents;
}

export function getTreeseedDeployProvider() {
	return getTreeseedDeployConfig().providers?.deploy ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.deploy;
}

export function getTreeseedDocsProvider() {
	return getTreeseedDeployConfig().providers?.content?.docs ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.docs;
}

export function getTreeseedSiteProvider() {
	return getTreeseedDeployConfig().providers?.site ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.site;
}

export function isTreeseedSmtpEnabled() {
	return getTreeseedDeployConfig().smtp?.enabled ?? false;
}

export function isTreeseedTurnstileEnabled() {
	return getTreeseedDeployConfig().turnstile?.enabled ?? true;
}
