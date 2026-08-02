import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function archiveCapacityAllocationSetMethod(this: MarketClient, teamId: string, allocationSetId: string, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity/allocation-sets/${encodeURIComponent(allocationSetId)}/archive`, { method: 'POST', requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
