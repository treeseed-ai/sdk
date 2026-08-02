import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function startWorkdayMethod(this: MarketClient, workdayId: string, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/workdays/${encodeURIComponent(workdayId)}/start`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, requireAuth: true });
}
