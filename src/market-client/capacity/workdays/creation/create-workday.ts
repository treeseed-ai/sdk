import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function createWorkdayMethod(this: MarketClient, body: Record<string, unknown>, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>('/v1/workdays', { method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey }, requireAuth: true });
}
