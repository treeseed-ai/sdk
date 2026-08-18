import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export type ProjectAgentSimulationDraftOptions = {
	durationSeconds?: number;
	planningRounds?: number;
	assignmentTimeboxSeconds?: number;
	maxActiveAssignments?: number;
	agentSlugs?: string[];
	activityTypes?: string[];
};

export function projectAgentAuthoringDraftMethod(this: MarketClient, teamId: string, projectId: string, options: ProjectAgentSimulationDraftOptions = {}) {
	const query = new URLSearchParams({ project: projectId });
	if (options.durationSeconds !== undefined) query.set('durationSeconds', String(options.durationSeconds));
	if (options.planningRounds !== undefined) query.set('planningRounds', String(options.planningRounds));
	if (options.assignmentTimeboxSeconds !== undefined) query.set('assignmentTimeboxSeconds', String(options.assignmentTimeboxSeconds));
	if (options.maxActiveAssignments !== undefined) query.set('maxActiveAssignments', String(options.maxActiveAssignments));
	if (options.agentSlugs?.length) query.set('agents', options.agentSlugs.join(','));
	if (options.activityTypes?.length) query.set('activityProfiles', options.activityTypes.join(','));
	return this.request<{
		ok: true;
		payload: {
			projectId: string;
			projectName: string;
			seedPath: string;
			scenePath: string;
			testPath?: string;
			seedYaml: string;
			sceneYaml: string;
			testMdx?: string;
			expectedBase: string;
			diagnostics: Array<{ severity: string; message: string; path?: string }>;
		};
	}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-lab/surfaces/build/draft?${query.toString()}`, { requireAuth: true });
}
