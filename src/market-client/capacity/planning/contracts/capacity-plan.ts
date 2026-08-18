import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function capacityPlanMethod(this: MarketClient, capacityPlanId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/capacity-plans/${encodeURIComponent(capacityPlanId)}`, { requireAuth: true });
}
