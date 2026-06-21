import { createDefaultGraphRankingProvider } from './graph/ranking.ts';
import { defineTreeseedPlugin } from './platform/plugin.ts';

export default defineTreeseedPlugin({
	id: 'treeseed-sdk-default',
	provides: {
		forms: ['store_only', 'notify_admin', 'full_email'],
		operations: ['default'],
		agents: {
			execution: [
				'copilot',
				'codex',
				'codex_subscription',
				'jira',
				'jira_issue_queue',
				'human_issue_queue',
				'github_issues',
				'github_issue_queue',
				'issue_queue',
				'discord',
				'discord_thread',
				'workflow',
				'workflow_operation',
				'deterministic_workflow',
				'github_actions',
				'github_actions_workflow',
			],
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
