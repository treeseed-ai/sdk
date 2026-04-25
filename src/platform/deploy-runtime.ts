import type { TreeseedDeployConfig } from './contracts.ts';
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
			enabled: false,
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

	cachedDeployConfig = defaultDeployConfig();
	return cachedDeployConfig;
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

export function getTreeseedDnsProvider() {
	return getTreeseedDeployConfig().providers?.dns ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.dns;
}

export function getTreeseedContentRuntimeProvider() {
	return getTreeseedDeployConfig().providers?.content?.runtime ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.runtime;
}

export function getTreeseedContentPublishProvider() {
	return getTreeseedDeployConfig().providers?.content?.publish ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.publish;
}

export function getTreeseedContentServingMode() {
	const override = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env?.TREESEED_CONTENT_SERVING_MODE
		?.trim();
	if (override === 'local_collections' || override === 'published_runtime') {
		return override;
	}

	return getTreeseedDeployConfig().providers?.content?.serving ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.serving;
}

export function getTreeseedDocsProvider() {
	return getTreeseedDeployConfig().providers?.content?.docs
		?? getTreeseedDeployConfig().providers?.content?.runtime
		?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.docs
		?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.content.runtime;
}

export function getTreeseedSiteProvider() {
	return getTreeseedDeployConfig().providers?.site ?? TREESEED_DEFAULT_PROVIDER_SELECTIONS.site;
}

export function isTreeseedSmtpEnabled() {
	return getTreeseedDeployConfig().smtp?.enabled ?? false;
}

export function isTreeseedTurnstileEnabled() {
	return getTreeseedDeployConfig().turnstile?.enabled ?? false;
}
