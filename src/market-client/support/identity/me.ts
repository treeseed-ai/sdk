import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
import type { ApiPrincipal } from "../../../entrypoints/clients/remote.ts";
export function meMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: {
            principal: ApiPrincipal;
            teams: unknown[];
        };
    }>('/v1/me', { requireAuth: true });
}
