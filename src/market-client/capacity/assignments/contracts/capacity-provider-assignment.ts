import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityProviderAssignmentMethod(this: MarketClient, teamId: string, assignmentId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}`, { requireAuth: true });
}
