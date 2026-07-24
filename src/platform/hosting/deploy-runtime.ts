import type { DeployConfig } from '../support/contracts.ts';
import { DEFAULT_PLUGIN_REFERENCES, DEFAULT_PROVIDER_SELECTIONS } from '../plugins/constants.ts';

declare const __TREESEED_DEPLOY_CONFIG__: DeployConfig | undefined;

let cachedDeployConfig: DeployConfig | null = null;

function defaultDeployConfig(): DeployConfig {
	return {
		name: 'Treeseed Site',
		slug: 'treeseed-site',
		siteUrl: 'https://example.com',
		contactEmail: 'contact@example.com',
		projectRoot: '.',
		cloudflare: {
			accountId: '',
			workerName: 'treeseed-site',
		},
		plugins: [...DEFAULT_PLUGIN_REFERENCES],
		providers: structuredClone(DEFAULT_PROVIDER_SELECTIONS),
		smtp: {
			enabled: false,
		},
		turnstile: {
			enabled: false,
		},
	};
}

export function getDeployConfig() {
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

export function resetDeployConfigForTests() {
	cachedDeployConfig = null;
}

export function getFormsProvider() {
	return getDeployConfig().providers?.forms ?? DEFAULT_PROVIDER_SELECTIONS.forms;
}

export function getOperationsProvider() {
	return getDeployConfig().providers?.operations ?? DEFAULT_PROVIDER_SELECTIONS.operations;
}

export function getAgentProviderSelections() {
	return getDeployConfig().providers?.agents ?? DEFAULT_PROVIDER_SELECTIONS.agents;
}

export function getDeployProvider() {
	return getDeployConfig().providers?.deploy ?? DEFAULT_PROVIDER_SELECTIONS.deploy;
}

export function getDnsProvider() {
	return getDeployConfig().providers?.dns ?? DEFAULT_PROVIDER_SELECTIONS.dns;
}

export function getContentRuntimeProvider() {
	return getDeployConfig().providers?.content?.runtime ?? DEFAULT_PROVIDER_SELECTIONS.content.runtime;
}

export function getContentPublishProvider() {
	return getDeployConfig().providers?.content?.publish ?? DEFAULT_PROVIDER_SELECTIONS.content.publish;
}

export function getContentServingMode() {
	const override = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
		?.env?.TREESEED_CONTENT_SERVING_MODE
		?.trim();
	if (override === 'local_collections' || override === 'published_runtime') {
		return override;
	}

	return getDeployConfig().providers?.content?.serving ?? DEFAULT_PROVIDER_SELECTIONS.content.serving;
}

export function getDocsProvider() {
	return getDeployConfig().providers?.content?.docs
		?? getDeployConfig().providers?.content?.runtime
		?? DEFAULT_PROVIDER_SELECTIONS.content.docs
		?? DEFAULT_PROVIDER_SELECTIONS.content.runtime;
}

export function getSiteProvider() {
	return getDeployConfig().providers?.site ?? DEFAULT_PROVIDER_SELECTIONS.site;
}

export function isSmtpEnabled() {
	return getDeployConfig().smtp?.enabled ?? false;
}

export function isTurnstileEnabled() {
	return getDeployConfig().turnstile?.enabled ?? false;
}
