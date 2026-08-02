import type { AccountWebSession } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function webSessionsMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: AccountWebSession[];
    }>('/v1/auth/web/sessions', { requireAuth: true });
}
