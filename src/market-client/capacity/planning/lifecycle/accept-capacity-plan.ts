import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function acceptCapacityPlanMethod(this: MarketClient, capacityPlanId: string, body: Record<string, unknown> = {}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}/accept`, { method: 'POST', body, requireAuth: true });
}
