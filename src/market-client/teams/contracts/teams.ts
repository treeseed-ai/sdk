import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function teamsMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: unknown[];
    }>('/v1/teams', { requireAuth: true });
}
