import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function cancelCapacityAssignmentMethod(this: MarketClient, teamId: string, assignmentId: string, body: {
    idempotencyKey: string;
    reason?: string;
}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}/cancel`, { method: 'POST', body, requireAuth: true });
}
