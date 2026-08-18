import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function listSeedRunsMethod(this: MarketClient, limit?: number) {
    const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return this.request<{
        ok: true;
        payload: unknown[];
    }>(`/v1/seeds/runs${query}`, { requireAuth: true });
}
