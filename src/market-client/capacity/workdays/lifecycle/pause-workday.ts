import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function pauseWorkdayMethod(this: MarketClient, workdayId: string, idempotencyKey: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/workdays/${encodeURIComponent(workdayId)}/pause`, { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, requireAuth: true });
}
