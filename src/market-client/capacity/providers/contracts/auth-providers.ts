import { MarketClient } from "../../../../entrypoints/clients/market-client.ts";
export function authProvidersMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: Array<{
            id: string;
            label: string;
        }>;
    }>('/v1/auth/providers');
}
