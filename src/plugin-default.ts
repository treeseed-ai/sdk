import { createDefaultGraphRankingProvider } from './graph/ranking.ts';
import { defineTreeseedPlugin } from './platform/plugin.ts';

export default defineTreeseedPlugin({
	id: 'treeseed-sdk-default',
	provides: {
		forms: ['store_only', 'notify_admin', 'full_email'],
		operations: ['default'],
		agents: {
			execution: ['stub', 'manual', 'copilot'],
			mutation: ['local_branch'],
			repository: ['stub', 'git'],
			verification: ['stub', 'local'],
			notification: ['stub', 'sdk_message'],
			research: ['stub', 'project_graph'],
			handlers: [
				'planner',
				'architect',
				'engineer',
				'notifier',
				'researcher',
				'reviewer',
				'releaser',
			],
		},
		deploy: ['cloudflare'],
		content: {
			runtime: ['filesystem', 'team_scoped_r2_overlay'],
			publish: ['filesystem', 'team_scoped_r2_overlay'],
			docs: ['default'],
		},
		site: ['default'],
	},
	graphRankingProviders: {
		default: createDefaultGraphRankingProvider(),
	},
});
