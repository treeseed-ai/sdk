import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function activateCapacityAllocationSetMethod(this: MarketClient, teamId: string, allocationSetId: string, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}/activate`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
