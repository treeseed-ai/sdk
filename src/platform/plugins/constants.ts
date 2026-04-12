export const TREESEED_DEFAULT_PLUGIN_PACKAGE = '@treeseed/sdk/plugin-default';

export const TREESEED_DEFAULT_PROVIDER_SELECTIONS = {
	forms: 'store_only',
	operations: 'default',
	agents: {
		execution: 'stub',
		mutation: 'local_branch',
		repository: 'stub',
		verification: 'stub',
		notification: 'stub',
		research: 'stub',
	},
	deploy: 'cloudflare',
	content: {
		docs: 'default',
	},
	site: 'default',
};

export const TREESEED_DEFAULT_PLUGIN_REFERENCES = [
	{
		package: TREESEED_DEFAULT_PLUGIN_PACKAGE,
		enabled: true,
	},
];
