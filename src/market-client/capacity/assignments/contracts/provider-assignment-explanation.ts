import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function providerAssignmentExplanationMethod(this: MarketClient, teamId: string, assignmentId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}/explanation`, { requireAuth: true });
}
