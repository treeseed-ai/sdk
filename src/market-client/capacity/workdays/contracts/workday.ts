import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function workdayMethod(this: MarketClient, workdayId: string) {
    return this.request<{
        ok: true;
        payload: Record<string, unknown>;
    }>(`/v1/workdays/${encodeURIComponent(workdayId)}`, { requireAuth: true });
}
