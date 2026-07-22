import { createDefaultGraphRankingProvider } from './graph/ranking.ts';
import { defineTreeseedPlugin } from './platform/plugin.ts';
import { BUILT_IN_AGENT_EXECUTION_PROVIDER_IDS } from './types/agents.ts';

export default defineTreeseedPlugin({
	id: 'treeseed-sdk-default',
	provides: {
		forms: ['store_only', 'notify_admin', 'full_email'],
		operations: ['default'],
			agents: {
				execution: [...BUILT_IN_AGENT_EXECUTION_PROVIDER_IDS],
			mutation: ['local_branch'],
			repository: ['git'],
			verification: ['local'],
			notification: ['sdk_message'],
			research: ['project_graph'],
				handlers: [
					'writer',
					'actor',
					'estimate',
					'releaser',
					'reporter',
				],
		},
		deploy: ['cloudflare'],
		dns: ['cloudflare-dns'],
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
