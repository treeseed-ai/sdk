import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export interface ProjectDefinitionSource {
	path: string;
	source: string;
}

export function authorProjectDefinitionsMethod(this: MarketClient, teamId: string, body: {
	projectId: string;
	files: ProjectDefinitionSource[];
	expectedBase?: string;
	changeSummary?: string;
	executionMode?: 'simulation' | 'production';
}) {
	return this.request<{
		ok: true;
		payload: { commit: string; branch: string; changedPaths: string[]; changeset: Record<string,unknown>; executionMode: 'simulation' | 'production'; upstreamMutationPolicy: 'denied' | 'exact-approved-ref' };
	}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-lab/surfaces/build/authoring-bundle`, {
		method: 'POST', body, requireAuth: true,
	});
}
