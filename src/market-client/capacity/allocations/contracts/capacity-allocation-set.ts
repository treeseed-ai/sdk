import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityAllocationSetMethod(this: MarketClient, teamId: string, allocationSetId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}`, { requireAuth: true });
}
