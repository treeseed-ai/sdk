import type { AccountIdentity } from "../../../accounts/account-contracts.ts";
import { MarketClient } from "../../../entrypoints/clients/market-client.ts";
export function accountIdentityMethod(this: MarketClient) {
    return this.request<{
        ok: true;
        payload: AccountIdentity;
    }>('/v1/auth/web/account/identity', { requireAuth: true });
}
