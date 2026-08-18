import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function supersedeCapacityPlanMethod(this: MarketClient, capacityPlanId: string, body: Record<string, unknown> = {}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}/supersede`, { method: 'POST', body, requireAuth: true });
}
