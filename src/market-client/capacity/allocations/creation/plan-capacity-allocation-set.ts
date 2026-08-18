import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function planCapacityAllocationSetMethod(this: MarketClient, teamId: string, body: Record<string, unknown>) {
    return this.request<{
        ok: boolean;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/plan`, { method: 'POST', body, requireAuth: true });
}
