import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function explainCapacityAllocationSetMethod(this: MarketClient, teamId: string, allocationSetId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}/explain`, { method: 'POST', body, requireAuth: true });
}
