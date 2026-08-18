export const DEFAULT_PLUGIN_PACKAGE = '@treeseed/sdk/plugin-default';

export const DEFAULT_PROVIDER_SELECTIONS = {
	forms: 'store_only',
	operations: 'default',
	agents: {
		execution: 'codex',
		mutation: 'local_branch',
		repository: 'git',
		verification: 'local',
		notification: 'sdk_message',
		research: 'project_graph',
	},
	deploy: 'cloudflare',
	dns: 'cloudflare-dns',
	content: {
		runtime: 'team_scoped_r2_overlay',
		publish: 'team_scoped_r2_overlay',
		docs: 'default',
		serving: 'local_collections',
	},
	site: 'default',
};

export const DEFAULT_PLUGIN_REFERENCES = [
	{
		package: DEFAULT_PLUGIN_PACKAGE,
		enabled: true,
	},
];
