import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function logoutMethod(this: MarketClient) {
    return this.request<{
        ok: true;
    }>('/v1/auth/logout', {
        method: 'POST',
        requireAuth: true,
    });
}
