import { MarketClient,MarketProfile } from "../../../entrypoints/clients/market-client.ts";
export function marketsMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: MarketProfile[];
    }>('/v1/me/markets', { requireAuth: true });
}
