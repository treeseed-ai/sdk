import { MarketClient,MarketProfile } from "../../../entrypoints/clients/market-client.ts";
export function currentMarketMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: MarketProfile;
    }>('/v1/market/profile');
}
