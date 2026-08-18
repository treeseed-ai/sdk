import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function createCapacityGrantMethod(this: MarketClient, teamId: string, body: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/teams/${encodeURIComponent(teamId)}/capacity-grants`, { method: 'POST', body, requireAuth: true, headers: { 'idempotency-key': idempotencyKey } });
}
