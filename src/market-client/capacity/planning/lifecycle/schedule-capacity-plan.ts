import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function scheduleCapacityPlanMethod(this: MarketClient, capacityPlanId: string, body: Record<string, unknown> = {}) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}/schedule`, { method: 'POST', body, requireAuth: true });
}
