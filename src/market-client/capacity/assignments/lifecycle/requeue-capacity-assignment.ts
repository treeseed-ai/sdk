import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function requeueCapacityAssignmentMethod(this: MarketClient, teamId: string, assignmentId: string, body: {
    idempotencyKey: string;
    reason?: string;
}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/assignments/${encodeURIComponent(assignmentId)}/requeue`, { method: 'POST', body, requireAuth: true });
}
