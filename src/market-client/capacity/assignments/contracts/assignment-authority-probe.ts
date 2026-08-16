import type { MarketClient } from '../../../../entrypoints/clients/market-client.ts';
import type { evaluateAssignmentAuthorityProbe } from '../../../../agent-capacity/authority/assignment-authority-probe.ts';

export function assignmentAuthorityProbeMethod(this: MarketClient, teamId: string, assignmentId: string) {
	return this.request<{
		ok: true;
		payload: ReturnType<typeof evaluateAssignmentAuthorityProbe>;
	}>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}/authority-probe`, { requireAuth: true });
}
