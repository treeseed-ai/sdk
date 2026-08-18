import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export interface ProjectAgentSimulationLaunch {
	projectId: string;
	scenePath: string;
	immutableRef: string;
	requestId: string;
}

export function launchProjectAgentSimulationMethod(this: MarketClient, teamId: string, body: ProjectAgentSimulationLaunch) {
	return this.request<{
		ok: true;
		payload: {
			id: string;
			status: string;
			scenePath: string;
			immutableRef: string;
			replayed?: boolean;
			initiatingUserId?: string | null;
			executingServicePrincipalId?: string | null;
		};
	}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-lab/simulations`, {
		method: 'POST', body, requireAuth: true,
	});
}
