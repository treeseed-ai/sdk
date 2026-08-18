import type { AgentAuthoringIntent } from '../../../../agent-capacity/authoring/agent-definition-authoring.ts';
import { MarketClient } from '../../../../entrypoints/clients/market-client.ts';

export function authorProjectAgentMethod(this: MarketClient, teamId: string, body: {
	projectId: string;
	intent: AgentAuthoringIntent;
	expectedBase?: string;
	changeSummary?: string;
	contentBody?: string;
	executionMode?: 'simulation' | 'production';
}) {
	return this.request<{
		ok: true;
		payload: { commit: string; branch: string; changedPaths: string[]; changeset: Record<string,unknown>; executionMode: 'simulation' | 'production'; upstreamMutationPolicy: 'denied' | 'exact-approved-ref' };
	}>(`/v1/teams/${encodeURIComponent(teamId)}/agent-lab/surfaces/build/authoring`, {
		method: 'POST', body, requireAuth: true,
	});
}
