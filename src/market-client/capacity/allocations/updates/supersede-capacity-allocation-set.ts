import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function supersedeCapacityAllocationSetMethod(this: MarketClient, teamId: string, allocationSetId: string, body: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}/supersede`, { method: 'POST', body, requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
